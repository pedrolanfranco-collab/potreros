# Insumos y baño de aspersión

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### Insumos (3/11/2026, a pedido de Pedro, `CONFIG.insumos`)

Pantalla "🧴 Insumos" (Herramientas; en la PC dentro de Consultar, justo después de Sanidad) con el stock de productos veterinarios del
galpón. **Solo La Vuelta y María Laura** (`insumos: true`); Pone Chico `false`: el botón queda oculto y no hace ninguna consulta. Sale en
las 3 variantes (PC, móvil completa y Campo): ventanas `#modal-insumos` y `#modal-insumos-form` sin marcadores, el código está en el
template bajo el banner `INSUMOS`.
- **El stock lo calcula Supabase**: RPC `stock_insumos_app()` (sin argumentos; `establecimiento, producto, fecha_conteo, inicial_ml,
  entradas_ml, salidas_ml, stock_ml, estado`), que respeta la clave del campo. La app filtra por su `ESTABLECIMIENTO` y solo muestra. Los
  productos sin conteo inicial no aparecen. Colores (`insClasificar()`): rojo si `estado` es 'sin stock' o 'NEGATIVO - revisar' (o el
  stock es ≤ 0 o falta: texto "sin stock" / "revisar"), amarillo si `stock_ml` < 100 o < 20 % de `inicial_ml + entradas_ml`, verde el resto;
  el color nunca va solo (siempre el texto ok / poco / sin stock / revisar). Frascos: `productos_catalogo` no trae el tamaño del envase, así
  que se recuerda en este equipo el "ml por frasco" que se escribe en el formulario y la lista agrega "≈ N frascos de X ml"; sin dato, solo ml.
- **Se carga en `insumos_ajustes`** (`anon` solo SELECT e INSERT): `tipo` `inicial` (conteo del galpón, lo contado), `ajuste` (+ o −, no 0) o
  `pasaje_salida` (positivo, `destino` = el otro campo, fijo). **Nunca se inserta `pasaje_entrada`**: la base la genera. `producto` = nombre
  exacto de `productos_catalogo` (selector con búsqueda, cacheado; sin catálogo guardado se acepta lo escrito). Cada carga lleva `uid` (uuid del
  cliente), `dispositivo` (`idDispositivo()`) y `autor` ("Quién soy").
- **Todo vive aparte de `estado`**: en `localStorage[<ESTABLECIMIENTO>_insumos_v1]` = `{stock:{filas,hora}, catalogo:{filas,hora}, cola:[], envases:{}}`
  (se lee y se escribe siempre fresco, porque PC/móvil/Campo del mismo campo comparten origen). No entra al Backup JSON, a "Verificar stock"
  ni a la cola de `eventos_sync`, y "Restablecer datos de fábrica" no lo borra. Es a propósito: no se mezcla con la idempotencia de los eventos.
- **Cola propia** (`insVaciarCola()`): la carga se guarda en el equipo ANTES de mandarse y se manda de a una; se saca solo cuando Supabase
  confirma. Un **23505 (uid repetido) cuenta como enviado**, así una respuesta perdida no duplica. Sin respuesta / 5xx / 408 / 429 = pasajero
  (se frena y se reintenta); un rechazo de la base (22…, 23…, 42…, PGRST…) deja esa carga marcada con su error y con "Quitar", y sigue con las
  demás. Se vacía al abrir la pantalla, al guardar, con "🔄 Actualizar" y en cada `sincronizar()` (`insumosAlSincronizar()`, en segundo plano, no
  frena ni rompe la sincronización). Lo pendiente se ve como "en cola".
- **Sin señal** se muestra la última copia con "Sin señal — datos del dd/mm hh:mm"; con señal pero con error del servidor, la copia más
  "No se pudo actualizar (…) — datos del …".
- **Si el esquema de Supabase cambia** (columnas de `insumos_ajustes`, nombre o forma de la RPC) hay que tocar `insFilaParaEnviar()` e `insRefrescarStock()`.
- Tests: `tests/probar_insumos.js` (9 variantes, Supabase falso con `uid` único; en el CI). `probar_clave_campo.js` ahora ignora las RPC que no son
  `verificar_clave` (antes contaba cualquiera y `stock_insumos_app` lo ponía en rojo). Los instructivos (`instructivo-*`) llevan la sección
  "🧴 Insumos", la fila de "Según tu campo" y el flag `insumos` en `probar_instructivos.js`.

### Baño de aspersión (4/11/2026, a pedido de Pedro, `CONFIG.bano`)

Pantalla "🛁 Baño" (Herramientas; en la PC dentro de Consultar, justo después de Insumos) para el control del baño de aspersión:
tanque **cerrado** de 900 L con una regla que marca cada 100 L, **un producto por ciclo**. **Solo La Vuelta y María Laura** (`bano: true`);
Pone Chico `false`: botón oculto y ninguna consulta. Sale en las 3 variantes: ventanas `#modal-bano`, `#modal-bano-form` (+ Tanda /
+ Reposición / Fin del día / Cerrar ciclo, una sola ventana con secciones) y `#modal-bano-productos`, sin marcadores; código bajo el banner
`BAÑO DE ASPERSIÓN`, justo después de Insumos.
- **Backend (hecho aparte, no se toca desde la app)**: `bano_config` (dosis `ml_100l_carga` / `ml_100l_reposicion`, que pueden ser null =
  "falta la dosis"; `l_animal_min/max`, `vida_horas`, `capacidad_l`, `umbral_reponer_l`), RPC `bano_config_guardar(...)` (exige clave del campo,
  42501, y producto de `productos_catalogo`, 22023), `bano_ciclos` y `bano_lecturas` (solo SELECT/INSERT, `uid` único; FK compuesta
  `(ciclo_uid, establecimiento)`: **el ciclo sube antes que sus lecturas**; tipos `tanda` / `reposicion` / `fin_dia` / `cierre` con sus checks),
  RPC `bano_estado_app()` (ciclos abiertos) y `bano_avisos_app()` (posibles dobles cargas en Sanidad, 30 días). El stock de Insumos ya descuenta
  solo el producto de los ciclos (carga + reposiciones).
- **La hora la pone el equipo** al guardar (no hay campos de fecha). Sugerencias: carga = agua × `ml_100l_carga` / 100; reposición = agua
  agregada × `ml_100l_reposicion` / 100 (redondeo a ml); agua a agregar = capacidad − regla. Todo editable; sin dosis no sugiere.
- **Tramos (`banoCalcular()`, igual que la vista del servidor, para que ande sin señal)**: desde la carga, una reposición o un fin del día hasta la
  siguiente regla (reposición, fin del día o cierre). Nivel al empezar = agua inicial, regla + agua agregada de la reposición, o regla del fin del
  día. L/animal solo si todas las tandas del tramo tienen cantidad y suman > 0; si no, "sin conteo" (sin alarma). `< l_animal_min` bajo, `>
  l_animal_max` alto. "Toca reponer" cuando el gasto desde la última carga (real, por la regla) **más** lo estimado de las tandas posteriores
  a la última regla (× 4 L/animal, `BANO_L_ESTIMADO`, se muestra "estimado") llega a `umbral_reponer_l`.
- **Tanda y bastón**: "¿La vas a pasar por el bastón?" viene en "Sí" donde el bastón carga Sanidad (`CONFIG.completarCsvBaston`, hoy solo La
  Vuelta) y en "No" en María Laura. Con "No" la cantidad es obligatoria y la tanda crea el tratamiento en Sanidad **por la cola de siempre**
  (`guardarSanidadCarga()`: id `sc_…`, fecha de hoy, producto1 = producto del ciclo, dosis1 = 0, observaciones "Baño de aspersión · tanda hh:mm";
  `establecimiento` en La Vuelta, `dueno` en las tablas nativas; en La Vuelta también va a "Mis cargas recientes") y guarda ese id en
  `sanidad_id`. Con "Sí" no se crea nada en Sanidad.
- **Todo vive aparte de `estado`**: `localStorage[<ESTABLECIMIENTO>_bano_v1]` = `{config, catalogo, ciclo:{ciclo, lecturas}, cola, servidor:{estado,
  avisos, hora}, ultimo, cerrados}`, leído y escrito fresco siempre. No va al Backup JSON ni a Verificar stock; "Restablecer datos de fábrica" no lo borra.
- **Cola propia** (`banoVaciarCola()`, mismo criterio que Insumos): se guarda antes de mandar, de a uno y en orden; una lectura cuyo ciclo sigue en
  cola espera; 23505 = enviado; sin respuesta / 5xx / 408 / 429 = pasajero; 22 / 23 / 42 / PGRST = permanente (error + "Quitar"; quitar un ciclo
  quita sus lecturas) y sigue con las demás. Se vacía al abrir, al guardar, con "🔄 Actualizar" y en cada `sincronizar()` (`banoAlSincronizar()`, en
  segundo plano; con la pantalla abierta también la refresca). Lo rechazado se reintenta **solo** al abrir la pantalla o con "🔄 Actualizar"
  (no en cada guardado ni sincronización). Si se guarda algo mientras se manda, la misma vuelta hace otra pasada (`_banoOtraVuelta`).
  "Quitar" una lectura la saca también de las lecturas del ciclo; quitar un `cierre` vuelve a abrir el ciclo (`cicloCerrado`); quitar una tanda
  sin bastón avisa que su fila de Sanidad ya salió. La tanda se guarda en el equipo **antes** de encolar su fila de Sanidad. La regla leída
  (reposición, fin del día, cierre) no puede ser mayor que el nivel con que empezó el tramo. Un refresco que llega tarde no reabre un ciclo que
  se cerró acá mientras esperaba.
- **Otro equipo ve el ciclo**: al abrir con señal se trae `bano_config`, las dos RPC y, del ciclo abierto del campo, `bano_ciclos` + `bano_lecturas`
  (por `ciclo_uid`, orden hora, id), que se juntan con lo local sin duplicar por `uid`. Si el servidor ya no lo tiene abierto y no queda nada en cola,
  se da por cerrado en otro equipo. Un ciclo cerrado acá no se vuelve a tomar del servidor mientras su cierre no subió (`cerrados`).
- **⚙ Productos**: lista de `bano_config` ("falta la dosis" en naranja), "+ Agregar producto" (nombre exacto de `productos_catalogo`) y "Editar"
  → RPC `bano_config_guardar` (manda `l_animal_min/max` que ya tenía, o 3/5). **Necesita señal**, no va a la cola.
- **Si cambia el esquema** de las tablas o las RPC del baño: `banoFilaParaEnviar()` y `banoRefrescarServidor()`.
- Tests: `tests/probar_bano.js` (9 variantes, Supabase falso con `uid` único, FK y checks simulados; en el CI, incluye el caso de Pedro: tramos 300 L
  sin conteo, 400/80 = 5,0 ok, 0 L sin conteo, 250/60 = 4,17 ok, 1.917 ml). `probar_clave_campo.js` ya ignoraba las RPC que no son
  `verificar_clave`. Instructivos: sección "🛁 Baño", fila de "Según tu campo" y los flags `bano` y `completarCsvBaston` en `probar_instructivos.js`.
