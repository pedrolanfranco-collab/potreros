# Sanidad, padrón y lector del bastón

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### Sanidad ("+ Cargar tratamiento")

Each establishment logs animal-health treatments differently, and this is
**separate from `eventos_sync`** — a treatment record never touches
`estado.potreros`, so it has its own Supabase table(s) and its own offline
queue (`estado.colaSanidad` / `guardarSanidadCarga()` / `vaciarColaSanidad()`,
called from `sincronizar()` right after `vaciarColaSync()`).

- **La Vuelta**: writes to `sanidad_carga` (shared table, filtered by an
  `establecimiento` column) and still has a real bridge to an external Excel
  workbook (outside this repo) — `importado_en` tracks whether a row has been
  picked up by that bridge, and the "Mis cargas recientes" tri-state UI
  (`sanidad-mis-cargas`) reflects it.
- **María Laura and Pone Chico**: each has its own dedicated table
  (`sanidad_carga_maria_laura`, `sanidad_carga_pone_chico` — same schema
  minus `establecimiento` and `importado_en`, since the table itself
  identifies the establishment and there's no Excel bridge to track). The
  table name comes from `CONFIG.tablaSanidad` (`TABLA_SANIDAD =
  CONFIG.tablaSanidad`, set per establishment in `template/configs/*.js`)
  and both reads and writes go straight there — no tri-state UI, just one
  unified `sanidad-lista`.
- `productos_catalogo` (product dropdown in the treatment form) **is**
  shared across all three establishments on purpose — it's a reference list,
  not an operational record, and María Laura/Pone Chico sync their catalog
  from La Vuelta's.
- **`apto_desde`/costo (12/9/2026)**: `productos_catalogo` also carries
  `dias_retiro`/`valor_dosis_ml` per product, published from the same
  Excel sheet as the rest of the catalog (outside this repo — see memory
  `planilla-sanitaria-v22`). `cargarCatalogoProductos()` loads them into
  `catalogoDatos`, and `datosProducto()`/`calcularAptoDesde()`/
  `calcularCostoAnimal()`/`lineaCalculoSanidad()` do the actual math in JS
  (`apto_desde = fecha + dias_retiro`; `costo = dosis × cantidad ×
  valor_dosis_ml`) — no Postgres view, matching how every other
  calculation in this app is plain client-side JS. María Laura/Pone Chico
  show it unconditionally in `renderSanidadLista()`; La Vuelta shows it in
  `renderMisCargasSanidad()` labeled **"Estimado"**, since the actual
  authoritative `apto_desde` for La Vuelta still comes from
  `sanidad_ultimos` once the Excel bridge processes the record — this is
  only a same-device preview to avoid the bridge's delay. A product typed
  as free text (not in the catalog) shows nothing calculated, same
  graceful-degradation as the dropdown itself.

- **Editar/borrar un tratamiento (7/10/2026, solo PC):** ✏️/🗑 en las tarjetas de Sanidad
  (`editarTratamiento()` / `borrarTratamiento()`, bloque `@pc`). La tabla se actualiza/borra ahí mismo (no
  hay evento: los demás dispositivos lo ven al abrir Sanidad). **PostgREST contesta 200 con lista vacía
  cuando RLS bloquea**, así que se pide la fila de vuelta (`.select('id')`) y solo se da por hecho si
  volvió exactamente una; si no, avisa. En La Vuelta se agrega `.is('importado_en', null)`: lo que el
  Excel de respaldo ya importó no se toca desde la app (se corrige en el Excel) y la política de DELETE
  de `sanidad_carga` lo exige también en la base. Las tarjetas de `estado.colaSanidad` (sin subir) se
  editan/borran localmente. Requiere las políticas UPDATE/DELETE de la tabla de arriba. Test:
  `tests/probar_sanidad_editar_borrar.js`.

- **Cargar tratamientos desde un CSV a mano (18/10/2026, a pedido de Pedro):** `scripts/sanidad/cargar_sanidad_csv.py` (PC, clave
  privada) inserta filas en `sanidad_carga` / `sanidad_carga_maria_laura` / `_pone_chico` para tratamientos que **no** vienen del bastón.
  Simula por defecto (`--aplicar` para escribir), es todo-o-nada, valida el producto contra `productos_catalogo` y es idempotente
  (id `csv_…` del contenido). No pasa por el Lector XRS2 ni por `Entrada\`. Detalle y columnas en `scripts/sanidad/README.md`;
  prueba `probar_cargar_sanidad_csv.py` (en el CI, `python3`).

### Pesadas (2/10/2026, solo La Vuelta, `CONFIG.pesadasHistorial`)

El historial de pesadas por animal y la ganancia diaria **ya los calcula la PC**
(`animales.py`, tabla `pesadas` de `xrs2_lecturas.db`, carpeta `Lector XRS2` de
OneDrive: umbrales 80–900 kg y 21 días mínimos entre pesadas) y
`publicar_animales.py` los sube a `animales_caravana` (columnas `pesadas jsonb`,
`ganancia_diaria`, `pesadas_totales`; SQL en `scripts/snig/alter_pesadas.sql`,
**correrlo antes de publicar**). La app solo lee y no recalcula nada. Cada
elemento de `pesadas` es `{f, p, g, s, o, c, a}` (fecha, kg, ganancia del
intervalo, sospechosa, potrero del bastón, categoría, sesión).

- **Por animal**: bloque "Pesadas" en la ficha de caravana
  (`pesadasFichaHTML()`), PC y móvil (también sale en la simple, que comparte
  `fichaCaravanaHTML`).
- **Por lote**: "⚖️ Pesadas" (`#modal-pesadas`, solo variantes completas). Lote =
  **sesión del bastón** (`f` + `a`), NO fecha+potrero: 719 de las 1039 pesadas
  históricas tienen el potrero vacío y el resto viene tipeado a mano
  ("EMBARCADER6", "FORCER"). Promedio/mayor/menor excluyen las sospechosas. La
  proporción es pesados / stock **actual** del potrero en la app (con
  categoría si se filtra, "—" si el nombre del bastón no coincide).
- La consulta del lote pagina de a 1000 (PostgREST corta sin avisar). Test:
  `tests/probar_pesadas.js`.

### Rodeo y nota en la ficha de caravana (13/10/2026, a pedido de Pedro)

La ficha de "🔎 Buscar caravana" muestra **Rodeo** y **Nota**, justo debajo del
Potrero, cada uno con la fecha de la lectura de la que sale entre paréntesis.
Los publica la PC (`animales.py` / `publicar_animales.py`, carpeta del lector
XRS2) en `animales_caravana` como `rodeo`, `rodeo_fecha`, `nota`, `nota_fecha`:
el valor de la **última lectura que lo trae** (una lectura sin rodeo no borra el
anterior). No son datos fijos del animal: el rodeo es un lote de trabajo y
cambia, y la nota mezcla etiquetas de sesión con observaciones sueltas. La app
solo lee; `buscarCaravana()` pide `select('*')`, así que la ficha los toma sola
apenas existan las columnas (`supabase_rodeo_nota.sql`, que corre Pedro **antes**
de publicar: sin las columnas la PC publica sin esos campos y la ficha queda
como estaba). Sin dato la fila no aparece. Test: `tests/probar_ficha_rodeo_nota.js`.

### Padrón sin señal (31/10/2026, a pedido de Pedro, `CONFIG.padronOffline`, solo La Vuelta móvil y Campo)

"🔎 Buscar caravana" sin señal usa una copia del padrón guardada en el celular. La copia es la base IndexedDB `potreros_padron`
(aparte de `potreros_fotos`: subirle la versión para agregar un store dejaría a la cola de fotos sin poder abrirla), con **un solo
registro por establecimiento** `{establecimiento, dispositivo, animales:{id8: fila}, n, maxLectura, completaEn, actualizadoEn}`
(guardarlo entero es atómico). Se actualiza desde `sincronizar()` en segundo plano: entera una vez por día (así entran las bajas y
los cambios de carencia sin lectura nueva) y, si no, diferencias cada 30 min con `gte('ultima_lectura', maxLectura)` (`>=`: es una
fecha sin hora). Paginado con `traerTodo(..., 'id8')`, porque `animales_caravana` no tiene `id`. Una bajada completa **vacía** no
pisa una copia con datos (RLS contesta 200 vacío con la clave mala), y sin clave del campo ni se intenta. Con señal la búsqueda sigue
igual; si el pedido falla o no contesta en 6 s, usa la copia y dice `📴 Sin señal: datos del padrón al …` (7 días o más, en rojo).
Vale solo para el ID de dispositivo que la bajó: "Restablecer datos de fábrica" borra ese ID y la copia. No va a localStorage ni a
`estado`, así que no sale en el Backup JSON. **Columnas:** la copia usa `PADRON_COLUMNAS`; si la ficha empieza a mostrar una columna
nueva, agregarla ahí también (`tests/probar_padron_offline.js` compara la ficha desde la copia con la de la fila completa). Test:
`tests/probar_padron_offline.js` (en el workflow). En jsdom solo se prueba el respaldo en memoria, no IndexedDB real.

### Datos faltantes (13/10/2026, a pedido de Pedro, solo PC de La Vuelta, `CONFIG.datosFaltantes`)

Una lectura del bastón **sin categoría** ya no tranca su tratamiento: `sanidad_puente.py` (carpeta del
lector XRS2) lo manda a Sanidad con la categoría de la **ficha** del animal (o "Sin categoría" si la ficha
tampoco la sabe; una de ficha sin confirmar, como Vaquillona, sigue sin pasar). Rige desde el 13/10/2026
(lo anterior ya se avisó para cargarlo a mano). `publicar_animales.py` publica en
`animales_caravana.faltantes` (jsonb, `supabase_faltantes.sql`, **correrlo antes**) la lista de esas
lecturas con lo que pasó, y la PC la muestra en Herramientas › Consultar › "⚠ Datos faltantes (N)"
(últimos 60 días, CSV). La app solo lee. Test: `tests/probar_datos_faltantes.js`.

### Reproducción: tacto y DAO (3/11/2026, a pedido de Pedro, solo PC de La Vuelta, `CONFIG.reproduccion`)

La PC (`repro.py`, carpeta del Lector) clasifica cada sesión del bastón como TACTO, DAO o IATF **por el nombre del archivo** y, si el
nombre no lo dice, por el contenido de la columna TACTOS (tacto y DAO comparten esa columna; `969_PALPACION` sale DAO porque trae
CICLA/SUP/PROF). Publica en `animales_caravana` las columnas `repro` (jsonb, `[{f,t,e,r,p,s,o}]` = fecha, tipo, etapa, resultado,
productos, sesión, potrero), `estado_repro` y `repro_fecha` (SQL: `scripts/snig/alter_repro.sql`, que se corre **antes** de publicar).
La app **solo lee** y no recalcula: ventana "🐄 Reproducción" (Herramientas › Consultar: Tactos y DAO, IATF, Cruces) y línea de tiempo en la
ficha de caravana (`reproFichaHTML`, que solo define la PC). **Pedro decidió mostrar solo tacto y DAO**: un evento IATF que llegue en `repro`
se ignora. Una sesión mal clasificada se corrige en `repro_sesiones.csv` del Lector (`sesion;tipo;etapa;por_que`, `IGNORAR` la saca),
nunca en la app. Resultados normalizados: `PRENEZ_GRANDE/MEDIA/CHICA`, `PRENEZ` (sin tamaño), `VACIA`, `DUDA`, `CICLANDO`,
`ANESTRO_SUP/PROF`, `ANESTRO`; un valor desconocido llega crudo y se muestra tal cual. Valor de control real: de 44 ciclando en el DAO
(sesión 969), 20 preñez grande + 10 media + 14 vacías en el tacto 1116. Test: `tests/probar_reproduccion.js`.

### Lecturas vs stock y WhatsApp (8/11/2026, a pedido de Pedro, PC de La Vuelta y María Laura, `CONFIG.lecturaStock`)

Normalmente se leen todos los animales del potrero; si se leyeron menos, Pedro se entera de dos formas:
- **Aviso al celular** (Lector, `lectura_stock.py`): "leyó 85 de 92 en el potrero 8 (faltan 7: Vacas 5)", comparando contra `stock_potreros`.
- **Ventana "📋 Lecturas vs stock"** (Herramientas › Consultar), que compara cada sesión contra el stock **en vivo** de la app, total y
  por categoría, con las caravanas que figuraban en el potrero y no se leyeron.
- **Datos:** el Lector publica una fila por sesión de los últimos 45 días en `sesiones_baston` (SQL `scripts/snig/sesiones_baston.sql`;
  `anon` solo lee, con la clave del campo; la escribe el Lector con la clave privada). La app solo lee.
- **Potrero de la sesión:** en La Vuelta lo tipea el operario (si no es un potrero de la app: "no se pudo comparar"); en María Laura
  sale del nombre del archivo (`ML-TAJAMAR`; un nombre con prefijo `ML-` es de María Laura, regla en `reconstruir_xrs2.proponer_campo`).
- **Regla de stock, la misma en el Lector y en la app:** cuenta las categorías bovinas (`ESPECIES.bovino`; `BOVINOS` en
  `lectura_stock.py`) más las que la sesión leyó. "Faltan" y "urgente" cuentan solo categorías de las que se leyó algo: una categoría con
  0 leídos (los terneros cuando solo se vacunaron las vacas) es "lote parcial", sin alarma. **Si se cambia la lista en un lado, se cambia
  en el otro.** Un bug real: el aviso del celular ignoraba las categorías no leídas y decía "coincide" cuando la PC decía "faltan 15"; las
  pruebas no lo vieron porque llamaban a `comparar()` con otro argumento que `avisos()`.
- **Límite conocido:** una sesión vieja se compara con el stock de hoy (los animales se movieron después); la ventana lo avisa si la
  sesión tiene más de 2 días. Sirve sobre todo para sesiones nuevas.
- **WhatsApp (Hermes):** `avisar.whatsapp()` del Lector corre `hermes send` hacia `WHATSAPP_DESTINO` (en el `.env` del Lector, no versionado).
  `vigilar_entrada.whatsapp_problemas()` manda por WhatsApp las líneas del aviso que indican un problema (archivo que no se pudo leer,
  padrón sin publicar, Sanidad sin pasar o con error, falla de la corrida, faltantes de lectura), **una sola vez cada una**, y reintenta si
  Hermes estaba caído. Nunca lleva caravanas, dueños ni montos.
- Tests: `tests/probar_lectura_stock.js` (app), `probar_lectura_stock.py`, `probar_avisar_whatsapp.py` y `probar_vigilar.py` (Lector).

### Lector XRS2 (otro carril)
El Lector del bastón es otro repo (`lector-xrs2`, carpeta `C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Lector XRS2`). Su contexto completo, el flujo `Entrada\` → `vigilar_entrada.py` → `sanidad_puente.py` y el incidente del 13→18/10/2026 viven ahora en el `CLAUDE.md` de esa carpeta. Puntos de contacto con la app: el Lector publica `animales_caravana` y `sanidad_carga*` y la app los lee; la app arma el CSV completado (`completar-sanidad/` y "Completar lectura del bastón") que el Lector toma de `Entrada\`.

### Completar lectura del bastón (CSV) dentro de Sanidad (20/10/2026, a pedido de Pedro, solo PC de La Vuelta, `CONFIG.completarCsvBaston`)

Para cuando en la manga solo se leyó con el bastón y no se cargó la sanidad. En la ventana 🏥 Sanidad de la **PC de La Vuelta**
hay un tercer botón, "📂 Completar lectura del bastón (CSV)": se abre el CSV que exporta la app de Datamars, se eligen las
categorías, producto (solo del catálogo, sin "Otro"), dosis (coma o punto), producto 2 opcional y potrero (los 31 de la app), y
"💾 Guardar en Entrada" guarda **el mismo archivo con el mismo nombre** con `showSaveFilePicker` (id fijo `entrada-baston`, así la
PC recuerda la carpeta `Lector XRS2\2026-2027 Ejercicio Siguiente\Entrada\`); si la sesión vacía ya había entrado, se elige ese
mismo archivo y se pisa. Sin esa función del navegador baja el archivo con el mismo nombre para moverlo a mano. **La app no escribe
nada en Supabase** (solo lee `productos_catalogo`): el Lector registra la carencia por animal y `sanidad_puente.py` crea el
tratamiento (ver "Lector XRS2 y trabajo desde la nube"). Es la lógica de `completar-sanidad/` (la página suelta, que sigue para el
celular) traída al template con prefijo `cb` dentro de bloques `@pc`; el botón sale solo con el flag, que solo tiene La Vuelta
(María Laura/Pone Chico: el puente a Sanidad no existe). Si cambia el CSV de Datamars, tocar las dos copias. Test:
`tests/probar_csv_baston_pc.js`.

### Completar sanidad del bastón (`completar-sanidad/`, 18/10/2026, a pedido de Pedro)

Página suelta (como el tablero: no generada, sin `sw.js` ni librerías) para cuando en la manga se usó el bastón pero
no se cargó la sanidad. Pedro abre el CSV exportado de la app de Datamars (en el teléfono o la PC), elige producto (del
catálogo), dosis, producto 2 / dosis 2 opcionales, potrero (los 31 de La Vuelta) y qué categorías, y baja **el mismo archivo**
(mismo nombre, separador, saltos `\r` y codificación; las celdas no tocadas salen idénticas) con `PRODUCTO`, `DOSIS`,
`PRODUCTO2`, `DOSIS 2`, `POTRERO` llenos (las agrega al final si faltan). Ese va a `Entrada\`: el Lector registra la carencia por
animal y `sanidad_puente.py` crea el tratamiento. Las filas que ya traían producto no se tocan.
- **No escribe nada**: solo lee `productos_catalogo` (con una copia de los 50 nombres al 18/10/2026 si no hay señal). El
  producto se escribe con el nombre **exacto** del catálogo, que `sanidad_puente.py` acepta sin `productos_sanidad.csv`; uno
  que no está en la lista no se deja usar. Dosis con coma o punto (sale con punto); campos de texto, no `type=number`, que
  descarta "2,5".
- La lista de potreros está copiada en la página: `tests/probar_completar_sanidad.js` falla si deja de coincidir con
  `potrerosGeo` de `template/configs/la-vuelta.js` (contra esos valida `sanidad_puente.py`).
- Verificado el 18/10/2026 con el export real de la sesión 1154 pasado por `csv_con_encabezado()` / `mapear()` del Lector:
  93 filas, mismo encabezado, solo cambian las 5 columnas.
- **Fase 2 hecha (20/10/2026, PR #1 de `lector-xrs2`, `7cb5dd5`)**: `vigilar_entrada.py` agrega al aviso del celular "OJO: <sesión> (N animales)
  entro SIN producto ni dosis", urgente y con el link de esta página, cuando una sesión **nueva** de **La Vuelta** entra por `Entrada\` sin producto,
  peso ni tacto (`tipo_de_sesion() == ["conteo"]` + `vino_por_entrada()`, que mira `lecturas.archivo` con `\Entrada\` o `/Entrada/`). No avisa con
  producto o peso, en María Laura, fuera de `Entrada\`, ni para un archivo reemplazado (la sesión ya estaba en `sesiones.csv`). Test: 9 controles en
  `probar_vigilar.py` (verificado con mutaciones). Pedro hizo `git pull` en la PC y la prueba dio "todo bien".

## Propietario del SNIG (9/11/2026)

A pedido de Pedro: el propietario sale del SNIG, animal por animal. Está en La Vuelta y María Laura (`CONFIG.propietarioSnig`, objeto con `mapaDuenos`). Pone Chico lo tiene apagado (`false`): tiene SNIG pero todavía no está operativo.

- **Qué publica el Lector** (`publicar_animales.py`, en `animales_caravana`): `propietario_snig` (nombre según el SNIG, nunca el código DICOSE), `en_snig` (true; false = el SNIG no la tiene aunque hay export de ese campo; null = no hay export de ese campo), `campo_snig` (`la_vuelta` o `maria_laura`, dónde la ubica el SNIG) y `snig_ingreso` (fecha de ingreso al predio según el SNIG). También publica los **solo-SNIG**: `en_snig` true y sin `ultima_lectura`, o sea, lo que el SNIG tiene y el bastón nunca leyó.
- **SQL**: `scripts/snig/alter_propietario_snig.sql`. Son columnas nuevas y opcionales (aditivo). Se corre en el SQL Editor **antes** de publicar el Lector (regla 11). Si se publica antes, el Lector saca las columnas que no existen y avisa en el log.
- **Dos estados para los solo-SNIG** (`snigSinDatosSanitarios`, `snigEstadoSinLectura`, `SNIG_SIN_LECTURA_DIAS = 183`): hasta 183 días desde `snig_ingreso`, "🆕 PENDIENTE DE PRIMERA LECTURA"; más, o sin fecha, "❓ VIVO SIN REGISTRO EN EL PREDIO" (pueden ser muertos sin baja en el SNIG, cargados por error o animales que nunca se leyeron; el SNIG manda sobre el campo). La cuenta la hace el celular con la fecha de hoy, así que cambia sola sin republicar. No son "apto" y no cuentan en el stock ni en las categorías.
- **Campo y fecha según el SNIG**: la alerta dice "⚠ Según el SNIG está en <campo> desde el DD/MM/AAAA" (`snig_ingreso`) y, si ese ingreso es posterior a `ultima_lectura`, agrega "(después de la última lectura del bastón)". En el lote (`snigLineaLoteHTML`) sale solo "otro campo según el SNIG: <campo>", sin fecha.
- **Nunca bloquea nada**: la línea "Propietario (SNIG)", "Sin SNIG — firma: …" y la alerta "⚠ Según el SNIG está en …" (`campo_snig` distinto del campo) solo informan. El stock sigue saliendo de los eventos (regla 18): esta función no escribe en `stock_potreros` ni en `eventos_sync`.
- **Puntos de código**: `propietarioSnigDe(a)` (texto y alerta; `mapaDuenos` traduce el nombre del SNIG, y sin mapa queda tal cual), `propietarioSnigAusente()`, `CAMPOS_SNIG_LEGIBLES`; en la ficha, `fichaCaravanaHTML`; debajo de los casilleros, `snigBloqueHTML`, `snigProgramar` y `snigSugerirDueno` (dueño sugerido en la muerte: solo `f-caravana`, y no si la persona ya tocó el select); PC: `snigListaSinLectura` y `abrirSnigSinLectura` (🧾 SNIG sin lectura, botón `btn-snig-sin-lectura`, CSV `sl-csv`); `resumenSnigPotrero` (Ver por dueño); `asegurarPestanaSnig` (pestaña Por propietario SNIG del Stock total); `snigParaReporte` (PDF y Excel de Estado de potreros).
- **Mapa de nombres** (`CONFIG.propietarioSnig.mapaDuenos`): La Vuelta `{"Silvia": "Silvia Dutra"}`; María Laura `{"Pedro Lanfranco": "Pedro"}`. Un nombre nuevo del SNIG que no esté en el mapa se muestra tal cual: se agrega al config, se sube la versión y se regenera.
- **Prueba**: `tests/probar_propietario_snig.js` (en el workflow: PC de los 3 campos, móvil y Campo de La Vuelta). El caso de Pone Chico cubre solo el flag apagado.
