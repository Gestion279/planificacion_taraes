// =====================================================================
// Motor de análisis — única fuente de cálculo de la aplicación.
// Los módulos NO calculan indicadores: consumen estas funciones.
// Todas las funciones reciben actividades normalizadas (ver db.js).
//
// Circuito de gestión que alimenta este motor:
//   planificación → carga por persona y día → situaciones (qué / causa / impacto / acción)
//   → oportunidades (tareas repetitivas, riesgos persistentes…) → propuestas de mejora → resultado
// =====================================================================

export const CONFIG = {
  jornada: 44,            // horas semanales de referencia (se mantiene del dashboard anterior)
  diasHabiles: 5,         // capacidad diaria estimada = jornada semanal / días hábiles
  ocupAlta: 110,          // % de la capacidad SEMANAL que dispara "sobrecarga"
  ocupCritica: 120,       // % de la capacidad semanal crítica
  ocupBaja: 30,           // % de la capacidad semanal por debajo del cual se habla de baja utilización (única definición)
  diaElevada: 100,        // % de la capacidad DIARIA: por encima, carga elevada
  diaSobrecarga: 115,     // % de la capacidad diaria: por encima, sobrecarga
  diaBaja: 50,            // % de la capacidad diaria: por debajo, baja utilización
  horasTareaMax: 8,       // horas de una sola tarea (dato a revisar)
  altaShareMax: 0.75,     // proporción de horas en prioridad Alta
  minTareasRegla: 5,      // mínimo de tareas para aplicar reglas de proporción
  riesgosMax: 5,          // riesgos DISTINTOS declarados por persona en la semana
  recurrenciaSemanas: 3,  // semanas en las que debe aparecer una tarea para ser "recurrente"
  coberturaMin: 50,       // % de actividades con estado para confiar en el cumplimiento
  incompletaMin: 5,       // % de actividades incompletas a partir del cual se informa a Gerencia
  semanasPorMes: 4.33,
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
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

// Áreas en que planificó una persona: una persona puede aparecer en el Excel de más de un área.
export function areasDe(rs) {
  return [...new Set(rs.map((r) => r.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
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

// ---------- clave de tarea: ÚNICA definición de "misma tarea" para repetitivas y propuestas ----------
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
const claveDe = (r) => claveTarea(r.tarea) || norm(r.tarea);

// =====================================================================
// Capacidad y carga diaria (lugar principal: mapa de calor de Planificación)
// =====================================================================
export const capacidadDia = (jornada) => (Number(jornada) || CONFIG.jornada) / CONFIG.diasHabiles;
export const esHabil = (dia) => DIAS.indexOf(dia) < CONFIG.diasHabiles;
// sin = día hábil sin horas · libre = fin de semana sin horas
export function nivelDia(horasDia, cap, dia) {
  if (!horasDia) return esHabil(dia) ? 'sin' : 'libre';
  const p = (horasDia / cap) * 100;
  if (p > CONFIG.diaSobrecarga) return 'sobrecarga';
  if (p > CONFIG.diaElevada) return 'elevada';
  if (p < CONFIG.diaBaja) return 'baja';
  return 'normal';
}
export const NIVELES_DIA = {
  sobrecarga: 'Sobrecarga', elevada: 'Carga elevada', normal: 'Carga normal', baja: 'Baja utilización', sin: 'Sin planificación',
};

// persona → { dias: { Lunes: { horas, rows, nivel } }, capDia, ... }
export function cargaDiaria(rows) {
  const out = new Map();
  for (const [persona, rs] of groupBy(rows, (r) => r.persona)) {
    const jornada = Number(rs[0].jornada) || CONFIG.jornada;
    const cap = capacidadDia(jornada);
    const dias = {};
    DIAS.forEach((d) => { dias[d] = { horas: 0, rows: [] }; });
    rs.forEach((r) => { const d = diaDe(r); if (!dias[d]) dias[d] = { horas: 0, rows: [] }; dias[d].horas += r.horas || 0; dias[d].rows.push(r); });
    Object.entries(dias).forEach(([d, v]) => { v.nivel = d === 'Sin día' ? null : nivelDia(v.horas, cap, d); v.variacion = v.horas ? ((v.horas - cap) / cap) * 100 : null; });
    const total = sum(rs, (r) => r.horas);
    out.set(persona, { persona, personaId: rs[0].personaId, area: areasDe(rs).join(', '), areas: areasDe(rs), jornada, capDia: cap, total,
      ocupacion: pct(total, jornada), dias, rows: rs });
  }
  return out;
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
    // horas reales: total por persona y semana (se cargan en Carga)
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
      area: areasDe(rs).join(', '),
      areas: areasDe(rs),
      actividades: rs.length / nSem,
      horas: horas / nSem,
      jornada,
      capDia: capacidadDia(jornada),
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
      sinHoras: rs.filter((r) => !r.horas).length,
      conRiesgo: rs.filter(tieneRiesgo).length,
      riesgosDistintos: new Set(rs.filter(tieneRiesgo).map((r) => norm(r.riesgos))).size,
      dias: Object.keys(horasDia).filter((d) => d !== 'Sin día').length,
      rows: rs,
    });
  }
  // orden alfabético: el análisis es de situaciones de trabajo, no un ranking de personas
  return out.sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
}

// =====================================================================
// Indicadores de una semana
// =====================================================================
export function kpisSemana(rows) {
  const puntuables = rows.map((r) => ESTADO_SCORE[estadoDe(r)]).filter((v) => v !== undefined);
  const al = alertas(rows);
  const stats = statsPersonas(rows);
  const capacidad = sum(stats, (p) => p.jornada);
  return {
    actividades: rows.length,
    personas: new Set(rows.map((r) => r.persona)).size,
    horas: sum(rows, (r) => r.horas),
    capacidad,
    ocupacion: pct(sum(rows, (r) => r.horas), capacidad),
    sobrecarga: stats.filter((p) => p.ocupacion > CONFIG.ocupAlta).length,
    bajaUtilizacion: stats.filter((p) => p.horas > 0 && p.ocupacion < CONFIG.ocupBaja).length,
    cumplimiento: puntuables.length ? (sum(puntuables) / puntuables.length) * 100 : null,
    cobertura: pct(rows.filter((r) => estadoDe(r) !== 'Sin estado').length, rows.length),
    alertasCriticas: al.filter((a) => a.nivel === 'critica').length,
    alertas: al,
  };
}

// =====================================================================
// Situaciones por persona (detectadas automáticamente — NO son riesgos declarados)
// Cada una se presenta como: QUÉ OCURRE · POSIBLE CAUSA · IMPACTO · ACCIÓN SUGERIDA.
// Si los datos no permiten determinar la causa, se indica "Requiere revisión": no se inventa.
// =====================================================================
export const REQUIERE_REVISION = 'Requiere revisión: los datos cargados no permiten determinar la causa.';
export const REGLAS_ALERTA = {
  sobrecarga: 'Sobrecarga semanal',
  subregistro: 'Baja utilización',
  dia_saturado: 'Día con sobrecarga',
  concentracion_dia: 'Concentración en pocos días',
  prioridad_alta_excesiva: 'Prioridad Alta excesiva',
  alta_sin_tiempo: 'Tareas críticas con poco tiempo',
  incumplimiento: 'Tareas pendientes',
  acumulacion_riesgos: 'Acumulación de riesgos',
};
export const PRIORIDAD_NIVEL = { critica: 'Alta', advertencia: 'Media', info: 'Baja' };

// Tareas que explican la carga de un conjunto de filas (las de más horas primero)
function tareasQueExplican(rs, n = 3) {
  return [...rs].filter((r) => r.horas > 0).sort((a, b) => b.horas - a.horas).slice(0, n)
    .map((r) => `${recortar(r.tarea || 'Sin descripción', 50)} (${round1(r.horas)} h)`).join(', ');
}

export function alertas(rows) {
  const out = [];
  const add = (regla, nivel, p, { que, causa = REQUIERE_REVISION, impacto, accion, dia = null }) =>
    out.push({ regla, nombre: REGLAS_ALERTA[regla], nivel, prioridad: PRIORIDAD_NIVEL[nivel], persona: p.persona, personaId: p.personaId, area: p.area,
      que, causa, impacto, accion, dia, detalle: que, porque: impacto });
  const carga = cargaDiaria(rows);

  for (const p of statsPersonas(rows)) {
    const n = p.rows.length;
    const cd = carga.get(p.persona);
    const diasSobre = Object.entries(cd.dias).filter(([, v]) => v.nivel === 'sobrecarga');
    const diasLibres = Object.entries(cd.dias).filter(([d, v]) => esHabil(d) && (v.nivel === 'baja' || v.nivel === 'sin'));
    const hMediaBaja = p.prioH.Media + p.prioH.Baja;

    if (p.ocupacion > CONFIG.ocupAlta) {
      const causas = [];
      if (diasSobre.length) causas.push(`concentración de horas en ${diasSobre.map(([d]) => d.toLowerCase()).join(', ')}`);
      const largas = p.rows.filter((r) => (r.horas || 0) > CONFIG.horasTareaMax);
      if (largas.length) causas.push(`${plural(largas.length, 'tarea', 'tareas')} de más de ${CONFIG.horasTareaMax} h`);
      const hAltaMedia = p.prioH.Alta + p.prioH.Media;
      if (p.horas > 0 && hAltaMedia / p.horas >= 0.8) causas.push(`el ${Math.round((hAltaMedia / p.horas) * 100)}% de las horas es de prioridad Alta o Media`);
      add('sobrecarga', p.ocupacion > CONFIG.ocupCritica ? 'critica' : 'advertencia', p, {
        que: `${round1(p.horas)} h planificadas sobre una capacidad estimada de ${round1(p.jornada)} h (${Math.round(p.ocupacion)}%).`,
        causa: causas.length ? `${causas.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) : REQUIERE_REVISION,
        impacto: 'Riesgo de incumplimiento o necesidad de reprogramación.',
        accion: hMediaBaja > 0 ? `Evaluar redistribuir o reprogramar tareas de prioridad Media o Baja (${round1(hMediaBaja)} h).` : 'Revisar alcance y plazos de las tareas de prioridad Alta.',
      });
    } else if (p.horas > 0 && p.ocupacion < CONFIG.ocupBaja) {
      add('subregistro', 'info', p, {
        que: `${round1(p.horas)} h planificadas sobre una capacidad estimada de ${round1(p.jornada)} h (${Math.round(p.ocupacion)}%).`,
        causa: p.sinHoras ? `${plural(p.sinHoras, 'actividad no tiene', 'actividades no tienen')} tiempo cargado.` : REQUIERE_REVISION,
        impacto: 'La carga informada puede no reflejar el trabajo real, o existe capacidad disponible.',
        accion: 'Confirmar si la planificación está completa; si hay capacidad libre, considerarla al redistribuir.',
      });
    }

    for (const [dia, v] of diasSobre) {
      add('dia_saturado', 'advertencia', p, {
        dia,
        que: `${dia}: ${round1(v.horas)} h planificadas sobre ${round1(cd.capDia)} h de capacidad diaria (+${Math.round(v.variacion)}%).`,
        causa: `Tareas de mayor duración: ${tareasQueExplican(v.rows)}.`,
        impacto: 'Es difícil completar todo lo planificado ese día.',
        accion: diasLibres.length ? `Reprogramar tareas de prioridad Media o Baja hacia ${diasLibres.slice(0, 2).map(([d]) => d.toLowerCase()).join(' o ')}, con menos carga.` : 'Revisar si alguna tarea puede pasar a otra persona o a la semana siguiente.',
      });
    }
    if (p.dias <= 1 && n > 4)
      add('concentracion_dia', 'advertencia', p, {
        que: `${n} tareas concentradas en ${p.dias} día.`, causa: REQUIERE_REVISION,
        impacto: 'Toda la semana depende de un solo día.', accion: 'Confirmar las fechas cargadas y distribuir las tareas en la semana.',
      });

    const horasAlta = p.prioH.Alta;
    if (n >= CONFIG.minTareasRegla && p.horas > 0 && horasAlta / p.horas > CONFIG.altaShareMax)
      add('prioridad_alta_excesiva', 'info', p, {
        que: `El ${Math.round((horasAlta / p.horas) * 100)}% de las horas está marcado como prioridad Alta.`, causa: REQUIERE_REVISION,
        impacto: 'Si casi todo es prioritario, la prioridad deja de ordenar el trabajo.', accion: 'Acordar con el área un criterio común para la prioridad Alta.',
      });

    // solo tareas con tiempo cargado: la falta de tiempo es un tema de Auditoría
    const altas = p.rows.filter((r) => r.prioridad === 'Alta' && r.horas > 0);
    const hAlta = sum(altas, (r) => r.horas);
    if (altas.length >= 3 && hAlta / altas.length < 0.5)
      add('alta_sin_tiempo', 'info', p, {
        que: `${altas.length} tareas de prioridad Alta con ${round1(hAlta / altas.length)} h promedio.`, causa: REQUIERE_REVISION,
        impacto: 'Las tareas críticas con muy poco tiempo asignado suelen estar subestimadas.', accion: 'Revisar la estimación de tiempo de esas tareas.',
      });

    if (p.pendientes.length) {
      const criticas = p.pendientes.filter((r) => r.prioridad === 'Alta').length;
      const conRiesgo = p.pendientes.filter(tieneRiesgo);
      add('incumplimiento', criticas ? 'critica' : 'advertencia', p, {
        que: `${plural(p.pendientes.length, 'tarea figura', 'tareas figuran')} como pendiente o no cumplida${criticas ? ` (${criticas} de prioridad Alta)` : ''}.`,
        causa: conRiesgo.length ? `Riesgo declarado: ${recortar(conRiesgo[0].riesgos, 90)}${conRiesgo.length > 1 ? ` y ${conRiesgo.length - 1} más` : ''}.` : REQUIERE_REVISION,
        impacto: 'Compromisos de la semana sin terminar: pueden trasladarse a la semana siguiente.',
        accion: criticas ? 'Confirmar nueva fecha y recursos para las tareas de prioridad Alta.' : 'Confirmar si se reprograman o se cancelan.',
      });
    }
    if (p.riesgosDistintos > CONFIG.riesgosMax)
      add('acumulacion_riesgos', 'advertencia', p, {
        que: `${p.riesgosDistintos} riesgos distintos declarados en ${p.conRiesgo} actividades.`, causa: REQUIERE_REVISION,
        impacto: 'Muchos riesgos simultáneos aumentan la probabilidad de desvíos.', accion: 'Evaluar probabilidad e impacto en la Matriz de riesgo.',
      });
  }
  const orden = { critica: 0, advertencia: 1, info: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel] || a.persona.localeCompare(b.persona, 'es'));
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
// Tareas repetitivas — ÚNICA definición (antes había tres distintas).
// Una tarea es repetitiva si cumple al menos un criterio:
//   · frecuencia: la misma persona la planifica más de una vez en una misma semana
//   · recurrencia: aparece en CONFIG.recurrenciaSemanas semanas o más
//   · varias personas: la planifican 2 o más personas
// Lugar principal: Propuestas de mejora (como oportunidad). Planificación solo marca ↻.
// =====================================================================
export function repetitivasSemana(rows) {
  const out = [];
  for (const [k, rs] of groupBy(rows.filter((r) => r.tarea), (r) => `${r.persona}|${claveDe(r)}`)) {
    if (rs.length < 2) continue;
    out.push({ persona: rs[0].persona, tarea: rs[0].tarea, clave: k.split('|').slice(1).join('|'), dias: new Set(rs.map(diaDe)).size, veces: rs.length, horas: sum(rs, (r) => r.horas) });
  }
  return out.sort((a, b) => b.horas - a.horas);
}

export function analisisRepetitivas(rows, nSemanas = 1) {
  const semanas = Math.max(1, nSemanas);
  const out = [];
  for (const [clave, ts] of groupBy(rows.filter((r) => r.tarea), claveDe)) {
    if (!clave) continue;
    const porPersonaSemana = groupBy(ts, (r) => `${r.persona}|${r.semana}`);
    const semSet = new Set(ts.map((r) => r.semana));
    const personas = [...new Set(ts.map((r) => r.persona))].sort((a, b) => a.localeCompare(b, 'es'));
    const criterios = [];
    const maxSemana = Math.max(...[...porPersonaSemana.values()].map((x) => x.length));
    if (maxSemana > 1) criterios.push('frecuencia');
    if (semSet.size >= CONFIG.recurrenciaSemanas) criterios.push('recurrencia');
    if (personas.length >= 2) criterios.push('personas');
    if (!criterios.length) continue;
    const conHoras = ts.filter((r) => r.horas > 0);
    const horas = sum(conHoras, (r) => r.horas);
    const tarea = [...groupBy(ts, (r) => r.tarea)].sort((a, b) => b[1].length - a[1].length)[0][0];
    const categoria = clasificar(tarea, maxSemana > 1);
    const horasSemana = horas / semanas;
    out.push({
      clave, tarea, personas, areas: areasDe(ts), veces: ts.length, semanas: semSet.size, criterios,
      vecesSemana: ts.length / semanas,
      horas, horasSemana,
      horasPorVez: conHoras.length ? horas / conHoras.length : null,
      // potencial BRUTO: horas que hoy consume la tarea. Es un dato, no un ahorro estimado.
      horasMes: horas > 0 ? horasSemana * CONFIG.semanasPorMes : null,
      sinHoras: ts.length - conHoras.length,
      categoria, tipoSugerido: tipoSugerido(tarea, categoria, personas.length),
      rows: ts,
    });
  }
  return out.sort((a, b) => (b.horasMes || 0) - (a.horasMes || 0) || b.veces - a.veces);
}
export const CRITERIOS_REP = { frecuencia: 'Varias veces por semana', recurrencia: 'Se repite entre semanas', personas: 'La hacen varias personas' };

// Tareas similares hechas por distintas personas (misma clave o ≥ 2 palabras y ≥ 60% en común)
export function tareasEntrePersonas(rows, nSemanas = 1) {
  const semanas = Math.max(1, nSemanas);
  const unicas = [...groupBy(rows.filter((r) => r.tarea), claveDe)].map(([clave, rs]) => ({
    clave, rs, personas: new Set(rs.map((r) => r.persona)), veces: rs.length, horasSemana: sum(rs, (r) => r.horas) / semanas,
    tarea: [...groupBy(rs, (r) => r.tarea)].sort((a, b) => b[1].length - a[1].length)[0][0],
  }));
  const n = unicas.length, padre = unicas.map((_, i) => i);
  const raiz = (x) => { while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; } return x; };
  const toks = unicas.map((t) => new Set(t.clave.split(' ').filter(Boolean)));
  for (let i = 0; i < n; i++) {
    if (!toks[i].size) continue;
    for (let j = i + 1; j < n; j++) {
      if (!toks[j].size) continue;
      let inter = 0; for (const w of toks[i]) if (toks[j].has(w)) inter++;
      if (inter >= 2 && inter / Math.max(toks[i].size, toks[j].size) >= 0.6) { const a = raiz(i), b = raiz(j); if (a !== b) padre[a] = b; }
    }
  }
  const grupos = new Map();
  unicas.forEach((t, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(t); });
  return [...grupos.values()].map((ts) => {
    const personas = [...new Set(ts.flatMap((t) => [...t.personas]))].sort((a, b) => a.localeCompare(b, 'es'));
    const principal = [...ts].sort((a, b) => b.veces - a.veces)[0];
    const variantes = ts.length;
    return { tarea: principal.tarea, clave: principal.clave, personas, variantes, veces: sum(ts, (t) => t.veces), horasSemana: sum(ts, (t) => t.horasSemana),
      horasMes: sum(ts, (t) => t.horasSemana) * CONFIG.semanasPorMes };
  }).filter((g) => g.personas.length >= 2 && g.variantes >= 2).sort((a, b) => b.horasSemana - a.horasSemana || b.veces - a.veces);
}

// =====================================================================
// Clasificación por el texto de la tarea (de "Propuestas de mejoras" del dashboard anterior).
// Se usa SOLO para sugerir un tipo de mejora; la decisión la toma quien evalúa la propuesta.
// =====================================================================
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
export function clasificar(texto, repetida = false) {
  const n = norm(texto);
  for (const [cat, kws] of CATEGORIAS) if (kws.some((k) => n.includes(k))) return cat;
  return repetida ? 'Repetitiva' : 'Operativa';
}
const MANUAL = ['copiar', 'pegar', 'descargar', 'consolidar', 'carga manual', 'tipear', 'digitar', 'planilla', 'excel'];
export function tipoSugerido(texto, categoria, nPersonas = 1) {
  const n = norm(texto);
  if (MANUAL.some((k) => n.includes(k)) || ['Automatización', 'Documentación', 'Administrativa'].includes(categoria)) return 'Automatizar';
  if (nPersonas >= 3) return 'Estandarizar';
  if (categoria === 'Analítica') return 'Automatizar';
  if (categoria === 'Control') return 'Simplificar';
  if (categoria === 'Comunicación' || nPersonas >= 2) return 'Estandarizar';
  return null; // sin evidencia suficiente: lo define quien evalúa
}
// Horas de la semana por tipo de tarea (¿en qué se va el tiempo?)
export function horasPorCategoria(rows, nSemanas = 1) {
  const out = {};
  for (const [, rs] of groupBy(rows.filter((r) => r.tarea), claveDe)) {
    const t = rs[0].tarea; const rep = [...groupBy(rs, (r) => `${r.persona}|${r.semana}`).values()].some((x) => x.length > 1);
    const c = clasificar(t, rep); out[c] = (out[c] || 0) + sum(rs, (r) => r.horas) / Math.max(1, nSemanas);
  }
  return out;
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
// Prioridad de tratamiento según el nivel de riesgo
export const PRIORIDAD_RIESGO = { 'crítico': 'Inmediata', alto: 'Alta', moderado: 'Media', bajo: 'Baja' };
export const claveRiesgo = (personaId, riesgo) => `${personaId}|${norm(riesgo)}`;
// La evaluación se guarda por persona + texto del riesgo: se hereda en todas las semanas
export const evaluacionDe = (r) => CTX.riesgos.get(claveRiesgo(r.personaId, r.riesgos)) || {};
export const nivelDe = (r) => { const e = evaluacionDe(r); return nivelRiesgo(e.prob, e.impacto); };

// Riesgos declarados que se repiten entre semanas
export function riesgosPersistentes(rows) {
  const out = [];
  for (const [, rs] of groupBy(rows.filter(tieneRiesgo), (r) => norm(r.riesgos))) {
    const semanas = [...new Set(rs.map((r) => r.semana))].sort();
    if (semanas.length < 2) continue;
    out.push({ riesgo: rs[0].riesgos, semanas: semanas.length, desde: semanas[0], hasta: semanas[semanas.length - 1],
      personas: [...new Set(rs.map((r) => r.persona))], veces: rs.length });
  }
  return out.sort((a, b) => b.semanas - a.semanas || b.veces - a.veces);
}

// Tareas que siguen abiertas (Pendiente o En curso) en varias semanas, hasta la semana indicada
export function tareasAbiertas(rows, hasta) {
  const out = [];
  for (const [, rs] of groupBy(rows.filter((r) => r.tarea && ['Pendiente', 'En curso'].includes(estadoDe(r))), (r) => `${r.persona}|${claveDe(r)}`)) {
    const semanas = [...new Set(rs.map((r) => r.semana))].sort();
    if (semanas.length < 2 || semanas.at(-1) !== hasta) continue;
    out.push({ persona: rs[0].persona, area: rs[0].area, tarea: rs.at(-1).tarea, semanas: semanas.length, desde: semanas[0], prioridad: rs.at(-1).prioridad });
  }
  return out.sort((a, b) => b.semanas - a.semanas);
}

// =====================================================================
// Cobertura de carga: quiénes planificaron alguna vez (hasta la semana) y esta semana no.
// filasPrevias puede ser de actividades o de registros persona-semana: solo usa personaId, persona, area y semana.
// =====================================================================
export function coberturaCarga(filasSemana, filasPrevias) {
  const actuales = new Set(filasSemana.map((r) => r.personaId));
  const habituales = new Map();
  for (const r of [...filasPrevias, ...filasSemana]) {
    if (!habituales.has(r.personaId)) habituales.set(r.personaId, { persona: r.persona, areas: new Set(), ultima: null });
    const h = habituales.get(r.personaId);
    if (r.area) h.areas.add(r.area);
    if (r.semana && (!h.ultima || r.semana > h.ultima)) h.ultima = r.semana;
  }
  const faltan = [...habituales].filter(([id]) => !actuales.has(id))
    .map(([, { areas, ...v }]) => ({ ...v, area: [...areas].sort((a, b) => a.localeCompare(b, 'es')).join(', ') }))
    .sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
  return { habituales: habituales.size, cargaron: actuales.size, faltan };
}

// Áreas cuya PRIMERA carga de la semana llegó después del lunes (inicio de la semana)
export function cargaFueraDeTermino(importaciones, semanaInicio) {
  const primeras = new Map();
  importaciones.filter((i) => i.semana === semanaInicio && i.origen !== 'migracion').forEach((i) => {
    if (!primeras.has(i.area) || i.created_at < primeras.get(i.area)) primeras.set(i.area, i.created_at);
  });
  const limite = `${addDays(semanaInicio, 1)}T00:00:00`; // hasta el lunes inclusive (hora local aproximada)
  return [...primeras].filter(([, ts]) => new Date(ts) >= new Date(limite)).map(([area, ts]) => ({ area, cargada: ts }));
}

// =====================================================================
// Propuestas de mejora (registradas en la base, tabla propuestas_mejora)
// =====================================================================
export const FUENTES_PROPUESTA = ['Planificación', 'Carga', 'Cumplimiento', 'Riesgo', 'Auditoría', 'Tarea repetitiva', 'Otro'];
export const TIPOS_MEJORA = ['Eliminar', 'Simplificar', 'Automatizar', 'Estandarizar', 'Redistribuir', 'Mejorar control', 'Otro'];
export const NIVELES_IE = ['Bajo', 'Medio', 'Alto'];
export const ESTADOS_PROPUESTA = ['Detectada', 'En análisis', 'Propuesta', 'Aprobada', 'En implementación', 'Implementada', 'Descartada'];
export const ESTADOS_ACTIVOS = ['Detectada', 'En análisis', 'Propuesta', 'Aprobada', 'En implementación'];

// Matriz Impacto × Esfuerzo: cuatro grupos de prioridad
export const GRUPOS = {
  quick: { orden: 1, nombre: 'Alta prioridad', sub: 'Alto impacto, bajo esfuerzo', clase: 'g-quick' },
  estrategico: { orden: 2, nombre: 'Proyecto estratégico', sub: 'Alto impacto, requiere planificación', clase: 'g-estrategico' },
  secundaria: { orden: 3, nombre: 'Mejora secundaria', sub: 'Impacto moderado, poco esfuerzo', clase: 'g-secundaria' },
  baja: { orden: 4, nombre: 'Baja prioridad', sub: 'Poco impacto para el esfuerzo', clase: 'g-baja' },
};
// Regla explícita (se muestra en pantalla): el impacto manda; el esfuerzo decide dentro de cada nivel.
export function grupoPropuesta(impacto, esfuerzo) {
  if (!impacto || !esfuerzo) return null;
  if (impacto === 'Alto') return esfuerzo === 'Bajo' ? 'quick' : 'estrategico';
  if (impacto === 'Medio') return esfuerzo === 'Alto' ? 'baja' : 'secundaria';
  return esfuerzo === 'Bajo' ? 'secundaria' : 'baja';
}
export const ordenPropuesta = (p) => (GRUPOS[grupoPropuesta(p.impacto, p.esfuerzo)]?.orden ?? 9);

// Potencial: horas brutas que consume hoy el problema × reducción estimada por quien evalúa.
// La aplicación NUNCA inventa el porcentaje: sin reducción cargada, el potencial queda pendiente.
export function potencialPropuesta(p) {
  const base = Number(p.horas_mes_base) || 0;
  if (!base || p.ahorro_pct === null || p.ahorro_pct === undefined || p.ahorro_pct === '') return null;
  return base * (Number(p.ahorro_pct) / 100);
}

// Resultado medido de una propuesta implementada vinculada a una tarea:
// horas semanales de esa tarea antes y después de la fecha de implementación.
export function resultadoPropuesta(p, rows, semanasISO) {
  if (!p.tarea_clave || !p.fecha_implementacion) return null;
  const corte = lunesDe(p.fecha_implementacion);
  const antes = semanasISO.filter((s) => s < corte), despues = semanasISO.filter((s) => s >= corte);
  if (!antes.length || !despues.length) return { antes: null, despues: null, semanasAntes: antes.length, semanasDespues: despues.length };
  const propias = rows.filter((r) => r.tarea && claveDe(r) === p.tarea_clave);
  const hAntes = sum(propias.filter((r) => r.semana < corte), (r) => r.horas) / antes.length;
  const hDespues = sum(propias.filter((r) => r.semana >= corte), (r) => r.horas) / despues.length;
  return { antes: hAntes, despues: hDespues, semanasAntes: antes.length, semanasDespues: despues.length,
    variacionPct: hAntes > 0 ? ((hDespues - hAntes) / hAntes) * 100 : null };
}

// =====================================================================
// Situaciones que requieren atención (lugar principal: Riesgos y auditoría › Situaciones).
// El Resumen muestra las más importantes. Cada una indica QUÉ OCURRE, POSIBLE CAUSA,
// IMPACTO y ACCIÓN SUGERIDA, con los casos que la componen.
// ctx: { rows, historico, cambios, cobertura, fueraDeTermino, semana, hoy, propuestas }
// =====================================================================
export function hallazgos({ rows, historico = [], cambios = [], cobertura = null, fueraDeTermino = [], semana, hoy = null, propuestas = [] }) {
  const out = [];
  const add = (h) => out.push({ casos: [], enlace: null, tipo: null, ...h });
  const al = alertas(rows);
  const porRegla = groupBy(al, (a) => a.regla);
  const nivelMax = (as) => (as.some((a) => a.nivel === 'critica') ? 'critica' : as.some((a) => a.nivel === 'advertencia') ? 'advertencia' : 'info');
  const personasDe = (as) => new Set(as.map((a) => a.persona)).size;
  const casoDeAlerta = (a) => ({ persona: a.persona, area: a.area, que: a.que, causa: a.causa, impacto: a.impacto, accion: a.accion, prioridad: a.prioridad, dia: a.dia, nivel: a.nivel });

  // ---------- Planificación ----------
  if (cobertura?.faltan.length) {
    const n = cobertura.faltan.length;
    add({ id: 'plan_no_enviada', fuente: 'Planificación', nivel: n / Math.max(1, cobertura.habituales) >= 0.3 ? 'critica' : 'advertencia', tipo: 'Mejorar control',
      titulo: 'Planificación no recibida',
      que: `${n} de ${cobertura.habituales} personas que planifican habitualmente ${n === 1 ? 'no tiene' : 'no tienen'} planificación cargada esta semana.`,
      causa: 'Requiere revisión: puede ser una ausencia (licencia, vacaciones) o una planificación que no se envió.',
      impacto: 'Sin planificación no se puede analizar la carga ni el cumplimiento de esas personas.',
      accion: 'Confirmar con cada área si corresponde y solicitar el Excel faltante.',
      casos: cobertura.faltan.map((f) => ({ persona: f.persona, area: f.area, que: f.ultima ? `Última planificación: semana del ${fechaCortaTxt(f.ultima)}.` : 'Sin planificaciones anteriores.', prioridad: 'Media' })) });
  }
  if (fueraDeTermino.length) {
    add({ id: 'plan_fuera_termino', fuente: 'Planificación', nivel: 'advertencia', tipo: 'Mejorar control', titulo: 'Planificación cargada fuera de término',
      que: `La planificación de ${fueraDeTermino.map((f) => f.area).join(' y ')} se cargó después del inicio de la semana.`,
      causa: REQUIERE_REVISION, impacto: 'La semana empezó sin planificación disponible para el seguimiento.',
      accion: 'Acordar un horario límite de carga (por ejemplo, el viernes previo a la semana).',
      casos: fueraDeTermino.map((f) => ({ persona: f.area, area: '', que: `Primera carga: ${fechaHoraTxt(f.cargada)}.`, prioridad: 'Media' })) });
  }
  const aud = auditoria(rows, semana);
  const reglasInc = ['sin_tarea', 'sin_tiempo', 'sin_prioridad', 'sin_fecha'];
  const incompletas = new Set(aud.filter((r) => reglasInc.includes(r.id)).flatMap((r) => r.items.map((x) => x.id)));
  const pInc = pct(incompletas.size, rows.length);
  if (pInc !== null && pInc >= CONFIG.incompletaMin) {
    const det = aud.filter((r) => reglasInc.includes(r.id) && r.items.length).map((r) => `${r.items.length} ${r.nombre.toLowerCase()}`).join(', ');
    const porPersona = groupBy(rows.filter((r) => incompletas.has(r.id)), (r) => r.persona);
    const top = [...porPersona].sort((a, b) => b[1].length - a[1].length);
    const concentrado = top.length && top.slice(0, 2).reduce((a, [, rs]) => a + rs.length, 0) / incompletas.size >= 0.6;
    add({ id: 'plan_incompleta', fuente: 'Planificación', nivel: pInc >= 20 ? 'critica' : 'advertencia', tipo: 'Estandarizar', titulo: 'Planificación incompleta',
      que: `${incompletas.size} actividades (${Math.round(pInc)}%) tienen datos faltantes: ${det}.`,
      causa: concentrado ? `Se concentra en la planificación de ${top.slice(0, 2).map(([p]) => p).join(' y ')}.` : 'Está distribuido entre varias personas: puede faltar una pauta común para completar el Excel.',
      impacto: 'Las horas y prioridades faltantes impiden medir la carga real y ordenar la semana.',
      accion: 'Completar los campos faltantes en el Excel. El detalle por fila está en Auditoría.',
      enlace: { modulo: 'riesgos', params: { tab: 'auditoria' } },
      casos: top.map(([p, rs]) => ({ persona: p, area: rs[0].area, que: `${plural(rs.length, 'actividad incompleta', 'actividades incompletas')}.`, prioridad: 'Media' })) });
  }

  // ---------- Cumplimiento ----------
  const cob = pct(rows.filter((r) => estadoDe(r) !== 'Sin estado').length, rows.length);
  if (cob !== null && cob < CONFIG.coberturaMin) {
    add({ id: 'cumplimiento_no_medible', fuente: 'Cumplimiento', nivel: cob < 20 ? 'critica' : 'advertencia', tipo: 'Mejorar control', titulo: 'El cumplimiento no se puede medir',
      que: `Solo el ${Math.round(cob)}% de las actividades tiene el Estado informado.`,
      causa: 'La columna Estado del Excel no se completa de forma habitual.',
      impacto: 'No se pueden detectar tareas pendientes ni vencidas, ni saber si lo planificado se cumplió.',
      accion: 'Pedir que cada persona actualice el Estado (Pendiente, En curso, Cumplida o Cancelada) al cierre de la semana.' });
  }
  const pend = porRegla.get('incumplimiento') || [];
  if (pend.length) {
    const filasPend = rows.filter((r) => estadoDe(r) === 'Pendiente');
    const vencidas = hoy ? filasPend.filter((r) => r.fecha && r.fecha < hoy).length : 0;
    const altas = filasPend.filter((r) => r.prioridad === 'Alta').length;
    const conRiesgo = filasPend.filter(tieneRiesgo).length;
    add({ id: 'pendientes', fuente: 'Cumplimiento', nivel: nivelMax(pend), tipo: 'Redistribuir', titulo: 'Tareas pendientes',
      que: `${plural(filasPend.length, 'tarea figura', 'tareas figuran')} como pendiente o no cumplida${vencidas ? `, ${vencidas} con fecha ya pasada` : ''}${altas ? `, ${altas} de prioridad Alta` : ''}.`,
      causa: conRiesgo / filasPend.length >= 0.5 ? 'La mayoría tiene riesgos declarados en el Excel.' : REQUIERE_REVISION,
      impacto: 'Compromisos sin terminar que pueden trasladarse a la semana siguiente.',
      accion: 'Confirmar nueva fecha y recursos, empezando por las de prioridad Alta.',
      casos: pend.map(casoDeAlerta) });
  }
  const repro = new Set(cambios.filter((c) => c.tipo === 'modificacion' && c.campo === 'fecha').map((c) => c.actividadId));
  if (repro.size) {
    const cs = cambios.filter((c) => c.tipo === 'modificacion' && c.campo === 'fecha');
    add({ id: 'reprogramaciones', fuente: 'Cumplimiento', nivel: repro.size >= 5 ? 'advertencia' : 'info', tipo: 'Mejorar control', titulo: 'Reprogramaciones',
      que: `${plural(repro.size, 'tarea cambió', 'tareas cambiaron')} de fecha después de la primera carga.`, causa: REQUIERE_REVISION,
      impacto: 'Las reprogramaciones frecuentes indican una planificación poco realista o imprevistos recurrentes.',
      accion: 'Revisar si responden a imprevistos o a estimaciones optimistas.',
      casos: cs.map((c) => ({ persona: c.persona, area: c.area, que: `"${recortar(c.tarea, 60)}": ${c.antes ?? '—'} → ${c.despues ?? '—'}.`, prioridad: 'Baja' })) });
  }
  const abiertas = tareasAbiertas([...historico, ...rows], semana);
  if (abiertas.length) {
    add({ id: 'abiertas', fuente: 'Cumplimiento', nivel: abiertas.some((a) => a.semanas >= 3) ? 'advertencia' : 'info', tipo: 'Simplificar', titulo: 'Tareas abiertas durante varias semanas',
      que: `${plural(abiertas.length, 'tarea sigue', 'tareas siguen')} en estado Pendiente o En curso desde semanas anteriores (hasta ${Math.max(...abiertas.map((a) => a.semanas))} semanas).`,
      causa: REQUIERE_REVISION, impacto: 'Las tareas que no se cierran ocupan capacidad y ocultan bloqueos.',
      accion: 'Revisar bloqueos y definir una fecha de cierre, o descartarlas.',
      casos: abiertas.map((a) => ({ persona: a.persona, area: a.area, que: `"${recortar(a.tarea, 60)}": abierta en ${a.semanas} semanas, desde el ${fechaCortaTxt(a.desde)}.`, prioridad: a.prioridad === 'Alta' ? 'Alta' : 'Media' })) });
  }

  // ---------- Carga ----------
  const sobre = porRegla.get('sobrecarga') || [];
  if (sobre.length) {
    const stats = statsPersonas(rows);
    const areasSobre = new Set(stats.filter((p) => p.ocupacion > CONFIG.ocupAlta).flatMap((p) => p.areas));
    const conCapacidad = stats.filter((p) => p.ocupacion < 70 && p.horas > 0 && p.areas.some((a) => areasSobre.has(a)));
    add({ id: 'sobrecarga', fuente: 'Carga', nivel: nivelMax(sobre), tipo: 'Redistribuir', titulo: 'Sobrecarga',
      que: `${plural(sobre.length, 'persona presenta', 'personas presentan')} una carga superior a su capacidad semanal estimada.`,
      causa: sobre.filter((a) => a.causa !== REQUIERE_REVISION).length >= sobre.length / 2 ? 'En la mayoría de los casos, horas concentradas en días puntuales o tareas de larga duración (ver cada caso).' : REQUIERE_REVISION,
      impacto: 'Riesgo de incumplimiento o necesidad de reprogramación.',
      accion: conCapacidad.length ? `Evaluar redistribuir tareas de prioridad Media o Baja: en las mismas áreas hay ${plural(conCapacidad.length, 'persona', 'personas')} por debajo del 70% de su capacidad.` : 'Revisar alcance y plazos con los responsables: no hay capacidad disponible en las mismas áreas.',
      enlace: { modulo: 'planificacion' }, casos: sobre.map(casoDeAlerta) });
  }
  const dias = [...(porRegla.get('dia_saturado') || []), ...(porRegla.get('concentracion_dia') || [])];
  if (dias.length) {
    add({ id: 'dias_sobrecarga', fuente: 'Carga', nivel: 'advertencia', tipo: 'Redistribuir', titulo: 'Concentración de carga en días puntuales',
      que: `${plural(dias.length, 'día-persona supera', 'días-persona superan')} la capacidad diaria estimada (${plural(personasDe(dias), 'persona', 'personas')}).`,
      causa: 'Distribución despareja dentro de la semana: cada caso indica las tareas que la generan.',
      impacto: 'Es difícil completar todo lo planificado en esos días.',
      accion: 'Reprogramar tareas de prioridad Media o Baja hacia días con menos carga.',
      enlace: { modulo: 'planificacion' }, casos: dias.map(casoDeAlerta) });
  }
  const baja = porRegla.get('subregistro') || [];
  if (baja.length) {
    add({ id: 'baja_utilizacion', fuente: 'Carga', nivel: 'info', tipo: 'Redistribuir', titulo: 'Baja utilización',
      que: `${plural(baja.length, 'persona tiene', 'personas tienen')} menos del ${CONFIG.ocupBaja}% de su capacidad semanal planificada.`,
      causa: REQUIERE_REVISION, impacto: 'La carga informada puede no reflejar el trabajo real, o existe capacidad disponible.',
      accion: 'Confirmar si la planificación está completa; si hay capacidad libre, considerarla al redistribuir.',
      enlace: { modulo: 'planificacion' }, casos: baja.map(casoDeAlerta) });
  }
  const prio = [...(porRegla.get('prioridad_alta_excesiva') || []), ...(porRegla.get('alta_sin_tiempo') || [])];
  if (prio.length) {
    add({ id: 'criterio_prioridad', fuente: 'Planificación', nivel: 'info', tipo: 'Estandarizar', titulo: 'Criterio de prioridades',
      que: `En la planificación de ${plural(personasDe(prio), 'persona', 'personas')}, la prioridad Alta no ordena el trabajo: casi todo es Alta, o las tareas Alta tienen muy poco tiempo.`,
      causa: REQUIERE_REVISION, impacto: 'Sin un criterio común, la prioridad no sirve para decidir qué hacer primero.',
      accion: 'Acordar por área qué se considera prioridad Alta.', casos: prio.map(casoDeAlerta) });
  }

  // ---------- Riesgos ----------
  const declarados = [...groupBy(rows.filter(tieneRiesgo), (r) => claveRiesgo(r.personaId, r.riesgos))].map(([, rs]) => ({ r: rs[0], nivel: nivelDe(rs[0]) }));
  const altos = declarados.filter((d) => d.nivel === 'alto' || d.nivel === 'crítico');
  if (altos.length) {
    add({ id: 'riesgos_altos', fuente: 'Riesgo', nivel: altos.some((d) => d.nivel === 'crítico') ? 'critica' : 'advertencia', tipo: 'Mejorar control', titulo: 'Riesgos de nivel alto o crítico',
      que: `${plural(altos.length, 'riesgo declarado tiene', 'riesgos declarados tienen')} nivel alto o crítico.`,
      causa: 'Declarados por las personas en la columna Riesgos del Excel.',
      impacto: 'Pueden afectar el cumplimiento de las tareas asociadas.',
      accion: 'Definir una acción de mitigación y un responsable para cada uno.',
      enlace: { modulo: 'riesgos', params: { tab: 'riesgos' } },
      casos: altos.map((d) => ({ persona: d.r.persona, area: d.r.area, que: recortar(d.r.riesgos, 110), causa: `Tarea: ${recortar(d.r.tarea, 60)}`, impacto: `Nivel ${d.nivel}`, prioridad: PRIORIDAD_RIESGO[d.nivel] })) });
  }
  const persist = riesgosPersistentes([...historico, ...rows]).filter((x) => x.semanas >= CONFIG.recurrenciaSemanas && x.hasta === semana);
  if (persist.length) {
    add({ id: 'riesgos_persistentes', fuente: 'Riesgo', nivel: 'advertencia', tipo: 'Otro', titulo: 'Riesgos que se repiten',
      que: `${plural(persist.length, 'riesgo se declara', 'riesgos se declaran')} desde hace ${CONFIG.recurrenciaSemanas} semanas o más.`,
      causa: 'Riesgos que no se resuelven de una semana a otra: posible problema estructural.',
      impacto: 'Afectan de forma sostenida la planificación de las personas involucradas.',
      accion: 'Tratarlos como problema de fondo: evaluar una propuesta de mejora.',
      casos: persist.map((x) => ({ persona: x.personas.join(', '), area: '', que: recortar(x.riesgo, 110), causa: `${x.semanas} semanas, desde el ${fechaCortaTxt(x.desde)}`, prioridad: 'Media' })) });
  }
  const sinEval = declarados.filter((d) => !d.nivel);
  if (sinEval.length >= 3) {
    add({ id: 'riesgos_sin_evaluar', fuente: 'Riesgo', nivel: 'info', tipo: 'Mejorar control', titulo: 'Riesgos sin evaluar',
      que: `${sinEval.length} riesgos declarados todavía no tienen probabilidad e impacto.`, causa: 'Falta completar la evaluación en la Matriz de riesgo.',
      impacto: 'No se puede priorizar qué riesgos atender primero.', accion: 'Asignar probabilidad e impacto: la evaluación se aplica sola en las semanas siguientes.',
      enlace: { modulo: 'riesgos', params: { tab: 'riesgos' } } });
  }
  const acum = porRegla.get('acumulacion_riesgos') || [];
  if (acum.length) {
    add({ id: 'acumulacion_riesgos', fuente: 'Riesgo', nivel: 'advertencia', tipo: 'Mejorar control', titulo: 'Acumulación de riesgos',
      que: `${plural(acum.length, 'persona declara', 'personas declaran')} más de ${CONFIG.riesgosMax} riesgos distintos en la semana.`, causa: REQUIERE_REVISION,
      impacto: 'Muchos riesgos simultáneos aumentan la probabilidad de desvíos.', accion: 'Evaluarlos en la Matriz de riesgo y definir cuáles atender.',
      enlace: { modulo: 'riesgos', params: { tab: 'riesgos' } }, casos: acum.map(casoDeAlerta) });
  }

  // ---------- Organización ----------
  const dup = aud.find((r) => r.id === 'posible_duplicado');
  if (dup && dup.items.length >= 3) {
    add({ id: 'duplicados', fuente: 'Auditoría', nivel: 'info', tipo: 'Estandarizar', titulo: 'Posibles tareas duplicadas',
      que: `${dup.items.length} actividades repiten la misma tarea, persona y día.`, causa: REQUIERE_REVISION,
      impacto: 'Las horas duplicadas inflan la carga informada.', accion: 'Unificar las filas repetidas en el Excel.',
      enlace: { modulo: 'riesgos', params: { tab: 'auditoria', regla: 'posible_duplicado' } } });
  }
  const conPropuesta = new Set(propuestas.filter((p) => p.tarea_clave).map((p) => p.tarea_clave));
  const nSemHist = new Set([...historico, ...rows].map((r) => r.semana)).size;
  const rep = analisisRepetitivas([...historico, ...rows], nSemHist).filter((t) => t.horasMes >= 4 && t.tipoSugerido && !conPropuesta.has(t.clave));
  if (rep.length) {
    add({ id: 'repetitivas', fuente: 'Tarea repetitiva', nivel: 'info', tipo: null, titulo: 'Tareas repetitivas con potencial de mejora',
      que: `${plural(rep.length, 'tarea se repite', 'tareas se repiten')} de forma habitual y ${rep.length === 1 ? 'consume' : 'suman'} ${round1(sum(rep, (t) => t.horasMes))} h por mes.`,
      causa: 'Trabajo recurrente de tipo manual, administrativo o compartido, sin una propuesta de mejora registrada.',
      impacto: 'Son las primeras candidatas a eliminar, simplificar, automatizar o estandarizar.',
      accion: 'Evaluarlas en Propuestas de mejora, empezando por las de más horas.',
      enlace: { modulo: 'mejoras' },
      casos: rep.slice(0, 10).map((t) => ({ persona: t.personas.length > 2 ? `${t.personas.length} personas` : t.personas.join(', '), area: t.areas.join(', '), que: `"${recortar(t.tarea, 70)}": ${round1(t.vecesSemana)} veces por semana, ${round1(t.horasMes)} h/mes.`, prioridad: 'Baja' })) });
  }

  const orden = { critica: 0, advertencia: 1, info: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

// =====================================================================
// Serie semanal para Evolución: ¿estamos mejorando?
// =====================================================================
export function serieSemanal(rows, cambios, semanas, propuestas = []) {
  const porSemana = groupBy(rows, (r) => r.semana);
  const cambiosPorSemana = groupBy(cambios || [], (c) => c.semana);
  return semanas.map((s) => {
    const rs = porSemana.get(s) || [];
    const k = kpisSemana(rs);
    const cs = cambiosPorSemana.get(s) || [];
    const personasReal = [...new Set(rs.map((r) => r.personaId))].filter((id) => CTX.reales.has(`${s}|${id}`));
    const real = sum(personasReal, (id) => CTX.reales.get(`${s}|${id}`));
    const plan = sum(rs.filter((r) => personasReal.includes(r.personaId)), (r) => r.horas);
    // distribución de días-persona hábiles por nivel de carga
    const niveles = { sobrecarga: 0, elevada: 0, normal: 0, baja: 0, sin: 0 };
    for (const p of cargaDiaria(rs).values()) DIAS.slice(0, CONFIG.diasHabiles).forEach((d) => { const n = p.dias[d].nivel; if (n in niveles) niveles[n]++; });
    const diasPersona = Object.values(niveles).reduce((a, b) => a + b, 0);
    const declarados = [...groupBy(rs.filter(tieneRiesgo), (r) => claveRiesgo(r.personaId, r.riesgos)).values()].map((x) => nivelDe(x[0]));
    const fin = addDays(s, 6);
    return {
      semana: s, ...k,
      niveles, diasPersona,
      pctDiasNormales: pct(niveles.normal + niveles.elevada, diasPersona),
      riesgos: declarados.length,
      riesgosAltos: declarados.filter((n) => n === 'alto' || n === 'crítico').length,
      horasRepetidas: sum(repetitivasSemana(rs), (t) => t.horas),
      horasReales: personasReal.length ? real : null,
      desvioPct: personasReal.length && plan > 0 ? ((real - plan) / plan) * 100 : null,
      agregadas: cs.filter((c) => c.tipo === 'alta').length,
      modificadas: new Set(cs.filter((c) => c.tipo === 'modificacion' && c.origen === 'excel').map((c) => c.actividadId)).size,
      retiradas: cs.filter((c) => c.tipo === 'retiro').length,
      reprogramadas: new Set(cs.filter((c) => c.tipo === 'modificacion' && c.campo === 'fecha').map((c) => c.actividadId)).size,
      propuestasAcum: propuestas.filter((p) => p.created_at && p.created_at.slice(0, 10) <= fin).length,
      implementadasAcum: propuestas.filter((p) => p.estado === 'Implementada' && p.fecha_implementacion && p.fecha_implementacion <= fin).length,
    };
  });
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
export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function recortar(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s || ''; }
const fechaCortaTxt = (iso) => { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${+d}/${+m}`; };
const fechaHoraTxt = (ts) => new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

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
    if (!porPersona.has(r.persona)) porPersona.set(r.persona, { persona: r.persona, areas: new Set(), marcas: semanas.map(() => false) });
    const p = porPersona.get(r.persona);
    p.marcas[idx.get(r.semana)] = true;
    if (r.area) p.areas.add(r.area);
  }
  const total = semanas.length;
  const personas = [...porPersona.values()].map(({ areas, ...p }) => {
    p.area = [...areas].sort((a, b) => a.localeCompare(b, 'es')).join(', ');
    const conPlan = p.marcas.filter(Boolean).length;
    const pct = total ? (conPlan / total) * 100 : null;
    return { ...p, conPlan, total, pct, nivel: nivelSemaforo(pct) };
  }).sort((a, b) => a.persona.localeCompare(b.persona, 'es'));
  return { semanas: semanas.map((inicio, i) => ({ numero: i + 1, inicio })), personas };
}
