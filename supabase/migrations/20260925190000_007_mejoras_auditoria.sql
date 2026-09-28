-- =========================================================
-- 007 · Mejoras surgidas de la auditoría (25/09/2026)
--   · clave de carga opcional (ver sigue siendo público)
--   · jornada por persona y alias de nombres (unificar personas)
--   · horas reales por persona y semana
--   · evaluación de riesgos que se hereda entre semanas
--   · excepciones de auditoría ("revisado, no volver a mostrar")
--   · sincronización: alias, aviso de persona parecida, clave
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- clave de carga ----------
create table if not exists public.app_config (
  id smallint primary key default 1 check (id = 1),
  clave_carga_hash text,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict do nothing;
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

create or replace function public._verificar_clave(p_clave text)
returns void language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select clave_carga_hash into h from public.app_config where id = 1;
  if h is null then return; end if;                       -- sin clave definida: carga libre
  if p_clave is null or extensions.crypt(p_clave, h) <> h then
    raise exception 'CLAVE_INVALIDA: la clave de carga no es correcta.';
  end if;
end $$;

-- Se ejecuta SOLO desde el SQL Editor de Supabase: select public.definir_clave_carga('...');
create or replace function public.definir_clave_carga(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  update public.app_config
     set clave_carga_hash = case when nullif(p_clave, '') is null then null else extensions.crypt(p_clave, extensions.gen_salt('bf')) end,
         updated_at = now()
   where id = 1;
  return case when nullif(p_clave, '') is null then 'Clave desactivada: cualquiera con el enlace puede cargar.' else 'Clave de carga definida.' end;
end $$;

create or replace function public.clave_requerida()
returns boolean language sql stable security definer set search_path = '' as $$
  select clave_carga_hash is not null from public.app_config where id = 1;
$$;

revoke execute on function public._verificar_clave(text)    from public, anon, authenticated;
revoke execute on function public.definir_clave_carga(text) from public, anon, authenticated;
grant  execute on function public.clave_requerida()          to anon, authenticated;

-- ---------- personas: jornada y alias ----------
alter table public.personas add column if not exists jornada_horas numeric(5,2) not null default 44
  check (jornada_horas > 0 and jornada_horas <= 80);

create table if not exists public.personas_alias (
  alias_norm text primary key,
  persona_id uuid not null references public.personas(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- horas reales por persona y semana ----------
create table if not exists public.horas_reales_semana (
  semana_id  uuid not null references public.semanas(id),
  persona_id uuid not null references public.personas(id) on delete cascade,
  horas      numeric(6,2) not null check (horas >= 0 and horas <= 120),
  cargado_por text,
  updated_at timestamptz not null default now(),
  primary key (semana_id, persona_id)
);
create index if not exists horas_reales_persona_idx on public.horas_reales_semana (persona_id);

-- ---------- riesgos evaluados (persona + texto del riesgo) ----------
create table if not exists public.riesgos_evaluados (
  persona_id  uuid not null references public.personas(id) on delete cascade,
  riesgo_norm text not null,
  riesgo_texto text,
  prob    text check (prob    in ('bajo','moderado','alto')),
  impacto text check (impacto in ('bajo','moderado','alto')),
  cargado_por text,
  updated_at timestamptz not null default now(),
  primary key (persona_id, riesgo_norm)
);

-- ---------- excepciones de auditoría (persona + tarea + regla) ----------
create table if not exists public.auditoria_excepciones (
  persona_id uuid not null references public.personas(id) on delete cascade,
  tarea_norm text not null,
  regla      text not null,
  nota       text,
  cargado_por text,
  created_at timestamptz not null default now(),
  primary key (persona_id, tarea_norm, regla)
);

-- lectura pública de las tablas nuevas; escritura solo por funciones
do $$
declare t text;
begin
  foreach t in array array['personas_alias','horas_reales_semana','riesgos_evaluados','auditoria_excepciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('drop policy if exists lectura_publica on public.%I', t);
    execute format('create policy lectura_publica on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- las ediciones directas sobre planificacion se reemplazan por funciones con clave
revoke update on public.planificacion from anon, authenticated;
drop policy if exists edicion_publica_campos_app on public.planificacion;
drop policy if exists edicion_campos_app on public.planificacion;

-- el historial acepta correcciones administrativas (unificar personas, arreglos de datos)
alter table public.historial_planificacion drop constraint if exists historial_planificacion_origen_check;
alter table public.historial_planificacion add constraint historial_planificacion_origen_check
  check (origen in ('excel','app','correccion'));

-- ---------- funciones de edición (validan la clave si está definida) ----------
create or replace function public.guardar_horas_reales(p_semana uuid, p_persona uuid, p_horas numeric,
  p_clave text default null, p_cargado_por text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._verificar_clave(p_clave);
  if p_horas is null then
    delete from public.horas_reales_semana where semana_id = p_semana and persona_id = p_persona;
  else
    insert into public.horas_reales_semana (semana_id, persona_id, horas, cargado_por)
    values (p_semana, p_persona, p_horas, nullif(btrim(p_cargado_por), ''))
    on conflict (semana_id, persona_id) do update set horas = excluded.horas, cargado_por = excluded.cargado_por, updated_at = now();
  end if;
end $$;

create or replace function public.evaluar_riesgo(p_persona uuid, p_riesgo_norm text, p_riesgo_texto text,
  p_prob text, p_impacto text, p_clave text default null, p_cargado_por text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._verificar_clave(p_clave);
  if p_prob is null and p_impacto is null then
    delete from public.riesgos_evaluados where persona_id = p_persona and riesgo_norm = p_riesgo_norm;
  else
    insert into public.riesgos_evaluados (persona_id, riesgo_norm, riesgo_texto, prob, impacto, cargado_por)
    values (p_persona, p_riesgo_norm, p_riesgo_texto, p_prob, p_impacto, nullif(btrim(p_cargado_por), ''))
    on conflict (persona_id, riesgo_norm) do update
      set prob = excluded.prob, impacto = excluded.impacto, riesgo_texto = excluded.riesgo_texto,
          cargado_por = excluded.cargado_por, updated_at = now();
  end if;
end $$;

create or replace function public.guardar_jornada(p_persona uuid, p_horas numeric, p_clave text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._verificar_clave(p_clave);
  update public.personas set jornada_horas = coalesce(p_horas, 44) where id = p_persona;
end $$;

create or replace function public.marcar_revisada(p_persona uuid, p_tarea_norm text, p_regla text, p_revisada boolean,
  p_nota text default null, p_clave text default null, p_cargado_por text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._verificar_clave(p_clave);
  if p_revisada then
    insert into public.auditoria_excepciones (persona_id, tarea_norm, regla, nota, cargado_por)
    values (p_persona, coalesce(p_tarea_norm, ''), p_regla, nullif(btrim(p_nota), ''), nullif(btrim(p_cargado_por), ''))
    on conflict (persona_id, tarea_norm, regla) do update set nota = excluded.nota, cargado_por = excluded.cargado_por;
  else
    delete from public.auditoria_excepciones where persona_id = p_persona and tarea_norm = coalesce(p_tarea_norm, '') and regla = p_regla;
  end if;
end $$;

-- Unifica dos personas (p. ej. un error de tipeo en B1). Mueve todo al destino,
-- deja registro en el historial y guarda el alias para que las próximas cargas se corrijan solas.
create or replace function public.unificar_personas(p_origen uuid, p_destino uuid, p_clave text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o record; d record; n int;
begin
  perform public._verificar_clave(p_clave);
  if p_origen = p_destino then raise exception 'Elegí dos personas distintas.'; end if;
  select * into o from public.personas where id = p_origen;
  select * into d from public.personas where id = p_destino;
  if o.id is null or d.id is null then raise exception 'Persona no encontrada.'; end if;
  perform set_config('app.origen_sync', 'excel', true);

  insert into public.historial_planificacion (planificacion_id, tipo, campo, valor_anterior, valor_nuevo, origen)
  select id, 'modificacion', 'persona', o.nombre, d.nombre, 'correccion' from public.planificacion where persona_id = o.id;
  update public.planificacion set persona_id = d.id where persona_id = o.id;
  get diagnostics n = row_count;

  -- renumerar ordinales por si ahora coinciden tareas iguales el mismo día
  update public.planificacion p set ordinal = x.rn
  from (select id, row_number() over (partition by semana_id, persona_id, fecha, tarea_norm order by vigente desc, hoja, fila_excel, created_at) rn
        from public.planificacion where persona_id = d.id) x
  where p.id = x.id and p.ordinal <> x.rn;

  insert into public.horas_reales_semana (semana_id, persona_id, horas, cargado_por, updated_at)
  select semana_id, d.id, horas, cargado_por, updated_at from public.horas_reales_semana where persona_id = o.id
  on conflict do nothing;
  insert into public.riesgos_evaluados (persona_id, riesgo_norm, riesgo_texto, prob, impacto, cargado_por, updated_at)
  select d.id, riesgo_norm, riesgo_texto, prob, impacto, cargado_por, updated_at from public.riesgos_evaluados where persona_id = o.id
  on conflict do nothing;
  insert into public.auditoria_excepciones (persona_id, tarea_norm, regla, nota, cargado_por, created_at)
  select d.id, tarea_norm, regla, nota, cargado_por, created_at from public.auditoria_excepciones where persona_id = o.id
  on conflict do nothing;

  update public.personas_alias set persona_id = d.id where persona_id = o.id;
  insert into public.personas_alias (alias_norm, persona_id) values (o.nombre_norm, d.id)
  on conflict (alias_norm) do update set persona_id = excluded.persona_id;
  delete from public.personas where id = o.id;

  return jsonb_build_object('origen', o.nombre, 'destino', d.nombre, 'actividades', n);
end $$;

grant execute on function public.guardar_horas_reales(uuid, uuid, numeric, text, text)             to anon, authenticated;
grant execute on function public.evaluar_riesgo(uuid, text, text, text, text, text, text)          to anon, authenticated;
grant execute on function public.guardar_jornada(uuid, numeric, text)                               to anon, authenticated;
grant execute on function public.marcar_revisada(uuid, text, text, boolean, text, text, text)      to anon, authenticated;
grant execute on function public.unificar_personas(uuid, uuid, text)                               to anon, authenticated;

-- ---------- vista de actividades: agrega la jornada de la persona ----------
create or replace view public.v_actividades with (security_invoker = true) as
select p.id, p.semana_id, s.fecha_inicio as semana_inicio,
       p.persona_id, pe.nombre as persona, p.area_id, a.nombre as area,
       p.fecha, p.dia, p.tarea, p.tarea_norm, p.ordinal, p.prioridad,
       p.horas_planificadas, p.horas_reales, p.recursos, p.riesgos, p.estado,
       p.riesgo_prob, p.riesgo_impacto, p.hoja, p.fila_excel,
       (pc.importacion_id is not null and p.importacion_alta_id <> pc.importacion_id) as alta_posterior,
       p.updated_at,
       pe.jornada_horas as jornada
from public.planificacion p
join public.semanas  s  on s.id  = p.semana_id
join public.personas pe on pe.id = p.persona_id
join public.areas    a  on a.id  = p.area_id
left join public.v_primera_carga pc on pc.semana_id = p.semana_id and pc.area_id = p.area_id
where p.vigente;

-- ---------- sincronización (versión completa, reemplaza a la de 003/006) ----------
create or replace function public.sincronizar_planificacion(
  p_payload   jsonb,
  p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area_nombre text := btrim(p_payload->>'area');
  v_inicio      date := (p_payload->>'semana_inicio')::date;
  v_archivo     text := coalesce(p_payload->>'archivo','(sin nombre)');
  v_hash        text := p_payload->>'archivo_hash';
  v_origen      text := coalesce(p_payload->>'origen','app');
  v_cargado     text := nullif(btrim(p_payload->>'cargado_por'), '');
  v_area_id     smallint;
  v_semana_id   uuid;
  v_imp_id      uuid;
  v_uid         uuid := auth.uid();
  v_email       text := auth.jwt()->>'email';
  v_obs         jsonb := '[]'::jsonb;
  v_result      jsonb;
  r             record;
begin
  if v_area_nombre is null or v_area_nombre = '' then
    raise exception 'Falta el área del archivo.';
  end if;
  if v_inicio is null or extract(isodow from v_inicio) <> 1 then
    raise exception 'semana_inicio debe ser un lunes (recibido: %).', p_payload->>'semana_inicio';
  end if;
  if jsonb_typeof(p_payload->'filas') <> 'array' or jsonb_array_length(p_payload->'filas') = 0 then
    raise exception 'El archivo no contiene filas para importar.';
  end if;

  begin  -- subtransacción: en vista previa se revierte todo al final
    perform set_config('app.origen_sync', 'excel', true);

    insert into public.areas(nombre) values (v_area_nombre) on conflict (nombre) do nothing;
    select id into v_area_id from public.areas where nombre = v_area_nombre;

    insert into public.semanas(fecha_inicio) values (v_inicio) on conflict (fecha_inicio) do nothing;
    select id into v_semana_id from public.semanas where fecha_inicio = v_inicio;

    create temp table _in on commit drop as
    with src as (
      select x.*,
             coalesce(nullif(btrim(x.persona),''), nullif(btrim(x.hoja),''), 'Sin nombre') as persona_ok
      from jsonb_to_recordset(p_payload->'filas') as x(
        hoja text, persona text, fila int, fecha date, fecha_texto text, dia text,
        tarea text, prioridad text, horas text, recursos text, riesgos text, estado text)
    )
    select row_number() over (order by hoja, fila)::int              as idx,
           hoja, fila, persona_ok                                     as persona,
           public.norm_texto(persona_ok)                              as persona_norm,
           null::uuid                                                 as persona_id,
           fecha, fecha_texto,
           nullif(btrim(dia),'')                                      as dia,
           nullif(btrim(tarea),'')                                    as tarea,
           coalesce(public.norm_texto(tarea),'')                      as tarea_norm,
           nullif(btrim(prioridad),'')                                as prioridad_raw,
           public.norm_prioridad(prioridad)                           as prioridad,
           nullif(btrim(horas),'')                                    as horas_raw,
           public.parse_horas(horas)::numeric(6,2)                    as horas,
           nullif(nullif(btrim(recursos),''),'-')                     as recursos,
           nullif(nullif(btrim(riesgos),''),'-')                      as riesgos,
           nullif(nullif(btrim(estado),''),'-')                       as estado,
           1::smallint as ordinal, ''::text as hash,
           null::uuid as match_id, null::text as match_tipo
    from src;

    -- personas: 1) alias de nombres ya unificados  2) nombre exacto  3) persona nueva
    update _in i set persona_id = pa.persona_id from public.personas_alias pa where pa.alias_norm = i.persona_norm;
    create temp table _nuevas on commit drop as
      select distinct on (persona_norm) persona, persona_norm from _in
      where persona_id is null and persona_norm not in (select nombre_norm from public.personas);
    insert into public.personas(nombre, nombre_norm, area_id)
    select persona, persona_norm, v_area_id from _nuevas on conflict (nombre_norm) do nothing;
    update public.personas p set area_id = v_area_id
      where p.area_id is null and p.nombre_norm in (select persona_norm from _in);
    update _in i set persona_id = p.id from public.personas p where i.persona_id is null and p.nombre_norm = i.persona_norm;

    update _in i set ordinal = o.rn, hash = public.hash_actividad(i.fecha, i.dia, i.tarea, i.prioridad, i.horas, i.recursos, i.riesgos, i.estado)
    from (select idx, row_number() over (partition by persona_id, fecha, tarea_norm order by hoja, fila) rn from _in) o
    where o.idx = i.idx;

    create temp table _ex on commit drop as
    select p.*, false as usado from public.planificacion p
    where p.semana_id = v_semana_id and p.area_id = v_area_id;

    -- PASO 1 · coincidencia exacta
    update _in i set match_id = e.id, match_tipo = 'exacta'
    from (select distinct on (persona_id, fecha, tarea_norm, ordinal) *
          from _ex order by persona_id, fecha, tarea_norm, ordinal, vigente desc, updated_at desc) e
    where e.persona_id = i.persona_id and e.fecha is not distinct from i.fecha
      and e.tarea_norm = i.tarea_norm and e.ordinal = i.ordinal;
    update _ex e set usado = true where e.id in (select match_id from _in where match_id is not null);

    -- PASO 2 · cambio de fecha
    with ci as (
      select idx, persona_id, tarea_norm,
             row_number() over (partition by persona_id, tarea_norm order by fecha nulls last, ordinal) rn
      from _in where match_id is null and tarea_norm <> ''),
    ce as (
      select id, persona_id, tarea_norm,
             row_number() over (partition by persona_id, tarea_norm order by fecha nulls last, ordinal) rn
      from _ex where not usado and vigente and tarea_norm <> '')
    update _in i set match_id = ce.id, match_tipo = 'cambio_fecha'
    from ci join ce using (persona_id, tarea_norm, rn)
    where ci.idx = i.idx;
    update _ex e set usado = true where e.id in (select match_id from _in where match_id is not null);

    -- PASO 3 · texto editado
    for r in
      select i.idx, e.id, extensions.similarity(i.tarea_norm, e.tarea_norm) s
      from _in i join _ex e on e.persona_id = i.persona_id and e.fecha is not distinct from i.fecha
      where i.match_id is null and not e.usado and e.vigente
        and i.tarea_norm <> '' and e.tarea_norm <> ''
        and extensions.similarity(i.tarea_norm, e.tarea_norm) >= 0.6
      order by s desc
    loop
      if exists (select 1 from _in where idx = r.idx and match_id is null)
         and exists (select 1 from _ex where id = r.id and not usado) then
        update _in set match_id = r.id, match_tipo = 'texto_editado' where idx = r.idx;
        update _ex set usado = true where id = r.id;
      end if;
    end loop;

    create temp table _cambios on commit drop as
    select i.idx, e.id, e.vigente as estaba_vigente,
           coalesce(jsonb_agg(jsonb_build_object('campo', c.campo, 'antes', c.antes, 'despues', c.despues))
                    filter (where c.antes is distinct from c.despues), '[]'::jsonb) as cambios
    from _in i join _ex e on e.id = i.match_id
    cross join lateral (values
      ('fecha',              e.fecha::text,                          i.fecha::text),
      ('dia',                e.dia,                                  i.dia),
      ('tarea',              e.tarea,                                i.tarea),
      ('prioridad',          e.prioridad,                            i.prioridad),
      ('horas_planificadas', e.horas_planificadas::numeric(6,2)::text, i.horas::text),
      ('recursos',           e.recursos,                             i.recursos),
      ('riesgos',            e.riesgos,                              i.riesgos),
      ('estado',             e.estado,                               i.estado)
    ) c(campo, antes, despues)
    group by i.idx, e.id, e.vigente;

    select coalesce(jsonb_agg(o order by (o->>'fila')::int nulls first), '[]'::jsonb) into v_obs from (
      select jsonb_build_object('tipo','sin_fecha','persona',persona,'hoja',hoja,'fila',fila,
             'detalle', 'Fecha vacía o no reconocida: "' || coalesce(fecha_texto,'') || '"') o
        from _in where fecha is null
      union all
      select jsonb_build_object('tipo','fecha_fuera_semana','persona',persona,'hoja',hoja,'fila',fila,
             'detalle', 'La fecha ' || to_char(fecha,'DD/MM/YYYY') || ' no pertenece a la semana del ' || to_char(v_inicio,'DD/MM'))
        from _in where fecha is not null and (fecha < v_inicio or fecha > v_inicio + 6)
      union all
      select jsonb_build_object('tipo','dia_inconsistente','persona',persona,'hoja',hoja,'fila',fila,
             'detalle', 'Día "' || dia || '" no coincide con la fecha ' || to_char(fecha,'DD/MM') || ' (' || public.dia_de_fecha(fecha) || ')')
        from _in where fecha is not null and dia is not null
          and public.norm_texto(dia) <> public.norm_texto(public.dia_de_fecha(fecha))
      union all
      select jsonb_build_object('tipo','horas_invalidas','persona',persona,'hoja',hoja,'fila',fila,
             'detalle', 'Tiempo no interpretable: "' || horas_raw || '"')
        from _in where horas_raw is not null and horas is null
      union all
      select jsonb_build_object('tipo','prioridad_no_reconocida','persona',persona,'hoja',hoja,'fila',fila,
             'detalle', 'Importancia no reconocida: "' || prioridad_raw || '"')
        from _in where prioridad_raw is not null and prioridad is null
      union all
      select jsonb_build_object('tipo','posible_duplicado','persona',persona,'hoja',hoja,'fila',fila,
             'detalle', 'Misma tarea, misma persona y mismo día (aparición n° ' || ordinal || ')')
        from _in where ordinal > 1 and tarea_norm <> ''
      union all
      select jsonb_build_object('tipo','persona_similar','persona',n.persona,'hoja',null,'fila',null,
             'detalle', 'Persona nueva con un nombre parecido a "' || x.nombre || '". Si es un error de tipeo, unificalas en Carga.')
        from _nuevas n cross join lateral (
          select p.nombre from public.personas p
          where p.nombre_norm not in (select persona_norm from _nuevas)
            and extensions.similarity(p.nombre_norm, n.persona_norm) >= 0.5
          order by extensions.similarity(p.nombre_norm, n.persona_norm) desc limit 1) x
      union all
      select jsonb_build_object('tipo','persona_ausente','persona',p.nombre,'hoja',null,'fila',null,
             'detalle', 'No figura en este archivo; sus ' || count(*) || ' actividades se conservan sin cambios')
        from _ex e join public.personas p on p.id = e.persona_id
        where e.vigente and e.persona_id not in (select persona_id from _in)
        group by p.nombre
      union all
      select jsonb_build_object('tipo','persona_otra_area','persona',p.nombre,'hoja',null,'fila',null,
             'detalle', 'Figura en ' || a.nombre || ' pero viene en un archivo de ' || v_area_nombre)
        from public.personas p join public.areas a on a.id = p.area_id
        where p.id in (select persona_id from _in) and p.area_id <> v_area_id
      union all
      select jsonb_build_object('tipo','archivo_repetido','persona',null,'hoja',null,'fila',null,
             'detalle', 'Archivo idéntico al cargado el ' || to_char(im.created_at at time zone 'America/Argentina/Buenos_Aires','DD/MM/YYYY HH24:MI'))
        from (select created_at from public.importaciones
              where semana_id = v_semana_id and area_id = v_area_id and archivo_hash = v_hash and v_hash is not null
              order by created_at desc limit 1) im
    ) q;

    v_result := jsonb_build_object(
      'semana_inicio', v_inicio, 'semana_fin', v_inicio + 6, 'area', v_area_nombre, 'archivo', v_archivo,
      'total',       (select count(*) from _in),
      'nuevas',      (select count(*) from _in where match_id is null),
      'modificadas', (select count(*) from _cambios where estaba_vigente and jsonb_array_length(cambios) > 0),
      'reactivadas', (select count(*) from _cambios where not estaba_vigente),
      'sin_cambios', (select count(*) from _cambios where estaba_vigente and jsonb_array_length(cambios) = 0),
      'retiradas',   (select count(*) from _ex where vigente and not usado and persona_id in (select persona_id from _in)),
      'observaciones', v_obs,
      'detalle', jsonb_build_object(
        'nuevas', (select coalesce(jsonb_agg(jsonb_build_object('persona',persona,'fecha',fecha,'tarea',tarea,'hoja',hoja,'fila',fila) order by persona, fecha, fila), '[]'::jsonb)
                   from _in where match_id is null),
        'modificadas', (select coalesce(jsonb_agg(jsonb_build_object('persona',i.persona,'fecha',i.fecha,'tarea',i.tarea,'hoja',i.hoja,'fila',i.fila,
                                     'identificacion', i.match_tipo, 'reactivada', not c.estaba_vigente, 'cambios', c.cambios) order by i.persona, i.fecha, i.fila), '[]'::jsonb)
                   from _cambios c join _in i on i.idx = c.idx
                   where jsonb_array_length(c.cambios) > 0 or not c.estaba_vigente),
        'retiradas', (select coalesce(jsonb_agg(jsonb_build_object('persona',p.nombre,'fecha',e.fecha,'tarea',e.tarea) order by p.nombre, e.fecha), '[]'::jsonb)
                   from _ex e join public.personas p on p.id = e.persona_id
                   where e.vigente and not e.usado and e.persona_id in (select persona_id from _in))
      )
    );

    if not p_confirmar then
      raise exception using errcode = 'P0D01', message = 'vista_previa';
    end if;

    -- la vista previa es libre; guardar requiere la clave (si está definida)
    perform public._verificar_clave(p_payload->>'clave');

    insert into public.importaciones (semana_id, area_id, archivo, archivo_hash, usuario_id, usuario_email, cargado_por, origen,
                                      total, nuevas, modificadas, sin_cambios, retiradas, reactivadas, observaciones)
    values (v_semana_id, v_area_id, v_archivo, v_hash, v_uid, v_email, v_cargado, v_origen,
            (v_result->>'total')::int, (v_result->>'nuevas')::int, (v_result->>'modificadas')::int,
            (v_result->>'sin_cambios')::int, (v_result->>'retiradas')::int, (v_result->>'reactivadas')::int, v_obs)
    returning id into v_imp_id;

    insert into public.planificacion (semana_id, persona_id, area_id, fecha, dia, tarea, prioridad, horas_planificadas,
                                      recursos, riesgos, estado, tarea_norm, ordinal, content_hash, hoja, fila_excel,
                                      origen, importacion_alta_id, importacion_ultima_id)
    select v_semana_id, persona_id, v_area_id, fecha, dia, tarea, prioridad, horas, recursos, riesgos, estado,
           tarea_norm, ordinal, hash, hoja, fila, 'excel', v_imp_id, v_imp_id
    from _in where match_id is null;

    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, origen, usuario_id)
    select id, v_imp_id, 'alta', 'excel', v_uid from public.planificacion where importacion_alta_id = v_imp_id;

    update public.planificacion p set
      fecha = i.fecha, dia = i.dia, tarea = i.tarea, prioridad = i.prioridad, horas_planificadas = i.horas,
      recursos = i.recursos, riesgos = i.riesgos, estado = i.estado,
      tarea_norm = i.tarea_norm, ordinal = i.ordinal, content_hash = i.hash,
      hoja = i.hoja, fila_excel = i.fila, vigente = true, importacion_ultima_id = v_imp_id
    from _cambios c join _in i on i.idx = c.idx
    where p.id = c.id and (jsonb_array_length(c.cambios) > 0 or not c.estaba_vigente);

    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, origen, usuario_id)
    select c.id, v_imp_id, 'reactivacion', 'excel', v_uid from _cambios c where not c.estaba_vigente;

    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, campo, valor_anterior, valor_nuevo, origen, usuario_id)
    select c.id, v_imp_id, 'modificacion', x->>'campo', x->>'antes', x->>'despues', 'excel', v_uid
    from _cambios c cross join lateral jsonb_array_elements(c.cambios) x;

    update public.planificacion p set hoja = i.hoja, fila_excel = i.fila
    from _cambios c join _in i on i.idx = c.idx
    where p.id = c.id and c.estaba_vigente and jsonb_array_length(c.cambios) = 0
      and (p.hoja, p.fila_excel) is distinct from (i.hoja, i.fila);

    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, origen, usuario_id)
    select e.id, v_imp_id, 'retiro', 'excel', v_uid
    from _ex e where e.vigente and not e.usado and e.persona_id in (select persona_id from _in);

    update public.planificacion p set vigente = false, importacion_ultima_id = v_imp_id
    from _ex e
    where p.id = e.id and e.vigente and not e.usado and e.persona_id in (select persona_id from _in);

    if exists (
      select 1 from public.planificacion
      where semana_id = v_semana_id and vigente
      group by persona_id, fecha, tarea_norm, ordinal having count(*) > 1) then
      raise exception 'Inconsistencia: la sincronización generaría actividades duplicadas. No se aplicó ningún cambio.';
    end if;

    update public.semanas set ultima_carga = now() where id = v_semana_id;

    v_result := v_result || jsonb_build_object('confirmada', true, 'importacion_id', v_imp_id);

  exception when sqlstate 'P0D01' then
    v_result := v_result || jsonb_build_object('confirmada', false, 'importacion_id', null);
  end;

  return v_result;
end $$;

grant execute on function public.sincronizar_planificacion(jsonb, boolean) to anon, authenticated;
