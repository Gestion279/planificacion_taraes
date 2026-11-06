'use strict';
/* Informe · hoja "Desempeño"
   Gerencia y el administrador ven el desempeño de cualquier persona y dan feedback.
   El evaluador se identifica con su correo (una vez por dispositivo) y su nombre
   firma cada comentario: lo toma la base, no se escribe a mano.
   Usa desempeno.js (window.Desempeno), el mismo archivo que "Mi desempeño" de Carga semanal. */

const CFG = { url: null, clave: null };
const CLAVE_EVALUADOR = 'desempeno.evaluador';
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const { esc, ddmm } = Desempeno;

const E = {
  evaluador: null,      // { id, nombre, correo }
  personas: [],         // [{ id, nombre, area }]
  area: '',
  personaId: '',
  datos: null,          // informe_desempeno_persona
  lunes: '',
  semana: null          // informe_semana_persona
};

/* ---------- utilidades ---------- */
const normCorreo = (v) => String(v || '').normalize('NFKC').replace(/[\s\u00a0\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase();
const aFecha = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lunesHoy = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return aIso(d); };
function toast(msg, error = false) {
  $toast.textContent = msg;
  $toast.className = 'toast' + (error ? ' error' : '');
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, error ? 6000 : 3000);
}

/* ---------- base ---------- */
async function configurar() {
  if (CFG.url) return;
  let cfg = null;
  try { const r = await fetch('/api/config', { cache: 'no-store' }); if (r.ok) cfg = await r.json(); } catch { /* sin función */ }
  cfg = cfg && cfg.url ? cfg : globalThis.APP_CONFIG;
  if (!cfg || !cfg.url || !cfg.key) throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY.');
  CFG.url = cfg.url; CFG.clave = cfg.key;
}
async function rpc(fn, params) {
  await configurar();
  let r;
  try {
    r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CFG.clave, Authorization: `Bearer ${CFG.clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {})
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

/* ---------- marco ---------- */
function marco(contenido) {
  const ev = E.evaluador;
  $app.innerHTML = `
    <header class="barra">
      <a class="marca" href="/"><img src="/icons/icon.svg" alt="" width="30" height="30" onerror="this.remove()">Planificación de tareas</a>
      <nav class="nav" aria-label="Informe">
        <a href="/">Volver al informe</a>
        <a href="/desempeno.html" aria-current="page">Desempeño</a>
        ${ev ? `<span class="quien">${esc(ev.nombre)}</span><button type="button" data-accion="cambiar-evaluador">No soy yo</button>` : ''}
      </nav>
    </header>
    ${contenido}`;
}
function errorPantalla(msg) {
  marco(`<main class="contenido angosto"><div class="tarjeta" style="padding:24px;display:flex;flex-direction:column;gap:12px">
    <h1 style="font-size:20px">No se pudo cargar</h1><p>${esc(msg)}</p>
    <div><button type="button" class="btn btn-p" data-accion="reintentar">Probar de nuevo</button></div></div></main>`);
}

/* ---------- identificación del evaluador ---------- */
function vistaIngreso(error = '') {
  marco(`<main><form class="tarjeta ingreso" data-form="evaluador" novalidate>
    <div style="display:flex;flex-direction:column;gap:8px"><h1>Desempeño</h1>
      <p style="color:var(--tenue)">Escribí tu correo de la empresa. Tu nombre va a firmar el feedback que des.</p></div>
    <label class="campo grande">Correo electrónico
      <input class="in" type="email" name="correo" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required ${error ? 'aria-invalid="true" aria-describedby="err-ev"' : ''}></label>
    ${error ? `<p class="error-texto" id="err-ev">${esc(error)}</p>` : ''}
    <button type="submit" class="btn btn-p" style="min-height:48px;font-size:16px">Ingresar</button>
    <p class="nota">Solo pueden dar feedback las personas de Gerencia y el administrador. El correo queda recordado en este dispositivo.</p>
  </form></main>`);
  const i = $app.querySelector('input[name=correo]'); if (i) i.focus();
}
async function identificar(form) {
  const correo = normCorreo(form.elements.correo.value);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return vistaIngreso('Revisá el correo: falta la @ o el dominio.');
  const b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Ingresando…';
  try {
    E.evaluador = await rpc('informe_identificar_evaluador', { p_correo: correo });
    try { localStorage.setItem(CLAVE_EVALUADOR, JSON.stringify(E.evaluador)); } catch { /* sin almacenamiento */ }
    await cargarPersonas();
  } catch (e) {
    vistaIngreso(e.message);
    const i = $app.querySelector('input[name=correo]'); if (i) i.value = correo;
  }
}
function cambiarEvaluador() {
  try { localStorage.removeItem(CLAVE_EVALUADOR); } catch { /* nada */ }
  Object.assign(E, { evaluador: null, personas: [], personaId: '', datos: null, lunes: '', semana: null });
  vistaIngreso();
}

/* ---------- datos ---------- */
async function cargarPersonas() {
  marco('<p class="cargando">Cargando personas…</p>');
  E.personas = await rpc('informe_personas', { p_correo: E.evaluador.correo });
  pintar();
}
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
const semanasConf = () => (E.datos ? E.datos.semanas.filter((s) => s.estado === 'confirmada') : []);
const evaluacionesSemana = () => (E.datos ? E.datos.evaluaciones.filter((e) => e.semana_inicio === E.lunes) : []);
const miEvaluacion = () => evaluacionesSemana().find((e) => e.es_mia) || null;

/* ---------- pantalla ---------- */
function pintar(cargandoDatos = false) {
  const personasArea = E.personas.filter((p) => !E.area || p.area === E.area);
  const areas = [...new Set(E.personas.map((p) => p.area).filter(Boolean))].sort();
  const conf = semanasConf();
  const listo = !!(E.personaId && E.semana && !cargandoDatos);
  const persona = E.datos && E.datos.persona;

  let cuerpo = '';
  if (!E.personaId) cuerpo = '<div class="tarjeta des-vacio">Elegí una persona para ver su desempeño y darle feedback.</div>';
  else if (cargandoDatos || !E.datos) cuerpo = '<p class="cargando">Cargando…</p>';
  else if (!conf.length) cuerpo = '<div class="tarjeta des-vacio">Esta persona todavía no tiene semanas confirmadas.</div>';
  else cuerpo = `
    <div class="des-enc"><h2 style="font-size:20px">${esc(persona.nombre)}
      <span class="chip chip-curso" style="vertical-align:middle;margin-left:6px">${esc(persona.area || '')}</span></h2></div>
    ${Desempeno.vista({
      semanas: conf, lunes: E.lunes, semana: E.semana,
      evaluaciones: evaluacionesSemana(),
      jornada: Number(persona.jornada_horas) || 44,
      modo: 'evaluador'
    })}`;

  marco(`
  <main class="contenido">
    <div class="des-enc"><div><h1>Desempeño</h1>
      <p class="sub">Elegí una persona para ver su desempeño y darle feedback.</p></div></div>
    <section class="tarjeta filtros" aria-label="Filtros">
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
      <button type="button" class="btn btn-p" data-accion="dar-feedback" ${listo ? '' : 'disabled'}
        ${listo ? '' : 'title="Elegí una persona y una semana"'}>Dar Feedback</button>
    </section>
    ${cuerpo}
  </main>`);
}

/* ---------- Dar Feedback ---------- */
function abrirFeedback() {
  const persona = E.datos.persona;
  const s = semanasConf().find((x) => x.lunes === E.lunes);
  const mia = miEvaluacion() || {};
  const val = mia.valoracion || '';
  const d = document.createElement('dialog');
  d.className = 'cajon';
  d.setAttribute('aria-labelledby', 't-dar');
  d.innerHTML = `<form method="dialog" novalidate>
    <div class="cajon-cab"><h2 id="t-dar">${mia.id ? 'Editar tu feedback para' : 'Dar Feedback a'} ${esc(persona.nombre)}</h2>
      <p>Semana del ${ddmm(s.fecha_inicio)} al ${ddmm(s.fecha_fin)}</p></div>
    <div class="cajon-cuerpo">
      <div class="firma">Se publica firmado como <strong>${esc(E.evaluador.nombre)}</strong>. ${esc(persona.nombre.split(' ')[0])} va a ver tu nombre arriba del comentario.</div>
      ${mia.publicada ? '<p class="nota" style="font-size:13px;color:var(--tenue)">Este feedback ya está publicado. Si lo guardás como borrador, deja de verse hasta que lo vuelvas a publicar.</p>' : ''}
      <div class="campo grande">Valoración (opcional)<div class="segm" role="group" aria-label="Valoración">
        ${['Muy buena', 'Buena', 'A mejorar'].map((v) => `<button type="button" data-val="${v}" aria-pressed="${v === val}">${v}</button>`).join('')}
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
  let valor = val;
  d.addEventListener('click', async (e) => {
    const vb = e.target.closest('[data-val]');
    if (vb) {
      valor = valor === vb.dataset.val ? '' : vb.dataset.val;
      d.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === valor)));
      return;
    }
    if (e.target.closest('[data-cerrar]')) return d.close();
    const g = e.target.closest('[data-guardar]');
    if (!g) return;
    const f = d.querySelector('form');
    const err = d.querySelector('[data-error]');
    const datos = { c: f.elements.comentario.value.trim(), fo: f.elements.fortalezas.value.trim(), am: f.elements.a_mejorar.value.trim() };
    if (!valor && !datos.c && !datos.fo && !datos.am) {
      err.textContent = 'Escribí un comentario o elegí una valoración.'; err.hidden = false; return;
    }
    const publicar = g.dataset.guardar === 'publicar';
    d.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await rpc('informe_guardar_evaluacion', {
        p_correo: E.evaluador.correo, p_persona: E.personaId, p_lunes: E.lunes,
        p_valoracion: valor || null, p_fortalezas: datos.fo || null, p_a_mejorar: datos.am || null,
        p_comentario: datos.c || null, p_publicar: publicar
      });
      d.close();
      toast(publicar ? 'Feedback publicado.' : 'Borrador guardado. Todavía no lo ve la persona.');
      E.datos = await rpc('informe_desempeno_persona', { p_correo: E.evaluador.correo, p_persona: E.personaId });
      pintar();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      d.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  const t = d.querySelector('textarea'); if (t) t.focus();
}

/* ---------- eventos ---------- */
$app.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form="evaluador"]');
  if (!f) return;
  e.preventDefault(); identificar(f);
});
$app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-filtro]');
  if (!el) return;
  const run = (p) => p.catch((err) => errorPantalla(err.message));
  if (el.dataset.filtro === 'area') {
    E.area = el.value;
    const sigue = E.personas.some((p) => p.id === E.personaId && (!E.area || p.area === E.area));
    if (!sigue) run(elegirPersona('')); else pintar();
  } else if (el.dataset.filtro === 'persona') run(elegirPersona(el.value));
  else if (el.dataset.filtro === 'semana') run(elegirSemana(el.value));
});
$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  if (b.dataset.accion === 'dar-feedback' && !b.disabled) abrirFeedback();
  else if (b.dataset.accion === 'cambiar-evaluador') cambiarEvaluador();
  else if (b.dataset.accion === 'reintentar') iniciar();
});

/* ---------- inicio ---------- */
async function iniciar() {
  try { E.evaluador = JSON.parse(localStorage.getItem(CLAVE_EVALUADOR) || 'null'); } catch { E.evaluador = null; }
  if (!E.evaluador) return vistaIngreso();
  try {
    // Revalida: si dejó de ser evaluador (cambio de área o baja), vuelve a pedir el correo.
    E.evaluador = await rpc('informe_identificar_evaluador', { p_correo: E.evaluador.correo });
    await cargarPersonas();
  } catch (e) {
    if (/Gerencia|habilitado/.test(e.message)) { cambiarEvaluador(); toast(e.message, true); }
    else errorPantalla(e.message);
  }
}
iniciar();
