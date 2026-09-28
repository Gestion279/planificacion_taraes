// =====================================================================
// Motor de análisis — única fuente de cálculo de la aplicación.
// Los módulos NO calculan indicadores: consumen estas funciones.
// Todas las funciones reciben actividades normalizadas (ver db.js).
// =====================================================================

export const CONFIG = {
  jornada: 44,            // horas semanales de referencia (se mantiene del dashboard anterior)
  ocupAlta: 110,          // % ocupación que dispara "sobrecarga"
  ocupCritica: 120,       // % ocupación crítica
  ocupBaja: 30,           // % por debajo del cual se sospecha subregistro
  horasDiaMax: 10,        // horas planificadas en un solo día
  horasTareaMax: 8,       // horas de una sola tarea (dato a revisar)
  altaShareMax: 0.75,     // proporción de horas en prioridad Alta
  minTareasRegla: 5,      // mínimo de tareas para aplicar reglas de proporción
  riesgosMax: 5,          // riesgos DISTINTOS declarados por persona en la semana
  repetitivasMax: 4,      // tareas repetitivas en la semana
  recurrenciaSemanas: 3,  // semanas en las que debe aparecer una tarea para ser "recurrente"
  coberturaMin: 50,       // % de actividades con estado para confiar en el cumplimiento
};

// Datos que se cargan en la aplicación (no vienen del Excel). Los completa app.js.
//   reales:      "semana|personaId"            → horas reales de la semana
//   riesgos:     "personaId|riesgo normalizado" → { prob, impacto }
//   excepciones: "personaId|tareaNorm|regla"    → revisado en Auditoría
export const CTX = { reales: new Map(), riesgos: new Map(), excepciones: new Set() };

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const PRIORIDADES = ['Alta', 'Media', 'Baja', 'Sin prioridad'];

// ---------- utilidades ----------
export function norm(s) {
  return (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const round1 = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR'); // para textos: coma decimal
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function diaDe(r) {
  if (r.fecha) {
    const [y, m, d] = r.fecha.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
    return DIAS[(dow + 6) % 7];
  }
  const n = norm(r.dia);
  return DIAS.find((d) => norm(d).slice(0, 3) === n.slice(0, 3)) || 'Sin día';
}

export const prioridadDe = (r) => r.prioridad || 'Sin prioridad';
export const tieneRiesgo = (r) => !!(r.riesgos && r.riesgos.trim());
export const tieneRecursos = (r) => !!(r.recursos && r.recursos.trim());

// Estado: el texto es libre en el Excel; se clasifica con las mismas reglas del Histórico.
export function estadoDe(r) {
  const t = norm(r.estado);
  if (!t) return 'Sin estado';
  if (/cancelad|anulad|suspendid/.test(t)) return 'Cancelada';
  if (/pendient|no cumpl|incumpl|incomplet|atrasad|demorad|no realizad|sin avance/.test(t)) return 'Pendiente';
  if (/proceso|parcial|en curso|avanzad/.test(t)) return 'En curso';
  if (/cumplid|complet|realizad|finaliz|\bok\b|\bsi\b|hecho|terminad|entregad|enviad|actualizad|cerrad/.test(t)) return 'Cumplida';
  return 'Otro';
}
const ESTADO_SCORE = { Cumplida: 1, 'En curso': 0.5, Pendiente: 0 };
// Cancelada no cuenta para el cumplimiento. Valores acordados para la columna Estado del Excel:
export const ESTADOS_EXCEL = ['Pendiente', 'En curso', 'Cumplida', 'Cancelada'];
export const ESTADOS = ['Cumplida', 'En curso', 'Pendiente', 'Cancelada', 'Otro', 'Sin estado'];

// ---------- clave de tarea: ÚNICA definición de "misma tarea" para repetitivas/recurrentes ----------
const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'a', 'en', 'con', 'para', 'por',
  'del', 'al', 'su', 'sus', 'se', 'que', 'lo', 'este', 'esta', 'estos', 'estas', 'sobre', 'e']);
const SINON = {
  dashboard: 'tablero', tableros: 'tablero', excel: 'planilla', planillas: 'planilla', correos: 'correo', mails: 'correo',
  mail: 'correo', emails: 'correo', email: 'correo', reportes: 'reporte', informe: 'reporte', informes: 'reporte',
  actualizacion: 'actualizar', actualizando: 'actualizar', cargar: 'actualizar', carga: 'actualizar',
};
export function claveTarea(texto) {
  const toks = norm(texto).split(' ').filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => SINON[w] || (w.length > 4 ? w.replace(/(es|s)$/, '') : w));
  return [...new Set(toks)].sort().join(' ');
}

// =====================================================================
// Estadísticas por persona (semana o período)
// =====================================================================
export function statsPersonas(rows, { semanas = 1 } = {}) {
  const out = [];
  for (const [persona, rs] of groupBy(rows, (r) => r.persona)) {
    const horas = sum(rs, (r) => r.horas);
    const nSem = semanas > 1 ? new Set(rs.map((r) => r.semana)).size || 1 : 1;
    const conEstado = rs.filter((r) => estadoDe(r) !== 'Sin estado');
    const puntuables = rs.map((r) => ESTADO_SCORE[estadoDe(r)]).filter((v) => v !== undefined);
    const jornada = Number(rs[0].jornada) || CONFIG.jornada;
    // horas reales: total por persona y semana (se cargan en Personas)
    const semanasP = [...new Set(rs.map((r) => r.semana))];
    const semConReal = semanasP.filter((s) => CTX.reales.has(`${s}|${rs[0].personaId}`));
    const realTotal = sum(semConReal, (s) => CTX.reales.get(`${s}|${rs[0].personaId}`));
    const planConReal = sum(rs.filter((r) => semConReal.includes(r.semana)), (r) => r.horas);
    const prio = { Alta: 0, Media: 0, Baja: 0, 'Sin prioridad': 0 };
    const prioH = { Alta: 0, Media: 0, Baja: 0, 'Sin prioridad': 0 };
    rs.forEach((r) => { prio[prioridadDe(r)]++; prioH[prioridadDe(r)] += r.horas || 0; });
    const horasDia = {};
    rs.forEach((r) => { const d = diaDe(r); horasDia[d] = (horasDia[d] || 0) + (r.horas || 0); });
    out.push({
      persona,
      personaId: rs[0].personaId,
      area: rs[0].area,
      actividades: rs.length / nSem,
      horas: horas / nSem,
      jornada,
      ocupacion: pct(horas / nSem, jornada),
      semanas: nSem,
      cumplimiento: puntuables.length ? (sum(puntuables) / puntuables.length) * 100 : null,
      cobertura: pct(conEstado.length, rs.length),
      pendientes: rs.filter((r) => estadoDe(r) === 'Pendiente'),
      horasReales: semConReal.length ? realTotal / nSem : null,
      realSemana: semanasP.length === 1 ? CTX.reales.get(`${semanasP[0]}|${rs[0].personaId}`) ?? null : null,
      desvio: semConReal.length ? realTotal - planConReal : null,
      desvioPct: semConReal.length && planConReal > 0 ? ((realTotal - planConReal) / planConReal) * 100 : null,
      coberturaReal: pct(semConReal.length, semanasP.length),
      prio, prioH, horasDia,
      conRiesgo: rs.filter(tieneRiesgo).length,
      riesgosDistintos: new Set(rs.filter(tieneRiesgo).map((r) => norm(r.riesgos))).size,
      dias: Object.keys(horasDia).filter((d) => d !== 'Sin día').length,
      rows: rs,
    });
  }
  return out.sort((a, b) => b.horas - a.horas);
}

// =====================================================================
// Indicadores ejecutivos de una semana (lugar principal: Resumen)
// =====================================================================
export function kpisSemana(rows) {
  const puntuables = rows.map((r) => ESTADO_SCORE[estadoDe(r)]).filter((v) => v !== undefined);
  const al = alertas(rows);
  return {
    actividades: rows.length,
    personas: new Set(rows.map((r) => r.persona)).size,
    horas: sum(rows, (r) => r.horas),
    cumplimiento: puntuables.length ? (sum(puntuables) / puntuables.length) * 100 : null,
    cobertura: pct(rows.filter((r) => estadoDe(r) !== 'Sin estado').length, rows.length),
    alertasCriticas: al.filter((a) => a.nivel === 'critica').length,
    alertas: al,
  };
}

// =====================================================================
// Alertas del sistema (detectadas automáticamente — NO son riesgos declarados)
// Reglas tomadas de calcPersonRisk (Semanal) y del Histórico, separadas por regla.
// =====================================================================
export const REGLAS_ALERTA = {
  sobrecarga: 'Sobrecarga',
  subregistro: 'Posible subregistro',
  dia_saturado: 'Día saturado',
  concentracion_dia: 'Concentración en pocos días',
  prioridad_alta_excesiva: 'Prioridad alta excesiva',
  alta_sin_tiempo: 'Tareas críticas con poco tiempo',
  incumplimiento: 'Incumplimientos',
  acumulacion_riesgos: 'Acumulación de riesgos',
  repetitividad: 'Alta repetitividad',
};

export function alertas(rows) {
  const out = [];
  const add = (regla, nivel, p, detalle, porque) =>
    out.push({ regla, nombre: REGLAS_ALERTA[regla], nivel, persona: p.persona, area: p.area, detalle, porque });

  for (const p of statsPersonas(rows)) {
    const n = p.rows.length;
    if (p.ocupacion > CONFIG.ocupCritica)
      add('sobrecarga', 'critica', p, `${round1(p.horas)} h planificadas (${Math.round(p.ocupacion)}% de su jornada de ${round1(p.jornada)} h)`,
        'La carga supera la jornada de referencia: riesgo de incumplimiento y desgaste.');
    else if (p.ocupacion > CONFIG.ocupAlta)
      add('sobrecarga', 'advertencia', p, `${round1(p.horas)} h planificadas (${Math.round(p.ocupacion)}%)`,
        'La carga está por encima del umbral recomendado.');
    else if (p.horas > 0 && p.ocupacion < CONFIG.ocupBaja)
      add('subregistro', 'info', p, `Solo ${round1(p.horas)} h planificadas (${Math.round(p.ocupacion)}%)`,
        'Puede faltar planificar actividades o completar tiempos.');

    for (const [dia, h] of Object.entries(p.horasDia)) {
      if (dia !== 'Sin día' && h > CONFIG.horasDiaMax)
        add('dia_saturado', 'advertencia', p, `${dia}: ${round1(h)} h planificadas`,
          `Un día con más de ${CONFIG.horasDiaMax} h es difícil de cumplir.`);
    }
    if (p.dias <= 1 && n > 4)
      add('concentracion_dia', 'advertencia', p, `${n} tareas en ${p.dias} día`, 'Toda la semana depende de un solo día.');

    const horasAlta = p.prioH.Alta;
    if (n >= CONFIG.minTareasRegla && p.horas > 0 && horasAlta / p.horas > CONFIG.altaShareMax)
      add('prioridad_alta_excesiva', 'info', p, `${Math.round((horasAlta / p.horas) * 100)}% de las horas en prioridad Alta`,
        'Si casi todo es prioritario, la prioridad deja de ordenar el trabajo.');

    // solo tareas con tiempo cargado: la falta de tiempo es un tema de Auditoría, no de planificación
    const altas = p.rows.filter((r) => r.prioridad === 'Alta' && r.horas > 0);
    const hAlta = sum(altas, (r) => r.horas);
    if (altas.length >= 3 && hAlta / altas.length < 0.5)
      add('alta_sin_tiempo', 'info', p, `${altas.length} tareas Alta con ${round1(hAlta / altas.length)} h promedio`,
        'Las tareas críticas con muy poco tiempo asignado suelen estar subestimadas.');

    if (p.pendientes.length) {
      const criticas = p.pendientes.filter((r) => r.prioridad === 'Alta').length;
      add('incumplimiento', criticas ? 'critica' : 'advertencia', p,
        `${p.pendientes.length} ${p.pendientes.length === 1 ? 'tarea pendiente o no cumplida' : 'tareas pendientes o no cumplidas'}${criticas ? `, ${criticas} de prioridad Alta` : ''}`,
        'El estado informado indica que la tarea no se cumplió.');
    }
    if (p.riesgosDistintos > CONFIG.riesgosMax)
      add('acumulacion_riesgos', 'advertencia', p, `${p.riesgosDistintos} riesgos distintos declarados en ${p.conRiesgo} actividades`,
        'Muchos riesgos simultáneos aumentan la probabilidad de desvíos.');

    const rep = repetitivasSemana(p.rows);
    if (rep.length > CONFIG.repetitivasMax)
      add('repetitividad', 'info', p, `${rep.length} tareas se repiten en varios días`,
        'Tareas que se repiten todos los días son candidatas a estandarizar o automatizar.');
  }
  const orden = { critica: 0, advertencia: 1, info: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel] || a.persona.localeCompare(b.persona));
}

// =====================================================================
// Auditoría de datos (calidad del registro) — por actividad
// =====================================================================
export const REGLAS_AUDITORIA = [
  { id: 'sin_tarea', nombre: 'Registro sin tarea', grave: true, porque: 'La fila tiene datos pero no describe qué se va a hacer.', test: (r) => !r.tarea },
  { id: 'sin_tiempo', nombre: 'Sin tiempo', grave: true, porque: 'Sin horas no se puede medir carga ni comparar plan vs real.', test: (r) => r.horas === null || r.horas === undefined || r.horas === 0 },
  { id: 'sin_prioridad', nombre: 'Sin prioridad', grave: true, porque: 'Sin prioridad no se puede ordenar la semana ni detectar concentración de tareas críticas.', test: (r) => !r.prioridad },
  { id: 'tiempo_excesivo', nombre: `Tarea de más de ${CONFIG.horasTareaMax} h`, grave: true, porque: 'Una sola tarea que ocupa más de un día suele ser un error de carga o una tarea que conviene dividir.', test: (r) => (r.horas || 0) > CONFIG.horasTareaMax },
  { id: 'fecha_fuera', nombre: 'Fecha fuera de la semana', grave: true, porque: 'La fecha no corresponde a la semana cargada: puede ser un arrastre de la semana anterior.', test: (r, ctx) => r.fecha && ctx.semana && (r.fecha < ctx.semana || r.fecha > ctx.semanaFin) },
  { id: 'sin_fecha', nombre: 'Sin fecha', grave: true, porque: 'Sin fecha no se puede ubicar la tarea en la semana.', test: (r) => !r.fecha },
  { id: 'dia_inconsistente', nombre: 'Día no coincide con la fecha', grave: false, porque: 'El día escrito y la fecha no coinciden; una de las dos está mal.', test: (r) => r.fecha && r.dia && norm(r.dia).slice(0, 3) !== norm(diaDe(r)).slice(0, 3) },
  { id: 'posible_duplicado', nombre: 'Posible duplicado', grave: false, porque: 'Misma tarea, misma persona y mismo día más de una vez.', test: (r) => r.ordinal > 1 && !!r.tarea },
  { id: 'sin_recursos', nombre: 'Sin recursos', grave: false, porque: 'No se indicó qué se necesita para cumplir la tarea.', test: (r) => !tieneRecursos(r) },
  { id: 'sin_riesgo', nombre: 'Sin riesgo informado', grave: false, porque: 'No se indicó si la tarea tiene riesgos o bloqueos.', test: (r) => !tieneRiesgo(r) },
  { id: 'estado_no_reconocido', nombre: 'Estado no reconocido', grave: false, porque: 'El Estado no es uno de los valores acordados (Pendiente, En curso, Cumplida, Cancelada), así que no cuenta para el cumplimiento.', test: (r) => estadoDe(r) === 'Otro' },
  { id: 'sin_estado', nombre: 'Sin estado', grave: false, porque: 'Sin estado no se puede medir el cumplimiento.', test: (r) => estadoDe(r) === 'Sin estado' },
];

export const claveExcepcion = (r, regla) => `${r.personaId}|${r.tareaNorm || ''}|${regla}`;

export function auditoria(rows, semanaInicio) {
  const ctx = { semana: semanaInicio, semanaFin: semanaInicio ? addDays(semanaInicio, 6) : null };
  return REGLAS_AUDITORIA.map((regla) => {
    const todos = rows.filter((r) => regla.test(r, ctx));
    // lo marcado como revisado (misma persona, misma tarea, misma regla) no vuelve a aparecer
    const revisadas = todos.filter((r) => CTX.excepciones.has(claveExcepcion(r, regla.id)));
    const items = todos.filter((r) => !CTX.excepciones.has(claveExcepcion(r, regla.id)));
    const personas = [...groupBy(items, (r) => r.persona)].map(([p, rs]) => ({ persona: p, cantidad: rs.length }))
      .sort((a, b) => b.cantidad - a.cantidad);
    return { ...regla, items, revisadas, personas, pct: pct(items.length, rows.length) };
  });
}

// =====================================================================
// Repetitivas (en la semana) y recurrentes (en el período) — misma clave
// =====================================================================
export function repetitivasSemana(rows) {
  const out = [];
  for (const [k, rs] of groupBy(rows.filter((r) => r.tarea), (r) => `${r.persona}|${claveTarea(r.tarea)}`)) {
    const dias = new Set(rs.map(diaDe));
    if (dias.size >= 2) out.push({ persona: rs[0].persona, tarea: rs[0].tarea, clave: k.split('|')[1], dias: dias.size, veces: rs.length, horas: sum(rs, (r) => r.horas) });
  }
  return out.sort((a, b) => b.horas - a.horas);
}

export function recurrentesPeriodo(rows, minSemanas = CONFIG.recurrenciaSemanas) {
  const out = [];
  for (const [clave, rs] of groupBy(rows.filter((r) => r.tarea), (r) => claveTarea(r.tarea))) {
    if (!clave) continue;
    const semanas = new Set(rs.map((r) => r.semana));
    if (semanas.size < minSemanas) continue;
    const personas = [...new Set(rs.map((r) => r.persona))];
    const etiqueta = [...groupBy(rs, (r) => r.tarea)].sort((a, b) => b[1].length - a[1].length)[0][0];
    out.push({ clave, tarea: etiqueta, semanas: semanas.size, personas, veces: rs.length,
      horasSemana: sum(rs, (r) => r.horas) / semanas.size, categoria: clasificar(etiqueta) });
  }
  return out.sort((a, b) => b.horasSemana - a.horasSemana);
}

// Riesgos declarados que se repiten entre semanas
export function riesgosPersistentes(rows) {
  const out = [];
  for (const [k, rs] of groupBy(rows.filter(tieneRiesgo), (r) => norm(r.riesgos))) {
    const semanas = [...new Set(rs.map((r) => r.semana))].sort();
    if (semanas.length < 2) continue;
    out.push({ riesgo: rs[0].riesgos, semanas: semanas.length, desde: semanas[0], hasta: semanas[semanas.length - 1],
      personas: [...new Set(rs.map((r) => r.persona))], veces: rs.length });
  }
  return out.sort((a, b) => b.semanas - a.semanas || b.veces - a.veces);
}

// =====================================================================
// Riesgos declarados: matriz Probabilidad × Impacto (se mantiene del Semanal)
// =====================================================================
export const NIVELES_RIESGO = ['bajo', 'moderado', 'alto'];
const MATRIZ = {
  bajo: { bajo: 'bajo', moderado: 'moderado', alto: 'alto' },
  moderado: { bajo: 'moderado', moderado: 'moderado', alto: 'alto' },
  alto: { bajo: 'alto', moderado: 'alto', alto: 'crítico' },
};
export const nivelRiesgo = (prob, impacto) => (prob && impacto ? MATRIZ[prob][impacto] : null);
export const claveRiesgo = (personaId, riesgo) => `${personaId}|${norm(riesgo)}`;
// La evaluación se guarda por persona + texto del riesgo: se hereda en todas las semanas
export const evaluacionDe = (r) => CTX.riesgos.get(claveRiesgo(r.personaId, r.riesgos)) || {};
export const nivelDe = (r) => { const e = evaluacionDe(r); return nivelRiesgo(e.prob, e.impacto); };

// =====================================================================
// Serie semanal para Evolución
// =====================================================================
export function serieSemanal(rows, cambios, semanas) {
  const porSemana = groupBy(rows, (r) => r.semana);
  const cambiosPorSemana = groupBy(cambios || [], (c) => c.semana);
  return semanas.map((s) => {
    const rs = porSemana.get(s) || [];
    const k = kpisSemana(rs);
    const cs = cambiosPorSemana.get(s) || [];
    const personasReal = [...new Set(rs.map((r) => r.personaId))].filter((id) => CTX.reales.has(`${s}|${id}`));
    const real = sum(personasReal, (id) => CTX.reales.get(`${s}|${id}`));
    const plan = sum(rs.filter((r) => personasReal.includes(r.personaId)), (r) => r.horas);
    return {
      semana: s, ...k,
      riesgos: rs.filter(tieneRiesgo).length,
      horasReales: personasReal.length ? real : null,
      desvioPct: personasReal.length && plan > 0 ? ((real - plan) / plan) * 100 : null,
      agregadas: cs.filter((c) => c.tipo === 'alta').length,
      modificadas: new Set(cs.filter((c) => c.tipo === 'modificacion' && c.origen === 'excel').map((c) => c.actividadId)).size,
      retiradas: cs.filter((c) => c.tipo === 'retiro').length,
    };
  });
}

// =====================================================================
// Cobertura de carga: quiénes planificaron habitualmente y esta semana no
// =====================================================================
export function coberturaCarga(filasSemana, filasPrevias) {
  const actuales = new Set(filasSemana.map((r) => r.personaId));
  const habituales = new Map();
  filasPrevias.forEach((r) => habituales.set(r.personaId, { persona: r.persona, area: r.area }));
  filasSemana.forEach((r) => habituales.set(r.personaId, { persona: r.persona, area: r.area }));
  const faltan = [...habituales].filter(([id]) => !actuales.has(id)).map(([, v]) => v)
    .sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
  return { habituales: habituales.size, cargaron: actuales.size, faltan };
}

// =====================================================================
// Clasificación de actividades (de "Propuestas de mejoras")
// =====================================================================
// Reglas tomadas de la hoja "Propuestas de Mejoras" del dashboard anterior.
const CATEGORIAS = [
  ['Automatización', ['automatiz', 'rpa', 'n8n', 'macro', 'script', 'power query', 'power automate', 'bot ']],
  ['Control', ['control', 'revisar', 'revision', 'verificar', 'auditor', 'cheque', 'validar', 'certificad', 'rendicion', 'conciliacion']],
  ['Comunicación', ['reunion', 'llamada', 'correo', 'mail', 'email', 'comunicar', 'atencion de consulta', 'consulta']],
  ['Documentación', ['document', 'archivo', 'expediente', 'planilla', 'formulario', 'escane', 'digitaliz', 'completar']],
  ['Analítica', ['analiz', 'analisis', 'indicador', 'kpi', 'reporte', 'informe', 'dashboard', 'tablero', 'estadistic', 'proyeccion', 'presupuesto']],
  ['Estratégica', ['estrateg', 'planificacion', 'plan anual', 'proyecto', 'decisio', 'roadmap', 'negociacion']],
  ['Creativa', ['disen', 'creativ', 'idear', 'contenido', 'campana', 'propuesta']],
  ['Gestión', ['gestion', 'administrar', 'tramitar', 'seguimiento', 'coordinacion', 'logistic', 'coordinar']],
  ['Administrativa', ['factura', 'pago', 'rrhh', 'recursos humanos', 'sueldo', 'caja', 'viatico', 'compra', 'proveedor']],
];
const AUTOMATIZABLE = new Set(['Automatización', 'Repetitiva', 'Documentación', 'Administrativa', 'Control', 'Analítica']);
export function clasificar(texto, repetida = false) {
  const n = norm(texto);
  for (const [cat, kws] of CATEGORIAS) if (kws.some((k) => n.includes(k))) return cat;
  return repetida ? 'Repetitiva' : 'Operativa';
}

// =====================================================================
// Propuestas de mejora (hoja del dashboard anterior, sobre el período filtrado)
// =====================================================================
export const MEJORAS = { factorRecuperable: 0.6, umbralAutomatizable: 60 };
const AUTO_BASE = { 'Automatización': 90, 'Repetitiva': 85, 'Documentación': 80, 'Administrativa': 75, 'Control': 70,
  'Comunicación': 55, 'Gestión': 50, 'Operativa': 45, 'Analítica': 35, 'Creativa': 25, 'Estratégica': 15 };
const AUTO_SUBE = ['excel', 'planilla', 'copiar', 'pegar', 'descargar', 'consolidar', 'completar formulario', 'carga manual', 'copiar dato', 'tipear', 'digitar', 'plantilla'];
const AUTO_BAJA = ['decisio', 'negociacion', 'estrateg', 'roadmap', 'liderar', 'disenar estrategia'];
export const VALOR_POR_CATEGORIA = { 'Estratégica': 'Muy alto', 'Analítica': 'Alto', 'Creativa': 'Alto', 'Automatización': 'Alto',
  'Gestión': 'Medio', 'Comunicación': 'Medio', 'Control': 'Medio', 'Operativa': 'Medio',
  'Documentación': 'Bajo', 'Administrativa': 'Bajo', 'Repetitiva': 'Bajo' };
export const NIVELES_VALOR = ['Bajo', 'Medio', 'Alto', 'Muy alto'];

export function automatizacion(texto, categoria) {
  const n = norm(texto);
  let score = AUTO_BASE[categoria] ?? 40;
  if (AUTO_SUBE.some((k) => n.includes(k))) score = Math.max(score, 90);
  if (AUTO_BAJA.some((k) => n.includes(k))) score = Math.min(score, 20);
  const nivel = score >= 80 ? 'Muy alto' : score >= 60 ? 'Alto' : score >= 40 ? 'Medio' : score >= 20 ? 'Bajo' : 'Nulo';
  return { score, nivel };
}
export function herramientaPara(texto, categoria) {
  const n = norm(texto);
  if (/correo|mail|consulta|comunicar/.test(n)) return 'ChatGPT';
  if (/estrateg|redact|propuesta|contenido|disen/.test(n)) return 'Claude';
  if (/reporte|informe|indicador|dashboard|tablero|kpi/.test(n)) return 'Power BI';
  if (/planilla|excel|consolidar|copiar dato/.test(n)) return 'Power Query';
  if (/carga manual|descarga|automatiz|rpa/.test(n)) return 'n8n';
  if (/analisis|analizar|proyeccion|datos masivos/.test(n)) return 'Python';
  if (categoria === 'Documentación' || categoria === 'Administrativa') return 'Excel';
  if (categoria === 'Control') return 'Power Query';
  if (categoria === 'Gestión') return 'ChatGPT';
  return 'Otras';
}
export function recomendacionPara(texto, herramienta, nivel) {
  const n = norm(texto);
  if (n.includes('planilla')) return 'Usar Power Query para automatizar la actualización.';
  if (n.includes('consulta')) return 'Crear un asistente para responder las consultas frecuentes.';
  if (n.includes('buscar informacion')) return 'Armar una base documental con IA para búsquedas rápidas.';
  if (n.includes('reporte') || n.includes('informe')) return 'Automatizar la generación con Power BI.';
  if (n.includes('control document')) return 'Digitalizar y validar documentos con OCR e IA.';
  if (n.includes('carga manual')) return 'Automatizar la carga con n8n.';
  if (n.includes('consolidar')) return 'Crear un flujo automático de consolidación de datos.';
  const conHerr = herramienta && herramienta !== 'Otras';
  if (nivel === 'Muy alto' || nivel === 'Alto') return conHerr ? `Evaluar la automatización con ${herramienta}.` : 'Evaluar si se puede automatizar o delegar.';
  if (nivel === 'Medio') return conHerr ? `Estandarizar el proceso con apoyo de ${herramienta}.` : 'Estandarizar el proceso con una plantilla o procedimiento.';
  return 'Mantener el enfoque actual: requiere criterio y decisión humana.';
}

// Tareas únicas del período (misma clave de tarea = misma actividad), con su evaluación
export function tareasUnicas(rows, nSemanas = 1) {
  const m = new Map();
  for (const r of rows) {
    if (!r.tarea) continue;
    const k = claveTarea(r.tarea) || norm(r.tarea);
    if (!m.has(k)) m.set(k, { clave: k, textos: new Map(), personas: new Set(), veces: 0, horas: 0, porPersonaSemana: new Map() });
    const e = m.get(k);
    e.textos.set(r.tarea, (e.textos.get(r.tarea) || 0) + 1);
    e.personas.add(r.persona); e.veces++; e.horas += r.horas || 0;
    const ps = `${r.persona}|${r.semana}`; e.porPersonaSemana.set(ps, (e.porPersonaSemana.get(ps) || 0) + 1);
  }
  const semanas = Math.max(1, nSemanas);
  return [...m.values()].map((e) => {
    const tarea = [...e.textos].sort((a, b) => b[1] - a[1])[0][0];
    const repetida = [...e.porPersonaSemana.values()].some((v) => v > 1);
    const categoria = clasificar(tarea, repetida);
    const auto = automatizacion(tarea, categoria);
    const herramienta = herramientaPara(tarea, categoria);
    return { clave: e.clave, tarea, personas: [...e.personas], veces: e.veces, horas: e.horas, horasSemana: e.horas / semanas,
      repetida, categoria, auto, valor: VALOR_POR_CATEGORIA[categoria] || 'Medio', herramienta,
      recomendacion: recomendacionPara(tarea, herramienta, auto.nivel),
      recuperableSemana: (e.horas / semanas) * (auto.score / 100) * MEJORAS.factorRecuperable };
  });
}

// Tareas similares hechas por distintas personas (misma clave o ≥ 2 palabras y ≥ 60% en común)
export function tareasEntrePersonas(unicas) {
  const n = unicas.length, padre = unicas.map((_, i) => i);
  const raiz = (x) => { while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; } return x; };
  const toks = unicas.map((t) => new Set(t.clave.split(' ').filter(Boolean)));
  for (let i = 0; i < n; i++) {
    if (!toks[i].size) continue;
    for (let j = i + 1; j < n; j++) {
      if (!toks[j].size) continue;
      let inter = 0; for (const w of toks[i]) if (toks[j].has(w)) inter++;
      // al menos 2 palabras en común y ≥ 60% de la tarea más larga: evita encadenar tareas distintas
      if (inter >= 2 && inter / Math.max(toks[i].size, toks[j].size) >= 0.6) { const a = raiz(i), b = raiz(j); if (a !== b) padre[a] = b; }
    }
  }
  const grupos = new Map();
  unicas.forEach((t, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(t); });
  return [...grupos.values()].map((ts) => {
    const personas = [...new Set(ts.flatMap((t) => t.personas))];
    const veces = sum(ts, (t) => t.veces), horasSemana = sum(ts, (t) => t.horasSemana);
    const autoProm = sum(ts, (t) => t.auto.score) / ts.length;
    const tarea = [...ts].sort((a, b) => b.veces - a.veces)[0].tarea;
    const recomendacion = personas.length >= 3 ? 'Centralizar el proceso en un responsable o en una plantilla compartida.'
      : autoProm >= 70 ? 'Automatizar la tarea con herramientas de IA o RPA.' : 'Crear un procedimiento y una plantilla estándar compartida.';
    return { tarea, personas, veces, horasSemana, recomendacion };
  }).filter((g) => g.personas.length >= 2).sort((a, b) => b.horasSemana - a.horasSemana || b.veces - a.veces);
}

// Perfil de cada persona: horas por categoría y señales (sobrecarga, exceso administrativo, etc.)
export function perfilesMejora(rows, nSemanas = 1) {
  const semanas = Math.max(1, nSemanas);
  return [...groupBy(rows.filter((r) => r.tarea), (r) => r.persona)].map(([persona, rs]) => {
    const unicas = tareasUnicas(rs, semanas);
    const horasCat = {}; unicas.forEach((t) => { horasCat[t.categoria] = (horasCat[t.categoria] || 0) + t.horasSemana; });
    const horasSemana = sum(rs, (r) => r.horas) / semanas;
    const jornada = Number(rs[0].jornada) || CONFIG.jornada;
    const ocup = (horasSemana / jornada) * 100;
    const admin = (horasCat.Administrativa || 0) + (horasCat['Documentación'] || 0) + (horasCat.Control || 0);
    const senales = [];
    if (ocup > CONFIG.ocupAlta) senales.push(['Sobrecarga', 'crit']);
    if (ocup > 0 && ocup < 45) senales.push(['Infrautilización', 'warn']);
    if (horasSemana > 0 && admin / horasSemana > 0.5) senales.push(['Exceso administrativo', 'warn']);
    if (!unicas.some((t) => t.categoria === 'Estratégica') && unicas.length >= 5) senales.push(['Sin tareas estratégicas', 'info']);
    if (!senales.length) senales.push(['Carga equilibrada', 'ok']);
    const recuperable = sum(unicas, (t) => t.recuperableSemana);
    const altaAuto = unicas.filter((t) => t.auto.score >= 70);
    const horasRep = sum(unicas.filter((t) => t.repetida), (t) => t.horasSemana);
    const dias = new Set(rs.map((r) => `${r.semana}|${diaDe(r)}`)).size / semanas;
    const fortalezas = [], oportunidades = [];
    if (dias >= 5) fortalezas.push('Buena distribución de actividades a lo largo de la semana.');
    if (unicas.length && unicas.filter((t) => t.valor === 'Alto' || t.valor === 'Muy alto').length / unicas.length > 0.4) fortalezas.push('Alta participación en tareas de valor agregado alto o muy alto.');
    if (ocup >= 60 && ocup <= CONFIG.ocupAlta) fortalezas.push('Carga horaria dentro de parámetros saludables.');
    if (!fortalezas.length) fortalezas.push('Cumple con la planificación semanal registrada.');
    if (horasRep > 0) oportunidades.push(`Automatizar o consolidar tareas repetitivas (${round1(horasRep)} h por semana).`);
    if (altaAuto.length) oportunidades.push(`Aplicar herramientas de IA en ${altaAuto.length} ${altaAuto.length === 1 ? 'actividad' : 'actividades'} con alto potencial de automatización.`);
    if (ocup > CONFIG.ocupAlta) oportunidades.push('Redistribuir tareas para reducir el riesgo de sobrecarga.');
    if (!oportunidades.length) oportunidades.push('Mantener el esquema actual y monitorear los indicadores.');
    return { persona, area: rs[0].area, horasSemana, ocup, horasCat, senales, recuperable, fortalezas, oportunidades,
      herramientas: [...new Set(altaAuto.map((t) => t.herramienta).filter((x) => x !== 'Otras'))].slice(0, 5) };
  }).sort((a, b) => b.recuperable - a.recuperable);
}

export function analisisMejoras(rows, nSemanas = 1) {
  const unicas = tareasUnicas(rows, nSemanas);
  const horasSem = sum(unicas, (t) => t.horasSemana);
  const autoPond = horasSem > 0 ? sum(unicas, (t) => t.horasSemana * t.auto.score) / horasSem : (unicas.length ? sum(unicas, (t) => t.auto.score) / unicas.length : 0);
  const indice = Math.max(0, Math.min(100, Math.round(100 - autoPond)));
  const interpretacion = indice >= 90 ? 'Excelente utilización del tiempo' : indice >= 75 ? 'Muy buena utilización, con pequeñas oportunidades'
    : indice >= 60 ? 'Existen oportunidades importantes de mejora' : indice >= 40 ? 'Muchas tareas repetitivas o poco eficientes' : 'Gran potencial de automatización disponible';
  const automatizables = unicas.filter((t) => t.auto.score >= MEJORAS.umbralAutomatizable);
  const recuperableSemana = sum(unicas, (t) => t.recuperableSemana);
  const cuenta = (arr, f) => { const c = {}; arr.forEach((x) => { const k = f(x); c[k] = (c[k] || 0) + 1; }); return c; };
  const valores = cuenta(unicas, (t) => t.valor);
  const herr = cuenta(automatizables, (t) => t.herramienta);
  const horasCategoria = {}; unicas.forEach((t) => { horasCategoria[t.categoria] = (horasCategoria[t.categoria] || 0) + t.horasSemana; });
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    unicas, indice, interpretacion, recuperableSemana,
    automatizables: automatizables.length, pctAutomatizable: unicas.length ? (automatizables.length / unicas.length) * 100 : null,
    valorPredominante: top(valores), herramientaTop: top(herr), valores, herramientas: herr, horasCategoria,
    recomendaciones: [...unicas].sort((a, b) => b.horasSemana * b.auto.score - a.horasSemana * a.auto.score).slice(0, 20),
    entrePersonas: tareasEntrePersonas(unicas).slice(0, 20),
    pctAdministrativo: unicas.length ? (unicas.filter((t) => t.categoria === 'Administrativa' || t.categoria === 'Documentación').length / unicas.length) * 100 : null,
  };
}

// =====================================================================
// Tareas repetitivas (hoja del dashboard anterior): misma tarea más de una vez
// para la misma persona en una misma semana. Usa la misma clave de tarea del motor.
// "veces" y "semanas" se cuentan sobre todo el período filtrado.
// =====================================================================
export function tareasRepetitivas(rows) {
  const porPersona = [];
  for (const [persona, rs] of groupBy(rows.filter((r) => r.tarea), (r) => r.persona)) {
    const tareas = [];
    for (const [, ts] of groupBy(rs, (r) => claveTarea(r.tarea) || norm(r.tarea))) {
      // repetitiva = más de una vez en una misma semana (como en el dashboard anterior)
      const porSemana = groupBy(ts, (t) => t.semana);
      if (![...porSemana.values()].some((x) => x.length > 1)) continue;
      const conHoras = ts.filter((t) => t.horas > 0);
      const horas = sum(conHoras, (t) => t.horas);
      const textos = [...groupBy(ts, (t) => t.tarea)].sort((a, b) => b[1].length - a[1].length);
      tareas.push({ tarea: textos[0][0], veces: ts.length, semanas: new Set(ts.map((t) => t.semana)).size,
        horas, horasPorVez: conHoras.length ? horas / conHoras.length : null });
    }
    tareas.sort((a, b) => b.veces - a.veces || b.horas - a.horas);
    porPersona.push({ persona, area: rs[0].area, tareas, horas: sum(tareas, (t) => t.horas) });
  }
  porPersona.sort((a, b) => b.tareas.length - a.tareas.length || b.horas - a.horas);
  return {
    porPersona,
    personasConRepetitivas: porPersona.filter((p) => p.tareas.length).length,
    personas: porPersona.length,
    tareasDistintas: sum(porPersona, (p) => p.tareas.length),
    horas: sum(porPersona, (p) => p.horas),
  };
}

// =====================================================================
// Recomendaciones contextuales (reemplazan "Propuestas de mejoras" e "IA")
// ctx: { rows, prevStats?, rangeRows?, alcance: 'semana'|'persona', persona? }
// =====================================================================
export function recomendaciones({ rows, rangeRows = [], persona = null }) {
  const out = [];
  const base = persona ? rows.filter((r) => r.persona === persona) : rows;
  if (!base.length) return out;
  const stats = statsPersonas(rows);

  // Redistribución de carga (solo tiene sentido mirando al equipo)
  const sobre = stats.filter((p) => p.ocupacion > CONFIG.ocupAlta && (!persona || p.persona === persona));
  for (const p of sobre) {
    const libre = stats.filter((q) => q.area === p.area && q.persona !== p.persona && q.ocupacion < 70)
      .sort((a, b) => a.ocupacion - b.ocupacion)[0];
    const exceso = p.horas - p.jornada;
    out.push({
      texto: libre ? `Pasar parte de las tareas de ${p.persona} (${round1(exceso)} h por encima de la jornada) a ${libre.persona}, que tiene ${round1(libre.horas)} h planificadas.`
                   : `Revisar la planificación de ${p.persona}: supera la jornada en ${round1(exceso)} h y no hay otra persona del área con capacidad libre.`,
      motivo: 'Sobrecarga', modulo: 'personas',
    });
  }

  const conEstado = pct(base.filter((r) => estadoDe(r) !== 'Sin estado').length, base.length);
  if (conEstado < CONFIG.coberturaMin)
    out.push({ texto: `Completar la columna Estado del Excel: hoy solo el ${Math.round(conEstado)}% de las actividades${persona ? ` de ${persona}` : ''} tiene estado, y el cumplimiento se calcula sobre ese porcentaje.`,
      motivo: 'Cobertura de seguimiento', modulo: 'riesgos' });

  const semanasBase = [...new Set(base.map((r) => r.semana))];
  const conReal = [...new Set(base.map((r) => r.personaId))].filter((id) => semanasBase.some((s) => CTX.reales.has(`${s}|${id}`))).length;
  if (conReal === 0)
    out.push({ texto: `Cargar las horas reales de la semana${persona ? ` de ${persona}` : ' de cada persona'} en Personas: es un solo número por persona y permite medir el desvío frente a lo planificado.`,
      motivo: 'Plan vs real', modulo: 'personas' });

  const hTot = sum(base, (r) => r.horas);
  const hAlta = sum(base.filter((r) => r.prioridad === 'Alta'), (r) => r.horas);
  if (hTot > 0 && hAlta / hTot > CONFIG.altaShareMax)
    out.push({ texto: `Revisar el criterio de prioridades: el ${Math.round((hAlta / hTot) * 100)}% de las horas está marcado como Alta.`,
      motivo: 'Prioridades', modulo: 'planificacion' });

  const sinEvaluar = new Set(base.filter((r) => tieneRiesgo(r) && !nivelDe(r)).map((r) => claveRiesgo(r.personaId, r.riesgos))).size;
  if (sinEvaluar >= 3)
    out.push({ texto: `Evaluar probabilidad e impacto de ${sinEvaluar} riesgos declarados que todavía no tienen nivel. Cada evaluación se aplica sola en las semanas siguientes.`,
      motivo: 'Riesgos declarados', modulo: 'riesgos' });

  const rangeBase = persona ? rangeRows.filter((r) => r.persona === persona) : rangeRows;
  const rec = recurrentesPeriodo(rangeBase).filter((t) => AUTOMATIZABLE.has(t.categoria) && t.horasSemana >= 1).slice(0, 2);
  for (const t of rec)
    out.push({ texto: `Estandarizar o automatizar "${recortar(t.tarea, 70)}": aparece en ${t.semanas} semanas y consume ${round1(t.horasSemana)} h por semana${t.personas.length > 1 ? ` entre ${t.personas.length} personas` : ''}.`,
      motivo: 'Tareas recurrentes', modulo: 'mejoras' });

  const pers = riesgosPersistentes(rangeBase).filter((x) => x.semanas >= 3).slice(0, 1);
  for (const x of pers)
    out.push({ texto: `Definir una acción para el riesgo "${recortar(x.riesgo, 70)}": se declara hace ${x.semanas} semanas.`,
      motivo: 'Riesgo persistente', modulo: 'riesgos' });

  return out;
}

// ---------- fechas ----------
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export function lunesDe(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}
export function recortar(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s || ''; }

// =====================================================================
// Cumplimiento de carga: semanas con planificación sobre el total
// registros: [{ semana: 'YYYY-MM-DD', persona, area }] (una fila por persona y semana con actividades)
// semanas: ['YYYY-MM-DD', ...] en orden; la primera es la semana 1
// =====================================================================
export function nivelSemaforo(p) {
  if (p === null || p === undefined) return null;
  if (p < 25) return 'rojo';
  if (p < 50) return 'naranja';
  if (p < 75) return 'amarillo';
  return 'verde';
}

export function cumplimientoCarga(registros, semanas) {
  const idx = new Map(semanas.map((s, i) => [s, i]));
  const porPersona = new Map();
  for (const r of registros) {
    if (!idx.has(r.semana)) continue;
    if (!porPersona.has(r.persona)) porPersona.set(r.persona, { persona: r.persona, area: r.area, marcas: semanas.map(() => false) });
    porPersona.get(r.persona).marcas[idx.get(r.semana)] = true;
  }
  const total = semanas.length;
  const personas = [...porPersona.values()].map((p) => {
    const conPlan = p.marcas.filter(Boolean).length;
    const pct = total ? (conPlan / total) * 100 : null;
    return { ...p, conPlan, total, pct, nivel: nivelSemaforo(pct) };
  }).sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
  return { semanas: semanas.map((inicio, i) => ({ numero: i + 1, inicio })), personas };
}
