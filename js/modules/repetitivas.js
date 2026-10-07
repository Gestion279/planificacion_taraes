// =====================================================================
// 🔁 Tareas repetitivas — Top 5 por persona.
// Detección visual: qué tareas se repiten, cuántas veces y cuánto tiempo acumulan.
// Una tarea repetitiva NO se convierte sola en propuesta: se señala como posible
// oportunidad y quien la evalúa decide si registrar una propuesta de mejora.
// Respeta el período compartido y los filtros globales de área y persona.
// =====================================================================
import { topRepetitivasPorPersona, CONFIG } from '../engine.js';
import { esc, num, horas } from '../ui.js';
import { prepararPeriodo } from './periodo.js';
import { abrirPropuesta, borradorDeTarea } from '../propuesta.js';

export const titulo = 'Tareas repetitivas';

export async function render(el, app) {
  const volver = () => render(el, app);
  const { rows, n, cont } = await prepararPeriodo(el, app, { titulo, alCambiar: volver });
  if (rows.length) repetitivas(cont, { rows, n, app, volver });
}

function repetitivas(cont, { rows, n, app, volver }) {
  const personas = topRepetitivasPorPersona(rows, n);
  const con = personas.filter((p) => p.tareas.length), sin = personas.filter((p) => !p.tareas.length);
  // propuesta ya registrada para la misma tarea (se muestra en lugar del botón Evaluar)
  const propuestaDe = (clave) => app.propuestas.find((p) => p.tarea_clave === clave && p.estado !== 'Descartada');

  cont.innerHTML = `
  <p class="intro">Las cinco tareas que cada persona más repite en el período, ordenadas por cantidad de veces y, ante empate, por horas acumuladas. Las marcadas como <b>posible oportunidad</b> son de tipo manual, administrativo o de control y suman al menos ${CONFIG.oportunidadHorasMes} h por mes: vale la pena analizar si pueden eliminarse, simplificarse, automatizarse o estandarizarse.</p>
  ${!con.length ? '<p class="vacio panel">No se detectaron tareas repetidas en el período.</p>' : `<div class="grid-rep">${con.map((p, i) => `
    <section class="panel rep-card" aria-labelledby="rep-${i}">
      <header class="rep-cab"><h2 id="rep-${i}">${esc(p.persona)}</h2><span class="tenue">${esc(p.area)}</span></header>
      <p class="rep-sint">${p.tareas.length} ${p.tareas.length === 1 ? 'tarea' : 'tareas'}<span aria-hidden="true">|</span>${num(p.veces, 0)} repeticiones<span aria-hidden="true">|</span>${p.horas ? `${num(p.horas)} h acumuladas` : 'sin tiempo cargado'}</p>
      <table class="tabla compacta rep-tabla">
        <thead><tr><th>Tarea</th><th class="num">Veces repetida</th><th class="num">Horas acumuladas</th></tr></thead>
        <tbody>${p.tareas.map((t) => { const pr = propuestaDe(t.clave); return `<tr>
          <td>${esc(t.tarea)}${t.oportunidad || pr ? `<span class="rep-opor">${pr ? `<a href="#/mejoras?propuesta=${pr.id}">Propuesta: ${esc(pr.estado)}</a>`
            : `Posible oportunidad: ${esc(t.tipoSugerido.toLowerCase())}${app.propuestasDisponibles ? ` <button type="button" class="rep-eval" data-evaluar="${i}|${esc(t.clave)}">Evaluar</button>` : ''}`}</span>` : ''}</td>
          <td class="num"><b>${t.veces}</b></td>
          <td class="num">${t.horas ? horas(t.horas) : '<span class="tenue">—</span>'}${t.sinHoras && t.horas ? `<span class="tenue bloque" title="Veces sin tiempo cargado">${t.sinHoras} sin tiempo</span>` : ''}</td></tr>`; }).join('')}</tbody>
      </table>
      ${p.totalRepetidas > p.tareas.length ? `<p class="nota">Tiene ${p.totalRepetidas} tareas repetidas en el período; se muestran las cinco principales.</p>` : ''}
    </section>`).join('')}</div>`}
  ${sin.length ? `<p class="nota">Sin tareas repetidas en el período: ${sin.map((p) => esc(p.persona)).join(', ')}.</p>` : ''}`;

  cont.querySelectorAll('[data-evaluar]').forEach((b) => b.addEventListener('click', () => {
    const [i, clave] = [b.dataset.evaluar.slice(0, b.dataset.evaluar.indexOf('|')), b.dataset.evaluar.slice(b.dataset.evaluar.indexOf('|') + 1)];
    const t = con[+i].tareas.find((x) => x.clave === clave);
    abrirPropuesta(app, { borrador: borradorDeTarea(t, app), alGuardar: volver });
  }));
}
