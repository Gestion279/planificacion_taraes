// =====================================================================
// 👥 Personas — análisis individual (semana o período).
// Consolida: Evaluación/Resumen, Carga de trabajo, Prioridades,
// Plan vs Real, Repetitivas e Histórico/Personas.
// =====================================================================
import { statsPersonas, alertas, repetitivasSemana, recurrentesPeriodo, recomendaciones, PRIORIDADES, DIAS, diaDe, estadoDe, CONFIG, groupBy } from '../engine.js';
import { esc, num, horas, porc, signo, tabla, barraApilada, barraOcupacion, prioBadge, nivelBadge, grafico, opciones,
  COLOR_PRIORIDAD, PALETA, etiquetaSemana, fechaCorta, rangoSemana, fechaHora } from '../ui.js';
import { abrirDetalle, inputReal, conectarReales } from '../detalle.js';

export const titulo = 'Personas';
const ALCANCES = [['semana', 'Semana seleccionada'], ['4', 'Últimas 4 semanas'], ['8', 'Últimas 8 semanas'], ['13', 'Últimos 3 meses']];
let alcance = 'semana';

export async function render(el, app) {
  const semanasAlc = alcance === 'semana' ? [app.semana] : app.semanasDePeriodo(alcance === '13' ? { tipo: 'meses', n: 3 } : { tipo: 'n', n: +alcance });
  const { rows } = alcance === 'semana' ? { rows: app.filas } : await app.filasDe(semanasAlc);
  const n = semanasAlc.length;
  const stats = statsPersonas(rows, { semanas: n });
  // alertas: por semana (las reglas son semanales), sumadas si el alcance es un período
  const alertasPorPersona = new Map();
  for (const [semana, rs] of groupBy(rows, (r) => r.semana)) alertas(rs).forEach((a) => alertasPorPersona.set(a.persona, [...(alertasPorPersona.get(a.persona) || []), { ...a, semana }]));

  const sel = app.params.persona && stats.find((p) => p.persona === app.params.persona) ? app.params.persona : null;
  const periodoTxt = alcance === 'semana' ? rangoSemana(app.semana.inicio, app.semana.fin) : `${n} semanas hasta el ${etiquetaSemana(app.semana.inicio)} (promedios semanales)`;

  el.innerHTML = `
  <header class="mod-cab">
    <h1>Personas</h1>
    <p class="sub">${esc(periodoTxt)}</p>
    <label class="alcance">Mostrar<select data-alcance>${opciones(ALCANCES, alcance)}</select></label>
  </header>
  <div class="personas-layout ${sel ? 'con-detalle' : ''}">
    <section class="panel"><div data-tabla></div></section>
    ${sel ? '<section class="panel detalle-persona" data-detalle></section>' : ''}
  </div>`;

  el.querySelector('[data-alcance]').addEventListener('change', (e) => { alcance = e.target.value; render(el, app); });

  const columnas = [
    { key: 'persona', label: 'Persona', render: (p) => `<span class="nom ${p.persona === sel ? 'sel' : ''}">${esc(p.persona)}</span><span class="tenue bloque">${esc(p.area)}</span>` },
    { key: 'actividades', label: n > 1 ? 'Actividades / sem.' : 'Actividades', alinear: 'num', render: (p) => num(p.actividades, n > 1 ? 1 : 0) },
    { key: 'horas', label: n > 1 ? 'Horas / sem.' : 'Horas', alinear: 'num', render: (p) => horas(p.horas) },
    { key: 'ocupacion', label: 'Ocupación', render: (p) => barraOcupacion(p.ocupacion) },
    { key: 'cumplimiento', label: 'Cumplimiento', alinear: 'num', render: (p) => (p.cumplimiento === null ? '<span class="tenue">Sin estados</span>' : `${porc(p.cumplimiento)}<span class="tenue bloque">${porc(p.cobertura)} con estado</span>`) },
    { key: 'desvioPct', label: 'Desvío', alinear: 'num', render: (p) => (p.desvioPct === null ? '<span class="tenue">—</span>' : `<span class="${Math.abs(p.desvioPct) > 15 ? 'd-mal' : ''}">${signo(p.desvioPct, '%')}</span><span class="tenue bloque">${porc(p.coberturaReal)} con real</span>`) },
    { key: 'alertas', label: 'Alertas', alinear: 'num', sort: (p) => (alertasPorPersona.get(p.persona) || []).length,
      render: (p) => { const as = alertasPorPersona.get(p.persona) || []; const c = as.filter((a) => a.nivel === 'critica').length;
        return as.length ? `${as.length}${c ? ` <span class="badge n-critica">${c} crít.</span>` : ''}` : '<span class="tenue">0</span>'; } },
  ];
  // con el detalle abierto, la tabla del equipo queda como índice: menos columnas
  const visibles = sel ? columnas.filter((c) => ['persona', 'horas', 'ocupacion', 'alertas'].includes(c.key)) : columnas;
  tabla(el.querySelector('[data-tabla]'), {
    rows: stats, orden: { key: 'horas', dir: -1 },
    onRow: (p) => app.ir('personas', p.persona === sel ? {} : { persona: p.persona }),
    cols: visibles,
  });
  if (!sel) el.querySelector('[data-tabla]').insertAdjacentHTML('beforeend', '<p class="nota">Desvío: horas reales frente a planificadas, sobre las actividades que tienen horas reales cargadas.</p>');

  if (sel) await detalle(el.querySelector('[data-detalle]'), app, sel, { stats: stats.find((p) => p.persona === sel), alertas: alertasPorPersona.get(sel) || [], n, rows });
}

async function detalle(cont, app, persona, { stats: p, alertas: als, n }) {
  // evolución: siempre las últimas 8 semanas hasta la seleccionada
  const sem8 = app.semanasDePeriodo({ tipo: 'n', n: 8 });
  const { rows: r8 } = await app.filasDe(sem8);
  const mias8 = r8.filter((r) => r.persona === persona);
  const porSem = groupBy(mias8, (r) => r.semana);
  const semanaRows = app.filas.filter((r) => r.persona === persona);
  const cambios = app.cambiosSemana.filter((c) => c.persona === persona && !(c.tipo === 'modificacion' && c.origen === 'app'));
  const rep = repetitivasSemana(semanaRows);
  const rec = recurrentesPeriodo(mias8).slice(0, 6);
  const recs = recomendaciones({ rows: app.filas, rangeRows: r8, persona });

  cont.innerHTML = `
    <header class="det-cab">
      <div><h2>${esc(persona)}</h2><p class="tenue">${esc(p.area)}${n > 1 ? `, promedio de ${n} semanas` : ''}</p></div>
      <div class="det-acc"><a class="btn" href="#/planificacion?persona=${encodeURIComponent(persona)}">Ver en Planificación</a><button class="btn-icono" data-cerrar aria-label="Cerrar detalle">✕</button></div>
    </header>
    <dl class="cifras">
      <div><dt>Horas${n > 1 ? ' / sem.' : ''}</dt><dd>${horas(p.horas)}</dd></div>
      <div><dt>Ocupación</dt><dd>${porc(p.ocupacion)}</dd></div>
      <div><dt>Cumplimiento</dt><dd>${p.cumplimiento === null ? '—' : porc(p.cumplimiento)}</dd></div>
      <div><dt>Desvío plan vs real</dt><dd>${p.desvioPct === null ? '—' : signo(p.desvioPct, '%')}</dd></div>
    </dl>

    <h3>¿Cómo evolucionó su carga?</h3>
    <div class="graf graf-chico"><canvas data-evo aria-label="Horas planificadas por semana"></canvas></div>

    ${als.length ? `<h3>Alertas</h3><ul class="lista-alertas">${als.map((a) => `<li>${nivelBadge(a.nivel)} <b>${esc(a.nombre)}</b> <span>${n > 1 ? `semana del ${etiquetaSemana(a.semana)}: ` : ''}${esc(a.detalle)}</span></li>`).join('')}</ul>` : ''}

    <div class="grid-2 compacto">
      <div><h3>Prioridades</h3>${barraApilada(PRIORIDADES.map((k) => ({ label: k, valor: p.prioH[k], color: COLOR_PRIORIDAD[k] })), { formato: horas })}</div>
      <div><h3>Horas por día${n > 1 ? ' (total del período)' : ''}</h3>${barrasDias(p.horasDia)}</div>
    </div>

    <h3>Planificación de la semana y horas reales</h3>
    <p class="nota">Cargá las horas reales para medir el desvío. Se guardan al salir de cada casillero y el Excel no las modifica.</p>
    <div data-plan></div>

    ${cambios.length ? `<h3>Cambios después de la primera carga</h3><ul class="lista-simple">${cambios.slice(0, 15).map((c) => `<li><span class="tenue">${fechaHora(c.fechaHora)}</span> ${c.tipo === 'alta' ? 'Agregó' : c.tipo === 'retiro' ? 'Quitó' : c.tipo === 'reactivacion' ? 'Volvió a incluir' : `Cambió ${esc(c.campo?.replace('_planificadas', '').replace('_', ' '))} (${esc(c.antes ?? '—')} → ${esc(c.despues ?? '—')}) en`} "${esc(c.tarea)}"</li>`).join('')}</ul>` : ''}

    ${rep.length || rec.length ? `<div class="grid-2 compacto">
      <div><h3>Se repiten esta semana</h3>${rep.length ? `<ul class="lista-simple">${rep.slice(0, 6).map((t) => `<li>${esc(t.tarea)} <span class="tenue">${t.dias} días, ${horas(t.horas)}</span></li>`).join('')}</ul>` : '<p class="tenue">Ninguna.</p>'}</div>
      <div><h3>Recurrentes en 8 semanas</h3>${rec.length ? `<ul class="lista-simple">${rec.map((t) => `<li>${esc(t.tarea)} <span class="tenue">${t.semanas} semanas, ${horas(t.horasSemana)}/sem.</span></li>`).join('')}</ul>` : '<p class="tenue">Ninguna.</p>'}</div>
    </div>` : ''}

    ${recs.length ? `<h3>Recomendaciones</h3><ul class="recs">${recs.map((r) => `<li><span class="rec-motivo">${esc(r.motivo)}</span><p>${esc(r.texto)}</p></li>`).join('')}</ul>` : ''}`;

  cont.querySelector('[data-cerrar]').addEventListener('click', () => app.ir('personas'));

  const labels = sem8.map((s) => etiquetaSemana(s.inicio));
  const datos = sem8.map((s) => (porSem.get(s.inicio) || []).reduce((a, r) => a + (r.horas || 0), 0));
  grafico(cont.querySelector('[data-evo]'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Horas planificadas', data: datos, backgroundColor: sem8.map((s) => (s.id === app.semana.id ? PALETA.bluffs : PALETA.beige)), borderRadius: 3 },
      { type: 'line', label: `Jornada (${CONFIG.jornada} h)`, data: labels.map(() => CONFIG.jornada), borderColor: PALETA.pewter, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'horas' } }, x: { grid: { display: false } } } },
  });

  const planCont = cont.querySelector('[data-plan]');
  tabla(planCont, {
    rows: semanaRows, orden: { key: 'fecha', dir: 1 }, onRow: (r) => abrirDetalle(r, app),
    vacio: 'Sin actividades en la semana seleccionada.',
    cols: [
      { key: 'fecha', label: 'Fecha', clase: 'nw', sort: (r) => `${r.fecha || '9'}${String(r.fila).padStart(4, '0')}`, render: (r) => `${diaDe(r).slice(0, 3)} ${fechaCorta(r.fecha)}` },
      { key: 'tarea', label: 'Tarea', clase: 'col-tarea', render: (r) => esc(r.tarea) },
      { key: 'prioridad', label: 'Prioridad', render: (r) => prioBadge(r.prioridad) },
      { key: 'horas', label: 'Plan', alinear: 'num', render: (r) => horas(r.horas) },
      { key: 'real', label: 'Real', alinear: 'num', render: (r) => inputReal(r) },
      { key: 'estado', label: 'Estado', sort: (r) => estadoDe(r), render: (r) => esc(r.estado) || '<span class="tenue">—</span>' },
    ],
  });
  conectarReales(planCont, app);
  // en pantallas angostas el detalle queda debajo de la tabla: llevar la vista hasta él
  if (matchMedia('(max-width: 1280px)').matches) cont.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function barrasDias(horasDia) {
  const dias = DIAS.filter((d, i) => i < 5 || horasDia[d]);
  const max = Math.max(CONFIG.horasDiaMax, ...dias.map((d) => horasDia[d] || 0));
  return `<ul class="barras-dias">${dias.map((d) => { const v = horasDia[d] || 0;
    return `<li><span>${d.slice(0, 3)}</span><span class="bd"><span style="width:${(v / max) * 100}%" class="${v > CONFIG.horasDiaMax ? 'excede' : ''}"></span></span><b>${num(v)}</b></li>`; }).join('')}</ul>`;
}
