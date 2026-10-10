# Contrato de eventos (`eventos_sync`)

Las apps de potreros no comparten un "estado": comparten un **registro de eventos de solo
agregar**. Cada dispositivo escribe una fila por cada cosa que hace y reconstruye el estado
aplicando las filas de los demás. Este documento es el contrato entre quien escribe esas filas
(la app, `template/potreros.template.html`) y quien las lee (la propia app, los scripts de la PC
y Hermes).

> **Regla de oro.** Agregar un campo opcional al `detalle` es compatible. **Renombrar, quitar o
> cambiar el tipo de un campo, o cambiar el sentido de un `tipo`, rompe a los lectores**: hay que
> actualizar este documento, `tests/probar_contrato_eventos.js` y avisar a los dueños de los
> scripts de la última sección. El CI falla si un `tipo` del template no está en la tabla de abajo.

## La fila

Tabla `eventos_sync` (Supabase, proyecto `skkknfjpwcstefcroqjt`):

| Columna | Tipo | Quién la pone | Notas |
|---|---|---|---|
| `id` | uuid | servidor | clave primaria, no es el id del evento |
| `event_id` | uuid, **UNIQUE** | la app (`crypto.randomUUID()`) | identifica al evento. Un reintento manda el mismo id y el servidor contesta `23505`, que la app cuenta como "ya enviado". Tiene que ser un UUID real: un id de otro formato rompió producción un día entero |
| `establecimiento` | text | la app | el *stream*: `la_vuelta`, `maria_laura`, `pone_chico`. Cada app lee y escribe su stream; solo los traslados escriben en el del otro campo |
| `dispositivo` | text | la app | id de este equipo (no es el nombre de la persona) |
| `tipo` | text | la app | ver la tabla de tipos |
| `potrero` | text | la app | nombre del potrero. Para eventos del establecimiento entero (lluvias, puntos, reportes) lleva el nombre del establecimiento |
| `detalle` | jsonb | la app | ver cada tipo. En las apps móviles lleva además `usuario` (texto libre, "quién soy") |
| `fecha_cliente` | text `dd/mm/aaaa` | la app | fecha **del hecho** (puede ser anterior a hoy). Nunca tiene hora |
| `creado_en` | timestamptz | **servidor** | orden de aplicación y cursor de sincronización. Un trigger lo fuerza a `now()` aunque el cliente mande otro valor (Fase 2, 10/10/2026) |

Lo que no está en la fila y conviene saber:

- Los eventos son **inmutables**. Corregir o anular algo es escribir un evento nuevo, `correccion`.
  Nunca se hace UPDATE ni DELETE de `eventos_sync` (la llave pública no puede).
- El orden de aplicación es `creado_en` ascendente. El cursor de cada dispositivo es el último
  `creado_en` visto.
- Hoy la lectura **no pagina**: PostgREST corta en 1000 filas. Está en la Fase 3 de la auditoría.
- Una versión vieja de la app **descarta** los tipos que no conoce y el cursor avanza igual
  (hallazgo 8 de la auditoría, Fase 3): un tipo nuevo no se reaplica nunca en esos equipos.

## Tipos

<!-- tipos:start -->
Stock de un potrero (la app los aplica sumando o restando en `potreros[potrero].animales`):

| `tipo` | `potrero` | `detalle` | Efecto |
|---|---|---|---|
| `ingreso` | destino | `{categoria, dueno, cantidad}` | suma. Carga inicial y "agregar animales" |
| `nacimiento` | potrero | `{categoria, dueno, cantidad, obs?}` | suma y cuenta como nacido de la temporada |
| `muerte` | potrero | `{categoria, dueno, cantidad, obs?, caravana?, grupoTernero?}` | resta y cuenta como muerte (`grupoTernero`, solo en Terneros: `temporada` o `marcado`) |
| `movimiento` | origen | `{categoria, dueno, cantidad, destino}` | resta en el origen, suma en `destino`. Lo genera el comando de voz |
| `movimiento_multi` | origen | `{destino, items:[{categoria, categoriaDestino, dueno, duenoDestino?, cantidad}], obs?}` | varias categorías al mismo destino; con `destino` = el propio potrero es una recategorización o un cambio de dueño |
| `movimiento_todo` | origen | `{destino, items:[{categoria, dueno, cantidad}]}` | vacía el potrero hacia `destino` |
| `compra` | potrero | `{categoria, dueno, cantidad, precio, contraparte, guia, obs, fin?}` | suma. `precio` USD por cabeza o `null`; `guia` `A123456` o `null`; `fin` el detalle financiero completo (solo PC) |
| `venta` | potrero | igual que `compra` | resta |
| `desaparecido` | origen | `{categoria, dueno, cantidad, obs, casoId}` | resta y abre un caso |
| `encontrado` | destino | `{categoria, dueno, cantidad, casoId}` | suma y cierra (parcial o total) el caso |
| `perdida` | origen | `{categoria, dueno, cantidad, casoId}` | cierra el caso sin devolver stock |
| `muerte_desaparecido` | origen | `{categoria, dueno, cantidad, caravana, casoId}` | cierra el caso como muerte |

Movimientos entre dueños y entre campos (los lee `pasar_traslados_a_excel.py`):

| `tipo` | `potrero` | `detalle` | Efecto |
|---|---|---|---|
| `envio_campo_ajeno` | origen | `{items:[{categoria, dueno, cantidad}], guia, obs}` | resta del potrero y suma al "campo ajeno" |
| `retorno_campo_ajeno` | destino | `{items:[…], guia, obs}` | vuelve del campo ajeno |
| `traslado_salida` | origen | `{items:[{categoria, dueno, cantidad}], guia, obs, trasladoId, destino:{establecimiento, nombre, potrero}}` | **stream del origen**. Resta |
| `traslado_entrada` | potrero de destino | `{items:[…con el dueño de allá], guia, obs, trasladoId, origen:{establecimiento, nombre, potrero}}` | **stream del destino** (único caso en que se escribe en el stream ajeno). Suma. Su `event_id` se deriva del de la salida (`uuidDerivado(idSalida,'entrada')`) |
| `movimiento_guia` | potrero | `{items:[{categoria, cantidad}], desde, hacia, guia, obs, movId}` | cambio de dueño dentro del mismo campo, solo guía: el total no cambia |

Registros del establecimiento (no tocan el stock):

| `tipo` | `detalle` |
|---|---|
| `lluvia` | `{id, mm, usuario}` |
| `lluvia_editada` | `{id, fecha, mm}` |
| `lluvia_eliminada` | `{id}` |
| `evento_clima` | `{id, tipo, obs, usuario}` |
| `evento_clima_editado` | `{id, fecha, tipo, obs}` |
| `evento_clima_eliminado` | `{id}` |
| `aborto` | `{id, motivo, cantidad, obs, usuario}` |
| `aborto_editado` | `{id, fecha, motivo, cantidad, obs}` |
| `aborto_eliminado` | `{id}` |
| `senalada` | `{id, machos, hembras, obs, usuario}` |
| `senalada_editada` | `{id, fecha, machos, hembras, obs}` |
| `senalada_eliminada` | `{id}` |
| `punto_creado` | `{id, tipo, subtipo, nombre, lat, lon}` |
| `punto_eliminado` | `{id}` |
| `reporte_creado` | `{id, categoria, subtipo, obs, fecha, lat, lon}` |
| `reporte_resuelto` | `{id, fecha}` |
| `reporte_eliminado` | `{id}` |
| `proximo_confirmado` | `{id}` |

Potreros:

| `tipo` | `detalle` |
|---|---|
| `potrero_creado` | `{coords, area}` |
| `potrero_limite_actualizado` | `{coords, area}` |
| `potrero_limite_revertido` | `{}` |
| `potrero_eliminado` | `{}` |

Correcciones:

| `tipo` | `detalle` |
|---|---|
| `correccion` | `{tipoOriginal, accion, fechaOriginal, …}`: ver la sección siguiente |
<!-- tipos:end -->

## Correcciones

Un `correccion` anula, edita o completa un evento anterior. El evento original **no se toca**.

| `accion` | Campos | Qué hace |
|---|---|---|
| `eliminar` | `{tipoOriginal, historialId, fechaOriginal, reversar, casoId?, cantidad?}` | deshace el efecto de `reversar` |
| `editar` | igual que `eliminar` | deshace `reversar` y el evento corregido llega como un evento nuevo aparte |
| `agregar_guia` | `{tipoOriginal, categoria, cantidad, dueno, guia, fechaOriginal}` | pone o borra la guía de una compra/venta |
| `agregar_caravana` | `{tipoOriginal, casoId, categoria, cantidad, dueno, caravana, fechaOriginal}` | pone la caravana de una muerte |
| `completar_datos` | `{tipoOriginal, categoria, cantidad, dueno, fin, precio, contraparte, fechaOriginal}` | agrega el detalle financiero a una compra/venta cargada rápido |
| `anular_traslado` | `{tipoOriginal:'traslado_entrada', trasladoId, guia, fechaOriginal}` | **stream del destino**: anula la entrada de un traslado cuando se borra su salida |

`reversar` es un ajuste que la app sabe aplicar al revés. Sus `tipo` son: `sumar`, `restar`,
`mover`, `mover_todo`, `mover_multi`, `traslado_salida_ajuste` (lleva `trasladoId`),
`movimiento_guia_ajuste` (lleva `movId`), `envio_campo_ajeno_ajuste`, `retorno_campo_ajeno_ajuste`.

**Cómo se ubica el original.** Hoy depende del tipo:

- Con id propio y estable: `trasladoId` (traslados), `movId` (`movimiento_guia`), `casoId`
  (desaparecidos, muertes de un caso) y, desde la app, `historialId`.
- **Por parecido** (potrero + categoría + dueño + cantidad + fecha original), tomando el más
  reciente anterior a la corrección que no esté anulado: `compra`, `venta`, `muerte`,
  `movimiento*`, `envio/retorno_campo_ajeno`, `agregar_guia`, `agregar_caravana` y
  `completar_datos`. Dos compras iguales el mismo día se pueden confundir (hallazgo 7, Fase 3
  la pasa a id).

## Quién lee estos eventos

| Lector | Qué lee | Qué lo protege |
|---|---|---|
| La app (`aplicarEventoRemoto`, `calcularEstadisticas*`) | todos los tipos de su stream | las ~50 pruebas de `tests/` |
| `pasar_traslados_a_excel.py` (`Ganaderia\Macros & phyton`) | `traslado_salida`, `traslado_entrada`, `movimiento_guia`, `compra`, `venta`, `envio/retorno_campo_ajeno` y sus `correccion` (`eliminar`, `editar`, `agregar_guia`, `completar_datos`, `anular_traslado`) | `tests/probar_contrato_eventos.js` genera los eventos con la app y `test_contrato_eventos.py` los pasa por las funciones `construir_*` del script |
| Hermes (conector MCP, solo lectura) | `eventos_sync` completa | su propio token; una tabla o columna nueva requiere `hermes gateway restart` |
| `backup_supabase.py` | todas las filas, sin interpretarlas | `scripts/backup/probar_backup.py` |

Campos que esos lectores **usan hoy** y por lo tanto no se pueden renombrar:
`trasladoId`, `items[].categoria|dueno|cantidad`, `destino.establecimiento|potrero`,
`origen.establecimiento|potrero`, `guia`, `movId`, `desde`, `hacia`, `categoria`, `dueno`,
`cantidad`, `precio`, `contraparte`, `fin`, `tipoOriginal`, `accion`, `fechaOriginal`,
`reversar.trasladoId`, `reversar.movId`, `reversar.items`, `reversar.potrero`.
