-- =========================================================
-- 010 · Área de la actividad en el cuadro de carga
--   Criterio único para toda la aplicación: el área de una
--   actividad es la del Excel donde se cargó (planificacion.area_id),
--   no la de la ficha de la persona.
--   Antes esta vista usaba personas.area_id, mientras que
--   v_actividades usa planificacion.area_id; con un filtro de área,
--   el cuadro de carga y los indicadores contaban personas distintas.
--   Una persona que aparece en el Excel de dos áreas la misma semana
--   tiene una fila por área.
-- =========================================================
create or replace view public.v_persona_semana with (security_invoker = true) as
select p.semana_id, s.fecha_inicio as semana_inicio,
       p.persona_id, pe.nombre as persona, a.nombre as area,
       count(*) as actividades
from public.planificacion p
join public.semanas  s  on s.id  = p.semana_id
join public.personas pe on pe.id = p.persona_id
join public.areas    a  on a.id  = p.area_id
where p.vigente
group by p.semana_id, s.fecha_inicio, p.persona_id, pe.nombre, a.nombre;

grant select on public.v_persona_semana to anon, authenticated;
