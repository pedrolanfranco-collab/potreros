# Sincronización (Supabase) y eventos

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### Sync: Supabase, event-sourced

One shared Supabase project (`skkknfjpwcstefcroqjt`) and one table,
`eventos_sync`, used by every establishment, filtered by an `establecimiento`
column (`.eq('establecimiento', ESTABLECIMIENTO)`) — not by separate
tables/projects. RLS is open to `anon`; there is no login (see "RLS real
por tabla" below for what each table's policies actually allow — verified
directly in Supabase, not assumed). It's an
**event log, not a state sync**: every local change is applied locally *and*
inserted as a row; each device pulls new rows on load and every ~3 minutes
and replays them (`sincronizar()`), so replay order and offline queuing
(`estado.colaSync`) don't cause conflicts. A Windows scheduled task
(outside this repo) pings the table daily so the Supabase free-tier project
doesn't auto-pause after 7 days of inactivity — that ping isn't per-app, one
covers the whole shared project.

**Cola ordenada (Fase 3 de la auditoría, paso 1, 11/10/2026; flag `CONFIG.colaOrdenada`, prendido
en los 3 establecimientos desde el 11/10/2026: Pone Chico primero y, el mismo día, María Laura y La
Vuelta a pedido de Pedro).** Con el flag, `enviarEvento()` pone el evento en `estado.colaSync` y lo guarda en el
equipo ANTES de mandarlo, y `vaciarColaSync()` manda de a uno, siempre el primero, sacándolo por
`event_id` recién cuando Supabase confirma (OK o 23505). Una sola vuelta a la vez por cola
(`vueltaDeCola()`; quien llama durante una vuelta deja pedida otra). Arregla los hallazgos 1 (un
borrado llegaba antes que su movimiento) y 2 (un evento se perdía si Android cerraba la app durante
el envío). Sin el flag sigue el camino viejo (`pushEventoRemoto`, `vaciarColaSyncSinOrden`). Ojo en
pruebas nuevas: un evento que se está mandando sigue en la cola, y el segundo de una ráfaga sale
cuando el primero fue confirmado. Test: `tests/probar_cola_ordenada.js`. Cuando se confirme que
anda en los equipos, se borra el camino viejo (y con él el flag).
**Paso 2, errores visibles (mismo flag, 11/10/2026, visual aprobado por Pedro):** cada falla queda en
`estado.fallos.{sync,sanidad,lectura}` (`registrarFalloCola()`, con código, mensaje, status, fecha,
intentos). Sin respuesta, 5xx, 408 o 429 = pasajera: el indicador dice "⚠ N sin sincronizar · falló el
último intento hh:mm" y se reintenta sola. Cualquier otro 4xx (22P02, 42703, 42501, PGRST…) = permanente:
cartel rojo `#aviso-trabado` justo antes de `#footer-tools` ("⛔ N movimientos trabados", código,
"Reintentar", "Descargar copia" en JSON) y "⛔" en el indicador; se sigue reintentando en cada
sincronización, así se destraba solo si se arregla en Supabase. Sanidad usa la misma cola ordenada
(`insertarSanidadRemoto`, guarda primero) y **un 23505 ahí cuenta como enviado**: `id` es la clave
primaria de las 3 tablas `sanidad_carga*` (verificado en el esquema el 11/10/2026; antes un reintento
tras una respuesta perdida trababa esa cola para siempre). "✅" solo sin nada pendiente (movimientos,
Sanidad, catálogos) y con la última lectura OK. Test: `tests/probar_errores_cola.js`.
**Paso 3, paginación (mismo flag, 11/10/2026):** PostgREST corta cada respuesta en 1000 filas sin avisar
(La Vuelta llega hacia enero de 2027). `traerTodo(armar, alLote)` pide lotes de 1000 con `.range()`
agregando `.order('id')` como desempate (en producción hay 2 eventos de La Vuelta con el mismo
`creado_en` hasta el microsegundo); si una página falla devuelve el error y el que llama no aplica nada.
Lo usan `sincronizar()` (la primera vez muestra "🔄 Poniéndose al día… N eventos"), las dos copias de
`calcularEstadisticasNacimientos`/`Muertes`, el registro de muertes, Sanidad y `leerConsumos()`. Las
consultas de muertes y consumos ahora llevan `.order('creado_en')` (sin orden no se puede paginar). **Los
Supabase falsos de las pruebas necesitan `range()`** y, si ordenan por una sola columna, quedarse con el
primer `.order()`. Test: `tests/probar_paginacion.js`.
**Paso 4, corrección por id y versión en cada evento (11/10/2026, sin flag):** (a) cada renglón de historial
guarda `eventId` (el `event_id` de SU evento; las dos puntas de un movimiento comparten el mismo; lo mismo
`estado.transacciones` y la lista de campo ajeno) y las correcciones `eliminar`/`editar`/`agregar_guia`/
`agregar_caravana`/`completar_datos` llevan `eventIdOriginal`. El receptor busca ese id en TODOS los potreros
(`renglonesPorEventId()`); si hay renglones con ese id, aunque ya estén eliminados, actúa sobre ésos y NO cae al
parecido (que podía tachar otra venta idéntica del mismo día: hallazgo 7). Sin id, o sin renglones con ese id
(cargados antes de esta versión), el parecido de siempre. Al agregar un sitio nuevo que cree un renglón de
historial + `enviarEvento`, generar el `eventId` con `crypto.randomUUID()`, ponerlo en el renglón y pasarlo en
`enviarEvento(..., {eventId})`. (b) cada evento lleva `detalle.v` = `pc-`/`movil-`/`campo-` + versión
(`VERSION_APP`, solo diagnóstico), y un `tipo` (o `accion` de `correccion`) fuera de `TIPOS_EVENTO_CONOCIDOS` /
`ACCIONES_CORRECCION_CONOCIDAS` se guarda en `estado.eventosDesconocidos` (tope 500) en vez de descartarse, y se
aplica en la primera sincronización de una versión que ya lo conozca (hallazgo 8). **Un tipo de evento nuevo se
agrega en tres lugares:** `docs/eventos.md`, esos conjuntos y el código que lo aplica. Tests:
`tests/probar_correccion_por_id.js`, `tests/probar_eventos_desconocidos.js`. Los scripts de la PC
(`pasar_traslados_a_excel.py`) también ubican por `eventIdOriginal`.
**Paso 5, Verificar stock (solo PC, 12/10/2026, sin flag):** "🔍 Verificar stock" (Herramientas › Consultar,
`#modal-verificar-stock`) lee TODO `eventos_sync` del establecimiento (`traerTodo`, sin cursor y sin descartar los
eventos de esta PC), rearma el stock en memoria como un equipo recién instalado y lo compara con el local
(por potrero y `categoría||firma`, más campo ajeno); lista solo las diferencias, los potreros que existen solo en
la PC o solo en el registro, y baja un CSV (`<ESTABLECIMIENTO>_verificar_stock_<fecha>.csv`, separador `;`). Los
movimientos de `estado.colaSync` se aplican también (no figuran como diferencia; si ya están en el registro por
`event_id`, no se cuentan dos veces; los del stream de otro campo se saltean). **Solo compara: no corrige nada.**
Aislamiento: `reconstruirStockDesdeRegistro()` es **síncrona de punta a punta** (sin `await`, así ninguna sync ni
guardado se mete en el medio): cambia `estado` por `estadoInicial()` + `migrarClavesSinFirma()` (sin esto la carga
inicial de La Vuelta, con claves sin `||`, salía toda como diferencia) y vacía/rellena `POTREROS_GEO` con
`POTREROS_GEO_ORIGINAL` (copia tomada antes de los overlays de localStorage), aplica los eventos con
`aplicarEventoRemoto()` y restaura todo en un `finally`. Mientras corre, `_reconstruyendo = true` hace no-op
`guardarEstado()`, `dibujarPotrero()`, `crearMarcadorPunto/Reporte()` y lo que `aplicarEventoRemoto()` escribe
fuera de `estado` (localStorage de `POTREROS_NUEVOS_KEY`/`LIMITES_KEY`, capas del mapa): **cualquier rama nueva de
`aplicarEventoRemoto()` que toque localStorage, el mapa o `guardarEstado()` necesita su guarda
`if(_reconstruyendo)` dentro de un bloque `@pc`.** Si hay una sincronización en curso no arranca, y si entró una
sync o un movimiento mientras leía, pide volver a verificar. Test: `tests/probar_verificar_stock.js` (estado,
localStorage, `POTREROS_GEO` y llamadas a Leaflet idénticos antes y después, mutando cada guarda se pone en rojo).

**Idempotencia (12/9/2026, auditoría de 3 IAs verificada contra el código):**
cada evento lleva un `event_id` propio (`crypto.randomUUID()` — **no**
`generarIdHistorial()`, que arma "h_&lt;timestamp&gt;_&lt;random&gt;" y no es un
UUID válido; confundir los dos rompió todos los inserts el mismo día que se
agregó la columna, ver el bug real más abajo — generado una sola vez en
`enviarEvento()` y reusado si el evento se reencola). El insert
en `pushEventoRemoto()` incluye `event_id`, con una columna `UNIQUE` del
mismo nombre en Supabase. Si un reintento (típicamente un corte de red justo
después de que el insert original ya había llegado al servidor) manda el
mismo `event_id`, Supabase devuelve una violación de unicidad (`error.code
=== '23505'`) que se trata como éxito y NO se reencola — antes, ese mismo
reintento creaba una fila duplicada y el movimiento se aplicaba dos veces en
los demás dispositivos. **Requiere que la columna exista en Supabase antes
de desplegar este código** (`ALTER TABLE eventos_sync ADD COLUMN event_id
uuid; ALTER TABLE eventos_sync ADD CONSTRAINT eventos_sync_event_id_key
UNIQUE (event_id);` — nullable, sin `NOT NULL`, para que un evento que
quedó encolado en un dispositivo con una versión vieja de la app, sin
`event_id`, siga insertando bien, aunque sin la protección de idempotencia)
— mismo error que ya pasó una vez con `productos_catalogo` (columna nueva
en el código antes que en la tabla → insert falla).

**Bug real el mismo día del deploy: `event_id` generado con la función
equivocada rompió TODOS los inserts.** El primer código shippeado usaba
`generarIdHistorial()` (el generador local ya existente, `"h_" + Date.now()
+ "_" + random`) para `event_id` — un string que no es un UUID válido, y la
columna es de tipo `uuid`. Resultado: cada insert a `eventos_sync` fallaba
con `code: "22P02"` ("invalid input syntax for type uuid"), en **todos los
dispositivos por igual** (PC y móvil comparten `enviarEvento()`), sin que
nada lo mostrara en pantalla — el usuario solo veía "N movimientos sin
sincronizar" sin crecer más allá de eso. Detectado por Pedro con la consola
del navegador (`chrome://inspect` + DevTools Network, viendo el 400 de
`eventos_sync`) varias horas después del deploy. Fix: `crypto.randomUUID()`
en vez de `generarIdHistorial()` — esta última sigue usándose para los ids
de historial local, que no van a una columna `uuid`. Lección: cuando un
`event_id`/id nuevo va a una columna tipada (`uuid`, no `text`), verificar
el formato exacto que exige esa columna, no asumir que cualquier generador
de id ya existente en el código sirve.

**"Restablecer datos de fábrica" (mismo 12/9/2026):** además de borrar
`STORAGE_KEY`, ahora también borra `DISPOSITIVO_KEY` antes de recargar. Con
un ID de dispositivo nuevo, `sincronizar()` (que descarta los eventos cuyo
`dispositivo === miId`, línea ~1292) trae de nuevo TODA la historia del
establecimiento — incluida la que antes había generado este mismo
dispositivo, que antes del fix quedaba perdida para siempre tras un reset.
Ver `tests/probar_idempotencia_reset.js`.

**Tipos de evento en `eventos_sync`** (`tipo` column): `nacimiento`,
`correccion`, `muerte`, `venta`, `compra`, `ingreso`, `desaparecido`,
`encontrado`, `movimiento`, `movimiento_multi`, `movimiento_todo`,
`lluvia`, y (desde el 13/9/2026) `potrero_creado`,
`potrero_limite_actualizado`, `potrero_limite_revertido`,
`potrero_eliminado`, y (desde el 29/10/2026) `vecino_paso`, `vecino_aparecido`, `vecino_retorno`, `vecino_perdida`,
`vecino_muerte` (ver "Vecinos"). Los cuatro de potreros sincronizan lo que hace
"Importar KML/KMZ"/"Eliminar potrero" (antes 100% local, ver esa sección
más abajo). Todos se manejan en `aplicarEventoRemoto()`; los que no
requieren que el potrero ya exista localmente (`lluvia`,
`potrero_creado`) se procesan **antes** del guard `if(!potrero ||
!estado.potreros[potrero]) return;`, no después.

**Editar/borrar en la PC (3/10/2026, a pedido de Pedro).** En las 3 apps PC
(solo ahí: móvil completa y Campo no ganan botones) cualquier registro se
puede editar y borrar, siempre con `confirm()`:
- *Historial de un potrero*: ✏️ y 🗑 también en lo que cargó otro dispositivo.
  Esas entradas no traen `extra` sino `origDatos` (sin el potrero, que es donde
  está la entrada): `datosHistorial(h, potreroHost)` arma los datos para
  `construirAjusteInverso()`, que revierte el stock igual que siempre. Un
  movimiento sincronizado son dos entradas sin `grupoId` (origen y destino):
  `tacharOtraPuntaSincronizada()` tacha la otra por igualdad de `origDatos`.
  ✏️ = deshacer (evento `correccion` de siempre) + abrir el formulario
  precargado (`abrirFormularioEdicion()`, bloque `@pc`): si Pedro cancela el
  formulario, lo original queda deshecho. Los renglones que son solo texto (carga
  inicial desde planilla, "Corrección…") no tienen datos y siguen sin botones.
  `agregarCaravanaMuerte`/`agregarGuiaCompraventa` editan `origDatos` donde ya
  vive: nunca crearle un `extra` incompleto a una entrada sincronizada (rompe
  `construirAjusteInverso`).
- *Abortos y eventos climáticos*: eventos `aborto_editado`, `aborto_eliminado`,
  `evento_clima_editado`, `evento_clima_eliminado` (edición/baja directa, sin
  reversar stock, como lluvia/señalada). Los **recibe** `aplicarEventoRemoto()`
  en todas las variantes, y `calcularEstadisticasNacimientos()` (hay dos copias,
  `@pc` y `@movil`) reconstruye los abortos por id para que el % se corrija.
- Ver `tests/probar_editar_borrar_pc.js`. **Sin pendientes salvo Sanidad (ver abajo).** Borrar o editar un desaparecido que ya
  tiene resoluciones vivas (encontrado/pérdida/muerte) se bloquea con un aviso
  (`avisarSiTieneResoluciones()`, 6/10/2026): dejaría las resoluciones huérfanas y
  duplicaría stock; hay que borrar primero esas.
  (Resuelto el 6/10/2026: `buscarMejor()` ahora mira `origDatos || extra`, así que
  el celular que cargó un evento también tacha su renglón cuando otro lo corrige;
  los items se comparan con `canon()`, sin importar el orden de claves que
  reordena Postgres.)
  Resuelto el 6/10/2026 también: borrar/editar una compra o venta saca su registro de
  `estado.transacciones` (`quitarTransaccion()`, local y al recibir la corrección), así
  que el reporte económico ya no cuenta una venta borrada ni la duplica al editar.
  Y el 6/10/2026 el campo ajeno: borrar/editar un envío/retorno saca su renglón de
  `estado.campoAjeno.historial` (`quitarMovimientoCampoAjeno()`, también al recibir la
  corrección). Y las pérdidas / muertes de desaparecido: su corrección lleva `casoId` y
  `cantidad` (`datosCorreccionDeCaso()`) y el receptor tacha por ahí (no tienen `reversar`
  porque no tocan stock), así el caso vuelve a figurar pendiente en todos los
  dispositivos. Sanidad también (ver la sección Sanidad).

**Evento hacia un potrero que este dispositivo todavía no conoce (7/10/2026).** Antes se
descartaba en silencio (guards de `aplicarEventoRemoto()`), mientras que un dispositivo que sí
conocía el potrero (importado a mano antes de que existiera el `potrero_creado`) lo aplicaba:
mismo historial, distinto stock (caso real: OMBU con −2 caballos / −5 yeguas en una PC y 0 en
las demás). Ahora, si el evento es posterior a `CORTE_PENDIENTES`, se **estaciona entero** en
`estado.pendientesPotrero[nombre]` (`estacionarEvento()`; topes 100 por nombre y 50 nombres) y
se aplica al aparecer el potrero (`aplicarPendientesDePotrero()`, llamado desde la rama remota
`potrero_creado` y las dos creaciones locales: dibujar y importar KML; `potrero_eliminado` lo
descarta). Una `correccion` cuyo ajuste toca un potrero desconocido se estaciona detrás del
evento que corrige. Los eventos anteriores al corte se siguen descartando como siempre, para que
un dispositivo nuevo no calcule distinto que los ya instalados. Test:
`tests/probar_evento_potrero_desconocido.js`. Pendiente: si un potrero nunca llega a existir en
un dispositivo, sus eventos esperan para siempre (no debería pasar desde el 13/9).

**Muertes de terneros en dos grupos (10/10/2026, a pedido de Pedro).** "Terneros" es una sola categoría y la
app no sabe cuándo se marcó un ternero, así que el grupo se **elige al cargar la muerte**: el formulario de
muerte (y la confirmación de voz en móvil) pide "De temporada (nacido a marcación)" o "Marcado" solo cuando
la categoría es Terneros, y no deja guardar sin elegir. Viaja como `grupoTernero: 'temporada'|'marcado'` en el
detalle del evento `muerte` (otras categorías no lo mandan; `grupoTerneroValido()` filtra lo que llega). El
ajuste inverso de una muerte (`construirAjusteInverso`) lo lleva en `reversar` para que borrar/editar lo
descuente del grupo correcto. `calcularEstadisticasMuertes()` (dos copias) devuelve `terneros: {temporada,
marcado, sinClasificar}` sobre la temporada **completa 1/ago–31/jul** (a diferencia del conteo por especie, que
es solo ago–dic: un marcado muere en cualquier mes); las muertes cargadas antes de esto, y las de
desaparecidos, figuran "sin clasificar" (en la PC se editan para asignarles el grupo). Esa función ahora
también descuenta las correcciones `accion:'editar'` (antes solo `'eliminar'`: editar una muerte dejaba la vieja
contando). La tabla "Ver registro de muertes por categoría" separa "Terneros — de temporada" / "Terneros —
marcados". Test: `tests/probar_muerte_terneros_grupo.js`.

**UG de las crías y de las vacas con ternero (11/10/2026, a pedido de Pedro).** Mientras están al pie las crías
no cuentan como Unidad Ganadera (siguen contando como animales), para que la carga no salga inflada: **Terneros y
Terneras 0 UG de octubre a marzo** y su coeficiente (0,5) de abril a septiembre; **Corderos/as 0 UG de septiembre a
diciembre** y su coeficiente (0,1) desde enero (`UG_MESES_SIN`, `sinUGPorTemporada()`, `coefUG()`). Una **vaca con
ternero al pie vale 1,2 UG de octubre a marzo** (inclusive) y 1 el resto del año: tantas vacas como Terneros haya en
el potrero, hasta el total de Vacas (`vacasConTerneroEnPotrero()`; el extra se reparte por dueño según sus Vacas en
`ugPorDuenoEnPotrero()`). `totalUG()`, los 3 reportes por dueño (Por dueño, MD, Excel/PDF) y la columna `ug` de
`stock_potreros` pasan por ahí. El coeficiente de "Coeficientes UG" rige cuando cuentan. Límite conocido: no
distingue crías de la temporada de destetados del año anterior que siguen en "Terneros" hasta recategorizarse
(septiembre): de abril a septiembre ya valen 0,5, así que no hay hueco. Test: `tests/probar_ug_temporada.js`
(`probar_stock_total.js` ya no asume fecha).

**Consumos (11/10/2026, a pedido de Pedro).** Ovinos (y eventualmente un vacuno) que se faenan para el consumo
de carne del establecimiento: sección "🥩 Consumos" en "Lluvias y otros eventos" (PC y móvil completa; Campo no
la tiene). Es un evento `consumo` (`potrero`, `{categoria, dueno, cantidad, obs?}`) que resta del stock del potrero
como una muerte (`aplicarEventoRemoto`, `construirAjusteInverso`: `{tipo:'sumar'}`) pero **no cuenta como muerte**.
El resumen es por **ejercicio 1/jul–30/jun** (`leerConsumos()` + `resumirConsumos()`, igual que las muertes: consulta
`eventos_sync` `consumo` + `correccion`, con cache offline; una corrección `eliminar`/`editar` anula el consumo que
más se le parece). Se corrige/borra desde el historial del potrero (✏️ reabre el modal con el formulario precargado,
`abrirConsumos()`). Test: `tests/probar_consumos.js`.
**Historial plegado (11/10/2026):** en todas las apps el historial del potrero va dentro de un `<details
class="historial-det">` con un botón "Historial (N)"; se acuerda abierto mientras no cambie de potrero
(`historialAbierto`/`historialPotrero`). **Todos los historiales/listas de registros** (lluvias, eventos, abortos,
señaladas, consumos, campo ajeno, traslados, movimientos con guía, "Mis cargas recientes" de Sanidad y las pesadas de
la ficha de caravana) también van plegados detrás de un botón, en todas las ventanas: clase `historial-det` /
`historial-det-lista`. Test: `tests/probar_historiales_ocultos.js`.

**Cuidado al escribir un `.select(...)` nuevo contra `eventos_sync`:
listar explícitamente TODAS las columnas que la función va a leer,
incluida `potrero`.** Es una columna de la fila (no vive dentro de
`detalle`), fácil de olvidar si solo se piensa en el contenido del evento.
Bug real el 13/9/2026: `calcularEstadisticasNacimientos()` pedía
`select('fecha_cliente,detalle,tipo,creado_en')` sin `potrero`, pese a que
el saldo-por-potrero que clampea las correcciones (`tocarSaldoTemporada`)
depende de `ev.potrero` para nacimiento/muerte/ingreso/movimiento. Con
`potrero` en `undefined`, el guard de esa función (`if(!potrero) return
0;`) cortaba en silencio — sin ningún error, sin que cambiara el conteo de
filas — y el cálculo daba un número real pero equivocado (71 en vez de
69) en producción. Invisible durante horas de debugging porque cada
prueba armaba los datos con esa columna ya presente (`select=*`, o
reconstruidos a mano) en vez de reproducir la consulta exacta — ver la
memoria `verificar-select-exacto-no-reconstruir-datos.md`.


### Eventos de manejo, Tareas y Calendario (5/11/2026, a pedido de Pedro, `CONFIG.manejo`)

Registro de los trabajos del campo **sin tocar el stock**. `CONFIG.manejo` es `true` en La Vuelta y María Laura y `false` en Pone Chico
(botones ocultos, nada se consulta). Aparecen solo en la **PC y la móvil completa** (módulo dentro de `@completo`): Campo no tiene botones,
aunque recibe y guarda los eventos. Botones en Herramientas (en la PC dentro de Consultar y en `SECCIONES_PC`): "📋 Eventos de manejo",
"✅ Tareas (N vencidas)" y "📅 Calendario".
- **Eventos de manejo** (`evento_manejo`, `_editado`, `_eliminado`; `estado.eventosManejo`): tipo (Destete, Caravaneo, IATF, Pesada, Recuento u
  "Otro…" libre), fecha, potrero / categoría / cantidad / observaciones opcionales y **caravanas** opcionales (`id8` de 8 dígitos, hasta 1000,
  pegadas o leídas de un CSV de Datamars con `leerCaravanasDeCsv()`). Lote y animal son el mismo evento: con caravanas la cantidad se completa
  sola. La ficha de "🔎 Buscar caravana" lista los eventos de esa caravana.
- **Tareas** (`tarea_creada`, `_editada`, `_hecha`, `_eliminada` y `reporte_programado`; `estado.tareas`, `estado.reportesProgramados`): temas
  Ganado / Infraestructura / Mantenimiento / Otras (`TEMAS_TAREA`), fecha prevista, cronograma (vencida en rojo, 15 días o menos en ocre, siempre con
  texto) e historial plegado. Los reportes de campo de Infraestructura se muestran como tareas leyendo `estado.reportes` (cumplirlos usa el
  resolver de siempre, no hay una tarea paralela) y `reporte_programado` les pone fecha. **Mantenimiento que se repite** (`cadaDias` 1–730,
  `puntoId` / `puntoNombre`): al cumplirla, un solo `tarea_hecha` trae `siguiente {id "<serie>#<n>", fechaPrevista}` y **cada equipo** deriva la
  próxima con ese id, así no se duplica. En "📍 Aguadas / instalaciones" cada punto muestra su última y próxima limpieza
  (`bloqueLimpiezaPunto()`, solo en completo). Cumplir un Destete final o un Fin DT **ofrece** registrar el evento Destete; no lo crea solo.
- **Orden y borrado (vale para ambos)**: `detalle.id` es la identidad y cada acción lleva `detalle.ts`; todos los equipos ordenan por
  `(ts, event_id)` (las filas viejas sin `ts` usan `creado_en`), sin mezclar el reloj del equipo con el del servidor. Borrar deja un **tombstone**
  por id (una alta o edición tardía no lo revive). Un `_editado` o un `tarea_hecha` que llega antes que su alta se guarda y se muestra cuando
  llega el alta; entre dos `tarea_hecha` de la misma tarea gana el primero. El texto remoto pasa por `limpiarTextoRemoto()` con tope por campo;
  potrero y categoría se validan al **mostrar**, no al guardar.
- **Editar, borrar y deshacer "hecha": solo la PC** (`accionesEventoManejoPC` / `accionesTareaPC`, definidos con marcadores en líneas propias);
  la móvil crea y marca hecha.
- **Calendario**: ventana de solo lectura (`#modal-calendario`) que junta eventos, tareas y reportes del mes (lunes a domingo, filtro por
  Eventos / Tareas y por tema, lista de "Sin fecha asignada"); **no emite eventos**. Las fechas se manejan como texto `dd/mm/aaaa` o
  `aaaa-mm-dd`, sin pasar por `Date` en UTC.
- Tests: `tests/probar_eventos_manejo.js`, `tests/probar_tareas.js` y `tests/probar_calendario.js` (en el workflow).
