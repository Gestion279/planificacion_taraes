// =====================================================================
// Utilidades de interfaz compartidas por todos los módulos
// =====================================================================
export const PALETA = {
  pewter: '#636E70', pewterOsc: '#4B5557', bluffs: '#C88B58', grass: '#BCB48C',
  beige: '#BDB8AC', sun: '#F0E3D1', crit: '#A8322D', warn: '#C9962E', ok: '#6F8A5B', tinta: '#2B3436', tinta2: '#5C6769',
};
export const COLOR_PRIORIDAD = { Alta: PALETA.bluffs, Media: PALETA.grass, Baja: PALETA.pewter, 'Sin prioridad': '#DDD6C9' };
export const COLOR_ESTADO = { Cumplida: PALETA.ok, 'En curso': PALETA.grass, Pendiente: PALETA.crit, Otro: PALETA.beige, 'Sin estado': '#E7E1D6' };

export const esc = (s) => (s === null || s === undefined ? '' : String(s))
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
export const num = (v, dec = 1) => (v === null || v === undefined || isNaN(v) ? '—' : (dec ? nf1 : nf0).format(v));
export const horas = (v) => (v === null || v === undefined ? '—' : `${nf1.format(v)} h`);
export const porc = (v) => (v === null || v === undefined || isNaN(v) ? '—' : `${nf0.format(v)}%`);
export const signo = (v, suf = '') => (v === null || v === undefined || isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${nf1.format(v)}${suf}`);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fechaCorta(iso) { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${+d}/${+m}`; }
export function fechaLarga(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]} ${y}`; }
export function rangoSemana(ini, fin) {
  const [, m1, d1] = ini.split('-'); const [y2, m2, d2] = fin.split('-');
  return m1 === m2 ? `${+d1} al ${+d2} ${MESES[+m2 - 1]} ${y2}` : `${+d1} ${MESES[+m1 - 1]} al ${+d2} ${MESES[+m2 - 1]} ${y2}`;
}
export const etiquetaSemana = (iso) => { const [, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]}`; };
export function fechaHora(ts) {
  const d = new Date(ts);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// ---------- tabla ordenable ----------
// cols: [{ key, label, render?(row) -> html, sort?(row) -> valor, clase?, alinear?: 'num' }]
export function tabla(cont, { cols, rows, orden = null, vacio = 'Sin datos para mostrar.', onRow = null, max = null, id = '' }) {
  let estado = orden || { key: null, dir: 1 };
  const dibujar = () => {
    let data = [...rows];
    if (estado.key) {
      const c = cols.find((x) => x.key === estado.key);
      const f = c.sort || ((r) => r[c.key]);
      data.sort((a, b) => {
        const va = f(a), vb = f(b);
        if (va === vb) return 0;
        if (va === null || va === undefined || va === '') return 1;
        if (vb === null || vb === undefined || vb === '') return -1;
        return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')) * estado.dir;
      });
    }
    const total = data.length;
    if (max && data.length > max) data = data.slice(0, max);
    cont.innerHTML = !rows.length ? `<p class="vacio">${esc(vacio)}</p>` : `
      <div class="tabla-scroll"><table class="tabla" ${id ? `id="${id}"` : ''}>
        <thead><tr>${cols.map((c) => `<th class="${c.alinear || ''}" data-k="${c.key}" aria-sort="${estado.key === c.key ? (estado.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button">${esc(c.label)}</button></th>`).join('')}</tr></thead>
        <tbody>${data.map((r, i) => `<tr data-i="${i}" ${onRow ? 'class="clic" tabindex="0"' : ''}>${cols.map((c) => `<td class="${c.alinear || ''} ${c.clase || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${max && total > max ? `<p class="nota">Se muestran ${max} de ${total} filas. Usá los filtros para acotar.</p>` : ''}`;
    cont.querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
      const k = b.parentElement.dataset.k;
      estado = { key: k, dir: estado.key === k ? -estado.dir : (cols.find((c) => c.key === k).alinear === 'num' ? -1 : 1) };
      dibujar();
    }));
    if (onRow) cont.querySelectorAll('tbody tr').forEach((tr) => {
      const go = () => onRow(data[+tr.dataset.i], tr);
      tr.addEventListener('click', (e) => { if (!e.target.closest('input,select,button,a')) go(); });
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('input,select')) go(); });
    });
  };
  dibujar();
}

// ---------- barra apilada (distribuciones) ----------
export function barraApilada(partes, { total = null, formato = (v) => num(v) } = {}) {
  const t = total ?? partes.reduce((a, p) => a + p.valor, 0);
  if (!t) return '<p class="vacio">Sin datos.</p>';
  return `<div class="apilada" role="img" aria-label="${esc(partes.map((p) => `${p.label}: ${formato(p.valor)}`).join(', '))}">
    ${partes.filter((p) => p.valor > 0).map((p) => `<span style="flex:${p.valor};background:${p.color}" title="${esc(p.label)}: ${esc(formato(p.valor))} (${Math.round((p.valor / t) * 100)}%)"></span>`).join('')}
  </div>
  <ul class="leyenda">${partes.map((p) => `<li><i style="background:${p.color}"></i>${esc(p.label)} <b>${esc(formato(p.valor))}</b> <span>${Math.round((p.valor / t) * 100)}%</span></li>`).join('')}</ul>`;
}

export function barraOcupacion(pctVal) {
  if (pctVal === null || pctVal === undefined) return '—';
  const cls = pctVal > 120 ? 'crit' : pctVal > 110 ? 'warn' : pctVal < 30 ? 'baja' : 'ok';
  return `<span class="ocup ${cls}"><span class="ocup-barra"><span style="width:${Math.min(pctVal, 130) / 1.3}%"></span><i style="left:${100 / 1.3}%"></i></span><span class="ocup-num">${porc(pctVal)}</span></span>`;
}

export const nivelBadge = (nivel) => {
  const t = { critica: 'Crítica', advertencia: 'Advertencia', info: 'Para revisar' }[nivel] || nivel;
  return `<span class="badge n-${nivel}">${t}</span>`;
};
export const riesgoBadge = (nivel) => (nivel ? `<span class="badge r-${nivel === 'crítico' ? 'critico' : nivel}">${nivel[0].toUpperCase() + nivel.slice(1)}</span>` : '<span class="tenue">Sin evaluar</span>');
export const prioBadge = (p) => (p ? `<span class="prio p-${p.toLowerCase()}">${p}</span>` : '<span class="tenue">—</span>');

// ---------- gráficos (Chart.js) ----------
const graficos = new Map();
export function grafico(canvas, config) {
  if (!canvas) return;
  graficos.get(canvas)?.destroy();
  const C = globalThis.Chart;
  C.defaults.font.family = "'Public Sans', system-ui, sans-serif";
  C.defaults.font.size = 12;
  C.defaults.color = PALETA.tinta2;
  C.defaults.borderColor = '#E7E1D6';
  C.defaults.plugins.legend.labels.boxWidth = 10;
  C.defaults.plugins.legend.labels.boxHeight = 10;
  C.defaults.plugins.tooltip.backgroundColor = PALETA.tinta;
  C.defaults.maintainAspectRatio = false;
  graficos.set(canvas, new C(canvas, config));
}
export function limpiarGraficos() { graficos.forEach((g) => g.destroy()); graficos.clear(); }

// ---------- avisos ----------
export function aviso(texto, tipo = 'ok') {
  const el = h(`<div class="toast t-${tipo}" role="status">${esc(texto)}</div>`);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('fuera'), 3200);
  setTimeout(() => el.remove(), 3700);
}

export function opciones(valores, sel, todos = null) {
  return (todos ? `<option value="">${esc(todos)}</option>` : '') +
    valores.map((v) => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}" ${String(val) === String(sel) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('');
}

// ---------- clave de carga ----------
// Se muestra solo si en Supabase se definió una clave y la acción la necesita.
// Si ya hay un pedido abierto (dos acciones a la vez), se reutiliza el mismo diálogo.
let pedidoEnCurso = null;
export function pedirClave(reintento = false) {
  if (pedidoEnCurso) return pedidoEnCurso;
  pedidoEnCurso = new Promise((resolve) => {
    const d = h(`<dialog class="dlg-clave" aria-labelledby="dlg-clave-t">
      <form method="dialog">
        <h2 id="dlg-clave-t">Clave de carga</h2>
        <p>${reintento ? 'La clave no es correcta. Probá de nuevo.' : 'Para guardar cambios se necesita la clave de carga del equipo. Se recuerda en este navegador.'}</p>
        <label>Clave<input type="password" name="clave" required autocomplete="current-password"></label>
        <div class="acciones"><button class="btn" value="cancelar" formnovalidate>Cancelar</button><button class="btn primario" value="ok">Guardar</button></div>
      </form></dialog>`);
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? d.querySelector('input').value.trim() : null; d.remove(); pedidoEnCurso = null; resolve(v || null); });
    d.showModal();
  });
  return pedidoEnCurso;
}

// ---------- filtro de selección múltiple ----------
// opciones: [{ valor, texto, grupo? }]; seleccion: array de valores (vacío = sin filtro)
// onChange(nuevaSeleccion) se llama en cada cambio: el filtrado es inmediato.
let multiAbierto = null;
document.addEventListener('click', (e) => { if (multiAbierto && !multiAbierto.contains(e.target)) cerrarMulti(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && multiAbierto) { const b = multiAbierto.querySelector('.ms-btn'); cerrarMulti(); b?.focus(); } });
function cerrarMulti() { if (!multiAbierto) return; multiAbierto.classList.remove('abierto'); multiAbierto.querySelector('.ms-btn')?.setAttribute('aria-expanded', 'false'); multiAbierto = null; }

export function multiSelect({ etiqueta, opciones, seleccion = [], onChange, todos = 'Todas', compacto = false }) {
  let sel = new Set(seleccion.filter((v) => opciones.some((o) => String(o.valor) === String(v))));
  const el = h(`<div class="ms ${compacto ? 'ms-compacto' : ''}">
    <span class="ms-etq">${esc(etiqueta)}</span>
    <button type="button" class="ms-btn" aria-haspopup="true" aria-expanded="false">${compacto ? `<span class="ms-pref" aria-hidden="true">${esc(etiqueta)}</span>` : ''}<span class="ms-txt"></span><span class="ms-flecha" aria-hidden="true"></span></button>
    <div class="ms-panel" role="group" aria-label="${esc(etiqueta)}">
      ${opciones.length > 8 ? `<input type="search" class="ms-buscar" placeholder="Buscar…" aria-label="Buscar en ${esc(etiqueta)}">` : ''}
      <div class="ms-acc"><button type="button" data-todos>Seleccionar todo</button><button type="button" data-ninguno>Quitar selección</button></div>
      <div class="ms-lista">${(() => { let g = null; return opciones.map((o) => {
        const cab = o.grupo && o.grupo !== g ? `<div class="ms-grupo">${esc((g = o.grupo))}</div>` : '';
        return `${cab}<label class="ms-op" data-texto="${esc(String(o.texto).toLowerCase())}"><input type="checkbox" value="${esc(o.valor)}"><span>${esc(o.texto)}</span></label>`; }).join(''); })()}
        ${opciones.length ? '' : '<p class="ms-vacio">Sin opciones</p>'}</div>
    </div></div>`);
  const btn = el.querySelector('.ms-btn');
  const pintar = () => {
    el.querySelectorAll('.ms-op input').forEach((c) => { c.checked = sel.has(c.value); });
    const n = sel.size;
    el.querySelector('.ms-txt').textContent = !n ? todos : n === 1 ? (opciones.find((o) => sel.has(String(o.valor)))?.texto ?? '1 seleccionada') : `${n} seleccionadas`;
    el.classList.toggle('activo', n > 0);
  };
  const avisar = () => { pintar(); onChange([...sel]); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('abierto')) { cerrarMulti(); return; }
    cerrarMulti(); el.classList.add('abierto'); btn.setAttribute('aria-expanded', 'true'); multiAbierto = el;
    (el.querySelector('.ms-buscar') || el.querySelector('.ms-op input'))?.focus();
  });
  el.querySelectorAll('.ms-op input').forEach((c) => c.addEventListener('change', () => { c.checked ? sel.add(c.value) : sel.delete(c.value); avisar(); }));
  el.querySelector('[data-ninguno]').addEventListener('click', () => { sel = new Set(); avisar(); });
  el.querySelector('[data-todos]').addEventListener('click', () => {
    // "todo" = las opciones visibles (respeta la búsqueda)
    el.querySelectorAll('.ms-op').forEach((l) => { if (!l.hidden) sel.add(l.querySelector('input').value); });
    if (sel.size === opciones.length) sel = new Set();   // todas seleccionadas equivale a no filtrar
    avisar();
  });
  el.querySelector('.ms-buscar')?.addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    el.querySelectorAll('.ms-op').forEach((l) => { l.hidden = !!t && !l.dataset.texto.includes(t); });
  });
  pintar();
  el.fijar = (valores) => { sel = new Set(valores.map(String)); pintar(); };
  return el;
}
