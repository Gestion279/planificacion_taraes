-- =========================================================
-- 006 · Acceso público por enlace (sin usuarios)
--   Cualquiera con el enlace de la aplicación puede ver, cargar el
--   Excel y editar los campos propios de la aplicación.
--   Nada se borra: toda carga y edición queda en el historial.
-- =========================================================

-- trazabilidad sin usuarios: nombre opcional de quien carga
alter table public.importaciones add column if not exists cargado_por text;

-- lectura pública
grant select on public.areas, public.personas, public.semanas, public.importaciones,
                public.planificacion, public.historial_planificacion to anon;
grant select on public.v_primera_carga, public.v_actividades, public.v_cambios, public.v_semanas to anon;

create policy lectura_publica on public.areas                   for select to anon using (true);
create policy lectura_publica on public.personas                for select to anon using (true);
create policy lectura_publica on public.semanas                 for select to anon using (true);
create policy lectura_publica on public.importaciones           for select to anon using (true);
create policy lectura_publica on public.planificacion           for select to anon using (true);
create policy lectura_publica on public.historial_planificacion for select to anon using (true);

-- edición pública SOLO de los campos propios de la aplicación
grant update (horas_reales, riesgo_prob, riesgo_impacto) on public.planificacion to anon;
create policy edicion_publica_campos_app on public.planificacion
  for update to anon using (vigente) with check (vigente);

-- sincronización: ya no exige usuario autenticado y guarda "cargado por"
do $$
declare d text;
begin
  d := pg_get_functiondef('public.sincronizar_planificacion(jsonb, boolean)'::regprocedure);
  d := replace(d,
    E'  if v_uid is null and session_user = ''authenticator'' then\n    raise exception ''Se requiere un usuario autenticado para importar.'';\n  end if;\n',
    E'  -- acceso público por enlace: no se exige usuario autenticado\n');
  d := replace(d, 'archivo_hash, usuario_id, usuario_email, origen,', 'archivo_hash, usuario_id, usuario_email, cargado_por, origen,');
  d := replace(d, 'v_hash, v_uid, v_email, v_origen,', 'v_hash, v_uid, v_email, nullif(btrim(p_payload->>''cargado_por''), ''''), v_origen,');
  if position('Se requiere un usuario autenticado' in d) > 0 or position('cargado_por, origen' in d) = 0 then
    raise exception 'No se pudo adaptar la función de sincronización';
  end if;
  execute d;
end $$;

grant execute on function public.sincronizar_planificacion(jsonb, boolean) to anon;
