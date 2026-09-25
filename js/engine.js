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
  if (/pendient|no cumpl|incumpl|incomplet|atrasad|demorad|no realizad|cancelad|sin avance/.test(t)) return 'Pendiente';
  if (/proceso|parcial|en curso|avanzad/.test(t)) return 'En curso';
  if (/cumplid|complet|realizad|finaliz|\bok\b|\bsi\b|hecho|terminad|entregad|enviad|actualizad|cerrad/.test(t)) return 'Cumplida';
  return 'Otro';
}
const ESTADO_SCORE = { Cumplida: 1, 'En curso': 0.5, Pendiente: 0 };
export const ESTADOS = ['Cumplida', 'En curso', 'Pendiente', 'Otro', 'Sin estado'];

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
    const conReal = rs.filter((r) => r.real !== null && r.real !== undefined);
    const planConReal = sum(conReal, (r) => r.horas);
    const realTotal = sum(conReal, (r) => r.real);
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
      ocupacion: pct(horas / nSem, CONFIG.jornada),
      semanas: nSem,
      cumplimiento: puntuables.length ? (sum(puntuables) / puntuables.length) * 100 : null,
      cobertura: pct(conEstado.length, rs.length),
      pendientes: rs.filter((r) => estadoDe(r) === 'Pendiente'),
      horasReales: conReal.length ? realTotal : null,
      desvio: conReal.length ? realTotal - planConReal : null,
      desvioPct: conReal.length && planConReal > 0 ? ((realTotal - planConReal) / planConReal) * 100 : null,
      coberturaReal: pct(conReal.length, rs.length),
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
      add('sobrecarga', 'critica', p, `${round1(p.horas)} h planificadas (${Math.round(p.ocupacion)}% de ${CONFIG.jornada} h)`,
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
  { id: 'sin_estado', nombre: 'Sin estado', grave: false, porque: 'Sin estado no se puede medir el cumplimiento.', test: (r) => estadoDe(r) === 'Sin estado' },
];

export function auditoria(rows, semanaInicio) {
  const ctx = { semana: semanaInicio, semanaFin: semanaInicio ? addDays(semanaInicio, 6) : null };
  return REGLAS_AUDITORIA.map((regla) => {
    const items = rows.filter((r) => regla.test(r, ctx));
    const personas = [...groupBy(items, (r) => r.persona)].map(([p, rs]) => ({ persona: p, cantidad: rs.length }))
      .sort((a, b) => b.cantidad - a.cantidad);
    return { ...regla, items, personas, pct: pct(items.length, rows.length) };
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
    const conReal = rs.filter((r) => r.real !== null && r.real !== undefined);
    const plan = sum(conReal, (r) => r.horas);
    return {
      semana: s, ...k,
      riesgos: rs.filter(tieneRiesgo).length,
      horasReales: conReal.length ? sum(conReal, (r) => r.real) : null,
      desvioPct: conReal.length && plan > 0 ? ((sum(conReal, (r) => r.real) - plan) / plan) * 100 : null,
      agregadas: cs.filter((c) => c.tipo === 'alta').length,
      modificadas: new Set(cs.filter((c) => c.tipo === 'modificacion' && c.origen === 'excel').map((c) => c.actividadId)).size,
      retiradas: cs.filter((c) => c.tipo === 'retiro').length,
    };
  });
}

// =====================================================================
// Clasificación de actividades (de "Propuestas de mejoras")
// =====================================================================
const CATEGORIAS = [
  ['Automatización', ['automatiz', 'rpa', 'n8n', 'macro', 'script', 'power query', 'power automate']],
  ['Control', ['control', 'revisar', 'revision', 'verificar', 'auditor', 'cheque', 'validar', 'certificad', 'rendicion', 'conciliacion']],
  ['Comunicación', ['reunion', 'llamada', 'correo', 'mail', 'email', 'comunicar', 'consulta']],
  ['Documentación', ['document', 'archivo', 'expediente', 'planilla', 'formulario', 'escane', 'digitaliz', 'completar']],
  ['Analítica', ['analiz', 'analisis', 'indicador', 'kpi', 'reporte', 'informe', 'dashboard', 'tablero', 'estadistic', 'proyeccion', 'presupuesto']],
  ['Estratégica', ['estrateg', 'planificacion', 'plan anual', 'proyecto', 'decisio', 'roadmap', 'negociacion']],
  ['Gestión', ['gestion', 'administrar', 'tramitar', 'seguimiento', 'coordinacion', 'logistic', 'coordinar']],
  ['Administrativa', ['factura', 'pago', 'rrhh', 'sueldo', 'caja', 'viatico', 'compra', 'proveedor', 'orden']],
];
const AUTOMATIZABLE = new Set(['Automatización', 'Documentación', 'Administrativa', 'Control', 'Analítica']);
export function clasificar(texto) {
  const n = norm(texto);
  for (const [cat, kws] of CATEGORIAS) if (kws.some((k) => n.includes(k))) return cat;
  return 'Operativa';
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
    const exceso = p.horas - CONFIG.jornada;
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

  const hTot = sum(base, (r) => r.horas);
  const hAlta = sum(base.filter((r) => r.prioridad === 'Alta'), (r) => r.horas);
  if (hTot > 0 && hAlta / hTot > CONFIG.altaShareMax)
    out.push({ texto: `Revisar el criterio de prioridades: el ${Math.round((hAlta / hTot) * 100)}% de las horas está marcado como Alta.`,
      motivo: 'Prioridades', modulo: 'planificacion' });

  const sinEvaluar = base.filter((r) => tieneRiesgo(r) && !nivelRiesgo(r.riesgoProb, r.riesgoImpacto)).length;
  if (sinEvaluar >= 3)
    out.push({ texto: `Evaluar probabilidad e impacto de ${sinEvaluar} riesgos declarados que todavía no tienen nivel.`,
      motivo: 'Riesgos declarados', modulo: 'riesgos' });

  const rangeBase = persona ? rangeRows.filter((r) => r.persona === persona) : rangeRows;
  const rec = recurrentesPeriodo(rangeBase).filter((t) => AUTOMATIZABLE.has(t.categoria) && t.horasSemana >= 1).slice(0, 2);
  for (const t of rec)
    out.push({ texto: `Estandarizar o automatizar "${recortar(t.tarea, 70)}": aparece en ${t.semanas} semanas y consume ${round1(t.horasSemana)} h por semana${t.personas.length > 1 ? ` entre ${t.personas.length} personas` : ''}.`,
      motivo: 'Tareas recurrentes', modulo: 'evolucion' });

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
