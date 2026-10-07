// =====================================================================
// 💡 Propuestas de mejora — ¿en qué mejoras conviene poner esfuerzo primero?
// Conecta lo detectado (tareas repetitivas, tareas similares entre personas y situaciones
// de la semana) con propuestas registradas, su prioridad Impacto × Esfuerzo, su estado
// y su resultado. Integra la antigua hoja Tareas repetitivas.
// =====================================================================
import { analisisRepetitivas, tareasEntrePersonas, horasPorCategoria, CRITERIOS_REP, GRUPOS, grupoPropuesta, ordenPropuesta, potencialPropuesta,
  ESTADOS_ACTIVOS, NIVELES_IE, CONFIG, recortar } from '../engine.js';
import { esc, num, horas, tabla, grafico, PALETA, grupoBadge, situacionHTML } from '../ui.js';
import { prepararPeriodo } from './periodo.js';
import { abrirPropuesta, borradorDeTarea, borradorDeSituacion } from '../propuesta.js';
import { situacionesSemana } from '../situaciones.js';

export const titulo = 'Propuestas de mejora';
const VISTAS = [['activas', 'En curso'], ['implementadas', 'Implementadas'], ['descartadas', 'Descartadas'], ['todas', 'Todas']];
const ORIGENES = [['repetitivas', 'Tareas repetitivas'], ['similares', 'Tareas similares entre personas'], ['situaciones', 'Situaciones de la semana']];
const S = { vista: 'activas', celda: null, origen: 'repetitivas' };
const CAT_ORDEN = ['Administrativa', 'Documentación', 'Control', 'Repetitiva', 'Comunicación', 'Gestión', 'Operativa', 'Automatización', 'Analítica', 'Creativa', 'Estratégica'];

export async function render(el, app) {
  const volver = () => render(el, app);
  const { rows, n, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: volver });
  await mejoras(cont, { rows, n, app, volver });
  if (app.params.propuesta) {
    const p = app.propuestas.find((x) => x.id === app.params.propuesta);
    history.replaceState(null, '', '#/mejoras');
    if (p) abrirPropuesta(app, { propuesta: p, alGuardar: volver });
  }
}

async function mejoras(cont, { rows, n, app, volver }) {
  const todas = app.propuestasVisibles();
  const porClave = new Map(todas.filter((p) => p.tarea_clave).map((p) => [p.tarea_clave, p]));
  const rep = rows.length ? analisisRepetitivas(rows, n) : [];
  const similares = rows.length ? tareasEntrePersonas(rows, n) : [];
  const { lista: situ } = await situacionesSemana(app);
  const situProponibles = situ.filter((s) => s.id !== 'repetitivas');
  const activas = todas.filter((p) => ESTADOS_ACTIVOS.includes(p.estado));
  const implementadas = todas.filter((p) => p.estado === 'Implementada');
  const repSinEvaluar = rep.filter((t) => !porClave.has(t.clave));
  const conPotencial = [...activas, ...implementadas].map(potencialPropuesta).filter((x) => x !== null);
  const horasRep = rep.reduce((a, t) => a + (t.horasMes || 0), 0);

  cont.innerHTML = `
  <p class="intro">De lo detectado a lo implementado: cada oportunidad puede registrarse como propuesta, evaluarse por impacto y esfuerzo, seguirse por estado y cerrarse con el resultado obtenido. Las horas por mes de las tareas son las que consumen hoy según la planificación; el ahorro solo se calcula cuando quien evalúa la propuesta estima una reducción.</p>
  ${app.propuestasDisponibles ? '' : '<p class="aviso-panel">Para registrar y seguir propuestas falta aplicar la actualización de la base de datos <b>supabase/propuestas_mejora.sql</b>. Mientras tanto se muestran las oportunidades detectadas.</p>'}
  <section class="kpis kpis-4" aria-label="Indicadores de mejora">
    <div class="kpi"><span class="kpi-l">Oportunidades sin evaluar</span><span class="kpi-v">${repSinEvaluar.length + similares.filter((g) => !porClave.has(g.clave)).length}</span><span class="delta">tareas repetitivas o similares sin propuesta</span></div>
    <div class="kpi"><span class="kpi-l">Propuestas en curso</span><span class="kpi-v">${activas.length}</span><span class="delta">${activas.filter((p) => grupoPropuesta(p.impacto, p.esfuerzo) === 'quick').length} de alta prioridad</span></div>
    <div class="kpi"><span class="kpi-l">Implementadas</span><span class="kpi-v">${implementadas.length}</span><span class="delta">${implementadas.filter((p) => p.resultado_obtenido).length} con resultado registrado</span></div>
    <div class="kpi"><span class="kpi-l">Potencial estimado</span><span class="kpi-v">${conPotencial.length ? `${num(conPotencial.reduce((a, b) => a + b, 0))}<small> h/mes</small>` : '<span class="kpi-nd">Pendiente</span>'}</span><span class="delta">${conPotencial.length ? `en ${conPotencial.length} ${conPotencial.length === 1 ? 'propuesta' : 'propuestas'} con reducción estimada` : `las tareas repetitivas consumen ${num(horasRep)} h/mes`}</span></div>
  </section>

  <div class="grid-mejoras">
    <section class="panel">
      <header class="panel-cab"><h2>Matriz Impacto × Esfuerzo</h2></header>
      <div data-matriz-ie></div>
    </section>
    <section class="panel">
      <header class="panel-cab"><h2>Propuestas</h2>
        <span class="cab-acc"><nav class="chips chips-mini" aria-label="Estado">${VISTAS.map(([k, l]) => `<a href="#" data-vista="${k}" aria-current="${S.vista === k}">${l}</a>`).join('')}</nav>
        ${app.propuestasDisponibles ? '<button type="button" class="btn primario" data-nueva>Nueva propuesta</button>' : ''}</span></header>
      <div data-sel-ie></div>
      <div data-propuestas></div>
    </section>
  </div>

  <section class="panel">
    <header class="panel-cab"><h2>Oportunidades detectadas</h2>
      <nav class="chips chips-mini" aria-label="Origen">${ORIGENES.map(([k, l]) => `<a href="#" data-origen="${k}" aria-current="${S.origen === k}">${l} (${{ repetitivas: rep.length, similares: similares.length, situaciones: situProponibles.length }[k]})</a>`).join('')}</nav></header>
    <div data-oportunidades></div>
  </section>

  <section class="panel"><header class="panel-cab"><h2>¿En qué tipo de tareas se va el tiempo?</h2><span class="tenue">Horas${n > 1 ? ' por semana' : ''}, según el texto de cada tarea</span></header><div class="graf"><canvas data-gcat></canvas></div></section>`;

  // ---------- propuestas + matriz ----------
  const enVista = () => todas.filter((p) => (S.vista === 'activas' ? ESTADOS_ACTIVOS.includes(p.estado) : S.vista === 'implementadas' ? p.estado === 'Implementada'
    : S.vista === 'descartadas' ? p.estado === 'Descartada' : true));
  const pintarPropuestas = () => {
    const base = enVista();
    matrizIE(cont.querySelector('[data-matriz-ie]'), base, (imp, esf) => { S.celda = S.celda && S.celda.imp === imp && S.celda.esf === esf ? null : { imp, esf }; pintarPropuestas(); });
    const vis = S.celda ? base.filter((p) => p.impacto === S.celda.imp && p.esfuerzo === S.celda.esf) : base;
    cont.querySelector('[data-sel-ie]').innerHTML = S.celda ? `<p class="sel-matriz">${grupoBadge(grupoPropuesta(S.celda.imp, S.celda.esf), GRUPOS)} <b>Impacto ${S.celda.imp.toLowerCase()} + esfuerzo ${S.celda.esf.toLowerCase()}</b>: ${vis.length} ${vis.length === 1 ? 'propuesta' : 'propuestas'}. <button type="button" class="btn-mini" data-quitar-ie>Ver todas</button></p>` : '';
    cont.querySelector('[data-quitar-ie]')?.addEventListener('click', () => { S.celda = null; pintarPropuestas(); });
    tabla(cont.querySelector('[data-propuestas]'), {
      rows: vis, orden: { key: 'prioridad', dir: 1 },
      vacio: app.propuestasDisponibles ? (todas.length ? 'No hay propuestas en esta vista.' : 'Todavía no hay propuestas registradas. Empezá por evaluar las oportunidades detectadas, más abajo.') : 'El registro de propuestas todavía no está habilitado.',
      onRow: (p) => abrirPropuesta(app, { propuesta: p, alGuardar: volver }),
      cols: [
        { key: 'titulo', label: 'Propuesta', clase: 'col-tarea', render: (p) => `<span class="nom-txt">${esc(p.titulo)}</span>${p.problema ? `<span class="tenue bloque">${esc(recortar(p.problema, 120))}</span>` : ''}` },
        { key: 'fuente', label: 'Fuente', render: (p) => `${esc(p.fuente)}${p.tipo ? `<span class="tenue bloque">${esc(p.tipo)}</span>` : ''}` },
        { key: 'prioridad', label: 'Prioridad', sort: (p) => ordenPropuesta(p), render: (p) => `${grupoBadge(grupoPropuesta(p.impacto, p.esfuerzo), GRUPOS)}${p.impacto ? `<span class="tenue bloque">Impacto ${esc(p.impacto.toLowerCase())}, esfuerzo ${esc((p.esfuerzo || 'sin evaluar').toLowerCase())}</span>` : ''}` },
        { key: 'responsable', label: 'Responsable', render: (p) => esc(p.responsable) || '<span class="tenue">—</span>' },
        { key: 'estado', label: 'Estado', sort: (p) => ['Detectada', 'En análisis', 'Propuesta', 'Aprobada', 'En implementación', 'Implementada', 'Descartada'].indexOf(p.estado), render: (p) => `<span class="est-prop ep-${p.estado.toLowerCase().replace(/[^a-z]/g, '')}">${esc(p.estado)}</span>` },
        { key: 'potencial', label: 'Potencial', alinear: 'num', sort: (p) => potencialPropuesta(p) ?? -1, render: (p) => { const v = potencialPropuesta(p); return v === null ? `<span class="tenue">Pendiente de estimación</span>${p.horas_mes_base ? `<span class="tenue bloque">consume ${num(p.horas_mes_base)} h/mes</span>` : ''}` : `${num(v)} h/mes`; } },
        { key: 'resultado', label: 'Resultado', clase: 'col-texto', render: (p) => (p.resultado_obtenido ? esc(recortar(p.resultado_obtenido, 100)) : p.resultado_esperado ? `<span class="tenue">Esperado: ${esc(recortar(p.resultado_esperado, 80))}</span>` : '<span class="tenue">—</span>') },
      ],
    });
  };
  cont.querySelectorAll('[data-vista]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); S.vista = a.dataset.vista; S.celda = null;
    cont.querySelectorAll('[data-vista]').forEach((x) => x.setAttribute('aria-current', x === a)); pintarPropuestas();
  }));
  cont.querySelector('[data-nueva]')?.addEventListener('click', () => abrirPropuesta(app, { borrador: { area: app.filtros.areas.length === 1 ? app.filtros.areas[0] : '' }, alGuardar: volver }));
  pintarPropuestas();

  // ---------- oportunidades detectadas ----------
  const accionTarea = (clave) => { const p = porClave.get(clave); return p ? `<a class="btn-mini" href="#/mejoras?propuesta=${p.id}">Propuesta: ${esc(p.estado)}</a>` : (app.propuestasDisponibles ? `<button type="button" class="btn-mini" data-evaluar="${esc(clave)}">Evaluar</button>` : ''); };
  const pintarOportunidades = () => {
    const c = cont.querySelector('[data-oportunidades]');
    if (S.origen === 'repetitivas') {
      c.innerHTML = `<p class="porque">Tareas que se repiten por frecuencia (varias veces por semana), recurrencia (${CONFIG.recurrenciaSemanas} semanas o más) o porque las hacen varias personas. Son candidatas a eliminar, simplificar, automatizar o estandarizar. El tipo sugerido surge del texto de la tarea y lo confirma quien la evalúa.</p><div data-t></div>`;
      tabla(c.querySelector('[data-t]'), {
        rows: rep, max: 60, orden: { key: 'horasMes', dir: -1 }, vacio: 'No se detectaron tareas repetitivas en el período.',
        cols: [
          { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (t) => `${esc(t.tarea)}<span class="crit-rep">${t.criterios.map((k) => `<span class="badge n-info">${CRITERIOS_REP[k]}</span>`).join(' ')}</span>` },
          { key: 'vecesSemana', label: 'Veces por semana', alinear: 'num', render: (t) => num(t.vecesSemana) },
          { key: 'semanas', label: 'Semanas', alinear: 'num' },
          { key: 'personas', label: 'Personas', sort: (t) => t.personas.length, clase: 'col-texto', render: (t) => (t.personas.length > 2 ? `<b>${t.personas.length}</b> <span class="tenue">${esc(t.personas.slice(0, 3).join(', '))}…</span>` : esc(t.personas.join(', '))) },
          { key: 'horasPorVez', label: 'Horas por vez', alinear: 'num', render: (t) => (t.horasPorVez ? horas(t.horasPorVez) : '<span class="tenue">—</span>') },
          { key: 'horasMes', label: 'Horas por mes', alinear: 'num', render: (t) => (t.horasMes ? `<b>${num(t.horasMes)} h</b>` : '<span class="tenue">Pendiente de estimación</span>') },
          { key: 'tipoSugerido', label: 'Tipo sugerido', render: (t) => esc(t.tipoSugerido) || '<span class="tenue">Requiere evaluación</span>' },
          { key: 'acc', label: '', sort: (t) => (porClave.has(t.clave) ? 1 : 0), render: (t) => accionTarea(t.clave) },
        ],
      });
      c.querySelectorAll('[data-evaluar]').forEach((b) => b.addEventListener('click', () => abrirPropuesta(app, { borrador: borradorDeTarea(rep.find((t) => t.clave === b.dataset.evaluar), app), alGuardar: volver })));
    } else if (S.origen === 'similares') {
      c.innerHTML = '<p class="porque">Tareas parecidas que varias personas hacen por separado, escritas de distintas formas. Suelen ser candidatas a estandarizar con un procedimiento o una plantilla común, o a centralizar en un responsable.</p><div data-t></div>';
      tabla(c.querySelector('[data-t]'), {
        rows: similares, max: 40, orden: { key: 'horasMes', dir: -1 }, vacio: 'No se detectaron tareas similares hechas por distintas personas.',
        cols: [
          { key: 'tarea', label: 'Actividad', clase: 'col-tarea', render: (g) => `${esc(g.tarea)}<span class="tenue bloque">${g.variantes} formas de escribirla</span>` },
          { key: 'personas', label: 'Personas', sort: (g) => g.personas.length, clase: 'col-texto', render: (g) => `<b>${g.personas.length}</b> <span class="tenue">${esc(g.personas.join(', '))}</span>` },
          { key: 'veces', label: 'Veces', alinear: 'num' },
          { key: 'horasMes', label: 'Horas por mes', alinear: 'num', render: (g) => (g.horasMes ? num(g.horasMes) : '<span class="tenue">—</span>') },
          { key: 'acc', label: '', render: (g) => accionTarea(g.clave) },
        ],
      });
      c.querySelectorAll('[data-evaluar]').forEach((b) => b.addEventListener('click', () => {
        const g = similares.find((x) => x.clave === b.dataset.evaluar);
        abrirPropuesta(app, { borrador: { titulo: `Estandarizar: ${recortar(g.tarea, 110)}`, fuente: 'Tarea repetitiva', tipo: 'Estandarizar',
          problema: `${g.personas.length} personas hacen por separado tareas similares a "${g.tarea}" (${g.variantes} formas de escribirla).`,
          causa: 'Requiere revisión: puede faltar un procedimiento común.', horas_mes_base: g.horasMes ? Math.round(g.horasMes * 10) / 10 : null,
          tarea_clave: g.clave, origen_clave: `sim:${g.clave}`, origen_texto: g.tarea }, alGuardar: volver });
      }));
    } else {
      const activaDe = (s) => app.propuestas.find((p) => p.origen_clave === s.id && ESTADOS_ACTIVOS.includes(p.estado));
      c.innerHTML = `<p class="porque">Situaciones detectadas en la semana seleccionada que conviene resolver de fondo, no solo esta semana. El detalle de cada caso está en Riesgos y auditoría.</p>
        ${situProponibles.length ? `<div class="lista-situaciones">${situProponibles.map((s) => { const p = activaDe(s);
          return situacionHTML(s, { compacta: true, acciones: p ? `<a class="btn-mini" href="#/mejoras?propuesta=${p.id}">Propuesta: ${esc(p.estado)}</a>` : app.propuestasDisponibles ? `<button type="button" class="btn-mini" data-proponer="${esc(s.id)}">Registrar propuesta</button>` : '' }); }).join('')}</div>`
          : '<p class="vacio">No hay situaciones detectadas esta semana.</p>'}`;
      c.querySelectorAll('[data-proponer]').forEach((b) => b.addEventListener('click', () => abrirPropuesta(app, { borrador: borradorDeSituacion(situ.find((s) => s.id === b.dataset.proponer), app), alGuardar: volver })));
    }
  };
  cont.querySelectorAll('[data-origen]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); S.origen = a.dataset.origen;
    cont.querySelectorAll('[data-origen]').forEach((x) => x.setAttribute('aria-current', x === a)); pintarOportunidades();
  }));
  pintarOportunidades();

  // ---------- tipo de tareas ----------
  const hc = horasPorCategoria(rows, n);
  const cats = CAT_ORDEN.filter((c) => hc[c] > 0);
  grafico(cont.querySelector('[data-gcat]'), {
    type: 'bar',
    data: { labels: cats, datasets: [{ label: 'Horas', data: cats.map((c) => hc[c]), backgroundColor: cats.map((c) => (['Administrativa', 'Documentación', 'Control', 'Repetitiva'].includes(c) ? PALETA.bluffs : PALETA.beige)), borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ` ${num(x.raw)} h${n > 1 ? ' por semana' : ''}` } } },
      scales: { x: { beginAtZero: true, title: { display: true, text: `horas${n > 1 ? ' por semana' : ''}` } }, y: { grid: { display: false } } } },
  });
}

// Matriz 3×3: filas impacto (alto arriba), columnas esfuerzo (bajo a la izquierda)
function matrizIE(cont, propuestas, alElegir) {
  const imps = [...NIVELES_IE].reverse(), esfs = NIVELES_IE;
  const cnt = (i, e) => propuestas.filter((p) => p.impacto === i && p.esfuerzo === e).length;
  const sinEval = propuestas.filter((p) => !grupoPropuesta(p.impacto, p.esfuerzo)).length;
  const porGrupo = Object.keys(GRUPOS).map((g) => [g, propuestas.filter((p) => grupoPropuesta(p.impacto, p.esfuerzo) === g).length]);
  cont.innerHTML = `<div class="matriz-ie-wrap"><span class="eje-y">Impacto</span>
    <table class="matriz-ie" aria-label="Propuestas por impacto y esfuerzo">
      <thead><tr><th></th>${esfs.map((e) => `<th scope="col">${e}</th>`).join('')}</tr></thead>
      <tbody>${imps.map((i) => `<tr><th scope="row">${i}</th>${esfs.map((e) => { const g = grupoPropuesta(i, e); const n = cnt(i, e);
        const activa = S.celda && S.celda.imp === i && S.celda.esf === e;
        return `<td class="${GRUPOS[g].clase} ${activa ? 'activa' : ''}"><button type="button" data-i="${i}" data-e="${e}" ${n ? '' : 'disabled'} aria-pressed="${!!activa}"
          aria-label="Impacto ${i}, esfuerzo ${e}: ${n} ${n === 1 ? 'propuesta' : 'propuestas'} (${GRUPOS[g].nombre})"><b>${n || ''}</b><span>${GRUPOS[g].nombre}</span></button></td>`; }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="nota eje">Columnas: esfuerzo requerido. Tocá una celda para ver sus propuestas.</p>
    <ul class="leyenda-grupos">${porGrupo.map(([g, n]) => `<li><span class="badge ${GRUPOS[g].clase}">${GRUPOS[g].nombre}</span> <b>${n}</b> <span class="tenue">${GRUPOS[g].sub}</span></li>`).join('')}</ul>
    ${sinEval ? `<p class="nota">${sinEval} ${sinEval === 1 ? 'propuesta sin' : 'propuestas sin'} impacto o esfuerzo evaluado no ${sinEval === 1 ? 'aparece' : 'aparecen'} en la matriz.</p>` : ''}`;
  cont.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => alElegir(b.dataset.i, b.dataset.e)));
}
