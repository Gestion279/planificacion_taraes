-- =========================================================
-- 005 · Vistas de lectura para la aplicación
--   security_invoker: respetan RLS del usuario que consulta
-- =========================================================

-- Primera carga de cada semana + área (define qué es "plan original")
create or replace view public.v_primera_carga with (security_invoker = true) as
select distinct on (semana_id, area_id) semana_id, area_id, id as importacion_id, created_at
from public.importaciones
order by semana_id, area_id, created_at;

-- Actividades vigentes, listas para analizar
create or replace view public.v_actividades with (security_invoker = true) as
select p.id, p.semana_id, s.fecha_inicio as semana_inicio,
       p.persona_id, pe.nombre as persona, p.area_id, a.nombre as area,
       p.fecha, p.dia, p.tarea, p.tarea_norm, p.ordinal, p.prioridad,
       p.horas_planificadas, p.horas_reales, p.recursos, p.riesgos, p.estado,
       p.riesgo_prob, p.riesgo_impacto, p.hoja, p.fila_excel,
       (pc.importacion_id is not null and p.importacion_alta_id <> pc.importacion_id) as alta_posterior,
       p.updated_at
from public.planificacion p
join public.semanas  s  on s.id  = p.semana_id
join public.personas pe on pe.id = p.persona_id
join public.areas    a  on a.id  = p.area_id
left join public.v_primera_carga pc on pc.semana_id = p.semana_id and pc.area_id = p.area_id
where p.vigente;

-- Cambios posteriores a la primera carga (estabilidad de la planificación)
create or replace view public.v_cambios with (security_invoker = true) as
select h.id, h.created_at, h.tipo, h.campo, h.valor_anterior, h.valor_nuevo, h.origen,
       p.id as planificacion_id, p.semana_id, s.fecha_inicio as semana_inicio,
       p.persona_id, pe.nombre as persona, a.nombre as area, p.tarea, p.fecha
from public.historial_planificacion h
join public.planificacion p on p.id = h.planificacion_id
join public.semanas  s  on s.id  = p.semana_id
join public.personas pe on pe.id = p.persona_id
join public.areas    a  on a.id  = p.area_id
left join public.v_primera_carga pc on pc.semana_id = p.semana_id and pc.area_id = p.area_id
where not (h.tipo = 'alta' and h.importacion_id is not distinct from pc.importacion_id);

-- Semanas con actividades (para el selector)
create or replace view public.v_semanas with (security_invoker = true) as
select s.id, s.fecha_inicio, s.fecha_fin, s.estado, s.ultima_carga,
       count(p.id) filter (where p.vigente) as actividades
from public.semanas s
left join public.planificacion p on p.semana_id = s.id
group by s.id;

grant select on public.v_primera_carga, public.v_actividades, public.v_cambios, public.v_semanas to authenticated;
revoke all on public.v_primera_carga, public.v_actividades, public.v_cambios, public.v_semanas from anon;
