// =====================================================================
// Ficha de una propuesta de mejora (alta y seguimiento). Compartida por
// Propuestas de mejora, Riesgos y auditoría y Resumen.
// Problema → causa → propuesta → impacto × esfuerzo → estado → resultado.
// =====================================================================
import * as db from './db.js';
import { esc, opciones, aviso, abrirCajon, grupoBadge, horas, fechaHora, num, signo } from './ui.js';
import { FUENTES_PROPUESTA, TIPOS_MEJORA, NIVELES_IE, ESTADOS_PROPUESTA, GRUPOS, grupoPropuesta, potencialPropuesta, resultadoPropuesta, hoyISO, recortar } from './engine.js';
import { olvidarSituaciones } from './situaciones.js';

const ETQ = { titulo: 'título', problema: 'problema', fuente: 'fuente', causa: 'causa', propuesta: 'propuesta', tipo: 'tipo', impacto: 'impacto',
  esfuerzo: 'esfuerzo', responsable: 'responsable', estado: 'estado', area: 'área', horas_mes_base: 'horas por mes', ahorro_pct: 'reducción estimada',
  resultado_esperado: 'resultado esperado', resultado_obtenido: 'resultado obtenido', fecha_implementacion: 'fecha de implementación', tarea_clave: 'tarea vinculada', origen_clave: 'situación de origen' };

// borrador: datos iniciales para una propuesta nueva (desde una situación o una tarea repetitiva)
export function abrirPropuesta(app, { propuesta = null, borrador = {}, alGuardar = null } = {}) {
  if (!app.propuestasDisponibles) {
    abrirCajon({ titulo: 'Propuesta de mejora', html: `<p class="aviso-panel">Para registrar propuestas falta aplicar la actualización de la base de datos <b>supabase/propuestas_mejora.sql</b>. Mientras tanto, las oportunidades detectadas se siguen mostrando.</p>` });
    return;
  }
  const p = { fuente: 'Otro', estado: 'Detectada', ...borrador, ...(propuesta || {}) };
  const v = (k) => esc(p[k] ?? '');
  const area = (app.areas || []).map((a) => a.nombre);
  const { el, cerrar } = abrirCajon({
    titulo: propuesta ? 'Propuesta de mejora' : 'Nueva propuesta de mejora',
    html: `<form class="ficha-prop" novalidate>
      ${p.tarea_clave || p.origen_clave ? `<p class="prop-origen">Surge de: <b>${esc(p.fuente)}</b>${p.origen_texto ? ` — ${esc(p.origen_texto)}` : ''}</p>` : ''}
      <label class="fp-ancho">Título<input name="titulo" type="text" required maxlength="160" value="${v('titulo')}" placeholder="Ej.: Automatizar la carga manual de facturas"></label>
      <fieldset><legend>1. Problema</legend>
        <label class="fp-ancho">Problema detectado<textarea name="problema" rows="2" placeholder="¿Qué está ocurriendo?">${v('problema')}</textarea></label>
        <label>Fuente<select name="fuente">${opciones(FUENTES_PROPUESTA, p.fuente)}</select></label>
        <label>Área<select name="area">${opciones(area, p.area, 'Todas / sin área')}</select></label>
        <label class="fp-ancho">Causa posible<textarea name="causa" rows="2" placeholder="Si no hay evidencia suficiente, indicá: Requiere revisión">${v('causa')}</textarea></label>
      </fieldset>
      <fieldset><legend>2. Propuesta y prioridad</legend>
        <label class="fp-ancho">Propuesta<textarea name="propuesta" rows="2" placeholder="¿Qué se recomienda hacer?">${v('propuesta')}</textarea></label>
        <label>Tipo de mejora<select name="tipo">${opciones(TIPOS_MEJORA, p.tipo, 'Sin definir')}</select></label>
        <label>Responsable<input name="responsable" type="text" maxlength="120" value="${v('responsable')}" placeholder="Quién la analiza o implementa"></label>
        <label>Impacto esperado<select name="impacto">${opciones(NIVELES_IE, p.impacto, 'Sin evaluar')}</select></label>
        <label>Esfuerzo requerido<select name="esfuerzo">${opciones(NIVELES_IE, p.esfuerzo, 'Sin evaluar')}</select></label>
        <p class="fp-ancho fp-calc">Prioridad: <span data-grupo></span></p>
      </fieldset>
      <fieldset><legend>3. Potencial</legend>
        <label>Horas por mes que consume hoy<input name="horas_mes_base" type="number" min="0" step="0.5" inputmode="decimal" value="${p.horas_mes_base ?? ''}"></label>
        <label>Reducción estimada (%)<input name="ahorro_pct" type="number" min="0" max="100" step="5" inputmode="decimal" value="${p.ahorro_pct ?? ''}" placeholder="La estima quien evalúa"></label>
        <p class="fp-ancho fp-calc">Potencial estimado: <b data-potencial></b></p>
      </fieldset>
      <fieldset><legend>4. Seguimiento y resultado</legend>
        <label>Estado<select name="estado">${opciones(ESTADOS_PROPUESTA, p.estado)}</select></label>
        <label data-fecha>Fecha de implementación<input name="fecha_implementacion" type="date" value="${v('fecha_implementacion')}"></label>
        <label class="fp-ancho">Resultado esperado<textarea name="resultado_esperado" rows="2" placeholder="¿Qué debería mejorar?">${v('resultado_esperado')}</textarea></label>
        <label class="fp-ancho">Resultado obtenido<textarea name="resultado_obtenido" rows="2" placeholder="¿Qué ocurrió después de implementarla?">${v('resultado_obtenido')}</textarea></label>
        <div class="fp-ancho" data-medicion></div>
      </fieldset>
      <div class="acciones"><button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn primario">Guardar</button></div>
      ${propuesta ? '<details class="revisadas"><summary>Historial de cambios</summary><div data-hist><p class="tenue">Cargando…</p></div></details>' : ''}
    </form>` });
  const f = el.querySelector('form');
  const val = (k) => f.elements[k].value.trim();
  const actualizar = () => {
    el.querySelector('[data-grupo]').innerHTML = grupoBadge(grupoPropuesta(val('impacto'), val('esfuerzo')), GRUPOS);
    const pot = potencialPropuesta({ horas_mes_base: val('horas_mes_base'), ahorro_pct: val('ahorro_pct') === '' ? null : val('ahorro_pct') });
    el.querySelector('[data-potencial]').textContent = pot === null ? (Number(val('horas_mes_base')) > 0 ? 'Pendiente de estimación (falta la reducción estimada)' : 'Pendiente de estimación') : `${num(pot)} h por mes`;
    el.querySelector('[data-fecha]').hidden = !['En implementación', 'Implementada'].includes(val('estado'));
  };
  f.addEventListener('input', actualizar); f.addEventListener('change', actualizar);
  actualizar();
  el.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  // medición automática antes / después (solo si está vinculada a una tarea y tiene fecha)
  if (propuesta?.tarea_clave && propuesta.fecha_implementacion) {
    const cont = el.querySelector('[data-medicion]');
    cont.innerHTML = '<p class="tenue">Midiendo la tarea antes y después…</p>';
    app.filasDe(app.semanas).then(({ rows, semanas }) => {
      const r = resultadoPropuesta(propuesta, rows, semanas);
      cont.innerHTML = !r || r.antes === null ? '<p class="nota">Todavía no hay semanas cargadas antes y después de la implementación para medir el resultado.</p>'
        : `<p class="medicion">Medición sobre la planificación: la tarea pasó de <b>${horas(r.antes)}</b> a <b>${horas(r.despues)}</b> por semana${r.variacionPct === null ? '' : ` (${signo(r.variacionPct, ' %')})`}, con ${r.semanasAntes} semanas antes y ${r.semanasDespues} después.</p>`;
    }).catch(() => { cont.innerHTML = ''; });
  }
  if (propuesta) db.historialPropuesta(propuesta.id).then((h) => {
    const c = el.querySelector('[data-hist]');
    c.innerHTML = !h.length ? '<p class="tenue">Sin registros.</p>' : `<ol class="linea-tiempo">${h.map((x) => `<li><time>${fechaHora(x.created_at)}${x.cargado_por ? `, ${esc(x.cargado_por)}` : ''}</time>
      ${x.campo ? `<b>${esc(ETQ[x.campo] || x.campo)}</b>: <s>${esc(x.valor_anterior ?? '—')}</s> → ${esc(x.valor_nuevo ?? '—')}` : '<b>Alta de la propuesta</b>'}</li>`).join('')}</ol>`;
  }).catch((e) => { el.querySelector('[data-hist]').innerHTML = `<p class="error">${esc(e.message)}</p>`; });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!val('titulo')) { f.elements.titulo.focus(); aviso('Indicá un título para la propuesta.', 'error'); return; }
    if (val('estado') === 'Implementada' && !val('fecha_implementacion')) f.elements.fecha_implementacion.value = hoyISO();
    const datos = {};
    ['titulo', 'problema', 'fuente', 'causa', 'propuesta', 'tipo', 'impacto', 'esfuerzo', 'responsable', 'estado', 'area',
      'resultado_esperado', 'resultado_obtenido', 'fecha_implementacion'].forEach((k) => { datos[k] = val(k); });
    ['horas_mes_base', 'ahorro_pct'].forEach((k) => { datos[k] = val(k) === '' ? null : Number(val(k)); });
    if (!propuesta) { datos.tarea_clave = p.tarea_clave || null; datos.origen_clave = p.origen_clave || null; }
    const b = f.querySelector('[type="submit"]'); b.disabled = true; b.textContent = 'Guardando…';
    try {
      await db.guardarPropuesta(propuesta?.id, datos);
      await app.cargarPropuestas();
      olvidarSituaciones();
      aviso(propuesta ? 'Propuesta actualizada.' : 'Propuesta registrada.');
      cerrar();
      alGuardar?.();
    } catch (err) { aviso(err.message, 'error'); b.disabled = false; b.textContent = 'Guardar'; }
  });
}

// ---------- borradores: una propuesta nueva nace vinculada al problema que la originó ----------
export function borradorDeTarea(t, app) {
  const quienes = t.personas.length > 2 ? `${t.personas.length} personas` : t.personas.join(' y ');
  return {
    titulo: `${t.tipoSugerido || 'Mejorar'}: ${recortar(t.tarea, 110)}`,
    problema: `"${t.tarea}" se planifica ${num(t.vecesSemana)} veces por semana, en ${t.semanas} semanas, por ${quienes}${t.horasMes ? `, y consume ${num(t.horasMes)} h por mes` : ''}.`,
    fuente: 'Tarea repetitiva',
    causa: 'Requiere revisión: confirmar con quienes la realizan por qué se repite.',
    tipo: t.tipoSugerido || '', horas_mes_base: t.horasMes ? Math.round(t.horasMes * 10) / 10 : null,
    tarea_clave: t.clave, origen_clave: `rep:${t.clave}`, origen_texto: t.tarea,
    area: t.areas.length === 1 ? t.areas[0] : '',
  };
}

export function borradorDeSituacion(s, app) {
  const fuente = s.fuente === 'Tarea repetitiva' ? 'Tarea repetitiva' : s.fuente;
  return { titulo: s.titulo, problema: s.que, fuente, causa: s.causa, propuesta: s.accion, tipo: s.tipo || '', origen_clave: s.id,
    origen_texto: s.titulo, area: app.filtros.areas.length === 1 ? app.filtros.areas[0] : '' };
}

