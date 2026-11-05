-- =========================================================
-- 011 · Fecha de alta de cada persona
--   El cumplimiento de carga (semanas con planificación) se mide
--   desde la semana del alta, no desde la semana 1: una persona
--   que se incorpora en la semana 24 no arranca con 1/24 = 4 %.
--
--   · Altas nuevas (desde Excel o desde Carga semanal): se completa
--     sola con el lunes siguiente al alta (si es lunes, ese mismo día).
--   · Se puede corregir a mano desde el Table Editor de Supabase;
--     cualquier día de la semana vale, se toma el lunes de esa semana.
--   · Vacía (personas anteriores): se mide desde la semana 1, como antes.
--   · Si alguien planificó antes de su fecha de alta, se cuenta desde
--     esa primera planificación, para no perder semanas cargadas.
-- =========================================================
alter table public.personas add column if not exists fecha_alta date;

alter table public.personas alter column fecha_alta set default (
  (now() at time zone 'America/Argentina/Buenos_Aires')::date
  + ((8 - extract(isodow from (now() at time zone 'America/Argentina/Buenos_Aires'))::int) % 7)
);

comment on column public.personas.fecha_alta is
  'Desde qué semana se le exige planificación (se toma el lunes de esa semana). Vacía: desde la primera semana registrada.';

-- Personas dadas de alta después de la carga inicial del 25/09/2026 (hoy: Melisa Mora → 09/11/2026)
update public.personas pe
set fecha_alta = d.fecha + ((8 - extract(isodow from d.fecha)::int) % 7)
from (select id, (created_at at time zone 'America/Argentina/Buenos_Aires')::date as fecha from public.personas) d
where d.id = pe.id
  and pe.fecha_alta is null
  and d.fecha > date '2026-09-26';
