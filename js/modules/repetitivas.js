// =====================================================================
// 🔁 Tareas repetitivas — Top 5 por persona.
// Detección visual: qué tareas se repiten, cuántas veces y cuánto tiempo acumulan.
// Una tarea repetitiva NO se convierte sola en propuesta: se señala como posible
// oportunidad y quien la evalúa decide si registrar una propuesta de mejora.
// Respeta el período compartido y los filtros globales de área y persona.
// Tres pestañas: «Resumen» (tareas similares por persona), «Por persona» y «Por acción» (agrupada por la acción
// de Carga semanal, con apertura por tarea y la comparación de la misma tarea entre personas).
// =====================================================================
import { topRepetitivasPorPersona, repetitivasPorAccion, mismaTareaPorPersona, tareasSimilaresPorPersona, INDICE_DEFECTO, CONFIG } from '../engine.js';
import { esc, num, horas, porc, opciones, tabla } from '../ui.js';
import { prepararPeriodo } from './periodo.js';
import { abrirPropuesta, borradorDeTarea } from '../propuesta.js';

export const titulo = 'Tareas repetitivas';
// Distribución de los cuadros: columnas de al menos ANCHO_MIN px separadas por SEPARACION px
// (la misma separación en vertical y en horizontal).
const ANCHO_MIN = 400, SEPARACION = 14;
let observador = null;

const TABS = [['resumen', 'Resumen'], ['persona', 'Por persona'], ['accion', 'Por acción']];

export async function render(el, app) {
  const volver = () => render(el, app);
  const { rows, n, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: volver });
  const tab = TABS.some(([k]) => k === app.params.tab) ? app.params.tab : 'resumen';
  cont.insertAdjacentHTML('beforebegin', `<nav class="tabs" role="tablist" aria-label="Vista de tareas repetitivas">${TABS.map(([k, l]) => `<a role="tab" href="#/repetitivas${k === 'resumen' ? '' : `?tab=${k}`}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav>`);
  if (!rows.length) return;
  if (tab === 'accion') porAccion(cont, { rows, n, app, volver });
  else if (tab === 'persona') repetitivas(cont, { rows, n, app, volver });
  else resumenSimilares(cont, rows, app);
}

// ---------- Pestaña «Resumen»: tareas similares por persona ----------
// Por persona: líneas cargadas, tareas similares y su relación. La carga no se modifica:
// cada operador sigue trabajando con su nivel de detalle; el cuadro muestra cuánto se repite.
function resumenSimilares(cont, rows, app) {
  const datos = [...tareasSimilaresPorPersona(rows).values()].filter((d) => d.lineas);
  const cfg = app.configIndice?.length ? app.configIndice : INDICE_DEFECTO;
  const umbral = cfg.find((c) => c.termino === 'S')?.parametros?.tolerancia ?? 20;
  const conAlerta = datos.filter((d) => d.pctSimilares > umbral).length;
  cont.innerHTML = `
  <section class="panel" aria-labelledby="sim-t">
    <header class="panel-cab"><h2 id="sim-t">Tareas similares por persona</h2></header>
    <p class="nota nota-cab">Tareas similares agrupa, dentro de cada semana, las líneas que son la misma tarea cargada con distinto cliente, CC, mes u obra (por ejemplo, varios «Pedir pago…» a distintos proveedores). La carga no cambia: cada persona sigue trabajando con su nivel de detalle.${conAlerta ? ` ${conAlerta} ${conAlerta === 1 ? 'persona supera' : 'personas superan'} el ${num(umbral, 0)}%.` : ''}</p>
    <div data-sim-tabla></div>
    <p class="nota">% Tareas similares = 1 − tareas similares / líneas cargadas. % horas: parte de las horas que está en tareas con más de una variante en la semana.</p>
  </section>`;
  const chip = (v, al) => `<span class="cal-chip ${al ? 'cal-alerta' : ''}">${porc(v)}</span>`;
  tabla(cont.querySelector('[data-sim-tabla]'), {
    rows: datos, orden: { key: 'pctSimilares', dir: -1 },
    cols: [
      { key: 'persona', label: 'Persona', render: (d) => `<span class="nom">${esc(d.persona)}</span><span class="tenue bloque">${esc(d.area)}</span>` },
      { key: 'lineas', label: 'Líneas cargadas', alinear: 'num', render: (d) => num(d.lineas, 0) },
      { key: 'tareasSimilares', label: 'Tareas similares', alinear: 'num', render: (d) => num(d.tareasSimilares, 0) },
      { key: 'pctSimilares', label: '% Tareas similares', alinear: 'num', render: (d) => chip(d.pctSimilares, d.pctSimilares > umbral) },
      { key: 'pctHorasSimilares', label: '% horas', alinear: 'num', render: (d) => porc(d.pctHorasSimilares) },
    ],
  });
}

function repetitivas(cont, { rows, n, app, volver }) {
  const personas = topRepetitivasPorPersona(rows, n);
  const con = personas.filter((p) => p.tareas.length), sin = personas.filter((p) => !p.tareas.length);
  // propuesta ya registrada para la misma tarea (se muestra en lugar del botón Evaluar)
  const propuestaDe = (clave) => app.propuestas.find((p) => p.tarea_clave === clave && p.estado !== 'Descartada');

  cont.innerHTML = `
  <p class="intro">Las cinco tareas que cada persona más repite en el período, ordenadas por cantidad de veces y, ante empate, por horas acumuladas. Las tareas similares (la misma tarea con distinto cliente, CC, mes u obra) se cuentan juntas. Las marcadas como <b>posible oportunidad</b> son de tipo manual, administrativo o de control y suman al menos ${CONFIG.oportunidadHorasMes} h por mes: vale la pena analizar si pueden eliminarse, simplificarse, automatizarse o estandarizarse.</p>
  ${!con.length ? '<p class="vacio panel">No se detectaron tareas repetidas en el período.</p>' : `<div class="grid-rep">${con.map((p, i) => `
    <section class="panel rep-card" aria-labelledby="rep-${i}">
      <header class="rep-cab"><h2 id="rep-${i}">${esc(p.persona)}</h2><span class="tenue">${esc(p.area)}</span></header>
      <p class="rep-sint">${p.tareas.length} ${p.tareas.length === 1 ? 'tarea' : 'tareas'}<span aria-hidden="true">|</span>${num(p.veces, 0)} repeticiones<span aria-hidden="true">|</span>${p.horas ? `${num(p.horas)} h acumuladas` : 'sin tiempo cargado'}</p>
      <table class="tabla compacta rep-tabla">
        <thead><tr><th>Tarea</th><th class="num">Veces repetida</th><th class="num">Horas acumuladas</th></tr></thead>
        <tbody>${p.tareas.map((t) => { const pr = propuestaDe(t.clave); return `<tr>
          <td>${esc(t.tarea)}${t.variantes > 1 ? `<span class="tenue bloque rep-var" title="${esc(t.ejemplos.join(' · '))}">${t.variantes} variantes: ${esc(t.ejemplos.slice(0, 2).join(' · '))}${t.variantes > 2 ? '…' : ''}</span>` : ''}${t.oportunidad || pr ? `<span class="rep-opor">${pr ? `<a href="#/mejoras?propuesta=${pr.id}">Propuesta: ${esc(pr.estado)}</a>`
            : `Posible oportunidad: ${esc(t.tipoSugerido.toLowerCase())}${app.propuestasDisponibles ? ` <button type="button" class="rep-eval" data-evaluar="${i}|${esc(t.clave)}">Evaluar</button>` : ''}`}</span>` : ''}</td>
          <td class="num"><b>${t.veces}</b></td>
          <td class="num">${t.horas ? horas(t.horas) : '<span class="tenue">—</span>'}${t.sinHoras && t.horas ? `<span class="tenue bloque" title="Veces sin tiempo cargado">${t.sinHoras} sin tiempo</span>` : ''}</td></tr>`; }).join('')}</tbody>
      </table>
      ${p.totalRepetidas > p.tareas.length ? `<p class="nota">Tiene ${p.totalRepetidas} tareas repetidas en el período; se muestran las cinco principales.</p>` : ''}
    </section>`).join('')}</div>`}
  ${sin.length ? `<p class="nota">Sin tareas repetidas en el período: ${sin.map((p) => esc(p.persona)).join(', ')}.</p>` : ''}`;

  const grid = cont.querySelector('.grid-rep');
  if (grid) distribuir(grid);

  cont.querySelectorAll('[data-evaluar]').forEach((b) => b.addEventListener('click', () => {
    const [i, clave] = [b.dataset.evaluar.slice(0, b.dataset.evaluar.indexOf('|')), b.dataset.evaluar.slice(b.dataset.evaluar.indexOf('|') + 1)];
    const t = con[+i].tareas.find((x) => x.clave === clave);
    abrirPropuesta(app, { borrador: borradorDeTarea(t, app), alGuardar: volver });
  }));
}

// Cada cuadro va a la columna que está más corta, en el orden de la lista (área y nombre).
// Los cuadros quedan apilados dentro de columnas reales: nunca se superponen y la separación
// vertical es la misma que la horizontal, sin importar cuántas tareas tenga cada uno.
function distribuir(grid) {
  const cuadros = [...grid.querySelectorAll('.rep-card')];
  let columnas = 0;
  const armar = (forzar = false) => {
    const n = Math.max(1, Math.floor((grid.clientWidth + SEPARACION) / (ANCHO_MIN + SEPARACION)));
    if (n === columnas && !forzar) return;
    columnas = n;
    const cols = Array.from({ length: n }, () => { const c = document.createElement('div'); c.className = 'rep-col'; return c; });
    grid.replaceChildren(...cols);
    const alturas = new Array(n).fill(0);
    cuadros.forEach((c) => {
      const i = alturas.indexOf(Math.min(...alturas));
      cols[i].append(c);
      alturas[i] += c.offsetHeight + SEPARACION;
    });
  };
  armar(true);
  // se recalcula si cambia el ancho disponible (ventana, panel lateral) y cuando terminan de cargar las fuentes
  observador?.disconnect();
  observador = new ResizeObserver(() => { if (grid.isConnected) armar(); else observador.disconnect(); });
  observador.observe(grid);
  document.fonts?.ready.then(() => { if (grid.isConnected) armar(true); });
}

// ---------- Pestaña «Por acción» ----------
// Tareas que una misma persona planifica en al menos N semanas del período, agrupadas por acción.
// Cada tarea conserva la marca de posible oportunidad y el botón Evaluar de la vista por persona.
function porAccion(cont, { rows, n, app, volver }) {
  const F = app.filtrosHoja('repetitivas', { minSemanas: '' });
  const opcionesSem = [...new Set([2, 3, 4, 6, 8, 12, 16, 20, Math.max(2, Math.ceil(n / 2)), n].filter((x) => x >= 2 && x <= Math.max(2, n)))].sort((a, b) => a - b);
  const minSem = opcionesSem.includes(+F.minSemanas) ? +F.minSemanas : Math.max(2, Math.ceil(n / 2));
  const grupos = repetitivasPorAccion(rows, n, minSem);
  const comparables = mismaTareaPorPersona(rows, minSem);
  const totalRep = grupos.reduce((a, g) => a + g.horas, 0);
  const totalHoras = rows.reduce((a, r) => a + (r.horas || 0), 0);
  const maxG = Math.max(1, ...grupos.map((g) => g.horas));
  const propuestaDe = (clave) => app.propuestas.find((p) => p.tarea_clave === clave && p.estado !== 'Descartada');

  cont.innerHTML = `
  <p class="intro">Tareas que una misma persona planifica en al menos ${minSem} de las ${n} semanas del período, agrupadas por la acción que se realiza. Abrí cada acción para ver sus tareas. Las marcadas como <b>posible oportunidad</b> siguen el mismo criterio que la vista por persona.</p>
  <form class="filtros filtros-hoja">
    <label>Repetida en al menos<select name="minSemanas">${opciones(opcionesSem.map((x) => [String(x), `${x} semanas`]), String(minSem))}</select></label>
  </form>
  <section class="kpis kpis-3" aria-label="Tareas repetitivas del período">
    <div class="kpi"><span class="kpi-l">Horas en tareas repetitivas</span><span class="kpi-v">${porc(totalHoras ? (totalRep / totalHoras) * 100 : null)}</span><span class="delta">${num(totalRep, 0)} h de ${num(totalHoras, 0)} h planificadas</span></div>
    <div class="kpi"><span class="kpi-l">Tareas repetitivas</span><span class="kpi-v">${num(grupos.reduce((a, g) => a + g.tareas, 0), 0)}</span><span class="delta">En ${grupos.length} ${grupos.length === 1 ? 'acción' : 'acciones'}</span></div>
    <div class="kpi"><span class="kpi-l">Misma tarea en varias personas</span><span class="kpi-v">${comparables.length}</span><span class="delta">Comparables entre sí</span></div>
  </section>
  <div class="rep-accion">
    <section class="panel" aria-labelledby="ra-t">
      <header class="panel-cab"><h2 id="ra-t">Por acción, con apertura por tarea</h2><span class="tenue">Ordenado por horas acumuladas</span></header>
      ${!grupos.length ? '<p class="vacio">No hay tareas que se repitan en tantas semanas. Probá con menos semanas.</p>' : grupos.map((g, gi) => `
      <details class="ra-grupo" ${gi === 0 ? 'open' : ''}>
        <summary>
          <span class="ra-nom"><span class="ra-flecha" aria-hidden="true">›</span><b>${esc(g.accion)}</b> <span class="tenue">· ${g.tareas} ${g.tareas === 1 ? 'tarea' : 'tareas'} · ${g.personas} ${g.personas === 1 ? 'persona' : 'personas'}</span></span>
          <span class="ra-barra" aria-hidden="true"><span style="width:${((g.horas / maxG) * 100).toFixed(1)}%"></span></span>
          <span class="ra-h">${horas(g.horas)}</span><span class="ra-pct tenue">${porc(g.pct)}</span>
        </summary>
        <div class="tabla-scroll"><table class="tabla compacta rep-tabla">
          <thead><tr><th>Tarea</th><th>Persona</th><th class="num">Veces</th><th class="num">Semanas</th><th class="num">h por semana</th><th class="num">Horas acumuladas</th></tr></thead>
          <tbody>${g.items.map((t, ti) => { const pr = propuestaDe(t.clave); return `<tr>
            <td>${esc(t.tarea)}${t.oportunidad || pr ? `<span class="rep-opor">${pr ? `<a href="#/mejoras?propuesta=${pr.id}">Propuesta: ${esc(pr.estado)}</a>`
              : `Posible oportunidad: ${esc(t.tipoSugerido.toLowerCase())}${app.propuestasDisponibles ? ` <button type="button" class="rep-eval" data-evaluar-acc="${gi}|${ti}">Evaluar</button>` : ''}`}</span>` : ''}</td>
            <td class="nw">${esc(t.persona)}</td>
            <td class="num"><b>${t.veces}</b></td>
            <td class="num">${t.semanas}</td>
            <td class="num">${t.horas ? horas(t.horasSemana) : '<span class="tenue">—</span>'}</td>
            <td class="num">${t.horas ? horas(t.horas) : '<span class="tenue">—</span>'}${t.sinHoras && t.horas ? `<span class="tenue bloque" title="Veces sin tiempo cargado">${t.sinHoras} sin tiempo</span>` : ''}</td></tr>`; }).join('')}</tbody>
        </table></div>
      </details>`).join('')}
    </section>
    <section class="panel" aria-labelledby="rm-t">
      <header class="panel-cab"><h2 id="rm-t">Misma tarea, distintas personas</h2></header>
      <p class="nota nota-cab">Tareas repetitivas con el mismo detalle (o muy parecido) que hacen varias personas. Es la comparación de tiempos válida, porque se trata del mismo trabajo. Antes de sacar conclusiones, revisá si el volumen es el mismo.</p>
      ${!comparables.length ? '<p class="vacio">No hay tareas comparables entre personas en el período.</p>' : `<ul class="rm-lista">${comparables.slice(0, 12).map((c) => {
        const max = c.personas[0].horasSemana || 1;
        return `<li><span class="rm-tarea">${esc(c.tarea)}</span><span class="tenue rm-meta">${esc(c.accion)}${c.relacion && c.relacion >= 1.5 ? ` · una persona dedica ${num(c.relacion)} veces más por semana` : ' · tiempos parecidos'}</span>
          ${c.personas.map((p) => `<span class="rm-fila"><span class="rm-p">${esc(p.persona)}</span><span class="rm-barra" aria-hidden="true"><span style="width:${((p.horasSemana / max) * 100).toFixed(1)}%"></span></span><span class="rm-v">${num(p.horasSemana)} h/sem</span></span>`).join('')}</li>`;
      }).join('')}</ul>${comparables.length > 12 ? `<p class="nota">Se muestran 12 de ${comparables.length} tareas comparables, las de más horas.</p>` : ''}`}
      <p class="nota">h/sem: horas de la persona en esa tarea dividido las semanas en que la hizo.</p>
    </section>
  </div>`;

  cont.querySelector('.filtros-hoja').addEventListener('change', (e) => { F[e.target.name] = e.target.value; app.guardarFiltrosHoja(); volver(); });
  cont.querySelectorAll('[data-evaluar-acc]').forEach((b) => b.addEventListener('click', () => {
    const [gi, ti] = b.dataset.evaluarAcc.split('|').map(Number);
    abrirPropuesta(app, { borrador: borradorDeTarea(grupos[gi].items[ti], app), alGuardar: volver });
  }));
}
