// =====================================================================
// Situaciones de la semana seleccionada (compartido por Resumen, Riesgos y auditoría
// y Propuestas de mejora). Reúne el contexto que necesita el motor y lo guarda en
// caché por semana y filtros, para no recalcular al pasar de una hoja a otra.
// =====================================================================
import { hallazgos, coberturaCarga, cargaFueraDeTermino, hoyISO } from './engine.js';

let cache = { clave: null, valor: null };

export async function situacionesSemana(app) {
  const clave = JSON.stringify([app.semana?.id, app.filtros, app.propuestas.length, app.propuestas.map((p) => p.updated_at).join()]);
  if (cache.clave === clave) return cache.valor;
  // historial: 8 semanas anteriores a la seleccionada (riesgos que se repiten, tareas abiertas, repetitivas)
  const periodo = app.semanasDePeriodo({ tipo: 'n', n: 9 });
  const { rows } = await app.filasDe(periodo);
  const historico = rows.filter((r) => r.semana !== app.semana.inicio);
  const cobertura = coberturaCarga(app.filas, app.personaSemana.filter((r) => r.semana < app.semana.inicio && app.pasa(r)));
  const areas = app.filtros.areas;
  const fuera = cargaFueraDeTermino(app.importaciones, app.semana.inicio).filter((f) => !areas.length || areas.includes(f.area));
  const valor = {
    lista: hallazgos({ rows: app.filas, historico, cambios: app.cambiosSemana, cobertura, fueraDeTermino: app.filtros.personas.length ? [] : fuera,
      semana: app.semana.inicio, hoy: hoyISO(), propuestas: app.propuestas }),
    cobertura, historico, rango: rows,
  };
  cache = { clave, valor };
  return valor;
}
export function olvidarSituaciones() { cache = { clave: null, valor: null }; }
