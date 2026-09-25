-- =========================================================
-- 002 · Seguridad: RLS y permisos
--   · anon: sin acceso
--   · authenticated: lectura de todo; edición SOLO de campos propios de la app
--   · escrituras del Excel: solo vía public.sincronizar_planificacion()
-- =========================================================
alter table public.areas                   enable row level security;
alter table public.personas                enable row level security;
alter table public.semanas                 enable row level security;
alter table public.importaciones           enable row level security;
alter table public.planificacion           enable row level security;
alter table public.historial_planificacion enable row level security;

revoke all on public.areas, public.personas, public.semanas, public.importaciones,
              public.planificacion, public.historial_planificacion
  from anon, authenticated;

grant select on public.areas, public.personas, public.semanas, public.importaciones,
                public.planificacion, public.historial_planificacion
  to authenticated;

-- edición en la app: solo estas columnas
grant update (horas_reales, riesgo_prob, riesgo_impacto) on public.planificacion to authenticated;

create policy lectura_autenticados on public.areas                   for select to authenticated using (true);
create policy lectura_autenticados on public.personas                for select to authenticated using (true);
create policy lectura_autenticados on public.semanas                 for select to authenticated using (true);
create policy lectura_autenticados on public.importaciones           for select to authenticated using (true);
create policy lectura_autenticados on public.planificacion           for select to authenticated using (true);
create policy lectura_autenticados on public.historial_planificacion for select to authenticated using (true);

create policy edicion_campos_app on public.planificacion
  for update to authenticated using (vigente) with check (vigente);

-- funciones utilitarias: no exponer por la API salvo lo necesario
revoke execute on function public.tg_log_cambios_app()  from public, anon, authenticated;
revoke execute on function public.tg_touch_updated_at() from public, anon, authenticated;
