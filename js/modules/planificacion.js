// =====================================================================
// 📋 Planificación — módulo operativo: qué está planificado esta semana.
// Integra carga (persona × día), prioridades, estado y tareas repetitivas.
// =====================================================================
import { DIAS, PRIORIDADES, ESTADOS, diaDe, prioridadDe, estadoDe, repetitivasSemana, claveTarea, norm, CONFIG } from '../engine.js';
import { esc, num, horas, tabla, barraApilada, prioBadge, opciones, COLOR_PRIORIDAD, COLOR_ESTADO, fechaCorta, rangoSemana, barraOcupacion } from '../ui.js';
import { abrirDetalle } from '../detalle.js';

export const titulo = 'Planificación';
const F = { persona: '', area: '', dia: '', prioridad: '', estado: '', texto: '' };

export async function render(el, app) {
  if (app.params.persona) F.persona = app.params.persona;
  const todas = app.filas;
  const personas = [...new Set(todas.map((r) => r.persona))].sort((a, b) => a.localeCompare(b, 'es'));
  const areas = [...new Set(todas.map((r) => r.area))].sort();
  const diasPresentes = DIAS.filter((d) => todas.some((r) => diaDe(r) === d));

  const repetidas = new Set(repetitivasSemana(todas).map((x) => `${x.persona}|${x.clave}`));
  const modificadas = new Set(app.cambiosSemana.filter((c) => c.tipo === 'modificacion' && c.origen === 'excel').map((c) => c.actividadId));

  el.innerHTML = `
  <header class="mod-cab">
    <h1>Planificación</h1>
    <p class="sub">${rangoSemana(app.semana.inicio, app.semana.fin)}</p>
  </header>
  <form class="filtros" aria-label="Filtros">
    <label>Persona<select name="persona">${opciones(personas, F.persona, 'Todas')}</select></label>
    <label>Área<select name="area">${opciones(areas, F.area, 'Todas')}</select></label>
    <label>Día<select name="dia">${opciones(diasPresentes, F.dia, 'Todos')}</select></label>
    <label>Prioridad<select name="prioridad">${opciones(PRIORIDADES, F.prioridad, 'Todas')}</select></label>
    <label>Estado<select name="estado">${opciones(ESTADOS, F.estado, 'Todos')}</select></label>
    <label class="crece">Buscar<input name="texto" type="search" value="${esc(F.texto)}" placeholder="Tarea, recurso o riesgo"></label>
    <button type="button" class="btn texto" data-limpiar>Limpiar</button>
  </form>
  <div class="grid-plan">
    <section class="panel"><header class="panel-cab"><h2>Carga por persona y día</h2><span class="tenue" data-cuenta></span></header><div data-matriz></div></section>
    <section class="panel"><header class="panel-cab"><h2>Horas por prioridad</h2></header><div data-prio></div>
      <header class="panel-cab sep"><h2>Actividades por estado</h2></header><div data-estado></div></section>
  </div>
  <section class="panel">
    <header class="panel-cab"><h2>Actividades</h2><span class="leyenda-iconos"><span class="ico-rep">↻</span> se repite en la semana <span class="ico-mod">✎</span> modificada después de la primera carga <span class="ico-new">＋</span> agregada después</span></header>
    <div data-tabla></div>
  </section>`;

  const form = el.querySelector('.filtros');
  const aplicar = () => {
    const t = norm(F.texto);
    const rows = todas.filter((r) =>
      (!F.persona || r.persona === F.persona) && (!F.area || r.area === F.area) && (!F.dia || diaDe(r) === F.dia) &&
      (!F.prioridad || prioridadDe(r) === F.prioridad) && (!F.estado || estadoDe(r) === F.estado) &&
      (!t || norm(`${r.tarea} ${r.recursos} ${r.riesgos}`).includes(t)));
    el.querySelector('[data-cuenta]').textContent = `${num(rows.length, 0)} de ${num(todas.length, 0)} actividades`;
    pintarMatriz(el.querySelector('[data-matriz]'), rows, app);
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
            ${repetidas.has(`${r.persona}|${claveTarea(r.tarea)}`) ? '<span class="ico-rep" title="Se repite en varios días de la semana">↻</span>' : ''}
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

  form.addEventListener('input', (e) => { if (e.target.name) { F[e.target.name] = e.target.value; aplicar(); } });
  form.querySelector('[data-limpiar]').addEventListener('click', () => {
    Object.keys(F).forEach((k) => { F[k] = ''; }); form.reset();
    form.querySelectorAll('select').forEach((s) => { s.value = ''; });
    if (app.params.persona) app.ir('planificacion'); else aplicar();
  });
  aplicar();
}

function pintarMatriz(cont, rows, app) {
  const dias = DIAS.filter((d, i) => i < 5 || rows.some((r) => diaDe(r) === d));
  const m = new Map();
  rows.forEach((r) => {
    if (!m.has(r.persona)) m.set(r.persona, { area: r.area, total: 0, dias: {} });
    const p = m.get(r.persona); const d = diaDe(r);
    p.total += r.horas || 0; p.dias[d] = (p.dias[d] || 0) + (r.horas || 0);
  });
  if (!m.size) { cont.innerHTML = '<p class="vacio">Sin actividades.</p>'; return; }
  const nivel = (hh) => (hh === 0 ? 0 : hh <= 2 ? 1 : hh <= 5 ? 2 : hh <= 8 ? 3 : hh <= CONFIG.horasDiaMax ? 4 : 5);
  const filas = [...m].sort((a, b) => b[1].total - a[1].total);
  cont.innerHTML = `<div class="tabla-scroll"><table class="matriz">
    <thead><tr><th>Persona</th>${dias.map((d) => `<th>${d.slice(0, 3)}</th>`).join('')}<th class="num">Semana</th><th>Ocupación</th></tr></thead>
    <tbody>${filas.map(([p, v]) => `<tr>
      <th scope="row"><a href="#/personas?persona=${encodeURIComponent(p)}">${esc(p)}</a></th>
      ${dias.map((d) => { const hh = v.dias[d] || 0; return `<td class="hm h${nivel(hh)}" title="${esc(p)}, ${d}: ${num(hh)} h">${hh ? num(hh) : ''}</td>`; }).join('')}
      <td class="num"><b>${num(v.total)}</b></td>
      <td>${barraOcupacion((v.total / CONFIG.jornada) * 100)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="nota">Horas planificadas por día. Ocupación sobre una jornada de ${CONFIG.jornada} h semanales; la marca indica el 100%.</p>`;
}
