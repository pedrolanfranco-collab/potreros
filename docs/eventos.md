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
| `detalle` | jsonb | la app | ver cada tipo. En las apps móviles lleva además `usuario` (texto libre, "quién soy"). Desde el paso 4 de la Fase 3 (11/10/2026) todas las apps agregan `v`: la variante y la versión que escribió el evento (`pc-3.67`, `movil-3.66`, `campo-1.47`), solo para diagnosticar; ningún lector la necesita y no forma parte del contrato de cada tipo |
| `fecha_cliente` | text `dd/mm/aaaa` | la app | fecha **del hecho** (puede ser anterior a hoy). Nunca tiene hora |
| `creado_en` | timestamptz | **servidor** | orden de aplicación y cursor de sincronización. Un trigger lo fuerza a `now()` aunque el cliente mande otro valor (Fase 2, 10/10/2026) |

Lo que no está en la fila y conviene saber:

- Los eventos son **inmutables**. Corregir o anular algo es escribir un evento nuevo, `correccion`.
  Nunca se hace UPDATE ni DELETE de `eventos_sync` (la llave pública no puede).
- El orden de aplicación es `creado_en` ascendente. El cursor de cada dispositivo es el último
  `creado_en` visto.
- Con `CONFIG.colaOrdenada` (Fase 3, 11/10/2026; los 3 establecimientos) cada equipo manda sus
  eventos **de a uno y en el orden en que los cargó**: todo evento entra primero a
  `estado.colaSync` (guardado en el equipo) y sale de ahí recién cuando el servidor confirma. Sin
  el flag, un evento con señal se manda directo aunque haya otros esperando en la cola (hallazgo 1).
- PostgREST corta cada respuesta en 1000 filas sin avisar. Con `CONFIG.colaOrdenada` (Fase 3,
  paso 3, 11/10/2026; los 3 establecimientos) la app pagina con `traerTodo()`: lotes de 1000 con
  `.range()`, en orden `creado_en` + `id` (hay eventos con el mismo `creado_en` hasta el
  microsegundo).
- Una versión de la app anterior al paso 4 de la Fase 3 **descarta** los tipos que no conoce y el cursor
  avanza igual (hallazgo 8 de la auditoría): un tipo nuevo no se reaplica nunca en esos equipos. Desde ese
  paso, un `tipo` (o una `accion` de `correccion`) que la versión no conoce se guarda en
  `estado.eventosDesconocidos` (tope 500) y se aplica en la sincronización siguiente a la que la app ya
  lo conozca. **Un tipo o una acción nueva se agrega entonces en tres lugares**: la tabla de abajo,
  `TIPOS_EVENTO_CONOCIDOS` / `ACCIONES_CORRECCION_CONOCIDAS` del template y el código que lo aplica;
  `tests/probar_eventos_desconocidos.js` compara el primero con el segundo.

## Tipos

<!-- tipos:start -->
Stock de un potrero (la app los aplica sumando o restando en `potreros[potrero].animales`):

| `tipo` | `potrero` | `detalle` | Efecto |
|---|---|---|---|
| `ingreso` | destino | `{categoria, dueno, cantidad}` | suma. Carga inicial y "agregar animales" |
| `nacimiento` | potrero | `{categoria, dueno, cantidad, obs?}` | suma y cuenta como nacido de la temporada |
| `muerte` | potrero | `{categoria, dueno, cantidad, obs?, caravana?, grupoTernero?, lat?, lon?}` | resta y cuenta como muerte (`grupoTernero`, solo en Terneros: `temporada` o `marcado`; `lat`/`lon`, opcionales: dónde se encontró el animal, para "Ver en el mapa") |
| `consumo` | potrero | `{categoria, dueno, cantidad, obs?}` | resta; animales faenados para consumo del establecimiento (ovinos y eventualmente un vacuno). NO cuenta como muerte; tiene su propio resumen por ejercicio 1/jul–30/jun |
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
| `reporte_foto` | `{id, fotoId, path, momento, fecha}` (foto del reporte ya subida a Storage, bucket `fotos-reportes`; `path` = `<establecimiento>/<id>/<fotoId>.jpg`, `momento` = `reporte` o `resuelto`) |
| `punto_foto` | `{id, fotoId, path, momento, fecha}` (foto de un punto —aguada, manga, corral, embarcadero…— ya subida al mismo bucket; `id` = id del punto `pt_…`, `momento` = `registro`) |
| `muerte_foto` | `{id, fotoId, path, momento, fecha}` (foto de una muerte ya subida al mismo bucket; `id` = `event_id` del evento `muerte`, `momento` = `registro`) |
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
| `eliminar` | `{tipoOriginal, historialId, fechaOriginal, reversar, eventIdOriginal?, casoId?, cantidad?}` | deshace el efecto de `reversar` |
| `editar` | igual que `eliminar` | deshace `reversar` y el evento corregido llega como un evento nuevo aparte |
| `agregar_guia` | `{tipoOriginal, categoria, cantidad, dueno, guia, fechaOriginal, eventIdOriginal?}` | pone o borra la guía de una compra/venta |
| `agregar_caravana` | `{tipoOriginal, casoId, categoria, cantidad, dueno, caravana, fechaOriginal, eventIdOriginal?}` | pone la caravana de una muerte |
| `completar_datos` | `{tipoOriginal, categoria, cantidad, dueno, fin, precio, contraparte, fechaOriginal, eventIdOriginal?}` | agrega el detalle financiero a una compra/venta cargada rápido |
| `anular_traslado` | `{tipoOriginal:'traslado_entrada', trasladoId, guia, fechaOriginal, origenEstablecimiento}` | **stream del destino**: anula la entrada de un traslado cuando se borra su salida. `origenEstablecimiento` (desde la Fase 4, 13/10/2026) es el id del campo que anula (`la_vuelta`, `maria_laura`, `pone_chico`; el mismo que `ESTABLECIMIENTO` en la app de origen): la política del cierre deja pasar este evento si el pedido trae la clave de ese campo. Los eventos anteriores no lo traen |

`reversar` es un ajuste que la app sabe aplicar al revés. Sus `tipo` son: `sumar`, `restar`,
`mover`, `mover_todo`, `mover_multi`, `traslado_salida_ajuste` (lleva `trasladoId`),
`movimiento_guia_ajuste` (lleva `movId`), `envio_campo_ajeno_ajuste`, `retorno_campo_ajeno_ajuste`.

**Cómo se ubica el original.**

1. **Por `eventIdOriginal`** (Fase 3, paso 4, 11/10/2026): es el `event_id` del evento que se
   corrige. Cada renglón de historial de la app guarda el `event_id` de su evento (`eventId`; las dos
   puntas de un movimiento entre potreros comparten el mismo) y la corrección lo lleva en
   `eventIdOriginal` (`eliminar`, `editar`, `agregar_guia`, `agregar_caravana`, `completar_datos`).
   Quien recibe la corrección busca ese id en todos los potreros: si hay renglones con ese id (aunque
   ya estén anulados) actúa sobre ésos y **no** busca por parecido. Es lo que evita que dos ventas
   iguales del mismo día se confundan (hallazgo 7). Los scripts de la PC hacen lo mismo con
   `event_id` de las filas de `eventos_sync`.
2. **Por parecido**, solo como respaldo para los eventos de antes de esta versión (la corrección no
   trae `eventIdOriginal`, o ningún renglón tiene ese id): potrero + categoría + dueño + cantidad +
   fecha original, tomando el más cercano a la fecha original que no esté anulado. Cubre `compra`,
   `venta`, `muerte`, `consumo`, `movimiento*`, `envio/retorno_campo_ajeno`, `agregar_guia`,
   `agregar_caravana` y `completar_datos`.
3. Además, id propio y estable de algunos tipos, que se sigue usando: `trasladoId` (traslados),
   `movId` (`movimiento_guia`), `casoId` (desaparecidos, muertes de un caso) y, desde la app,
   `historialId`.

`eventIdOriginal` es opcional: una corrección sin él es válida y se ubica por parecido.

## Clave del campo y eventos que cruzan de stream

Desde la Fase 4 (release 1, 13/10/2026) cada app manda en el encabezado HTTP `x-clave-campo` la clave de
su establecimiento (la que cargó la persona en la ventana "🔑 Clave del campo"; se guarda en
`localStorage['clave_campo_<establecimiento>']`, fuera del estado, y no sale en ningún backup). La clave
**no viaja dentro del `detalle`** ni de ninguna columna: solo en el encabezado, y el servidor la compara
contra un hash (`public.establecimientos_con_clave()`). En el release 1 las políticas siguen abiertas y el
servidor solo anota qué equipos ya la mandan (`private.equipos_vistos`); desde el cierre (release 2,
`scripts/seguridad/fase4_cierre.sql`) cada tabla exige la clave del campo al que pertenece la fila.

Con la clave de un campo se lee y se escribe en el stream de ese campo (`establecimiento` de la fila).
**Hay exactamente dos eventos que una app escribe en el stream de OTRO campo** (traslado entre campos), y
para esos la política mira un campo del `detalle`, que por eso es parte del contrato y no puede faltar ni
cambiar de significado:

| Evento | Se escribe en | La política lo deja pasar si la clave es la de | Campo que mira |
|---|---|---|---|
| `traslado_entrada` | stream del destino | el campo de origen | `detalle.origen.establecimiento` (id del campo, no el nombre para mostrar) |
| `correccion` con `accion = 'anular_traslado'` | stream del destino | el campo de origen | `detalle.origenEstablecimiento` |

Cualquier otro evento tiene que llevar la clave del campo de su propio `establecimiento`. Un evento nuevo
que se escriba en el stream de otro campo necesita su propia excepción en la política **antes** de
publicarse.

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
