// =====================================================================
// 💡 Propuestas de mejora — dónde se va el tiempo y qué conviene
// automatizar, estandarizar o centralizar (hoja "Propuestas de Mejoras"
// del dashboard anterior). Todos los cálculos salen del motor (engine.js).
// =====================================================================
import { analisisMejoras, perfilesMejora, NIVELES_VALOR } from '../engine.js';
import { esc, num, porc, grafico, PALETA, tabla } from '../ui.js';
import { prepararPeriodo, elegirPersona } from './periodo.js';

export const titulo = 'Propuestas de mejora';
const CAT_ORDEN = ['Administrativa', 'Documentación', 'Control', 'Repetitiva', 'Comunicación', 'Gestión', 'Operativa', 'Automatización', 'Analítica', 'Creativa', 'Estratégica'];

export async function render(el, app) {
  const volver = () => render(el, app);
  const { rows, n, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: volver });
  if (rows.length) mejoras(cont, { rows, n, app });
}

function mejoras(cont, { rows, n, app }) {
  const a = analisisMejoras(rows, n);
  const perfiles = perfilesMejora(rows, n);
  const porSemana = n > 1 ? ' por semana' : '';
  const nivelAuto = (s) => (s >= 80 ? 'r-alto' : s >= 60 ? 'n-advertencia' : 'n-info');  // potencial, no problema: sin rojo
  const cats = CAT_ORDEN.filter((c) => a.horasCategoria[c] > 0);
  // informe individual: cuando el filtro global tiene una sola persona
  const persona = app.filtros.personas.length === 1 ? perfiles.find((p) => p.persona === app.filtros.personas[0]) : null;

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
    onRow: (p) => elegirPersona(app, p.persona),
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

