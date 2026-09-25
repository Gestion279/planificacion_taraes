-- =========================================================
-- 001 · Modelo base de planificación
-- =========================================================
create extension if not exists pg_trgm with schema extensions;

-- ---------- Funciones de normalización (única fuente de verdad) ----------
create or replace function public.norm_texto(t text)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(
        translate(lower(coalesce(t,'')),
          'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc'),
        '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g')),
  '');
$$;

create or replace function public.norm_prioridad(t text)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when public.norm_texto(t) ~ '(alta|critic|urgent)' then 'Alta'
    when public.norm_texto(t) ~ '(media|moder)'         then 'Media'
    when public.norm_texto(t) ~ 'baja'                  then 'Baja'
    else null end;
$$;

create or replace function public.parse_horas(t text)
returns numeric language plpgsql immutable parallel safe
set search_path = ''
as $$
declare s text := btrim(lower(coalesce(t,'')));
        m text[];
begin
  if s = '' or s = '-' then return null; end if;
  -- h:mm
  m := regexp_match(s, '^(\d{1,2}):(\d{2})');
  if m is not null then return round(m[1]::numeric + m[2]::numeric/60, 2); end if;
  -- "30 min"
  m := regexp_match(s, '^(\d+(?:[.,]\d+)?)\s*(min|m\b)');
  if m is not null then return round(replace(m[1],',','.')::numeric/60, 2); end if;
  -- número (con coma o punto), opcional "h"/"hs"
  m := regexp_match(s, '^(\d+(?:[.,]\d+)?)');
  if m is not null then return round(replace(m[1],',','.')::numeric, 2); end if;
  return null;
end $$;

create or replace function public.dia_de_fecha(f date)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[extract(dow from f)::int + 1];
$$;

-- ---------- Catálogos ----------
create table public.areas (
  id         smallint generated always as identity primary key,
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.personas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  nombre_norm text not null unique,
  area_id     smallint references public.areas(id),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Semanas (identificadas por su lunes) ----------
create table public.semanas (
  id           uuid primary key default gen_random_uuid(),
  fecha_inicio date not null unique check (extract(isodow from fecha_inicio) = 1),
  fecha_fin    date generated always as (fecha_inicio + 6) stored,
  estado       text not null default 'abierta' check (estado in ('abierta','cerrada')),
  ultima_carga timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- Historial de cargas ----------
create table public.importaciones (
  id            uuid primary key default gen_random_uuid(),
  semana_id     uuid not null references public.semanas(id),
  area_id       smallint not null references public.areas(id),
  archivo       text not null,
  archivo_hash  text,
  usuario_id    uuid,          -- auth.users.id (sin FK para no acoplar al esquema auth)
  usuario_email text,
  origen        text not null default 'app' check (origen in ('app','migracion')),
  total         int not null default 0,
  nuevas        int not null default 0,
  modificadas   int not null default 0,
  sin_cambios   int not null default 0,
  retiradas     int not null default 0,
  reactivadas   int not null default 0,
  observaciones jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index on public.importaciones (semana_id, area_id, created_at desc);

-- ---------- Actividades ----------
create table public.planificacion (
  id                 uuid primary key default gen_random_uuid(),
  semana_id          uuid not null references public.semanas(id),
  persona_id         uuid not null references public.personas(id),
  area_id            smallint not null references public.areas(id),
  -- datos que vienen del Excel
  fecha              date,
  dia                text,
  tarea              text,
  prioridad          text check (prioridad in ('Alta','Media','Baja')),
  horas_planificadas numeric(6,2),
  recursos           text,
  riesgos            text,
  estado             text,
  -- identificación / sincronización
  tarea_norm         text not null default '',
  ordinal            smallint not null default 1,
  content_hash       text not null,
  vigente            boolean not null default true,
  hoja               text,
  fila_excel         int,
  -- datos que se cargan en la aplicación (el Excel NUNCA los pisa)
  horas_reales       numeric(6,2) check (horas_reales >= 0),
  riesgo_prob        text check (riesgo_prob    in ('bajo','moderado','alto')),
  riesgo_impacto     text check (riesgo_impacto in ('bajo','moderado','alto')),
  -- trazabilidad
  origen             text not null default 'excel' check (origen in ('excel','app')),
  importacion_alta_id    uuid references public.importaciones(id),
  importacion_ultima_id  uuid references public.importaciones(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index planificacion_semana_idx  on public.planificacion (semana_id, area_id) where vigente;
create index planificacion_clave_idx   on public.planificacion (semana_id, persona_id, fecha, tarea_norm, ordinal);
create index planificacion_persona_idx on public.planificacion (persona_id, semana_id);
create index planificacion_trgm_idx    on public.planificacion using gin (tarea_norm extensions.gin_trgm_ops);

-- ---------- Historial de modificaciones ----------
create table public.historial_planificacion (
  id               bigint generated always as identity primary key,
  planificacion_id uuid not null references public.planificacion(id) on delete cascade,
  importacion_id   uuid references public.importaciones(id),
  tipo             text not null check (tipo in ('alta','modificacion','retiro','reactivacion')),
  campo            text,
  valor_anterior   text,
  valor_nuevo      text,
  origen           text not null check (origen in ('excel','app')),
  usuario_id       uuid,
  created_at       timestamptz not null default now()
);
create index on public.historial_planificacion (planificacion_id, created_at);
create index on public.historial_planificacion (importacion_id);

-- ---------- updated_at ----------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger planificacion_touch before update on public.planificacion
for each row execute function public.tg_touch_updated_at();

-- ---------- Historial de cambios hechos desde la aplicación ----------
-- (los cambios del Excel los registra la función de sincronización)
create or replace function public.tg_log_cambios_app()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c text; va text; vn text;
begin
  if current_setting('app.origen_sync', true) = 'excel' then return new; end if;
  foreach c in array array['horas_reales','riesgo_prob','riesgo_impacto'] loop
    execute format('select ($1).%I::text, ($2).%I::text', c, c) into va, vn using old, new;
    if va is distinct from vn then
      insert into public.historial_planificacion
        (planificacion_id, tipo, campo, valor_anterior, valor_nuevo, origen, usuario_id)
      values (new.id, 'modificacion', c, va, vn, 'app', auth.uid());
    end if;
  end loop;
  return new;
end $$;

create trigger planificacion_log_app after update on public.planificacion
for each row execute function public.tg_log_cambios_app();

-- ---------- Datos iniciales ----------
insert into public.areas (nombre) values ('Gestión'), ('Producción');
