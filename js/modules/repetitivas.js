// =====================================================================
// 🔁 Tareas repetitivas — qué tareas planifica cada persona más de una vez
// en una misma semana (hoja "Tareas Repetitivas" del dashboard anterior).
// Todos los cálculos salen del motor (engine.js).
// =====================================================================
import { tareasRepetitivas } from '../engine.js';
import { esc, num, horas, tabla } from '../ui.js';
import { prepararPeriodo } from './periodo.js';

export const titulo = 'Tareas repetitivas';

export async function render(el, app) {
  const { rows, n, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: () => render(el, app) });
  if (rows.length) repetitivas(cont, { rows, n });
}

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

