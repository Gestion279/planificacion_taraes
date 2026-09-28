# Planificación de tareas

Aplicación única para la planificación semanal: se sube el Excel de cada área, se sincroniza con Supabase sin duplicar tareas y se analiza la semana, las personas, los riesgos y la evolución.

- **Instalada** en el celular o la computadora se llama **Planificación**.
- **Arquitectura:** GitHub → Vercel (sitio estático + una función) → Supabase.
- **No requiere compilar nada.** Son archivos HTML, CSS y JavaScript que Vercel publica tal cual.

---

## Puesta en marcha

### 1. Supabase (ya está hecho)

El proyecto `planificacion_tareas` ya tiene aplicadas las 7 migraciones de `supabase/migrations/`. No hay que crear usuarios.

**Acceso:** la aplicación es pública para quien tenga el enlace de Vercel. Cualquiera con el enlace puede ver, subir el Excel y cargar horas reales o evaluar riesgos. Lo que **no** se puede hacer es borrar datos ni modificar a mano lo que viene del Excel: esos datos solo cambian subiendo un Excel nuevo, y cada carga queda en el historial con el nombre indicado en *Cargado por*. Conviene compartir el enlace solo con el equipo.

### 2. GitHub

1. Crear un repositorio nuevo (por ejemplo `planificacion`), privado.
2. Subir **el contenido** de esta carpeta, de modo que `index.html` quede en la raíz del repositorio.
   Desde la web de GitHub: *Add file → Upload files* y arrastrar todos los archivos y carpetas.

### 3. Vercel

1. *Add New → Project* e importar el repositorio de GitHub.
2. **Framework Preset:** `Other`. No hace falta configurar comando de build ni carpeta de salida.
3. En **Environment Variables** agregar:

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://ozusksrrariroqejasvb.supabase.co` |
   | `SUPABASE_ANON_KEY` | `sb_publishable_WVvYyPKvJIvRLJV4LnUElg_XqgYVBWe` |

4. **Deploy.**

La clave de `SUPABASE_ANON_KEY` es la **pública** (publishable) y está pensada para el navegador: la seguridad la dan las políticas de acceso de la base. **Nunca** cargar en Vercel la clave `service_role` / `secret`; la función `api/config.js` rechaza ese tipo de clave.

### 4. Primer uso

1. Abrir el enlace de Vercel.
2. En **Carga**, completar *Cargado por* con tu nombre.
3. Ir a **Carga → Migrar el historial de los dashboards anteriores** y elegir los dos HTML actuales (`Planificación_Semanal.html` e `Historico_Planificación.html`).
4. Tocar **Ver qué va a cambiar** y después **Confirmar migración**. Se cargan 13 semanas (5.008 actividades).
5. A partir de ahí, cada semana: **Carga → subir el Excel de cada área → Ver qué va a cambiar → Confirmar carga**.

### Instalar la aplicación

- **Android / Chrome:** menú ⋮ → *Instalar aplicación*.
- **iPhone / Safari:** botón Compartir → *Agregar a pantalla de inicio*.
- **Computadora (Chrome / Edge):** ícono de instalar en la barra de direcciones.

---

## Uso semanal

**Estado (columna H del Excel).** Para que el cumplimiento se pueda medir, usar solo estos cuatro valores: **Pendiente**, **En curso**, **Cumplida** y **Cancelada** (las canceladas no cuentan para el cumplimiento). Conviene fijarlos con una lista desplegable en la plantilla: seleccionar la columna H → *Datos → Validación de datos → Lista* → `Pendiente,En curso,Cumplida,Cancelada`. Cualquier otro texto aparece en Auditoría como *Estado no reconocido*.

**Tiempo (columna E).** Se puede escribir en horas (`1,5`) o en formato hora (`1:30`). Si una celda tiene un valor de hora pero formato numérico (se ve `0,04` en lugar de `1:00`), la carga lo detecta, lo convierte a horas y lo avisa.

**Horas reales.** En *Personas*, con la semana seleccionada: un total por persona para la semana. El desvío compara ese total con lo planificado.

**Jornada.** En el detalle de cada persona se puede cambiar su jornada semanal de referencia (por defecto 44 h). La ocupación y la sobrecarga se calculan sobre esa jornada.

**Riesgos declarados.** Al evaluar probabilidad e impacto de un riesgo, la evaluación queda guardada para esa persona y ese texto: cuando el mismo riesgo vuelve a aparecer en semanas siguientes, ya viene evaluado.

**Auditoría.** Una observación que ya se revisó (por ejemplo, un viaje real de 12 h) se puede marcar como revisada y deja de aparecer para esa persona y esa tarea.

**Personas con el nombre mal escrito.** Si una carga trae una persona nueva con un nombre parecido a una existente, la vista previa lo avisa. Si ya se guardó, en *Carga → Unificar personas* se juntan las dos; el nombre mal escrito queda como alias y las próximas cargas se corrigen solas.

**Cobertura de carga.** El Resumen indica cuántas de las personas habituales (las que planificaron en alguna de las 4 semanas anteriores) cargaron su planificación, y quiénes faltan.

**Semanas de junio.** Están en el Histórico anterior y todavía no se migraron. En *Carga → Migrar el historial*, al elegir los dos HTML quedan marcadas solo las semanas que todavía no existen en la base, para no pisar lo cargado desde los Excel.

## Clave de carga (opcional)

Ver la aplicación es libre para quien tenga el enlace. Si se define una clave, **guardar** (confirmar cargas, horas reales, jornadas, riesgos, auditoría, unificar personas) la pide una vez y el navegador la recuerda. La vista previa de una carga no la necesita.

Para activarla, cambiarla o quitarla, en Supabase → *SQL Editor*:

```sql
select public.definir_clave_carga('la-clave-del-equipo');   -- activar o cambiar
select public.definir_clave_carga(null);                    -- quitar
```

## Estructura

```
index.html               Estructura de la aplicación
manifest.webmanifest     Nombre "Planificación", íconos y colores al instalar
sw.js                    Permite instalar y abrir sin conexión (no guarda datos)
api/config.js            Entrega URL y clave pública desde las variables de Vercel
css/app.css              Estilos (paleta: Moody Beige, Pewter Moon, Dried Grass, Summer Sun, Council Bluffs)
icons/                   Ícono en todos los tamaños
js/
  app.js                 Selector de semana, navegación y caché de datos
  db.js                  Única capa que habla con Supabase
  engine.js              Motor de análisis: ÚNICO lugar donde se calculan indicadores
  excel.js               Lectura del Excel (persona en B1, columnas A–H)
  legacy.js              Migración de los dashboards anteriores
  detalle.js             Detalle de actividad, historial y horas reales
  ui.js                  Tablas, gráficos, formato
  modules/               Resumen, Planificación, Personas, Riesgos y auditoría, Evolución, Carga
supabase/migrations/     Modelo de datos, permisos, sincronización, vistas, acceso público y mejoras
tests/                   Pruebas automáticas del motor y del lector de Excel (npm test)
docs/SINCRONIZACION.md   Cómo se identifica cada tarea y cómo se evita duplicar
```

## Reglas de diseño que conviene mantener

- **Un indicador, un cálculo.** Todo número sale de `js/engine.js`. Un módulo nuevo consume el motor; no recalcula.
- **Riesgo declarado ≠ alerta del sistema ≠ auditoría.** Son tres conceptos separados en el motor y en la pantalla.
- **El Excel nunca pisa lo que se carga en la aplicación** (horas reales, probabilidad e impacto de riesgos).
- **Los umbrales** (jornada de 44 h, 110% de ocupación, 10 h por día, etc.) están juntos en `CONFIG`, al principio de `js/engine.js`.

## Agregar un módulo nuevo

1. Crear `js/modules/nuevo.js` con `export const titulo` y `export async function render(el, app)`.
2. Registrarlo en `MODULOS` dentro de `js/app.js` y agregar el enlace en la navegación de `index.html`.
3. Sumarlo a la lista `SHELL` de `sw.js`.

## Desarrollo local

```
npm i -g vercel
vercel link
vercel env pull
vercel dev
```

## Actualizaciones

Cada vez que se sube un cambio a GitHub, Vercel publica la versión nueva automáticamente. Si se modifican archivos de la aplicación, conviene cambiar `CACHE = 'planificacion-v1'` en `sw.js` (por ejemplo a `v2`), así las aplicaciones instaladas descargan todo de nuevo.

## Pruebas automáticas

```
npm install
npm test
```

Verifican el motor de análisis (indicadores, alertas, auditoría, estados, jornadas) y el lector del Excel (encabezados, fechas, horas en formato hora, filas vacías). Conviene correrlas antes de subir cambios en `js/engine.js` o `js/excel.js`.

## Si más adelante se quiere restringir el acceso

Para limitar quién guarda cambios alcanza con definir la clave de carga (arriba). Para restringir también quién **ve**, la base ya tiene preparadas las columnas de usuario (`usuario_id`, `usuario_email`) y las políticas para usuarios autenticados: habría que quitar los permisos de lectura de `anon` y reponer una pantalla de ingreso.
