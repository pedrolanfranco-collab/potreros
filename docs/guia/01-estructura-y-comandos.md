# Estructura del repo y comandos

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

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
| `la-vuelta-test/` | — | copy for testing by hand on a phone or a browser. **Since 12/11/2026 it is generated** by `template/generar.js` (the Campo variant of La Vuelta with the `@prueba` marker; before, a hand clone stuck at v1.8): it follows every release, has its own `establecimiento` (`la_vuelta_test`) and `storageKey`, shows the red "MODO PRUEBA" banner and **has no Supabase at all** (`clienteSupabase()` returns `null`, URL/key not in the file; since 1/10/2026 — before, it wrote to the real tables: 7 `eventos_sync` + 5 `stock_potreros` rows are still there). Never edit it by hand; `--check` covers it. Guarded by `tests/probar_test_aislado.js` in CI. Its `sw.js` is still by hand except `CACHE`. |

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
