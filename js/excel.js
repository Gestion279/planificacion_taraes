// =====================================================================
// Lectura del Excel semanal (mismo formato que usan hoy los usuarios)
//   · una hoja por persona · persona en la celda B1
//   · columnas A–H: Fecha, Día, Tarea, Importancia, Tiempo, Recursos, Riesgos, Estado
// El archivo solo se LEE acá; toda la lógica de sincronización está en Supabase.
// =====================================================================
import { lunesDe, addDays, norm } from './engine.js';

const HEADERS = {
  dia: ['dia', 'diadelasemana'],
  tarea: ['tarea', 'tarea1', 'actividad', 'actividades', 'tareaprincipal'],
  prioridad: ['importancia', 'prioridad', 'nivelprioridad', 'nivelimportancia'],
  horas: ['tiempo', 'horas', 'hs', 'horasplanificadas', 'tiempoestimado'],
  recursos: ['recursos', 'recurso', 'recursosnecesarios'],
  riesgos: ['riesgos', 'riesgo', 'riesgosproblemas', 'problemas'],
  estado: ['estado', 'status', 'cumplimiento'],
};
const FIJAS = { dia: 1, tarea: 2, prioridad: 3, horas: 4, recursos: 5, riesgos: 6, estado: 7 }; // A=0 fecha

const key = (s) => norm(s).replace(/ /g, '');
function campoDeEncabezado(h) {
  const k = key(h);
  if (!k) return null;
  for (const [campo, alias] of Object.entries(HEADERS)) if (alias.includes(k)) return campo;
  for (const [campo, alias] of Object.entries(HEADERS)) if (alias.some((a) => a.length > 3 && k.startsWith(a))) return campo;
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
export function fechaISO(v) {
  if (v instanceof Date && !isNaN(v)) {
    // +12 h: cubre fechas creadas a medianoche local o UTC sin correr el día en ningún huso horario
    const d = new Date(v.getTime() + 12 * 3600000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return dt.toISOString().slice(0, 10);
  }
  const s = (v ?? '').toString().trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (+y < 50 ? '20' : '19') + y;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return null;
}

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

function leerHoja(ws, nombreHoja, XLSX) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const aoaRaw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (!aoa.length) return null;
  const persona = txt(aoa[0] && aoa[0][1]) || nombreHoja.trim();

  // Encabezados: primera fila (de las 12 primeras) con al menos 2 columnas reconocidas.
  let inicio = 1, cols = { ...FIJAS }, detectado = false;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const map = {};
    (aoa[i] || []).forEach((c, ci) => { const f = campoDeEncabezado(c); if (f && map[f] === undefined) map[f] = ci; });
    if (Object.keys(map).length >= 2) { cols = { ...FIJAS, ...map }; inicio = i + 1; detectado = true; break; }
  }

  const filas = [];
  for (let r = inicio; r < aoa.length; r++) {
    const row = aoa[r] || [], raw = aoaRaw[r] || [];
    const g = (c) => txt(row[cols[c]]);
    const f0 = txt(row[0]);
    if (key(f0) === 'fecha') continue;
    const fila = {
      hoja: nombreHoja, persona, fila: r + 1,
      fecha: fechaISO(raw[0] !== '' && raw[0] !== undefined ? raw[0] : row[0]) || fechaISO(row[0]),
      fecha_texto: f0,
      dia: g('dia'), tarea: g('tarea'), prioridad: g('prioridad'), horas: g('horas'),
      recursos: g('recursos'), riesgos: g('riesgos'), estado: g('estado'),
    };
    const contenido = [fila.tarea, fila.prioridad, fila.horas, fila.recursos, fila.riesgos, fila.estado].some((x) => x && x !== '-');
    if (!contenido) continue; // filas de plantilla vacías
    filas.push(fila);
  }
  return { hoja: nombreHoja, persona, filas, encabezadosDetectados: detectado };
}

export async function leerArchivo(file, XLSX = globalThis.XLSX) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const hojas = wb.SheetNames.map((n) => leerHoja(wb.Sheets[n], n, XLSX)).filter((h) => h && h.filas.length);
  const filas = hojas.flatMap((h) => h.filas);
  const advertencias = [];
  const sinFilas = wb.SheetNames.length - hojas.length;
  if (sinFilas > 0) advertencias.push(`${sinFilas} hoja(s) sin actividades se omitieron.`);
  if (!filas.length) advertencias.push('No se encontraron actividades. Verificá que cada hoja tenga la persona en B1 y las columnas Fecha a Estado.');
  const nombres = new Map();
  hojas.forEach((h) => { const k = key(h.persona); nombres.set(k, (nombres.get(k) || 0) + 1); });
  [...nombres].filter(([, n]) => n > 1).forEach(([k]) => advertencias.push(`La persona "${hojas.find((h) => key(h.persona) === k).persona}" aparece en más de una hoja; se unifican.`));
  return {
    archivo: file.name,
    hash: await sha256(buf),
    hojas: hojas.map((h) => ({ hoja: h.hoja, persona: h.persona, actividades: h.filas.length })),
    filas,
    semanaSugerida: semanaSugerida(filas, file.name),
    areaSugerida: areaDeArchivo(file.name),
    advertencias,
  };
}

// Semana = lunes más frecuente entre las fechas de las filas.
// Si no hay fechas, se usa el "del DD-MM" del nombre (viernes de preparación → lunes siguiente).
export function semanaSugerida(filas, nombre = '') {
  const cnt = new Map();
  filas.forEach((f) => { if (f.fecha) { const l = lunesDe(f.fecha); cnt.set(l, (cnt.get(l) || 0) + 1); } });
  if (cnt.size) return [...cnt].sort((a, b) => b[1] - a[1])[0][0];
  const m = nombre.match(/del[_\s]?(\d{1,2})[-_.](\d{1,2})/i);
  if (m) {
    const y = new Date().getFullYear();
    const iso = `${y}-${pad(m[2])}-${pad(m[1])}`;
    return lunesDe(addDays(iso, 3));
  }
  return lunesDe(new Date().toISOString().slice(0, 10));
}

export function areaDeArchivo(nombre) {
  const n = norm(nombre);
  if (n.includes('gestion')) return 'Gestión';
  if (n.includes('produccion')) return 'Producción';
  return '';
}

export function armarPayload({ archivo, hash, area, semana, filas, origen = 'app' }) {
  return { archivo, archivo_hash: hash, area, semana_inicio: semana, origen, filas };
}

async function sha256(buf) {
  if (!globalThis.crypto?.subtle) return null;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
