// =====================================================================
// Panel de detalle de una actividad (compartido por los módulos)
// Muestra datos, ubicación en el Excel e historial de cambios.
// (Las horas reales se cargan como total semanal por persona, en Carga.)
// =====================================================================
import * as db from './db.js';
import { esc, h, horas, fechaLarga, fechaHora, prioBadge } from './ui.js';
import { diaDe, estadoDe } from './engine.js';

const CAMPOS = { fecha: 'Fecha', dia: 'Día', tarea: 'Tarea', prioridad: 'Prioridad', horas_planificadas: 'Tiempo', recursos: 'Recursos',
  riesgos: 'Riesgos', estado: 'Estado', persona: 'Persona', horas_reales: 'Horas reales', riesgo_prob: 'Probabilidad', riesgo_impacto: 'Impacto' };
const TIPOS = { alta: 'Alta en la planificación', modificacion: 'Modificación', retiro: 'Retirada del Excel', reactivacion: 'Volvió al Excel' };

export async function abrirDetalle(r, app, alCerrar) {
  document.querySelector('.cajon')?.remove();
  const el = h(`<aside class="cajon" role="dialog" aria-modal="true" aria-label="Detalle de la actividad">
    <div class="cajon-fondo"></div>
    <div class="cajon-panel">
      <header><h2>${esc(r.tarea || 'Actividad sin descripción')}</h2><button class="btn-icono cerrar" aria-label="Cerrar">✕</button></header>
      <dl class="ficha">
        <dt>Persona</dt><dd>${esc(r.persona)} <span class="tenue">${esc(r.area)}</span></dd>
        <dt>Fecha</dt><dd>${r.fecha ? `${diaDe(r)} ${fechaLarga(r.fecha)}` : '<span class="tenue">Sin fecha</span>'}</dd>
        <dt>Prioridad</dt><dd>${prioBadge(r.prioridad)}</dd>
        <dt>Tiempo planificado</dt><dd>${horas(r.horas)}</dd>
        <dt>Estado</dt><dd>${esc(r.estado) || '<span class="tenue">Sin estado</span>'} <span class="tenue">${estadoDe(r) !== 'Sin estado' && estadoDe(r) !== 'Otro' ? `(${estadoDe(r).toLowerCase()})` : ''}</span></dd>
        <dt>Recursos</dt><dd>${esc(r.recursos) || '<span class="tenue">—</span>'}</dd>
        <dt>Riesgos declarados</dt><dd>${esc(r.riesgos) || '<span class="tenue">—</span>'}</dd>
        <dt>En el Excel</dt><dd>Hoja "${esc(r.hoja)}", fila ${esc(r.fila)}</dd>
      </dl>
      <h3>Historial</h3>
      <div class="historial"><p class="tenue">Cargando…</p></div>
    </div></aside>`);
  document.body.appendChild(el);
  const cerrar = () => { el.remove(); document.removeEventListener('keydown', onKey); alCerrar?.(); };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.cerrar').addEventListener('click', cerrar);
  el.querySelector('.cajon-fondo').addEventListener('click', cerrar);
  el.querySelector('.cerrar').focus();

  try {
    const hist = await db.historialActividad(r.id);
    el.querySelector('.historial').innerHTML = !hist.length ? '<p class="tenue">Sin registros.</p>' : `<ol class="linea-tiempo">${hist.map((x) => `
      <li><time>${fechaHora(x.created_at)}</time>
        <b>${TIPOS[x.tipo]}${x.campo ? ` de ${esc((CAMPOS[x.campo] || x.campo).toLowerCase())}` : ''}</b>${x.campo ? ` <s>${esc(x.valor_anterior ?? '—')}</s> → ${esc(x.valor_nuevo ?? '—')}` : ''}
        <span class="tenue">${{ app: 'desde la aplicación', excel: 'desde el Excel', correccion: 'corrección de datos' }[x.origen] || ''}</span></li>`).join('')}</ol>`;
  } catch (e) { el.querySelector('.historial').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
