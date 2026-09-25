// =====================================================================
// 📈 Evolución — ¿cómo está evolucionando la planificación?
// Cada gráfico responde una pregunta concreta; si no hay datos para
// responderla, se dice explícitamente en lugar de mostrar un gráfico vacío.
// =====================================================================
import { serieSemanal, recurrentesPeriodo, riesgosPersistentes, groupBy, CONFIG, addDays } from '../engine.js';
import { esc, num, horas, porc, signo, grafico, opciones, PALETA, etiquetaSemana, tabla } from '../ui.js';

export const titulo = 'Evolución';
const PERIODOS = [['1', 'Última semana'], ['4', 'Últimas 4 semanas'], ['8', 'Últimas 8 semanas'], ['m3', 'Últimos 3 meses'], ['rango', 'Período personalizado']];
const E = { periodo: '8', desde: '', hasta: '', area: '', persona: '', metrica: 'horas' };

export async function render(el, app) {
  const asc = [...app.semanas].reverse();
  if (!E.desde) E.desde = asc[0]?.inicio; if (!E.hasta) E.hasta = app.semana.inicio;
  const semanas = E.periodo === 'rango' ? app.semanasDePeriodo({ tipo: 'rango', desde: E.desde, hasta: E.hasta })
    : E.periodo === 'm3' ? app.semanasDePeriodo({ tipo: 'meses', n: 3 }) : app.semanasDePeriodo({ tipo: 'n', n: +E.periodo });
  const { rows: todas, cambios: cambiosTodos } = await app.filasDe(semanas);
  const areas = [...new Set(todas.map((r) => r.area))].sort();
  const personas = [...new Set(todas.filter((r) => !E.area || r.area === E.area).map((r) => r.persona))].sort((a, b) => a.localeCompare(b, 'es'));
  if (E.persona && !personas.includes(E.persona)) E.persona = '';
  const filtro = (r) => (!E.area || r.area === E.area) && (!E.persona || r.persona === E.persona);
  const rows = todas.filter(filtro);
  const cambios = cambiosTodos.filter(filtro);
  const iso = semanas.map((s) => s.inicio);
  const serie = serieSemanal(rows, cambios, iso);
  const labels = iso.map(etiquetaSemana);
  // semanas sin carga dentro del período (el eje las muestra juntas: se avisa)
  const faltan = [];
  for (let i = 1; i < iso.length; i++) for (let d = addDays(iso[i - 1], 7); d < iso[i]; d = addDays(d, 7)) faltan.push(d);

  el.innerHTML = `
  <header class="mod-cab"><h1>Evolución</h1><p class="sub">${semanas.length} ${semanas.length === 1 ? 'semana' : 'semanas'}${semanas.length ? `, del ${etiquetaSemana(iso[0])} al ${etiquetaSemana(iso.at(-1))}` : ''}</p></header>
  <form class="filtros">
    <label>Período<select name="periodo">${opciones(PERIODOS, E.periodo)}</select></label>
    ${E.periodo === 'rango' ? `<label>Desde<select name="desde">${opciones(asc.map((s) => [s.inicio, etiquetaSemana(s.inicio)]), E.desde)}</select></label>
      <label>Hasta<select name="hasta">${opciones(asc.map((s) => [s.inicio, etiquetaSemana(s.inicio)]), E.hasta)}</select></label>` : ''}
    <label>Área<select name="area">${opciones(areas, E.area, 'Todas')}</select></label>
    <label>Persona<select name="persona">${opciones(personas, E.persona, 'Todas')}</select></label>
  </form>
  ${faltan.length ? `<p class="aviso-panel">En este período ${faltan.length === 1 ? 'hay una semana sin carga' : `hay ${faltan.length} semanas sin carga`}: ${faltan.map(etiquetaSemana).join(', ')}. Los gráficos muestran solo las semanas cargadas.</p>` : ''}
  ${semanas.length < 2 ? '<p class="aviso-panel">Con una sola semana no hay tendencia para mostrar. Elegí un período más largo para comparar.</p>' : ''}
  <div class="grid-2">
    <section class="panel"><header class="panel-cab"><h2>¿Aumentaron las horas planificadas?</h2></header><div class="graf"><canvas data-g1></canvas></div></section>
    <section class="panel"><header class="panel-cab"><h2>¿Cómo evoluciona el cumplimiento?</h2></header><div data-g2c><div class="graf"><canvas data-g2></canvas></div></div></section>
    <section class="panel"><header class="panel-cab"><h2>¿Cuánto cambia la planificación después de cargada?</h2></header><div data-g3c><div class="graf"><canvas data-g3></canvas></div></div></section>
    <section class="panel"><header class="panel-cab"><h2>¿Se cumple lo planificado en horas?</h2></header><div data-g4c><div class="graf"><canvas data-g4></canvas></div></div></section>
  </div>
  <section class="panel">
    <header class="panel-cab"><h2>Semana actual frente al promedio del período</h2>
      <label class="inline">Medir<select data-metrica>${opciones([['horas', 'Horas'], ['actividades', 'Actividades']], E.metrica)}</select></label></header>
    <div data-comp></div>
  </section>
  <div class="grid-2">
    <section class="panel"><header class="panel-cab"><h2>¿Qué tareas aparecen repetidamente?</h2></header><div data-rec></div></section>
    <section class="panel"><header class="panel-cab"><h2>¿Qué riesgos se mantienen?</h2></header><div data-rp></div></section>
  </div>`;

  el.querySelector('.filtros').addEventListener('change', (e) => { E[e.target.name] = e.target.value; render(el, app); });
  el.querySelector('[data-metrica]').addEventListener('change', (e) => { E.metrica = e.target.value; comparacion(el.querySelector('[data-comp]'), rows, iso, app); });

  const ejes = (extra = {}) => ({ x: { grid: { display: false } }, y: { beginAtZero: true, ...extra } });
  grafico(el.querySelector('[data-g1]'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Horas planificadas', data: serie.map((s) => s.horas), backgroundColor: PALETA.bluffs, borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Actividades', data: serie.map((s) => s.actividades), borderColor: PALETA.pewter, backgroundColor: PALETA.pewter, tension: 0.25, yAxisID: 'y1' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { ...ejes({ title: { display: true, text: 'horas' } }), y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'actividades' } } } },
  });

  if (serie.every((s) => s.cumplimiento === null)) {
    el.querySelector('[data-g2c]').innerHTML = `<p class="vacio">No se puede medir: en el período ninguna actividad tiene estado cargado (cobertura ${porc(Math.max(...serie.map((s) => s.cobertura || 0)))}). El cumplimiento aparecerá cuando se complete la columna Estado del Excel.</p>`;
  } else grafico(el.querySelector('[data-g2]'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Cumplimiento', data: serie.map((s) => s.cumplimiento), borderColor: PALETA.ok, backgroundColor: PALETA.ok, tension: 0.25, spanGaps: true },
      { label: 'Cobertura de seguimiento', data: serie.map((s) => s.cobertura), borderColor: PALETA.beige, backgroundColor: PALETA.beige, borderDash: [4, 4], tension: 0.25 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: ejes({ max: 100, ticks: { callback: (v) => `${v}%` } }) },
  });

  if (serie.every((s) => !s.agregadas && !s.modificadas && !s.retiradas)) {
    el.querySelector('[data-g3c]').innerHTML = '<p class="vacio">Sin cambios registrados: en el período cada semana se cargó una sola vez. Cuando se vuelva a subir un Excel modificado, acá se verá cuánto se ajustó la planificación.</p>';
  } else grafico(el.querySelector('[data-g3]'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Agregadas', data: serie.map((s) => s.agregadas), backgroundColor: PALETA.grass },
      { label: 'Modificadas', data: serie.map((s) => s.modificadas), backgroundColor: PALETA.bluffs },
      { label: 'Retiradas', data: serie.map((s) => s.retiradas), backgroundColor: PALETA.pewter },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'actividades' } } } },
  });

  if (serie.every((s) => s.desvioPct === null)) {
    el.querySelector('[data-g4c]').innerHTML = '<p class="vacio">Todavía no hay horas reales cargadas. Se cargan en Personas, dentro del detalle de cada persona.</p>';
  } else grafico(el.querySelector('[data-g4]'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Desvío real vs plan', data: serie.map((s) => s.desvioPct), backgroundColor: serie.map((s) => ((s.desvioPct || 0) > 0 ? PALETA.crit : PALETA.ok)), borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${signo(c.raw, '%')} sobre las actividades con horas reales` } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${v}%` }, title: { display: true, text: 'real frente a plan' } } } },
  });

  comparacion(el.querySelector('[data-comp]'), rows, iso, app);

  tabla(el.querySelector('[data-rec]'), {
    rows: recurrentesPeriodo(rows, Math.min(CONFIG.recurrenciaSemanas, Math.max(2, iso.length))), max: 15,
    vacio: 'Ninguna tarea se repite en varias semanas del período.',
    cols: [
      { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (t) => `${esc(t.tarea)}<span class="tenue bloque">${esc(t.categoria)}</span>` },
      { key: 'semanas', label: 'Semanas', alinear: 'num' },
      { key: 'personas', label: 'Personas', sort: (t) => t.personas.length, render: (t) => (t.personas.length > 2 ? `${t.personas.length} personas` : esc(t.personas.join(', '))) },
      { key: 'horasSemana', label: 'h / semana', alinear: 'num', render: (t) => num(t.horasSemana) },
    ],
  });
  tabla(el.querySelector('[data-rp]'), {
    rows: riesgosPersistentes(rows), max: 15, vacio: 'Ningún riesgo declarado se repite entre semanas.',
    cols: [
      { key: 'riesgo', label: 'Riesgo declarado', clase: 'col-tarea', render: (x) => esc(x.riesgo) },
      { key: 'semanas', label: 'Semanas', alinear: 'num' },
      { key: 'desde', label: 'Desde', render: (x) => etiquetaSemana(x.desde) },
      { key: 'personas', label: 'Personas', sort: (x) => x.personas.length, render: (x) => esc(x.personas.join(', ')) },
    ],
  });
}

// Semana seleccionada vs promedio de las demás semanas del período, con la serie por semana
function comparacion(cont, rows, iso, app) {
  const actual = app.semana.inicio;
  const m = E.metrica;
  const porPersona = groupBy(rows, (r) => r.persona);
  const data = [...porPersona].map(([persona, rs]) => {
    const porSem = groupBy(rs, (r) => r.semana);
    const valor = (s) => { const x = porSem.get(s) || []; return m === 'horas' ? x.reduce((a, r) => a + (r.horas || 0), 0) : x.length; };
    const otras = iso.filter((s) => s !== actual && porSem.has(s));
    const prom = otras.length ? otras.reduce((a, s) => a + valor(s), 0) / otras.length : null;
    const act = porSem.has(actual) ? valor(actual) : null;
    return { persona, area: rs[0].area, serie: iso.map((s) => (porSem.has(s) ? valor(s) : null)), actual: act, prom,
      varAbs: act !== null && prom !== null ? act - prom : null, varPct: act !== null && prom ? ((act - prom) / prom) * 100 : null };
  });
  const max = Math.max(1, ...data.flatMap((d) => d.serie.filter((v) => v !== null)));
  const f = m === 'horas' ? horas : (v) => num(v, v % 1 ? 1 : 0);
  tabla(cont, {
    rows: data, orden: { key: 'varPct', dir: -1 }, vacio: 'Sin datos en el período.',
    onRow: (d) => app.ir('personas', { persona: d.persona }),
    cols: [
      { key: 'persona', label: 'Persona', render: (d) => `<span class="nom">${esc(d.persona)}</span><span class="tenue bloque">${esc(d.area)}</span>` },
      { key: 'serie', label: `Por semana (${etiquetaSemana(iso[0])} a ${etiquetaSemana(iso.at(-1))})`, sort: (d) => d.prom,
        render: (d) => `<span class="spark" aria-label="Serie semanal">${d.serie.map((v, i) => `<i title="${etiquetaSemana(iso[i])}: ${v === null ? 'sin datos' : f(v)}" class="${iso[i] === actual ? 'actual' : ''}" style="height:${v === null ? 2 : Math.max(3, (v / max) * 28)}px;${v === null ? 'opacity:.3' : ''}"></i>`).join('')}</span>` },
      { key: 'actual', label: 'Semana actual', alinear: 'num', render: (d) => (d.actual === null ? '<span class="tenue">No planificó</span>' : f(d.actual)) },
      { key: 'prom', label: 'Promedio histórico', alinear: 'num', render: (d) => (d.prom === null ? '—' : f(d.prom)) },
      { key: 'varPct', label: 'Variación', alinear: 'num', render: (d) => (d.varPct === null ? '—' : `<span class="${Math.abs(d.varPct) >= 25 ? (d.varPct > 0 ? 'd-mal' : 'd-info') : ''}">${signo(d.varPct, '%')}</span> <span class="tenue">${signo(d.varAbs, m === 'horas' ? ' h' : '')}</span>`) },
    ],
  });
}
