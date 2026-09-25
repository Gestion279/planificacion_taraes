create index if not exists importaciones_area_idx          on public.importaciones (area_id);
create index if not exists personas_area_idx               on public.personas (area_id);
create index if not exists planificacion_area_idx          on public.planificacion (area_id);
create index if not exists planificacion_imp_alta_idx      on public.planificacion (importacion_alta_id);
create index if not exists planificacion_imp_ultima_idx    on public.planificacion (importacion_ultima_id);
drop index if exists public.planificacion_trgm_idx;
