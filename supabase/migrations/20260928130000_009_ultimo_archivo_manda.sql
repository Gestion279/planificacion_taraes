-- =========================================================
-- 009 · El último archivo manda + nombres corregidos
--   1) Al volver a cargar una semana y un área, lo que no viene en el
--      archivo se retira, aunque falte la persona completa (antes sus
--      actividades se conservaban). No se borra: queda en el historial y
--      vuelve si se carga de nuevo.
--   2) Si una persona ya no viene en el archivo y viene otra con un nombre
--      parecido y las mismas tareas, es la misma persona con el nombre
--      corregido: sus actividades pasan al nombre nuevo (conservan historial,
--      horas reales y evaluaciones) y el nombre viejo queda como alias.
-- =========================================================
do $$
declare d text;
begin
  d := pg_get_functiondef('public.sincronizar_planificacion(jsonb, boolean)'::regprocedure);

  -- (2) detección de nombres corregidos, antes de emparejar actividades
  d := replace(d,
E'    create temp table _ex on commit drop as\n    select p.*, false as usado from public.planificacion p\n    where p.semana_id = v_semana_id and p.area_id = v_area_id;\n',
E'    create temp table _ex on commit drop as\n    select p.*, false as usado from public.planificacion p\n    where p.semana_id = v_semana_id and p.area_id = v_area_id;\n\n    -- nombres corregidos: una persona que ya no viene en el archivo y otra de nombre parecido\n    -- que sí viene, con al menos la mitad de las mismas tareas, es la misma persona\n    create temp table _renombres on commit drop as\n    select distinct on (v.persona_id) v.persona_id as viejo, n.persona_id as nuevo, pv.nombre as nombre_viejo, pn.nombre as nombre_nuevo\n    from (select distinct persona_id from _ex where vigente and persona_id not in (select persona_id from _in)) v\n    join public.personas pv on pv.id = v.persona_id\n    cross join (select distinct persona_id from _in) n\n    join public.personas pn on pn.id = n.persona_id\n    where extensions.similarity(pv.nombre_norm, pn.nombre_norm) >= 0.5\n      and (select count(distinct e.tarea_norm) from _ex e where e.persona_id = v.persona_id and e.vigente and e.tarea_norm <> ''''\n             and e.tarea_norm in (select i.tarea_norm from _in i where i.persona_id = n.persona_id))\n          >= 0.5 * (select count(distinct e.tarea_norm) from _ex e where e.persona_id = v.persona_id and e.vigente and e.tarea_norm <> '''')\n    order by v.persona_id, extensions.similarity(pv.nombre_norm, pn.nombre_norm) desc;\n    update _ex e set persona_id = r.nuevo from _renombres r where e.persona_id = r.viejo;\n');

  -- (1) el último archivo manda: se retira lo que no vino, aunque falte la persona
  d := replace(d, ' and persona_id in (select persona_id from _in)', '');
  d := replace(d, ' and e.persona_id in (select persona_id from _in)', '');
  d := replace(d,
    E'''detalle'', ''No figura en este archivo; sus '' || count(*) || '' actividades se conservan sin cambios'')',
    E'''detalle'', ''No figura en este archivo: sus '' || count(*) || '' actividades se retiran. Si faltó su hoja por error, volvé a cargar el archivo completo.'')');

  -- observación del nombre corregido
  d := replace(d,
    E'      union all\n      select jsonb_build_object(''tipo'',''persona_ausente'',',
    E'      union all\n      select jsonb_build_object(''tipo'',''persona_renombrada'',''persona'',nombre_nuevo,''hoja'',null,''fila'',null,\n             ''detalle'', ''"'' || nombre_viejo || ''" pasa a llamarse "'' || nombre_nuevo || ''": sus actividades se conservan con el nombre nuevo.'')\n        from _renombres\n      union all\n      select jsonb_build_object(''tipo'',''persona_ausente'',');

  -- aplicar el cambio de nombre en la base (con historial)
  d := replace(d,
    E'    returning id into v_imp_id;\n',
    E'    returning id into v_imp_id;\n\n    -- nombres corregidos: las actividades de la semana y el área pasan a la persona con el nombre nuevo\n    insert into public.historial_planificacion (planificacion_id, importacion_id, tipo, campo, valor_anterior, valor_nuevo, origen, usuario_id)\n    select p.id, v_imp_id, ''modificacion'', ''persona'', r.nombre_viejo, r.nombre_nuevo, ''excel'', v_uid\n    from public.planificacion p join _renombres r on r.viejo = p.persona_id\n    where p.semana_id = v_semana_id and p.area_id = v_area_id;\n    update public.planificacion p set persona_id = r.nuevo from _renombres r\n    where p.persona_id = r.viejo and p.semana_id = v_semana_id and p.area_id = v_area_id;\n');

  -- si el nombre viejo ya no tiene actividades en ninguna semana, se unifica y queda como alias
  d := replace(d,
    E'    update public.semanas set ultima_carga = now() where id = v_semana_id;\n',
    E'    for r in select * from _renombres loop\n      if not exists (select 1 from public.planificacion where persona_id = r.viejo) then\n        insert into public.horas_reales_semana (semana_id, persona_id, horas, cargado_por, updated_at)\n          select semana_id, r.nuevo, horas, cargado_por, updated_at from public.horas_reales_semana where persona_id = r.viejo on conflict do nothing;\n        insert into public.riesgos_evaluados (persona_id, riesgo_norm, riesgo_texto, prob, impacto, cargado_por, updated_at)\n          select r.nuevo, riesgo_norm, riesgo_texto, prob, impacto, cargado_por, updated_at from public.riesgos_evaluados where persona_id = r.viejo on conflict do nothing;\n        insert into public.auditoria_excepciones (persona_id, tarea_norm, regla, nota, cargado_por, created_at)\n          select r.nuevo, tarea_norm, regla, nota, cargado_por, created_at from public.auditoria_excepciones where persona_id = r.viejo on conflict do nothing;\n        update public.personas_alias set persona_id = r.nuevo where persona_id = r.viejo;\n        insert into public.personas_alias (alias_norm, persona_id) select nombre_norm, r.nuevo from public.personas where id = r.viejo\n          on conflict (alias_norm) do update set persona_id = excluded.persona_id;\n        delete from public.personas where id = r.viejo;\n      end if;\n    end loop;\n\n    update public.semanas set ultima_carga = now() where id = v_semana_id;\n');

  if position('_renombres' in d) = 0 or position('persona_renombrada' in d) = 0
     or position('persona_id in (select persona_id from _in)' in d) > 0
     or position('se conservan sin cambios' in d) > 0
     or position('delete from public.personas where id = r.viejo' in d) = 0 then
    raise exception 'No se pudo adaptar la función de sincronización';
  end if;
  execute d;
end $$;
