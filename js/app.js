// =====================================================================
// Planificación de tareas — núcleo de la aplicación
// =====================================================================
import * as db from './db.js';
import { esc, rangoSemana, limpiarGraficos, aviso, pedirClave } from './ui.js';
import { addDays, CTX } from './engine.js';
import * as resumen from './modules/resumen.js';
import * as planificacion from './modules/planificacion.js';
import * as personas from './modules/personas.js';
import * as riesgos from './modules/riesgos.js';
import * as evolucion from './modules/evolucion.js';
import * as carga from './modules/carga.js';

const MODULOS = { resumen, planificacion, personas, riesgos, evolucion, carga };

// ---------- estado compartido (una sola fuente de datos para todos los módulos) ----------
export const app = {
  semanas: [],          // [{id, inicio, fin, actividades}] desc
  semana: null,         // semana seleccionada
  filas: [],            // actividades de la semana seleccionada
  filasPrevia: [],      // actividades de la semana anterior cargada
  cambiosSemana: [],    // cambios posteriores a la primera carga (semana seleccionada)
  areas: [],
  modulo: 'resumen',
  params: {},
  _cache: new Map(),
  _completas: new Set(),
  _cacheCambios: new Map(),

  semanaPrevia() {
    const i = this.semanas.findIndex((s) => s.id === this.semana?.id);
    return i >= 0 ? this.semanas[i + 1] || null : null;
  },

  // Semanas de un período que termina en la semana seleccionada
  semanasDePeriodo(p) {
    const hasta = this.semana?.inicio;
    if (!hasta) return [];
    const asc = [...this.semanas].reverse();
    if (p.tipo === 'rango') return asc.filter((s) => s.inicio >= p.desde && s.inicio <= p.hasta);
    const hastaIdx = asc.findIndex((s) => s.inicio === hasta);
    const hastaYAntes = asc.slice(0, hastaIdx + 1);
    if (p.tipo === 'meses') { const desde = addDays(hasta, -7 * Math.round(p.n * 4.33) + 7); return hastaYAntes.filter((s) => s.inicio >= desde); }
    return hastaYAntes.slice(-p.n);
  },

  // completas: con todas las columnas (semana seleccionada y anterior); el resto, solo columnas de análisis
  async filasDe(semanas, { completas = false } = {}) {
    const faltan = semanas.filter((s) => !this._cache.has(s.id) || (completas && !this._completas.has(s.id))).map((s) => s.id);
    if (faltan.length) {
      const nuevasSemanas = faltan.filter((id) => !this._cacheCambios.has(id));
      const [rows, cambios, reales] = await Promise.all([
        db.actividades(faltan, { completas }), db.cambios(nuevasSemanas), db.horasReales(nuevasSemanas)]);
      faltan.forEach((id) => { this._cache.set(id, []); if (completas) this._completas.add(id); });
      nuevasSemanas.forEach((id) => this._cacheCambios.set(id, []));
      rows.forEach((r) => this._cache.get(r.semanaId).push(r));
      cambios.forEach((c) => this._cacheCambios.get(c.semanaId)?.push(c));
      reales.forEach((x) => CTX.reales.set(`${x.semana}|${x.personaId}`, x.horas));
    }
    return {
      semanas: semanas.map((s) => s.inicio),
      rows: semanas.flatMap((s) => this._cache.get(s.id)),
      cambios: semanas.flatMap((s) => this._cacheCambios.get(s.id)),
    };
  },

  // Datos cargados en la aplicación que valen para todas las semanas
  async cargarContexto() {
    const [riesgos, excepciones] = await Promise.all([db.riesgosEvaluados(), db.excepcionesAuditoria()]);
    CTX.riesgos = new Map(riesgos.map((x) => [`${x.persona_id}|${x.riesgo_norm}`, { prob: x.prob, impacto: x.impacto }]));
    CTX.excepciones = new Set(excepciones.map((x) => `${x.persona_id}|${x.tarea_norm}|${x.regla}`));
  },

  actualizarPersona(personaId, patch) {
    for (const rows of this._cache.values()) rows.forEach((r) => { if (r.personaId === personaId) Object.assign(r, patch); });
  },

  async seleccionarSemana(id) {
    this.semana = this.semanas.find((s) => s.id === id) || this.semanas[0] || null;
    if (!this.semana) { this.filas = []; this.filasPrevia = []; this.cambiosSemana = []; return; }
    const prev = this.semanaPrevia();
    const { rows, cambios } = await this.filasDe(prev ? [this.semana, prev] : [this.semana], { completas: true });
    this.filas = rows.filter((r) => r.semanaId === this.semana.id);
    this.filasPrevia = prev ? rows.filter((r) => r.semanaId === prev.id) : [];
    this.cambiosSemana = cambios.filter((c) => c.semanaId === this.semana.id);
  },

  // Se llama después de una carga: recarga la lista de semanas y vacía la caché
  async refrescar(semanaInicio = null) {
    this._cache.clear(); this._completas.clear(); this._cacheCambios.clear(); CTX.reales.clear();
    await this.cargarContexto();
    this.semanas = await db.semanas();
    this.areas = await db.areas();
    const destino = semanaInicio ? this.semanas.find((s) => s.inicio === semanaInicio) : this.semana;
    await this.seleccionarSemana(destino?.id || this.semanas[0]?.id);
    pintarSelector();
  },

  // Actualiza una actividad en la caché local después de editarla
  actualizarLocal(id, patch) {
    for (const rows of this._cache.values()) {
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    }
  },

  ir(modulo, params = {}) {
    const q = new URLSearchParams(params).toString();
    location.hash = `#/${modulo}${q ? `?${q}` : ''}`;
  },
};

// ---------- interfaz ----------
const $ = (s) => document.querySelector(s);

function pintarSelector() {
  const sel = $('#semana');
  if (!app.semanas.length) { sel.innerHTML = '<option>Sin semanas cargadas</option>'; sel.disabled = true; return; }
  sel.disabled = false;
  sel.innerHTML = app.semanas.map((s, i) =>
    `<option value="${s.id}" ${s.id === app.semana?.id ? 'selected' : ''}>${i === 0 ? 'Última: ' : ''}${rangoSemana(s.inicio, s.fin)}</option>`).join('');
  const i = app.semanas.findIndex((s) => s.id === app.semana?.id);
  $('#sem-prev').disabled = i >= app.semanas.length - 1;
  $('#sem-next').disabled = i <= 0;
}

async function cambiarSemana(id) {
  const main = $('#contenido');
  main.setAttribute('aria-busy', 'true');
  try { await app.seleccionarSemana(id); pintarSelector(); await render(); }
  catch (e) { aviso(e.message, 'error'); }
  finally { main.removeAttribute('aria-busy'); }
}

async function render() {
  const [, ruta = 'resumen', query = ''] = location.hash.match(/^#\/([a-z]+)\??(.*)$/) || [];
  app.modulo = MODULOS[ruta] ? ruta : 'resumen';
  app.params = Object.fromEntries(new URLSearchParams(query));
  document.querySelectorAll('[data-mod]').forEach((a) => a.setAttribute('aria-current', a.dataset.mod === app.modulo ? 'page' : 'false'));
  const mod = MODULOS[app.modulo];
  document.title = `${mod.titulo} · Planificación de tareas`;
  limpiarGraficos();
  window.scrollTo(0, 0);
  const main = $('#contenido');
  if (!app.semanas.length && app.modulo !== 'carga') {
    main.innerHTML = `<section class="vacio-inicial">
      <h1>Todavía no hay planificaciones cargadas</h1>
      <p>Subí el Excel semanal de cada área para empezar. Si tenés los dashboards anteriores, también podés migrar su historial.</p>
      <a class="btn primario" href="#/carga">Ir a Carga</a></section>`;
    return;
  }
  main.innerHTML = '<div class="cargando">Cargando…</div>';
  try { await mod.render(main, app); }
  catch (e) { console.error(e); main.innerHTML = `<div class="error-bloque"><h2>No se pudo mostrar ${esc(mod.titulo)}</h2><p>${esc(e.message)}</p></div>`; }
  main.focus({ preventScroll: true });
}

async function entrarApp() {
  $('#app').hidden = false;
  $('#contenido').innerHTML = '<div class="cargando">Cargando semanas…</div>';
  const [semanas, areas] = await Promise.all([db.semanas(), db.areas(), app.cargarContexto()]);
  app.semanas = semanas; app.areas = areas;
  // Al abrir: última semana cargada (no la semana calendario).
  await app.seleccionarSemana(app.semanas[0]?.id);
  pintarSelector();
  await render();
}

async function iniciar() {
  db.configurarPedidoDeClave(pedirClave);
  try { await db.iniciar(); }
  catch (e) { document.body.innerHTML = `<div class="error-bloque"><h1>Configuración incompleta</h1><p>${esc(e.message)}</p></div>`; return; }

  $('#semana').addEventListener('change', (e) => cambiarSemana(e.target.value));
  $('#sem-prev').addEventListener('click', () => { const i = app.semanas.findIndex((s) => s.id === app.semana.id); if (app.semanas[i + 1]) cambiarSemana(app.semanas[i + 1].id); });
  $('#sem-next').addEventListener('click', () => { const i = app.semanas.findIndex((s) => s.id === app.semana.id); if (i > 0) cambiarSemana(app.semanas[i - 1].id); });
  window.addEventListener('hashchange', render);

  try { await entrarApp(); }
  catch (e) { $('#app').hidden = false; $('#contenido').innerHTML = `<div class="error-bloque"><h2>No se pudieron cargar los datos</h2><p>${esc(e.message)}</p></div>`; }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

iniciar();
