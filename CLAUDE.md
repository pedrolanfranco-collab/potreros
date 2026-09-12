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
| `la-vuelta-test/` | — | disposable clone of `la-vuelta-movil` for testing on a phone without touching real data; not kept in sync automatically |

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

**Deploy:** `git add` the changed folder(s), commit, `git push`. GitHub Pages
serves `main` directly — no build step. Changes are live in roughly 15–40
seconds; verify with `curl -H "Cache-Control: no-cache" <url>` rather than
assuming an instant deploy.

**CI:** `.github/workflows/probar.yml` runs on every push/PR to `main`. First
step: `node template/generar.js --check` — regenerates all 6 files in memory
and fails the build if any committed `index.html` doesn't match (someone
edited a generated file by hand, or edited the template/configs without
regenerating). After that, 18 jsdom test scripts (`tests/probar_*.js`, using
`tests/package.json`'s pinned `jsdom@30.0.1`/`jszip@3.10.1`) run against the
published `index.html` files of whichever folders each script targets. These
are the same scripts as `scripts/probar_*.js` in the `apps-potreros` skill —
kept in sync by hand, no symlink. Two of them (`probar_pone_chico.js`,
`probar_eliminar_potrero.js`) accept a `process.argv` file list with a
hardcoded fallback. Check the actual Actions run after pushing — "works on
my machine" isn't enough; a Node version or YAML-parsing mismatch has broken
this CI before without any local symptom.

**Before shipping any change**, bump the version in three places or a device
that already installed the app as a PWA keeps serving the stale cached
version indefinitely:
1. `versionPc`/`versionMovil` in that establishment's `template/configs/<nombre>.js`.
2. Re-run `node template/generar.js` (writes the 6 `index.html` **and** the
   6 OneDrive master files Pedro also keeps in sync).
3. The `CACHE` constant at the top of that folder's `sw.js` (e.g.
   `'la-vuelta-movil-v2.21'`) — **not** generated, still bumped by hand.

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
tables/projects. RLS is open to `anon`; there is no login. It's an
**event log, not a state sync**: every local change is applied locally *and*
inserted as a row; each device pulls new rows on load and every ~3 minutes
and replays them (`sincronizar()`), so replay order and offline queuing
(`estado.colaSync`) don't cause conflicts. A Windows scheduled task
(outside this repo) pings the table daily so the Supabase free-tier project
doesn't auto-pause after 7 days of inactivity — that ping isn't per-app, one
covers the whole shared project.

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

None of this — new paddocks, edited boundaries, or deletions — syncs across
devices. It's local to whichever phone/PC performed the import.

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
  app derives the table name as `TABLA_SANIDAD = 'sanidad_carga_' +
  ESTABLECIMIENTO` and both reads and writes go straight there — no
  tri-state UI, just one unified `sanidad-lista`.
- `productos_catalogo` (product dropdown in the treatment form) **is**
  shared across all three establishments on purpose — it's a reference list,
  not an operational record, and María Laura/Pone Chico sync their catalog
  from La Vuelta's.

### PWA / offline

Each folder's `sw.js` precaches its own `index.html`, `manifest.json`, icons,
and the specific CDN scripts that variant actually uses (PC's list includes
jsPDF/SheetJS, móvil's doesn't). The service worker never intercepts
non-precached requests — map tiles (ArcGIS) and Supabase calls always hit
the network directly, so there's no risk of serving stale hacienda data. On
`controllerchange` the page reloads itself, so once a new `sw.js` version
deploys, an already-installed PWA picks it up without the user manually
clearing site data.
