-- 009c · Si un nombre nuevo se toma como corrección de otro, no se muestra además el aviso de "persona parecida"
do $$
declare d text;
begin
  d := pg_get_functiondef('public.sincronizar_planificacion(jsonb, boolean)'::regprocedure);
  d := replace(d, 'from _nuevas n cross join lateral (',
    'from (select * from _nuevas where persona_norm not in (select p2.nombre_norm from public.personas p2 join _renombres rn on rn.nuevo = p2.id)) n cross join lateral (');
  if position('join _renombres rn on rn.nuevo = p2.id' in d) = 0 then raise exception 'No se pudo adaptar la función'; end if;
  execute d;
end $$;
