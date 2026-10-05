// Pruebas del motor de análisis: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

const fila = (x) => ({ id: Math.random().toString(36).slice(2), semana: '2026-09-21', personaId: 'p1', persona: 'Ana', area: 'Gestión',
  fecha: '2026-09-21', dia: 'LUNES', tarea: 'Tarea', tareaNorm: 'tarea', ordinal: 1, prioridad: 'Media', horas: 1,
  recursos: null, riesgos: null, estado: null, jornada: 44, ...x });

test('estado: valores acordados y texto libre', () => {
  assert.equal(E.estadoDe({ estado: 'Cumplida' }), 'Cumplida');
  assert.equal(E.estadoDe({ estado: 'en curso' }), 'En curso');
  assert.equal(E.estadoDe({ estado: 'Pendiente' }), 'Pendiente');
  assert.equal(E.estadoDe({ estado: 'Cancelada' }), 'Cancelada');
  assert.equal(E.estadoDe({ estado: 'Seguimiento de avance' }), 'Otro');
  assert.equal(E.estadoDe({ estado: '' }), 'Sin estado');
});

test('cumplimiento: cancelada no cuenta', () => {
  const k = E.kpisSemana([fila({ estado: 'Cumplida' }), fila({ estado: 'Pendiente' }), fila({ estado: 'Cancelada' })]);
  assert.equal(k.cumplimiento, 50);
});

test('clave de tarea: misma tarea con distinta redacción', () => {
  assert.equal(E.claveTarea('Órdenes de pago'), E.claveTarea('ordenes  de  pago.'));
  assert.equal(E.claveTarea('Actualizar planillas'), E.claveTarea('actualizar planilla'));
});

test('ocupación usa la jornada de cada persona', () => {
  const [p] = E.statsPersonas([fila({ horas: 15, jornada: 30 })]);
  assert.equal(p.ocupacion, 50);
});

test('sobrecarga según jornada propia', () => {
  const al = E.alertas([fila({ horas: 40, jornada: 30 })]);
  assert.ok(al.some((a) => a.regla === 'sobrecarga' && a.nivel === 'critica'));
});

test('horas reales por persona y semana → desvío', () => {
  E.CTX.reales.set('2026-09-21|p1', 12);
  const [p] = E.statsPersonas([fila({ horas: 6 }), fila({ horas: 4 })]);
  assert.equal(p.realSemana, 12);
  assert.equal(Math.round(p.desvioPct), 20);
  E.CTX.reales.clear();
});

test('alerta de horas críticas ignora tareas sin tiempo (eso es Auditoría)', () => {
  const rows = [1, 2, 3, 4].map(() => fila({ prioridad: 'Alta', horas: null }));
  assert.ok(!E.alertas(rows).some((a) => a.regla === 'alta_sin_tiempo'));
});

test('auditoría: lo marcado como revisado no vuelve a aparecer', () => {
  const r = fila({ horas: 12, tarea: 'Viaje a Rosario', tareaNorm: 'viaje a rosario' });
  let regla = E.auditoria([r], '2026-09-21').find((x) => x.id === 'tiempo_excesivo');
  assert.equal(regla.items.length, 1);
  E.CTX.excepciones.add(E.claveExcepcion(r, 'tiempo_excesivo'));
  regla = E.auditoria([fila({ ...r, id: 'otra-semana' })], '2026-09-21').find((x) => x.id === 'tiempo_excesivo');
  assert.equal(regla.items.length, 0);
  assert.equal(regla.revisadas.length, 1);
  E.CTX.excepciones.clear();
});

test('riesgo evaluado se hereda por persona y texto', () => {
  E.CTX.riesgos.set(E.claveRiesgo('p1', 'Caída de internet'), { prob: 'alto', impacto: 'alto' });
  assert.equal(E.nivelDe(fila({ riesgos: 'caida de internet ', semana: '2026-10-05' })), 'crítico');
  E.CTX.riesgos.clear();
});

test('cobertura de carga detecta quién no cargó', () => {
  const previas = [fila({ personaId: 'p2', persona: 'Beto', semana: '2026-09-14' })];
  const c = E.coberturaCarga([fila()], previas);
  assert.deepEqual(c.faltan.map((f) => f.persona), ['Beto']);
});

test('cobertura de carga: cuenta a todas las personas que planificaron antes, aunque haga más de 4 semanas', () => {
  const previas = [
    { semana: '2026-06-01', personaId: 'p3', persona: 'Caro', area: 'Producción' },   // última vez hace meses
    { semana: '2026-08-24', personaId: 'p2', persona: 'Beto', area: 'Producción' },
    { semana: '2026-09-14', personaId: 'p2', persona: 'Beto', area: 'Producción' },
  ];
  const c = E.coberturaCarga([fila({ area: 'Producción', semana: '2026-10-05' })], previas);
  assert.equal(c.habituales, 3);
  assert.equal(c.cargaron, 1);
  assert.deepEqual(c.faltan.map((f) => [f.persona, f.ultima]), [['Beto', '2026-09-14'], ['Caro', '2026-06-01']]);
});

test('cumplimiento de carga: semanas con planificación sobre el total y semáforo', async () => {
  const { cumplimientoCarga, nivelSemaforo } = await import('../js/engine.js');
  const semanas = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  const reg = [
    { semana: '2026-07-06', persona: 'Ana', area: 'Gestión' }, { semana: '2026-07-13', persona: 'Ana', area: 'Gestión' },
    { semana: '2026-07-20', persona: 'Ana', area: 'Gestión' }, { semana: '2026-07-27', persona: 'Ana', area: 'Gestión' },
    { semana: '2026-07-13', persona: 'Beto', area: 'Producción' },
    { semana: '2026-08-03', persona: 'Beto', area: 'Producción' }, // fuera del rango: no cuenta
  ];
  const r = cumplimientoCarga(reg, semanas);
  assert.deepEqual(r.semanas.map((s) => s.numero), [1, 2, 3, 4]);
  const ana = r.personas.find((p) => p.persona === 'Ana');
  const beto = r.personas.find((p) => p.persona === 'Beto');
  assert.equal(ana.pct, 100); assert.equal(ana.nivel, 'verde');
  assert.deepEqual(beto.marcas, [false, true, false, false]);
  assert.equal(beto.pct, 25); assert.equal(beto.nivel, 'naranja');
  assert.equal(nivelSemaforo(0), 'rojo'); assert.equal(nivelSemaforo(24.9), 'rojo');
  assert.equal(nivelSemaforo(50), 'amarillo'); assert.equal(nivelSemaforo(74.9), 'amarillo'); assert.equal(nivelSemaforo(75), 'verde');
});

test('propuestas de mejora: clasificación, automatización y herramienta', () => {
  assert.equal(E.clasificar('Actualizar planilla de stock'), 'Documentación');
  assert.equal(E.clasificar('Tarea sin palabras clave'), 'Operativa');
  assert.equal(E.clasificar('Tarea sin palabras clave', true), 'Repetitiva');
  assert.equal(E.automatizacion('Definir estrategia comercial', 'Estratégica').nivel, 'Nulo');
  assert.equal(E.automatizacion('Copiar datos a la planilla', 'Operativa').score, 90);
  assert.equal(E.herramientaPara('Armar reporte mensual', 'Analítica'), 'Power BI');
});

test('propuestas de mejora: horas por semana, recuperables y tareas entre personas', () => {
  const base = { area: 'Gestión', jornada: 44, fecha: '2026-07-06' };
  const rows = [
    { ...base, semana: '2026-07-06', persona: 'Ana', tarea: 'Pago a proveedores', horas: 4 },
    { ...base, semana: '2026-07-13', persona: 'Ana', tarea: 'Pago a proveedores', horas: 4 },
    { ...base, semana: '2026-07-06', persona: 'Beto', tarea: 'pago de proveedores', horas: 2 },
    { ...base, semana: '2026-07-06', persona: 'Beto', tarea: 'Definir estrategia anual', horas: 6 },
  ];
  const a = E.analisisMejoras(rows, 2);
  const pago = a.unicas.find((t) => t.categoria === 'Administrativa');
  assert.equal(pago.horasSemana, 5);                     // (4 + 4 + 2) / 2 semanas
  assert.deepEqual(pago.personas.sort(), ['Ana', 'Beto']);
  assert.ok(a.recuperableSemana > 0);
  assert.equal(a.entrePersonas[0].personas.length, 2);
  assert.ok(a.indice >= 0 && a.indice <= 100);
});

test('tareas repetitivas: misma tarea más de una vez por persona en el período', () => {
  const base = { area: 'Gestión', jornada: 44 };
  const r = E.tareasRepetitivas([
    { ...base, semana: '2026-07-06', persona: 'Ana', tarea: 'Control de caja', horas: 1 },
    { ...base, semana: '2026-07-06', persona: 'Ana', tarea: 'Control de caja', horas: 1 },
    { ...base, semana: '2026-07-13', persona: 'Ana', tarea: 'Control de caja', horas: null },
    { ...base, semana: '2026-07-06', persona: 'Ana', tarea: 'Reunión única', horas: 2 },
    { ...base, semana: '2026-07-06', persona: 'Beto', tarea: 'Viaje', horas: 8 },
    { ...base, semana: '2026-07-06', persona: 'Beto', tarea: 'Informe semanal', horas: 1 },
    { ...base, semana: '2026-07-13', persona: 'Beto', tarea: 'Informe semanal', horas: 1 }, // 1 vez por semana: no es repetitiva
  ]);
  assert.equal(r.personas, 2);
  assert.equal(r.personasConRepetitivas, 1);
  const ana = r.porPersona.find((p) => p.persona === 'Ana');
  assert.equal(ana.tareas.length, 1);
  assert.equal(ana.tareas[0].veces, 3);
  assert.equal(ana.tareas[0].semanas, 2);
  assert.equal(ana.tareas[0].horas, 2);
  assert.equal(ana.tareas[0].horasPorVez, 1);           // promedio sobre las que tienen horas
});

test('personas por área: el área es la del Excel donde se cargó la actividad', async () => {
  const { cumplimientoCarga } = await import('../js/engine.js');
  // Ana figura en Compras, pero esta semana también planificó en el Excel de Ventas
  const filas = [fila({ area: 'Compras', horas: 30, jornada: 44 }), fila({ area: 'Ventas', horas: 30, jornada: 44 }),
    fila({ personaId: 'p2', persona: 'Beto', area: 'Ventas', horas: 10, jornada: 44 })];
  const k = E.kpisSemana(filas);
  assert.equal(k.personas, 2);                                     // personas únicas, no filas
  assert.equal(E.kpisSemana(filas.filter((r) => r.area === 'Ventas')).personas, 2);
  assert.equal(E.kpisSemana(filas.filter((r) => r.area === 'Compras')).personas, 1);
  const ana = E.statsPersonas(filas).find((p) => p.persona === 'Ana');
  assert.equal(ana.area, 'Compras, Ventas');
  assert.deepEqual(ana.areas, ['Compras', 'Ventas']);
  // redistribución: Beto comparte el área Ventas con Ana
  assert.match(E.recomendaciones({ rows: filas, rangeRows: filas }).map((r) => r.texto).join(' '), /a Beto/);

  // cuadro de carga: mismo criterio y misma cuenta que los indicadores
  const semanas = ['2026-09-21'];
  const reg = [{ semana: '2026-09-21', persona: 'Ana', area: 'Compras' }, { semana: '2026-09-21', persona: 'Ana', area: 'Ventas' },
    { semana: '2026-09-21', persona: 'Beto', area: 'Ventas' }];
  const todo = cumplimientoCarga(reg, semanas);
  assert.equal(todo.personas.length, 2);
  assert.equal(todo.personas.find((p) => p.persona === 'Ana').area, 'Compras, Ventas');
  assert.equal(cumplimientoCarga(reg.filter((r) => r.area === 'Ventas'), semanas).personas.length, 2);
  assert.equal(cumplimientoCarga(reg.filter((r) => r.area === 'Compras'), semanas).personas.length, 1);
});
