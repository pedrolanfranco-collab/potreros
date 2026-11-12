# Template, variantes y modelo de datos

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

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

**`@real` / `@prueba` (12/11/2026)** — the 9 real apps are generated with `@real`; `la-vuelta-test/` (an extra entry in
`ESTABLECIMIENTOS` of `generar.js`: La Vuelta's config with `prueba: true`, its own `establecimiento` / `storageKey`, only the
`movil-simple` variant) is generated with `@prueba`. Only three spots use them: the Supabase URL and key (`@real`; empty strings
in `@prueba`), the first line of `clienteSupabase()` (`@prueba`: returns `null`) and the red "MODO PRUEBA" banner (`@prueba`).
Adding the markers did not change a byte of the 9 real apps. A new code path that reaches Supabase without `clienteSupabase()`
would leak into the test copy: `tests/probar_test_aislado.js` fails if the file contains the URL or the key.

### PC vs. móvil split

- **PC**: has PDF export (jsPDF), Excel export (SheetJS), and a UG-coefficient
  editor modal. No GPS.
  **Caja "🛠 Herramientas" de la PC (10/10/2026, a pedido de Pedro)**: ordenada por funciones —
  Consultar / Mapa y potreros / Exportar y respaldo / Este dispositivo, en 2 columnas, 17 botones en vez de
  26 (18 desde el 12/10/2026, con "🔍 Verificar stock" en Consultar; 19 desde el 13/10/2026, con "🔑 Clave del campo" en Este dispositivo; 20 desde el 29/10/2026, con "🏡 Vecinos" en Consultar; 21 desde el 30/10/2026, con "📖 Instructivo" en Este dispositivo)—; "Agregar potrero" (Importar KML/KMZ, Dibujar), "Puntos", "Reportes de campo", "Exportar" y "Backup"
  abren un sub-menú dentro de la misma caja (`data-sub` / `data-volver`, `mostrarSubmenuHerramientas()`).
  Los botones conservan su `id` y su listener (solo cambiaron de lugar); "Exportar MD" se sacó
  (`construirMD()` queda: la usan las pruebas). Test: `tests/probar_herramientas_pc.js`. La móvil y Campo
  no cambian.
  **PC nueva estilo FieldData, parte 1 (4/11/2026, a pedido de Pedro; bosquejo aprobado, Design canvas
  `47fe61b2-50ec-4859-8e7f-5c07cea19f26`)**: menú fijo a la izquierda `#pc-rail` (10 secciones `data-pc-seccion`) y
  tarjetas de totales (`res-cabezas`, `res-con-animales` nuevas). **Los botones de siempre no se mueven**: cada sección
  abre `#pc-seccion` con atajos `data-pc-ir="<id>"` que hacen `.click()` en el botón original (`SECCIONES_PC`, lista de
  ids por sección); un botón con `display:none` no se ofrece, una sección sin botones se esconde (`actualizarRailPC()`,
  también desde `actualizarResumen()`) y una con uno solo lo abre directo. **Un botón nuevo de la PC se agrega también
  a su sección en `SECCIONES_PC`.** La caja 🛠 Herramientas sigue igual. Partes que siguen (cada una su PR): mapa
  pintado por carga + ficha al costado, tablas de Resumen, secciones dentro de la página. Test: `tests/probar_pc_menu.js`.
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
