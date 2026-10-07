// =====================================================================
// 📋 Planificación — qué se planificó y cómo está distribuida la carga.
// El mapa de calor Persona × Día es el centro del análisis: cada celda indica el nivel
// de carga frente a la capacidad diaria estimada y, al seleccionarla, muestra qué la genera.
// (Incluye el detalle por persona que antes estaba en la hoja Personas.)
// =====================================================================
import { DIAS, PRIORIDADES, ESTADOS, diaDe, prioridadDe, estadoDe, repetitivasSemana, claveTarea, norm, CONFIG, cargaDiaria, alertas,
  coberturaCarga, NIVELES_DIA, esHabil, statsPersonas, groupBy } from '../engine.js';
import { esc, num, horas, porc, signo, tabla, barraApilada, prioBadge, multiSelect, COLOR_PRIORIDAD, COLOR_ESTADO, fechaCorta, rangoSemana,
  barraOcupacion, etiquetaSemana, fechaHora, grafico, PALETA, nivelBadge } from '../ui.js';
import { abrirDetalle } from '../detalle.js';

export const titulo = 'Planificación';
// Filtros propios de la hoja (Área y Persona son globales, en la barra superior)
let F = { dia: [], prioridad: [], estado: [], texto: '' };
const limpiarPropios = () => { F.dia = []; F.prioridad = []; F.estado = []; F.texto = ''; };
const cuentaPropios = () => F.dia.length + F.prioridad.length + F.estado.length + (F.texto ? 1 : 0);
// Celda o persona seleccionada en el mapa (se conserva al cambiar filtros)
const SEL = { persona: null, dia: null };

export async function render(el, app) {
  F = app.filtrosHoja('planificacion', { dia: [], prioridad: [], estado: [], texto: '' });
  app.registrarLimpieza('planificacion', limpiarPropios, cuentaPropios);
  // "Ver en Planificación" desde otra hoja: filtro global de persona y su detalle abierto
  if (app.params.persona) {
    const p = app.params.persona; history.replaceState(null, '', '#/planificacion');
    SEL.persona = p; SEL.dia = null;
    await app.fijarFiltros({ personas: [p] }, { redibujar: false });
  }
  const todas = app.filas;
  const diasPresentes = DIAS.filter((d) => todas.some((r) => diaDe(r) === d));

  const repetidas = new Set(repetitivasSemana(todas).map((x) => `${x.persona}|${x.clave}`));
  const modificadas = new Set(app.cambiosSemana.filter((c) => c.tipo === 'modificacion' && c.origen === 'excel').map((c) => c.actividadId));
  // personas que planifican habitualmente y esta semana no (ausencia de planificación)
  const cob = coberturaCarga(todas, app.personaSemana.filter((r) => r.semana < app.semana.inicio && app.pasa(r)));

  el.innerHTML = `
  <header class="mod-cab">
    <h1>Planificación</h1>
    <p class="sub">${rangoSemana(app.semana.inicio, app.semana.fin)}</p>
  </header>
  <form class="filtros" aria-label="Filtros de la hoja" onsubmit="return false">
    <span data-ms="dia"></span><span data-ms="prioridad"></span><span data-ms="estado"></span>
    <label class="crece">Buscar<input name="texto" type="search" value="${esc(F.texto)}" placeholder="Tarea, recurso o riesgo"></label>
  </form>
  <div class="grid-plan">
    <section class="panel" aria-labelledby="mapa-t">
      <header class="panel-cab"><h2 id="mapa-t">Carga de personas por día</h2><span class="tenue" data-cuenta></span></header>
      <ul class="leyenda-carga" aria-label="Niveles de carga">${['sobrecarga', 'elevada', 'normal', 'baja', 'sin'].map((n) => `<li><i class="hm n-${n}"></i>${NIVELES_DIA[n]}</li>`).join('')}</ul>
      <div data-matriz></div>
      <div data-det class="det-carga" hidden></div>
    </section>
    <div class="col-lateral">
      <section class="panel sintesis" data-sintesis></section>
      <section class="panel"><header class="panel-cab"><h2>Horas por prioridad</h2></header><div data-prio></div>
        <header class="panel-cab sep"><h2>Actividades por estado</h2></header><div data-estado></div></section>
    </div>
  </div>
  <section class="panel">
    <header class="panel-cab"><h2>Actividades</h2><span class="leyenda-iconos"><span class="ico-rep">↻</span> se repite en la semana <span class="ico-mod">✎</span> modificada después de la primera carga <span class="ico-new">＋</span> agregada después</span></header>
    <div data-tabla></div>
  </section>`;

  sintesis(el.querySelector('[data-sintesis]'), todas, cob);

  const form = el.querySelector('.filtros');
  const aplicar = () => {
    const t = norm(F.texto);
    const rows = todas.filter((r) =>
      (!F.dia.length || F.dia.includes(diaDe(r))) && (!F.prioridad.length || F.prioridad.includes(prioridadDe(r))) &&
      (!F.estado.length || F.estado.includes(estadoDe(r))) && (!t || norm(`${r.tarea} ${r.recursos} ${r.riesgos}`).includes(t)));
    const hayFiltroHoja = cuentaPropios() > 0;
    el.querySelector('[data-cuenta]').textContent = `${num(rows.length, 0)} de ${num(todas.length, 0)} actividades`;
    const carga = cargaDiaria(rows);
    pintarMatriz(el.querySelector('[data-matriz]'), carga, rows, { faltan: hayFiltroHoja ? [] : cob.faltan, hayFiltroHoja },
      (persona, dia) => {
        // un segundo clic sobre lo mismo cierra el detalle
        if (SEL.persona === persona && SEL.dia === dia) { SEL.persona = null; SEL.dia = null; } else { SEL.persona = persona; SEL.dia = dia; }
        pintarDetalle(el, app, carga);
      });
    pintarDetalle(el, app, carga);
    const hPrio = PRIORIDADES.map((p) => ({ label: p, valor: rows.filter((r) => prioridadDe(r) === p).reduce((a, r) => a + (r.horas || 0), 0), color: COLOR_PRIORIDAD[p] }));
    el.querySelector('[data-prio]').innerHTML = barraApilada(hPrio, { formato: horas });
    const cEst = ESTADOS.map((e) => ({ label: e, valor: rows.filter((r) => estadoDe(r) === e).length, color: COLOR_ESTADO[e] }));
    el.querySelector('[data-estado]').innerHTML = barraApilada(cEst, { formato: (v) => num(v, 0) });

    tabla(el.querySelector('[data-tabla]'), {
      rows, max: 800, vacio: 'Ninguna actividad coincide con los filtros.',
      orden: { key: 'fecha', dir: 1 },
      onRow: (r) => abrirDetalle(r, app),
      cols: [
        { key: 'persona', label: 'Persona', render: (r) => `<span class="nom">${esc(r.persona)}</span>` },
        { key: 'fecha', label: 'Fecha', clase: 'nw', sort: (r) => `${r.fecha || '9'}|${r.persona}|${String(r.fila).padStart(4, '0')}`, render: (r) => `${diaDe(r).slice(0, 3)} ${fechaCorta(r.fecha)}` },
        { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (r) => `${esc(r.tarea) || '<span class="tenue">Sin descripción</span>'}
            ${repetidas.has(`${r.persona}|${claveTarea(r.tarea) || norm(r.tarea)}`) ? '<span class="ico-rep" title="Se repite en la semana">↻</span>' : ''}
            ${modificadas.has(r.id) ? '<span class="ico-mod" title="Modificada después de la primera carga">✎</span>' : ''}
            ${r.altaPosterior ? '<span class="ico-new" title="Agregada después de la primera carga">＋</span>' : ''}` },
        { key: 'prioridad', label: 'Prioridad', sort: (r) => ({ Alta: 1, Media: 2, Baja: 3 }[r.prioridad] || 4), render: (r) => prioBadge(r.prioridad) },
        { key: 'horas', label: 'Tiempo', alinear: 'num', render: (r) => (r.horas ? horas(r.horas) : '<span class="tenue">—</span>') },
        { key: 'recursos', label: 'Recursos', clase: 'col-texto', render: (r) => esc(r.recursos) || '<span class="tenue">—</span>' },
        { key: 'riesgos', label: 'Riesgos', clase: 'col-texto', render: (r) => esc(r.riesgos) || '<span class="tenue">—</span>' },
        { key: 'estado', label: 'Estado', sort: (r) => estadoDe(r), render: (r) => (r.estado ? `<span class="est e-${norm(estadoDe(r)).replace(/ /g, '-')}">${esc(r.estado)}</span>` : '<span class="tenue">—</span>') },
      ],
    });
  };

  const alCambiar = (campo) => (v) => { F[campo] = v; aplicar(); app.refrescarContadorFiltros(); };
  const op = (vals) => vals.map((v) => ({ valor: v, texto: v }));
  form.querySelector('[data-ms="dia"]').replaceWith(multiSelect({ etiqueta: 'Día', opciones: op(diasPresentes), seleccion: F.dia, todos: 'Todos', onChange: alCambiar('dia') }));
  form.querySelector('[data-ms="prioridad"]').replaceWith(multiSelect({ etiqueta: 'Prioridad', opciones: op(PRIORIDADES), seleccion: F.prioridad, todos: 'Todas', onChange: alCambiar('prioridad') }));
  form.querySelector('[data-ms="estado"]').replaceWith(multiSelect({ etiqueta: 'Estado', opciones: op(ESTADOS), seleccion: F.estado, todos: 'Todos', onChange: alCambiar('estado') }));
  form.querySelector('[name="texto"]').addEventListener('input', (e) => { F.texto = e.target.value; aplicar(); app.refrescarContadorFiltros(); });
  aplicar();
}

// ---------------------------------------------------------------------
// Síntesis automática de la carga (sobre toda la semana, sin los filtros de la hoja)
function sintesis(cont, rows, cob) {
  const al = alertas(rows);
  const carga = [...cargaDiaria(rows).values()];
  const n = (regla) => al.filter((a) => a.regla === regla);
  const personas = (as) => new Set(as.map((a) => a.persona)).size;
  const sobre = n('sobrecarga'), dias = n('dia_saturado'), conc = n('concentracion_dia'), baja = n('subregistro');
  const elevados = carga.reduce((a, p) => a + Object.values(p.dias).filter((d) => d.nivel === 'elevada').length, 0);
  const sinDia = carga.reduce((a, p) => a + Object.entries(p.dias).filter(([d, v]) => esHabil(d) && v.nivel === 'sin').length, 0);
  const items = [
    sobre.length && [`${sobre.length} ${sobre.length === 1 ? 'persona supera' : 'personas superan'} su capacidad semanal`, 'crit'],
    dias.length && [`${dias.length} ${dias.length === 1 ? 'día-persona' : 'días-persona'} con sobrecarga (${personas(dias)} ${personas(dias) === 1 ? 'persona' : 'personas'})`, 'crit'],
    conc.length && [`${conc.length} ${conc.length === 1 ? 'persona concentra' : 'personas concentran'} la semana en un solo día`, 'warn'],
    cob.faltan.length && [`${cob.faltan.length} ${cob.faltan.length === 1 ? 'persona habitual sin' : 'personas habituales sin'} planificación cargada`, 'warn'],
    baja.length && [`${baja.length} ${baja.length === 1 ? 'persona' : 'personas'} con baja utilización (menos del ${CONFIG.ocupBaja}% de su capacidad)`, 'info'],
  ].filter(Boolean);
  const notas = [
    elevados && `${elevados} ${elevados === 1 ? 'día-persona' : 'días-persona'} con carga elevada, dentro de lo manejable`,
    sinDia && `${sinDia} ${sinDia === 1 ? 'día hábil' : 'días hábiles'} sin horas planificadas en personas que sí planificaron`,
  ].filter(Boolean);
  cont.innerHTML = `
    <header class="panel-cab"><h2>${items.length ? `${items.length} ${items.length === 1 ? 'situación requiere' : 'situaciones requieren'} revisión` : 'Carga sin situaciones a revisar'}</h2></header>
    ${items.length ? `<ul class="sint-lista">${items.map(([t, c]) => `<li class="si-${c}">${esc(t)}</li>`).join('')}</ul>`
      : '<p class="vacio">Nadie supera su capacidad ni tiene días con sobrecarga.</p>'}
    ${notas.length ? `<p class="nota">${notas.map(esc).join('. ')}.</p>` : ''}
    ${items.length ? '<p class="sint-pie"><a href="#/riesgos?tab=situaciones">Causa, impacto y acción sugerida de cada caso</a></p>' : ''}`;
}

// ---------------------------------------------------------------------
function pintarMatriz(cont, carga, rows, { faltan, hayFiltroHoja }, alElegir) {
  const dias = DIAS.filter((d, i) => i < CONFIG.diasHabiles || rows.some((r) => diaDe(r) === d));
  if (!carga.size && !faltan.length) { cont.innerHTML = '<p class="vacio">Sin actividades.</p>'; return; }
  // orden por área y nombre: el mapa muestra situaciones de carga, no un ranking de personas
  const filas = [...carga.values()].sort((a, b) => a.area.localeCompare(b.area, 'es') || a.persona.localeCompare(b.persona, 'es'));
  const celda = (p, d) => {
    const v = p.dias[d] || { horas: 0, nivel: esHabil(d) ? 'sin' : 'libre' };
    const tit = `${p.persona}, ${d}: ${num(v.horas)} h de ${num(p.capDia)} h de capacidad (${NIVELES_DIA[v.nivel] || 'sin actividad'})`;
    return `<td class="hm n-${v.nivel}"><button type="button" data-p="${esc(p.persona)}" data-d="${d}" title="${esc(tit)}" aria-label="${esc(tit)}">${v.horas ? num(v.horas) : ''}</button></td>`;
  };
  cont.innerHTML = `<div class="tabla-scroll"><table class="matriz mapa-carga">
    <thead><tr><th>Persona</th>${dias.map((d) => `<th>${d.slice(0, 3)}</th>`).join('')}<th class="num">Semana</th><th>Ocupación</th></tr></thead>
    <tbody>${filas.map((p) => `<tr>
      <th scope="row"><button type="button" class="mc-persona" data-p="${esc(p.persona)}" title="Ver la semana de ${esc(p.persona)}">${esc(p.persona)}</button><span class="mc-area">${esc(p.area)}</span></th>
      ${dias.map((d) => celda(p, d)).join('')}
      <td class="num"><b>${num(p.total)}</b></td>
      <td title="Capacidad semanal estimada: ${num(p.jornada, 0)} h">${barraOcupacion(p.ocupacion)}</td></tr>`).join('')}
      ${faltan.map((f) => `<tr class="mc-falta"><th scope="row"><span class="mc-nom">${esc(f.persona)}</span><span class="mc-area">${esc(f.area)}</span></th>
        <td class="hm n-sin mc-sinplan" colspan="${dias.length + 2}">Sin planificación cargada esta semana${f.ultima ? ` (última: ${etiquetaSemana(f.ultima)})` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="nota">Cada celda compara las horas planificadas del día con la capacidad diaria estimada (jornada semanal ÷ ${CONFIG.diasHabiles}; ${CONFIG.jornada} h salvo otra jornada indicada en Carga). Carga elevada: más del ${CONFIG.diaElevada}%. Sobrecarga: más del ${CONFIG.diaSobrecarga}%. Baja utilización: menos del ${CONFIG.diaBaja}%. ${hayFiltroHoja ? 'Con filtros de día, prioridad, estado o búsqueda, el mapa muestra solo esas actividades.' : 'Seleccioná una celda o una persona para ver qué genera la carga.'}</p>`;
  cont.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => alElegir(b.dataset.p, b.dataset.d || null)));
}

// ---------------------------------------------------------------------
async function pintarDetalle(el, app, carga) {
  const cont = el.querySelector('[data-det]');
  el.querySelectorAll('.mapa-carga .sel').forEach((x) => x.classList.remove('sel'));
  const p = SEL.persona ? carga.get(SEL.persona) : null;
  if (!p) { cont.hidden = true; cont.innerHTML = ''; return; }
  const marca = SEL.dia ? el.querySelector(`.mapa-carga button[data-p="${CSS.escape(p.persona)}"][data-d="${SEL.dia}"]`)?.parentElement
    : el.querySelector(`.mapa-carga .mc-persona[data-p="${CSS.escape(p.persona)}"]`);
  marca?.classList.add('sel');
  cont.hidden = false;
  if (SEL.dia) detalleDia(cont, app, p, SEL.dia);
  else await detallePersona(cont, app, p);
  cont.querySelector('[data-cerrar]')?.addEventListener('click', () => { SEL.persona = null; SEL.dia = null; pintarDetalle(el, app, carga); });
  cont.querySelectorAll('[data-ver-dia]').forEach((b) => b.addEventListener('click', () => { SEL.dia = b.dataset.verDia; pintarDetalle(el, app, carga); }));
  cont.querySelector('[data-ver-semana]')?.addEventListener('click', () => { SEL.dia = null; pintarDetalle(el, app, carga); });
  if (matchMedia('(max-width: 1080px)').matches) cont.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

const cabDetalle = (titulo, sub, extra = '') => `<header class="det-cab"><div><h3>${esc(titulo)}</h3><p class="tenue">${sub}</p></div>
  <div class="det-acc">${extra}<button type="button" class="btn-icono" data-cerrar aria-label="Cerrar detalle">✕</button></div></header>`;

function detalleDia(cont, app, p, dia) {
  const v = p.dias[dia] || { horas: 0, rows: [], nivel: 'sin', variacion: null };
  const tareas = [...v.rows].sort((a, b) => (b.horas || 0) - (a.horas || 0));
  const exceso = v.horas - p.capDia;
  const movibles = tareas.filter((r) => r.prioridad === 'Media' || r.prioridad === 'Baja' || !r.prioridad);
  const hMov = movibles.reduce((a, r) => a + (r.horas || 0), 0);
  const libres = DIAS.slice(0, CONFIG.diasHabiles).filter((d) => d !== dia && ['baja', 'sin'].includes(p.dias[d]?.nivel));
  const claseNivel = { sobrecarga: 'critica', elevada: 'advertencia', normal: 'ok', baja: 'info', sin: 'info' }[v.nivel] || 'info';
  cont.innerHTML = `${cabDetalle(`${p.persona} — ${dia}`, esc(p.area), '<button type="button" class="btn texto" data-ver-semana>Ver su semana</button>')}
    <dl class="cifras">
      <div><dt>Horas planificadas</dt><dd>${horas(v.horas)}</dd></div>
      <div><dt>Capacidad estimada</dt><dd>${horas(p.capDia)}</dd></div>
      <div><dt>${exceso > 0 ? 'Sobre la capacidad' : 'Frente a la capacidad'}</dt><dd class="${v.nivel === 'sobrecarga' ? 'd-mal' : ''}">${v.horas ? signo(v.variacion, ' %') : '—'}</dd></div>
      <div><dt>Nivel</dt><dd><span class="badge nd-${claseNivel}">${NIVELES_DIA[v.nivel] || '—'}</span></dd></div>
    </dl>
    ${v.nivel === 'sobrecarga' || v.nivel === 'elevada' ? `<p class="det-lectura">${exceso > 0 ? `El día supera la capacidad en ${horas(exceso)}. ` : ''}${hMov > 0
      ? `Las tareas de prioridad Media, Baja o sin prioridad suman ${horas(hMov)}${libres.length ? ` y podrían pasar a ${libres.map((d) => d.toLowerCase()).join(' o ')}, con menos carga` : ''}.`
      : 'Todas las tareas del día son de prioridad Alta: conviene revisar alcance o plazos.'}</p>` : ''}
    ${v.nivel === 'sin' ? '<p class="det-lectura">No hay horas planificadas para este día hábil. Puede ser una ausencia o una planificación incompleta.</p>' : ''}
    <h4>${v.nivel === 'sobrecarga' ? 'Tareas que generan la sobrecarga' : 'Tareas del día'}</h4>
    <div data-tareas-dia></div>`;
  tabla(cont.querySelector('[data-tareas-dia]'), {
    rows: tareas, orden: { key: 'horas', dir: -1 }, vacio: 'Sin actividades este día.', onRow: (r) => abrirDetalle(r, app),
    cols: [
      { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (r) => esc(r.tarea) || '<span class="tenue">Sin descripción</span>' },
      { key: 'prioridad', label: 'Prioridad', sort: (r) => ({ Alta: 1, Media: 2, Baja: 3 }[r.prioridad] || 4), render: (r) => prioBadge(r.prioridad) },
      { key: 'horas', label: 'Tiempo', alinear: 'num', render: (r) => (r.horas ? horas(r.horas) : '<span class="tenue">Sin tiempo</span>') },
      { key: 'pctDia', label: '% del día', alinear: 'num', sort: (r) => r.horas || 0, render: (r) => (r.horas && v.horas ? porc((r.horas / v.horas) * 100) : '—') },
      { key: 'estado', label: 'Estado', render: (r) => esc(r.estado) || '<span class="tenue">—</span>' },
    ],
  });
}

async function detallePersona(cont, app, p) {
  const st = statsPersonas(p.rows)[0];
  const sus = alertas(app.filas).filter((a) => a.persona === p.persona);
  const cambios = app.cambiosSemana.filter((c) => c.persona === p.persona && !(c.tipo === 'modificacion' && c.origen === 'app'));
  const diasH = DIAS.filter((d, i) => i < CONFIG.diasHabiles || p.dias[d]?.horas);
  const max = Math.max(p.capDia * 1.5, ...diasH.map((x) => p.dias[x]?.horas || 0));
  cont.innerHTML = `${cabDetalle(p.persona, `${esc(p.area)}. Semana del ${rangoSemana(app.semana.inicio, app.semana.fin)}`,
      '<a class="btn texto" href="#/carga" title="La jornada y las horas reales se cargan en Carga">Jornada y horas reales</a>')}
    <dl class="cifras">
      <div><dt>Horas planificadas</dt><dd>${horas(p.total)}</dd></div>
      <div><dt>Capacidad semanal</dt><dd>${horas(p.jornada)}</dd></div>
      <div><dt>Ocupación</dt><dd class="${p.ocupacion > CONFIG.ocupAlta ? 'd-mal' : ''}">${porc(p.ocupacion)}</dd></div>
      <div><dt>Plan vs real</dt><dd>${st.desvioPct === null ? '<span class="tenue cifra-nd">Sin horas reales</span>' : signo(st.desvioPct, ' %')}</dd></div>
    </dl>
    <h4>Carga por día</h4>
    <ul class="barras-dias">${diasH.map((d) => { const v = p.dias[d] || { horas: 0, nivel: 'sin' };
      return `<li><button type="button" class="bd-dia" data-ver-dia="${d}" title="Ver las tareas del ${d.toLowerCase()}">${d.slice(0, 3)}</button><span class="bd bd-cap"><span class="n-${v.nivel}" style="width:${(v.horas / max) * 100}%"></span><i style="left:${(p.capDia / max) * 100}%"></i></span><b>${num(v.horas)}</b></li>`; }).join('')}</ul>
    <p class="nota">La línea vertical marca la capacidad diaria estimada (${horas(p.capDia)}). Tocá un día para ver sus tareas.</p>
    ${sus.length ? `<h4>Situaciones de la semana</h4><ul class="lista-situ">${sus.map((a) => `<li>${nivelBadge(a.nivel)} <b>${esc(a.nombre)}</b> <span>${esc(a.que)}</span>
      <span class="ls-det"><b>Causa:</b> ${esc(a.causa)} <b>Acción sugerida:</b> ${esc(a.accion)}</span></li>`).join('')}</ul>` : ''}
    <h4>¿Cómo evolucionó su carga?</h4>
    <div class="graf graf-chico"><canvas data-evo aria-label="Horas planificadas por semana"></canvas></div>
    ${cambios.length ? `<h4>Cambios después de la primera carga</h4><ul class="lista-simple">${cambios.slice(0, 12).map((c) => `<li><span class="tenue">${fechaHora(c.fechaHora)}</span> ${c.tipo === 'alta' ? 'Agregó' : c.tipo === 'retiro' ? 'Quitó' : c.tipo === 'reactivacion' ? 'Volvió a incluir' : `Cambió ${esc(c.campo?.replace('_planificadas', '').replace('_', ' '))} (${esc(c.antes ?? '—')} → ${esc(c.despues ?? '—')}) en`} "${esc(c.tarea)}"</li>`).join('')}</ul>` : ''}`;

  // evolución: últimas 8 semanas hasta la seleccionada
  const sem8 = app.semanasDePeriodo({ tipo: 'n', n: 8 });
  const { rows: r8 } = await app.filasDe(sem8);
  const canvas = cont.querySelector('[data-evo]');
  if (!canvas) return; // el detalle cambió mientras se cargaban los datos
  const porSem = groupBy(r8.filter((r) => r.persona === p.persona), (r) => r.semana);
  const labels = sem8.map((s) => etiquetaSemana(s.inicio));
  grafico(canvas, {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Horas planificadas', data: sem8.map((s) => (porSem.get(s.inicio) || []).reduce((a, r) => a + (r.horas || 0), 0)), backgroundColor: sem8.map((s) => (s.id === app.semana.id ? PALETA.bluffs : PALETA.beige)), borderRadius: 3 },
      { type: 'line', label: `Capacidad (${num(p.jornada, 0)} h)`, data: labels.map(() => p.jornada), borderColor: PALETA.pewter, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'horas' } }, x: { grid: { display: false } } } },
  });
}
