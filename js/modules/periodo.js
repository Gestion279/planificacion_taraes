// =====================================================================
// Período compartido por Evolución y Propuestas de mejora:
// al cambiarlo en una hoja, se mantiene en las otras. Área y Persona son filtros
// globales (barra superior) y ya vienen aplicados en app.filasDe().
// =====================================================================
import { addDays } from '../engine.js';
import { esc, opciones, etiquetaSemana } from '../ui.js';

const PERIODOS = [['1', 'Última semana'], ['4', 'Últimas 4 semanas'], ['8', 'Últimas 8 semanas'], ['m3', 'Últimos 3 meses'], ['rango', 'Período personalizado']];
export const F = { periodo: '8', desde: '', hasta: '' };

// Dibuja encabezado + filtros y devuelve los datos filtrados y el contenedor para el contenido de la hoja.
export async function prepararPeriodo(el, app, { titulo, alCambiar }) {
  const asc = [...app.semanas].reverse();
  if (!F.desde) F.desde = asc[0]?.inicio; if (!F.hasta) F.hasta = app.semana.inicio;
  const semanas = F.periodo === 'rango' ? app.semanasDePeriodo({ tipo: 'rango', desde: F.desde, hasta: F.hasta })
    : F.periodo === 'm3' ? app.semanasDePeriodo({ tipo: 'meses', n: 3 }) : app.semanasDePeriodo({ tipo: 'n', n: +F.periodo });
  const { rows: todas, cambios: cambiosTodos } = await app.filasDe(semanas);
  const rows = todas;
  const cambios = cambiosTodos;
  const fg = app.filtros;
  const alcance = fg.personas.length ? (fg.personas.length === 1 ? fg.personas[0] : `${fg.personas.length} personas`) : fg.areas.length ? fg.areas.join(', ') : '';
  const iso = semanas.map((s) => s.inicio);
  const faltan = [];
  for (let i = 1; i < iso.length; i++) for (let d = addDays(iso[i - 1], 7); d < iso[i]; d = addDays(d, 7)) faltan.push(d);

  el.innerHTML = `
  <header class="mod-cab"><h1>${esc(titulo)}</h1><p class="sub">${semanas.length} ${semanas.length === 1 ? 'semana' : 'semanas'}${semanas.length ? `, del ${etiquetaSemana(iso[0])} al ${etiquetaSemana(iso.at(-1))}` : ''}${alcance ? `, ${esc(alcance)}` : ''}</p></header>
  <form class="filtros">
    <label>Período<select name="periodo">${opciones(PERIODOS, F.periodo)}</select></label>
    ${F.periodo === 'rango' ? `<label>Desde<select name="desde">${opciones(asc.map((s) => [s.inicio, etiquetaSemana(s.inicio)]), F.desde)}</select></label>
      <label>Hasta<select name="hasta">${opciones(asc.map((s) => [s.inicio, etiquetaSemana(s.inicio)]), F.hasta)}</select></label>` : ''}
  </form>
  ${faltan.length ? `<p class="aviso-panel">En este período ${faltan.length === 1 ? 'hay una semana sin carga' : `hay ${faltan.length} semanas sin carga`}: ${faltan.map(etiquetaSemana).join(', ')}. Solo se analizan las semanas cargadas.</p>` : ''}
  <div data-hoja></div>`;
  el.querySelector('.filtros').addEventListener('change', (e) => { F[e.target.name] = e.target.value; alCambiar(); });
  const cont = el.querySelector('[data-hoja]');
  if (!rows.length) cont.innerHTML = '<p class="vacio panel">Sin actividades para los filtros elegidos.</p>';
  return { rows, cambios, iso, n: iso.length, cont };
}

// Elegir una persona desde el contenido de la hoja (por ejemplo, al tocar una fila): filtro global
export function elegirPersona(app, persona) { app.fijarFiltros({ personas: [persona] }); }
