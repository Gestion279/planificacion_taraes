// =====================================================================
// 📈 Evolución — ¿estamos mejorando?
// Solo tendencias y variaciones entre semanas: cumplimiento, carga, riesgos, desvíos,
// tareas repetitivas y mejoras. No repite indicadores de la semana (eso está en Resumen).
// =====================================================================
import { serieSemanal, riesgosPersistentes, groupBy, areasDe, resultadoPropuesta, CONFIG, NIVELES_DIA } from '../engine.js';
import { esc, num, horas, porc, signo, grafico, opciones, PALETA, etiquetaSemana, tabla, fechaCorta } from '../ui.js';
import { prepararPeriodo } from './periodo.js';

export const titulo = 'Evolución';
const E = { metrica: 'horas' };
const COLOR_NIVEL = { sobrecarga: PALETA.crit, elevada: '#D9B45A', normal: '#8FA878', baja: '#B9C2C3', sin: '#E7E1D6' };

// Indicadores de mejora. mejor: 'sube' | 'baja'. acumulado: compara primera y última semana.
const INDICADORES = [
  { k: 'cumplimiento', esPct: true, l: 'Cumplimiento', mejor: 'sube', f: (v) => porc(v), grupo: 'Cumplimiento', nota: `solo semanas con al menos ${CONFIG.coberturaMin}% de actividades con Estado` },
  { k: 'cobertura', esPct: true, l: 'Actividades con Estado informado', mejor: 'sube', f: (v) => porc(v), grupo: 'Cumplimiento' },
  { k: 'pctDiasNormales', esPct: true, l: 'Días-persona dentro de la capacidad', mejor: 'sube', f: (v) => porc(v), grupo: 'Carga', nota: 'días hábiles con carga normal o elevada, sin sobrecarga ni baja utilización' },
  { k: 'sobrecarga', l: 'Personas con sobrecarga', mejor: 'baja', f: (v) => num(v), grupo: 'Carga' },
  { k: 'bajaUtilizacion', l: 'Personas con baja utilización', mejor: 'baja', f: (v) => num(v), grupo: 'Carga' },
  { k: 'riesgosAltos', l: 'Riesgos de nivel alto o crítico', mejor: 'baja', f: (v) => num(v), grupo: 'Riesgos' },
  { k: 'alertasCriticas', l: 'Situaciones críticas por persona', mejor: 'baja', f: (v) => num(v), grupo: 'Riesgos' },
  { k: 'desvioAbs', esPct: true, l: 'Desvío entre horas planificadas y reales', mejor: 'baja', f: (v) => porc(v), grupo: 'Desvíos', nota: 'solo semanas con horas reales cargadas' },
  { k: 'cambiosPost', l: 'Cambios después de la primera carga', mejor: 'baja', f: (v) => num(v), grupo: 'Desvíos' },
  { k: 'horasRepetidas', l: 'Horas en tareas repetidas en la semana', mejor: 'baja', f: (v) => horas(v), grupo: 'Repetitivas' },
  { k: 'propuestasAcum', l: 'Propuestas de mejora registradas', mejor: 'sube', f: (v) => num(v, 0), grupo: 'Mejoras', acumulado: true },
  { k: 'implementadasAcum', l: 'Mejoras implementadas', mejor: 'sube', f: (v) => num(v, 0), grupo: 'Mejoras', acumulado: true },
];

export async function render(el, app) {
  const { rows, cambios, iso, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: () => render(el, app) });
  if (rows.length) await tendencia(cont, app, { rows, cambios, iso });
}

async function tendencia(cont, app, { rows, cambios, iso }) {
  const propuestas = app.propuestasVisibles();
  const serie = serieSemanal(rows, cambios, iso, propuestas).map((s) => ({
    ...s,
    cumplimiento: s.cobertura >= CONFIG.coberturaMin ? s.cumplimiento : null,
    desvioAbs: s.desvioPct === null ? null : Math.abs(s.desvioPct),
    cambiosPost: s.agregadas + s.modificadas + s.retiradas,
  }));
  const mitad = Math.floor(serie.length / 2);
  const ant = serie.slice(0, Math.max(1, mitad)), act = serie.slice(Math.max(1, mitad));
  const prom = (arr, k) => { const v = arr.map((s) => s[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const filas = INDICADORES.map((ind) => {
    const antes = ind.acumulado ? serie[0][ind.k] : prom(ant, ind.k);
    const ahora = ind.acumulado ? serie.at(-1)[ind.k] : prom(act, ind.k);
    let veredicto = 'sin-datos';
    if (antes !== null && ahora !== null && serie.length >= 2) {
      const d = ahora - antes;
      const umbral = Math.max(Math.abs(antes) * 0.05, ind.esPct ? 1 : 0.1);
      veredicto = Math.abs(d) < umbral ? 'igual' : (d > 0) === (ind.mejor === 'sube') ? 'mejora' : 'empeora';
    }
    return { ...ind, antes, ahora, veredicto, serie: serie.map((s) => s[ind.k]) };
  });
  const mejoran = filas.filter((f) => f.veredicto === 'mejora').length, empeoran = filas.filter((f) => f.veredicto === 'empeora').length;

  cont.innerHTML = `
  ${iso.length < 2 ? '<p class="aviso-panel">Con una sola semana no hay tendencia para mostrar. Elegí un período más largo para comparar.</p>' : ''}
  <section class="panel">
    <header class="panel-cab"><h2>¿Estamos mejorando?</h2><span class="tenue">${iso.length >= 2 ? `Promedio de las últimas ${act.length} semanas frente a las ${ant.length} anteriores` : ''}</span></header>
    ${iso.length >= 2 ? `<p class="lectura-evo">${mejoran} ${mejoran === 1 ? 'indicador mejora' : 'indicadores mejoran'}, ${empeoran} ${empeoran === 1 ? 'empeora' : 'empeoran'} y el resto se mantiene o no tiene datos suficientes.</p>` : ''}
    <div data-tablero></div>
  </section>

  <div class="grid-2">
    <section class="panel"><header class="panel-cab"><h2>¿Mejora la distribución de la carga?</h2></header><div class="graf"><canvas data-g-carga></canvas></div>
      <p class="nota">Días hábiles de cada persona según su nivel de carga frente a la capacidad diaria estimada.</p></section>
    <section class="panel"><header class="panel-cab"><h2>¿Disminuyen los riesgos y las sobrecargas?</h2></header><div class="graf"><canvas data-g-riesgo></canvas></div></section>
  </div>

  <section class="panel"><header class="panel-cab"><h2>¿Las mejoras implementadas dieron resultado?</h2><a href="#/mejoras">Propuestas de mejora</a></header><div data-resultados></div></section>

  <div class="grid-2">
    <section class="panel"><header class="panel-cab"><h2>¿Se implementan las mejoras y bajan las tareas repetidas?</h2></header><div class="graf"><canvas data-g-mejoras></canvas></div></section>
    <section class="panel"><header class="panel-cab"><h2>¿Qué riesgos se mantienen?</h2></header><div data-rp></div></section>
  </div>

  <details class="panel migracion">
    <summary><h2>¿Cambió la carga de cada persona?</h2><span class="tenue">Semana seleccionada frente al promedio del período</span></summary>
    <label class="inline">Medir<select data-metrica>${opciones([['horas', 'Horas'], ['actividades', 'Actividades']], E.metrica)}</select></label>
    <div data-comp></div>
  </details>`;

  tablero(cont.querySelector('[data-tablero]'), filas, iso);
  const labels = iso.map(etiquetaSemana);
  const niveles = ['sobrecarga', 'elevada', 'normal', 'baja', 'sin'];
  grafico(cont.querySelector('[data-g-carga]'), {
    type: 'bar',
    data: { labels, datasets: niveles.map((n) => ({ label: NIVELES_DIA[n], data: serie.map((s) => (s.diasPersona ? (s.niveles[n] / s.diasPersona) * 100 : 0)), backgroundColor: COLOR_NIVEL[n], borderWidth: 0 })) },
    options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${num(c.raw, 0)}%` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: 100, beginAtZero: true, title: { display: true, text: '% de días-persona' } } } },
  });
  grafico(cont.querySelector('[data-g-riesgo]'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Riesgos alto o crítico', data: serie.map((s) => s.riesgosAltos), borderColor: PALETA.crit, backgroundColor: PALETA.crit, tension: 0.25 },
      { label: 'Personas con sobrecarga', data: serie.map((s) => s.sobrecarga), borderColor: PALETA.bluffs, backgroundColor: PALETA.bluffs, tension: 0.25 },
      { label: 'Situaciones críticas', data: serie.map((s) => s.alertasCriticas), borderColor: PALETA.pewter, backgroundColor: PALETA.pewter, borderDash: [4, 3], tension: 0.25 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  grafico(cont.querySelector('[data-g-mejoras]'), {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'line', label: 'Propuestas registradas', data: serie.map((s) => s.propuestasAcum), borderColor: PALETA.pewter, backgroundColor: PALETA.pewter, tension: 0.2, yAxisID: 'y' },
      { type: 'line', label: 'Mejoras implementadas', data: serie.map((s) => s.implementadasAcum), borderColor: PALETA.ok, backgroundColor: PALETA.ok, tension: 0.2, yAxisID: 'y' },
      { label: 'Horas en tareas repetidas', data: serie.map((s) => s.horasRepetidas), backgroundColor: '#E9DFCB', borderRadius: 3, yAxisID: 'y1' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'propuestas (acumulado)' } },
      y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'horas' } } } },
  });
  tabla(cont.querySelector('[data-rp]'), {
    rows: riesgosPersistentes(rows), max: 12, vacio: 'Ningún riesgo declarado se repite entre semanas.',
    cols: [
      { key: 'riesgo', label: 'Riesgo declarado', clase: 'col-riesgo', render: (x) => esc(x.riesgo) },
      { key: 'semanas', label: 'Semanas', alinear: 'num' },
      { key: 'desde', label: 'Desde', render: (x) => etiquetaSemana(x.desde) },
      { key: 'personas', label: 'Personas', sort: (x) => x.personas.length, clase: 'col-texto', render: (x) => esc(x.personas.join(', ')) },
    ],
  });
  await resultados(cont.querySelector('[data-resultados]'), app, propuestas);
  cont.querySelector('[data-metrica]').addEventListener('change', (e) => { E.metrica = e.target.value; comparacion(cont.querySelector('[data-comp]'), rows, iso, app); });
  comparacion(cont.querySelector('[data-comp]'), rows, iso, app);
}

const VEREDICTO = { mejora: ['Mejora', 'v-mejora'], empeora: ['Empeora', 'v-empeora'], igual: ['Sin cambios', 'v-igual'], 'sin-datos': ['Sin datos suficientes', 'v-nd'] };
function tablero(cont, filas, iso) {
  const spark = (serie, f) => { const v = serie.filter((x) => x !== null && x !== undefined); const max = Math.max(1e-9, ...v);
    return `<span class="spark" aria-hidden="true">${serie.map((x, i) => `<i title="${etiquetaSemana(iso[i])}: ${x === null || x === undefined ? 'sin datos' : f(x)}" style="height:${x === null || x === undefined ? 2 : Math.max(3, (x / max) * 28)}px;${x === null || x === undefined ? 'opacity:.3' : ''}" class="${i === serie.length - 1 ? 'actual' : ''}"></i>`).join('')}</span>`; };
  cont.innerHTML = `<div class="tabla-scroll"><table class="tabla tablero-evo">
    <thead><tr><th>Indicador</th><th>Tendencia</th><th class="num">Antes</th><th class="num">Ahora</th><th>Lectura</th></tr></thead>
    <tbody>${filas.map((f, i) => `${i === 0 || filas[i - 1].grupo !== f.grupo ? `<tr class="te-grupo"><th colspan="5">${esc(f.grupo)}</th></tr>` : ''}
      <tr><td>${esc(f.l)}${f.nota ? `<span class="tenue bloque">${esc(f.nota)}</span>` : ''}</td>
        <td>${spark(f.serie, f.f)}</td>
        <td class="num">${f.antes === null ? '—' : f.f(f.antes)}</td>
        <td class="num"><b>${f.ahora === null ? '—' : f.f(f.ahora)}</b></td>
        <td><span class="veredicto ${VEREDICTO[f.veredicto][1]}">${VEREDICTO[f.veredicto][0]}</span></td></tr>`).join('')}</tbody>
  </table></div>
  <p class="nota">"Antes" y "Ahora" son promedios semanales de cada mitad del período (en propuestas y mejoras, el acumulado al inicio y al final). Se considera sin cambios una variación menor al 5%.</p>`;
}

async function resultados(cont, app, propuestas) {
  const impl = propuestas.filter((p) => p.estado === 'Implementada');
  if (!impl.length) { cont.innerHTML = `<p class="vacio">${app.propuestasDisponibles ? 'Todavía no hay mejoras implementadas para evaluar.' : 'El registro de propuestas todavía no está habilitado.'}</p>`; return; }
  let medir = () => null;
  if (impl.some((p) => p.tarea_clave && p.fecha_implementacion)) {
    const { rows, semanas } = await app.filasDe(app.semanas);
    medir = (p) => resultadoPropuesta(p, rows, semanas);
  }
  tabla(cont, {
    rows: impl.map((p) => ({ ...p, med: medir(p) })), orden: { key: 'fecha_implementacion', dir: -1 },
    onRow: (p) => app.ir('mejoras', { propuesta: p.id }),
    cols: [
      { key: 'titulo', label: 'Mejora', clase: 'col-tarea', render: (p) => `<span class="nom-txt">${esc(p.titulo)}</span><span class="tenue bloque">${esc(p.tipo || p.fuente)}</span>` },
      { key: 'fecha_implementacion', label: 'Implementada', render: (p) => (p.fecha_implementacion ? fechaCorta(p.fecha_implementacion) : '—') },
      { key: 'resultado_esperado', label: 'Resultado esperado', clase: 'col-texto', render: (p) => esc(p.resultado_esperado) || '<span class="tenue">—</span>' },
      { key: 'med', label: 'Medición en la planificación', sort: (p) => p.med?.variacionPct ?? 999, render: (p) => (!p.tarea_clave ? '<span class="tenue">No vinculada a una tarea</span>'
        : !p.med || p.med.antes === null ? '<span class="tenue">Faltan semanas antes o después</span>'
          : `${horas(p.med.antes)} → <b>${horas(p.med.despues)}</b> por semana${p.med.variacionPct === null ? '' : ` <span class="${p.med.variacionPct < 0 ? 'd-bien' : p.med.variacionPct > 0 ? 'd-mal' : ''}">(${signo(p.med.variacionPct, ' %')})</span>`}`) },
      { key: 'resultado_obtenido', label: 'Resultado obtenido', clase: 'col-texto', render: (p) => esc(p.resultado_obtenido) || '<span class="tenue">Sin registrar</span>' },
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
    rows: data, orden: { key: 'persona', dir: 1 }, vacio: 'Sin datos en el período.',
    onRow: (d) => app.ir('planificacion', { persona: d.persona }),
    cols: [
      { key: 'persona', label: 'Persona', render: (d) => `<span class="nom">${esc(d.persona)}</span><span class="tenue bloque">${esc(d.area)}</span>` },
      { key: 'serie', label: `Por semana (${etiquetaSemana(iso[0])} a ${etiquetaSemana(iso.at(-1))})`, sort: (d) => d.prom,
        render: (d) => `<span class="spark" aria-label="Serie semanal">${d.serie.map((v, i) => `<i title="${etiquetaSemana(iso[i])}: ${v === null ? 'sin datos' : f(v)}" class="${iso[i] === actual ? 'actual' : ''}" style="height:${v === null ? 2 : Math.max(3, (v / max) * 28)}px;${v === null ? 'opacity:.3' : ''}"></i>`).join('')}</span>` },
      { key: 'actual', label: 'Semana actual', alinear: 'num', render: (d) => (d.actual === null ? '<span class="tenue">No planificó</span>' : f(d.actual)) },
      { key: 'prom', label: 'Promedio del período', alinear: 'num', render: (d) => (d.prom === null ? '—' : f(d.prom)) },
      { key: 'varPct', label: 'Variación', alinear: 'num', render: (d) => (d.varPct === null ? '—' : `<span class="${Math.abs(d.varPct) >= 25 ? (d.varPct > 0 ? 'd-mal' : 'd-info') : ''}">${signo(d.varPct, '%')}</span> <span class="tenue">${signo(d.varAbs, m === 'horas' ? ' h' : '')}</span>`) },
    ],
  });
}
