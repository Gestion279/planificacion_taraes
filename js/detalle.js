// =====================================================================
// Panel de detalle de una actividad (compartido por los módulos)
// Muestra datos, ubicación en el Excel, historial de cambios y
// permite cargar las horas reales (plan vs real).
// =====================================================================
import * as db from './db.js';
import { esc, h, horas, fechaLarga, fechaHora, prioBadge, aviso } from './ui.js';
import { diaDe, estadoDe } from './engine.js';

const CAMPOS = { fecha: 'Fecha', dia: 'Día', tarea: 'Tarea', prioridad: 'Prioridad', horas_planificadas: 'Tiempo', recursos: 'Recursos',
  riesgos: 'Riesgos', estado: 'Estado', horas_reales: 'Horas reales', riesgo_prob: 'Probabilidad', riesgo_impacto: 'Impacto' };
const TIPOS = { alta: 'Alta en la planificación', modificacion: 'Modificación', retiro: 'Retirada del Excel', reactivacion: 'Volvió al Excel' };

export function inputReal(r) {
  return `<input class="in-real" type="number" min="0" max="24" step="0.25" inputmode="decimal" data-id="${r.id}" value="${r.real ?? ''}" placeholder="—" aria-label="Horas reales de ${esc(r.tarea || 'la actividad')}">`;
}

// Conecta los inputs de horas reales dentro de un contenedor
export function conectarReales(cont, app, alGuardar) {
  cont.querySelectorAll('.in-real').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const v = inp.value === '' ? null : Number(inp.value);
      if (v !== null && (isNaN(v) || v < 0)) { inp.classList.add('invalido'); return; }
      inp.classList.remove('invalido'); inp.disabled = true;
      try {
        await db.actualizarActividad(inp.dataset.id, { horas_reales: v });
        app.actualizarLocal(inp.dataset.id, { real: v });
        inp.classList.add('guardado'); setTimeout(() => inp.classList.remove('guardado'), 1200);
        alGuardar?.();
      } catch (e) { aviso(`No se guardó: ${e.message}`, 'error'); }
      finally { inp.disabled = false; }
    });
  });
}

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
        <dt>Horas reales</dt><dd>${inputReal(r)}</dd>
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
  conectarReales(el, app);

  try {
    const hist = await db.historialActividad(r.id);
    el.querySelector('.historial').innerHTML = !hist.length ? '<p class="tenue">Sin registros.</p>' : `<ol class="linea-tiempo">${hist.map((x) => `
      <li><time>${fechaHora(x.created_at)}</time>
        <b>${TIPOS[x.tipo]}${x.campo ? ` de ${esc((CAMPOS[x.campo] || x.campo).toLowerCase())}` : ''}</b>${x.campo ? ` <s>${esc(x.valor_anterior ?? '—')}</s> → ${esc(x.valor_nuevo ?? '—')}` : ''}
        <span class="tenue">${x.origen === 'app' ? 'desde la aplicación' : 'desde el Excel'}</span></li>`).join('')}</ol>`;
  } catch (e) { el.querySelector('.historial').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
