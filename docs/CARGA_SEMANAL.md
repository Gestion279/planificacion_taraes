# Carga semanal: cambios en la base

Aplicados en Supabase el 28/10/2026. El SQL completo de cada paso queda en el historial de migraciones del proyecto (Supabase → Database → Migrations) con estos nombres:

| Migración | Qué hace |
| --- | --- |
| `modulo_carga_estructura` | Crea `acciones` (24 acciones con su descripción), `planificacion_confirmaciones` y `planificacion_borradores`. Agrega a `planificacion` las columnas `accion_id`, `accion_auto`, `detalle`, `cumplimiento` y `no_planificada`, y a `personas` las columnas `correo` y `es_admin`. Carga los 22 correos. |
| `sincronizar_solo_tareas_excel` | `sincronizar_planificacion` solo retira o compara tareas con `origen = 'excel'`, para no borrar lo cargado en el módulo. |
| `modulo_carga_funciones` | Funciones `cargar_*` que usa el módulo. Validan el correo y aplican las reglas: semana confirmada fija, cada persona solo modifica sus tareas, usuarios solo para el administrador con la clave de carga. |
| `reclasificar_historial_acciones` | Asigna una acción a las tareas históricas de Excel según el verbo con que empiezan (`accion_auto = true`). Quedaron 259 tareas sin acción para revisar a mano. |
| `v_actividades_modulo_carga` | La vista del informe suma las columnas `accion`, `accion_auto`, `detalle`, `cumplimiento`, `no_planificada` y `origen`. Para las tareas del módulo, `alta_posterior` indica si la tarea es no planificada. |

## Reglas del módulo

- Ingreso solo con el correo (sin contraseña). La sesión queda guardada en el dispositivo.
- La semana debe quedar dentro de un mismo lunes a domingo.
- Borrador: se guarda solo y no aparece en el informe hasta confirmarlo.
- Confirmada: quedan fijas acción, detalle y horas planificadas. Se pueden agregar tareas no planificadas y cambiar importancia, horas reales y cumplimiento.
- Las semanas cargadas por Excel se ven como confirmadas: también se les puede cargar horas reales y cumplimiento.
- Un correo de sector puede pasar a otra persona: se desactiva el usuario anterior y se crea uno nuevo con el mismo correo.
