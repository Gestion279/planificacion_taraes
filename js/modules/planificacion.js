// =====================================================================
// 📋 Planificación — módulo operativo: qué está planificado esta semana.
// Integra carga (persona × día), prioridades, estado y tareas repetitivas.
// =====================================================================
import { DIAS, PRIORIDADES, ESTADOS, diaDe, prioridadDe, estadoDe, repetitivasSemana, claveTarea, norm, CONFIG } from '../engine.js';
import { esc, num, horas, tabla, barraApilada, prioBadge, multiSelect, COLOR_PRIORIDAD, COLOR_ESTADO, fechaCorta, rangoSemana, barraOcupacion } from '../ui.js';
import { abrirDetalle } from '../detalle.js';

export const titulo = 'Planificación';
// Filtros propios de la hoja (Área y Persona son globales, en la barra superior)
let F = { dia: [], prioridad: [], estado: [], texto: '' };
const limpiarPropios = () => { F.dia = []; F.prioridad = []; F.estado = []; F.texto = ''; };
const cuentaPropios = () => F.dia.length + F.prioridad.length + F.estado.length + (F.texto ? 1 : 0);

export async function render(el, app) {
  F = app.filtrosHoja('planificacion', { dia: [], prioridad: [], estado: [], texto: '' });
  app.registrarLimpieza('planificacion', limpiarPropios, cuentaPropios);
  // "Ver en Planificación" desde otra hoja: se aplica como filtro global de persona
  if (app.params.persona) { const p = app.params.persona; history.replaceState(null, '', '#/planificacion'); await app.fijarFiltros({ personas: [p] }, { redibujar: false }); }
  const todas = app.filas;
  const diasPresentes = DIAS.filter((d) => todas.some((r) => diaDe(r) === d));

  const repetidas = new Set(repetitivasSemana(todas).map((x) => `${x.persona}|${x.clave}`));
  const modificadas = new Set(app.cambiosSemana.filter((c) => c.tipo === 'modificacion' && c.origen === 'excel').map((c) => c.actividadId));

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
      (!F.dia.length || F.dia.includes(diaDe(r))) && (!F.prioridad.length || F.prioridad.includes(prioridadDe(r))) &&
      (!F.estado.length || F.estado.includes(estadoDe(r))) && (!t || norm(`${r.tarea} ${r.recursos} ${r.riesgos}`).includes(t)));
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

  const alCambiar = (campo) => (v) => { F[campo] = v; aplicar(); app.refrescarContadorFiltros(); };
  const op = (vals) => vals.map((v) => ({ valor: v, texto: v }));
  form.querySelector('[data-ms="dia"]').replaceWith(multiSelect({ etiqueta: 'Día', opciones: op(diasPresentes), seleccion: F.dia, todos: 'Todos', onChange: alCambiar('dia') }));
  form.querySelector('[data-ms="prioridad"]').replaceWith(multiSelect({ etiqueta: 'Prioridad', opciones: op(PRIORIDADES), seleccion: F.prioridad, todos: 'Todas', onChange: alCambiar('prioridad') }));
  form.querySelector('[data-ms="estado"]').replaceWith(multiSelect({ etiqueta: 'Estado', opciones: op(ESTADOS), seleccion: F.estado, todos: 'Todos', onChange: alCambiar('estado') }));
  form.querySelector('[name="texto"]').addEventListener('input', (e) => { F.texto = e.target.value; aplicar(); app.refrescarContadorFiltros(); });
  aplicar();
}

function pintarMatriz(cont, rows, app) {
  const dias = DIAS.filter((d, i) => i < 5 || rows.some((r) => diaDe(r) === d));
  const m = new Map();
  rows.forEach((r) => {
    if (!m.has(r.persona)) m.set(r.persona, { area: r.area, total: 0, dias: {}, jornada: Number(r.jornada) || CONFIG.jornada });
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
      <td title="Jornada de ${num(v.jornada, 0)} h">${barraOcupacion((v.total / v.jornada) * 100)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="nota">Horas planificadas por día. Ocupación sobre la jornada semanal de cada persona (${CONFIG.jornada} h salvo que se indique otra en Personas); la marca indica el 100%.</p>`;
}
