'use strict';
/* Desempeño · módulo compartido
   El MISMO archivo va en las dos apps:
     - Carga semanal  → hoja "Mi desempeño" (cada persona ve lo suyo)
     - Informe        → hoja "Desempeño" (Gerencia y el administrador ven a cualquiera)
   Solo calcula y arma HTML. No llama a la base: cada app le pasa los datos.
   Expone window.Desempeno = { calcular, vista, feedback, esc, ddmm }. */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const aFecha = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const dosD = (n) => String(n).padStart(2, '0');
  const ddmm = (s) => { const d = aFecha(s); return `${dosD(d.getDate())}/${dosD(d.getMonth() + 1)}`; };
  const ddmmTs = (ts) => { const d = new Date(ts); return `${dosD(d.getDate())}/${dosD(d.getMonth() + 1)}`; };
  const diaTs = (ts) => DIAS[new Date(ts).getDay()];
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const tiene = (v) => v !== null && v !== undefined && v !== '';
  const fmt = (x, dec = 1) => (Math.round(x * 10 ** dec) / 10 ** dec).toLocaleString('es-AR', { maximumFractionDigits: dec });
  const suma = (lista, campo) => lista.reduce((t, x) => t + n(x[campo]), 0);

  // Mismo criterio que la base (cargar_mis_semanas): peso = horas planificadas, si no hay las reales,
  // si no hay ninguna 1. Reprogramadas y vacías no cuentan.
  const peso = (t) => (tiene(t.horas_planificadas) ? n(t.horas_planificadas) : tiene(t.horas_reales) ? n(t.horas_reales) : 1);
  function cumplimiento(lista) {
    const ev = lista.filter((t) => /^[0-9]+$/.test(String(t.cumplimiento ?? '')));
    if (!ev.length) return null;
    const p = ev.reduce((s, t) => s + peso(t), 0);
    if (!p) return null;
    return Math.round(ev.reduce((s, t) => s + Number(t.cumplimiento) * peso(t), 0) / p);
  }
  const colorPct = (p) => (p === null ? 'var(--gris-chip)' : p < 25 ? 'var(--rojo)' : p < 50 ? 'var(--naranja)' : p < 75 ? 'var(--amarillo)' : 'var(--verde)');

  /* ---------- cálculo ---------- */
  function calcular(tareas, jornada) {
    const t = tareas || [];
    const plan = t.filter((x) => !x.no_planificada);
    const np = t.filter((x) => x.no_planificada);
    const ambas = plan.filter((x) => n(x.horas_planificadas) > 0 && tiene(x.horas_reales));
    const hPlan = suma(plan, 'horas_planificadas');
    const hReal = suma(t, 'horas_reales');
    const hPrevAmbas = suma(ambas, 'horas_planificadas');
    const hRealAmbas = suma(ambas, 'horas_reales');
    const c = (fn) => plan.filter(fn).length;
    const imp = {};
    ['Alta', 'Media', 'Baja'].forEach((p) => {
      const l = t.filter((x) => x.prioridad === p);
      imp[p] = { pct: cumplimiento(l), cant: l.length };
    });
    return {
      cumplimiento: cumplimiento(t),
      horasPlan: hPlan,
      jornada: n(jornada) || 44,
      carga: hPlan / (n(jornada) || 44),
      precision: hPrevAmbas > 0 ? hRealAmbas / hPrevAmbas : null,
      hPrevAmbas, hRealAmbas,
      hReal,
      hRealNp: suma(np, 'horas_reales'),
      noPlan: hReal > 0 ? suma(np, 'horas_reales') / hReal : null,
      cant: {
        planificadas: plan.length,
        total: c((x) => x.cumplimiento === '100'),
        parte: c((x) => ['25', '50', '75'].includes(String(x.cumplimiento))),
        cero: c((x) => String(x.cumplimiento) === '0'),
        reprogramadas: c((x) => x.cumplimiento === 'reprogramada'),
        sin: c((x) => !tiene(x.cumplimiento)),
        noPlanificadas: np.length
      },
      importancia: imp
    };
  }

  /* ---------- piezas ---------- */
  const claseVal = (v) => ({ 'Muy buena': 'val-muybuena', Buena: 'val-buena', 'A mejorar': 'val-amejorar' }[v] || '');

  // Un comentario. El nombre del evaluador va siempre primero y en negrita.
  function feedback(e, modo) {
    const rol = [e.evaluador_rol, modo === 'evaluador' && e.es_mia ? 'vos' : ''].filter(Boolean).join(' · ');
    const fecha = e.publicada === false
      ? 'Borrador · todavía no lo ve la persona'
      : e.publicada_at ? `Publicado el ${ddmmTs(e.publicada_at)}` : '';
    const partes = (e.fortalezas || e.a_mejorar) ? `
      <div class="fb-partes">
        ${e.fortalezas ? `<div><span>Fortalezas</span><p>${esc(e.fortalezas)}</p></div>` : ''}
        ${e.a_mejorar ? `<div><span>A mejorar</span><p>${esc(e.a_mejorar)}</p></div>` : ''}
      </div>` : '';
    return `
    <article class="fb${e.publicada === false ? ' fb-borrador' : ''}">
      <div class="fb-cab">
        <span class="fb-de">De: ${esc(e.evaluador)}</span>
        ${rol ? `<span class="fb-rol">${esc(rol)}</span>` : ''}
        ${e.valoracion ? `<span class="chip ${claseVal(e.valoracion)}">${esc(e.valoracion)}</span>` : ''}
        <span class="fb-fecha">${esc(fecha)}</span>
      </div>
      ${e.comentario ? `<p class="fb-texto">${esc(e.comentario)}</p>` : ''}
      ${partes}
    </article>`;
  }

  function tendencia(semanas, lunes) {
    // Hasta 8 semanas con cumplimiento, terminando en la elegida
    const hasta = semanas.filter((s) => s.lunes <= lunes && s.cumplimiento !== null && s.cumplimiento !== undefined)
      .sort((a, b) => (a.lunes < b.lunes ? -1 : 1)).slice(-8);
    if (!hasta.length) return '<p class="nota">Todavía no hay semanas con cumplimiento cargado.</p>';
    const W = 640, base = 170, L = 40, esc1 = 1.4, slot = (W - L) / 8, bw = 44;
    const guias = [25, 50, 75, 100].map((k) => {
      const y = base - k * esc1;
      return `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="#EFE9DE"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#5B6363">${k}%</text>`;
    }).join('');
    const barras = hasta.map((s, i) => {
      const p = Math.max(0, Math.min(100, Number(s.cumplimiento)));
      const x = L + i * slot + (slot - bw) / 2, h = p * esc1, sel = s.lunes === lunes;
      return `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="4" fill="${colorPct(p)}" opacity="${sel ? 1 : 0.55}"/>
        <text x="${(x + bw / 2).toFixed(1)}" y="${(base - h - 6).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="${sel ? 700 : 600}" fill="#2B3436">${p}%</text>
        <text x="${(x + bw / 2).toFixed(1)}" y="${base + 20}" text-anchor="middle" font-size="12" font-weight="${sel ? 700 : 400}" fill="${sel ? '#2B3436' : '#5B6363'}">${ddmm(s.fecha_inicio)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} 210" role="img" aria-label="Cumplimiento de las últimas ${hasta.length} semanas">${guias}${barras}<line x1="${L}" x2="${W}" y1="${base}" y2="${base}" stroke="#CFC8BA"/></svg>`;
  }

  const fila = (et, val) => `<div class="fila-res"><span>${esc(et)}</span><strong>${val}</strong></div>`;

  /* ---------- pantalla completa (debajo del encabezado de cada app) ----------
     opciones:
       semanas       lista de semanas confirmadas (cargar_mis_semanas)
       lunes         lunes de la semana elegida (YYYY-MM-DD)
       semana        detalle de esa semana (cargar_semana): tareas, origen, confirmada_at, fechas
       evaluaciones  comentarios de esa semana
       jornada       horas semanales de la persona
       modo          'persona' | 'evaluador'
       enlaceSemana  (opcional) enlace a la semana completa */
  function vista(o) {
    const k = calcular(o.semana.tareas, o.jornada);
    // El cumplimiento de la semana sale de la base, así coincide con Mis semanas y con la tendencia.
    const deLista = (o.semanas || []).find((s) => s.lunes === o.lunes);
    if (deLista && deLista.cumplimiento !== null && deLista.cumplimiento !== undefined) k.cumplimiento = Number(deLista.cumplimiento);
    const ev = o.evaluaciones || [];
    const vacioFb = o.modo === 'evaluador'
      ? 'Nadie dio feedback para esta semana todavía.'
      : 'Todavía no hay feedback para esta semana. Cuando un evaluador lo publique, aparece acá con su nombre.';
    const kpi = (et, valor, det, extra = '') => `<div class="tarjeta kpi"><span class="et">${et}</span><span class="valor">${valor}</span><span class="det">${det}</span>${extra}</div>`;
    const pctCarga = Math.round(k.carga * 100);
    const imp = ['Alta', 'Media', 'Baja'].map((p) => {
      const x = k.importancia[p];
      return `<div class="imp"><span>${p}</span><span class="pista"><i style="width:${x.pct ?? 0}%;background:${colorPct(x.pct)}"></i></span><b>${x.pct === null ? '—' : x.pct + '%'}</b></div>`;
    }).join('');
    const sem = o.semana;
    const planif = sem.origen === 'excel'
      ? 'Cargada por Excel'
      : sem.confirmada_at ? `${diaTs(sem.confirmada_at).replace(/^./, (c) => c.toUpperCase())} ${ddmmTs(sem.confirmada_at)}` : '—';
    const aTiempo = sem.confirmada_at && sem.origen !== 'excel'
      ? (new Date(sem.confirmada_at) < aFecha(o.lunes) ? 'Sí' : 'No') : '—';
    const conCumpl = k.cant.planificadas - k.cant.sin;

    return `
    <section aria-label="Feedback de la semana"><div class="fb-lista">
      ${ev.length ? ev.map((e) => feedback(e, o.modo)).join('') : `<p class="sin-fb">${vacioFb}</p>`}
    </div></section>

    <section class="kpis" aria-label="Indicadores de la semana">
      ${kpi('Cumplimiento', k.cumplimiento === null ? '—' : k.cumplimiento + '%', 'ponderado por horas')}
      ${kpi('Carga planificada', `${fmt(k.horasPlan)} h`, `de ${fmt(k.jornada)} h semanales (${pctCarga}%)`,
        `<div class="medidor"><i style="width:${Math.min(100, pctCarga)}%"></i></div>`)}
      ${kpi('Precisión de la estimación', k.precision === null ? '—' : fmt(k.precision, 2),
        k.precision === null ? 'faltan horas reales' : `${fmt(k.hRealAmbas)} h reales para ${fmt(k.hPrevAmbas)} h previstas`)}
      ${kpi('No planificado', k.noPlan === null ? '—' : Math.round(k.noPlan * 100) + '%',
        k.noPlan === null ? 'faltan horas reales' : `${fmt(k.hRealNp)} h de ${fmt(k.hReal)} h reales`)}
    </section>

    <div class="des-grid">
      <section class="tarjeta bloque tend"><h2>Tendencia de cumplimiento</h2>
        <p class="nota">Últimas semanas con cumplimiento. La semana elegida, resaltada.</p>
        ${tendencia(o.semanas, o.lunes)}</section>
      <section class="tarjeta bloque"><h2>Semana del ${ddmm(sem.fecha_inicio)} al ${ddmm(sem.fecha_fin)}</h2>
        <div>
          ${fila('Cumplidas al 100%', k.cant.total)}
          ${fila('Cumplidas en parte', k.cant.parte)}
          ${fila('No cumplidas (0%)', k.cant.cero)}
          ${fila('Reprogramadas', k.cant.reprogramadas)}
          ${fila('Sin cumplimiento cargado', k.cant.sin)}
          ${fila('No planificadas agregadas', k.cant.noPlanificadas)}
        </div>
        ${o.enlaceSemana ? `<a href="${esc(o.enlaceSemana)}">Ver la semana completa</a>` : ''}</section>
    </div>

    <div class="des-grid">
      <section class="tarjeta bloque"><h2>Cumplimiento por importancia</h2>${imp}</section>
      <section class="tarjeta bloque"><h2>Puntualidad de la carga</h2>
        <div>
          ${fila('Planificación confirmada', esc(planif))}
          ${fila('Confirmada antes del lunes', aTiempo)}
          ${fila('Tareas con cumplimiento', `${conCumpl} de ${k.cant.planificadas}`)}
        </div></section>
    </div>`;
  }

  window.Desempeno = { calcular, vista, feedback, esc, ddmm };
})();
