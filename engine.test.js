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
