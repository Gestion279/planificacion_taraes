-- 1) Tabla de nombres para los grupos de tareas similares
create table if not exists public.tareas_similares (
  grupo_clave text primary key,
  nombre text not null check (length(btrim(nombre)) > 0),
  nota text,
  cargado_por text,
  updated_at timestamptz not null default now()
);
alter table public.tareas_similares enable row level security;
drop policy if exists lectura_publica on public.tareas_similares;
create policy lectura_publica on public.tareas_similares for select to anon, authenticated using (true);

create or replace function public.guardar_tarea_similar(p_grupo_clave text, p_nombre text, p_nota text default null,
  p_clave text default null, p_cargado_por text default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  perform public._verificar_clave(p_clave);
  if nullif(btrim(p_nombre),'') is null then
    delete from public.tareas_similares where grupo_clave = p_grupo_clave;
  else
    insert into public.tareas_similares (grupo_clave, nombre, nota, cargado_por, updated_at)
    values (p_grupo_clave, btrim(p_nombre), nullif(btrim(p_nota),''), nullif(btrim(p_cargado_por),''), now())
    on conflict (grupo_clave) do update set nombre = excluded.nombre, nota = excluded.nota,
      cargado_por = excluded.cargado_por, updated_at = now();
  end if;
end $$;

insert into public.tareas_similares (grupo_clave, nombre, cargado_por) values
  ('F:correo','Gestión de correo','inicial'),
  ('F:cobranza','Gestión de cobranzas','inicial'),
  ('24:pedir pago','Solicitar pagos a proveedores','inicial'),
  ('10:mant edificios','Mantenimiento de edificios (por CC)','inicial'),
  ('10:mant telefonica','Mantenimiento Telefónica (por región)','inicial'),
  ('4:gestion compra','Gestión de compras','inicial'),
  ('20:banos ypf','Presupuestos obras Baños YPF','inicial'),
  ('22:banos ypf','Registro de ingresos obras Baños YPF','inicial'),
  ('14:analisis presupuestos','Análisis de presupuestos de obra','inicial'),
  ('7:check herramientas','Control de herramientas de obra','inicial'),
  ('20:cot compra','Cotización de compras de obra','inicial'),
  ('7:rend fuera','Rendiciones fuera de sistema','inicial'),
  ('3:certificar eventual','Certificar eventuales','inicial')
on conflict (grupo_clave) do nothing;

-- 2) Vista de detalle con nombre personalizado
create or replace view public.v_tareas_similares with (security_invoker = true) as
select p.id, p.persona_id, p.area_id, p.semana_id, s.fecha_inicio as semana_inicio, p.fecha,
       p.tarea, p.accion_id, p.prioridad, p.horas_planificadas,
       g.clave as grupo_clave,
       coalesce(ts.nombre,
         case g.clave when 'F:correo' then 'Gestión de correo' when 'F:cobranza' then 'Gestión de cobranzas'
           else coalesce(a.nombre,'Sin acción')||': '||initcap(split_part(g.clave,':',2)) end) as grupo_nombre
from public.planificacion p
join public.semanas s on s.id = p.semana_id
left join public.acciones a on a.id = p.accion_id
cross join lateral (select public.tarea_grupo_clave(p.tarea, p.accion_id) as clave) g
left join public.tareas_similares ts on ts.grupo_clave = g.clave
where p.vigente and coalesce(p.tarea,'') <> '';

-- 3) v_actividades: dos columnas nuevas al final
create or replace view public.v_actividades with (security_invoker = true) as
 SELECT p.id, p.semana_id, s.fecha_inicio AS semana_inicio, p.persona_id, pe.nombre AS persona,
    p.area_id, a.nombre AS area, p.fecha, p.dia, p.tarea, p.tarea_norm, p.ordinal, p.prioridad,
    p.horas_planificadas, p.horas_reales, p.recursos, p.riesgos, p.estado, p.riesgo_prob, p.riesgo_impacto,
    p.hoja, p.fila_excel,
    CASE WHEN p.origen = 'app'::text THEN p.no_planificada
         ELSE (pc.importacion_id IS NOT NULL AND p.importacion_alta_id <> pc.importacion_id) END AS alta_posterior,
    p.updated_at, pe.jornada_horas AS jornada, ac.nombre AS accion, p.accion_auto, p.detalle,
    p.cumplimiento, p.no_planificada, p.origen,
    g.clave AS grupo_clave,
    coalesce(ts.nombre,
      CASE g.clave WHEN 'F:correo' THEN 'Gestión de correo' WHEN 'F:cobranza' THEN 'Gestión de cobranzas'
        ELSE coalesce(ac.nombre,'Sin acción')||': '||initcap(split_part(g.clave,':',2)) END) AS grupo_nombre
   FROM planificacion p
     JOIN semanas s ON s.id = p.semana_id
     JOIN personas pe ON pe.id = p.persona_id
     JOIN areas a ON a.id = p.area_id
     LEFT JOIN v_primera_carga pc ON pc.semana_id = p.semana_id AND pc.area_id = p.area_id
     LEFT JOIN acciones ac ON ac.id = p.accion_id
     CROSS JOIN LATERAL (SELECT public.tarea_grupo_clave(p.tarea, p.accion_id) AS clave) g
     LEFT JOIN public.tareas_similares ts ON ts.grupo_clave = g.clave
  WHERE p.vigente;

-- 4) Resumen por persona para un período
create or replace function public.resumen_tareas_similares(p_desde date, p_hasta date)
returns table (persona_id uuid, persona text, area text, lineas bigint, tareas_similares bigint,
               lineas_similares bigint, pct_tareas_similares numeric, horas numeric, pct_horas_similares numeric)
language sql stable security invoker set search_path to '' as $$
  with base as (
    select v.persona_id, v.semana_id, v.grupo_clave,
           coalesce(nullif(p.tarea_norm,''), lower(btrim(v.tarea))) as txt,
           coalesce(v.horas_planificadas,0) as h
    from public.v_tareas_similares v
    join public.planificacion p on p.id = v.id
    where v.semana_inicio between p_desde and p_hasta
  ), grp as (
    select persona_id, semana_id, grupo_clave, count(distinct txt) as nv, sum(h) as hh
    from base group by 1,2,3
  )
  select g.persona_id, pe.nombre, a.nombre,
         sum(g.nv)::bigint as lineas,
         count(*)::bigint as tareas_similares,
         (sum(g.nv) - count(*))::bigint as lineas_similares,
         round(100 * (1 - count(*)::numeric / nullif(sum(g.nv),0)), 1) as pct_tareas_similares,
         round(sum(g.hh),1) as horas,
         round(100 * sum(g.hh) filter (where g.nv > 1) / nullif(sum(g.hh),0), 1) as pct_horas_similares
  from grp g
  join public.personas pe on pe.id = g.persona_id
  left join public.areas a on a.id = pe.area_id
  group by g.persona_id, pe.nombre, a.nombre
$$;
grant execute on function public.resumen_tareas_similares(date,date) to anon, authenticated;
