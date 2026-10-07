-- =====================================================================
-- Propuestas de mejora: seguimiento persistente (detectada → implementada → resultado)
-- Sigue el mismo patrón que el resto de la base:
--   · lectura pública por enlace (anon), escritura solo por función con la clave de carga
--   · nada se borra: una propuesta que no sigue se marca "Descartada"
--   · cada cambio queda en propuestas_historial
-- No modifica ninguna tabla existente.
-- =====================================================================

create table if not exists public.propuestas_mejora (
  id                   uuid primary key default gen_random_uuid(),
  titulo               text not null check (length(btrim(titulo)) > 0),
  problema             text,
  fuente               text not null default 'Otro'
                       check (fuente in ('Planificación','Carga','Cumplimiento','Riesgo','Auditoría','Tarea repetitiva','Otro')),
  origen_clave         text,          -- situación que la originó (id del hallazgo, ej. 'sobrecarga')
  tarea_clave          text,          -- clave de tarea del motor cuando surge de una tarea repetitiva: permite medir antes/después
  causa                text,
  propuesta            text,
  tipo                 text check (tipo in ('Eliminar','Simplificar','Automatizar','Estandarizar','Redistribuir','Mejorar control','Otro')),
  impacto              text check (impacto in ('Bajo','Medio','Alto')),
  esfuerzo             text check (esfuerzo in ('Bajo','Medio','Alto')),
  responsable          text,
  estado               text not null default 'Detectada'
                       check (estado in ('Detectada','En análisis','Propuesta','Aprobada','En implementación','Implementada','Descartada')),
  area                 text,
  horas_mes_base       numeric check (horas_mes_base is null or horas_mes_base >= 0),   -- horas que consume hoy (dato)
  ahorro_pct           numeric check (ahorro_pct is null or (ahorro_pct >= 0 and ahorro_pct <= 100)), -- lo estima quien evalúa
  resultado_esperado   text,
  resultado_obtenido   text,
  fecha_implementacion date,
  cargado_por          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.propuestas_historial (
  id             bigint generated always as identity primary key,
  propuesta_id   uuid not null references public.propuestas_mejora(id),
  campo          text,             -- null = alta de la propuesta
  valor_anterior text,
  valor_nuevo    text,
  cargado_por    text,
  created_at     timestamptz not null default now()
);
create index if not exists propuestas_historial_propuesta_idx on public.propuestas_historial (propuesta_id);

alter table public.propuestas_mejora enable row level security;
alter table public.propuestas_historial enable row level security;
drop policy if exists lectura_publica on public.propuestas_mejora;
create policy lectura_publica on public.propuestas_mejora for select to anon, authenticated using (true);
drop policy if exists lectura_publica on public.propuestas_historial;
create policy lectura_publica on public.propuestas_historial for select to anon, authenticated using (true);

-- Alta (p_id null) o modificación de una propuesta. Solo se guardan los campos de la lista.
create or replace function public.guardar_propuesta(p_id uuid, p_datos jsonb, p_clave text default null, p_cargado_por text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  campos text[] := array['titulo','problema','fuente','origen_clave','tarea_clave','causa','propuesta','tipo','impacto','esfuerzo',
                         'responsable','estado','area','horas_mes_base','ahorro_pct','resultado_esperado','resultado_obtenido','fecha_implementacion'];
  c text; anterior jsonb; nuevo jsonb; v_id uuid; quien text := nullif(btrim(p_cargado_por), '');
begin
  perform public._verificar_clave(p_clave);
  -- textos vacíos se guardan como null
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '' then 'null'::jsonb else v end), '{}'::jsonb)
    into nuevo from jsonb_each(p_datos) as e(k, v) where k = any(campos);

  if p_id is null then
    insert into public.propuestas_mejora (titulo, cargado_por) values (coalesce(nuevo->>'titulo', 'Propuesta sin título'), quien)
      returning id into v_id;
    insert into public.propuestas_historial (propuesta_id, campo, valor_nuevo, cargado_por) values (v_id, null, nuevo->>'titulo', quien);
    anterior := to_jsonb((select x from public.propuestas_mejora x where x.id = v_id));
  else
    v_id := p_id;
    anterior := to_jsonb((select x from public.propuestas_mejora x where x.id = v_id));
    if anterior is null then raise exception 'La propuesta no existe.'; end if;
  end if;

  update public.propuestas_mejora t set
    titulo               = coalesce(case when nuevo ? 'titulo' then nuevo->>'titulo' end, t.titulo),
    problema             = case when nuevo ? 'problema' then nuevo->>'problema' else t.problema end,
    fuente               = coalesce(case when nuevo ? 'fuente' then nuevo->>'fuente' end, t.fuente),
    origen_clave         = case when nuevo ? 'origen_clave' then nuevo->>'origen_clave' else t.origen_clave end,
    tarea_clave          = case when nuevo ? 'tarea_clave' then nuevo->>'tarea_clave' else t.tarea_clave end,
    causa                = case when nuevo ? 'causa' then nuevo->>'causa' else t.causa end,
    propuesta            = case when nuevo ? 'propuesta' then nuevo->>'propuesta' else t.propuesta end,
    tipo                 = case when nuevo ? 'tipo' then nuevo->>'tipo' else t.tipo end,
    impacto              = case when nuevo ? 'impacto' then nuevo->>'impacto' else t.impacto end,
    esfuerzo             = case when nuevo ? 'esfuerzo' then nuevo->>'esfuerzo' else t.esfuerzo end,
    responsable          = case when nuevo ? 'responsable' then nuevo->>'responsable' else t.responsable end,
    estado               = coalesce(case when nuevo ? 'estado' then nuevo->>'estado' end, t.estado),
    area                 = case when nuevo ? 'area' then nuevo->>'area' else t.area end,
    horas_mes_base       = case when nuevo ? 'horas_mes_base' then (nuevo->>'horas_mes_base')::numeric else t.horas_mes_base end,
    ahorro_pct           = case when nuevo ? 'ahorro_pct' then (nuevo->>'ahorro_pct')::numeric else t.ahorro_pct end,
    resultado_esperado   = case when nuevo ? 'resultado_esperado' then nuevo->>'resultado_esperado' else t.resultado_esperado end,
    resultado_obtenido   = case when nuevo ? 'resultado_obtenido' then nuevo->>'resultado_obtenido' else t.resultado_obtenido end,
    fecha_implementacion = case when nuevo ? 'fecha_implementacion' then (nuevo->>'fecha_implementacion')::date else t.fecha_implementacion end,
    cargado_por          = coalesce(quien, t.cargado_por),
    updated_at           = now()
  where t.id = v_id;

  -- historial: un registro por campo que cambió (en el alta, solo los que tienen valor)
  foreach c in array campos loop
    if nuevo ? c and (anterior->>c) is distinct from (to_jsonb((select x from public.propuestas_mejora x where x.id = v_id))->>c)
       and not (p_id is null and c = 'titulo') then
      insert into public.propuestas_historial (propuesta_id, campo, valor_anterior, valor_nuevo, cargado_por)
      values (v_id, c, case when p_id is null then null else anterior->>c end,
              to_jsonb((select x from public.propuestas_mejora x where x.id = v_id))->>c, quien);
    end if;
  end loop;
  return v_id;
end $function$;

grant execute on function public.guardar_propuesta(uuid, jsonb, text, text) to anon, authenticated;
