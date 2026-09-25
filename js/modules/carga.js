// =====================================================================
// ⚙️ Carga — importar el Excel semanal, historial de cargas y
// migración única de los dashboards anteriores.
// =====================================================================
import * as db from '../db.js';
import { leerArchivo, armarPayload } from '../excel.js';
import { leerDashboardAnterior, unirCargas } from '../legacy.js';
import { lunesDe, addDays } from '../engine.js';
import { esc, num, tabla, fechaHora, rangoSemana, etiquetaSemana, aviso, h } from '../ui.js';

export const titulo = 'Carga';

const OBS = {
  sin_fecha: 'Sin fecha', fecha_fuera_semana: 'Fecha fuera de la semana', dia_inconsistente: 'Día no coincide con la fecha',
  horas_invalidas: 'Tiempo no interpretable', prioridad_no_reconocida: 'Importancia no reconocida', posible_duplicado: 'Posible duplicado',
  persona_ausente: 'Persona que no vino en el archivo', persona_otra_area: 'Persona de otra área', archivo_repetido: 'Archivo repetido',
};
const CAMPOS = { fecha: 'fecha', dia: 'día', tarea: 'tarea', prioridad: 'prioridad', horas_planificadas: 'tiempo', recursos: 'recursos', riesgos: 'riesgos', estado: 'estado' };
const IDENT = { exacta: '', cambio_fecha: 'cambió de fecha', texto_editado: 'se editó el texto' };

export async function render(el, app) {
  el.innerHTML = `
  <header class="mod-cab"><h1>Carga</h1><p class="sub">Subí el Excel semanal de cada área, como hasta ahora.</p></header>
  <section class="panel">
    <header class="panel-cab"><h2>Importar planificación</h2></header>
    <label class="zona" data-zona>
      <input type="file" accept=".xlsx,.xls,.xlsm" multiple hidden data-archivo>
      <b>Arrastrá los archivos acá o hacé clic para elegirlos</b>
      <span class="tenue">Un Excel por área, con una hoja por persona. Podés subir varios a la vez.</span>
    </label>
    <div data-archivos></div>
  </section>
  <section class="panel"><header class="panel-cab"><h2>Historial de cargas</h2></header><div data-historial><p class="tenue">Cargando…</p></div></section>
  <details class="panel migracion">
    <summary><h2>Migrar el historial de los dashboards anteriores</h2><span class="tenue">Se usa una sola vez</span></summary>
    <p>Elegí los archivos <b>Planificación Semanal</b> y <b>Histórico de Planificación</b> (HTML). Sus semanas pasan por la misma sincronización, así que se pueden migrar más de una vez sin duplicar.</p>
    <input type="file" accept=".html,.htm" multiple data-legado>
    <div data-legado-res></div>
  </details>`;

  const zona = el.querySelector('[data-zona]');
  const input = el.querySelector('[data-archivo]');
  ['dragover', 'dragenter'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('sobre'); }));
  zona.addEventListener('drop', (e) => procesar([...e.dataTransfer.files], el, app));
  input.addEventListener('change', () => { procesar([...input.files], el, app); input.value = ''; });
  el.querySelector('[data-legado]').addEventListener('change', (e) => migracion([...e.target.files], el.querySelector('[data-legado-res]'), app));

  await historial(el.querySelector('[data-historial]'));
}

// ---------------------------------------------------------------------
async function procesar(files, el, app) {
  const cont = el.querySelector('[data-archivos]');
  for (const file of files.filter((f) => /\.xls[xm]?$/i.test(f.name))) {
    const card = h(`<article class="archivo"><header><h3>${esc(file.name)}</h3><span class="tenue">Leyendo…</span></header></article>`);
    cont.prepend(card);
    try { tarjeta(card, await leerArchivo(file), app); }
    catch (e) { card.innerHTML = `<header><h3>${esc(file.name)}</h3></header><p class="error">No se pudo leer el archivo: ${esc(e.message)}</p>`; }
  }
}

function tarjeta(card, info, app) {
  const areas = app.areas.map((a) => a.nombre);
  card.innerHTML = `
    <header><h3>${esc(info.archivo)}</h3><button class="btn-icono" data-quitar aria-label="Quitar archivo">✕</button></header>
    <p>${info.hojas.length} ${info.hojas.length === 1 ? 'persona' : 'personas'}, ${num(info.filas.length, 0)} actividades leídas.
      <span class="tenue">${info.hojas.map((x) => `${esc(x.persona)} (${x.actividades})`).join(', ')}</span></p>
    ${info.advertencias.map((a) => `<p class="aviso-linea">${esc(a)}</p>`).join('')}
    <div class="archivo-campos">
      <label>Área<input list="lista-areas" data-area value="${esc(info.areaSugerida)}" required placeholder="Elegí o escribí el área"></label>
      <datalist id="lista-areas">${areas.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
      <label>Semana (lunes)<input type="date" data-semana value="${info.semanaSugerida}" required></label>
      <span class="tenue" data-rango>${rangoSemana(info.semanaSugerida, addDays(info.semanaSugerida, 6))}</span>
      <button class="btn primario" data-previa ${info.filas.length ? '' : 'disabled'}>Ver qué va a cambiar</button>
    </div>
    <div data-resultado></div>`;
  card.querySelector('[data-quitar]').addEventListener('click', () => card.remove());
  const inSem = card.querySelector('[data-semana]');
  inSem.addEventListener('change', () => {
    if (!inSem.value) return;
    inSem.value = lunesDe(inSem.value);
    card.querySelector('[data-rango]').textContent = rangoSemana(inSem.value, addDays(inSem.value, 6));
    card.querySelector('[data-resultado]').innerHTML = '';
  });
  card.querySelector('[data-area]').addEventListener('input', () => { card.querySelector('[data-resultado]').innerHTML = ''; });

  card.querySelector('[data-previa]').addEventListener('click', async (e) => {
    const area = card.querySelector('[data-area]').value.trim();
    if (!area) { card.querySelector('[data-area]').focus(); aviso('Indicá el área del archivo.', 'error'); return; }
    const payload = armarPayload({ archivo: info.archivo, hash: info.hash, area, semana: inSem.value, filas: info.filas });
    const b = e.target; b.disabled = true; b.textContent = 'Comparando con lo cargado…';
    try {
      const res = await db.sincronizar(payload, false);
      resultado(card.querySelector('[data-resultado]'), res, {
        confirmar: async (btn) => {
          btn.disabled = true; btn.textContent = 'Guardando…';
          try {
            const ok = await db.sincronizar(payload, true);
            resultado(card.querySelector('[data-resultado]'), ok, { hecho: true });
            card.classList.add('hecho');
            card.querySelector('.archivo-campos').remove();
            aviso(`Carga guardada: ${ok.nuevas} nuevas, ${ok.modificadas} modificadas, ${ok.sin_cambios} sin cambios.`);
            await app.refrescar(ok.semana_inicio);
            await historial(document.querySelector('[data-historial]'));
          } catch (err) { aviso(err.message, 'error'); btn.disabled = false; btn.textContent = 'Confirmar carga'; }
        },
      });
    } catch (err) { card.querySelector('[data-resultado]').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    finally { b.disabled = false; b.textContent = 'Ver qué va a cambiar'; }
  });
}

function resultado(cont, r, { confirmar = null, hecho = false } = {}) {
  const obs = r.observaciones || [];
  const obsPorTipo = [...obs.reduce((m, o) => m.set(o.tipo, [...(m.get(o.tipo) || []), o]), new Map())];
  const d = r.detalle || {};
  cont.innerHTML = `
    <div class="res ${hecho ? 'res-hecho' : ''}">
      <p class="res-tit">${hecho ? 'Carga guardada' : 'Vista previa: todavía no se guardó nada'} para la semana del ${rangoSemana(r.semana_inicio, r.semana_fin)}, ${esc(r.area)}</p>
      <dl class="res-cifras">
        <div><dt>Procesadas</dt><dd>${num(r.total, 0)}</dd></div>
        <div class="c-nueva"><dt>Nuevas</dt><dd>${num(r.nuevas, 0)}</dd></div>
        <div class="c-mod"><dt>Modificadas</dt><dd>${num(r.modificadas, 0)}</dd></div>
        <div><dt>Sin cambios</dt><dd>${num(r.sin_cambios, 0)}</dd></div>
        ${r.retiradas ? `<div class="c-ret"><dt>Retiradas</dt><dd>${num(r.retiradas, 0)}</dd></div>` : ''}
        ${r.reactivadas ? `<div><dt>Reactivadas</dt><dd>${num(r.reactivadas, 0)}</dd></div>` : ''}
        <div class="${obs.length ? 'c-obs' : ''}"><dt>Observaciones</dt><dd>${num(obs.length, 0)}</dd></div>
      </dl>
      ${d.modificadas?.length ? `<details><summary>Modificadas (${d.modificadas.length})</summary><ul class="lista-simple">${d.modificadas.map((m) =>
        `<li><b>${esc(m.persona)}</b>, "${esc(m.tarea)}"${IDENT[m.identificacion] ? ` <span class="tenue">(${IDENT[m.identificacion]})</span>` : ''}${m.reactivada ? ' <span class="tenue">(vuelve a estar en el Excel)</span>' : ''}:
          ${m.cambios.map((c) => `${CAMPOS[c.campo] || c.campo} <s>${esc(c.antes ?? '—')}</s> → ${esc(c.despues ?? '—')}`).join('; ')}</li>`).join('')}</ul></details>` : ''}
      ${d.nuevas?.length && r.sin_cambios + r.modificadas > 0 ? `<details><summary>Nuevas (${d.nuevas.length})</summary><ul class="lista-simple">${d.nuevas.map((n) => `<li><b>${esc(n.persona)}</b>, ${etiquetaSemana(n.fecha || r.semana_inicio)}: ${esc(n.tarea)}</li>`).join('')}</ul></details>` : ''}
      ${d.retiradas?.length ? `<details><summary>Retiradas (${d.retiradas.length}): ya no están en el Excel</summary><ul class="lista-simple">${d.retiradas.map((n) => `<li><b>${esc(n.persona)}</b>: ${esc(n.tarea)}</li>`).join('')}</ul><p class="nota">No se borran: quedan en el historial y vuelven si reaparecen en el Excel.</p></details>` : ''}
      ${obsPorTipo.length ? `<details ${hecho ? '' : 'open'}><summary>Observaciones (${obs.length})</summary><ul class="lista-simple">${obsPorTipo.map(([t, os]) =>
        `<li><b>${esc(OBS[t] || t)}</b> (${os.length}): ${os.slice(0, 5).map((o) => `${o.persona ? esc(o.persona) : ''}${o.fila ? ` fila ${o.fila}` : ''}${o.persona || o.fila ? ', ' : ''}${esc(o.detalle)}`).join('; ')}${os.length > 5 ? `; y ${os.length - 5} más` : ''}</li>`).join('')}</ul>
        <p class="nota">Las observaciones no impiden la carga: los datos se guardan igual y quedan para revisar en Auditoría.</p></details>` : ''}
      ${confirmar ? `<div class="acciones">
        ${r.nuevas + r.modificadas + r.retiradas + r.reactivadas === 0 ? '<p class="tenue">No hay cambios respecto de lo ya cargado. Podés confirmar igual para registrar la carga.</p>' : ''}
        <button class="btn primario" data-confirmar>Confirmar carga</button></div>` : ''}
    </div>`;
  cont.querySelector('[data-confirmar]')?.addEventListener('click', (e) => confirmar(e.target));
}

// ---------------------------------------------------------------------
async function historial(cont) {
  if (!cont) return;
  try {
    const imps = await db.importaciones();
    tabla(cont, {
      rows: imps, orden: { key: 'created_at', dir: -1 }, max: 50, vacio: 'Todavía no se realizó ninguna carga.',
      cols: [
        { key: 'created_at', label: 'Fecha y hora', render: (i) => fechaHora(i.created_at) },
        { key: 'semana', label: 'Semana', render: (i) => (i.semana ? `del ${etiquetaSemana(i.semana)}` : '—') },
        { key: 'area', label: 'Área' },
        { key: 'archivo', label: 'Archivo', clase: 'col-texto', render: (i) => `${esc(i.archivo)}${i.origen === 'migracion' ? ' <span class="tenue">(migración)</span>' : ''}<span class="tenue bloque">${esc(i.usuario_email || '')}</span>` },
        { key: 'total', label: 'Registros', alinear: 'num' },
        { key: 'nuevas', label: 'Nuevas', alinear: 'num' },
        { key: 'modificadas', label: 'Modificadas', alinear: 'num' },
        { key: 'sin_cambios', label: 'Sin cambios', alinear: 'num' },
        { key: 'retiradas', label: 'Retiradas', alinear: 'num' },
        { key: 'obs', label: 'Observaciones', alinear: 'num', sort: (i) => i.observaciones.length, render: (i) => i.observaciones.length },
      ],
    });
  } catch (e) { cont.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------------------------------------------------------------------
async function migracion(files, cont, app) {
  cont.innerHTML = '<p class="tenue">Leyendo archivos…</p>';
  const listas = [];
  const errores = [];
  for (const f of files) {
    try { const r = await leerDashboardAnterior(f); listas.push(r.cargas); }
    catch (e) { errores.push(e.message); }
  }
  const cargas = unirCargas(listas);
  if (!cargas.length) { cont.innerHTML = `<p class="error">${esc(errores.join(' ') || 'No se encontraron datos para migrar.')}</p>`; return; }
  const estado = new Map(cargas.map((c) => [c, { previa: null, ok: null, error: null }]));

  const pintar = (enCurso = '') => {
    const hechas = [...estado.values()].filter((s) => s.ok).length;
    cont.innerHTML = `
      ${errores.map((e) => `<p class="aviso-linea">${esc(e)}</p>`).join('')}
      <p>${cargas.length} cargas encontradas (${num(cargas.reduce((a, c) => a + c.filas.length, 0), 0)} actividades) en ${new Set(cargas.map((c) => c.semana)).size} semanas.</p>
      <div class="tabla-scroll"><table class="tabla compacta"><thead><tr><th>Semana</th><th>Área</th><th class="num">Actividades</th><th class="num">Nuevas</th><th class="num">Modificadas</th><th class="num">Sin cambios</th><th class="num">Observ.</th><th>Estado</th></tr></thead>
      <tbody>${cargas.map((c) => { const s = estado.get(c); const r = s.ok || s.previa;
        return `<tr><td>${rangoSemana(c.semana, addDays(c.semana, 6))}</td><td>${esc(c.area)}</td><td class="num">${c.filas.length}</td>
          <td class="num">${r ? r.nuevas : ''}</td><td class="num">${r ? r.modificadas : ''}</td><td class="num">${r ? r.sin_cambios : ''}</td><td class="num">${r ? r.observaciones.length : ''}</td>
          <td>${s.error ? `<span class="error">${esc(s.error)}</span>` : s.ok ? '<span class="ok-txt">Migrada</span>' : s.previa ? 'Lista' : ''}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="acciones">
        ${enCurso ? `<p class="tenue">${esc(enCurso)}</p>` : hechas === cargas.length ? '<p class="ok-txt">Migración completa.</p>'
          : [...estado.values()].every((s) => s.previa || s.error) ? '<button class="btn primario" data-migrar>Confirmar migración</button>'
            : '<button class="btn" data-previa>Ver qué va a cambiar</button>'}
      </div>`;
    cont.querySelector('[data-previa]')?.addEventListener('click', () => correr(false));
    cont.querySelector('[data-migrar]')?.addEventListener('click', () => correr(true));
  };

  const correr = async (confirmar) => {
    let i = 0;
    for (const c of cargas) {
      i++;
      const s = estado.get(c);
      if (s.ok || (confirmar && s.error)) continue;
      pintar(`${confirmar ? 'Guardando' : 'Comparando'} ${i} de ${cargas.length}: semana del ${etiquetaSemana(c.semana)}, ${c.area}…`);
      try {
        const res = await db.sincronizar(armarPayload({ archivo: c.archivo, hash: null, area: c.area, semana: c.semana, filas: c.filas, origen: 'migracion' }), confirmar);
        if (confirmar) s.ok = res; else s.previa = res;
        s.error = null;
      } catch (e) { s.error = e.message; }
    }
    pintar();
    if (confirmar) {
      await app.refrescar();
      await historial(document.querySelector('[data-historial]'));
      aviso('Migración terminada. La aplicación muestra la última semana cargada.');
    }
  };
  pintar();
}
