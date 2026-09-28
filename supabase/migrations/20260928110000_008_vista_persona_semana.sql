-- =========================================================
-- 008 · Planificación cargada por persona y semana
--   Una fila por persona y semana con actividades vigentes.
--   Alimenta el cuadro de cumplimiento de carga del Resumen
--   sin traer todas las actividades de todas las semanas.
-- =========================================================
create or replace view public.v_persona_semana with (security_invoker = true) as
select p.semana_id, s.fecha_inicio as semana_inicio,
       p.persona_id, pe.nombre as persona, coalesce(a.nombre, '') as area,
       count(*) as actividades
from public.planificacion p
join public.semanas  s  on s.id  = p.semana_id
join public.personas pe on pe.id = p.persona_id
left join public.areas a on a.id = pe.area_id
where p.vigente
group by p.semana_id, s.fecha_inicio, p.persona_id, pe.nombre, a.nombre;

grant select on public.v_persona_semana to anon, authenticated;
