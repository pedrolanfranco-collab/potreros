# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static PWAs for managing livestock ("hacienda") by paddock ("potrero") on real
working farms in Rivera, Uruguay. No backend, no build step, no bundler —
each app is a single self-contained HTML file with inline CSS/JS, hosted
directly on GitHub Pages from the `main` branch (push to `main` = live).

There are three establishments, each with a **PC** variant and a **móvil**
(mobile) variant, plus one throwaway test copy:

| Folder | Establishment | Notes |
|---|---|---|
| `la-vuelta-pc/`, `la-vuelta-movil/` | La Vuelta | 31 paddocks, owner-per-animal as **optional** "Firma" (Pedro Lanfranco, Silvia Dutra, Fideicomiso, Walter Lanfranco) — for DICOSE, not a person-per-owner model like the other two |
| `maria-laura-pc/`, `maria-laura-movil/` | María Laura | 5 paddocks (Tajamar, Casco, Uno, Rincon, Manantial), owner-per-animal as **required** `Dueño` |
| `pone-chico-pc/`, `pone-chico-movil/` | Pone Chico | newest establishment, starts with zero paddocks — they're added later via "Importar KML/KMZ" |
| `la-vuelta-test/` | — | disposable clone of `la-vuelta-movil-campo` for testing on a phone; not kept in sync automatically. **Since 1/10/2026 it has no Supabase at all** (`clienteSupabase()` returns `null`, URL/key removed): before, it wrote to the real tables under the label `la_vuelta_test` (136 table calls on startup; 7 `eventos_sync` + 5 `stock_potreros` rows are still there). Guarded by `tests/probar_test_aislado.js` in CI. If you refresh it from `la-vuelta-movil-campo`, re-apply that change or the test fails. |

Each folder is served at `pedrolanfranco-collab.github.io/potreros/<folder>/`
and contains: `index.html` (the whole app, **generated — see below**),
`manifest.json`, `sw.js`, and six `icon-*.png` sizes. The root-level
`index.html`, `potreros.html`, `manifest.json` and `launchericon-*.png`
predate the per-establishment split and appear to be an unmaintained leftover
from before the multi-app structure existed; don't assume they're wired up to
anything.

**Every `index.html` in this repo is generated — never edit one directly.**
Since 12/9/2026 the 6 files come from a single `template/potreros.template.html`
plus `template/configs/*.js`, run through `template/generar.js`. See
"Template system" below before touching app behavior.

## Commands

There is no package manager, build, lint, or test command in this repo —
it's plain HTML/CSS/JS loading Leaflet, JSZip, `@supabase/supabase-js`,
jsPDF and SheetJS from CDNs via `<script src>` tags.

**Local preview:**
```
cd la-vuelta-movil && python -m http.server 8000
```
Then open `http://localhost:8000/`. Do this for whichever variant folder you're editing.

⚠️ **This is not a sandbox.** Every variant talks to the real, shared
production Supabase project (`skkknfjpwcstefcroqjt`, same URL/key hardcoded
in every `index.html`). Serving a file locally does not isolate it — clicking
anything that records a movement, sync, or import sends a real event. Prefer
reading/inspecting in the browser, or testing logic changes in an external
jsdom harness (not part of this repo) before touching the app interactively.
The `.gitignore` excludes `probar_*.js`, `parchear_fecha.js`, `node_modules/`,
`package.json` — that's where such throwaway test scripts are expected to
live locally, never committed.

**Deploy:** `git add` the changed folder(s), commit, `git push`. There is no
build step, but **since 9/10/2026 the push no longer publishes by itself**: the
`publicar` job of `.github/workflows/probar.yml` deploys to GitHub Pages
(`actions/deploy-pages`) only after the `jsdom` job passes, so a version with a
failing test never reaches the phones (before, Pages built from the branch in
parallel with CI and CI failed 7 of 115 times with the broken version already
live). This needs *Settings → Pages → Source = "GitHub Actions"*; with
"Deploy from a branch" the `publicar` job fails at `configure-pages`. Expect
about 3 minutes (tests) plus ~1 minute (publish); verify with
`curl -H "Cache-Control: no-cache" <url>` rather than assuming an instant
deploy. If the tests fail, nothing is published and the previous version stays
up: fix and push again.

**CI:** `.github/workflows/probar.yml` runs on every push/PR to `main`, with
`TZ=America/Montevideo` (the runner is UTC, which hid a timezone bug in the day
dates). Its first step fails if any `tests/probar_*.js` is not listed in the
workflow (a test outside the list never runs). Then
`node template/generar.js --check` — regenerates all 9 files in memory
and fails the build if any committed `index.html` doesn't match (someone
edited a generated file by hand, or edited the template/configs without
regenerating), and also fails if any `sw.js`'s `CACHE` doesn't match the
config's version (someone bumped the version but forgot to regenerate).
After that, 19 jsdom test scripts (`tests/probar_*.js`, using
`tests/package.json`'s pinned `jsdom@30.0.1`/`jszip@3.10.1`) run against the
published `index.html` files of whichever folders each script targets. These
are the same scripts as `scripts/probar_*.js` in the `apps-potreros` skill —
kept in sync with `node tests/sync-skill.js` (`--check` to only verify,
no args to copy `tests/probar_*.js` → the skill; no symlink, since they're
different filesystem roots for different tools). This only runs locally —
GitHub Actions has no access to the skill's path on Pedro's machine, so it
can't be a CI step; run it by hand before committing a test change. Two of
them (`probar_pone_chico.js`,
`probar_eliminar_potrero.js`) accept a `process.argv` file list with a
hardcoded fallback. Check the actual Actions run after pushing — "works on
my machine" isn't enough; a Node version or YAML-parsing mismatch has broken
this CI before without any local symptom.

**Before shipping any change**, bump the version or a device that already
installed the app as a PWA keeps serving the stale cached version
indefinitely:
1. `versionPc`/`versionMovil` in that establishment's `template/configs/<nombre>.js`.
2. Re-run `node template/generar.js` (writes the 6 `index.html` **and** the
   6 OneDrive master files Pedro also keeps in sync). Since 12/9/2026 this
   **also** rewrites the `CACHE` constant at the top of that folder's
   `sw.js` (e.g. `'la-vuelta-movil-v2.21'`) to match — nothing else in
   `sw.js` is touched or generated (`PRECACHE_URLS` and the listeners stay
   hand-maintained per folder). `--check` fails if any `sw.js`'s `CACHE`
   is out of sync with its config, same as it does for a hand-edited
   `index.html`.

## Architecture

### Template system (`template/`)

All 6 `index.html` come from one source: `template/potreros.template.html`
(the shared code) + `template/configs/{la-vuelta,maria-laura,pone-chico}.js`
(the per-establishment data and feature flags) → `template/generar.js`
(the generator). **Never edit an `index.html` directly** — edit the template
or the relevant config, then `node template/generar.js` (writes all 6
`index.html` files *and* the 6 OneDrive master files at
`C:\Users\Pedro\OneDrive\Proyecto Gestion ganadera`, in one pass, from the
repo root). `node template/generar.js --check` verifies without writing —
that's the first step of CI.

A prior attempt at a shared master (`<name>_maestro.html` → cut-PC/cut-móvil
by line range) was abandoned because line ranges drifted with every edit —
see the git history before 12/9/2026 if you need the old per-file discipline.
This template avoids that failure mode: differences are marked by **comment
delimiters**, matched by regex, immune to the file growing.

**Marker scheme** — `generar.js` strips inactive blocks and unwraps active
ones before writing:
- HTML: `<!-- @name:start -->` … `<!-- @name:end -->`
- JS: `// @name:start` … `// @name:end` (start/end must share the same
  leading whitespace — the stripping regex depends on it)

Four independent marker axes, each resolved from `configs/<name>.js`:
| Axis | Active when | Feature |
|---|---|---|
| `pc` / `movil` | which variant is being generated | PDF/Excel export & UG-coefficient editor (PC) vs. GPS + voice input (móvil) — see below |
| `mapLabels` / `noMapLabels` | `config.mapLabels` | on-map paddock labels + click-popup (María Laura/Pone Chico only — La Vuelta's 31 paddocks would be unreadable) |
| `sanidadExcel` / `sanidadNativa` | `config.usaExcelBridge` | Sanidad subsystem: shared table + Excel bridge (La Vuelta) vs. native per-establishment table (María Laura/Pone Chico) |
| `duenoVoz` / `sinDuenoVoz` | `config.duenoObligatorio` | whether the voice-command confirmation form asks for Dueño/Firma at all — La Vuelta deliberately doesn't (voice-logged animals default to unassigned, reassign later from the normal forms) |

Everything else establishment-specific is `CONFIG.<campo>` (injected as a
single `const CONFIG = {...};` line, first thing inside the `<script>` tag
that also declares `POTREROS_GEO`) rather than a marker — see each
`configs/*.js` for the full schema (`potrerosGeo`, `puntosSeed`, `duenos`,
`duenoLabel`, `duenoObligatorio`, `cargaInicialSeed`, `nombresViejosPotrero`,
`vacasPrenadasTemporada`, `tablaSanidad`, `usaExcelBridge`, `mapLabels`,
`mapaFallback`, `fixFechaIngreso`, plus display strings). A handful of
placeholders (`__TITULO__`, `__THEME_COLOR__`, `__NOMBRE__`, `__SUBTITULO__`,
`__VERSION_PC__`, `__VERSION_MOVIL__`) are plain string substitutions, used
where a literal has to sit outside the `CONFIG` object (page `<title>`, meta
theme-color).

### PC vs. móvil split

- **PC**: has PDF export (jsPDF), Excel export (SheetJS), and a UG-coefficient
  editor modal. No GPS.
  **Caja "🛠 Herramientas" de la PC (10/10/2026, a pedido de Pedro)**: ordenada por funciones —
  Consultar / Mapa y potreros / Exportar y respaldo / Este dispositivo, en 2 columnas, 17 botones en vez de
  26 (18 desde el 12/10/2026, con "🔍 Verificar stock" en Consultar; 19 desde el 13/10/2026, con "🔑 Clave del campo" en Este dispositivo)—; "Agregar potrero" (Importar KML/KMZ, Dibujar), "Puntos", "Reportes de campo", "Exportar" y "Backup"
  abren un sub-menú dentro de la misma caja (`data-sub` / `data-volver`, `mostrarSubmenuHerramientas()`).
  Los botones conservan su `id` y su listener (solo cambiaron de lugar); "Exportar MD" se sacó
  (`construirMD()` queda: la usan las pruebas). Test: `tests/probar_herramientas_pc.js`. La móvil y Campo
  no cambian.
  **Campo (móvil simple), visualización (10/10/2026, a pedido de Pedro)**: todo en bloques `@simple`: mapa a
  45vh en el celular (más lista), total del potrero grande (26 px en la tarjeta, 28 px en el detalle), botones de
  acción y campos de formulario de 48–56 px con letra de 16 px, Muerte/Desaparecido al final y separados,
  historial plegado en un `<details>` (se acuerda abierto mientras no cambie de potrero) y el formulario de una
  acción se desplaza solo a la vista, y el botón "Herramientas" del pie es más largo (ocupa lo que deja el estado de
  sincronización, que puede partirse en 2 renglones). Contraste al sol (10/10/2026): `--ocre` pasa a `#8f5f12` (blanco/ocre 3,0 a 5,5:1), grises de ayuda a 6:1,
  bordes de 2 px, etiquetas del mapa con contorno blanco y un interruptor "☀ Modo sol" en Herramientas
  (`body.modo-sol`, ~7:1, se acuerda en `<ESTABLECIMIENTO>_modo_sol`). La PC y la móvil completa no cambian. Test:
  `tests/probar_campo_visualizacion.js`.
- **móvil**: has GPS location + voice input for logging movements
  (`Web Speech API`, no external AI). No PDF/Excel/coefficient editor. Has two
  screens PC doesn't: **"📊 Stock total"** and **"👤 Quién soy"** (per-phone
  user identification, shared across establishments via one unprefixed
  `localStorage` key so a phone used for two apps only asks once).

The template (and therefore every generated `index.html`) is internally
organized under the same
`/* ======================= SECTION ======================= */` banner
comments — grep for these to navigate: `DATOS DE POTREROS`, `SINCRONIZACIÓN`,
`ESTADO`, `MOTOR DE SINCRONIZACIÓN`, `MAPA`, `SELECCIÓN Y DETALLE`,
`FORMULARIOS DE ACCIÓN`, `IMPORTAR LÍMITES DESDE KML/KMZ`, `BACKUP JSON`,
`ALERTAS Y UMBRALES`, `SANIDAD`, `CARGA POR VOZ` (móvil), `EXPORTAR *` (PC),
`DUEÑOS/FIRMA` (shared by all 3 now, label/optionality driven by config).

### Data model & per-establishment isolation

- `POTREROS_GEO` is a literal array baked into each `index.html`
  (`{nombre, area, coords}`, `coords` as `[lat, lon]` pairs), the paddock
  boundaries originally pulled from a KML export. Pone Chico ships with this
  empty (`[]`) — it has no paddocks yet.
- `ESTABLECIMIENTO` (a string constant) and `STORAGE_KEY` are the only things
  that separate one app's data from another's. All apps in this repo share
  one GitHub Pages **origin**, so `localStorage` is shared across them —
  every establishment must use a unique `STORAGE_KEY`, or one app's save
  data collides with another's in the same browser.
- `estado.potreros[nombre] = {animales, historial, fechaIngreso, fechaSalida}`
  is the persisted state, keyed by paddock name, saved to `localStorage`
  under `STORAGE_KEY`. `cargarEstado()`/`estadoInicial()` walk `POTREROS_GEO`
  to guarantee every paddock has an entry — see the initialization-order
  note below, it matters.
- All three establishments key `animales` by `"categoria||dueño"`
  (`claveAnimal()`/`partesClave()`/`detalleAnimales()`, shared code since
  12/9/2026) instead of bare category, since more than one owner/firm can
  have stock in the same paddock. The only real difference is whether the
  field is required, driven entirely by `CONFIG.duenoObligatorio`/
  `CONFIG.duenoLabel`/`CONFIG.textoSinAsignar`: María Laura/Pone Chico's
  `opcionesDuenos()` has no blank option (the field can't be left empty,
  label "Dueño"); La Vuelta's does (`<option value="">— sin asignar
  —</option>`, selected by default, label "Firma") because most existing
  stock predates the Firma feature and it's DICOSE bookkeeping, not a
  person-per-owner model. `partesClave()` deliberately returns the raw
  `dueno` (possibly `""`), not a display fallback — several call sites
  round-trip it back through `claveAnimal()` to build a new key, and baking
  a display string like `"(sin firma)"` in there would corrupt that key. A
  separate `textoFirma(dueno)` helper does the `dueno || CONFIG.textoSinAsignar`
  formatting only at display sites — use it (not a raw `${dueno}` or
  unconditional `" de " + dueno`) at every new display site, or it breaks
  for La Vuelta the moment `dueno` is empty. Bare-category legacy keys
  (pre-11/9/2026, La Vuelta only) get migrated once on load by
  `migrarClavesSinFirma()` — a no-op for María Laura/Pone Chico, which
  never had bare-category keys, so it's unconditional in the template.

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
`potrero_eliminado` — estos últimos cuatro sincronizan lo que hace
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

### Editing paddock boundaries at runtime (`Importar KML/KMZ`)

Since `POTREROS_GEO` is a fixed literal, boundary edits and new paddocks
can't mutate it permanently by themselves — they're layered on top via two
`localStorage` keys, both namespaced by `ESTABLECIMIENTO`:
- `LIMITES_KEY` — `{nombre: {coords, area}}` overrides for existing paddocks.
- `POTREROS_NUEVOS_KEY` — array of whole new paddock objects created when an
  imported placemark name doesn't match anything existing (user is prompted
  via `confirm()` per unmatched name before creating one).

**Ordering matters and has bitten this codebase before**: the
`POTREROS_NUEVOS_KEY` merge runs immediately after `ESTABLECIMIENTO` is
defined, near the top of the script — *before* `let estado = cargarEstado()`
runs. If a new-paddock merge were moved to run later (e.g. next to the
`LIMITES_KEY` override, which only needs to run before the map draws), a
paddock created in a previous session would render on the map but have no
`estado.potreros[...]` entry until a second reload. The `"🗑 Eliminar
potrero"` feature is the inverse of this: it either deletes a
`POTREROS_NUEVOS_KEY` entry outright (paddock didn't exist before the
import) or just clears its `LIMITES_KEY` entry (paddock existed, only its
shape was overwritten by mistake) — it never mutates the original
`POTREROS_GEO` literal, it only clears the overlay and reloads.

**Since 13/9/2026, this DOES sync across devices** (it didn't before —
Pedro hit a real bug where a paddock imported on the phone was invisible
on PC, and asked for it to be fixed). `importarLimitesKML()`/
`eliminarPotrero()` send `potrero_creado`/`potrero_limite_actualizado`/
`potrero_limite_revertido`/`potrero_eliminado` events (see "Sync:
Supabase" above) alongside the local `LIMITES_KEY`/`POTREROS_NUEVOS_KEY`
writes, so another device picks up the paddock (with geometry) just by
syncing, no need to re-import the same KML there. `eliminarPotrero()` is
now `async` and awaits the event send before its `location.reload()` — a
fire-and-forget send there could get cut off mid-flight by the reload.

**Renaming a paddock already in `POTREROS_GEO` is not a plain string
replace.** María Laura's "Cerro" was renamed to "Rincon" (same land,
mis-named since the original data load) — since `eventos_sync` rows are
immutable and every device has its own `localStorage` cache keyed by the old
name, the rename needed two mechanisms, both generic over
`CONFIG.nombresViejosPotrero` (`{viejo: nuevo}`, `{}` for establishments with
no renames — La Vuelta and Pone Chico today) so the template code needs no
per-establishment branch: a one-time migration in `cargarEstado()` (renames
an already-cached `estado.potreros[viejo]` key for every entry in
`NOMBRES_VIEJOS_POTRERO`, before the "ensure every `POTREROS_GEO` entry
exists" loop would otherwise create an empty new one) and a
`renombrarPotrero()` alias applied at the top of `aplicarEventoRemoto()` (so
a device with no local cache replaying historical events that still say
`"Cerro"` redirects them to `"Rincon"` instead of silently dropping them).
Any future paddock rename is a one-line addition to that establishment's
`configs/<name>.js` — no code changes.

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

### Datos faltantes (13/10/2026, a pedido de Pedro, solo PC de La Vuelta, `CONFIG.datosFaltantes`)

Una lectura del bastón **sin categoría** ya no tranca su tratamiento: `sanidad_puente.py` (carpeta del
lector XRS2) lo manda a Sanidad con la categoría de la **ficha** del animal (o "Sin categoría" si la ficha
tampoco la sabe; una de ficha sin confirmar, como Vaquillona, sigue sin pasar). Rige desde el 13/10/2026
(lo anterior ya se avisó para cargarlo a mano). `publicar_animales.py` publica en
`animales_caravana.faltantes` (jsonb, `supabase_faltantes.sql`, **correrlo antes**) la lista de esas
lecturas con lo que pasó, y la PC la muestra en Herramientas › Consultar › "⚠ Datos faltantes (N)"
(últimos 60 días, CSV). La app solo lee. Test: `tests/probar_datos_faltantes.js`.

### Lector XRS2 y trabajo desde la nube — lo que conviene saber (18/10/2026)

El Lector del bastón es **otro repo privado, `lector-xrs2`** (en la PC: `C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Lector XRS2`;
`handoff.md` de ese repo tiene el estado detallado). Cómo llega una sanidad hecha con el bastón:
- Pedro comparte el CSV del Data Link a `…\Lector XRS2\2026-2027 Ejercicio Siguiente\Entrada\` (la carpeta `Entrada` va **dentro** de la del ejercicio).
  Una tarea de Windows corre `vigilar_entrada.py` cada 10 min: espera a que OneDrive termine, respalda la base, corre `pipeline.py` (lee sesiones →
  animales → SNIG → publica el padrón en `animales_caravana`) y `sanidad_puente.py` crea las filas de `sanidad_carga` (solo lo que llegó por `Entrada\` y
  desde el 2/10/2026, tope 40 por corrida, idempotente; `--simular` no escribe). Después `bajar_sanidad_de_potreros.py` (cada hora) las baja a la Planilla.
- **Qué las traba**: un `PRODUCTO` que no figura en `productos_sanidad.csv` con `confirmado=SI`, o una `CATEGORIA` que no figura en `categorias_sanidad.csv`
  (sin categoría usa la de la ficha). Lo que no se puede traducir no se manda y se avisa. Los CSV de ese repo (`productos_sanidad`, `categorias_sanidad`,
  `correcciones`, `sesiones`, `plazos_propuestos`) son **configuración que decide Pedro, no tratamientos**.
- Los tratamientos que **no** vienen del bastón (un CSV a mano) van por `scripts/sanidad/cargar_sanidad_csv.py` (ver Sanidad, arriba).
- Una sesión del bastón **sin** sanidad cargada (el operario no completó PRODUCTO/DOSIS/POTRERO) se completa **antes** de ponerla en `Entrada\`
  con `completar-sanidad/` (abajo). Si ya entró vacía, el archivo completo se guarda **encima** del vacío (mismo nombre, misma carpeta):
  `procesar()` lo relee porque cambió tamaño/fecha y, con la misma ruta, la huella no lo marca "gemela"; inserta lecturas nuevas con producto
  (la `clave` de `lecturas` incluye el producto) y `sanidad_puente.py` crea el tratamiento. Las lecturas vacías viejas quedan, sin producto.
  Una copia **al lado** (otro nombre, p. ej. `…(1).csv`) sí es "gemela" (`huella()` = fecha + cantidad + caravanas, no mira el producto) y se
  descarta. Si el vacío ya no está, va por `cargar_sanidad_csv.py`. (Verificado en el código de `reconstruir_xrs2.py` el 18/10/2026, caso
  real: sesiones 1153–1156 con EON.)
- **Desde la nube no se corre nada de eso**: faltan `xrs2_lecturas.db` y la clave privada, y escribiría en producción. Y **lo que Pedro cambia en su PC no se ve
  hasta que lo sube a GitHub** (el 18/10 su CSV nuevo no estaba en ningún repo): pedir que lo pegue o que haga `git push`.
- La nube no llega a `*.supabase.co` ni a `*.github.io` (el proxy contesta 403), así que no se pueden leer las tablas reales: los nombres de columnas y de
  categorías se infieren del código. **El conector Supabase (`mcp__Supabase__*`, proyecto `skkknfjpwcstefcroqjt`) sí funciona** (18/10/2026): con `execute_sql`
  se leen las tablas reales. Usarlo **solo para leer** (SELECT); nunca escribir producción desde la nube.
- *"¿Llegaron las sanidades?"* (consulta de rutina): `sanidad_carga*` de los últimos días por `creado_en` (en `America/Montevideo`). Las columnas son
  `producto1`/`dosis1`/`producto2`/`dosis2` (no hay `producto`), más `categoria`, `dueno`, `cantidad`, `potrero`, `gen`, `observaciones`, `caravana`,
  `importado_en` (solo La Vuelta: lleno = ya bajó a la Planilla). `id` `bq_…` = vino del bastón, `sc_…` = cargado en la app, `csv_…` = script CSV. Para
  saber si entró una sesión nueva del bastón: `max(ultima_lectura)` de `animales_caravana`; y `max(actualizado)` de `sanidad_ultimos` dice cuándo publicó la Planilla.
- Pedro trabaja en PowerShell, pide los comandos en esa sintaxis y confirma cada `git push`/merge; con los PR de este repo dijo "abrilo y hacé merge" una vez que el CI
  está en verde (el merge se hace sobre la cabeza que pasó el CI, no sobre un run viejo: los avisos de `check_suite` pueden ser de un commit anterior).
- **`lector-xrs2` no tiene CI**: antes de abrir el PR se corren a mano en la nube sus pruebas (`python3 probar_*.py`, p. ej. `probar_vigilar.py`) y
  conviene verificarlas con una mutación. Después del merge el cambio **no llega solo a la PC**: Pedro hace `git pull` en la carpeta del Lector
  (PowerShell) y corre la prueba ahí; recién con su "todo bien" se da por instalado (así fue la fase 2 el 20/10/2026).

**Incidente 13→18/10/2026: el Lector no publicaba nada (lo que conviene recordar).**
- *Síntoma*: desde el 13/10 no llegaba a Supabase ni el padrón ni Sanidad (ni `sanidad_ultimos`); la tarea "Potreros - Vigilar entrada del baston"
  corría cada 10 min con resultado 0, pero el log decía "la publicacion quedo pendiente" y `falta SUPABASE_SECRET_KEY en ~/.potreros/.env`.
  La causa: el 13/10 (Fase 4) `sanidad_puente.py` / `publicar_animales.py` pasaron a la clave privada y **nunca se había creado
  `C:\Users\Pedro\.potreros\.env`**. Un resultado 0 de la tarea no prueba que publique: mirar `vigilar_entrada.log`.
- *Arreglo*: Pedro creó una clave `sb_secret_…` (Project Settings → API Keys → Secret keys; el panel se colgaba y anduvo con el link directo
  `supabase.com/dashboard/project/skkknfjpwcstefcroqjt/settings/api-keys`) y la guardó con `Read-Host -AsSecureString` +
  `[System.Net.NetworkCredential]::new('', $s).Password` (`PtrToStringAuto` falló). **Ojo**: `sbp_…` es un token PERSONAL de la cuenta
  (Account → Access Tokens), no sirve y es mucho más poderoso; se coló una vez. `_clave_privada()` del Lector solo rechaza `sb_publishable_` y JWT
  sin `service_role`, así que con un `sbp_` dice "CLAVE OK": validar siempre que empiece con `sb_secret_`. Nunca pedir ni mostrar la clave.
- *Los archivos "reemplazados" seguían vacíos*: Pedro guardó otra vez los vacíos encima. Se detectó por el **tamaño** (vacíos 2552/6639/8310/1056,
  completos 2744/7104/8880/1147) y con una consulta a `lecturas` (producto `''`). **Los adjuntos que Claude manda en el chat no llegan a la PC**
  (Descargas no los tenía): conviene dar un script que complete en el lugar y verifique el resultado por SHA-1 contra lo probado en la nube.
- *Diagnóstico útil en la PC* (solo lee): `$env:PYTHONPATH=(Get-Location).Path` y un script en `$env:TEMP` que consulta `xrs2_lecturas.db`
  (`lecturas` por `archivo like '%SesionNNNN%'`, `archivos`, `sanidad_enviada`) y corre `sanidad_puente.enviar(simular=True)`. Un `.py` fuera de la
  carpeta del Lector no encuentra sus módulos sin `PYTHONPATH`.
- *Resultado*: 17 registros de EON (sesiones 1153–1156: 32+93+114+13 = 252 animales; potreros 14, 8, 8, 16; dosis 9/5/6/12 cc) y padrón al día.
  Instructivo para Pedro de dónde va cada archivo: artifact privado `claude.ai/artifact/4Zw6aEbz4rgNR4c3uYFMe6`.
- *Cierre (20/10/2026)*: Pedro borró el token `sbp_`. La caravana 65095381 (sesión 1155, sin categoría ni dueño) se corrigió en
  `correcciones.csv` del Lector (Ternero, PEDRO) y 66047322/66047327/66047334 de REFUGO_VENTA ganaron propietario PEDRO; verificado en
  `animales_caravana`. El registro "Sin categoría" (EON 16/10, 1 animal, potrero 8) ya había bajado a la Planilla (`importado_en` lleno), así
  que se corrige **en el Excel**, no en la app. La Planilla está en
  `C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Sanidad\Planilla_Sanitaria_v22.xlsm`.
  Pedro la corrigió a Terneros el 20/10 (≈19 h). `sanidad_ultimos` se publica desde el Excel una vez por hora (`actualizado`), así que un
  cambio en la Planilla tarda hasta una hora en verse en el tablero y la app: antes de eso sigue saliendo el valor viejo. **Caso cerrado.**
- *Avisos que se repiten y ya están resueltos*: "Sanidad SIN pasar: LOTE_1_SET (EON ×1)" y "REFUGO_VENTA (Ricoverm ×4)" siguen saliendo en cada
  corrida, pero Pedro los cargó a mano el 12/10 (`sc_1791844254221…` Vacas EON 8 cc pot 14; `sc_1791844163706…` + `sc_1791844209658…` Terneros 3 +
  Terneras 1, Ricoverm 3 cc pot 18). **No volver a cargarlos.** Son de antes de `FICHA_DESDE` (13/10): `sanidad_puente.py` los bloquea por falta de
  categoría en la lectura aunque `correcciones.csv` arregle la ficha, y no sabe de las cargas a mano. Silenciarlos sería un cambio en `lector-xrs2`.
- *Para corregir fichas desde la nube*: identificar el animal con `animales_caravana.faltantes` (jsonb: `a` sesión, `f` fecha, `p` producto, `falta`)
  y darle a Pedro las líneas de `correcciones.csv` (`id8;campo;valor;por_que;fecha;lectura`, separador `;`) para `Add-Content -Encoding UTF8` + `--forzar`.

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

### Tablero de Sanidad (`tablero-sanidad/`, 16/10/2026, a pedido de Pedro)

Página suelta de solo lectura para ver en el teléfono, sin abrir la app, los **próximos** y los **últimos**
tratamientos (`pedrolanfranco-collab.github.io/potreros/tablero-sanidad/`). **No es una app generada**: no pasa por
`template/generar.js`, no tiene `sw.js` (para no servir datos viejos) ni librerías; es un `index.html` a mano.
Lee con `fetch` `sanidad_proximos` y `sanidad_ultimos` (las publica la PC con `actualizar_sanidad_supabase.py`;
`anon` solo tiene SELECT), por establecimiento (La Vuelta / María Laura; Pone Chico no tiene Excel que las llene, así que
sus pestañas de Sanidad salen vacías).
**Pestaña Stock (16/10/2026):** lee `stock_potreros` (animales, UG, categorías y dueño/firma por potrero, con totales arriba;
los filtra por `cantidad` ≠ 0) y, para la **generación**, `animales_caravana` (`potrero`, `gen`, `estado_vida`; solo los ACTIVO). `gen` es
el **último dígito del año de nacimiento** (5 = 2025): se muestra como el año más reciente no futuro con ese dígito, junto con el dígito ("2025 (gen 5)"; a pedido de Pedro, que descarta animales de más de 10 años). **Solo cuenta animales con
caravana** (no es todo el stock) y el potrero sale del bastón, no del stock; si no coincide con ninguno del stock queda en un bloque aparte.
Si el padrón no se puede leer, el stock se ve igual sin generación. Las dos consultas se paginan de a 1000.
**Generación en Últimos y Próximos (16/10/2026, a pedido de Pedro):** `sanidad_ultimos` y `sanidad_proximos` (las publica la PC desde el Excel)
**no traen `gen`**. En **Últimos** se cruza con la carga (`sanidad_carga` en La Vuelta, `sanidad_carga_maria_laura`/`_pone_chico` en los otros; solo filas con
`gen`) por fecha + categoría + potrero + cantidad, y se muestra "Generación 2025 (gen 5)" (puede haber más de una si coinciden varias cargas). Es una
aproximación: solo aparece donde alguien cargó el campo `gen` (opcional) y los cuatro datos coinciden. **Próximos no tiene forma de cruzar** (no trae
potrero ni fecha de carga): muestra `gen` solo si la tabla algún día lo publica, y **además un bloque "Generaciones con caravana"**: las generaciones de los
animales con caravana activos de esa categoría (`animales_caravana.categoria`/`gen`), con su cantidad. Es lo que hay en la categoría, **no** la generación a la que se le
aplicó el tratamiento. Las categorías se comparan con `catBase()` (sin tildes ni mayúsculas, sin edades "2-3" y en singular: "Novillos" = "Novillo 2-3"); si los
nombres del padrón difieren más que eso, la tarjeta sale sin bloque. Si la lectura de la carga falla, Últimos sale igual sin generación.
Para tenerlo en las dos pestañas de verdad, la PC tendría que publicar `gen` (columna nueva en las dos tablas + `actualizar_sanidad_supabase.py`, que vive en OneDrive).
Tiene **ícono propio** (cruz sanitaria blanca y línea de pulso sobre azul petróleo, `theme_color` `#0f5c63`), distinto de los de las apps;
el test verifica que ningún `icon-*.png` sea igual a los de `la-vuelta-*`/`maria-laura-*`/`pone-chico-*`. Se refresca cada 5 min y al volver a la pestaña, guarda la última copia en `localStorage` y avisa en rojo si la PC no
publica hace más de 6 h. **Cuando la Fase 4 cierre la lectura anónima hay que darle la clave del campo.** Test:
`tests/probar_tablero_sanidad.js`.

**Cómo se trabajó y qué recordar (16/10/2026):**
- Cada cambio al tablero fue por **PR y merge a `main` cuando el CI está en verde**, a pedido de Pedro; una vez mergeado, la rama de
  trabajo se reinicia desde `main` (`git checkout -B <rama> origin/main`) antes del siguiente cambio.
- **Desde el entorno de Claude en la nube no se puede abrir `github.io`** (el proxy contesta 403): el deploy se confirma mirando el
  run de Actions en `main` (`jsdom` y `publicar` en success), no con `curl` a la URL. La vista real la prueba Pedro en el teléfono.
- **Cambiar el ícono no actualiza un acceso directo ya instalado** en la pantalla de inicio: hay que borrarlo y volver a agregarlo.
- Las capturas de la presentación se sacan con Playwright (Chromium ya instalado) y `fetch` interceptado con datos de ejemplo; no
  hay forma de verlas con datos reales hasta que Pedro abre la página.

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

### RLS real por tabla (verificado en Supabase el 12/9/2026, no solo leído del repo)

RLS está **activado** (`relrowsecurity = true`) en las 8 tablas de este
proyecto. Ninguna política filtra por `establecimiento` a nivel de base de
datos — ese filtro (`.eq('establecimiento', ...)`) es solo del lado del
cliente; la key pública puede en teoría leer/escribir filas de cualquier
establecimiento en las tablas compartidas. Aceptado a propósito dado el
modelo de amenaza real (todos los usuarios son la misma familia con la
misma key pública, no hay login) — documentado acá para que quede explícito,
no implícito.

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `eventos_sync` | ✅ | ✅ | ❌ | ❌ *(desde el 30/9/2026: dos políticas, `eventos_sync_select` y `eventos_sync_insert`, solo para `anon`; antes una sola "ALL". Es un registro de solo-agregar: "borrar"/"editar" un movimiento inserta un evento `correccion`, nunca hace DELETE/UPDATE)* |
| `productos_catalogo` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2 de la auditoría: `anon` solo lee; el catálogo lo escribe `actualizar_sanidad_supabase.py` con la clave privada)* |
| `sanidad_carga` (La Vuelta) | ✅ | ✅ | ✅ | ✅ *(7/10/2026: solo filas con `importado_en` vacío)* |
| `sanidad_carga_maria_laura` | ✅ | ✅ | ✅ | ✅ *(7/10/2026)* |
| `sanidad_carga_pone_chico` | ✅ | ✅ | ✅ | ✅ *(7/10/2026)* |
| `sanidad_ultimos` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2: `anon` solo lee; la escribe `actualizar_sanidad_supabase.py` con la clave privada)* |
| `sanidad_proximos` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2: `anon` solo lee; la escribe `actualizar_sanidad_supabase.py` con la clave privada)* |
| `animales_caravana` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2: `anon` solo lee; antes tenía una política "ALL". La escribe `publicar_animales.py` con la clave privada. Sigue legible con la llave pública hasta la Fase 4)* |
| `stock_potreros` (16/9/2026) | ✅ | ✅ | ✅ | ✅ *(una sola política "ALL", igual criterio que `eventos_sync`)* |
| `maestros_dicose` (9/10/2026) | ✅ | ✅ | ❌ | ❌ *(dos políticas para `anon`: SELECT e INSERT, sin UPDATE ni DELETE; catálogos de compradores / comisionistas / clientes y proveedores. La app agrega con `upsert` + `ignoreDuplicates` (ON CONFLICT DO NOTHING). Actualizar o desactivar una entrada lo hace solo la clave privada)* |
| `movimientos_dicose` (9/10/2026) | ❌ | ❌ | ❌ | ❌ *(`anon` sin ningún permiso: ni SELECT, INSERT ni UPDATE; lleva importes, descuentos y DICOSE de terceros. La lee y la llena solo el script de la PC con la clave privada. La vista `movimientos_dicose_vigentes` es `security_invoker = true`)* |

**Fase 2 de la auditoría (10/10/2026) — carencia protegida.** El catálogo de productos y el padrón de
caravanas deciden si un animal figura apto para faena, y con la llave pública (que está en cada app y
en este repo público) cualquiera podía insertarlos o borrarlos. `scripts/seguridad/fase2_carencia.sql`
(transaccional, guarda las políticas viejas en `auditoria_politicas_antes_fase2`; se deshace con
`fase2_carencia_deshacer.sql`) dejó a `anon` solo con SELECT en `productos_catalogo`, `animales_caravana`,
`sanidad_ultimos` y `sanidad_proximos`, le sacó los permisos de tabla de escritura (un intento ahora da
401 `permission denied`, no un 200 vacío) y fijó `creado_en` de `eventos_sync` con un trigger
(`eventos_sync_fijar_creado_en`; `service_role` exceptuado). Antes del SQL se cambiaron los scripts de la
PC que escriben ahí para que usen la clave privada (`SUPABASE_SECRET_KEY` o `~/.potreros/.env`, fuera del
repo y de OneDrive): `publicar_animales.py` y `actualizar_sanidad_supabase.py`. Verificación:
`python scripts/seguridad/verificar_fase2.py` (usa filtros que no coinciden con ninguna fila: no escribe
nada real). Un evento insertado como `anon` sigue entrando y se guarda con la hora del servidor aunque
pida otra. Quedan abiertas a `anon`, a propósito hasta la Fase 4 (clave del campo), las tablas que las
apps escriben: `eventos_sync`, `sanidad_carga*`, `stock_potreros`, `maestros_dicose`.

**`stock_potreros`** (16/9/2026): foto del stock actual por
`establecimiento+potrero+categoria+dueño` (clave `establecimiento,potrero,
clave`, donde `clave` es el mismo formato que `claveAnimal()` en el
cliente), publicada por la propia app en cada acción local que toca
animales y en cada sincronización — nunca leída por la app, solo escrita,
para consultar desde afuera (SQL directo, AppSheet, el conector Hermes).
No es un log que se acumula como `eventos_sync`: cada publicación hace
`upsert` de las categorías con stock y `delete` de las que llegaron a 0, así
que necesita política de `UPDATE`/`DELETE` igual que `eventos_sync` — de
ahí la política "ALL" en vez del patrón sin `UPDATE` de `productos_catalogo`
(que causó el incidente de abajo). **Rollout gradual por
`CONFIG.stockSupabase`**: solo `true` en La Vuelta por ahora; en María
Laura/Pone Chico el código está pero es un no-op hasta que se confirme el
funcionamiento real y se les active el flag.

**`maestros_dicose` y `movimientos_dicose`** (9/10/2026, SQL en `scripts/dicose/`, se corren a mano en el SQL
Editor): la app NO escribe `movimientos_dicose` — las compras, ventas, ventas entre dueños, campo ajeno y traslados
siguen viajando como eventos de `eventos_sync` (las compras/ventas traen el detalle completo — kilos, destare, precio,
comisión, flete, descuentos — en `detalle.fin`, campos opcionales); el script de Excel
(`pasar_traslados_a_excel.py`, en la carpeta Ganaderia\Macros & phyton, fuera de este repo) arma de ahí una fila por
movimiento y la sube con *upsert* por `event_id` (vigente/anulado, `asentado_excel`). Los catálogos
(`maestros_dicose`) los lee la PC al abrir Movimientos DICOSE y los agrega la PC (cola `estado.colaMaestros` si no hay
señal); se siembran desde los Excel con `sembrar_maestros_dicose.py`. Ninguna política permite DELETE; para sacar una
entrada de las listas se pone `activo = false`.
**Clave privada (secret / service_role)**: como este repo es público y la clave `anon` está en cada app,
`movimientos_dicose` no admite `anon` para nada y `maestros_dicose` solo SELECT + INSERT. Los scripts de la PC
(`dicose_supabase.py`, `sembrar_maestros_dicose.py`) escriben con la clave privada, que se lee de la variable de
entorno `SUPABASE_SECRET_KEY` o de `C:\Users\<usuario>\.potreros\.env` (una línea `SUPABASE_SECRET_KEY=...`;
fuera del repo y fuera de OneDrive). **Nunca va al repo, a un log ni a un chat**; los scripts no la imprimen, la
rechazan si es la publicable y no la mandan a otro destino que Supabase o localhost. Sin clave el script sigue solo
con el Excel. Ninguna pantalla de las apps lee `movimientos_dicose` (se verifica con `grep`); si alguna lo hiciera,
a `anon` solo se le puede dar SELECT.

**Auditoría de seguridad (30/9/2026)** — resumen de lo hecho y lo pendiente:
`eventos_sync` ya no permite UPDATE/DELETE a `anon` (verificado en Supabase:
antes un DELETE de `anon` borraba 1 fila, después 0; `count(*)` sin cambios).
La app no hace ni DELETE ni UPDATE sobre esa tabla (0 usos en el template), así
que no hubo que tocar código. **Sigue abierto** el resto de la tabla de arriba
(lectura/escritura pública en las demás tablas, y `animales_caravana` legible
completa con la clave pública). Los datos que llegan de Supabase y de KML/GPX
se tratan como no confiables: `esc()` al pintar y `limpiarTextoRemoto()` al
entrar (ver `tests/probar_seguridad_remoto.js`). Backups: `scripts/backup/`
(el plan de Supabase es gratuito, sin backups automáticos; ver la Fase 5 abajo).

**Fase 5 de la auditoría (10/10/2026) — operación y monitoreo:**
- **Backup** (`scripts/backup/backup_supabase.py`): lee con la clave privada y descubre las tablas
  desde el OpenAPI de `/rest/v1/` (antes era una lista fija de 9 y `maestros_dicose` y
  `movimientos_dicose` no estaban). Sigue andando cuando la Fase 4 cierre la lectura anónima. Si el
  resultado no es OK avisa por ntfy. `restaurar_backup.py` es el simulacro de restauración contra un
  proyecto de Supabase **de prueba** (se niega a escribir en el real); los pasos están en el README
  de la carpeta. `probar_backup.py` y `probar_restaurar.py` corren en el CI (`python3`).
- **Vigilancia** (`vigilar_tareas_sanidad.py`, en `Sanidad\Automatizacion`, fuera del repo): revisa las
  7 tareas programadas (deshabilitada, sin corridas futuras, último resultado con error, sin correr
  hace más de lo esperable) y avisa por mail y ntfy; los domingos manda un "todo en orden" corto.
  El informe semanal de nacimientos había fallado 6 sábados sin que nadie lo supiera.
- **Keep-alive sin la PC**: `.github/workflows/mantener_activo.yml` hace la consulta diaria desde
  GitHub; la tarea de la PC queda de segundo respaldo.
- **Contrato de eventos**: `docs/eventos.md` describe cada `tipo` y su `detalle`. El CI falla si el
  template emite un tipo que no está ahí (`tests/probar_contrato_eventos.js`, que además valida los
  eventos reales de compra, venta, traslado, movimiento solo guía y campo ajeno con la app en jsdom).
  `test_contrato_eventos.py` (en `Ganaderia\Macros & phyton`) pasa esos mismos eventos por las
  funciones `construir_*` de `pasar_traslados_a_excel.py`.
- **El PDF "Animales por potrero" de la PC estuvo roto del 12/9 al 10/10**: `e4d8f2f` cambió la forma
  de `calcularEstadisticasNacimientos()` y el PDF siguió leyendo los campos viejos. Nadie lo notó
  porque jsdom no carga jsPDF; lo encontró el informe semanal. `tests/probar_pdf_animales.js` lo
  aprieta con un jsPDF falso. **Lección:** un botón que genera un archivo necesita una prueba que lo
  apriete, aunque la librería sea externa.

**Fase 4, Release 1 (modo suave) (13/10/2026) — clave del campo.** Hallazgos 12, 15 y 18: la llave pública
(`anon`) está en cada app y en este repo público, así que cualquiera puede insertar eventos falsos en
`eventos_sync` y leer el padrón y los datos comerciales. Cada establecimiento tiene **una clave** (la misma
para su PC, su móvil y Campo; la elige y la carga Pedro, nunca pasa por un chat ni por el repo) que la app manda
en el encabezado `x-clave-campo` de cada pedido a Supabase. **Este release no corta nada**: las políticas
siguen abiertas.
- *En Supabase* (`scripts/seguridad/fase4_clave_campo.sql`, con su `_deshacer.sql`; transaccional e idempotente;
  lo corre Pedro a mano): esquema `private` (no expuesto a la API) con `claves_campo(establecimiento, sal, hash)` y
  `equipos_vistos`; `public.establecimientos_con_clave()` (lee el encabezado y devuelve los campos cuya clave
  coincide; pensada para las políticas como `(select …)`, una vez por consulta); RPC `verificar_clave(est, clave)`
  (una clave mala demora 0,5 s); `private.cargar_clave(est, clave)` (solo Pedro); y un trigger AFTER INSERT en
  `eventos_sync` que anota cada equipo (`dispositivo`, `detalle.v`, `detalle.usuario`, `con_clave`) sin poder romper
  un insert. Los espejos entre campos (`traslado_entrada`, `anular_traslado`) no se anotan: llevan el id del equipo
  de origen con el `establecimiento` de destino. `verificar_fase4.py` comprueba desde afuera; con `--cierre`
  comprueba el release 2.
- *En la app* (template, las 9 variantes; `tests/probar_clave_campo.js`): la clave vive en
  `localStorage['clave_campo_<ESTABLECIMIENTO>']`, fuera de `STORAGE_KEY` (no sale en el Backup JSON ni en "Descargar
  copia", y "Restablecer datos de fábrica" no la borra). Formato: letras sin tildes ni ñ y números, 8 a 64, en minúsculas
  y sin espacios en los extremos. `clienteSupabase()` agrega `global.headers['x-clave-campo']` y se recrea al guardarla.
  La ventana "🔑 Clave del campo" (`#modal-clave-campo`) se abre sola una vez por apertura si no hay clave (con un
  retardo, sin otra ventana abierta, y **nunca** con `navigator.webdriver` ni sin un cliente con `.rpc`); "Guardar"
  llama a `verificar_clave` y **un fallo de verificación (red, función inexistente) nunca se trata como clave
  inválida**: no guarda y avisa que no pudo comprobar. Aviso en el pie (`#aviso-clave`): "Falta la clave del campo"
  (ocre) o "La clave guardada ya no sirve" (rojo; se verifica una vez por apertura). El cartel de "movimientos
  trabados" agrega "revisá la clave del campo" ante 42501 / 401 / 403. `enviarAnulacionTraslado()` ahora lleva
  `origenEstablecimiento` en el detalle (ver `docs/eventos.md`, sección "Clave del campo y eventos que cruzan de
  stream"). Botón "🔑 Clave del campo" en Herramientas (PC: grupo "Este dispositivo").
- *Orden obligatorio*: **el SQL antes que el código desplegado** (una app nueva que llama a `verificar_clave` antes de
  que exista la función solo muestra "no se pudo comprobar", pero no hay forma de cargar la clave); después cargar las
  3 claves, correr `verificar_fase4.py`, publicar, y que cada equipo la cargue una vez.
- *Pone Chico NO usa clave (17/10/2026, a pedido de Pedro)*: `CONFIG.claveCampo` es `true` en La Vuelta y María Laura y
  `false` en Pone Chico. Con `false` la app no muestra la ventana, el aviso del pie ni el botón, no manda `x-clave-campo` y
  no llama a `verificar_clave` (aunque haya una clave vieja guardada). **Para el cierre**: sus políticas deben dejar Pone Chico
  abierto a propósito (o se queda sin sincronizar); ver `scripts/seguridad/README.md`. Test: `probar_clave_campo.js`.
- *Release 2, el cierre* (`fase4_cierre.sql` + `_deshacer.sql`, escritos y revisados, **no corridos**): las políticas
  pasan a exigir `establecimientos_con_clave()`. **No correrlo hasta que `private.equipos_vistos` muestre todos los
  equipos activos con `con_clave = true` y los scripts de la PC que usan la llave pública
  (`pasar_traslados_a_excel.py`, `sanidad_puente.py`, `bajar_sanidad_de_potreros.py`,
  `regenerar_stock_potreros_excel.py`, `vigilar_tareas_sanidad.py`) ya usen `SUPABASE_SECRET_KEY`**; el informe de
  nacimientos (Playwright) necesita la clave en su `localStorage`. Pasos exactos en `scripts/seguridad/README.md`.
  Cuando se corra, actualizar la tabla de arriba ("RLS real por tabla").

Dos cosas que explican comportamiento ya visto, no teoría:
- **`productos_catalogo` sin UPDATE** es la causa raíz del incidente del
  12/9/2026 (ver memoria `planilla-sanitaria-v22`): un `PATCH` contra esa
  tabla no da error, da `200` con cuerpo vacío — PostgREST no distingue
  "bloqueado por RLS" de "no había ninguna fila para actualizar". El fix ya
  aplicado en el script publicador es no usar `PATCH` nunca contra esta
  tabla, solo `DELETE`+`POST` (que sí tienen política).
- **`sanidad_carga_maria_laura`/`sanidad_carga_pone_chico` tenían solo SELECT/INSERT**
  hasta el 7/10/2026, cuando se agregó la función de editar/borrar un tratamiento (solo PC):
  se crearon las políticas UPDATE y DELETE **antes** de publicar el código que las asume (el
  mismo error de secuencia, schema/permisos después que código, ya pasó una vez con
  `productos_catalogo`). Si esas políticas faltaran, la app avisa "No se pudo" en vez de decir
  "borrado" (RLS contesta 200 vacío). `sanidad_carga` (La Vuelta) ganó DELETE solo para filas con
  `importado_en` vacío.

### PWA / offline

Each folder's `sw.js` precaches its own `index.html`, `manifest.json`, icons,
and the specific CDN scripts that variant actually uses (PC's list includes
jsPDF/SheetJS, móvil's doesn't). The service worker never intercepts
non-precached requests — map tiles (ArcGIS) and Supabase calls always hit
the network directly, so there's no risk of serving stale hacienda data. On
`controllerchange` the page reloads itself, so once a new `sw.js` version
deploys, an already-installed PWA picks it up without the user manually
clearing site data.

## Grafo del código (graphify)

`graphify-out/` (ignorado por git) tiene un grafo del repo: scripts, tests y docs
(no cubre bien el JS inline de `template/potreros.template.html`; para eso, grep).
Antes de explorar a ciegas, consultarlo — gasta menos tokens que leer archivos:

- `graphify query "<pregunta>"` · `graphify explain "<nodo>"` · `graphify path "A" "B"`
- `graphify affected "<nodo>"` para ver qué rompe un cambio
- `graphify god-nodes` para los hubs; `graphify-out/GRAPH_REPORT.md` para el mapa general
- Después de cambiar código: `graphify update .` (local, ~7 s, sin costo de modelo)
- Si el reporte dice un commit viejo respecto de `git rev-parse HEAD`, está desactualizado
