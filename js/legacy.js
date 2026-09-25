// =====================================================================
// Migración única: lee los datos incrustados en los dashboards anteriores
//   · Planificación Semanal: <script id="embeddedState"> { allData: [...] }
//   · Histórico:             const EMBEDDED_WEEKS = [...]
// y los convierte en cargas para la misma función de sincronización.
// =====================================================================
import { semanaSugerida, areaDeArchivo, fechaISO } from './excel.js';

function extraerArrayJS(texto, marcador) {
  const i = texto.indexOf(marcador);
  if (i < 0) return null;
  const start = texto.indexOf('[', i);
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < texto.length; j++) {
    const c = texto[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return JSON.parse(texto.slice(start, j + 1)); }
  }
  return null;
}

function extraerEstadoSemanal(texto) {
  const m = texto.match(/<script[^>]*id="embeddedState"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { const st = JSON.parse(m[1].trim() || '{}'); return Array.isArray(st.allData) ? st.allData : null; } catch { return null; }
}

// Agrupa filas en cargas por archivo original (= semana + área)
function aCargas(grupos) {
  const cargas = [];
  for (const [clave, g] of grupos) {
    const contador = new Map();
    const filas = g.rows.map((r) => {
      const n = (contador.get(r.person) || 0) + 1; contador.set(r.person, n);
      return {
        hoja: r.person, persona: r.person, fila: n,
        fecha: fechaISO(r.fecha), fecha_texto: r.fecha || '',
        dia: r.dia || '', tarea: r.tarea1 || '',
        prioridad: r.prioridad || r.tarea2 || '',
        // en el Histórico, 0 significaba "sin dato"
        horas: r.horas === 0 || r.horas === '0' || r.horas === null || r.horas === undefined ? '' : String(r.horas),
        recursos: r.recursos || '', riesgos: r.riesgos || '', estado: r.estado || '',
      };
    }).filter((f) => [f.tarea, f.prioridad, f.horas, f.recursos, f.riesgos, f.estado].some((x) => x && x !== '-'));
    if (!filas.length) continue;
    cargas.push({
      archivo: g.filename, hash: null,
      area: g.area && g.area !== 'Sin área' ? g.area : areaDeArchivo(g.filename) || 'Sin área',
      semana: semanaSugerida(filas, g.filename), filas, clave,
    });
  }
  return cargas;
}

export async function leerDashboardAnterior(file) {
  const texto = await file.text();
  const weeks = extraerArrayJS(texto, 'EMBEDDED_WEEKS');
  if (weeks) {
    const grupos = new Map();
    weeks.forEach((w) => {
      const byArea = new Map();
      w.rows.forEach((r) => { if (!byArea.has(r.area)) byArea.set(r.area, []); byArea.get(r.area).push(r); });
      byArea.forEach((rows, area) => grupos.set(`${w.filename}|${area}`, { filename: w.filename, area, rows }));
    });
    return { tipo: 'Histórico', cargas: aCargas(grupos) };
  }
  const allData = extraerEstadoSemanal(texto);
  if (allData) {
    const grupos = new Map();
    allData.forEach((d) => {
      const k = `${d.filename}|${d.area}`;
      if (!grupos.has(k)) grupos.set(k, { filename: d.filename, area: d.area, rows: [] });
      d.rows.forEach((r) => grupos.get(k).rows.push({ ...r, person: d.person }));
    });
    return { tipo: 'Planificación Semanal', cargas: aCargas(grupos) };
  }
  throw new Error(`"${file.name}" no contiene datos de los dashboards anteriores.`);
}

// Une cargas de varios archivos: si la misma semana+área viene dos veces, gana la que tiene más filas
export function unirCargas(listas) {
  const m = new Map();
  listas.flat().forEach((c) => {
    const k = `${c.semana}|${c.area}`;
    if (!m.has(k) || m.get(k).filas.length < c.filas.length) m.set(k, c);
  });
  return [...m.values()].sort((a, b) => a.semana.localeCompare(b.semana) || a.area.localeCompare(b.area));
}
