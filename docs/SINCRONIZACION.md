# Sincronización Excel → Supabase

Este documento describe cómo se identifica cada actividad y cómo se decide
INSERT / UPDATE / IGNORE cuando se carga un Excel de planificación.

Toda la lógica vive en una única función de base de datos:
`public.sincronizar_planificacion(payload jsonb, confirmar boolean)`.
La aplicación solo lee el Excel y envía las filas; **no decide nada**.
Así la regla es una sola, se ejecuta en una transacción y no puede quedar a medias.

---

## 1. Flujo

```
Excel (una hoja por persona, columnas A–H)
  ↓  lectura en el navegador (SheetJS) — mismo mecanismo que hoy
Filas crudas  { hoja, persona(B1), fila, fecha, dia, tarea, prioridad, horas, recursos, riesgos, estado }
  ↓  sincronizar_planificacion(payload, confirmar = false)   → VISTA PREVIA
Resumen: nuevas / modificadas / sin cambios / retiradas / reactivadas / observaciones
  ↓  el usuario confirma
  ↓  sincronizar_planificacion(payload, confirmar = true)    → APLICA (1 transacción)
planificacion + historial_planificacion + importaciones
```

La vista previa ejecuta **exactamente el mismo código** que la confirmación y al
final revierte todo. Lo que el usuario ve antes de confirmar es lo que va a pasar.

## 2. Estructura del Excel (sin cambios para el usuario)

| Col | Contenido   | Campo                |
|-----|-------------|----------------------|
| B1  | Persona     | `personas.nombre`    |
| A   | Fecha       | `fecha`              |
| B   | Día         | `dia`                |
| C   | Tarea       | `tarea`              |
| D   | Importancia | `prioridad`          |
| E   | Tiempo      | `horas_planificadas` |
| F   | Recursos    | `recursos`           |
| G   | Riesgos     | `riesgos`            |
| H   | Estado      | `estado`             |

- La **persona** se toma de la celda B1 (si está vacía, del nombre de la hoja) y se
  identifica por su nombre normalizado (sin tildes, minúsculas). No hay tablas por
  persona ni dependencia del nombre de la hoja.
- El **área** se toma del nombre del archivo ("Gestión" / "Producción") y el usuario
  la confirma en la pantalla de carga.
- La **semana** es el lunes de la semana planificada. Se propone automáticamente
  a partir de las fechas de las filas (el "del 18-09" del nombre del archivo es el
  viernes de preparación, no la semana) y el usuario la confirma.

## 3. Alcance de una carga

Una carga afecta **solo a su semana y a su área**. Subir el archivo de Producción
nunca toca actividades de Gestión, y viceversa.

Dentro de ese alcance, además, **solo se retiran tareas de personas que vinieron en
el archivo**. Si falta la hoja de una persona, sus tareas se conservan y se genera
la observación `persona_ausente` (protege contra archivos incompletos).

## 4. Identificación de una actividad

Cada actividad recibe un **ID interno (uuid) en su primera carga**; ese ID es el que
se conserva para siempre. En cargas siguientes, cada fila del Excel se vincula con
una actividad existente mediante tres pasos, en este orden:

| Paso | Regla | Resuelve |
|------|-------|----------|
| 1. Exacta | persona + fecha + tarea normalizada + **ordinal** | El caso normal |
| 2. Cambio de fecha | persona + tarea normalizada, sin pareja en el paso 1 | Tarea movida de día: se actualiza la fecha, **no** "eliminada + nueva" |
| 3. Texto editado | persona + fecha + similitud del texto ≥ 0,6 (trigramas) | Correcciones de redacción |

- **Tarea normalizada:** minúsculas, sin tildes ni signos, espacios simples. "Órdenes de
  pago" y "ordenes  de pago." son la misma tarea.
- **Ordinal:** número de aparición de la misma tarea, misma persona, mismo día. Los
  datos actuales tienen 141 filas idénticas dentro de una misma semana; sin el ordinal,
  esas filas serían indistinguibles.
- Cada actividad existente se vincula **como máximo una vez** (emparejamiento uno a uno).
- La similitud del paso 3 se exige **en el mismo día**: cambiar fecha *y* texto a la vez
  se considera una tarea nueva (evita vincular tareas que no tienen relación).

## 5. Decisión por fila

| Situación | Acción | Historial |
|-----------|--------|-----------|
| Fila sin pareja | **INSERT** | `alta` |
| Pareja con algún campo distinto | **UPDATE** | una fila `modificacion` por campo (valor anterior → nuevo) |
| Pareja idéntica (mismo hash de contenido) | **IGNORE** | — |
| Actividad retirada que vuelve a aparecer | **UPDATE** + reactivación | `reactivacion` |
| Actividad vigente que ya no está en el Excel | se marca `vigente = false` (no se borra) | `retiro` |

El hash de contenido cubre: fecha, día, tarea, prioridad, horas, recursos, riesgos y estado.

Si la fila solo cambió de posición en la hoja, se actualiza su ubicación (`hoja`,
`fila_excel`) sin contarse como modificación.

## 6. Campos propios de la aplicación

`horas_reales`, `riesgo_prob` y `riesgo_impacto` se cargan en la aplicación y **el
Excel nunca los pisa**. Sus cambios también quedan en el historial, con origen `app`.

## 7. Observaciones de la carga

Se importan igual, pero se informan en el resumen y quedan guardadas en `importaciones`:

| Tipo | Significado |
|------|-------------|
| `sin_fecha` | Fecha vacía o no reconocida |
| `fecha_fuera_semana` | La fecha no pertenece a la semana de la carga |
| `dia_inconsistente` | El día escrito no coincide con la fecha |
| `horas_invalidas` | El tiempo no se pudo interpretar como número |
| `prioridad_no_reconocida` | La importancia no es Alta / Media / Baja |
| `posible_duplicado` | Misma tarea, persona y día más de una vez |
| `persona_ausente` | Persona con tareas en la semana que no vino en el archivo |
| `persona_otra_area` | La persona figura en otra área |
| `archivo_repetido` | Mismo archivo que una carga anterior |

La **calidad de los datos** (tareas sin prioridad, sin recursos, sin riesgo, etc.) no se
informa acá, sino en el módulo *Riesgos y Auditoría*, para no duplicar.

## 8. Garantías

- **Atomicidad:** todo o nada, en una sola transacción.
- **Sin duplicados:** al final de cada carga se verifica que no existan dos actividades
  vigentes con la misma clave; si existieran, se revierte la carga completa.
- **Acceso:** la aplicación es pública para quien tenga el enlace. Las tablas no admiten
  inserciones ni borrados directos: los datos del Excel solo cambian a través de esta
  función, y cada carga queda registrada con el nombre indicado en *Cargado por*.

## 9. Pruebas realizadas (25/09/2026)

| Escenario | Resultado |
|-----------|-----------|
| Primera carga (6 filas) | 6 nuevas, 4 observaciones correctas |
| Mismo archivo otra vez | 0 nuevas, 6 sin cambios, aviso `archivo_repetido` |
| Horas 3→4 y prioridad Media→Alta | 1 modificada, 2 cambios en historial |
| Tarea movida del miércoles al jueves | Identificada como `cambio_fecha`, mismo ID |
| Texto de tarea corregido | Identificada como `texto_editado`, mismo ID |
| Tarea borrada del Excel | Retirada (no eliminada) |
| Tarea borrada que vuelve | Reactivada, sin duplicar |
| Horas reales cargadas en la app + nueva carga | Horas reales conservadas |
| Visitante con el enlace (acceso público, migración 006) | Puede ver, importar y cargar horas reales; no puede borrar ni editar datos del Excel |
