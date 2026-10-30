# Comparar personas

Hoja nueva del informe de planificación de tareas. Permite elegir un grupo de personas y un tipo de tarea (acción) y comparar cuánto tiempo le dedica cada una, tarea por tarea, juntando en una misma fila las tareas iguales o parecidas que cargaron distintas personas.

## Cómo verla

Es una página estática: no necesita servidor ni instalar nada.

- **En la computadora:** abrir `index.html` con el navegador.
- **Publicada con GitHub Pages:** en el repositorio, ir a *Settings → Pages*, elegir la rama `main` y la carpeta raíz (o `/docs` si se sube dentro de esa carpeta) y guardar. La página queda en `https://<usuario>.github.io/<repositorio>/`.

## Archivos

| Archivo | Qué tiene |
|---|---|
| `index.html` | Estructura de la página. |
| `styles.css` | Estilos, con los mismos colores y tipografía que el resto del informe. |
| `app.js` | Lógica: selección de personas y acción, armado de la tabla, detección de tareas parecidas y decisiones del usuario. |
| `datos.js` | Datos del período 1 jun al 30 oct 2026. Es el único archivo que hay que cambiar para actualizar la información. |

## Qué hace la página

1. **Qué comparar.** Se eligen las personas (se agregan y quitan una por una, o con los atajos «Todas las que hacen *acción*», «Solo las que hacen la misma tarea» y «Quitar todas»), la acción, opcionalmente una tarea puntual, y la medida: horas por semana, horas acumuladas o semanas.
2. **La acción en la semana de cada persona.** Horas por semana que cada persona elegida dedica a esa acción y qué porcentaje de su semana representa.
3. **Tarea por tarea.** Una fila por tarea y una columna por persona. Cuando dos o más personas hacen la misma tarea, la última columna muestra la diferencia (horas por semana de quien más tarda ÷ las de quien menos tarda). Se puede filtrar para ver solo las tareas compartidas.
4. **Detalle de una fila.** Al tocarla se ve cómo cargó la tarea cada persona. Si la fila junta tareas parecidas, se puede confirmar («Sí, compararlas juntas») o separar («No, separar»). También se puede sumar a mano una tarea equivalente que se cargó con otras palabras.

## Cómo se detectan las tareas iguales o parecidas

Dentro de una misma acción y entre personas distintas:

- **Iguales:** el detalle coincide después de pasarlo a minúsculas y quitar acentos, signos y palabras como «de», «la», «en».
- **Parecidas:** los detalles comparten al menos 2 palabras clave y esas palabras son al menos el 75 % de las del detalle más corto. Las palabras se comparan por sus primeras 5 letras, así «Carga» y «Cargar» cuentan como la misma.

Las parecidas aparecen como «por confirmar» hasta que alguien las confirma. Los umbrales están en la función `parecidas()` de `app.js`.

**Importante:** las confirmaciones, separaciones y uniones manuales se guardan en el navegador de quien las hace (`localStorage`). Si se quiere que valgan para todos los usuarios, hay que guardarlas en la base de datos del sistema (ver «Próximos pasos»).

## Datos

`datos.js` define `window.DATOS` con cuatro partes:

```js
window.DATOS = {
  periodo: "1 jun al 30 oct 2026",

  // Promedio de horas planificadas por semana y cantidad de semanas con planificación.
  personas: [
    { nombre: "Luis Behr", horasSemana: 39.9, semanas: 14 }
  ],

  // Horas por semana de cada persona en cada acción.
  horasPorAccion: [
    { persona: "Luis Behr", accion: "Registrar", horasSemana: 18 }
  ],

  // Tareas tal como las cargó cada persona. semanas y horasAcumuladas pueden ser null.
  tareas: [
    { id: "t3", persona: "Luis Behr", accion: "Registrar",
      detalle: "Carga de rendiciones en Bejerman: rendiciones y gastos abonados en Tesorería",
      semanas: 13, horasSemana: 8.8, horasAcumuladas: 115 }
  ]
};
```

Reglas:

- `id` de cada tarea tiene que ser único y no cambiar entre actualizaciones, porque las decisiones guardadas lo usan.
- Los nombres de persona y de acción tienen que escribirse igual en las tres listas.
- Usar punto decimal (`8.8`); la página muestra coma.

Los datos incluidos son los del informe: todas las personas y sus horas por acción, y solo las tareas repetitivas que el informe detallaba (8 tareas de Registrar y Conciliar). Para que la comparación tarea por tarea sea completa, hay que cargar en `tareas` todas las tareas del período.

## Próximos pasos sugeridos

- Generar `datos.js` automáticamente desde la base de la carga semanal (una consulta que agrupe por persona, acción y detalle).
- Guardar las decisiones de agrupamiento en esa base, en una tabla con la clave del grupo, la decisión (`confirmado`, `rechazado` o `union`), quién la tomó y cuándo.
- Agregar el filtro de período cuando los datos traigan la fecha de cada semana.
