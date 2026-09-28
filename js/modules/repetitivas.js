import { prepararPeriodo } from './periodo.js';

export const titulo = 'Tareas repetitivas';

export async function render(el, app) {
  const { rows, cont, n } = await prepararPeriodo(el, app, {
    titulo,
    alCambiar: () => render(el, app),
  });
  if (!rows.length) return;
  cont.innerHTML = `<p class="panel">${rows.length} actividades en ${n} ${n === 1 ? 'semana' : 'semanas'}. El análisis de tareas repetitivas todavía no está disponible.</p>`;
}

