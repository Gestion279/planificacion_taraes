(function () {
  'use strict';

  var D = window.DATOS;
  var COLORES = ['#4B5557', '#C88B58', '#6F8A5B', '#183158', '#C9962E', '#8C5E7A', '#3E7C8C', '#A35D3A'];
  var CLAVE = 'comparar-personas:v1';
  var PALABRAS_VACIAS = ['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'a', 'al', 'para', 'por', 'con', 'que', 'se', 'un', 'una'];

  // ---------- Estado ----------
  var estado = {
    personas: [],          // nombres elegidos, en orden
    accion: '',
    tarea: 'todas',        // 'todas' o clave de fila
    medida: 'horasSemana', // horasSemana | horasAcumuladas | semanas
    soloCompartidas: false,
    abierta: null
  };
  // Decisiones del usuario sobre agrupamientos (se guardan en el navegador).
  var decisiones = { confirmados: [], rechazados: [], uniones: [] };
  try {
    var guardado = JSON.parse(localStorage.getItem(CLAVE));
    if (guardado) decisiones = Object.assign(decisiones, guardado);
  } catch (e) { /* sin almacenamiento: se trabaja solo en memoria */ }
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(decisiones)); } catch (e) { /* nada */ }
  }

  // ---------- Utilidades ----------
  function fmt(n) { return n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ','); }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, hijos) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'texto') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (hijos || []).forEach(function (h) { if (h) n.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
    return n;
  }
  function colorDe(nombre) {
    var i = D.personas.findIndex(function (p) { return p.nombre === nombre; });
    return COLORES[i % COLORES.length];
  }
  function persona(nombre) { return D.personas.find(function (p) { return p.nombre === nombre; }) || { nombre: nombre }; }
  function horasAccion(nombre, accion) {
    var r = D.horasPorAccion.find(function (h) { return h.persona === nombre && h.accion === accion; });
    return r ? r.horasSemana : null;
  }

  // ---------- Detección de tareas iguales o parecidas ----------
  // Normaliza el detalle: minúsculas, sin acentos ni signos, sin palabras vacías,
  // y recorta cada palabra a 5 letras para que «Carga» y «Cargar» coincidan.
  function raices(texto) {
    var limpio = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ');
    var set = {};
    limpio.split(/\s+/).forEach(function (p) {
      if (p.length < 3 || PALABRAS_VACIAS.indexOf(p) >= 0) return;
      set[p.slice(0, 5)] = true;
    });
    return Object.keys(set);
  }
  function normal(texto) { return raices(texto).sort().join(' '); }
  // Parecidas: misma acción, distinta persona, comparten al menos 2 raíces
  // y esas raíces son al menos el 75 % de la tarea más corta.
  function parecidas(a, b) {
    if (a.accion !== b.accion || a.persona === b.persona) return false;
    var ra = raices(a.detalle), rb = raices(b.detalle);
    var comunes = ra.filter(function (r) { return rb.indexOf(r) >= 0; }).length;
    return comunes >= 2 && comunes / Math.min(ra.length, rb.length) >= 0.75;
  }

  function armarGrupos() {
    var padre = {};
    D.tareas.forEach(function (t) { padre[t.id] = t.id; });
    function raiz(x) { while (padre[x] !== x) x = padre[x] = padre[padre[x]]; return x; }
    function unir(a, b) { padre[raiz(a)] = raiz(b); }

    // 1. Grupos automáticos
    var auto = {};
    D.tareas.forEach(function (t) { auto[t.id] = t.id; });
    function raizA(x) { while (auto[x] !== x) x = auto[x] = auto[auto[x]]; return x; }
    D.tareas.forEach(function (a, i) {
      D.tareas.slice(i + 1).forEach(function (b) { if (parecidas(a, b) || (a.accion === b.accion && a.persona !== b.persona && normal(a.detalle) === normal(b.detalle))) auto[raizA(a.id)] = raizA(b.id); });
    });
    var porRaiz = {};
    D.tareas.forEach(function (t) { (porRaiz[raizA(t.id)] = porRaiz[raizA(t.id)] || []).push(t.id); });
    Object.keys(porRaiz).forEach(function (r) {
      var ids = porRaiz[r];
      if (ids.length < 2 || decisiones.rechazados.indexOf(ids.slice().sort().join('+')) >= 0) return;
      ids.slice(1).forEach(function (id) { unir(id, ids[0]); });
    });
    // 2. Uniones hechas a mano
    decisiones.uniones.forEach(function (u) { if (padre[u[0]] && padre[u[1]]) unir(u[0], u[1]); });

    var grupos = {};
    D.tareas.forEach(function (t) { (grupos[raiz(t.id)] = grupos[raiz(t.id)] || []).push(t); });
    return Object.keys(grupos).map(function (r) {
      var tareas = grupos[r];
      var clave = tareas.map(function (t) { return t.id; }).sort().join('+');
      var exacta = tareas.every(function (t) { return normal(t.detalle) === normal(tareas[0].detalle); });
      var manual = decisiones.uniones.some(function (u) { return tareas.some(function (t) { return t.id === u[0]; }); });
      var nombre = tareas.slice().sort(function (a, b) { return a.detalle.length - b.detalle.length; })[0].detalle;
      return {
        clave: clave, nombre: nombre, accion: tareas[0].accion, tareas: tareas,
        varias: tareas.length > 1,
        confirmada: tareas.length > 1 && (exacta || manual || decisiones.confirmados.indexOf(clave) >= 0),
        autoClave: clave
      };
    });
  }

  // ---------- Render ----------
  var MEDIDAS = [['horasSemana', 'Horas por semana'], ['horasAcumuladas', 'Horas acumuladas'], ['semanas', 'Semanas']];

  function acciones() {
    var tot = {};
    D.horasPorAccion.forEach(function (h) { tot[h.accion] = (tot[h.accion] || 0) + h.horasSemana; });
    D.tareas.forEach(function (t) { if (!(t.accion in tot)) tot[t.accion] = 0; });
    return Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a]; });
  }
  function hacenAccion(accion) {
    return D.personas.filter(function (p) { return horasAccion(p.nombre, accion) || D.tareas.some(function (t) { return t.persona === p.nombre && t.accion === accion; }); })
      .map(function (p) { return p.nombre; });
  }

  function renderChips() {
    var cont = $('chips');
    cont.textContent = '';
    estado.personas.forEach(function (n) {
      cont.appendChild(el('span', { class: 'chip' }, [
        el('span', { class: 'punto', style: 'background:' + colorDe(n), 'aria-hidden': 'true' }),
        n,
        el('button', { type: 'button', 'aria-label': 'Quitar a ' + n, onclick: function () {
          estado.personas = estado.personas.filter(function (x) { return x !== n; }); render();
        } }, [svgCruz()])
      ]));
    });
    var libres = D.personas.map(function (p) { return p.nombre; }).filter(function (n) { return estado.personas.indexOf(n) < 0; }).sort();
    if (libres.length) {
      var sel = el('select', { class: 'sel agregar', 'aria-label': 'Agregar persona', onchange: function (e) {
        if (e.target.value) { estado.personas.push(e.target.value); render(); }
      } }, [el('option', { value: '', texto: '+ Agregar persona' })].concat(libres.map(function (n) { return el('option', { value: n, texto: n }); })));
      cont.appendChild(sel);
    }
    $('rotulo-personas').textContent = 'Personas · ' + estado.personas.length + (estado.personas.length === 1 ? ' elegida' : ' elegidas');
    $('atajo-accion').textContent = 'Todas las que hacen ' + estado.accion + ' (' + hacenAccion(estado.accion).length + ')';
  }
  function svgCruz() {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('width', '12'); s.setAttribute('height', '12'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.5');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true');
    ['M6 6l12 12', 'M18 6L6 18'].forEach(function (d) { var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }

  function renderFiltros(filas) {
    var sa = $('sel-accion');
    sa.textContent = '';
    acciones().forEach(function (a) { sa.appendChild(el('option', { value: a, texto: a })); });
    sa.value = estado.accion;

    var st = $('sel-tarea');
    st.textContent = '';
    st.appendChild(el('option', { value: 'todas', texto: 'Todas las tareas de ' + estado.accion }));
    filas.forEach(function (f) { st.appendChild(el('option', { value: f.clave, texto: f.nombre })); });
    if (estado.tarea !== 'todas' && !filas.some(function (f) { return f.clave === estado.tarea; })) estado.tarea = 'todas';
    st.value = estado.tarea;

    var m = $('medidas');
    m.textContent = '';
    MEDIDAS.forEach(function (x) {
      m.appendChild(el('button', { type: 'button', 'aria-pressed': String(estado.medida === x[0]), texto: x[1], onclick: function () { estado.medida = x[0]; render(); } }));
    });
  }

  function renderResumen() {
    $('t-accion').textContent = estado.accion + ' en la semana de cada persona';
    var cont = $('resumen');
    cont.textContent = '';
    if (!estado.personas.length) { cont.appendChild(el('p', { class: 'vacio', texto: 'Agregá al menos una persona para comparar.' })); return; }
    var max = Math.max.apply(null, estado.personas.map(function (n) { return horasAccion(n, estado.accion) || 0; }).concat([1]));
    estado.personas.forEach(function (n) {
      var h = horasAccion(n, estado.accion), p = persona(n);
      var pct = h && p.horasSemana ? Math.round(h / p.horasSemana * 100) + ' % de su semana' : 'No planifica ' + estado.accion;
      cont.appendChild(el('div', { class: 'resumen-fila' }, [
        el('strong', { texto: n }),
        el('span', { class: 'pista', 'aria-hidden': 'true' }, [el('span', { style: 'width:' + ((h || 0) / max * 100).toFixed(1) + '%;background:' + colorDe(n) })]),
        el('strong', { texto: h ? fmt(h) + ' h' : '—' }),
        el('span', { class: 'tenue', texto: pct })
      ]));
    });
  }

  function valorCelda(tareas, medida) {
    if (!tareas.length) return null;
    var vals = tareas.map(function (t) { return t[medida]; }).filter(function (v) { return v != null; });
    if (!vals.length) return undefined;
    return medida === 'semanas' ? Math.max.apply(null, vals) : vals.reduce(function (s, v) { return s + v; }, 0);
  }
  function colorCelda(v, medida) {
    var k = medida === 'horasSemana' ? v : medida === 'horasAcumuladas' ? v / 12 : v / 1.6;
    return k >= 10 ? '#C88B58' : k >= 5 ? '#E0B48A' : k >= 2 ? '#EDD3B5' : '#F6EBDD';
  }

  function renderMatriz(filas) {
    var tabla = $('matriz');
    tabla.textContent = '';
    if (!estado.personas.length) return;
    var unidad = estado.medida === 'semanas' ? '' : ' h';
    tabla.appendChild(el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', texto: 'Tarea' })]
      .concat(estado.personas.map(function (n) { return el('th', { scope: 'col', texto: n }); }))
      .concat([el('th', { scope: 'col', texto: 'Diferencia' })]))]));
    var cuerpo = el('tbody');
    var visibles = filas.filter(function (f) {
      var quienes = f.tareas.filter(function (t) { return estado.personas.indexOf(t.persona) >= 0; });
      if (!quienes.length) return false;
      if (estado.tarea !== 'todas' && f.clave !== estado.tarea) return false;
      var distintas = {}; quienes.forEach(function (t) { distintas[t.persona] = 1; });
      return !estado.soloCompartidas || Object.keys(distintas).length > 1;
    });
    if (!visibles.length) {
      cuerpo.appendChild(el('tr', {}, [el('td', { colspan: String(estado.personas.length + 2), class: 'sin-dato', texto: 'Ninguna de las personas elegidas tiene tareas repetitivas de ' + estado.accion + (estado.soloCompartidas ? ' en común.' : '.') })]));
    }
    visibles.forEach(function (f) {
      var abierta = estado.abierta === f.clave;
      var hsem = [];
      var celdas = estado.personas.map(function (n) {
        var suyas = f.tareas.filter(function (t) { return t.persona === n; });
        var v = valorCelda(suyas, estado.medida);
        var hs = valorCelda(suyas, 'horasSemana');
        if (hs) hsem.push(hs);
        if (v === null) return el('td', { class: 'sin-dato', texto: '—' });
        if (v === undefined) return el('td', { class: 'sin-dato', texto: 'sin dato' });
        return el('td', { style: 'background:' + colorCelda(v, estado.medida) + ';font-weight:600', texto: fmt(v) + unidad });
      });
      var dif = hsem.length > 1 ? (Math.max.apply(null, hsem) / Math.min.apply(null, hsem)).toFixed(1).replace('.', ',') + ' veces' : '—';
      var etiqueta = f.varias ? el('span', { class: 'etiqueta ' + (f.confirmada ? 'confirmada' : 'parecida'), texto: f.confirmada ? 'Agrupada' : 'Parecidas · por confirmar' }) : null;
      var abrir = function () { estado.abierta = abierta ? null : f.clave; render(); };
      cuerpo.appendChild(el('tr', { class: 'fila' + (abierta ? ' abierta' : ''), onclick: abrir }, [
        el('td', {}, [el('button', { type: 'button', class: 'tarea', 'aria-expanded': String(abierta), onclick: function (e) { e.stopPropagation(); abrir(); } }, [f.nombre, etiqueta])])
      ].concat(celdas).concat([el('td', { class: 'dif', texto: dif })])));
    });
    tabla.appendChild(cuerpo);
  }

  function renderDetalle(filas) {
    var cont = $('detalle');
    cont.textContent = '';
    var f = filas.find(function (x) { return x.clave === estado.abierta; });
    if (!f) return;
    var caja = el('div', { class: 'detalle' }, [el('strong', { texto: f.nombre + ' · cómo la cargó cada uno' })]);
    f.tareas.forEach(function (t) {
      caja.appendChild(el('div', { class: 'detalle-fila' }, [
        el('strong', { texto: t.persona }),
        el('span', { texto: t.detalle }),
        el('span', { texto: (t.semanas != null ? t.semanas + ' semanas · ' : '') + fmt(t.horasSemana) + ' h/sem' })
      ]));
    });
    if (f.varias && !f.confirmada) {
      caja.appendChild(el('div', { class: 'decision' }, [
        el('span', { texto: 'Se juntaron por tener la misma acción y un detalle parecido. ¿Son la misma tarea?' }),
        el('button', { type: 'button', class: 'boton principal', texto: 'Sí, compararlas juntas', onclick: function () { decisiones.confirmados.push(f.clave); guardar(); render(); } }),
        el('button', { type: 'button', class: 'boton', texto: 'No, separar', onclick: function () {
          decisiones.rechazados.push(f.clave); estado.abierta = null; guardar(); render();
        } })
      ]));
    }
    var candidatas = D.tareas.filter(function (t) { return t.accion === f.accion && !f.tareas.some(function (x) { return x.id === t.id; }); });
    if (candidatas.length) {
      var sel = el('select', { class: 'sel', 'aria-label': 'Tarea para sumar' }, [el('option', { value: '', texto: 'Elegir una tarea de ' + f.accion })]
        .concat(candidatas.map(function (t) { return el('option', { value: t.id, texto: t.persona + ': ' + t.detalle }); })));
      caja.appendChild(el('div', { class: 'sumar' }, [
        el('span', { class: 'tenue', texto: 'Sumar una tarea equivalente cargada con otras palabras:' }),
        sel,
        el('button', { type: 'button', class: 'boton punteado', texto: '+ Sumar a esta fila', onclick: function () {
          if (!sel.value) return;
          decisiones.uniones.push([sel.value, f.tareas[0].id]); guardar();
          estado.abierta = null; render();
          var nueva = armarGrupos().find(function (g) { return g.tareas.some(function (t) { return t.id === sel.value; }); });
          if (nueva) { estado.abierta = nueva.clave; render(); }
        } })
      ]));
    }
    cont.appendChild(caja);
  }

  function render() {
    var filas = armarGrupos().filter(function (g) { return g.accion === estado.accion; })
      .sort(function (a, b) { return b.tareas.length - a.tareas.length || a.nombre.localeCompare(b.nombre); });
    renderFiltros(filas);
    renderChips();
    renderResumen();
    renderMatriz(filas);
    renderDetalle(filas);
  }

  // ---------- Eventos ----------
  $('sel-accion').addEventListener('change', function (e) { estado.accion = e.target.value; estado.tarea = 'todas'; estado.abierta = null; render(); });
  $('sel-tarea').addEventListener('change', function (e) { estado.tarea = e.target.value; render(); });
  $('solo-compartidas').addEventListener('change', function (e) { estado.soloCompartidas = e.target.checked; render(); });
  $('atajo-accion').addEventListener('click', function () { estado.personas = hacenAccion(estado.accion); render(); });
  $('atajo-compartidas').addEventListener('click', function () {
    var set = {};
    armarGrupos().forEach(function (g) {
      if (g.accion !== estado.accion) return;
      var p = {}; g.tareas.forEach(function (t) { p[t.persona] = 1; });
      if (Object.keys(p).length > 1) Object.keys(p).forEach(function (n) { set[n] = 1; });
    });
    estado.personas = Object.keys(set); render();
  });
  $('atajo-ninguna').addEventListener('click', function () { estado.personas = []; render(); });

  // ---------- Inicio ----------
  $('periodo').textContent = D.periodo;
  estado.accion = acciones()[0];
  var conTareas = {};
  D.tareas.forEach(function (t) { if (t.accion === estado.accion) conTareas[t.persona] = 1; });
  estado.personas = Object.keys(conTareas);
  render();
})();
