-- Pesos y umbrales del Índice de calidad de planificación (editables desde el Table Editor)
create table if not exists public.indice_calidad_config (
  termino text primary key check (termino in ('P','O','A','H','E','S')),
  nombre text not null,
  dato text not null,
  peso numeric not null check (peso >= 0 and peso <= 100),
  parametros jsonb not null default '{}'::jsonb,
  descripcion text,
  orden smallint not null,
  updated_at timestamptz not null default now()
);
comment on table public.indice_calidad_config is 'Pesos (en %) y umbrales del índice de calidad de planificación. Los pesos deberían sumar 100; ver v_indice_calidad_control.';
alter table public.indice_calidad_config enable row level security;
drop policy if exists lectura_publica on public.indice_calidad_config;
create policy lectura_publica on public.indice_calidad_config for select to anon, authenticated using (true);

drop trigger if exists tg_touch on public.indice_calidad_config;
create trigger tg_touch before update on public.indice_calidad_config
  for each row execute function public.tg_touch_updated_at();

insert into public.indice_calidad_config (termino, nombre, dato, peso, parametros, descripcion, orden) values
 ('P','Planificación','Semanas planificadas',20,'{"semanas_periodo":8}','semanas planificadas / semanas del período',1),
 ('O','Ocupación','Ocupación acumulada (%)',20,'{"optimo_desde":80,"optimo_hasta":95,"limite":120}','1 dentro del rango óptimo; por debajo: ocupación/optimo_desde; por encima: baja lineal hasta 0 en el límite',2),
 ('A','Prioridad','% Tareas en Alta',15,'{"tolerancia":30,"limite":100}','1 hasta la tolerancia; luego baja lineal hasta 0 en el límite',3),
 ('H','Estimación','% Sin horas',10,'{"factor":2}','1 − factor × % sin horas (mínimo 0)',4),
 ('E','Evaluación','% Evaluadas',15,'{"meta":50}','% evaluadas / meta, con tope en 1',5),
 ('S','Tareas similares','% Tareas similares',20,'{"tolerancia":20,"limite":70}','1 hasta la tolerancia; luego baja lineal hasta 0 en el límite',6)
on conflict (termino) do nothing;

create or replace view public.v_indice_calidad_control with (security_invoker = true) as
select sum(peso) as suma_pesos,
       case when sum(peso) = 100 then 'OK' else 'Los pesos no suman 100: el índice se normaliza igual, pero conviene corregirlos' end as estado
from public.indice_calidad_config;

create or replace function public.indice_calidad(
  p_semanas numeric, p_ocupacion numeric, p_alta numeric,
  p_sin_horas numeric, p_evaluadas numeric, p_similares numeric)
returns table (p numeric, o numeric, a numeric, h numeric, e numeric, s numeric, indice numeric)
language plpgsql stable security invoker set search_path to '' as $$
declare
  c jsonb;
  w jsonb;
  vp numeric; vo numeric; va numeric; vh numeric; ve numeric; vs numeric;
  d numeric; x numeric; l numeric;
begin
  select jsonb_object_agg(termino, parametros), jsonb_object_agg(termino, peso)
    into c, w from public.indice_calidad_config;

  vp := least(1, greatest(0, coalesce(p_semanas,0) / nullif((c->'P'->>'semanas_periodo')::numeric,0)));

  d := (c->'O'->>'optimo_desde')::numeric; x := (c->'O'->>'optimo_hasta')::numeric; l := (c->'O'->>'limite')::numeric;
  vo := case when coalesce(p_ocupacion,0) < d then coalesce(p_ocupacion,0) / nullif(d,0)
             when p_ocupacion <= x then 1
             else greatest(0, 1 - (p_ocupacion - x) / nullif(l - x,0)) end;

  d := (c->'A'->>'tolerancia')::numeric; l := (c->'A'->>'limite')::numeric;
  va := case when coalesce(p_alta,0) <= d then 1 else greatest(0, 1 - (p_alta - d) / nullif(l - d,0)) end;

  vh := greatest(0, 1 - (c->'H'->>'factor')::numeric * coalesce(p_sin_horas,0) / 100);

  ve := least(1, coalesce(p_evaluadas,0) / nullif((c->'E'->>'meta')::numeric,0));

  d := (c->'S'->>'tolerancia')::numeric; l := (c->'S'->>'limite')::numeric;
  vs := case when coalesce(p_similares,0) <= d then 1 else greatest(0, 1 - (p_similares - d) / nullif(l - d,0)) end;

  return query select round(vp,3), round(vo,3), round(va,3), round(vh,3), round(ve,3), round(vs,3),
    round(100 * ( vp*(w->>'P')::numeric + vo*(w->>'O')::numeric + va*(w->>'A')::numeric
                + vh*(w->>'H')::numeric + ve*(w->>'E')::numeric + vs*(w->>'S')::numeric )
          / nullif((select sum(peso) from public.indice_calidad_config),0), 1);
end $$;
grant execute on function public.indice_calidad(numeric,numeric,numeric,numeric,numeric,numeric) to anon, authenticated;
