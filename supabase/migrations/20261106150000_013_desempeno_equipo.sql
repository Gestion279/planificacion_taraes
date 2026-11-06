-- =====================================================================
-- Hoja Desempeño del informe · vista general (todas las personas)
-- Solo agrega una función de lectura. No modifica tablas ni datos.
-- Ejecutar en el SQL Editor de Supabase ANTES de subir el módulo nuevo.
-- =====================================================================

create or replace function public.informe_desempeno_equipo(p_correo text, p_lunes date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  ev public.personas;
  v_lunes date;
  v_sem uuid;
  v_hoy date := (date_trunc('week', current_date))::date;   -- lunes de esta semana
begin
  ev := public._evaluador(p_correo);

  -- Semana elegida; si no viene, la última ya terminada con planificación (o la más reciente).
  v_lunes := p_lunes;
  if v_lunes is null then
    select max(s.fecha_inicio) into v_lunes
    from public.semanas s
    where s.fecha_inicio < v_hoy
      and exists (select 1 from public.planificacion pl join public.personas p on p.id = pl.persona_id
                  where pl.semana_id = s.id and pl.vigente and p.activo and p.area_id is distinct from 3);
  end if;
  if v_lunes is null then
    select max(s.fecha_inicio) into v_lunes
    from public.semanas s
    where exists (select 1 from public.planificacion pl where pl.semana_id = s.id and pl.vigente);
  end if;
  select id into v_sem from public.semanas where fecha_inicio = v_lunes;

  return jsonb_build_object(
    'lunes', v_lunes,

    -- Tendencia: por semana y área, numerador y denominador del cumplimiento ponderado
    -- (mismo criterio que cargar_mis_semanas). La app suma según el filtro de área.
    'tendencia', coalesce((
      select jsonb_agg(x order by x.lunes desc, x.area)
      from (
        select s.fecha_inicio as lunes, a.nombre as area,
               count(distinct pl.persona_id) as personas,
               coalesce(sum(pl.cumplimiento::numeric * coalesce(pl.horas_planificadas, pl.horas_reales, 1))
                 filter (where pl.cumplimiento ~ '^[0-9]+$'), 0) as num,
               coalesce(sum(coalesce(pl.horas_planificadas, pl.horas_reales, 1))
                 filter (where pl.cumplimiento ~ '^[0-9]+$'), 0) as den
        from public.semanas s
        join public.planificacion pl on pl.semana_id = s.id and pl.vigente
        join public.personas p on p.id = pl.persona_id and p.activo and p.area_id is distinct from 3
        left join public.areas a on a.id = p.area_id
        group by s.fecha_inicio, a.nombre
      ) x), '[]'::jsonb),

    -- Todas las personas evaluables, con su planificación de la semana elegida (o sin ella)
    'personas', coalesce((
      select jsonb_agg(x order by x.nombre)
      from (
        select p.id, p.nombre, a.nombre as area, p.jornada_horas,
               count(pl.id) as tareas,
               coalesce(sum(pl.horas_planificadas) filter (where not coalesce(pl.no_planificada, false)), 0) as horas,
               count(pl.id) filter (where pl.cumplimiento is null and not coalesce(pl.no_planificada, false)) as sin_cumplimiento,
               round(sum(pl.cumplimiento::numeric * coalesce(pl.horas_planificadas, pl.horas_reales, 1))
                 filter (where pl.cumplimiento ~ '^[0-9]+$')
                 / nullif(sum(coalesce(pl.horas_planificadas, pl.horas_reales, 1))
                 filter (where pl.cumplimiento ~ '^[0-9]+$'), 0)) as cumplimiento,
               (select c.confirmada_at from public.planificacion_confirmaciones c
                 where c.persona_id = p.id and c.semana_id = v_sem) as confirmada_at
        from public.personas p
        left join public.areas a on a.id = p.area_id
        left join public.planificacion pl on pl.persona_id = p.id and pl.semana_id = v_sem and pl.vigente
        where p.activo and p.area_id is distinct from 3
        group by p.id, p.nombre, a.nombre, p.jornada_horas
      ) x), '[]'::jsonb),

    -- Tareas de la semana elegida (solo los campos que usan los indicadores)
    'tareas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'persona_id', pl.persona_id, 'area', a.nombre, 'prioridad', pl.prioridad,
        'horas_planificadas', pl.horas_planificadas, 'horas_reales', pl.horas_reales,
        'cumplimiento', pl.cumplimiento, 'no_planificada', coalesce(pl.no_planificada, false)))
      from public.planificacion pl
      join public.personas p on p.id = pl.persona_id and p.activo and p.area_id is distinct from 3
      left join public.areas a on a.id = p.area_id
      where pl.semana_id = v_sem and pl.vigente), '[]'::jsonb),

    -- Feedback de la semana elegida, de todos los evaluadores y para todas las personas
    'evaluaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'persona_id', e.persona_id, 'persona', p.nombre, 'area', a.nombre,
        'semana_inicio', v_lunes,
        'evaluador_id', e.evaluador_id, 'evaluador', evp.nombre, 'es_mia', e.evaluador_id = ev.id,
        'evaluador_rol', case when evp.area_id = 3 then 'Gerencia' when evp.es_admin then 'Administrador' end,
        'valoracion', e.valoracion, 'fortalezas', e.fortalezas, 'a_mejorar', e.a_mejorar,
        'comentario', e.comentario, 'publicada', e.publicada,
        'publicada_at', e.publicada_at, 'updated_at', e.updated_at) order by p.nombre, evp.nombre)
      from public.evaluaciones_semana e
      join public.personas p   on p.id   = e.persona_id
      left join public.areas a on a.id  = p.area_id
      join public.personas evp on evp.id = e.evaluador_id
      where e.semana_id = v_sem), '[]'::jsonb)
  );
end $$;
