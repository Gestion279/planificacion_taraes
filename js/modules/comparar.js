// =====================================================================
// 👥 Comparar personas — la misma tarea (o una parecida) hecha por distintas personas.
// Se eligen las personas y el tipo de tarea (acción); la hoja muestra cuánto pesa esa acción
// para cada una y una tabla tarea por tarea con una columna por persona.
// Las tareas se agrupan con los grupos de tareas similares de la base y, si no tienen grupo,
// por texto parecido. Respeta el período compartido y los filtros globales de área y persona.
// =====================================================================
import { comparacionPersonas, horasPorAccion, groupBy, SIN_ACCION } from '../engine.js';
import { esc, num, horas, porc, opciones, multiSelect } from '../ui.js';
import { prepararPeriodo } from './periodo.js';

export const titulo = 'Comparar personas';

const MEDIDAS = [['', 'Horas por semana'], ['acum', 'Horas acumuladas'], ['sem', 'Semanas']];
const COLORES = ['#4B5557', '#C88B58', '#56703F', '#8F5A2B', '#9A7020', '#636E70', '#BCB48C', '#A8322D'];
const MAX_PERSONAS = 8;
let iniciada = false;   // la primera vez se eligen solas las personas con más horas en la acción
let abierta = null;     // fila con el detalle abierto

export async function render(el, app) {
  const volver = () => render(el, app);
  const { rows, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: volver });
  if (!rows.length) return;

  const F = app.filtrosHoja('comparar', { personas: [], accion: '', tarea: '', medida: '', compartidas: '' });
  const acciones = horasPorAccion(rows).filter((a) => a.horas > 0).map((a) => a.accion);
  const accion = acciones.includes(F.accion) ? F.accion : acciones[0];

  // horas de cada persona en la acción, para ordenar y para los atajos
  const enAccion = [...groupBy(rows.filter((r) => (r.accion || SIN_ACCION) === accion), (r) => r.persona)]
    .map(([persona, rs]) => ({ persona, horas: rs.reduce((a, r) => a + (r.horas || 0), 0) }))
    .filter((p) => p.horas > 0).sort((a, b) => b.horas - a.horas);
  const presentes = [...new Set(rows.map((r) => r.persona))].sort((a, b) => a.localeCompare(b, 'es'));

  if (!iniciada && !F.personas.length) { F.personas.push(...enAccion.slice(0, 5).map((p) => p.persona)); iniciada = true; app.guardarFiltrosHoja(); }
  const personas = F.personas.filter((p) => presentes.includes(p));
  const color = (p) => COLORES[personas.indexOf(p) % COLORES.length];

  const { resumen, grupos: todos } = comparacionPersonas(rows, { personas, accion });
  const tareaSel = todos.some((g) => g.clave === F.tarea) ? F.tarea : '';
  const grupos = todos.filter((g) => (!tareaSel || g.clave === tareaSel) && (!F.compartidas || g.personas > 1));
  const compartidas = todos.filter((g) => g.personas > 1);
  const medida = MEDIDAS.some(([k]) => k === F.medida) ? F.medida : '';
  const valor = (p) => (!p ? null : medida === 'acum' ? p.horas : medida === 'sem' ? p.semanas : p.horasSemana);
  const fmt = (v) => (v === null || v === undefined ? '—' : medida === 'sem' ? num(v, 0) : horas(v));
  const maxVal = Math.max(1, ...grupos.flatMap((g) => personas.map((p) => valor(g.porPersona.get(p)) || 0)));
  const maxRes = Math.max(1, ...resumen.map((r) => r.horasSemana || 0));

  cont.innerHTML = `
  <p class="intro">Elegí a quiénes y qué tipo de tareas comparar. Las tareas iguales o parecidas de distintas personas se juntan en una fila, con el mismo criterio de tareas similares del resto del informe. Antes de sacar conclusiones, revisá si el volumen es el mismo.</p>
  <form class="filtros filtros-hoja comp-filtros">
    <div data-ms="personas"></div>
    <label>Tipo de tarea (acción)<select name="accion">${opciones(acciones.map((a) => [a, a]), accion)}</select></label>
    <label class="crece">Tarea<select name="tarea">${opciones([['', `Todas las tareas de ${accion}`], ...todos.map((g) => [g.clave, g.tarea])], tareaSel)}</select></label>
    <fieldset class="comp-medida"><legend>Medir en</legend><div class="comp-seg">${MEDIDAS.map(([k, l]) => `<button type="button" data-medida="${k}" aria-pressed="${k === medida}">${l}</button>`).join('')}</div></fieldset>
  </form>
  <div class="comp-atajos">
    <button type="button" data-atajo="accion">Todas las que hacen ${esc(accion)} (${enAccion.length > MAX_PERSONAS ? `las ${MAX_PERSONAS} con más horas` : enAccion.length})</button>
    <button type="button" data-atajo="comparten">Solo las que comparten alguna tarea</button>
    <button type="button" data-atajo="ninguna">Quitar todas</button>
  </div>
  ${!personas.length ? '<p class="vacio panel">Elegí al menos una persona para comparar.</p>' : `
  <section class="panel" aria-labelledby="comp-r">
    <header class="panel-cab"><h2 id="comp-r">${esc(accion)} en la semana de cada persona</h2><span class="tenue">Horas por semana planificada</span></header>
    <div class="comp-resumen">${resumen.map((r) => `
      <div class="comp-rfila">
        <span class="nom"><span class="comp-punto" style="background:${color(r.persona)}" aria-hidden="true"></span>${esc(r.persona)}</span>
        <span class="comp-barra" aria-hidden="true"><span style="width:${(((r.horasSemana || 0) / maxRes) * 100).toFixed(1)}%;background:${color(r.persona)}"></span></span>
        <b class="num">${r.horas ? horas(r.horasSemana) : '—'}</b>
        <span class="tenue">${r.horas ? `${porc(r.pctHoras)} de lo que planificó` : `No planificó ${esc(accion)}`}</span>
      </div>`).join('')}</div>
  </section>
  <section class="panel" aria-labelledby="comp-t">
    <header class="panel-cab"><h2 id="comp-t">Tarea por tarea</h2>
      <label class="comp-check"><input type="checkbox" data-compartidas ${F.compartidas ? 'checked' : ''}>Solo tareas que hacen 2 personas o más (${compartidas.length})</label></header>
    ${!grupos.length ? `<p class="vacio">${F.compartidas ? 'Las personas elegidas no comparten ninguna tarea de esta acción en el período.' : `Las personas elegidas no tienen tareas de ${esc(accion)} en el período.`}</p>` : `
    <div class="tabla-scroll"><table class="tabla compacta comp-tabla">
      <thead><tr><th>Tarea</th>${personas.map((p) => `<th class="num">${esc(p)}</th>`).join('')}<th class="num">Diferencia</th></tr></thead>
      <tbody>${grupos.map((g, i) => {
        const ab = abierta === g.clave;
        return `<tr class="clic ${ab ? 'comp-abierta' : ''}" data-fila="${i}" tabindex="0" aria-expanded="${ab}">
          <td><span class="comp-tarea">${esc(g.tarea)}</span>${g.similar ? `<span class="tenue bloque">${g.variantes} ${g.variantes === 1 ? 'variante' : 'variantes'} agrupadas</span>` : ''}</td>
          ${personas.map((p) => { const v = valor(g.porPersona.get(p)); return v === null || v === undefined
            ? '<td class="num tenue">—</td>' : `<td class="num comp-celda" style="background:${tono(v / maxVal)}"><b>${fmt(v)}</b></td>`; }).join('')}
          <td class="num">${g.relacion ? `<b>${num(g.relacion)} veces</b>` : '<span class="tenue">—</span>'}</td></tr>
          ${ab ? `<tr class="comp-det"><td colspan="${personas.length + 2}">${detalle(g, personas)}</td></tr>` : ''}`;
      }).join('')}</tbody>
    </table></div>`}
    <p class="nota">h por semana: horas de la persona en la tarea dividido las semanas en que la hizo. Diferencia: h por semana de quien más dedica ÷ las de quien menos, en tareas con 2 personas o más. Tocá una fila para ver cómo la cargó cada uno.</p>
  </section>`}`;

  // ---------- eventos ----------
  const guardar = () => { app.guardarFiltrosHoja(); volver(); };
  cont.querySelector('[data-ms="personas"]').replaceWith(multiSelect({
    etiqueta: 'Personas', opciones: presentes.map((p) => ({ valor: p, texto: p })), seleccion: personas, todos: 'Elegir personas',
    onChange: (v) => { F.personas.splice(0, F.personas.length, ...v.slice(0, 30)); app.refrescarContadorFiltros(); volver(); },
  }));
  cont.querySelector('.comp-filtros').addEventListener('change', (e) => {
    if (!e.target.name) return;
    F[e.target.name] = e.target.value;
    if (e.target.name === 'accion') { F.tarea = ''; abierta = null; }
    guardar();
  });
  cont.querySelectorAll('[data-medida]').forEach((b) => b.addEventListener('click', () => { F.medida = b.dataset.medida; guardar(); }));
  cont.querySelector('[data-compartidas]')?.addEventListener('change', (e) => { F.compartidas = e.target.checked ? '1' : ''; guardar(); });
  cont.querySelectorAll('[data-atajo]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.atajo;
    let lista = [];
    if (k === 'accion') lista = enAccion.slice(0, MAX_PERSONAS).map((p) => p.persona);
    if (k === 'comparten') {
      const todas = comparacionPersonas(rows, { personas: enAccion.map((p) => p.persona), accion }).grupos.filter((g) => g.personas > 1);
      lista = [...new Set(todas.flatMap((g) => [...g.porPersona.keys()]))];
    }
    F.personas.splice(0, F.personas.length, ...lista);
    app.refrescarContadorFiltros(); volver();
  }));
  cont.querySelectorAll('[data-fila]').forEach((tr) => {
    const g = grupos[+tr.dataset.fila];
    const abrir = () => { abierta = abierta === g.clave ? null : g.clave; volver(); };
    tr.addEventListener('click', abrir);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });
}

// Cómo cargó la tarea cada persona: sus textos (variantes), semanas, veces y horas
function detalle(g, personas) {
  const filas = personas.map((p) => g.porPersona.get(p)).filter(Boolean);
  return `<div class="comp-detalle">
    <b>${esc(g.tarea)} · cómo la cargó cada uno</b>
    ${filas.map((p) => `<div class="comp-dfila">
      <span class="nom">${esc(p.persona)}</span>
      <span>${p.textos.slice(0, 4).map(esc).join(' · ')}${p.textos.length > 4 ? ` y ${p.textos.length - 4} más` : ''}</span>
      <span class="tenue">${p.semanas} ${p.semanas === 1 ? 'semana' : 'semanas'} · ${p.veces} ${p.veces === 1 ? 'vez' : 'veces'} · ${p.horasSemana ? `${horas(p.horasSemana)} por semana` : 'sin tiempo cargado'}</span>
    </div>`).join('')}
  </div>`;
}

// Intensidad de la celda: de Summer Sun aclarado a Council Bluffs
function tono(t) {
  return t >= 0.75 ? '#E0B48A' : t >= 0.5 ? '#EDCBA6' : t >= 0.25 ? '#F3DFC6' : '#F8EEE1';
}
