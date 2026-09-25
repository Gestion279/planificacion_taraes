# Planificación de tareas

Aplicación única para la planificación semanal: se sube el Excel de cada área, se sincroniza con Supabase sin duplicar tareas y se analiza la semana, las personas, los riesgos y la evolución.

- **Instalada** en el celular o la computadora se llama **Planificación**.
- **Arquitectura:** GitHub → Vercel (sitio estático + una función) → Supabase.
- **No requiere compilar nada.** Son archivos HTML, CSS y JavaScript que Vercel publica tal cual.

---

## Puesta en marcha

### 1. Supabase (ya está hecho)

El proyecto `planificacion_tareas` ya tiene aplicadas las 6 migraciones de `supabase/migrations/`. No hay que crear usuarios.

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
supabase/migrations/     Modelo de datos, permisos, sincronización, vistas y acceso público
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

## Si más adelante se quiere restringir el acceso

La base ya tiene preparadas las columnas de usuario (`usuario_id`, `usuario_email`) y las políticas para usuarios autenticados. Para volver a exigir inicio de sesión alcanza con quitar los permisos de `anon` de la migración 006 y reponer la pantalla de ingreso.
