// =====================================================================
// 📊 Resumen — vista ejecutiva de la semana seleccionada.
// Es el lugar PRINCIPAL de los indicadores de semana.
// =====================================================================
import { kpisSemana, statsPersonas, auditoria, recomendaciones, groupBy } from '../engine.js';
import { esc, num, horas, porc, signo, rangoSemana, nivelBadge } from '../ui.js';

export const titulo = 'Resumen';

function delta(actual, previo, { suf = '', invertir = false } = {}) {
  if (previo === null || previo === undefined || actual === null || actual === undefined) return '';
  const d = actual - previo;
  if (Math.abs(d) < 0.05) return '<span class="delta">igual que la semana anterior</span>';
  const bueno = invertir ? d < 0 : d > 0;
  return `<span class="delta ${bueno ? 'd-bien' : 'd-mal'}">${signo(d, suf)} vs semana anterior</span>`;
}

export async function render(el, app) {
  const k = kpisSemana(app.filas);
  const hayPrevia = app.filasPrevia.length > 0;
  const kp = hayPrevia ? kpisSemana(app.filasPrevia) : {};

  // Promedio histórico (8 semanas anteriores) para detectar cargas fuera de lo habitual
  const periodo = app.semanasDePeriodo({ tipo: 'n', n: 9 });
  const { rows: rango } = await app.filasDe(periodo);
  const historico = rango.filter((r) => r.semana !== app.semana.inicio);
  const nHist = new Set(historico.map((r) => r.semana)).size;
  const promPersona = new Map(statsPersonas(historico, { semanas: nHist }).map((p) => [p.persona, p]));
  const stats = statsPersonas(app.filas);
  const desvios = stats.map((p) => {
    const h = promPersona.get(p.persona);
    return h && h.semanas >= 2 && h.horas > 0 && p.horas > 0 ? { ...p, prom: h.horas, var: ((p.horas - h.horas) / h.horas) * 100 } : null;
  }).filter((x) => x && Math.abs(x.var) >= 25).sort((a, b) => Math.abs(b.var) - Math.abs(a.var)).slice(0, 5);

  const alertasTop = k.alertas.filter((a) => a.nivel !== 'info');
  const porRegla = groupBy(alertasTop, (a) => a.nombre);
  const aud = auditoria(app.filas, app.semana.inicio).filter((r) => r.grave && r.items.length).sort((a, b) => b.items.length - a.items.length);
  const recs = recomendaciones({ rows: app.filas, rangeRows: rango }).slice(0, 4);
  const sobre = stats.filter((p) => p.ocupacion > 110).length;

  const situacion = [
    `${k.personas} personas planificaron ${num(k.actividades, 0)} actividades por ${horas(k.horas)}.`,
    sobre ? `${sobre} ${sobre === 1 ? 'persona supera' : 'personas superan'} la jornada de referencia.` : 'Nadie supera la jornada de referencia.',
    k.cumplimiento === null ? 'Todavía no hay estados cargados para medir el cumplimiento.' : `El cumplimiento es del ${porc(k.cumplimiento)} sobre el ${porc(k.cobertura)} de actividades con estado.`,
  ].join(' ');

  el.innerHTML = `
  <header class="mod-cab">
    <h1>Resumen de la semana</h1>
    <p class="sub">${rangoSemana(app.semana.inicio, app.semana.fin)}</p>
  </header>

  <section class="kpis" aria-label="Indicadores de la semana">
    <div class="kpi"><span class="kpi-l">Actividades</span><span class="kpi-v">${num(k.actividades, 0)}</span>${delta(k.actividades, kp.actividades)}</div>
    <div class="kpi"><span class="kpi-l">Personas</span><span class="kpi-v">${k.personas}</span>${delta(k.personas, kp.personas)}</div>
    <div class="kpi"><span class="kpi-l">Horas planificadas</span><span class="kpi-v">${num(k.horas)}<small> h</small></span>${delta(k.horas, kp.horas, { suf: ' h' })}</div>
    <div class="kpi"><span class="kpi-l">Cumplimiento</span><span class="kpi-v">${k.cumplimiento === null ? '<span class="kpi-nd">Sin datos</span>' : porc(k.cumplimiento)}</span>${k.cumplimiento === null ? '<span class="delta">no hay estados informados</span>' : delta(k.cumplimiento, kp.cumplimiento, { suf: ' pts' })}</div>
    <div class="kpi"><span class="kpi-l">Cobertura de seguimiento</span><span class="kpi-v">${porc(k.cobertura)}</span><span class="delta">actividades con estado</span></div>
    <a class="kpi kpi-link ${k.alertasCriticas ? 'kpi-crit' : ''}" href="#/riesgos?tab=alertas"><span class="kpi-l">Alertas críticas</span><span class="kpi-v">${k.alertasCriticas}</span><span class="delta">${k.alertas.length} alertas en total</span></a>
  </section>

  <p class="situacion">${esc(situacion)}</p>

  <div class="grid-2">
    <section class="panel">
      <header class="panel-cab"><h2>Puntos a revisar</h2><a href="#/riesgos?tab=alertas">Todas las alertas</a></header>
      ${alertasTop.length ? `<ul class="lista-alertas">${[...porRegla].slice(0, 6).map(([regla, as]) => `
        <li>${nivelBadge(as[0].nivel)} <b>${esc(regla)}</b>
          <span>${as.slice(0, 3).map((a) => `<a href="#/personas?persona=${encodeURIComponent(a.persona)}">${esc(a.persona)}</a> <span class="tenue">${esc(a.detalle)}</span>`).join('; ')}${as.length > 3 ? `; y ${as.length - 3} más` : ''}</span></li>`).join('')}</ul>`
        : '<p class="vacio">Sin alertas críticas ni advertencias esta semana.</p>'}
      ${aud.length ? `<h3 class="subtit">Datos incompletos</h3><ul class="lista-simple">${aud.slice(0, 3).map((r) =>
        `<li><a href="#/riesgos?tab=auditoria&regla=${r.id}">${esc(r.nombre)}</a>: ${r.items.length} actividades (${porc(r.pct)}), ${r.personas.length} ${r.personas.length === 1 ? 'persona' : 'personas'}</li>`).join('')}</ul>` : ''}
    </section>

    <section class="panel">
      <header class="panel-cab"><h2>Carga fuera de lo habitual</h2><a href="#/evolucion">Ver evolución</a></header>
      ${nHist < 2 ? '<p class="vacio">Se necesitan al menos 2 semanas anteriores para comparar.</p>'
        : desvios.length ? `<table class="tabla compacta"><thead><tr><th>Persona</th><th class="num">Esta semana</th><th class="num">Promedio</th><th class="num">Variación</th></tr></thead><tbody>
          ${desvios.map((d) => `<tr><td><a href="#/personas?persona=${encodeURIComponent(d.persona)}">${esc(d.persona)}</a></td><td class="num">${horas(d.horas)}</td><td class="num">${horas(d.prom)}</td><td class="num ${d.var > 0 ? 'd-mal' : 'd-info'}">${signo(d.var, '%')}</td></tr>`).join('')}
          </tbody></table><p class="nota">Personas cuya carga difiere en más de 25% de su promedio de las últimas ${nHist} semanas. Quien no cargó tiempos aparece en Auditoría.</p>`
        : `<p class="vacio">La carga de cada persona está dentro de ±25% de su promedio de las últimas ${nHist} semanas.</p>`}
    </section>
  </div>

  ${recs.length ? `<section class="panel">
    <header class="panel-cab"><h2>Recomendaciones</h2></header>
    <ul class="recs">${recs.map((r) => `<li><span class="rec-motivo">${esc(r.motivo)}</span><p>${esc(r.texto)}</p><a href="#/${r.modulo}">Revisar</a></li>`).join('')}</ul>
  </section>` : ''}`;
}
