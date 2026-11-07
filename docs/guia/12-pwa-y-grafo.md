# PWA sin señal y grafo del código

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

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
