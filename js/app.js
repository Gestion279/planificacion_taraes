// =====================================================================
// Planificación de tareas — núcleo de la aplicación
// =====================================================================
import * as db from './db.js';
import { esc, h, rangoSemana, limpiarGraficos, aviso } from './ui.js';
import { addDays } from './engine.js';
import * as resumen from './modules/resumen.js';
import * as planificacion from './modules/planificacion.js';
import * as personas from './modules/personas.js';
import * as riesgos from './modules/riesgos.js';
import * as evolucion from './modules/evolucion.js';
import * as carga from './modules/carga.js';

const MODULOS = { resumen, planificacion, personas, riesgos, evolucion, carga };

// ---------- estado compartido (una sola fuente de datos para todos los módulos) ----------
export const app = {
  usuario: null,
  semanas: [],          // [{id, inicio, fin, actividades}] desc
  semana: null,         // semana seleccionada
  filas: [],            // actividades de la semana seleccionada
  filasPrevia: [],      // actividades de la semana anterior cargada
  cambiosSemana: [],    // cambios posteriores a la primera carga (semana seleccionada)
  areas: [],
  modulo: 'resumen',
  params: {},
  _cache: new Map(),
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

  async filasDe(semanas) {
    const faltan = semanas.filter((s) => !this._cache.has(s.id)).map((s) => s.id);
    if (faltan.length) {
      const [rows, cambios] = await Promise.all([db.actividades(faltan), db.cambios(faltan)]);
      faltan.forEach((id) => { this._cache.set(id, []); this._cacheCambios.set(id, []); });
      rows.forEach((r) => this._cache.get(r.semanaId).push(r));
      cambios.forEach((c) => this._cacheCambios.get(c.semanaId)?.push(c));
    }
    return {
      semanas: semanas.map((s) => s.inicio),
      rows: semanas.flatMap((s) => this._cache.get(s.id)),
      cambios: semanas.flatMap((s) => this._cacheCambios.get(s.id)),
    };
  },

  async seleccionarSemana(id) {
    this.semana = this.semanas.find((s) => s.id === id) || this.semanas[0] || null;
    if (!this.semana) { this.filas = []; this.filasPrevia = []; this.cambiosSemana = []; return; }
    const prev = this.semanaPrevia();
    const { rows, cambios } = await this.filasDe([this.semana]);
    this.filas = rows; this.cambiosSemana = cambios;
    this.filasPrevia = prev ? (await this.filasDe([prev])).rows : [];
    try { localStorage.setItem('planif.semana', this.semana.id); } catch { /* preferencia de interfaz opcional */ }
  },

  // Se llama después de una carga: recarga la lista de semanas y vacía la caché
  async refrescar(semanaInicio = null) {
    this._cache.clear(); this._cacheCambios.clear();
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

function pantallaLogin(error = '') {
  document.body.classList.add('sin-sesion');
  $('#app').hidden = true;
  let el = $('#login');
  if (!el) {
    el = h(`<main id="login" class="login">
      <form class="login-caja">
        <img src="/icons/icon.svg" alt="" width="64" height="64">
        <h1>Planificación de tareas</h1>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="login-error" role="alert"></p>
        <button class="btn primario" type="submit">Ingresar</button>
      </form></main>`);
    document.body.appendChild(el);
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Ingresando…';
      try { await db.auth.entrar(f.get('email'), f.get('password')); }
      catch (err) { el.querySelector('.login-error').textContent = err.message; }
      finally { b.disabled = false; b.textContent = 'Ingresar'; }
    });
  }
  el.hidden = false;
  el.querySelector('.login-error').textContent = error;
}

async function entrarApp(sesion) {
  if (app.usuario?.id === sesion.user.id) return;
  app.usuario = sesion.user;
  document.body.classList.remove('sin-sesion');
  $('#login')?.setAttribute('hidden', '');
  $('#app').hidden = false;
  $('#usuario').textContent = sesion.user.email;
  $('#contenido').innerHTML = '<div class="cargando">Cargando semanas…</div>';
  app.semanas = await db.semanas();
  app.areas = await db.areas();
  let guardada = null;
  try { guardada = localStorage.getItem('planif.semana'); } catch { /* sin preferencias */ }
  // Al abrir: última semana cargada (no la semana calendario). Se respeta la última elegida en esta sesión del navegador solo si sigue existiendo.
  const inicial = sessionStorage.getItem('planif.sesionIniciada') && app.semanas.some((s) => s.id === guardada) ? guardada : app.semanas[0]?.id;
  sessionStorage.setItem('planif.sesionIniciada', '1');
  await app.seleccionarSemana(inicial);
  pintarSelector();
  await render();
}

async function iniciar() {
  try { await db.iniciar(); }
  catch (e) { document.body.innerHTML = `<div class="error-bloque"><h1>Configuración incompleta</h1><p>${esc(e.message)}</p></div>`; return; }

  $('#semana').addEventListener('change', (e) => cambiarSemana(e.target.value));
  $('#sem-prev').addEventListener('click', () => { const i = app.semanas.findIndex((s) => s.id === app.semana.id); if (app.semanas[i + 1]) cambiarSemana(app.semanas[i + 1].id); });
  $('#sem-next').addEventListener('click', () => { const i = app.semanas.findIndex((s) => s.id === app.semana.id); if (i > 0) cambiarSemana(app.semanas[i - 1].id); });
  $('#salir').addEventListener('click', async () => { await db.auth.salir(); location.hash = ''; location.reload(); });
  window.addEventListener('hashchange', render);

  db.auth.alCambiar((s) => { if (s) entrarApp(s).catch((e) => aviso(e.message, 'error')); else if (app.usuario) location.reload(); });
  const sesion = await db.auth.sesion();
  if (sesion) await entrarApp(sesion); else pantallaLogin();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

iniciar();
