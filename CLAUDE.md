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
| `la-vuelta-pc/`, `la-vuelta-movil/` | La Vuelta | 31 paddocks, no owner-per-animal |
| `maria-laura-pc/`, `maria-laura-movil/` | María Laura | 5 paddocks (Tajamar, Casco, Uno, Rincon, Manantial), **owner-per-animal** (`Dueño`) |
| `pone-chico-pc/`, `pone-chico-movil/` | Pone Chico | newest establishment, starts with zero paddocks — they're added later via "Importar KML/KMZ" |
| `la-vuelta-test/` | — | disposable clone of `la-vuelta-movil` for testing on a phone without touching real data; not kept in sync automatically |

Each folder is served at `pedrolanfranco-collab.github.io/potreros/<folder>/`
and contains: `index.html` (the whole app), `manifest.json`, `sw.js`, and six
`icon-*.png` sizes. There is no shared/imported code between folders — each
`index.html` is independently maintained. The root-level `index.html`,
`potreros.html`, `manifest.json` and `launchericon-*.png` predate the
per-establishment split and appear to be an unmaintained leftover from before
the multi-app structure existed; don't assume they're wired up to anything.

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

**CI:** `.github/workflows/probar.yml` runs on every push/PR to `main` — 16
jsdom test scripts (`tests/probar_*.js`, using `tests/package.json`'s pinned
`jsdom@30.0.1`/`jszip@3.10.1`) against the published `index.html` files of
whichever folders each script targets. These are the same scripts as
`scripts/probar_*.js` in the `apps-potreros` skill — kept in sync by hand,
no symlink. Two of them (`probar_pone_chico.js`, `probar_eliminar_potrero.js`)
accept a `process.argv` file list with a hardcoded fallback. Check the actual
Actions run after pushing — "works on my machine" isn't enough; a Node
version or YAML-parsing mismatch has broken this CI before without any local
symptom.

**Before shipping any change**, bump the version in two places or a device
that already installed the app as a PWA keeps serving the stale cached
version indefinitely:
1. The visible version string in the header (`<div class="sub">...vX.Y</div>`, near the top of `<body>`).
2. The `CACHE` constant at the top of that folder's `sw.js` (e.g. `'la-vuelta-movil-v2.21'`).

## Architecture

### PC vs. móvil split

The two variants of an establishment are hand-maintained separately, not
generated from a shared master — there used to be a `<name>_maestro.html` →
cut-PC / cut-móvil pipeline, but it's stale; a feature meant for both
variants has to be edited into both `index.html` files by hand, identically.

- **PC**: has PDF export (jsPDF), Excel export (SheetJS), and a UG-coefficient
  editor modal. No GPS.
- **móvil**: has GPS location + voice input for logging movements
  (`Web Speech API`, no external AI). No PDF/Excel/coefficient editor. Has two
  screens PC doesn't: **"📊 Stock total"** and **"👤 Quién soy"** (per-phone
  user identification, shared across establishments via one unprefixed
  `localStorage` key so a phone used for two apps only asks once).

Every `index.html` is internally organized under the same
`/* ======================= SECTION ======================= */` banner
comments — grep for these to navigate: `DATOS DE POTREROS`, `SINCRONIZACIÓN`,
`ESTADO`, `MOTOR DE SINCRONIZACIÓN`, `MAPA`, `SELECCIÓN Y DETALLE`,
`FORMULARIOS DE ACCIÓN`, `IMPORTAR LÍMITES DESDE KML/KMZ`, `BACKUP JSON`,
`ALERTAS Y UMBRALES`, `SANIDAD`, `CARGA POR VOZ` (móvil), `EXPORTAR *` (PC).
María Laura and Pone Chico additionally have a `DUEÑOS` section near the top.

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
- María Laura and Pone Chico key `animales` by `"categoria||dueño"`
  (`claveAnimal()`/`partesClave()`) instead of bare category, since more than
  one owner can have stock in the same paddock. La Vuelta has no owner
  concept at all — don't assume `claveAnimal` exists there.

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
name, the rename needed two mechanisms: a one-time migration in
`cargarEstado()` (renames an already-cached `estado.potreros['Cerro']` key
before the "ensure every `POTREROS_GEO` entry exists" loop would otherwise
create an empty new one) and a `NOMBRES_VIEJOS_POTRERO` alias applied at the
top of `aplicarEventoRemoto()` (so a device with no local cache replaying
historical events that still say `"Cerro"` redirects them to `"Rincon"`
instead of silently dropping them). Any future paddock rename needs both.

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
