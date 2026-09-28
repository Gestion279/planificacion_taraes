-- 009b · En la función, el alias "r" de _renombres chocaba con la variable r (record) de plpgsql
do $$
declare d text;
begin
  d := pg_get_functiondef('public.sincronizar_planificacion(jsonb, boolean)'::regprocedure);
  d := replace(d, 'update _ex e set persona_id = r.nuevo from _renombres r where e.persona_id = r.viejo;',
                  'update _ex e set persona_id = rn.nuevo from _renombres rn where e.persona_id = rn.viejo;');
  d := replace(d, E'select p.id, v_imp_id, ''modificacion'', ''persona'', r.nombre_viejo, r.nombre_nuevo, ''excel'', v_uid\n    from public.planificacion p join _renombres r on r.viejo = p.persona_id',
                  E'select p.id, v_imp_id, ''modificacion'', ''persona'', rn.nombre_viejo, rn.nombre_nuevo, ''excel'', v_uid\n    from public.planificacion p join _renombres rn on rn.viejo = p.persona_id');
  d := replace(d, E'update public.planificacion p set persona_id = r.nuevo from _renombres r\n    where p.persona_id = r.viejo and',
                  E'update public.planificacion p set persona_id = rn.nuevo from _renombres rn\n    where p.persona_id = rn.viejo and');
  if position('_renombres r ' in d) > 0 or position('from _renombres rn where e.persona_id = rn.viejo' in d) = 0 then
    raise exception 'No se pudo corregir la función';
  end if;
  execute d;
end $$;
