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
| `maria-laura-pc/`, `maria-laura-movil/` | María Laura | 4 paddocks, **owner-per-animal** (`Dueño`) |
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
serves `main` directly — no Actions workflow, no build. Changes are live in
roughly 15–40 seconds; verify with `curl -H "Cache-Control: no-cache" <url>`
rather than assuming an instant deploy.

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

### PWA / offline

Each folder's `sw.js` precaches its own `index.html`, `manifest.json`, icons,
and the specific CDN scripts that variant actually uses (PC's list includes
jsPDF/SheetJS, móvil's doesn't). The service worker never intercepts
non-precached requests — map tiles (ArcGIS) and Supabase calls always hit
the network directly, so there's no risk of serving stale hacienda data. On
`controllerchange` the page reloads itself, so once a new `sw.js` version
deploys, an already-installed PWA picks it up without the user manually
clearing site data.
