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
  26—; "Agregar potrero" (Importar KML/KMZ, Dibujar), "Puntos", "Reportes de campo", "Exportar" y "Backup"
  abren un sub-menú dentro de la misma caja (`data-sub` / `data-volver`, `mostrarSubmenuHerramientas()`).
  Los botones conservan su `id` y su listener (solo cambiaron de lugar); "Exportar MD" se sacó
  (`construirMD()` queda: la usan las pruebas). Test: `tests/probar_herramientas_pc.js`. La móvil y Campo
  no cambian.
  **Campo (móvil simple), visualización (10/10/2026, a pedido de Pedro)**: todo en bloques `@simple`: mapa a
  45vh en el celular (más lista), total del potrero grande (26 px en la tarjeta, 28 px en el detalle), botones de
  acción y campos de formulario de 48–56 px con letra de 16 px, Muerte/Desaparecido al final y separados,
  historial plegado en un `<details>` (se acuerda abierto mientras no cambie de potrero) y el formulario de una
  acción se desplaza solo a la vista, y el botón "Herramientas" del pie es más largo (ocupa lo que deja el estado de
  sincronización, que puede partirse en 2 renglones). La PC y la móvil completa no cambian. Test:
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
