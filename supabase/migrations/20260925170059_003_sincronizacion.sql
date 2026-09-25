-- =========================================================
-- 003 · Sincronización Excel → Supabase
-- Ver docs/SINCRONIZACION.md para la estrategia completa.
-- =========================================================

-- Hash del contenido que viene del Excel (decide IGNORE vs UPDATE)
create or replace function public.hash_actividad(
  p_fecha date, p_dia text, p_tarea text, p_prioridad text, p_horas numeric,
  p_recursos text, p_riesgos text, p_estado text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select md5(concat_ws('|',
    coalesce(p_fecha::text,'∅'), coalesce(p_dia,'∅'), coalesce(p_tarea,'∅'),
    coalesce(p_prioridad,'∅'), coalesce(p_horas::numeric(6,2)::text,'∅'),
    coalesce(p_recursos,'∅'), coalesce(p_riesgos,'∅'), coalesce(p_estado,'∅')));
$$;

-- updated_at solo cambia si cambió algo relevante (no por mover la fila en el Excel)
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.content_hash   is not distinct from old.content_hash
     and new.vigente     is not distinct from old.vigente
     and new.horas_reales   is not distinct from old.horas_reales
     and new.riesgo_prob    is not distinct from old.riesgo_prob
     and new.riesgo_impacto is not distinct from old.riesgo_impacto then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;

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
  v_area_id     smallint;
  v_semana_id   uuid;
  v_imp_id      uuid;
  v_uid         uuid := auth.uid();
  v_email       text := auth.jwt()->>'email';
  v_obs         jsonb := '[]'::jsonb;
  v_result      jsonb;
  r             record;
begin
  -- ---------- autorización y validación ----------
  if v_uid is null and session_user = 'authenticator' then
    raise exception 'Se requiere un usuario autenticado para importar.';
  end if;
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

    -- ---------- filas entrantes normalizadas ----------
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

    -- personas (se identifican por nombre normalizado de la celda B1, no por la hoja)
    insert into public.personas(nombre, nombre_norm, area_id)
    select distinct on (persona_norm) persona, persona_norm, v_area_id from _in
    on conflict (nombre_norm) do nothing;
    update public.personas p set area_id = v_area_id
      where p.area_id is null and p.nombre_norm in (select persona_norm from _in);
    update _in i set persona_id = p.id from public.personas p where p.nombre_norm = i.persona_norm;

    update _in i set ordinal = o.rn, hash = public.hash_actividad(i.fecha, i.dia, i.tarea, i.prioridad, i.horas, i.recursos, i.riesgos, i.estado)
    from (select idx, row_number() over (partition by persona_id, fecha, tarea_norm order by hoja, fila) rn from _in) o
    where o.idx = i.idx;

    -- actividades existentes en el alcance (semana + área)
    create temp table _ex on commit drop as
    select p.*, false as usado from public.planificacion p
    where p.semana_id = v_semana_id and p.area_id = v_area_id;

    -- ---------- PASO 1 · coincidencia exacta: persona + fecha + tarea + ordinal ----------
    update _in i set match_id = e.id, match_tipo = 'exacta'
    from (select distinct on (persona_id, fecha, tarea_norm, ordinal) *
          from _ex order by persona_id, fecha, tarea_norm, ordinal, vigente desc, updated_at desc) e
    where e.persona_id = i.persona_id and e.fecha is not distinct from i.fecha
      and e.tarea_norm = i.tarea_norm and e.ordinal = i.ordinal;
    update _ex e set usado = true where e.id in (select match_id from _in where match_id is not null);

    -- ---------- PASO 2 · cambio de fecha: misma persona + misma tarea ----------
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

    -- ---------- PASO 3 · texto editado: misma persona + misma fecha + texto similar ----------
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

    -- ---------- diferencias campo a campo ----------
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

    -- ---------- observaciones de la importación ----------
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
      select jsonb_build_object('tipo','persona_ausente','persona',p.nombre,'hoja',null,'fila',null,
             'detalle', 'No figura en este archivo; sus ' || count(*) || ' actividades se conservan sin cambios')
        from _ex e join public.personas p on p.id = e.persona_id
        where e.vigente and e.persona_id not in (select persona_id from _in)
        group by p.nombre
      union all
      select jsonb_build_object('tipo','persona_otra_area','persona',p.nombre,'hoja',null,'fila',null,
             'detalle', 'Figura en ' || a.nombre || ' pero viene en un archivo de ' || v_area_nombre)
        from public.personas p join public.areas a on a.id = p.area_id
        where p.nombre_norm in (select persona_norm from _in) and p.area_id <> v_area_id
      union all
      select jsonb_build_object('tipo','archivo_repetido','persona',null,'hoja',null,'fila',null,
             'detalle', 'Archivo idéntico al cargado el ' || to_char(im.created_at at time zone 'America/Argentina/Buenos_Aires','DD/MM/YYYY HH24:MI'))
        from (select created_at from public.importaciones
              where semana_id = v_semana_id and area_id = v_area_id and archivo_hash = v_hash and v_hash is not null
              order by created_at desc limit 1) im
    ) q;

    -- ---------- resultado (vista previa y confirmación devuelven lo mismo) ----------
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

    -- =================== APLICAR CAMBIOS ===================
    insert into public.importaciones (semana_id, area_id, archivo, archivo_hash, usuario_id, usuario_email, origen,
                                      total, nuevas, modificadas, sin_cambios, retiradas, reactivadas, observaciones)
    values (v_semana_id, v_area_id, v_archivo, v_hash, v_uid, v_email, v_origen,
            (v_result->>'total')::int, (v_result->>'nuevas')::int, (v_result->>'modificadas')::int,
            (v_result->>'sin_cambios')::int, (v_result->>'retiradas')::int, (v_result->>'reactivadas')::int, v_obs)
    returning id into v_imp_id;

    -- INSERT: nuevas
    insert into public.planificacion (semana_id, persona_id, area_id, fecha, dia, tarea, prioridad, horas_planificadas,
                                      recursos, riesgos, estado, tarea_norm, ordinal, content_hash, hoja, fila_excel,
                                      origen, importacion_alta_id, importacion_ultima_id)
    select v_semana_id, persona_id, v_area_id, fecha, dia, tarea, prioridad, horas, recursos, riesgos, estado,
           tarea_norm, ordinal, hash, hoja, fila, 'excel', v_imp_id, v_imp_id
    from _in where match_id is null;

    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, origen, usuario_id)
    select id, v_imp_id, 'alta', 'excel', v_uid from public.planificacion where importacion_alta_id = v_imp_id;

    -- UPDATE: modificadas y reactivadas (los campos propios de la app no se tocan)
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

    -- IGNORE: sin cambios → solo se actualiza la ubicación en el Excel (no cuenta como modificación)
    update public.planificacion p set hoja = i.hoja, fila_excel = i.fila
    from _cambios c join _in i on i.idx = c.idx
    where p.id = c.id and c.estaba_vigente and jsonb_array_length(c.cambios) = 0
      and (p.hoja, p.fila_excel) is distinct from (i.hoja, i.fila);

    -- RETIRO: estaban vigentes, la persona vino en el archivo, pero la tarea ya no está
    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, origen, usuario_id)
    select e.id, v_imp_id, 'retiro', 'excel', v_uid
    from _ex e where e.vigente and not e.usado and e.persona_id in (select persona_id from _in);

    update public.planificacion p set vigente = false, importacion_ultima_id = v_imp_id
    from _ex e
    where p.id = e.id and e.vigente and not e.usado and e.persona_id in (select persona_id from _in);

    -- control de integridad: nunca dos actividades vigentes con la misma clave
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

revoke execute on function public.sincronizar_planificacion(jsonb, boolean) from public, anon;
grant  execute on function public.sincronizar_planificacion(jsonb, boolean) to authenticated;
