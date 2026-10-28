// =====================================================================
// 🧭 Acciones — ¿en qué se va el tiempo?
// Usa la acción de cada tarea (lista de Carga semanal y reclasificación del historial).
//   A. Indicadores del período
//   B. Pareto de horas por acción y reparto semanal por familia de acciones
//   C. Matriz persona × acción: dedicación (horas por semana, % de la jornada u horas acumuladas)
// Compara dedicación, no velocidad: cada persona divide su trabajo en tareas de distinto tamaño.
// Respeta el período compartido y los filtros globales de área y persona.
// =====================================================================
import { horasPorAccion, familiasPorSemana, matrizDedicacion, repetitivasPorAccion, FAMILIAS, SIN_ACCION, groupBy } from '../engine.js';
import { esc, num, horas, porc, grafico, PALETA, etiquetaSemana, abrirCajon } from '../ui.js';
import { prepararPeriodo } from './periodo.js';

export const titulo = 'Acciones';
const COLUMNAS_MAX = 12;
const CORTO = { 'Coordinar y dar seguimiento': 'Coordinar', 'Desarrollar o mejorar': 'Desarrollar', 'Entregar o retirar': 'Entregar/retirar' };
const COLOR_FAMILIA = { registro: PALETA.pewterOsc, control: PALETA.bluffs, compras: PALETA.grass, coordinacion: PALETA.beige, operacion: PALETA.ok, comercial: PALETA.warn, mejora: '#183158', sin: '#E7E1D6' };
const MOSTRAR = [['semana', 'Horas por semana'], ['jornada', '% de la jornada'], ['acumuladas', 'Horas acumuladas']];
const corto = (a) => CORTO[a] || a;

export async function render(el, app) {
  const volver = () => render(el, app);
  const { rows, iso, n, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: volver });
  if (rows.length) acciones(cont, { rows, iso, n, app, volver });
}

function acciones(cont, { rows, iso, n, app, volver }) {
  const F = app.filtrosHoja('acciones', { mostrar: 'semana' });
  if (!MOSTRAR.some(([k]) => k === F.mostrar)) F.mostrar = 'semana';
  const conAccion = rows.filter((r) => r.accion);
  const porAccion = horasPorAccion(rows);
  const total = porAccion.reduce((a, x) => a + x.horas, 0);
  const soloAcciones = porAccion.filter((a) => a.accion !== SIN_ACCION);
  const top2 = soloAcciones.slice(0, 2);
  const minSem = Math.max(2, Math.ceil(n / 2));
  const rep = repetitivasPorAccion(rows, n, minSem);
  const horasRep = rep.reduce((a, g) => a + g.horas, 0);
  const mejora = soloAcciones.find((a) => a.accion === 'Desarrollar o mejorar')?.horas || 0;
  const sinAccion = rows.length - conAccion.length;
  const n80 = soloAcciones.findIndex((a) => a.acumulado >= 80) + 1;

  cont.innerHTML = `
  <p class="intro">Cada tarea se clasifica por la acción que se realiza (la lista de Carga semanal). Así se ve en qué se va el tiempo del equipo, sin importar cómo describe cada persona sus tareas. Las comparaciones entre personas usan <b>dedicación</b> (horas por semana), no el tiempo por tarea, porque cada uno divide su trabajo en tareas de distinto tamaño.</p>
  <section class="kpis kpis-4" aria-label="Indicadores del período">
    <div class="kpi"><span class="kpi-l">Horas planificadas</span><span class="kpi-v">${num(total, 0)}<small> h</small></span><span class="delta">${n} ${n === 1 ? 'semana' : 'semanas'}, ${new Set(rows.map((r) => r.persona)).size} personas</span></div>
    <div class="kpi"><span class="kpi-l">${top2.map((a) => esc(a.accion)).join(' + ') || 'Acciones principales'}</span><span class="kpi-v">${porc(top2.reduce((a, x) => a + x.pct, 0))}</span><span class="delta">${num(top2.reduce((a, x) => a + x.horas, 0), 0)} h de las horas planificadas</span></div>
    <a class="kpi kpi-link" href="#/repetitivas?tab=accion"><span class="kpi-l">En tareas repetitivas</span><span class="kpi-v">${porc(total ? (horasRep / total) * 100 : null)}</span><span class="delta">Se repiten en ${minSem} semanas o más</span></a>
    <div class="kpi"><span class="kpi-l">En mejora de procesos</span><span class="kpi-v">${porc(total ? (mejora / total) * 100 : null)}</span><span class="delta">Acción «Desarrollar o mejorar»</span></div>
  </section>
  ${sinAccion ? `<p class="aviso-panel">${num(sinAccion, 0)} ${sinAccion === 1 ? 'actividad no tiene' : 'actividades no tienen'} acción asignada: se muestran como «${SIN_ACCION}».</p>` : ''}

  <div class="grid-2">
    <section class="panel" aria-labelledby="ac-pareto-t">
      <header class="panel-cab"><h2 id="ac-pareto-t">¿Qué acciones concentran las horas?</h2>${n80 ? `<span class="tenue">${n80} ${n80 === 1 ? 'acción explica' : 'acciones explican'} el 80%</span>` : ''}</header>
      <div class="graf graf-alto"><canvas data-g-pareto role="img" aria-label="Horas planificadas por acción con el porcentaje acumulado"></canvas></div>
      <p class="nota">Barras: horas planificadas de cada acción en el período. Línea: porcentaje acumulado.</p>
    </section>
    <section class="panel" aria-labelledby="ac-fam-t">
      <header class="panel-cab"><h2 id="ac-fam-t">¿Cambia el destino del tiempo?</h2></header>
      <div class="graf graf-alto"><canvas data-g-familias role="img" aria-label="Reparto semanal de horas por familia de acciones"></canvas></div>
      <p class="nota">${FAMILIAS.map((f) => `<b>${esc(f.nombre)}</b>: ${f.acciones.map(esc).join(', ')}`).join('. ')}.</p>
    </section>
  </div>

  <section class="panel" aria-labelledby="ac-matriz-t">
    <header class="panel-cab"><h2 id="ac-matriz-t">Dedicación por persona y acción</h2>
      <nav class="chips chips-cab" aria-label="Valor de la matriz">${MOSTRAR.map(([k, l]) => `<a href="#" data-mostrar="${k}" aria-current="${F.mostrar === k}">${l}</a>`).join('')}</nav></header>
    <div data-matriz></div>
  </section>`;

  // Pareto
  const pareto = porAccion;
  grafico(cont.querySelector('[data-g-pareto]'), {
    data: {
      labels: pareto.map((a) => corto(a.accion)),
      datasets: [
        { type: 'line', label: '% acumulado', data: pareto.map((a) => a.acumulado), yAxisID: 'y2', borderColor: PALETA.tinta, backgroundColor: PALETA.tinta, pointRadius: 2, borderWidth: 2, tension: 0.2 },
        { type: 'bar', label: 'Horas', data: pareto.map((a) => a.horas), yAxisID: 'y', backgroundColor: pareto.map((a, i) => (i === 0 || pareto[i - 1].acumulado < 80 ? PALETA.bluffs : '#E0C9AE')), borderRadius: 2 },
      ],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.dataset.yAxisID === 'y2' ? ` ${num(c.raw, 0)}% acumulado` : ` ${num(c.raw, 0)} h`) } } },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 70, minRotation: 50, font: { size: 11 } }, grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: 'horas' } },
        y2: { position: 'right', min: 0, max: 100, ticks: { callback: (v) => `${v}%` }, grid: { display: false } },
      },
    },
  });

  // Familias por semana (100% apilado)
  const fam = familiasPorSemana(rows, iso);
  const ids = [...FAMILIAS.map((f) => [f.id, f.nombre]), ['sin', SIN_ACCION]].filter(([id]) => fam.some((s) => (s.pcts[id] || 0) > 0));
  grafico(cont.querySelector('[data-g-familias]'), {
    type: 'bar',
    data: { labels: fam.map((s) => etiquetaSemana(s.semana)), datasets: ids.map(([id, nombre]) => ({ label: nombre, data: fam.map((s) => s.pcts[id] ?? 0), backgroundColor: COLOR_FAMILIA[id], borderWidth: 0 })) },
    options: {
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${num(c.raw, 0)}%` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } },
    },
  });

  // Matriz
  const columnas = soloAcciones.slice(0, COLUMNAS_MAX).map((a) => a.accion);
  const hayOtras = porAccion.length > columnas.length;
  const matriz = matrizDedicacion(rows);
  const valor = (c) => (!c ? null : F.mostrar === 'semana' ? c.horasSemana : F.mostrar === 'jornada' ? c.pctJornada : c.horas);
  const fmt = (v) => (v === null ? '' : F.mostrar === 'jornada' ? porc(v) : num(v, F.mostrar === 'acumuladas' ? 0 : 1));
  // niveles de color en horas por semana (equivalentes para % de la jornada y acumuladas)
  const nivel = (c) => { if (!c) return 0; const h = c.horasSemana; return h >= 10 ? 4 : h >= 5 ? 3 : h >= 2 ? 2 : h >= 0.5 ? 1 : 0; };
  const otras = (p) => {
    const cs = Object.entries(p.celdas).filter(([a]) => !columnas.includes(a)).map(([, c]) => c);
    if (!cs.length) return null;
    const h = cs.reduce((a, c) => a + c.horas, 0);
    return { horas: h, horasSemana: h / p.semanas, pctJornada: (h / p.semanas / p.jornada) * 100, rows: cs.flatMap((c) => c.rows) };
  };
  const dibujarMatriz = () => {
    const m = cont.querySelector('[data-matriz]');
    const unidad = F.mostrar === 'semana' ? 'Horas por semana planificada, promedio del período' : F.mostrar === 'jornada' ? 'Porcentaje de la jornada semanal, promedio de las semanas planificadas' : 'Horas acumuladas en el período';
    m.innerHTML = `
    <p class="nota nota-cab">${unidad}. Tocá una celda para ver las tareas que la componen.</p>
    <div class="tabla-scroll"><table class="matriz-ded">
      <thead><tr><th scope="col" class="md-persona">Persona</th>${columnas.map((a) => `<th scope="col" title="${esc(a)}">${esc(corto(a))}</th>`).join('')}${hayOtras ? '<th scope="col" title="Resto de las acciones y actividades sin acción">Otras</th>' : ''}<th scope="col" class="md-total">Total</th></tr></thead>
      <tbody>${matriz.map((p, i) => `<tr>
        <th scope="row" class="md-persona"><span class="nom">${esc(p.persona)}</span><span class="tenue bloque">${esc(p.area)} · ${p.semanas} ${p.semanas === 1 ? 'semana' : 'semanas'}</span></th>
        ${columnas.map((a) => celda(p.celdas[a], i, a)).join('')}
        ${hayOtras ? celda(otras(p), i, '__otras') : ''}
        <td class="md-total">${fmt(valor(p))}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="nota">Escala de color según horas por semana: <span class="md-ley hm-1">0,5 a 2 h</span> <span class="md-ley hm-2">2 a 5 h</span> <span class="md-ley hm-3">5 a 10 h</span> <span class="md-ley hm-4">más de 10 h</span>. Vacío: menos de media hora por semana.</p>`;
    m.querySelectorAll('[data-celda]').forEach((b) => b.addEventListener('click', () => {
      const [i, accion] = [+b.dataset.celda.split('|')[0], b.dataset.celda.slice(b.dataset.celda.indexOf('|') + 1)];
      const p = matriz[i];
      const c = accion === '__otras' ? otras(p) : p.celdas[accion];
      if (c) detalleCelda(p, accion === '__otras' ? 'Otras acciones' : accion, c);
    }));
  };
  const celda = (c, i, accion) => {
    const v = valor(c), nv = nivel(c);
    if (!c || !nv) return '<td class="md-celda"></td>';
    return `<td class="md-celda hm-${nv}"><button type="button" data-celda="${i}|${esc(accion)}" aria-label="${esc(matriz[i].persona)}, ${esc(accion === '__otras' ? 'otras acciones' : accion)}: ${fmt(v)}">${fmt(v)}</button></td>`;
  };
  dibujarMatriz();

  cont.querySelectorAll('[data-mostrar]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    F.mostrar = a.dataset.mostrar;
    app.guardarFiltrosHoja();
    cont.querySelectorAll('[data-mostrar]').forEach((x) => x.setAttribute('aria-current', String(x.dataset.mostrar === F.mostrar)));
    dibujarMatriz();
  }));
}

// Cajón con las tareas de una celda: agrupadas por texto, con veces, semanas y horas
function detalleCelda(p, accion, c) {
  const tareas = [...groupBy(c.rows, (r) => r.tarea || '(sin texto)')].map(([tarea, rs]) => ({
    tarea, veces: rs.length, semanas: new Set(rs.map((r) => r.semana)).size, horas: rs.reduce((a, r) => a + (r.horas || 0), 0),
  })).sort((a, b) => b.horas - a.horas || b.veces - a.veces);
  abrirCajon({
    titulo: `${p.persona} · ${accion}`,
    html: `<p class="tenue">${num(c.horas)} h en el período, ${num(c.horasSemana)} h por semana planificada (${porc(c.pctJornada)} de la jornada).</p>
      <div class="tabla-scroll"><table class="tabla compacta"><thead><tr><th>Tarea</th><th class="num">Veces</th><th class="num">Semanas</th><th class="num">Horas</th></tr></thead>
      <tbody>${tareas.map((t) => `<tr><td>${esc(t.tarea)}</td><td class="num">${t.veces}</td><td class="num">${t.semanas}</td><td class="num">${t.horas ? horas(t.horas) : '<span class="tenue">—</span>'}</td></tr>`).join('')}</tbody></table></div>`,
  });
}
