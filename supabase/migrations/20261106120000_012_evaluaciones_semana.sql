-- Ya aplicada en Supabase el 06/11/2026 desde el SQL Editor. Se guarda acá como registro.
-- =====================================================================
-- Evaluaciones semanales · área Gerencia
-- Base: planificacion_tareas (Supabase). PARA REVISAR: no está aplicado.
--
-- Qué hace:
--   1. Crea el área 3 "Gerencia" para personas que no planifican.
--   2. Impide que alguien de Gerencia tenga planificación o borradores
--      (vale para la app Carga semanal y para la carga por Excel).
--   3. Evaluador = cualquier persona activa del área Gerencia, o el administrador.
--      Se identifica solo con su correo, sin clave y sin límite de cantidad.
--   4. Crea la tabla "evaluaciones_semana".
--   5. Funciones para la vista de evaluadores (identificar, personas,
--      desempeño de una persona, detalle de semana, guardar, listar)
--      y para la app (leer las propias, siempre con el nombre del evaluador).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Área Gerencia
-- ---------------------------------------------------------------------
-- areas.id lo genera la base (identity), por eso se fuerza el 3 y después
-- se adelanta la secuencia para que la próxima área nueva no choque con el 3.
insert into public.areas (id, nombre, activo) overriding system value
values (3, 'Gerencia', true)
on conflict do nothing;
do $$ begin
  if not exists (select 1 from public.areas where id = 3 and nombre = 'Gerencia') then
    raise exception 'El área 3 ya existe con otro nombre o ya hay otra área llamada Gerencia. Revisar antes de seguir.';
  end if;
end $$;
select setval(pg_get_serial_sequence('public.areas', 'id'), greatest((select max(id) from public.areas), 3));

-- ---------------------------------------------------------------------
-- 2. Gerencia no planifica
--    Un disparador en planificacion y en borradores rechaza filas de
--    personas del área 3. Si el Excel trae a alguien de Gerencia, la
--    importación va a fallar con este mensaje.
-- ---------------------------------------------------------------------
create or replace function public.tg_sin_planificacion_gerencia()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if exists (select 1 from public.personas where id = new.persona_id and area_id = 3) then
    raise exception 'SIN_PLANIFICACION: las personas de Gerencia no cargan planificación semanal.';
  end if;
  return new;
end $$;

drop trigger if exists planificacion_sin_gerencia on public.planificacion;
create trigger planificacion_sin_gerencia
  before insert or update of persona_id on public.planificacion
  for each row execute function public.tg_sin_planificacion_gerencia();

drop trigger if exists borradores_sin_gerencia on public.planificacion_borradores;
create trigger borradores_sin_gerencia
  before insert or update of persona_id on public.planificacion_borradores
  for each row execute function public.tg_sin_planificacion_gerencia();

-- Al ingresar a Carga semanal, Gerencia recibe un mensaje claro.
create or replace function public.cargar_ingresar(p_correo text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare r public.personas;
begin
  r := public._cargar_persona(p_correo);
  if r.area_id = 3 then
    raise exception 'SIN_PLANIFICACION: las personas de Gerencia no cargan planificación. La evaluación se hace desde el informe.';
  end if;
  return jsonb_build_object('id', r.id, 'nombre', r.nombre, 'correo', r.correo,
    'tipo', (select nombre from public.areas where id = r.area_id),
    'es_admin', r.es_admin, 'jornada_horas', r.jornada_horas);
end $$;

-- ---------------------------------------------------------------------
-- 3. Evaluador: persona activa del área Gerencia o el administrador,
--    reconocida por correo. Nadie evalúa su propia semana (ver la tabla).
-- ---------------------------------------------------------------------
create or replace function public._evaluador(p_correo text)
returns public.personas
language plpgsql
stable
security definer
set search_path to ''
as $$
declare r public.personas;
begin
  r := public._cargar_persona(p_correo);   -- normaliza el correo y exige persona activa
  if r.area_id is distinct from 3 and not r.es_admin then
    raise exception 'SIN_PERMISO: solo las personas de Gerencia o el administrador pueden evaluar.';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 4. Evaluaciones
-- ---------------------------------------------------------------------
create table if not exists public.evaluaciones_semana (
  id            uuid primary key default gen_random_uuid(),
  persona_id    uuid not null references public.personas(id),
  semana_id     uuid not null references public.semanas(id),
  evaluador_id  uuid not null references public.personas(id),
  valoracion    text check (valoracion in ('Muy buena', 'Buena', 'A mejorar')),  -- opcional
  fortalezas    text check (char_length(fortalezas) <= 1000),
  a_mejorar     text check (char_length(a_mejorar)  <= 1000),
  comentario    text check (char_length(comentario) <= 2000),
  publicada     boolean not null default false,
  publicada_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (persona_id, semana_id, evaluador_id),
  check (persona_id <> evaluador_id),
  check (coalesce(valoracion, fortalezas, a_mejorar, comentario) is not null)  -- algo tiene que tener
);
alter table public.evaluaciones_semana enable row level security;  -- sin políticas: solo vía funciones
create index if not exists evaluaciones_semana_persona_idx
  on public.evaluaciones_semana (persona_id, publicada);

-- ---------------------------------------------------------------------
-- 5. Funciones
-- ---------------------------------------------------------------------

-- 5.1 El informe pregunta "¿este correo es evaluador?" al ingresar
create or replace function public.informe_identificar_evaluador(p_correo text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare r public.personas;
begin
  r := public._evaluador(p_correo);
  return jsonb_build_object('id', r.id, 'nombre', r.nombre, 'correo', r.correo);
end $$;

-- 5.1b Personas que puede evaluar (para el filtro). Excluye Gerencia y al propio evaluador.
create or replace function public.informe_personas(p_correo text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare ev public.personas;
begin
  ev := public._evaluador(p_correo);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'area', a.nombre) order by p.nombre)
    from public.personas p left join public.areas a on a.id = p.area_id
    where p.activo and p.area_id is distinct from 3 and p.id <> ev.id), '[]'::jsonb);
end $$;

-- 5.1c Pantalla Mi desempeño de una persona, vista por un evaluador.
--      Reutiliza cargar_mis_semanas para que los números sean idénticos a los que ve la persona,
--      y suma todas las evaluaciones (publicadas y borradores) con el nombre de cada evaluador.
create or replace function public.informe_desempeno_persona(p_correo text, p_persona uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare ev public.personas; r public.personas;
begin
  ev := public._evaluador(p_correo);
  select * into r from public.personas where id = p_persona and activo and area_id is distinct from 3;
  if not found then raise exception 'NO_ENCONTRADO: persona inexistente o no evaluable.'; end if;
  if r.id = ev.id then raise exception 'SIN_PERMISO: no podés evaluarte a vos mismo.'; end if;
  return jsonb_build_object(
    'persona', jsonb_build_object('id', r.id, 'nombre', r.nombre, 'jornada_horas', r.jornada_horas,
                                  'area', (select nombre from public.areas where id = r.area_id)),
    'semanas', public.cargar_mis_semanas(r.correo),
    'evaluaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'semana_id', e.semana_id, 'semana_inicio', s.fecha_inicio,
        'evaluador_id', e.evaluador_id, 'evaluador', evp.nombre, 'es_mia', e.evaluador_id = ev.id,
        'evaluador_rol', case when evp.area_id = 3 then 'Gerencia' when evp.es_admin then 'Administrador' end,
        'valoracion', e.valoracion, 'fortalezas', e.fortalezas, 'a_mejorar', e.a_mejorar,
        'comentario', e.comentario, 'publicada', e.publicada,
        'publicada_at', e.publicada_at, 'updated_at', e.updated_at) order by s.fecha_inicio desc, evp.nombre)
      from public.evaluaciones_semana e
      join public.semanas s    on s.id   = e.semana_id
      join public.personas evp on evp.id = e.evaluador_id
      where e.persona_id = r.id), '[]'::jsonb));
end $$;

-- 5.1d Detalle de una semana de esa persona (las tareas con su cumplimiento)
create or replace function public.informe_semana_persona(p_correo text, p_persona uuid, p_inicio date, p_fin date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare ev public.personas; v_correo text;
begin
  ev := public._evaluador(p_correo);
  select correo into v_correo from public.personas where id = p_persona and activo and area_id is distinct from 3;
  if v_correo is null then raise exception 'NO_ENCONTRADO: persona inexistente o no evaluable.'; end if;
  if p_persona = ev.id then raise exception 'SIN_PERMISO: no podés evaluarte a vos mismo.'; end if;
  return public.cargar_semana(v_correo, p_inicio, p_fin);
end $$;

-- 5.2 Guardar o publicar una evaluación (desde el informe). La semana se indica por su lunes.
create or replace function public.informe_guardar_evaluacion(
  p_correo text, p_persona uuid, p_lunes date,
  p_valoracion text, p_fortalezas text, p_a_mejorar text, p_comentario text,
  p_publicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare ev public.personas; v_id uuid; v_sem uuid;
begin
  ev := public._evaluador(p_correo);
  select id into v_sem from public.semanas where fecha_inicio = p_lunes;
  if v_sem is null then raise exception 'NO_ENCONTRADO: esa semana no tiene planificación.'; end if;
  if exists (select 1 from public.personas where id = p_persona and area_id = 3) then
    raise exception 'DATOS_INVALIDOS: las personas de Gerencia no se evalúan.';
  end if;
  if coalesce(nullif(btrim(p_valoracion), ''), nullif(btrim(p_fortalezas), ''),
              nullif(btrim(p_a_mejorar), ''), nullif(btrim(p_comentario), '')) is null then
    raise exception 'DATOS_INVALIDOS: escribí un comentario o elegí una valoración.';
  end if;
  insert into public.evaluaciones_semana as e
    (persona_id, semana_id, evaluador_id, valoracion, fortalezas, a_mejorar, comentario,
     publicada, publicada_at)
  values
    (p_persona, v_sem, ev.id, nullif(btrim(p_valoracion), ''),
     nullif(btrim(p_fortalezas), ''), nullif(btrim(p_a_mejorar), ''), nullif(btrim(p_comentario), ''),
     coalesce(p_publicar, false), case when p_publicar then now() end)
  on conflict (persona_id, semana_id, evaluador_id) do update
    set valoracion = excluded.valoracion, fortalezas = excluded.fortalezas,
        a_mejorar = excluded.a_mejorar, comentario = excluded.comentario,
        publicada = excluded.publicada,
        publicada_at = case when excluded.publicada and not e.publicada then now()
                            when excluded.publicada then e.publicada_at end,
        updated_at = now()
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- 5.3 Evaluaciones de una semana (para el informe; cada evaluador ve las de todos)
create or replace function public.informe_evaluaciones(p_correo text, p_semana uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  perform public._evaluador(p_correo);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'persona_id', e.persona_id, 'persona', p.nombre,
      'evaluador_id', e.evaluador_id, 'evaluador', ev.nombre,
      'valoracion', e.valoracion, 'fortalezas', e.fortalezas, 'a_mejorar', e.a_mejorar,
      'comentario', e.comentario, 'publicada', e.publicada,
      'publicada_at', e.publicada_at, 'updated_at', e.updated_at) order by p.nombre, ev.nombre)
    from public.evaluaciones_semana e
    join public.personas p  on p.id  = e.persona_id
    join public.personas ev on ev.id = e.evaluador_id
    where e.semana_id = p_semana), '[]'::jsonb);
end $$;

-- 5.4 Mis evaluaciones publicadas (para Carga semanal · Mi desempeño).
--     Siempre trae el nombre del evaluador: sale de la base, no se escribe a mano.
create or replace function public.cargar_mis_evaluaciones(p_correo text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare r public.personas;
begin
  r := public._cargar_persona(p_correo);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'semana_inicio', s.fecha_inicio, 'semana_fin', s.fecha_fin,
      'evaluador', ev.nombre,
      'evaluador_rol', case when ev.area_id = 3 then 'Gerencia' when ev.es_admin then 'Administrador' end,
      'valoracion', e.valoracion,
      'fortalezas', e.fortalezas, 'a_mejorar', e.a_mejorar, 'comentario', e.comentario,
      'publicada_at', e.publicada_at) order by s.fecha_inicio desc, ev.nombre)
    from public.evaluaciones_semana e
    join public.semanas  s  on s.id  = e.semana_id
    join public.personas ev on ev.id = e.evaluador_id
    where e.persona_id = r.id and e.publicada), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Permisos: las funciones internas no se llaman desde afuera
-- ---------------------------------------------------------------------
revoke execute on function public._evaluador(text) from public, anon, authenticated;
revoke execute on function public.tg_sin_planificacion_gerencia() from public, anon, authenticated;

commit;

-- =====================================================================
-- Después de aplicar:
--   Dar de alta a cada evaluador como persona activa, con su correo y área Gerencia
--   (en Carga semanal > Usuarios, una vez sumado "Gerencia" a las listas de tipo en app.js,
--   o directamente en la tabla personas con area_id = 3).
-- =====================================================================
