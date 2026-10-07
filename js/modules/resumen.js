// =====================================================================
// 📊 Resumen — portada ejecutiva: ¿qué debería mirar Gerencia esta semana?
//   A. Indicadores principales (sin repetir el detalle de otras hojas)
//   B. Situaciones que requieren atención (las más importantes; el detalle está en Riesgos y auditoría)
//   C. Planificación cargada por semana (histórico completo, se mantiene)
//   D. Principales oportunidades de mejora (síntesis; el detalle está en Propuestas de mejora)
// =====================================================================
import { kpisSemana, cumplimientoCarga, analisisRepetitivas, GRUPOS, grupoPropuesta, ordenPropuesta, ESTADOS_ACTIVOS, CONFIG } from '../engine.js';
import { esc, num, horas, porc, signo, rangoSemana, fechaCorta, situacionHTML, grupoBadge } from '../ui.js';
import { situacionesSemana } from '../situaciones.js';
import { abrirPropuesta, borradorDeTarea } from '../propuesta.js';

export const titulo = 'Resumen';
const MAX_SITUACIONES = 6;

function delta(actual, previo, { suf = '', invertir = false, texto = 'vs semana anterior' } = {}) {
  if (previo === null || previo === undefined || actual === null || actual === undefined) return '';
  const d = actual - previo;
  if (Math.abs(d) < 0.05) return '<span class="delta">igual que la semana anterior</span>';
  const bueno = invertir ? d < 0 : d > 0;
  return `<span class="delta ${bueno ? 'd-bien' : 'd-mal'}">${signo(d, suf)} ${texto}</span>`;
}

export async function render(el, app) {
  const k = kpisSemana(app.filas);
  const hayPrevia = app.filasPrevia.length > 0;
  const kp = hayPrevia ? kpisSemana(app.filasPrevia) : {};
  const { lista, cobertura: cob, rango } = await situacionesSemana(app);
  const criticas = lista.filter((s) => s.nivel === 'critica').length;
  const propuestas = app.propuestasVisibles();
  const activas = propuestas.filter((p) => ESTADOS_ACTIVOS.includes(p.estado));
  const implementadas = propuestas.filter((p) => p.estado === 'Implementada').length;
  const cumplMedible = k.cumplimiento !== null && k.cobertura >= CONFIG.coberturaMin;

  // lectura en una frase: qué pasó y qué mirar primero
  const situacion = [
    `${k.personas} ${k.personas === 1 ? 'persona planificó' : 'personas planificaron'} ${horas(k.horas)}${k.capacidad ? `, el ${porc(k.ocupacion)} de su capacidad estimada` : ''}.`,
    cob.faltan.length ? `Falta la planificación de ${cob.faltan.length} ${cob.faltan.length === 1 ? 'persona habitual' : 'personas habituales'}.` : '',
    k.sobrecarga ? `${k.sobrecarga} ${k.sobrecarga === 1 ? 'persona supera' : 'personas superan'} su capacidad.` : 'Nadie supera su capacidad semanal.',
    !cumplMedible ? `El cumplimiento no se puede medir: solo el ${porc(k.cobertura)} de las actividades tiene Estado.` : `El cumplimiento es del ${porc(k.cumplimiento)}.`,
  ].filter(Boolean).join(' ');

  el.innerHTML = `
  <header class="mod-cab">
    <h1>Resumen de la semana</h1>
    <p class="sub">${rangoSemana(app.semana.inicio, app.semana.fin)}</p>
  </header>

  <section class="kpis kpis-5" aria-label="Indicadores de la semana">
    <div class="kpi ${cob.faltan.length ? 'kpi-warn' : ''}"><span class="kpi-l">Planificación recibida</span><span class="kpi-v">${k.personas}<small> de ${Math.max(cob.habituales, k.personas)}</small></span>${cob.faltan.length ? `<span class="delta d-mal">${cob.faltan.length} sin planificación cargada</span>` : '<span class="delta d-bien">todas las personas habituales</span>'}</div>
    <a class="kpi kpi-link" href="#/planificacion"><span class="kpi-l">Carga del equipo</span><span class="kpi-v">${porc(k.ocupacion)}</span><span class="delta">${num(k.horas)} h de ${num(k.capacidad, 0)} h de capacidad${k.sobrecarga ? `, <span class="d-mal">${k.sobrecarga} con sobrecarga</span>` : ''}</span></a>
    <div class="kpi ${!cumplMedible ? 'kpi-warn' : ''}"><span class="kpi-l">Cumplimiento</span><span class="kpi-v">${cumplMedible ? porc(k.cumplimiento) : '<span class="kpi-nd">No medible</span>'}</span>${cumplMedible ? delta(k.cumplimiento, kp.cumplimiento, { suf: ' pts' }) : `<span class="delta">solo el ${porc(k.cobertura)} tiene Estado</span>`}</div>
    <a class="kpi kpi-link ${criticas ? 'kpi-crit' : ''}" href="#/riesgos?tab=situaciones"><span class="kpi-l">Situaciones críticas</span><span class="kpi-v">${criticas}</span><span class="delta">${lista.length} situaciones detectadas en total</span></a>
    <a class="kpi kpi-link" href="#/mejoras"><span class="kpi-l">Mejoras en curso</span><span class="kpi-v">${activas.length}</span><span class="delta">${app.propuestasDisponibles ? `${implementadas} ${implementadas === 1 ? 'implementada' : 'implementadas'}` : 'falta habilitar el registro'}</span></a>
  </section>
  <p class="situacion">${esc(situacion)}</p>

  <section class="panel" aria-labelledby="mirar-t">
    <header class="panel-cab"><h2 id="mirar-t">¿Qué mirar esta semana?</h2>${lista.length > MAX_SITUACIONES ? `<a href="#/riesgos?tab=situaciones">Ver las ${lista.length} situaciones</a>` : ''}</header>
    ${lista.length ? `<div class="grid-situ">${lista.slice(0, MAX_SITUACIONES).map((s) => situacionHTML(s, { compacta: true })).join('')}</div>`
      : '<p class="vacio">No se detectaron situaciones que requieran atención esta semana.</p>'}
  </section>

  <section class="panel" aria-labelledby="carga-sem-t">
    <header class="panel-cab"><h2 id="carga-sem-t">Planificación cargada por semana</h2>
      <span class="leyenda-semaforo"><span class="sem-pill s-rojo">0–25%</span><span class="sem-pill s-naranja">25–50%</span><span class="sem-pill s-amarillo">50–75%</span><span class="sem-pill s-verde">75–100%</span></span></header>
    <div data-carga-semanal><p class="tenue">Cargando…</p></div>
  </section>

  <section class="panel" aria-labelledby="opor-t">
    <header class="panel-cab"><h2 id="opor-t">Principales oportunidades de mejora</h2><a href="#/mejoras">Ver todas las propuestas</a></header>
    <div data-oportunidades></div>
  </section>`;

  oportunidades(el.querySelector('[data-oportunidades]'), app, activas, rango);
  await cuadroCargaSemanal(el.querySelector('[data-carga-semanal]'), app);
}

// Síntesis: primero las propuestas registradas por prioridad (Impacto × Esfuerzo); si hay pocas,
// se completan con las tareas repetitivas de más horas que todavía no tienen propuesta.
function oportunidades(cont, app, activas, rango) {
  const top = [...activas].sort((a, b) => ordenPropuesta(a) - ordenPropuesta(b) || (b.horas_mes_base || 0) - (a.horas_mes_base || 0)).slice(0, 4);
  const conProp = new Set(app.propuestas.map((p) => p.tarea_clave).filter(Boolean));
  const nSem = new Set(rango.map((r) => r.semana)).size;
  const sinEvaluar = top.length >= 4 ? [] : analisisRepetitivas(rango, nSem).filter((t) => t.horasMes && t.tipoSugerido && !conProp.has(t.clave)).slice(0, 4 - top.length);
  if (!top.length && !sinEvaluar.length) { cont.innerHTML = '<p class="vacio">No hay oportunidades registradas ni tareas repetitivas relevantes en las últimas semanas.</p>'; return; }
  cont.innerHTML = `<ul class="lista-opor">
    ${top.map((p) => { const g = grupoPropuesta(p.impacto, p.esfuerzo);
      return `<li><a href="#/mejoras?propuesta=${p.id}" class="lo-tit">${esc(p.titulo)}</a>
        <span class="lo-meta">${grupoBadge(g, GRUPOS)} ${p.impacto ? `Impacto ${p.impacto.toLowerCase()}, esfuerzo ${(p.esfuerzo || 'sin evaluar').toLowerCase()}` : 'Impacto y esfuerzo sin evaluar'}</span>
        <span class="lo-est">${esc(p.estado)}${p.responsable ? `, ${esc(p.responsable)}` : ''}</span></li>`; }).join('')}
    ${sinEvaluar.map((t) => `<li><span class="lo-tit">${esc(t.tarea)}</span>
        <span class="lo-meta"><span class="badge n-info">Sin evaluar</span> ${esc(t.tipoSugerido)}: ${num(t.vecesSemana)} veces por semana, ${num(t.horasMes)} h por mes</span>
        <span class="lo-est"><button type="button" class="btn-mini" data-evaluar="${esc(t.clave)}">Evaluar</button></span></li>`).join('')}
  </ul>
  ${sinEvaluar.length ? '<p class="nota">Las horas por mes son las que hoy consume la tarea según la planificación, no un ahorro estimado.</p>' : ''}`;
  cont.querySelectorAll('[data-evaluar]').forEach((b) => b.addEventListener('click', () => {
    const t = sinEvaluar.find((x) => x.clave === b.dataset.evaluar);
    abrirPropuesta(app, { borrador: borradorDeTarea(t, app), alGuardar: () => app.ir('mejoras') });
  }));
}

// Cuadro persona × semana: ✓ si esa semana tiene planificación, ✗ si no.
// Semana 1 = primera semana registrada; llega hasta la semana seleccionada.
// Orden del cuadro (se conserva mientras la aplicación está abierta)
const ORDEN_CC = { col: 'persona', dir: 1 };
const FILAS_VISIBLES = 10;

async function cuadroCargaSemanal(cont, app) {
  const hasta = app.semana.inicio;
  const semanas = [...app.semanas].reverse().map((s) => s.inicio).filter((s) => s <= hasta);
  let datos;
  // app.personaSemana ya está en memoria (se recarga después de cada carga de Excel); el área es la del Excel
  try { datos = cumplimientoCarga(app.personaSemana.filter((r) => app.pasa(r)), semanas); }  // respeta los filtros globales
  catch (e) { cont.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  if (!datos.personas.length) { cont.innerHTML = '<p class="vacio">Sin datos.</p>'; return; }
  const OK = '<svg class="ico-ok" viewBox="0 0 20 20" aria-label="Con planificación" role="img"><path d="M4 10.5l4 4 8-9"/></svg>';
  const NO = '<svg class="ico-no" viewBox="0 0 20 20" aria-label="Sin planificación" role="img"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  if (ORDEN_CC.col.startsWith('s') && +ORDEN_CC.col.slice(1) >= datos.semanas.length) { ORDEN_CC.col = 'persona'; ORDEN_CC.dir = 1; }

  // valor de orden de cada columna; empates: por nombre
  const valor = (p, col) => (col === 'persona' ? p.persona : col === 'pct' ? p.pct : (p.marcas[+col.slice(1)] ? 1 : 0));
  const ordenar = () => [...datos.personas].sort((a, b) => {
    const va = valor(a, ORDEN_CC.col), vb = valor(b, ORDEN_CC.col);
    const c = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return c * ORDEN_CC.dir || a.persona.localeCompare(b.persona, 'es');
  });
  const aria = (col) => (ORDEN_CC.col === col ? (ORDEN_CC.dir > 0 ? 'ascending' : 'descending') : 'none');
  const th = (col, clase, contenido, titulo) =>
    `<th scope="col" class="${clase}" aria-sort="${aria(col)}"><button type="button" data-orden="${col}" title="${esc(titulo)}">${contenido}</button></th>`;

  const dibujar = () => {
    const filas = ordenar();
    cont.innerHTML = `<div class="cc-scroll" tabindex="0" aria-label="Planificación cargada por semana. Desplazá para ver más personas."><table class="cuadro-carga">
      <thead><tr>
        ${th('persona', 'cc-persona', 'Persona', 'Ordenar por nombre')}
        ${datos.semanas.map((s, i) => th(`s${i}`, s.inicio === hasta ? 'cc-actual' : '', `${s.numero}<span>${fechaCorta(s.inicio)}</span>`, `Semana ${s.numero}, del ${fechaCorta(s.inicio)}: ordenar por planificación cargada`)).join('')}
        ${th('pct', 'cc-pct', 'Cumplimiento<span>semanas con planificación</span>', 'Ordenar por porcentaje de cumplimiento')}
      </tr></thead>
      <tbody>${filas.map((p) => `<tr>
        <th scope="row" class="cc-persona"><a href="#/planificacion?persona=${encodeURIComponent(p.persona)}">${esc(p.persona)}</a><span>${esc(p.area)}</span></th>
        ${p.marcas.map((m, i) => `<td class="${datos.semanas[i].inicio === hasta ? 'cc-actual' : ''}">${m ? OK : NO}</td>`).join('')}
        <td class="cc-pct"><span class="sem-pill s-${p.nivel}" title="${p.conPlan} de ${p.total} semanas">${porc(p.pct)}</span><span class="cc-frac">${p.conPlan}/${p.total}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="nota">${filas.length > FILAS_VISIBLES ? `Se ven ${FILAS_VISIBLES} de ${filas.length} personas: desplazá la tabla para ver el resto. ` : ''}Tocá el encabezado de una columna para ordenar; otro toque invierte el orden. La semana 1 es la primera semana registrada (${fechaCorta(datos.semanas[0].inicio)}). El cumplimiento es la cantidad de semanas con planificación sobre el total de semanas${semanas.length < app.semanas.length ? ', hasta la semana seleccionada' : ''}.</p>`;

    // alto visible: encabezado + 10 filas
    const scroll = cont.querySelector('.cc-scroll');
    const trs = scroll.querySelectorAll('tbody tr');
    if (trs.length > FILAS_VISIBLES) {
      const alto = scroll.querySelector('thead').offsetHeight + [...trs].slice(0, FILAS_VISIBLES).reduce((a, tr) => a + tr.offsetHeight, 0);
      scroll.style.maxHeight = `${alto + 2}px`;
    }
    scroll.querySelectorAll('[data-orden]').forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.orden;
      if (ORDEN_CC.col === col) ORDEN_CC.dir = -ORDEN_CC.dir;
      else { ORDEN_CC.col = col; ORDEN_CC.dir = col === 'persona' ? 1 : -1; }   // números: primero los más altos
      dibujar();
      cont.querySelector(`[data-orden="${col}"]`)?.focus();
    }));
  };
  dibujar();
}
