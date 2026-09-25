// =====================================================================
// Acceso a datos (Supabase). Única capa que habla con la base.
// La clave usada es la "publishable/anon": pública por diseño; la
// seguridad la dan RLS + la función de sincronización.
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
  sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  return sb;
}

export const auth = {
  sesion: async () => (await sb.auth.getSession()).data.session,
  entrar: async (email, password) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.' : error.message);
    return data.session;
  },
  salir: () => sb.auth.signOut(),
  alCambiar: (fn) => sb.auth.onAuthStateChange((_e, s) => fn(s)),
};

const n = (v) => (v === null || v === undefined ? null : Number(v));
const mapActividad = (r) => ({
  id: r.id, semanaId: r.semana_id, semana: r.semana_inicio,
  personaId: r.persona_id, persona: r.persona, areaId: r.area_id, area: r.area,
  fecha: r.fecha, dia: r.dia, tarea: r.tarea, tareaNorm: r.tarea_norm, ordinal: r.ordinal,
  prioridad: r.prioridad, horas: n(r.horas_planificadas), real: n(r.horas_reales),
  recursos: r.recursos, riesgos: r.riesgos, estado: r.estado,
  riesgoProb: r.riesgo_prob, riesgoImpacto: r.riesgo_impacto,
  hoja: r.hoja, fila: r.fila_excel, altaPosterior: r.alta_posterior, updatedAt: r.updated_at,
});
const mapCambio = (c) => ({
  id: c.id, fechaHora: c.created_at, tipo: c.tipo, campo: c.campo, antes: c.valor_anterior, despues: c.valor_nuevo,
  origen: c.origen, actividadId: c.planificacion_id, semanaId: c.semana_id, semana: c.semana_inicio,
  persona: c.persona, area: c.area, tarea: c.tarea, fecha: c.fecha,
});

async function todo(consulta) {
  const pag = 1000; let desde = 0; const out = [];
  for (;;) {
    const { data, error } = await consulta().range(desde, desde + pag - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < pag) return out;
    desde += pag;
  }
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

export async function actividades(semanaIds) {
  if (!semanaIds.length) return [];
  const rows = await todo(() => sb.from('v_actividades').select('*').in('semana_id', semanaIds).order('id'));
  return rows.map(mapActividad);
}

export async function cambios(semanaIds) {
  if (!semanaIds.length) return [];
  const rows = await todo(() => sb.from('v_cambios').select('*').in('semana_id', semanaIds).order('id'));
  return rows.map(mapCambio);
}

export async function historialActividad(id) {
  const { data, error } = await sb.from('historial_planificacion').select('*').eq('planificacion_id', id).order('id');
  if (error) throw new Error(error.message);
  return data;
}

export async function importaciones(limite = 100) {
  const { data, error } = await sb.from('importaciones')
    .select('id,created_at,archivo,usuario_email,origen,total,nuevas,modificadas,sin_cambios,retiradas,reactivadas,observaciones,semanas(fecha_inicio),areas(nombre)')
    .order('created_at', { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return data.map((i) => ({ ...i, semana: i.semanas?.fecha_inicio, area: i.areas?.nombre }));
}

// Campos editables en la aplicación: horas_reales, riesgo_prob, riesgo_impacto
export async function actualizarActividad(id, cambiosCampos) {
  const permitido = {};
  for (const [k, v] of Object.entries(cambiosCampos)) {
    if (['horas_reales', 'riesgo_prob', 'riesgo_impacto'].includes(k)) permitido[k] = v === '' ? null : v;
  }
  const { error } = await sb.from('planificacion').update(permitido).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function sincronizar(payload, confirmar) {
  const { data, error } = await sb.rpc('sincronizar_planificacion', { p_payload: payload, p_confirmar: confirmar });
  if (error) throw new Error(error.message);
  return data;
}
