// =====================================================================
// 📈 Evolución — ¿cómo está evolucionando la planificación?
// Horas y actividades por semana, comparación con el promedio y riesgos
// que se mantienen. Todos los cálculos salen del motor (engine.js).
// =====================================================================
import { serieSemanal, riesgosPersistentes, groupBy, areasDe } from '../engine.js';
import { esc, num, horas, porc, signo, grafico, opciones, PALETA, etiquetaSemana, tabla } from '../ui.js';
import { prepararPeriodo } from './periodo.js';

export const titulo = 'Evolución';
const E = { metrica: 'horas' };

export async function render(el, app) {
  const { rows, cambios, iso, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: () => render(el, app) });
  if (rows.length) tendencia(cont, app, { rows, cambios, iso });
}

function tendencia(cont, app, { rows, cambios, iso }) {
  const serie = serieSemanal(rows, cambios, iso);
  cont.innerHTML = `
  ${iso.length < 2 ? '<p class="aviso-panel">Con una sola semana no hay tendencia para mostrar. Elegí un período más largo para comparar.</p>' : ''}
  <section class="panel"><header class="panel-cab"><h2>¿Aumentaron las horas planificadas?</h2></header><div class="graf"><canvas data-g1></canvas></div></section>
  <section class="panel">
    <header class="panel-cab"><h2>Semana actual frente al promedio del período</h2>
      <label class="inline">Medir<select data-metrica>${opciones([['horas', 'Horas'], ['actividades', 'Actividades']], E.metrica)}</select></label></header>
    <div data-comp></div>
  </section>
  <section class="panel"><header class="panel-cab"><h2>¿Qué riesgos se mantienen?</h2></header><div data-rp></div></section>`;

  grafico(cont.querySelector('[data-g1]'), {
    type: 'bar',
    data: { labels: iso.map(etiquetaSemana), datasets: [
      { label: 'Horas planificadas', data: serie.map((s) => s.horas), backgroundColor: PALETA.bluffs, borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Actividades', data: serie.map((s) => s.actividades), borderColor: PALETA.pewter, backgroundColor: PALETA.pewter, tension: 0.25, yAxisID: 'y1' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: {
      x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: 'horas' } },
      y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'actividades' } } } },
  });
  cont.querySelector('[data-metrica]').addEventListener('change', (e) => { E.metrica = e.target.value; comparacion(cont.querySelector('[data-comp]'), rows, iso, app); });
  comparacion(cont.querySelector('[data-comp]'), rows, iso, app);
  tabla(cont.querySelector('[data-rp]'), {
    rows: riesgosPersistentes(rows), max: 15, vacio: 'Ningún riesgo declarado se repite entre semanas.',
    cols: [
      { key: 'riesgo', label: 'Riesgo declarado', clase: 'col-tarea', render: (x) => esc(x.riesgo) },
      { key: 'semanas', label: 'Semanas', alinear: 'num' },
      { key: 'desde', label: 'Desde', render: (x) => etiquetaSemana(x.desde) },
      { key: 'personas', label: 'Personas', sort: (x) => x.personas.length, render: (x) => esc(x.personas.join(', ')) },
    ],
  });
}

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
    return { persona, area: areasDe(rs).join(', '), serie: iso.map((s) => (porSem.has(s) ? valor(s) : null)), actual: act, prom,
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
