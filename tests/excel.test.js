// Pruebas del lector de Excel con un libro armado en memoria
import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { leerArchivo } from '../js/excel.js';

function libro(nombreArchivo, filas, { formatoHora = false } = {}) {
  const wb = XLSX.utils.book_new();
  const aoa = [['Persona', 'Ana Test'], ['FECHA', 'DÍA', 'TAREA', 'IMPORTANCIA', 'TIEMPO', 'Recursos', 'Riesgos', 'Estado'], ...filas];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  if (formatoHora) ws['E3'].z = 'h:mm';
  XLSX.utils.book_append_sheet(wb, ws, 'Ana');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: nombreArchivo, arrayBuffer: async () => buf };
}
const d = (iso) => new Date(`${iso}T00:00:00Z`);

test('lee persona de B1, semana y área del archivo', async () => {
  const r = await leerArchivo(libro('Resumen Planificación Gestión del 18-09.xlsx', [[d('2026-09-21'), 'LUNES', 'Informe', 'ALTA', 2, 'Excel', '', '']]), XLSX);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].persona, 'Ana Test');
  assert.equal(r.filas[0].fecha, '2026-09-21');
  assert.equal(r.semanaSugerida, '2026-09-21');
  assert.equal(r.areaSugerida, 'Gestión');
  assert.equal(r.filas[0].horas, '2');
});

test('hora de Excel guardada como número (1/24) se convierte a 1 h y avisa', async () => {
  const r = await leerArchivo(libro('x.xlsx', [[d('2026-09-21'), 'LUNES', 'Tarea', 'ALTA', 1 / 24, '', '', '']]), XLSX);
  assert.equal(r.filas[0].horas, '1');
  assert.ok(r.advertencias.some((a) => a.includes('hora de Excel')));
});

test('celda con formato h:mm llega como "1:30" (la base lo interpreta como 1,5 h) y sin aviso', async () => {
  const r = await leerArchivo(libro('x.xlsx', [[d('2026-09-21'), 'LUNES', 'Tarea', 'ALTA', 1.5 / 24, '', '', '']], { formatoHora: true }), XLSX);
  assert.ok(['1.5', '1:30'].includes(r.filas[0].horas));
  assert.ok(!r.advertencias.some((a) => a.includes('hora de Excel')));
});

test('decimales cortos escritos a mano no se tocan', async () => {
  const r = await leerArchivo(libro('x.xlsx', [[d('2026-09-21'), 'LUNES', 'Tarea', 'ALTA', 0.5, '', '', ''], [d('2026-09-21'), 'LUNES', 'Otra', 'ALTA', 0.08, '', '', '']]), XLSX);
  assert.deepEqual(r.filas.map((f) => f.horas), ['0.5', '0.08']);
});

test('filas vacías de plantilla se omiten', async () => {
  const r = await leerArchivo(libro('x.xlsx', [[d('2026-09-21'), 'LUNES', '', '', '', '', '', '']]), XLSX);
  assert.equal(r.filas.length, 0);
});
