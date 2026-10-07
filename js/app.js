// =====================================================================
// Planificación de tareas — núcleo de la aplicación
// =====================================================================
import * as db from './db.js';
import { esc, rangoSemana, limpiarGraficos, aviso, pedirClave, multiSelect } from './ui.js';
import { addDays, CTX } from './engine.js';
import { olvidarSituaciones } from './situaciones.js';
import * as resumen from './modules/resumen.js';
import * as planificacion from './modules/planificacion.js';
import * as riesgos from './modules/riesgos.js';
import * as evolucion from './modules/evolucion.js';
import * as mejoras from './modules/mejoras.js';
import * as repetitivas from './modules/repetitivas.js';
import * as carga from './modules/carga.js';

const MODULOS = { resumen, planificacion, riesgos, mejoras, evolucion, repetitivas, carga };
// Ruta anterior: Personas se integró en Planificación (detalle del mapa de calor) y en Carga (jornada y horas reales).
// Los enlaces guardados siguen funcionando.
const RUTAS_ANTERIORES = { personas: 'planificacion' };

// ---------- estado compartido (una sola fuente de datos para todos los módulos) ----------
export const app = {
  semanas: [],          // [{id, inicio, fin, actividades}] desc
  semana: null,         // semana seleccionada
  filas: [],            // actividades de la semana seleccionada (ya filtradas por los filtros globales)
  filasPrevia: [],      // actividades de la semana anterior cargada (ídem)
  cambiosSemana: [],    // cambios posteriores a la primera carga (semana seleccionada, ídem)
  areas: [],
  personas: [],         // catálogo de personas [{id, nombre, area}] para los filtros
  // Una fila por persona, semana y área del Excel donde planificó. Alimenta el cuadro de carga
  // del Resumen y dice en qué áreas aparece cada persona (criterio del filtro de área).
  personaSemana: [],
  _areasPersona: new Map(),   // nombre → Set de áreas en cuyo Excel planificó alguna vez
  // Filtros globales: se aplican a todas las hojas y se conservan al navegar y al recargar la página.
  filtros: { areas: [], personas: [] },
  _limpiadores: new Map(),   // cada hoja registra cómo limpiar sus filtros propios
  _sinFiltrar: { filas: [], previa: [], cambios: [] },
  modulo: 'resumen',
  params: {},
  _cache: new Map(),
  _completas: new Set(),
  _cacheCambios: new Map(),
  // Propuestas de mejora registradas (null = la base todavía no tiene la tabla) e historial de cargas
  propuestas: [],
  propuestasDisponibles: true,
  importaciones: [],

  // ¿La fila pasa los filtros globales? (actividades, cambios o registros persona-semana)
  pasa(r) {
    const f = this.filtros;
    return (!f.areas.length || f.areas.includes(r.area)) && (!f.personas.length || f.personas.includes(r.persona));
  },
  // Áreas de una persona: las de los Excel donde planificó. Si todavía no planificó, la de su ficha.
  areasDePersona(nombre) {
    const s = this._areasPersona.get(nombre);
    if (s?.size) return s;
    const area = this.personas.find((p) => p.nombre === nombre)?.area;
    return new Set(area ? [area] : []);
  },
  personaEnAreas(nombre, areas) {
    if (!areas.length) return true;
    const propias = this.areasDePersona(nombre);
    return areas.some((a) => propias.has(a));
  },
  async cargarPersonaSemana() {
    this.personaSemana = await db.personaSemana();
    this._areasPersona = new Map();
    for (const r of this.personaSemana) {
      if (!r.area) continue;
      if (!this._areasPersona.has(r.persona)) this._areasPersona.set(r.persona, new Set());
      this._areasPersona.get(r.persona).add(r.area);
    }
  },

  hayFiltros() {
    const propios = Object.values(this._filtrosHoja).reduce((a, f) => a + Object.values(f).reduce((b, v) => b + (Array.isArray(v) ? v.length : v ? 1 : 0), 0), 0);
    return this.filtros.areas.length + this.filtros.personas.length + propios;
  },

  // Cambia filtros globales (desde la barra o desde una hoja) y vuelve a dibujar la hoja actual
  async fijarFiltros(patch, { redibujar = true } = {}) {
    Object.assign(this.filtros, patch);
    // una persona seleccionada que nunca planificó en las áreas elegidas deja de estar seleccionada
    if (this.filtros.areas.length) {
      this.filtros.personas = this.filtros.personas.filter((n) => this.personaEnAreas(n, this.filtros.areas));
    }
    try { sessionStorage.setItem('planif.filtros', JSON.stringify(this.filtros)); } catch { /* preferencia opcional */ }
    this.aplicarFiltros();
    pintarFiltros({ cambioAreas: 'areas' in patch });
    if (redibujar) await render({ mantenerScroll: true });
  },

  aplicarFiltros() {
    const p = (r) => this.pasa(r);
    this.filas = this._sinFiltrar.filas.filter(p);
    this.filasPrevia = this._sinFiltrar.previa.filter(p);
    this.cambiosSemana = this._sinFiltrar.cambios.filter(p);
  },

  // Cada hoja registra una función que limpia sus filtros propios (día, prioridad, nivel…)
  registrarLimpieza(modulo, limpiar, cuenta) { this._limpiadores.set(modulo, { limpiar, cuenta }); },
  refrescarContadorFiltros() { pintarFiltros(); this.guardarFiltrosHoja(); },
  // Filtros propios de cada hoja: se guardan en la sesión del navegador junto con los globales
  _filtrosHoja: {},
  filtrosHoja(modulo, inicial) {
    const obj = { ...inicial, ...(this._filtrosHoja[modulo] || {}) };
    this._filtrosHoja[modulo] = obj;
    return obj;
  },
  guardarFiltrosHoja() { try { sessionStorage.setItem('planif.filtrosHoja', JSON.stringify(this._filtrosHoja)); } catch { /* opcional */ } },
  async limpiarFiltros() {
    this._limpiadores.forEach((x) => x.limpiar());
    // también los de hojas no visitadas en esta sesión (se vacían en el mismo objeto que usa cada hoja)
    Object.values(this._filtrosHoja).forEach((f) => Object.keys(f).forEach((k) => { if (Array.isArray(f[k])) f[k].length = 0; else f[k] = ''; }));
    this.guardarFiltrosHoja();
    await this.fijarFiltros({ areas: [], personas: [] });
  },

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
    const p = (r) => this.pasa(r);
    return {
      semanas: semanas.map((s) => s.inicio),
      rows: semanas.flatMap((s) => this._cache.get(s.id)).filter(p),
      cambios: semanas.flatMap((s) => this._cacheCambios.get(s.id)).filter(p),
    };
  },

  // Datos cargados en la aplicación que valen para todas las semanas
  async cargarContexto() {
    const [riesgos, excepciones, importaciones] = await Promise.all([db.riesgosEvaluados(), db.excepcionesAuditoria(),
      db.importaciones(1000).catch(() => []), this.cargarPropuestas()]);
    CTX.riesgos = new Map(riesgos.map((x) => [`${x.persona_id}|${x.riesgo_norm}`, { prob: x.prob, impacto: x.impacto }]));
    CTX.excepciones = new Set(excepciones.map((x) => `${x.persona_id}|${x.tarea_norm}|${x.regla}`));
    this.importaciones = importaciones;
  },
  async cargarPropuestas() {
    try {
      const ps = await db.propuestas();
      this.propuestasDisponibles = ps !== null;
      this.propuestas = ps || [];
    } catch (e) { console.error(e); this.propuestas = []; }
  },
  // Propuestas visibles con los filtros globales de área (las que no tienen área se ven siempre)
  propuestasVisibles() {
    const a = this.filtros.areas;
    return this.propuestas.filter((p) => !a.length || !p.area || a.includes(p.area));
  },

  actualizarPersona(personaId, patch) {
    for (const rows of this._cache.values()) rows.forEach((r) => { if (r.personaId === personaId) Object.assign(r, patch); });
  },

  async seleccionarSemana(id) {
    this.semana = this.semanas.find((s) => s.id === id) || this.semanas[0] || null;
    if (!this.semana) { this._sinFiltrar = { filas: [], previa: [], cambios: [] }; this.aplicarFiltros(); return; }
    const prev = this.semanaPrevia();
    const sems = prev ? [this.semana, prev] : [this.semana];
    await this.filasDe(sems, { completas: true });
    this._sinFiltrar = {
      filas: this._cache.get(this.semana.id) || [],
      previa: prev ? this._cache.get(prev.id) || [] : [],
      cambios: (this._cacheCambios.get(this.semana.id) || []),
    };
    this.aplicarFiltros();
  },

  // Se llama después de una carga: recarga la lista de semanas y vacía la caché
  async refrescar(semanaInicio = null) {
    this._cache.clear(); this._completas.clear(); this._cacheCambios.clear(); CTX.reales.clear(); olvidarSituaciones();
    await this.cargarContexto();
    this.semanas = await db.semanas();
    this.areas = await db.areas();
    this.personas = await db.personas();
    await this.cargarPersonaSemana();
    armarFiltros();
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

async function render(opc = {}) {
  const mantenerScroll = opc && opc.mantenerScroll === true;
  const [, ruta = 'resumen', query = ''] = location.hash.match(/^#\/([a-z]+)\??(.*)$/) || [];
  if (RUTAS_ANTERIORES[ruta]) { history.replaceState(null, '', `#/${RUTAS_ANTERIORES[ruta]}${query ? `?${query}` : ''}`); return render(opc); }
  app.modulo = MODULOS[ruta] ? ruta : 'resumen';
  app.params = Object.fromEntries(new URLSearchParams(query));
  document.querySelectorAll('[data-mod]').forEach((a) => a.setAttribute('aria-current', a.dataset.mod === app.modulo ? 'page' : 'false'));
  const mod = MODULOS[app.modulo];
  document.title = `${mod.titulo} · Planificación de tareas`;
  limpiarGraficos();
  if (!mantenerScroll) window.scrollTo(0, 0);
  document.body.classList.toggle('sin-filtros-globales', app.modulo === 'carga');
  const main = $('#contenido');
  if (!app.semanas.length && app.modulo !== 'carga') {
    main.innerHTML = `<section class="vacio-inicial">
      <h1>Todavía no hay planificaciones cargadas</h1>
      <p>Subí el Excel semanal de cada área para empezar. Si tenés los dashboards anteriores, también podés migrar su historial.</p>
      <a class="btn primario" href="#/carga">Ir a Carga</a></section>`;
    return;
  }
  if (!mantenerScroll) main.innerHTML = '<div class="cargando">Cargando…</div>';
  try { await mod.render(main, app); pintarFiltros(); }
  catch (e) { console.error(e); main.innerHTML = `<div class="error-bloque"><h2>No se pudo mostrar ${esc(mod.titulo)}</h2><p>${esc(e.message)}</p></div>`; }
  if (!mantenerScroll) main.focus({ preventScroll: true });
}

// ---------- filtros globales (barra superior) ----------
// Los desplegables se arman una vez; al filtrar solo se actualiza lo necesario (el panel abierto no se cierra).
const MS = { area: null, persona: null };
function armarFiltroPersona() {
  // Cada persona aparece una sola vez: agrupada en un área elegida donde planificó,
  // si no en el área de su ficha (si planificó ahí), si no en la primera donde planificó.
  const fa = app.filtros.areas;
  const opciones = app.personas
    .filter((p) => app.personaEnAreas(p.nombre, fa))
    .map((p) => {
      const propias = app.areasDePersona(p.nombre);
      const grupo = fa.find((a) => propias.has(a)) || (propias.has(p.area) ? p.area : [...propias].sort((a, b) => a.localeCompare(b, 'es'))[0]) || 'Sin área';
      return { valor: p.nombre, texto: p.nombre, grupo };
    })
    .sort((a, b) => a.grupo.localeCompare(b.grupo, 'es') || a.texto.localeCompare(b.texto, 'es'));
  const nuevo = multiSelect({ etiqueta: 'Persona', opciones, seleccion: app.filtros.personas, todos: 'Todas', compacto: true,
    onChange: (v) => app.fijarFiltros({ personas: v }) });
  if (MS.persona) MS.persona.replaceWith(nuevo); else $('#filtros-globales').append(nuevo);
  MS.persona = nuevo;
}
function armarFiltros() {
  const cont = $('#filtros-globales');
  cont.replaceChildren();
  MS.area = multiSelect({ etiqueta: 'Área', opciones: app.areas.map((a) => ({ valor: a.nombre, texto: a.nombre })), seleccion: app.filtros.areas,
    todos: 'Todas', compacto: true, onChange: (v) => app.fijarFiltros({ areas: v }) });
  cont.append(MS.area);
  MS.persona = null;
  armarFiltroPersona();
  pintarFiltros();
}
// Sincroniza los desplegables con el estado y actualiza el botón "Limpiar filtros"
function pintarFiltros({ cambioAreas = false } = {}) {
  if (!MS.area) return;
  if (cambioAreas) armarFiltroPersona();
  MS.area.fijar(app.filtros.areas);
  MS.persona.fijar(app.filtros.personas);
  const n = app.hayFiltros();
  const b = $('#limpiar-filtros');
  b.disabled = !n;
  b.innerHTML = `Limpiar<span class="lf-largo"> filtros</span>${n ? ` <span class="cnt">${n}</span>` : ''}`;
}

async function entrarApp() {
  $('#app').hidden = false;
  $('#contenido').innerHTML = '<div class="cargando">Cargando semanas…</div>';
  const [semanas, areas, personas] = await Promise.all([db.semanas(), db.areas(), db.personas(), app.cargarContexto(), app.cargarPersonaSemana()]);
  app.semanas = semanas; app.areas = areas; app.personas = personas;
  try { const f = JSON.parse(sessionStorage.getItem('planif.filtros') || 'null'); if (f) app.filtros = { areas: f.areas || [], personas: f.personas || [] }; } catch { /* sin filtros guardados */ }
  try { app._filtrosHoja = JSON.parse(sessionStorage.getItem('planif.filtrosHoja') || '{}'); } catch { app._filtrosHoja = {}; }
  // Al abrir: última semana cargada (no la semana calendario).
  await app.seleccionarSemana(app.semanas[0]?.id);
  pintarSelector();
  armarFiltros();
  await render();
}

async function iniciar() {
  db.configurarPedidoDeClave(pedirClave);
  try { await db.iniciar(); }
  catch (e) { document.body.innerHTML = `<div class="error-bloque"><h1>Configuración incompleta</h1><p>${esc(e.message)}</p></div>`; return; }

  $('#semana').addEventListener('change', (e) => cambiarSemana(e.target.value));
  $('#sem-prev').addEventListener('click', () => { const i = app.semanas.findIndex((s) => s.id === app.semana.id); if (app.semanas[i + 1]) cambiarSemana(app.semanas[i + 1].id); });
  $('#sem-next').addEventListener('click', () => { const i = app.semanas.findIndex((s) => s.id === app.semana.id); if (i > 0) cambiarSemana(app.semanas[i - 1].id); });
  window.addEventListener('hashchange', () => render());
  $('#limpiar-filtros').addEventListener('click', () => app.limpiarFiltros());

  try { await entrarApp(); }
  catch (e) { $('#app').hidden = false; $('#contenido').innerHTML = `<div class="error-bloque"><h2>No se pudieron cargar los datos</h2><p>${esc(e.message)}</p></div>`; }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

iniciar();
