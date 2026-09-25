// =====================================================================
// ⚠️ Riesgos y auditoría
//   · Riesgos declarados: lo que escribe el usuario en la columna Riesgos
//   · Alertas del sistema: lo que detectan las reglas automáticamente
//   · Auditoría de datos: calidad del registro
// Los tres se muestran separados: no son lo mismo.
// =====================================================================
import * as db from '../db.js';
import { alertas, auditoria, REGLAS_ALERTA, NIVELES_RIESGO, nivelRiesgo, tieneRiesgo, norm, groupBy, diaDe } from '../engine.js';
import { esc, num, porc, tabla, nivelBadge, riesgoBadge, opciones, aviso, fechaCorta, rangoSemana, prioBadge } from '../ui.js';
import { abrirDetalle } from '../detalle.js';

export const titulo = 'Riesgos y auditoría';
const TABS = [['riesgos', 'Riesgos declarados'], ['alertas', 'Alertas del sistema'], ['auditoria', 'Auditoría de datos']];
const FR = { persona: '', area: '', nivel: '' };

export async function render(el, app) {
  const tab = TABS.some(([k]) => k === app.params.tab) ? app.params.tab : 'riesgos';
  el.innerHTML = `
  <header class="mod-cab">
    <h1>Riesgos y auditoría</h1>
    <p class="sub">${rangoSemana(app.semana.inicio, app.semana.fin)}</p>
  </header>
  <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/riesgos?tab=${k}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav>
  <div data-cont></div>`;
  const c = el.querySelector('[data-cont]');
  if (tab === 'riesgos') await riesgosDeclarados(c, app);
  if (tab === 'alertas') alertasSistema(c, app);
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
  const grupos = [...groupBy(app.filas.filter(tieneRiesgo), (r) => `${r.persona}|${norm(r.riesgos)}`)].map(([k, rs]) => {
    const probs = new Set(rs.map((r) => r.riesgoProb || '')), imps = new Set(rs.map((r) => r.riesgoImpacto || ''));
    const prob = probs.size === 1 ? [...probs][0] : '', imp = imps.size === 1 ? [...imps][0] : '';
    return { k, persona: rs[0].persona, area: rs[0].area, riesgo: rs[0].riesgos, rows: rs, prob, imp,
      nivel: nivelRiesgo(prob, imp), semanas: semanasPorRiesgo.get(k)?.size || 1, prioAlta: rs.some((r) => r.prioridad === 'Alta') };
  });

  const personas = [...new Set(grupos.map((g) => g.persona))].sort();
  const areas = [...new Set(grupos.map((g) => g.area))].sort();
  c.innerHTML = `
    <p class="intro">Riesgos escritos por cada persona en la columna <b>Riesgos</b> del Excel. Asigná probabilidad e impacto para obtener el nivel; se guarda para todas las actividades con ese mismo riesgo.</p>
    <form class="filtros">
      <label>Persona<select name="persona">${opciones(personas, FR.persona, 'Todas')}</select></label>
      <label>Área<select name="area">${opciones(areas, FR.area, 'Todas')}</select></label>
      <label>Nivel<select name="nivel">${opciones([['crítico', 'Crítico'], ['alto', 'Alto'], ['moderado', 'Moderado'], ['bajo', 'Bajo'], ['sin', 'Sin evaluar']], FR.nivel, 'Todos')}</select></label>
    </form>
    <div class="grid-riesgos">
      <section class="panel"><header class="panel-cab"><h2>Riesgos de la semana</h2><span class="tenue" data-cuenta></span></header><div data-tabla></div></section>
      <section class="panel"><header class="panel-cab"><h2>Matriz de riesgo</h2></header><div data-matriz></div></section>
    </div>`;

  const aplicar = () => {
    const vis = grupos.filter((g) => (!FR.persona || g.persona === FR.persona) && (!FR.area || g.area === FR.area) &&
      (!FR.nivel || (FR.nivel === 'sin' ? !g.nivel : g.nivel === FR.nivel)));
    c.querySelector('[data-cuenta]').textContent = `${vis.length} riesgos en ${num(vis.reduce((a, g) => a + g.rows.length, 0), 0)} actividades, ${vis.filter((g) => !g.nivel).length} sin evaluar`;
    tabla(c.querySelector('[data-tabla]'), {
      rows: vis, orden: { key: 'semanas', dir: -1 }, vacio: 'No hay riesgos declarados con estos filtros.',
      cols: [
        { key: 'persona', label: 'Persona', render: (g) => `<span class="nom">${esc(g.persona)}</span><span class="tenue bloque">${esc(g.area)}</span>` },
        { key: 'riesgo', label: 'Riesgo declarado', clase: 'col-tarea', render: (g) => `${esc(g.riesgo)}<span class="tenue bloque">${g.rows.length === 1 ? `${esc(g.rows[0].tarea)}` : `${g.rows.length} actividades`}${g.prioAlta ? ', incluye prioridad Alta' : ''}</span>` },
        { key: 'semanas', label: 'Semanas', alinear: 'num', render: (g) => (g.semanas > 1 ? `<span title="Declarado en ${g.semanas} de las últimas 8 semanas">${g.semanas}</span>` : '1') },
        { key: 'prob', label: 'Probabilidad', render: (g) => sel(g, 'prob') },
        { key: 'imp', label: 'Impacto', render: (g) => sel(g, 'imp') },
        { key: 'nivel', label: 'Nivel', sort: (g) => ({ crítico: 4, alto: 3, moderado: 2, bajo: 1 }[g.nivel] || 0), render: (g) => `<span data-nivel="${esc(g.k)}">${riesgoBadge(g.nivel)}</span>` },
      ],
      onRow: (g) => { if (g.rows.length === 1) abrirDetalle(g.rows[0], app); },
    });
    c.querySelectorAll('select[data-g]').forEach((s) => s.addEventListener('change', () => guardar(s, grupos, app, aplicar)));
    matriz(c.querySelector('[data-matriz]'), vis);
  };
  c.querySelector('.filtros').addEventListener('input', (e) => { FR[e.target.name] = e.target.value; aplicar(); });
  aplicar();
}

const sel = (g, campo) => `<select class="sel-riesgo" data-g="${esc(g.k)}" data-campo="${campo}" aria-label="${campo === 'prob' ? 'Probabilidad' : 'Impacto'}">
  <option value="">—</option>${NIVELES_RIESGO.map((n) => `<option value="${n}" ${g[campo] === n ? 'selected' : ''}>${n[0].toUpperCase() + n.slice(1)}</option>`).join('')}</select>`;

async function guardar(s, grupos, app, repintar) {
  const g = grupos.find((x) => x.k === s.dataset.g);
  const campo = s.dataset.campo === 'prob' ? 'riesgo_prob' : 'riesgo_impacto';
  const local = s.dataset.campo === 'prob' ? 'riesgoProb' : 'riesgoImpacto';
  s.disabled = true;
  try {
    await Promise.all(g.rows.map((r) => db.actualizarActividad(r.id, { [campo]: s.value || null })));
    g.rows.forEach((r) => app.actualizarLocal(r.id, { [local]: s.value || null }));
    g[s.dataset.campo] = s.value; g.nivel = nivelRiesgo(g.prob, g.imp);
    repintar();
  } catch (e) { aviso(`No se guardó: ${e.message}`, 'error'); s.disabled = false; }
}

function matriz(cont, grupos) {
  const cnt = (p, i) => grupos.filter((g) => g.prob === p && g.imp === i).length;
  const orden = [...NIVELES_RIESGO].reverse();
  const sinEval = grupos.filter((g) => !g.nivel).length;
  cont.innerHTML = `<table class="matriz-riesgo" aria-label="Riesgos por probabilidad e impacto">
    <thead><tr><th></th>${NIVELES_RIESGO.map((i) => `<th>${i}</th>`).join('')}</tr></thead>
    <tbody>${orden.map((p) => `<tr><th scope="row">${p}</th>${NIVELES_RIESGO.map((i) => { const n = cnt(p, i); const nv = nivelRiesgo(p, i);
      return `<td class="mr r-${nv === 'crítico' ? 'critico' : nv}">${n || ''}</td>`; }).join('')}</tr>`).join('')}</tbody>
  </table>
  <p class="nota eje">Filas: probabilidad. Columnas: impacto.</p>
  ${sinEval ? `<p class="nota">${sinEval} ${sinEval === 1 ? 'riesgo sin evaluar' : 'riesgos sin evaluar'} no aparecen en la matriz.</p>` : ''}`;
}

// ---------------------------------------------------------------------
function alertasSistema(c, app) {
  const al = alertas(app.filas);
  const niveles = { critica: 'Críticas', advertencia: 'Advertencias', info: 'Para revisar' };
  const f = app.params.nivel || '';
  const vis = al.filter((a) => !f || a.nivel === f);
  const porRegla = groupBy(vis, (a) => a.regla);
  c.innerHTML = `
    <p class="intro">Detectadas automáticamente a partir de la planificación cargada. No reemplazan a los riesgos declarados por cada persona.</p>
    <nav class="chips">${[['', `Todas (${al.length})`], ...Object.entries(niveles).map(([k, l]) => [k, `${l} (${al.filter((a) => a.nivel === k).length})`])]
      .map(([k, l]) => `<a href="#/riesgos?tab=alertas${k ? `&nivel=${k}` : ''}" aria-current="${f === k}">${l}</a>`).join('')}</nav>
    ${!vis.length ? '<p class="vacio panel">Sin alertas para este nivel.</p>' : [...porRegla].map(([regla, as]) => `
      <section class="panel alerta-grupo">
        <header class="panel-cab"><h2>${esc(REGLAS_ALERTA[regla])}</h2><span class="tenue">${as.length} ${as.length === 1 ? 'caso' : 'casos'}</span></header>
        <p class="porque">${esc(as[0].porque)}</p>
        <ul class="lista-alertas">${as.map((a) => `<li>${nivelBadge(a.nivel)} <a href="#/personas?persona=${encodeURIComponent(a.persona)}">${esc(a.persona)}</a> <span>${esc(a.detalle)}</span></li>`).join('')}</ul>
      </section>`).join('')}`;
}

// ---------------------------------------------------------------------
function auditoriaDatos(c, app) {
  const reglas = auditoria(app.filas, app.semana.inicio);
  const sel = reglas.find((r) => r.id === app.params.regla);
  c.innerHTML = `
    <p class="intro">Calidad de los datos cargados. Indica qué está incompleto o inconsistente, dónde encontrarlo en el Excel y a quién afecta.</p>
    <section class="panel"><div data-resumen></div></section>
    ${sel ? `<section class="panel"><header class="panel-cab"><h2>${esc(sel.nombre)}</h2><a href="#/riesgos?tab=auditoria">Cerrar</a></header><p class="porque">${esc(sel.porque)}</p><div data-det></div></section>` : ''}`;

  tabla(c.querySelector('[data-resumen]'), {
    rows: reglas, onRow: (r) => app.ir('riesgos', r.id === sel?.id ? { tab: 'auditoria' } : { tab: 'auditoria', regla: r.id }),
    cols: [
      { key: 'nombre', label: 'Qué revisar', render: (r) => `<span class="nom ${r.id === sel?.id ? 'sel' : ''}">${esc(r.nombre)}</span>${r.grave ? '' : ' <span class="tenue">(recomendado)</span>'}` },
      { key: 'cant', label: 'Actividades', alinear: 'num', sort: (r) => r.items.length, render: (r) => (r.items.length ? num(r.items.length, 0) : '<span class="ok-txt">0</span>') },
      { key: 'pct', label: '% del total', alinear: 'num', render: (r) => porc(r.pct) },
      { key: 'personas', label: 'A quién afecta', sort: (r) => r.personas.length, render: (r) => (r.personas.length ? `${r.personas.slice(0, 3).map((p) => `${esc(p.persona)} (${p.cantidad})`).join(', ')}${r.personas.length > 3 ? ` y ${r.personas.length - 3} más` : ''}` : '<span class="tenue">—</span>') },
      { key: 'porque', label: 'Por qué revisarlo', clase: 'col-texto tenue' },
    ],
  });

  if (sel) tabla(c.querySelector('[data-det]'), {
    rows: sel.items, onRow: (r) => abrirDetalle(r, app), max: 500, vacio: 'Nada para revisar en esta regla.',
    cols: [
      { key: 'persona', label: 'Persona', render: (r) => `<span class="nom">${esc(r.persona)}</span>` },
      { key: 'donde', label: 'Dónde', sort: (r) => `${r.hoja}${String(r.fila).padStart(4, '0')}`, render: (r) => `Hoja "${esc(r.hoja)}", fila ${r.fila}` },
      { key: 'fecha', label: 'Fecha', render: (r) => `${diaDe(r).slice(0, 3)} ${fechaCorta(r.fecha)}` },
      { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (r) => esc(r.tarea) || '<span class="tenue">Sin descripción</span>' },
      { key: 'prioridad', label: 'Prioridad', render: (r) => prioBadge(r.prioridad) },
      { key: 'horas', label: 'Tiempo', alinear: 'num', render: (r) => (r.horas ? `${num(r.horas)} h` : '<span class="tenue">—</span>') },
    ],
  });
}
