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
