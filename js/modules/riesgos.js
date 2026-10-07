// =====================================================================
// ⚠️ Riesgos y auditoría
//   · Riesgos por persona: lo que cada persona declara en la columna Riesgos, con la Matriz de riesgo
//   · Situaciones detectadas: lo que detecta el motor (planificación, carga, cumplimiento, organización),
//     cada una con qué ocurre, posible causa, impacto y acción sugerida
//   · Auditoría de datos: calidad del registro, fila por fila
// El foco es la situación de trabajo, no la evaluación de las personas.
// =====================================================================
import * as db from '../db.js';
import { auditoria, NIVELES_RIESGO, nivelRiesgo, tieneRiesgo, norm, groupBy, diaDe, CTX, claveRiesgo, claveExcepcion, PRIORIDAD_RIESGO,
  ESTADOS_ACTIVOS } from '../engine.js';
import { esc, num, porc, tabla, riesgoBadge, aviso, fechaCorta, rangoSemana, prioBadge, multiSelect, situacionHTML, tablaCasos } from '../ui.js';
import { abrirDetalle } from '../detalle.js';
import { situacionesSemana, olvidarSituaciones } from '../situaciones.js';
import { abrirPropuesta, borradorDeSituacion } from '../propuesta.js';

export const titulo = 'Riesgos y auditoría';
const TABS = [['riesgos', 'Riesgos por persona'], ['situaciones', 'Situaciones detectadas'], ['auditoria', 'Auditoría de datos']];
// Filtro propio de la hoja (Área y Persona son globales, en la barra superior)
let FR = { nivel: [] };
// Celda elegida en la matriz (probabilidad + impacto)
let MSEL = null;

export async function render(el, app) {
  const pedido = app.params.tab === 'alertas' ? 'situaciones' : app.params.tab; // enlaces anteriores
  const tab = TABS.some(([k]) => k === pedido) ? pedido : 'riesgos';
  el.innerHTML = `
  <header class="mod-cab">
    <h1>Riesgos y auditoría</h1>
    <p class="sub">${rangoSemana(app.semana.inicio, app.semana.fin)}</p>
  </header>
  <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/riesgos?tab=${k}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav>
  <div data-cont></div>`;
  const c = el.querySelector('[data-cont]');
  if (tab === 'riesgos') await riesgosDeclarados(c, app);
  if (tab === 'situaciones') await situaciones(c, app);
  if (tab === 'auditoria') auditoriaDatos(c, app);
}

// ---------------------------------------------------------------------
async function riesgosDeclarados(c, app) {
  const { rows: r8 } = await app.filasDe(app.semanasDePeriodo({ tipo: 'n', n: 8 }));
  const semanasPorRiesgo = new Map();
  r8.filter(tieneRiesgo).forEach((r) => {
    const k = `${r.persona}|${norm(r.riesgos)}`;
    if (!semanasPorRiesgo.has(k)) semanasPorRiesgo.set(k, new Set());
    semanasPorRiesgo.get(k).add(r.semana);
  });

  // Un riesgo = mismo texto declarado por la misma persona en la semana (como el dashboard anterior)
  const grupos = [...groupBy(app.filas.filter(tieneRiesgo), (r) => claveRiesgo(r.personaId, r.riesgos))].map(([k, rs]) => {
    const ev = CTX.riesgos.get(k) || {};
    const kp = `${rs[0].persona}|${norm(rs[0].riesgos)}`;
    return { k, personaId: rs[0].personaId, persona: rs[0].persona, area: rs[0].area, riesgo: rs[0].riesgos, rows: rs,
      prob: ev.prob || '', imp: ev.impacto || '', nivel: nivelRiesgo(ev.prob, ev.impacto),
      semanas: semanasPorRiesgo.get(kp)?.size || 1, prioAlta: rs.some((r) => r.prioridad === 'Alta') };
  });

  FR = app.filtrosHoja('riesgos', { nivel: [] });
  app.registrarLimpieza('riesgos', () => { FR.nivel = []; MSEL = null; }, () => FR.nivel.length + (MSEL ? 1 : 0));
  c.innerHTML = `
    <p class="intro">Riesgos escritos por cada persona en la columna <b>Riesgos</b> del Excel. Asigná probabilidad e impacto para obtener el nivel y la prioridad de tratamiento. La evaluación queda guardada para esa persona y ese riesgo, y se aplica sola en las semanas en que lo vuelva a declarar.</p>
    <form class="filtros" onsubmit="return false"><span data-ms="nivel"></span></form>
    <div class="grid-riesgos">
      <section class="panel"><header class="panel-cab"><h2>Riesgos de la semana</h2><span class="tenue" data-cuenta></span></header><div data-sel-matriz></div><div data-tabla></div></section>
      <section class="panel"><header class="panel-cab"><h2>Matriz de riesgo</h2></header><div data-matriz></div></section>
    </div>`;

  const aplicar = () => {
    const porNivel = grupos.filter((g) => !FR.nivel.length || FR.nivel.includes(g.nivel || 'sin'));
    const vis = MSEL ? porNivel.filter((g) => g.prob === MSEL.prob && g.imp === MSEL.imp) : porNivel;
    c.querySelector('[data-cuenta]').textContent = `${vis.length} riesgos en ${num(vis.reduce((a, g) => a + g.rows.length, 0), 0)} actividades, ${vis.filter((g) => !g.nivel).length} sin evaluar`;
    const nv = MSEL && nivelRiesgo(MSEL.prob, MSEL.imp);
    c.querySelector('[data-sel-matriz]').innerHTML = MSEL ? `<p class="sel-matriz">${riesgoBadge(nv)} <b>Probabilidad ${MSEL.prob} + impacto ${MSEL.imp}</b>: ${vis.length} ${vis.length === 1 ? 'riesgo' : 'riesgos'}, prioridad de tratamiento ${PRIORIDAD_RIESGO[nv].toLowerCase()}. <button type="button" class="btn-mini" data-quitar-sel>Ver todos</button></p>` : '';
    c.querySelector('[data-quitar-sel]')?.addEventListener('click', () => { MSEL = null; aplicar(); app.refrescarContadorFiltros(); });
    tabla(c.querySelector('[data-tabla]'), {
      rows: vis, orden: { key: 'nivel', dir: -1 }, vacio: 'No hay riesgos declarados con estos filtros.',
      cols: [
        { key: 'persona', label: 'Persona', render: (g) => `<span class="nom">${esc(g.persona)}</span><span class="tenue bloque">${esc(g.area)}</span>` },
        { key: 'riesgo', label: 'Riesgo declarado', clase: 'col-riesgo', render: (g) => `${esc(g.riesgo)}<span class="tenue bloque">${g.rows.length === 1 ? `${esc(g.rows[0].tarea)}` : `${g.rows.length} actividades`}${g.prioAlta ? ', incluye prioridad Alta' : ''}</span>` },
        { key: 'semanas', label: 'Semanas', alinear: 'num', render: (g) => (g.semanas > 1 ? `<span title="Declarado en ${g.semanas} de las últimas 8 semanas">${g.semanas}</span>` : '1') },
        { key: 'prob', label: 'Probabilidad', render: (g) => sel(g, 'prob') },
        { key: 'imp', label: 'Impacto', render: (g) => sel(g, 'imp') },
        { key: 'nivel', label: 'Nivel', sort: (g) => ({ crítico: 4, alto: 3, moderado: 2, bajo: 1 }[g.nivel] || 0), render: (g) => riesgoBadge(g.nivel) },
        { key: 'prioridad', label: 'Prioridad', sort: (g) => ({ crítico: 4, alto: 3, moderado: 2, bajo: 1 }[g.nivel] || 0), render: (g) => (g.nivel ? `<span class="prio-t pt-${norm(PRIORIDAD_RIESGO[g.nivel])}">${PRIORIDAD_RIESGO[g.nivel]}</span>` : '<span class="tenue">—</span>') },
      ],
      onRow: (g) => { if (g.rows.length === 1) abrirDetalle(g.rows[0], app); },
    });
    c.querySelectorAll('select[data-g]').forEach((s) => s.addEventListener('change', () => guardar(s, grupos, aplicar)));
    matriz(c.querySelector('[data-matriz]'), porNivel, (p, i) => { MSEL = MSEL && MSEL.prob === p && MSEL.imp === i ? null : { prob: p, imp: i }; aplicar(); app.refrescarContadorFiltros(); });
  };
  c.querySelector('[data-ms="nivel"]').replaceWith(multiSelect({ etiqueta: 'Nivel', todos: 'Todos',
    opciones: [['crítico', 'Crítico'], ['alto', 'Alto'], ['moderado', 'Moderado'], ['bajo', 'Bajo'], ['sin', 'Sin evaluar']].map(([valor, texto]) => ({ valor, texto })),
    seleccion: FR.nivel, onChange: (v) => { FR.nivel = v; aplicar(); app.refrescarContadorFiltros(); } }));
  aplicar();
}

const sel = (g, campo) => `<select class="sel-riesgo" data-g="${esc(g.k)}" data-campo="${campo}" aria-label="${campo === 'prob' ? 'Probabilidad' : 'Impacto'}">
  <option value="">—</option>${NIVELES_RIESGO.map((n) => `<option value="${n}" ${g[campo] === n ? 'selected' : ''}>${n[0].toUpperCase() + n.slice(1)}</option>`).join('')}</select>`;

async function guardar(s, grupos, repintar) {
  const g = grupos.find((x) => x.k === s.dataset.g);
  const nuevo = { prob: g.prob, imp: g.imp, [s.dataset.campo]: s.value };
  s.disabled = true;
  try {
    await db.evaluarRiesgo(g.personaId, norm(g.riesgo), g.riesgo, nuevo.prob, nuevo.imp);
    if (!nuevo.prob && !nuevo.imp) CTX.riesgos.delete(g.k); else CTX.riesgos.set(g.k, { prob: nuevo.prob || null, impacto: nuevo.imp || null });
    g.prob = nuevo.prob; g.imp = nuevo.imp; g.nivel = nivelRiesgo(g.prob, g.imp);
    olvidarSituaciones();
    repintar();
  } catch (e) { aviso(`No se guardó: ${e.message}`, 'error'); s.disabled = false; }
}

// Matriz interactiva: cada celda filtra la tabla con las situaciones que la componen
function matriz(cont, grupos, alElegir) {
  const cnt = (p, i) => grupos.filter((g) => g.prob === p && g.imp === i).length;
  const orden = [...NIVELES_RIESGO].reverse();
  const sinEval = grupos.filter((g) => !g.nivel).length;
  cont.innerHTML = `<table class="matriz-riesgo" aria-label="Riesgos por probabilidad e impacto">
    <thead><tr><th></th>${NIVELES_RIESGO.map((i) => `<th>${i}</th>`).join('')}</tr></thead>
    <tbody>${orden.map((p) => `<tr><th scope="row">${p}</th>${NIVELES_RIESGO.map((i) => { const n = cnt(p, i); const nv = nivelRiesgo(p, i);
      const activa = MSEL && MSEL.prob === p && MSEL.imp === i;
      return `<td class="mr r-${nv === 'crítico' ? 'critico' : nv} ${activa ? 'activa' : ''}"><button type="button" data-p="${p}" data-i="${i}" ${n ? '' : 'disabled'}
        aria-pressed="${!!activa}" aria-label="Probabilidad ${p}, impacto ${i}: ${n} ${n === 1 ? 'riesgo' : 'riesgos'}, nivel ${nv}">${n || ''}</button></td>`; }).join('')}</tr>`).join('')}</tbody>
  </table>
  <p class="nota eje">Filas: probabilidad. Columnas: impacto. Tocá una celda para ver los riesgos que la componen.</p>
  <ul class="leyenda-prio">${['crítico', 'alto', 'moderado', 'bajo'].map((n) => `<li>${riesgoBadge(n)} prioridad ${PRIORIDAD_RIESGO[n].toLowerCase()}</li>`).join('')}</ul>
  ${sinEval ? `<p class="nota">${sinEval} ${sinEval === 1 ? 'riesgo sin evaluar no aparece' : 'riesgos sin evaluar no aparecen'} en la matriz.</p>` : ''}`;
  cont.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => alElegir(b.dataset.p, b.dataset.i)));
}

// ---------------------------------------------------------------------
const FUENTES_FILTRO = [['', 'Todas'], ['Planificación', 'Planificación'], ['Carga', 'Carga'], ['Cumplimiento', 'Cumplimiento'], ['Riesgo', 'Riesgos'], ['org', 'Organización']];
async function situaciones(c, app) {
  c.innerHTML = '<p class="tenue">Analizando la semana…</p>';
  const { lista } = await situacionesSemana(app);
  const fNivel = app.params.nivel || '', fFuente = app.params.fuente || '';
  const esOrg = (s) => s.fuente === 'Auditoría' || s.fuente === 'Tarea repetitiva';
  const vis = lista.filter((s) => (!fNivel || s.nivel === fNivel) && (!fFuente || (fFuente === 'org' ? esOrg(s) : s.fuente === fFuente)));
  const niveles = { critica: 'Críticas', advertencia: 'Advertencias', info: 'Para revisar' };
  const url = (patch) => `#/riesgos?${new URLSearchParams({ tab: 'situaciones', ...(fNivel ? { nivel: fNivel } : {}), ...(fFuente ? { fuente: fFuente } : {}), ...patch })}`.replace(/&?(nivel|fuente)=(?=&|$)/g, '');
  const activa = (s) => app.propuestas.find((p) => p.origen_clave === s.id && ESTADOS_ACTIVOS.includes(p.estado));
  c.innerHTML = `
    <p class="intro">Situaciones detectadas automáticamente en la planificación de la semana. Cada una indica qué ocurre, su posible causa, el impacto y una acción sugerida. Cuando los datos no permiten determinar la causa, se indica <b>Requiere revisión</b>. Las situaciones que conviene resolver de fondo pueden registrarse como propuesta de mejora.</p>
    <nav class="chips" aria-label="Nivel">${[['', `Todas (${lista.length})`], ...Object.entries(niveles).map(([k, l]) => [k, `${l} (${lista.filter((s) => s.nivel === k).length})`])]
      .map(([k, l]) => `<a href="${url({ nivel: k })}" aria-current="${fNivel === k}">${l}</a>`).join('')}</nav>
    <nav class="chips chips-sec" aria-label="Origen">${FUENTES_FILTRO.map(([k, l]) => `<a href="${url({ fuente: k })}" aria-current="${fFuente === k}">${l}</a>`).join('')}</nav>
    ${!vis.length ? '<p class="vacio panel">No hay situaciones con estos filtros.</p>' : `<div class="lista-situaciones">${vis.map((s) => {
      const p = activa(s);
      const acc = p ? `<a class="btn-mini" href="#/mejoras?propuesta=${p.id}">Propuesta registrada: ${esc(p.estado)}</a>`
        : `<button type="button" class="btn-mini" data-proponer="${esc(s.id)}">Registrar propuesta de mejora</button>`;
      return situacionHTML(s, { acciones: `${s.enlace ? `<a href="#/${s.enlace.modulo}${s.enlace.params ? `?${new URLSearchParams(s.enlace.params)}` : ''}">Ir al detalle</a>` : ''}${acc}` });
    }).join('')}</div>`}`;
  vis.forEach((s) => { const cont = c.querySelector(`[data-situ="${CSS.escape(s.id)}"] [data-casos]`); if (cont) tablaCasos(cont, s.casos); });
  c.querySelectorAll('[data-proponer]').forEach((b) => b.addEventListener('click', () => {
    const s = lista.find((x) => x.id === b.dataset.proponer);
    abrirPropuesta(app, { borrador: borradorDeSituacion(s, app), alGuardar: () => situaciones(c, app) });
  }));
}

// ---------------------------------------------------------------------
function auditoriaDatos(c, app) {
  const reglas = auditoria(app.filas, app.semana.inicio);
  const sel = reglas.find((r) => r.id === app.params.regla);
  c.innerHTML = `
    <p class="intro">Calidad de los datos cargados. Indica qué está incompleto o inconsistente, dónde encontrarlo en el Excel y a quién afecta. Lo que afecta al análisis de Gerencia ya aparece resumido en <a href="#/riesgos?tab=situaciones">Situaciones detectadas</a>.</p>
    <section class="panel"><div data-resumen></div></section>
    ${sel ? `<section class="panel"><header class="panel-cab"><h2>${esc(sel.nombre)}</h2><a href="#/riesgos?tab=auditoria">Cerrar</a></header><p class="porque">${esc(sel.porque)} Si un caso está bien así (por ejemplo, un viaje de todo el día), marcalo como revisado: no vuelve a aparecer para esa persona y esa tarea.</p><div data-det></div>
      ${sel.revisadas.length ? `<details class="revisadas"><summary>Revisadas (${sel.revisadas.length})</summary><div data-rev></div></details>` : ''}</section>` : ''}`;

  tabla(c.querySelector('[data-resumen]'), {
    rows: reglas, onRow: (r) => app.ir('riesgos', r.id === sel?.id ? { tab: 'auditoria' } : { tab: 'auditoria', regla: r.id }),
    cols: [
      { key: 'nombre', label: 'Qué revisar', render: (r) => `<span class="nom ${r.id === sel?.id ? 'sel' : ''}">${esc(r.nombre)}</span>${r.grave ? '' : ' <span class="tenue">(recomendado)</span>'}` },
      { key: 'cant', label: 'Actividades', alinear: 'num', sort: (r) => r.items.length, render: (r) => `${r.items.length ? num(r.items.length, 0) : '<span class="ok-txt">0</span>'}${r.revisadas.length ? `<span class="tenue bloque">${r.revisadas.length} revisadas</span>` : ''}` },
      { key: 'pct', label: '% del total', alinear: 'num', render: (r) => porc(r.pct) },
      { key: 'personas', label: 'A quién afecta', sort: (r) => r.personas.length, render: (r) => (r.personas.length ? `${r.personas.slice(0, 3).map((p) => `${esc(p.persona)} (${p.cantidad})`).join(', ')}${r.personas.length > 3 ? ` y ${r.personas.length - 3} más` : ''}` : '<span class="tenue">—</span>') },
      { key: 'porque', label: 'Por qué revisarlo', clase: 'col-texto tenue' },
    ],
  });

  const marcar = async (r, revisada, btn) => {
    btn.disabled = true;
    try {
      await db.marcarRevisada(r.personaId, r.tareaNorm, sel.id, revisada);
      const k = claveExcepcion(r, sel.id);
      if (revisada) CTX.excepciones.add(k); else CTX.excepciones.delete(k);
      olvidarSituaciones();
      auditoriaDatos(c, app);
    } catch (e) { aviso(e.message, 'error'); btn.disabled = false; }
  };
  const colsDet = (revisada) => [
      { key: 'persona', label: 'Persona', render: (r) => `<span class="nom">${esc(r.persona)}</span>` },
      { key: 'donde', label: 'Dónde', sort: (r) => `${r.hoja}${String(r.fila).padStart(4, '0')}`, render: (r) => `Hoja "${esc(r.hoja)}", fila ${r.fila}` },
      { key: 'fecha', label: 'Fecha', render: (r) => `${diaDe(r).slice(0, 3)} ${fechaCorta(r.fecha)}` },
      { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (r) => esc(r.tarea) || '<span class="tenue">Sin descripción</span>' },
      { key: 'prioridad', label: 'Prioridad', render: (r) => prioBadge(r.prioridad) },
      { key: 'horas', label: 'Tiempo', alinear: 'num', render: (r) => (r.horas ? `${num(r.horas)} h` : '<span class="tenue">—</span>') },
      { key: 'acc', label: '', render: (r) => `<button type="button" class="btn-mini" data-rev-id="${r.id}">${revisada ? 'Volver a mostrar' : 'Marcar revisada'}</button>` },
  ];
  if (!sel) return;
  const conectar = (cont, lista, revisada) => {
    tabla(cont, { rows: lista, onRow: (r) => abrirDetalle(r, app), max: 500, vacio: 'Nada para revisar en esta regla.', cols: colsDet(revisada) });
    // delegación: sigue funcionando aunque la tabla se reordene
    cont.addEventListener('click', (e) => { const b = e.target.closest('[data-rev-id]'); if (b) marcar(lista.find((x) => x.id === b.dataset.revId), !revisada, b); });
  };
  conectar(c.querySelector('[data-det]'), sel.items, false);
  if (sel.revisadas.length) conectar(c.querySelector('[data-rev]'), sel.revisadas, true);
}
