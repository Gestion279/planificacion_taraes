// =====================================================================
// Hoja "Desempeño"
// Gerencia y el administrador ven el desempeño de cada persona (lo mismo que
// ella ve en "Mi desempeño" de Carga semanal) y le dan feedback.
// El evaluador se identifica con su correo una vez por dispositivo; su nombre
// firma cada comentario y lo toma la base, no se escribe a mano.
// Cálculos y tarjetas: /desempeno.js (window.Desempeno), el mismo archivo que usa Carga semanal.
// =====================================================================
import { aviso } from '../ui.js';

export const titulo = 'Desempeño';

const CLAVE_EVALUADOR = 'desempeno.evaluador';
const CFG = { url: null, clave: null };
const E = { evaluador: null, personas: null, area: '', personaId: '', datos: null, lunes: '', semana: null };
let raiz = null;          // contenedor de la hoja (se crea en cada render)
let D = null;             // window.Desempeno

// ---------- base ----------
async function configurar() {
  if (CFG.url) return;
  let cfg = null;
  try { const r = await fetch('/api/config', { cache: 'no-store' }); if (r.ok) cfg = await r.json(); } catch { /* sin función */ }
  cfg = cfg && cfg.url ? cfg : globalThis.APP_CONFIG;
  if (!cfg || !cfg.url || !cfg.key) throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.');
  CFG.url = cfg.url; CFG.clave = cfg.key;
}
async function rpc(fn, params) {
  await configurar();
  let r;
  try {
    r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CFG.clave, Authorization: `Bearer ${CFG.clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
  } catch { throw new Error('No hay conexión. Revisá internet y probá de nuevo.'); }
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
  if (!r.ok) {
    const m = (data && (data.message || data.hint)) || `No se pudo completar la operación (error ${r.status}).`;
    const k = m.match(/^[A-Z_]+: (.*)$/s);
    throw new Error(k ? k[1].charAt(0).toUpperCase() + k[1].slice(1) : m);
  }
  return data;
}
async function cargarComun() {
  if (window.Desempeno) { D = window.Desempeno; return; }
  try { await import('/desempeno.js'); } catch { /* se informa abajo */ }
  if (!window.Desempeno) throw new Error('Falta el archivo desempeno.js en la raíz del repositorio del informe.');
  D = window.Desempeno;
}
const normCorreo = (v) => String(v || '').normalize('NFKC').replace(/[\s\u00a0\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase();
const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lunesHoy = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return aIso(d); };
const semanasConf = () => (E.datos ? E.datos.semanas.filter((s) => s.estado === 'confirmada') : []);
const evaluacionesSemana = () => (E.datos ? E.datos.evaluaciones.filter((e) => e.semana_inicio === E.lunes) : []);
const miEvaluacion = () => evaluacionesSemana().find((e) => e.es_mia) || null;
const fallo = (e) => { if (raiz) raiz.innerHTML = `<div class="error-bloque"><h2>No se pudo mostrar Desempeño</h2><p>${D ? D.esc(e.message) : e.message}</p></div>`; };

// ---------- render (lo llama app.js al entrar a la hoja) ----------
export async function render(main) {
  await cargarComun();
  main.innerHTML = '<div class="des-raiz"></div>';
  raiz = main.firstElementChild;
  raiz.addEventListener('submit', alEnviar);
  raiz.addEventListener('change', alCambiar);
  raiz.addEventListener('click', alClic);
  try { E.evaluador = E.evaluador || JSON.parse(localStorage.getItem(CLAVE_EVALUADOR) || 'null'); } catch { E.evaluador = null; }
  if (!E.evaluador) return vistaIngreso();
  try {
    if (!E.personas) {
      raiz.innerHTML = '<div class="cargando">Cargando…</div>';
      // Revalida: si dejó de ser evaluador (cambio de área o baja), vuelve a pedir el correo.
      E.evaluador = await rpc('informe_identificar_evaluador', { p_correo: E.evaluador.correo });
      E.personas = await rpc('informe_personas', { p_correo: E.evaluador.correo });
    }
    pintar();
  } catch (e) {
    if (/Gerencia|habilitado/.test(e.message)) { olvidarEvaluador(); vistaIngreso(e.message); } else fallo(e);
  }
}

// ---------- identificación ----------
function vistaIngreso(error = '') {
  const { esc } = D;
  raiz.innerHTML = `<form class="tarjeta des-ingreso" data-form="evaluador" novalidate>
    <h1>Desempeño</h1>
    <p class="nota">Escribí tu correo de la empresa. Tu nombre va a firmar el feedback que des.</p>
    <label class="campo grande">Correo electrónico
      <input class="in" type="email" name="correo" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required ${error ? 'aria-invalid="true" aria-describedby="des-err"' : ''}></label>
    ${error ? `<p class="error-texto" id="des-err">${esc(error)}</p>` : ''}
    <button type="submit" class="btn btn-p">Ingresar</button>
    <p class="nota">Pueden dar feedback las personas de Gerencia y el administrador. El correo queda recordado en este dispositivo.</p>
  </form>`;
  raiz.querySelector('input[name=correo]')?.focus();
}
async function identificar(form) {
  const correo = normCorreo(form.elements.correo.value);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return vistaIngreso('Revisá el correo: falta la @ o el dominio.');
  const b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Ingresando…';
  try {
    E.evaluador = await rpc('informe_identificar_evaluador', { p_correo: correo });
    try { localStorage.setItem(CLAVE_EVALUADOR, JSON.stringify(E.evaluador)); } catch { /* sin almacenamiento */ }
    E.personas = await rpc('informe_personas', { p_correo: E.evaluador.correo });
    pintar();
  } catch (e) {
    vistaIngreso(e.message);
    const i = raiz.querySelector('input[name=correo]'); if (i) i.value = correo;
  }
}
function olvidarEvaluador() {
  try { localStorage.removeItem(CLAVE_EVALUADOR); } catch { /* nada */ }
  Object.assign(E, { evaluador: null, personas: null, personaId: '', datos: null, lunes: '', semana: null });
}

// ---------- datos ----------
async function elegirPersona(id) {
  E.personaId = id; E.datos = null; E.semana = null; E.lunes = '';
  if (!id) return pintar();
  pintar(true);
  E.datos = await rpc('informe_desempeno_persona', { p_correo: E.evaluador.correo, p_persona: id });
  const conf = semanasConf();
  const lh = lunesHoy();
  const def = conf.find((s) => s.lunes < lh) || conf[0];
  if (def) await elegirSemana(def.lunes, false);
  pintar();
}
async function elegirSemana(lunes, repintar = true) {
  E.lunes = lunes;
  const s = semanasConf().find((x) => x.lunes === lunes);
  if (!s) { E.semana = null; if (repintar) pintar(); return; }
  if (repintar) pintar(true);
  E.semana = await rpc('informe_semana_persona', { p_correo: E.evaluador.correo, p_persona: E.personaId, p_inicio: s.fecha_inicio, p_fin: s.fecha_fin });
  if (repintar) pintar();
}

// ---------- pantalla ----------
function pintar(cargandoDatos = false) {
  if (!raiz || !raiz.isConnected) return;
  const { esc, ddmm } = D;
  const personas = E.personas || [];
  const personasArea = personas.filter((p) => !E.area || p.area === E.area);
  const areas = [...new Set(personas.map((p) => p.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const conf = semanasConf();
  const listo = !!(E.personaId && E.semana && !cargandoDatos);
  const persona = E.datos && E.datos.persona;

  let cuerpo;
  if (!E.personaId) cuerpo = '<div class="tarjeta des-vacio">Elegí una persona para ver su desempeño y darle feedback.</div>';
  else if (cargandoDatos || !E.datos) cuerpo = '<div class="cargando">Cargando…</div>';
  else if (!conf.length) cuerpo = '<div class="tarjeta des-vacio">Esta persona todavía no tiene semanas confirmadas.</div>';
  else cuerpo = `
    <div class="des-enc"><h2 class="des-persona">${esc(persona.nombre)} <span class="chip chip-curso">${esc(persona.area || '')}</span></h2></div>
    ${D.vista({ semanas: conf, lunes: E.lunes, semana: E.semana, evaluaciones: evaluacionesSemana(), jornada: Number(persona.jornada_horas) || 44, modo: 'evaluador' })}`;

  raiz.innerHTML = `
    <div class="des-enc">
      <div><h1>Desempeño</h1><p class="sub">Elegí una persona para ver su desempeño y darle feedback.</p></div>
      <p class="des-quien">Evaluador: <strong>${esc(E.evaluador.nombre)}</strong> · <button type="button" class="des-link" data-accion="cambiar-evaluador">No soy yo</button></p>
    </div>
    <section class="tarjeta filtros" aria-label="Filtros de Desempeño">
      <label class="campo grande">Persona<select class="in" data-filtro="persona">
        <option value="">Elegí una persona</option>
        ${personasArea.map((p) => `<option value="${p.id}" ${p.id === E.personaId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
      </select></label>
      <label class="campo grande">Área<select class="in" data-filtro="area">
        <option value="">Todas</option>
        ${areas.map((a) => `<option ${a === E.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}
      </select></label>
      <label class="campo grande">Semana<select class="in" data-filtro="semana" ${conf.length ? '' : 'disabled'}>
        ${conf.length ? conf.map((s) => `<option value="${s.lunes}" ${s.lunes === E.lunes ? 'selected' : ''}>${ddmm(s.fecha_inicio)} al ${ddmm(s.fecha_fin)}</option>`).join('') : '<option>—</option>'}
      </select></label>
      <button type="button" class="btn btn-p" data-accion="dar-feedback" ${listo ? '' : 'disabled title="Elegí una persona y una semana"'}>Dar Feedback</button>
    </section>
    ${cuerpo}`;
}

// ---------- Dar Feedback ----------
function abrirFeedback() {
  const { esc, ddmm } = D;
  const persona = E.datos.persona;
  const s = semanasConf().find((x) => x.lunes === E.lunes);
  const mia = miEvaluacion() || {};
  let valor = mia.valoracion || '';
  const d = document.createElement('dialog');
  d.className = 'des-raiz cajon';
  d.setAttribute('aria-labelledby', 'des-t-dar');
  d.innerHTML = `<form method="dialog" novalidate>
    <div class="cajon-cab"><h2 id="des-t-dar">${mia.id ? 'Editar tu feedback para' : 'Dar Feedback a'} ${esc(persona.nombre)}</h2>
      <p>Semana del ${ddmm(s.fecha_inicio)} al ${ddmm(s.fecha_fin)}</p></div>
    <div class="cajon-cuerpo">
      <div class="firma">Se publica firmado como <strong>${esc(E.evaluador.nombre)}</strong>. ${esc(persona.nombre.split(' ')[0])} va a ver tu nombre arriba del comentario.</div>
      ${mia.publicada ? '<p class="nota">Este feedback ya está publicado. Si lo guardás como borrador, deja de verse hasta que lo vuelvas a publicar.</p>' : ''}
      <div class="campo grande">Valoración (opcional)<div class="segm" role="group" aria-label="Valoración">
        ${['Muy buena', 'Buena', 'A mejorar'].map((v) => `<button type="button" data-val="${v}" aria-pressed="${v === valor}">${v}</button>`).join('')}
      </div></div>
      <label class="campo grande">Comentario<textarea class="in" name="comentario" maxlength="2000" placeholder="Qué querés que sepa sobre esta semana">${esc(mia.comentario || '')}</textarea></label>
      <label class="campo grande">Fortalezas (opcional)<input class="in" name="fortalezas" maxlength="1000" value="${esc(mia.fortalezas || '')}"></label>
      <label class="campo grande">A mejorar (opcional)<input class="in" name="a_mejorar" maxlength="1000" value="${esc(mia.a_mejorar || '')}"></label>
      <p class="error-texto" data-error hidden></p>
    </div>
    <div class="cajon-pie">
      <button type="button" class="btn" data-cerrar>Cancelar</button>
      <button type="button" class="btn" data-guardar="borrador">Guardar borrador</button>
      <button type="button" class="btn btn-p" data-guardar="publicar">Publicar</button>
    </div></form>`;
  document.body.appendChild(d);
  d.addEventListener('click', async (e) => {
    const vb = e.target.closest('[data-val]');
    if (vb) {
      valor = valor === vb.dataset.val ? '' : vb.dataset.val;
      d.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === valor)));
      return;
    }
    if (e.target.closest('[data-cerrar]')) { d.close(); return; }
    const g = e.target.closest('[data-guardar]');
    if (!g) return;
    const f = d.querySelector('form');
    const err = d.querySelector('[data-error]');
    const c = f.elements.comentario.value.trim(), fo = f.elements.fortalezas.value.trim(), am = f.elements.a_mejorar.value.trim();
    if (!valor && !c && !fo && !am) { err.textContent = 'Escribí un comentario o elegí una valoración.'; err.hidden = false; return; }
    const publicar = g.dataset.guardar === 'publicar';
    d.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await rpc('informe_guardar_evaluacion', {
        p_correo: E.evaluador.correo, p_persona: E.personaId, p_lunes: E.lunes,
        p_valoracion: valor || null, p_fortalezas: fo || null, p_a_mejorar: am || null, p_comentario: c || null, p_publicar: publicar,
      });
      d.close();
      aviso(publicar ? 'Feedback publicado.' : 'Borrador guardado. Todavía no lo ve la persona.');
      E.datos = await rpc('informe_desempeno_persona', { p_correo: E.evaluador.correo, p_persona: E.personaId });
      pintar();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      d.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  d.querySelector('textarea')?.focus();
}

// ---------- eventos ----------
function alEnviar(e) {
  const f = e.target.closest('form[data-form="evaluador"]');
  if (!f) return;
  e.preventDefault(); identificar(f);
}
function alCambiar(e) {
  const el = e.target.closest('[data-filtro]');
  if (!el) return;
  const run = (p) => p.catch(fallo);
  if (el.dataset.filtro === 'area') {
    E.area = el.value;
    const sigue = (E.personas || []).some((p) => p.id === E.personaId && (!E.area || p.area === E.area));
    if (!sigue) run(elegirPersona('')); else pintar();
  } else if (el.dataset.filtro === 'persona') run(elegirPersona(el.value));
  else if (el.dataset.filtro === 'semana') run(elegirSemana(el.value));
}
function alClic(e) {
  const b = e.target.closest('[data-accion]');
  if (!b || b.disabled) return;
  if (b.dataset.accion === 'dar-feedback') abrirFeedback();
  else if (b.dataset.accion === 'cambiar-evaluador') { olvidarEvaluador(); vistaIngreso(); }
}
