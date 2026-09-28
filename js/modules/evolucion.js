// =====================================================================
// 📈 Evolución — ¿cómo está evolucionando la planificación?
// Tres pestañas que comparten los filtros de período, área y persona:
//   · Tendencia: horas y actividades por semana, comparación con el promedio
//     y riesgos que se mantienen.
//   · Propuestas de mejora: dónde se va el tiempo y qué conviene automatizar,
//     estandarizar o centralizar (hoja "Propuestas de Mejoras" del dashboard anterior).
//   · Tareas repetitivas: qué tareas repite cada persona (hoja "Tareas Repetitivas").
// Todos los cálculos salen del motor (engine.js).
// =====================================================================
import { serieSemanal, riesgosPersistentes, groupBy, addDays, analisisMejoras, perfilesMejora, tareasRepetitivas, NIVELES_VALOR } from '../engine.js';
import { esc, num, horas, porc, signo, grafico, opciones, PALETA, etiquetaSemana, tabla } from '../ui.js';

export const titulo = 'Evolución';
const PERIODOS = [['1', 'Última semana'], ['4', 'Últimas 4 semanas'], ['8', 'Últimas 8 semanas'], ['m3', 'Últimos 3 meses'], ['rango', 'Período personalizado']];
const TABS = [['tendencia', 'Tendencia'], ['mejoras', 'Propuestas de mejora'], ['repetitivas', 'Tareas repetitivas']];
const E = { periodo: '8', desde: '', hasta: '', area: '', persona: '', metrica: 'horas' };
const CAT_ORDEN = ['Administrativa', 'Documentación', 'Control', 'Repetitiva', 'Comunicación', 'Gestión', 'Operativa', 'Automatización', 'Analítica', 'Creativa', 'Estratégica'];

export async function render(el, app) {
  const tab = TABS.some(([k]) => k === app.params.tab) ? app.params.tab : 'tendencia';
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
  // semanas sin carga dentro del período (el eje las muestra juntas: se avisa)
  const faltan = [];
  for (let i = 1; i < iso.length; i++) for (let d = addDays(iso[i - 1], 7); d < iso[i]; d = addDays(d, 7)) faltan.push(d);

  el.innerHTML = `
  <header class="mod-cab"><h1>Evolución</h1><p class="sub">${semanas.length} ${semanas.length === 1 ? 'semana' : 'semanas'}${semanas.length ? `, del ${etiquetaSemana(iso[0])} al ${etiquetaSemana(iso.at(-1))}` : ''}${E.persona ? `, ${esc(E.persona)}` : E.area ? `, ${esc(E.area)}` : ''}</p></header>
  <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/evolucion?tab=${k}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav>
  <form class="filtros">
    <label>Período<select name="periodo">${opciones(PERIODOS, E.periodo)}</select></label>
    ${E.periodo === 'rango' ? `<label>Desde<select name="desde">${opciones(asc.map((s) => [s.inicio, etiquetaSemana(s.inicio)]), E.desde)}</select></label>
      <label>Hasta<select name="hasta">${opciones(asc.map((s) => [s.inicio, etiquetaSemana(s.inicio)]), E.hasta)}</select></label>` : ''}
    <label>Área<select name="area">${opciones(areas, E.area, 'Todas')}</select></label>
    <label>Persona<select name="persona">${opciones(personas, E.persona, 'Todas')}</select></label>
  </form>
  ${faltan.length ? `<p class="aviso-panel">En este período ${faltan.length === 1 ? 'hay una semana sin carga' : `hay ${faltan.length} semanas sin carga`}: ${faltan.map(etiquetaSemana).join(', ')}. Solo se analizan las semanas cargadas.</p>` : ''}
  <div data-tab></div>`;
  el.querySelector('.filtros').addEventListener('change', (e) => { E[e.target.name] = e.target.value; render(el, app); });

  const cont = el.querySelector('[data-tab]');
  if (!rows.length) { cont.innerHTML = '<p class="vacio panel">Sin actividades para los filtros elegidos.</p>'; return; }
  if (tab === 'tendencia') tendencia(cont, app, { rows, cambios, iso });
  if (tab === 'mejoras') mejoras(cont, { rows, n: iso.length });
  if (tab === 'repetitivas') repetitivas(cont, { rows, n: iso.length });
}

// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
function mejoras(cont, { rows, n }) {
  const a = analisisMejoras(rows, n);
  const perfiles = perfilesMejora(rows, n);
  const porSemana = n > 1 ? ' por semana' : '';
  const nivelAuto = (s) => (s >= 80 ? 'r-alto' : s >= 60 ? 'n-advertencia' : 'n-info');  // potencial, no problema: sin rojo
  const cats = CAT_ORDEN.filter((c) => a.horasCategoria[c] > 0);
  const persona = E.persona ? perfiles.find((p) => p.persona === E.persona) : null;

  cont.innerHTML = `
  <p class="intro">Estimación a partir del texto de cada tarea: su tipo, qué tan automatizable es y con qué herramienta. Sirve para priorizar; conviene validar cada propuesta con la persona que hace la tarea.</p>
  <section class="kpis kpis-5" aria-label="Indicadores de mejora">
    <div class="kpi"><span class="kpi-l">Índice de potencial de mejora</span><span class="kpi-v">${a.indice}<small> / 100</small></span><span class="delta">${esc(a.interpretacion)}</span></div>
    <div class="kpi"><span class="kpi-l">Horas recuperables${porSemana}</span><span class="kpi-v">${num(a.recuperableSemana)}<small> h</small></span><span class="delta">${num(a.recuperableSemana * 4.33, 0)} h por mes, ${num(a.recuperableSemana * 52, 0)} h por año</span></div>
    <div class="kpi"><span class="kpi-l">Actividades automatizables</span><span class="kpi-v">${porc(a.pctAutomatizable)}</span><span class="delta">${a.automatizables} de ${a.unicas.length} actividades distintas</span></div>
    <div class="kpi"><span class="kpi-l">Valor agregado predominante</span><span class="kpi-v kpi-txt">${a.valorPredominante ? esc(a.valorPredominante[0]) : '—'}</span><span class="delta">${a.valorPredominante ? `${a.valorPredominante[1]} de ${a.unicas.length} actividades` : ''}</span></div>
    <div class="kpi"><span class="kpi-l">Herramienta con más potencial</span><span class="kpi-v kpi-txt">${a.herramientaTop ? esc(a.herramientaTop[0]) : '—'}</span><span class="delta">${a.herramientaTop ? `${a.herramientaTop[1]} actividades automatizables` : 'Sin datos suficientes'}</span></div>
  </section>

  <section class="panel resumen-mejora"><p>${persona ? '' : `En el período se analizaron <b>${num(a.unicas.length, 0)}</b> actividades distintas. El <b>${porc(a.pctAdministrativo)}</b> son administrativas o documentales y el <b>${porc(a.pctAutomatizable)}</b> tiene un potencial de automatización alto o muy alto. Hay <b>${a.entrePersonas.length}</b> ${a.entrePersonas.length === 1 ? 'tarea que hacen' : 'tareas que hacen'} varias personas por separado. Automatizando y estandarizando se podrían recuperar cerca de <b>${num(a.recuperableSemana, 0)} h${porSemana}</b>.`}</p>
    ${persona ? `<div class="informe-persona">
      <div><h3>Fortalezas de ${esc(persona.persona)}</h3><ul>${persona.fortalezas.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
           <h3>Oportunidades</h3><ul>${persona.oportunidades.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>
      <div><h3>Herramientas recomendadas</h3><p>${persona.herramientas.length ? persona.herramientas.map((x) => `<span class="badge n-info">${esc(x)}</span>`).join(' ') : '<span class="tenue">Sin actividades con alto potencial de automatización.</span>'}</p>
           <h3>Tiempo recuperable estimado</h3><p class="cifra-grande">${num(persona.recuperable)} h<span>${porSemana || ' en la semana'}</span></p></div>
    </div>` : ''}
  </section>

  <div class="grid-2">
    <section class="panel"><header class="panel-cab"><h2>¿En qué tipo de tareas se va el tiempo?</h2></header><div class="graf"><canvas data-gcat></canvas></div></section>
    <section class="panel"><header class="panel-cab"><h2>¿Con qué herramientas se podría automatizar?</h2></header><div class="graf"><canvas data-gherr></canvas></div></section>
  </div>

  <section class="panel"><header class="panel-cab"><h2>Motor de recomendaciones</h2><span class="tenue">Las 20 actividades con más horas automatizables</span></header><div data-reco></div></section>
  <section class="panel"><header class="panel-cab"><h2>Tareas que hacen varias personas por separado</h2></header><div data-cruz></div></section>
  ${persona ? '' : '<section class="panel"><header class="panel-cab"><h2>Perfil de carga por persona</h2><span class="tenue">Horas' + porSemana + ' por tipo de tarea</span></header><div data-perfil></div></section>'}`;

  grafico(cont.querySelector('[data-gcat]'), {
    type: 'bar',
    data: { labels: cats, datasets: [{ label: `Horas${porSemana}`, data: cats.map((c) => a.horasCategoria[c]), backgroundColor: cats.map((c) => (['Administrativa', 'Documentación', 'Control', 'Repetitiva'].includes(c) ? PALETA.bluffs : c === 'Estratégica' || c === 'Analítica' || c === 'Creativa' ? PALETA.ok : PALETA.beige)), borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${num(c.raw)} h${porSemana}` } } },
      scales: { x: { beginAtZero: true, title: { display: true, text: `horas${porSemana}` } }, y: { grid: { display: false } } } },
  });
  const herr = Object.entries(a.herramientas).sort((x, y) => y[1] - x[1]);
  grafico(cont.querySelector('[data-gherr]'), {
    type: 'bar',
    data: { labels: herr.map((h) => h[0]), datasets: [{ label: 'Actividades automatizables', data: herr.map((h) => h[1]), backgroundColor: PALETA.pewter, borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, title: { display: true, text: 'actividades automatizables' } }, y: { grid: { display: false } } } },
  });

  tabla(cont.querySelector('[data-reco]'), {
    rows: a.recomendaciones, vacio: 'Sin actividades para analizar.',
    cols: [
      { key: 'tarea', label: 'Actividad', clase: 'col-tarea', render: (t) => `${esc(t.tarea)}<span class="tenue bloque">${t.personas.length > 2 ? `${t.personas.length} personas` : esc(t.personas.join(', '))}, ${t.veces} ${t.veces === 1 ? 'vez' : 'veces'}</span>` },
      { key: 'categoria', label: 'Tipo' },
      { key: 'auto', label: 'Automatización', sort: (t) => t.auto.score, render: (t) => `<span class="badge ${nivelAuto(t.auto.score)}">${t.auto.nivel}</span> <span class="tenue">${t.auto.score}</span>` },
      { key: 'valor', label: 'Valor agregado', sort: (t) => NIVELES_VALOR.indexOf(t.valor) },
      { key: 'horasSemana', label: `Horas${porSemana}`, alinear: 'num', render: (t) => num(t.horasSemana) },
      { key: 'herramienta', label: 'Herramienta' },
      { key: 'recomendacion', label: 'Recomendación', clase: 'col-texto' },
    ],
  });
  tabla(cont.querySelector('[data-cruz]'), {
    rows: a.entrePersonas, vacio: 'No se detectaron tareas similares hechas por distintas personas.',
    cols: [
      { key: 'tarea', label: 'Actividad', clase: 'col-tarea', render: (g) => esc(g.tarea) },
      { key: 'personas', label: 'Personas', sort: (g) => g.personas.length, render: (g) => `<b>${g.personas.length}</b> <span class="tenue">${esc(g.personas.join(', '))}</span>`, clase: 'col-texto' },
      { key: 'veces', label: 'Veces', alinear: 'num' },
      { key: 'horasSemana', label: `Horas${porSemana}`, alinear: 'num', render: (g) => num(g.horasSemana) },
      { key: 'recomendacion', label: 'Recomendación', clase: 'col-texto' },
    ],
  });
  if (!persona) tabla(cont.querySelector('[data-perfil]'), {
    rows: perfiles, orden: { key: 'recuperable', dir: -1 },
    onRow: (p) => { E.persona = p.persona; cont.closest('#contenido').querySelector('select[name="persona"]').value = p.persona; cont.closest('#contenido').querySelector('.filtros').dispatchEvent(new Event('change', { bubbles: true })); },
    cols: [
      { key: 'persona', label: 'Persona', render: (p) => `<span class="nom">${esc(p.persona)}</span><span class="tenue bloque">${esc(p.area)}</span>` },
      ...cats.map((c) => ({ key: `c_${c}`, label: c, alinear: 'num', sort: (p) => p.horasCat[c] || 0,
        render: (p) => { const v = p.horasCat[c] || 0; const f = p.horasSemana ? v / p.horasSemana : 0;
          return v ? `<span class="celda-cat" style="--f:${Math.min(1, f * 1.6)}">${num(v)}</span>` : '<span class="tenue">—</span>'; } })),
      { key: 'recuperable', label: 'Recuperable', alinear: 'num', render: (p) => `<b>${num(p.recuperable)} h</b>` },
      { key: 'senales', label: 'Señales', sort: (p) => p.senales[0][0], render: (p) => p.senales.map(([t, c]) => `<span class="badge ${c === 'crit' ? 'n-critica' : c === 'warn' ? 'n-advertencia' : c === 'ok' ? 'r-bajo' : 'n-info'}">${t}</span>`).join(' ') },
    ],
  });
}

// ---------------------------------------------------------------------
function repetitivas(cont, { rows, n }) {
  const r = tareasRepetitivas(rows);
  const conRep = r.porPersona.filter((p) => p.tareas.length);
  cont.innerHTML = `
  <p class="intro">Tareas que la misma persona planifica más de una vez en una misma semana. Las que más se repiten son candidatas a estandarizar, delegar o automatizar.</p>
  <section class="kpis kpis-3" aria-label="Indicadores de tareas repetitivas">
    <div class="kpi"><span class="kpi-l">Personas con tareas repetitivas</span><span class="kpi-v">${r.personasConRepetitivas}<small> de ${r.personas}</small></span></div>
    <div class="kpi"><span class="kpi-l">Tareas repetidas distintas</span><span class="kpi-v">${num(r.tareasDistintas, 0)}</span></div>
    <div class="kpi"><span class="kpi-l">Horas en tareas repetitivas</span><span class="kpi-v">${num(r.horas)}<small> h</small></span><span class="delta">${n > 1 ? `${num(r.horas / n)} h por semana en promedio` : 'en la semana'}</span></div>
  </section>
  ${!conRep.length ? '<p class="vacio panel">No se detectaron tareas repetitivas en el período.</p>' : conRep.map((p, i) => `
    <section class="panel rep-persona">
      <header class="panel-cab"><h2>${esc(p.persona)} <span class="tenue">${esc(p.area)}</span></h2>
        <span class="tenue">${p.tareas.length} ${p.tareas.length === 1 ? 'tarea repetida' : 'tareas repetidas'}${p.horas ? `, ${num(p.horas)} h acumuladas` : ''}</span></header>
      <div data-rep="${i}"></div>
    </section>`).join('')}`;
  conRep.forEach((p, i) => {
    const max = p.tareas[0]?.veces || 1;
    tabla(cont.querySelector(`[data-rep="${i}"]`), {
      rows: p.tareas.map((t, k) => ({ ...t, pos: k + 1 })), max: 15, orden: { key: 'pos', dir: 1 },
      cols: [
        { key: 'pos', label: '#', alinear: 'num', render: (t) => `<span class="rep-pos p${Math.min(t.pos, 4)}">${t.pos}</span>` },
        { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (t) => esc(t.tarea) },
        { key: 'veces', label: 'Frecuencia', render: (t) => `<span class="rep-frec"><b>${t.veces}×</b><span class="rep-barra"><span style="width:${(t.veces / max) * 100}%"></span></span></span>` },
        ...(n > 1 ? [{ key: 'semanas', label: 'Semanas', alinear: 'num' }] : []),
        { key: 'horas', label: 'Horas acumuladas', alinear: 'num', render: (t) => (t.horas ? horas(t.horas) : '<span class="tenue">—</span>') },
        { key: 'horasPorVez', label: 'Horas por vez', alinear: 'num', render: (t) => (t.horasPorVez ? horas(t.horasPorVez) : '<span class="tenue">—</span>') },
      ],
    });
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
