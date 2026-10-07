// =====================================================================
// Acceso a datos (Supabase). Única capa que habla con la base.
// Acceso público por enlace: se usa la clave "publishable/anon".
// Las políticas de la base limitan qué se puede modificar (nada se borra).
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let sb = null;

export async function iniciar() {
  let cfg = null;
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) cfg = await r.json();
  } catch { /* sin función serverless (desarrollo local) */ }
  cfg = cfg?.url ? cfg : globalThis.APP_CONFIG;
  if (!cfg?.url || !cfg?.key) throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel (ver README).');
  sb = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return sb;
}

// ---------- clave de carga (opcional) ----------
// Si en Supabase se definió una clave, las ediciones la piden una vez y queda en este navegador.
export let alPedirClave = async () => null;
export function configurarPedidoDeClave(fn) { alPedirClave = fn; }
const leerClave = () => { try { return localStorage.getItem('planif.clave') || null; } catch { return null; } };
export const guardarClave = (v) => { try { v ? localStorage.setItem('planif.clave', v) : localStorage.removeItem('planif.clave'); } catch { /* opcional */ } };
const cargadoPor = () => { try { return localStorage.getItem('planif.cargadoPor') || null; } catch { return null; } };

async function conClave(llamada) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, error } = await llamada(leerClave());
    if (!error) return data;
    if (!/CLAVE_INVALIDA/.test(error.message)) throw new Error(error.message);
    guardarClave(null);
    const nueva = await alPedirClave(intento > 0);
    if (!nueva) throw new Error('Se necesita la clave de carga para guardar cambios.');
    guardarClave(nueva);
  }
  throw new Error('La clave de carga no es correcta.');
}

export async function claveRequerida() {
  const { data, error } = await sb.rpc('clave_requerida');
  return error ? false : !!data;
}

const n = (v) => (v === null || v === undefined ? null : Number(v));
const mapActividad = (r) => ({
  id: r.id, semanaId: r.semana_id, semana: r.semana_inicio,
  personaId: r.persona_id, persona: r.persona, areaId: r.area_id, area: r.area,
  fecha: r.fecha, dia: r.dia, tarea: r.tarea, tareaNorm: r.tarea_norm, ordinal: r.ordinal,
  prioridad: r.prioridad, horas: n(r.horas_planificadas), real: n(r.horas_reales),
  recursos: r.recursos, riesgos: r.riesgos, estado: r.estado,
  riesgoProb: r.riesgo_prob, riesgoImpacto: r.riesgo_impacto,
  hoja: r.hoja, fila: r.fila_excel, altaPosterior: r.alta_posterior, updatedAt: r.updated_at,
  jornada: n(r.jornada),
});
const mapCambio = (c) => ({
  id: c.id, fechaHora: c.created_at, tipo: c.tipo, campo: c.campo, antes: c.valor_anterior, despues: c.valor_nuevo,
  origen: c.origen, actividadId: c.planificacion_id, semanaId: c.semana_id, semana: c.semana_inicio,
  persona: c.persona, area: c.area, tarea: c.tarea, fecha: c.fecha,
});

// Trae todas las filas: la primera página informa el total y el resto se pide en paralelo
async function todo(consulta) {
  const pag = 1000;
  const primera = await consulta({ count: 'exact' }).range(0, pag - 1);
  if (primera.error) throw new Error(primera.error.message);
  const total = primera.count ?? primera.data.length;
  if (total <= pag) return primera.data;
  const resto = await Promise.all(Array.from({ length: Math.ceil(total / pag) - 1 }, (_, i) =>
    consulta().range((i + 1) * pag, (i + 2) * pag - 1)));
  const err = resto.find((r) => r.error);
  if (err) throw new Error(err.error.message);
  return [primera.data, ...resto.map((r) => r.data)].flat();
}

// Para semanas que no son la seleccionada alcanza con las columnas de análisis (menos datos por la red)
const COLS_ANALISIS = 'id,semana_id,semana_inicio,persona_id,persona,area_id,area,fecha,dia,tarea,tarea_norm,ordinal,prioridad,horas_planificadas,riesgos,estado,alta_posterior,jornada';

// Una fila por persona y semana con planificación (cuadro de cumplimiento de carga)
export async function personaSemana() {
  const rows = await todo((opc) => sb.from('v_persona_semana').select('semana_inicio,persona_id,persona,area', opc).order('semana_inicio'));
  return rows.map((r) => ({ semana: r.semana_inicio, personaId: r.persona_id, persona: r.persona, area: r.area }));
}

export async function semanas() {
  const { data, error } = await sb.from('v_semanas').select('*').gt('actividades', 0).order('fecha_inicio', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map((s) => ({ id: s.id, inicio: s.fecha_inicio, fin: s.fecha_fin, actividades: s.actividades, ultimaCarga: s.ultima_carga }));
}

export async function areas() {
  const { data, error } = await sb.from('areas').select('id,nombre').eq('activo', true).order('nombre');
  if (error) throw new Error(error.message);
  return data;
}

export async function actividades(semanaIds, { completas = true } = {}) {
  if (!semanaIds.length) return [];
  const rows = await todo((opc) => sb.from('v_actividades').select(completas ? '*' : COLS_ANALISIS, opc).in('semana_id', semanaIds).order('id'));
  return rows.map(mapActividad);
}

export async function horasReales(semanaIds) {
  if (!semanaIds.length) return [];
  const { data, error } = await sb.from('horas_reales_semana').select('semana_id,persona_id,horas,semanas(fecha_inicio)').in('semana_id', semanaIds);
  if (error) throw new Error(error.message);
  return data.map((x) => ({ semana: x.semanas.fecha_inicio, personaId: x.persona_id, horas: Number(x.horas) }));
}

export async function riesgosEvaluados() {
  const { data, error } = await sb.from('riesgos_evaluados').select('persona_id,riesgo_norm,prob,impacto');
  if (error) throw new Error(error.message);
  return data;
}

export async function excepcionesAuditoria() {
  const { data, error } = await sb.from('auditoria_excepciones').select('persona_id,tarea_norm,regla');
  if (error) throw new Error(error.message);
  return data;
}

export async function personas() {
  const { data, error } = await sb.from('personas').select('id,nombre,jornada_horas,areas(nombre)').order('nombre');
  if (error) throw new Error(error.message);
  return data.map((p) => ({ id: p.id, nombre: p.nombre, jornada: Number(p.jornada_horas), area: p.areas?.nombre || '' }));
}

export async function cambios(semanaIds) {
  if (!semanaIds.length) return [];
  const rows = await todo((opc) => sb.from('v_cambios').select('*', opc).in('semana_id', semanaIds).order('id'));
  return rows.map(mapCambio);
}

export async function historialActividad(id) {
  const { data, error } = await sb.from('historial_planificacion').select('*').eq('planificacion_id', id).order('id');
  if (error) throw new Error(error.message);
  return data;
}

export async function importaciones(limite = 100) {
  const { data, error } = await sb.from('importaciones')
    .select('id,created_at,archivo,usuario_email,cargado_por,origen,total,nuevas,modificadas,sin_cambios,retiradas,reactivadas,observaciones,semanas(fecha_inicio),areas(nombre)')
    .order('created_at', { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return data.map((i) => ({ ...i, semana: i.semanas?.fecha_inicio, area: i.areas?.nombre }));
}

// ---------- propuestas de mejora ----------
// Devuelve null si la base todavía no tiene la tabla (falta aplicar supabase/propuestas_mejora.sql):
// la aplicación sigue funcionando y lo avisa en Propuestas de mejora.
const sinTabla = (error) => /does not exist|PGRST205|PGRST202|Could not find the (table|function)|schema cache/i.test(`${error?.code || ''} ${error?.message || ''}`);
export async function propuestas() {
  const { data, error } = await sb.from('propuestas_mejora').select('*').order('created_at', { ascending: false });
  if (error) { if (sinTabla(error)) return null; throw new Error(error.message); }
  return data.map((p) => ({ ...p, horas_mes_base: n(p.horas_mes_base), ahorro_pct: n(p.ahorro_pct) }));
}
export async function historialPropuesta(id) {
  const { data, error } = await sb.from('propuestas_historial').select('*').eq('propuesta_id', id).order('id');
  if (error) throw new Error(error.message);
  return data;
}
export const guardarPropuesta = (id, datos) => conClave((clave) =>
  sb.rpc('guardar_propuesta', { p_id: id || null, p_datos: datos, p_clave: clave, p_cargado_por: cargadoPor() }));

// ---------- ediciones (validan la clave si está definida) ----------
export const guardarHorasReales = (semanaId, personaId, horas) => conClave((clave) =>
  sb.rpc('guardar_horas_reales', { p_semana: semanaId, p_persona: personaId, p_horas: horas, p_clave: clave, p_cargado_por: cargadoPor() }));

export const evaluarRiesgo = (personaId, riesgoNorm, riesgoTexto, prob, impacto) => conClave((clave) =>
  sb.rpc('evaluar_riesgo', { p_persona: personaId, p_riesgo_norm: riesgoNorm, p_riesgo_texto: riesgoTexto,
    p_prob: prob || null, p_impacto: impacto || null, p_clave: clave, p_cargado_por: cargadoPor() }));

export const guardarJornada = (personaId, horas) => conClave((clave) =>
  sb.rpc('guardar_jornada', { p_persona: personaId, p_horas: horas, p_clave: clave }));

export const marcarRevisada = (personaId, tareaNorm, regla, revisada) => conClave((clave) =>
  sb.rpc('marcar_revisada', { p_persona: personaId, p_tarea_norm: tareaNorm || '', p_regla: regla, p_revisada: revisada,
    p_clave: clave, p_cargado_por: cargadoPor() }));

export const unificarPersonas = (origenId, destinoId) => conClave((clave) =>
  sb.rpc('unificar_personas', { p_origen: origenId, p_destino: destinoId, p_clave: clave }));

// La vista previa es libre; la confirmación lleva la clave dentro del contenido
export async function sincronizar(payload, confirmar) {
  if (!confirmar) {
    const { data, error } = await sb.rpc('sincronizar_planificacion', { p_payload: payload, p_confirmar: false });
    if (error) throw new Error(error.message);
    return data;
  }
  return conClave((clave) => sb.rpc('sincronizar_planificacion', { p_payload: { ...payload, clave }, p_confirmar: true }));
}
