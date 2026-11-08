# Potreros, mapa, vecinos y límites

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### Potreros dobles (4/11/2026, a pedido de Pedro, `CONFIG.potrerosDobles`, hoy solo La Vuelta)

A veces el 1 y el 2 (y el 19 y el 20) se usan juntos con la portera abierta. El doble (`"1+2"`, `"19+20"`) es **un potrero más de
`potrerosGeo`** (al final, con el contorno de los dos juntos calculado con shapely; `area` = suma de las de las partes: 15 y 13 ha) y
`potrerosDobles` = `{doble: [partes]}` (María Laura y Pone Chico: `{}`). **No hay eventos nuevos**: unir = "Mover todo" de las partes al
doble; separar = mover del doble a cada parte. En el mapa (`refrescarColoresMapa()`), un doble vacío se saca del mapa (`mostrarPoligono()`,
`item.oculto`) salvo que esté elegido; con animales se ve arriba y sus partes quedan punteadas (`parteTapada()`); tocar una parte tapada
abre el doble y el GPS de la móvil devuelve el doble. La tarjeta de la lista dice "🔗 1 y 2 unidos" / "🔗 Unido en 1+2".
El Lector (`sanidad_puente.py`) toma los nombres de `template/configs/la-vuelta.js` de `~/repos/potreros`: después del merge, Pedro hace
`git pull` ahí para que acepte "1+2". Copias de la lista que hay que tocar si se agrega otro doble: `completar-sanidad/index.html` y
`scripts/hermes/consultar_stock.py`. El tablero de campos (`tablero-campos/`) los toma solo (`dobles`). Test: `tests/probar_potreros_dobles.js`.

### Vecinos (29/10/2026, a pedido de Pedro)

Animales nuestros que están en el campo de un vecino: un potrero virtual "Vecino". No es un potrero: no está en
`POTREROS_GEO` ni en `estado.potreros`, no sale en el mapa, no cuenta en UG ni en `stock_potreros`. Vive en
`estado.vecinos = { "<Nombre>": {animales: {"cat||dueño": n}, historial: [...]} }` (`obtenerVecino()`, `buscarVecino()`
por `claveVecino()`: "fulano" y "Fulano" son el mismo balde; `normalizarVecino()` tiene la misma limpieza que
`limpiarTextoRemoto()`). `estadoInicial()` y `cargarEstado()` lo crean vacío.

Eventos (`docs/eventos.md`): `vecino_paso` (sale del potrero, queda en el vecino), `vecino_aparecido` (cierra un
desaparecido), `vecino_retorno` (vuelve a un potrero), `vecino_perdida` y `vecino_muerte` (sin potrero: llevan el
establecimiento en `potrero`; la muerte cuenta en `calcularEstadisticasMuertes()`). Para corregirlos: `correccion` con
`accion: 'vecino_eliminar'` y `reversar: {tipo:'vecino_ajuste', ...}` (acciones nuevas: las versiones viejas las
guardan en `estado.eventosDesconocidos` hasta actualizarse). Un evento que llega antes que su potrero se estaciona como
cualquier otro, y su corrección se estaciona detrás de él.

UI: en todas las variantes, "🏡 Al vecino" en la ficha del potrero (al lado de ❓ Desaparecido), el botón
"🏡 Vecinos" en Herramientas (móvil, Campo y PC › Consultar: ventana `#modal-vecinos`, con ↩ Volvió, ❌ Dar por perdido
y 🪦 Muerte por vecino), "🏡 Apareció en vecino" en ❓ Desaparecidos y el aviso en 📊 Stock total donde existe.
Borrar un registro de vecino (🗑) es solo PC: en el historial del potrero y en la ventana Vecinos; no hay ✏️ en ningún
lado (se borra y se vuelve a cargar). Verificar stock (PC) compara también los vecinos. **Varias categorías (30/10/2026):** "Al vecino" y "↩ Volvió" tienen filas (`filaPasoVecinoHTML()` /
`filaVolvioVecinoHTML()`, "＋ Otra categoría"); se valida todo junto (`faltanteFilasVecino()` suma por `categoría||dueño`) y sale **un evento por
fila** con su `eventId`, así el contrato, el 🗑 por categoría y Verificar stock no cambian. Pérdida y Muerte siguen de a una. Test: `tests/probar_vecinos.js`
(en el workflow, las 9 variantes; en Pone Chico crea dos potreros por `potrero_creado` para correr igual).

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


### Mapa de la PC: tooltip y "Pintar por" (5/11/2026, a pedido de Pedro)

En las 3 PC (bloques `@pc`): al pasar el mouse por un potrero, `tooltipPotreroPC()` muestra animales, UG, hectáreas y carga UG/ha (una parte
tapada de un doble en uso muestra los datos del doble; sin área dice "sin dato" y "—"). El selector **"Pintar por"** (arriba a la derecha del
mapa) elige **Dotación (UG/ha)** (por defecto; cortes 0,5 / 0,8 / 1,2 UG/ha, gris sin animales o sin área), **Eventos de manejo** (potreros con
eventos en los últimos 30 días; solo con `CONFIG.manejo`) u **Ocupado**. La elección se acuerda en
`localStorage['<ESTABLECIMIENTO>_pintar_por']` y la leyenda (abajo a la izquierda) explica los colores con texto. La móvil no cambia.
Test: `tests/probar_mapa_pc.js`.
