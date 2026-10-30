-- Clave de agrupación de "tareas similares": no modifica la carga, solo la clasifica.
create or replace function public.tarea_grupo_clave(p_tarea text, p_accion smallint)
returns text
language sql immutable
set search_path = public
as $$
  with x as (
    select trim(regexp_replace(translate(lower(
      case when position(' · ' in coalesce(p_tarea,''))>0 then split_part(p_tarea,' · ',2) else coalesce(p_tarea,'') end),
      'áéíóúüñ','aeiouun'),'[^a-z ]',' ','g')) txt
  ), t as (
    select array(
      select w from x, unnest(regexp_split_to_array(x.txt,'\s+')) with ordinality u(w,n)
      where length(w)>2 and w not in ('del','las','los','para','por','con','sus','que','una','uno','mas','segun','entre',
        'enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','setiembre','octubre','noviembre','diciembre',
        'ene','feb','mar','abr','may','jun','jul','ago','sep','sept','set','oct','nov','dic')
      order by n) t
  )
  select case
    when exists (select 1 from unnest(t[1:3]) w where w ~ '^(correo|correos|mail|mails|email|emails|bandeja)$') then 'F:correo'
    when exists (select 1 from unnest(t[1:4]) w where w ~ '^(cobranza|cobranzas|cobro|cobros|cobrar)$')
      or (exists (select 1 from unnest(t[1:4]) w where w ~ '^reclam')
          and exists (select 1 from unnest(t[1:5]) w where w ~ '^pag')) then 'F:cobranza'
    else coalesce(p_accion::text,'-')||':'||array_to_string(t[1:2],' ')
  end
  from t
$$;

create or replace view public.v_tareas_similares
with (security_invoker = true) as
select p.id, p.persona_id, p.area_id, p.semana_id, s.fecha_inicio as semana_inicio, p.fecha,
       p.tarea, p.accion_id, p.prioridad, p.horas_planificadas,
       g.clave as grupo_clave,
       case g.clave
         when 'F:correo' then 'Gestión de correo'
         when 'F:cobranza' then 'Gestión de cobranzas'
         else coalesce(a.nombre,'Sin acción')||': '||initcap(split_part(g.clave,':',2))
       end as grupo_nombre
from public.planificacion p
join public.semanas s on s.id = p.semana_id
left join public.acciones a on a.id = p.accion_id
cross join lateral (select public.tarea_grupo_clave(p.tarea, p.accion_id) as clave) g
where p.vigente and coalesce(p.tarea,'') <> '';

create or replace view public.v_tareas_similares_resumen
with (security_invoker = true) as
select persona_id, semana_id, semana_inicio, grupo_clave, min(grupo_nombre) as grupo_nombre,
       count(distinct lower(trim(tarea))) as variantes,
       count(*) as lineas,
       sum(coalesce(horas_planificadas,0)) as horas
from public.v_tareas_similares
group by persona_id, semana_id, semana_inicio, grupo_clave;
