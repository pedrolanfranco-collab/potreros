# Fotos de reportes, puntos y muertes

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### Fotos de reportes de campo (24/10/2026, a pedido de Pedro)

Infraestructura y Capín Annoni aceptan hasta 3 fotos al crear, más fotos después (tope 10 por reporte) y una del arreglo al resolver (`momento: 'resuelto'`).

- **Dónde**: Supabase Storage, bucket privado `fotos-reportes`, ruta `<establecimiento>/<reporteId>/<fotoId>.jpg` (JPEG, máximo 1 MB). Política de `anon`: solo INSERT y SELECT dentro de las carpetas de los 3 establecimientos. SQL en `scripts/seguridad/fotos_reportes.sql` (+ `fotos_reportes_deshacer.sql`): **correrlo en el SQL Editor antes de publicar** el código que sube fotos. El cierre de la Fase 4 tiene que sumar este bucket (ver `scripts/seguridad/README.md`).
- **Cola sin señal**: IndexedDB `potreros_fotos` (envoltorio `fotosPendientes`, con respaldo en memoria si no hay IndexedDB). `vaciarColaFotos()` corre en `sincronizar()` después de `vaciarColaSync()` y en "Reintentar". Sube de a una; el evento `reporte_foto` sale solo cuando Storage confirma (un 409 cuenta como subida, así no se duplica). Un error se registra en `estado.fallos.fotos` y el indicador dice "N fotos sin subir".
- **Evento** `reporte_foto` `{id, fotoId, path, momento, fecha}`: va en `docs/eventos.md`, `TIPOS_EVENTO_CONOCIDOS` y `aplicarEventoRemoto()`. El receptor acepta solo la ruta exacta (`fotoRemotaValida()`), es idempotente por `fotoId` y se ignora si el reporte no llegó.
- **Ver**: miniaturas en la lista y en el popup; URLs firmadas (1 h) para las subidas, `URL.createObjectURL` para las pendientes; visor `#visor-fotos`. "🗺 Ver en el mapa" es `verReporteEnMapa()` → `verUbicacionEnMapa()` (genérica, para reusar con aguadas).
- **Test**: `tests/probar_fotos_reportes.js` (corre en las 9 variantes, en el workflow). En jsdom solo se prueba la cola en memoria, no IndexedDB.

**Fotos en Aguadas / instalaciones y en las muertes (29/10/2026, a pedido de Pedro).** Mismo bucket, misma cola y misma ruta
`<establecimiento>/<id>/<fotoId>.jpg` (no hace falta SQL nuevo: la política del bucket ya cubre las 3 carpetas). Lo que puede tener fotos se registra en
`TIPOS_FOTO` (`reporte`, `punto`, `muerte`): cada uno con su evento (`reporte_foto` / `punto_foto` / `muerte_foto`, `docs/eventos.md`), su validación de id
(`rp_…`, `pt_…`, `event_id`) y `momento` (reportes: `reporte`/`resuelto`; punto y muerte: `registro`). `encolarFoto(tipo, id, blob, momento)` es la entrada;
los registros de la cola de antes (sin `tipoFoto`, con el id en `reporteId`) se leen como de un reporte. **Un tipo nuevo con fotos = una entrada en `TIPOS_FOTO`
y `MOMENTOS_FOTO`, su evento en los tres lugares y su `refrescar`.**
- *Puntos* (Aguadas / instalaciones: Manga, Corral, Bretes, Embarcadero… son subtipos de "Instalación", no potreros; **desde el 31/10/2026 el botón "📍 Aguadas / instalaciones" se ve también en la móvil completa y en Campo**, antes estaba `display:none` y solo lo tenía la PC, en Herramientas › Mapa y potreros › Puntos; `btn-resync-puntos` sigue oculto fuera de la PC): hasta 3 fotos al crearlo (`montarSelectorFotos`,
  selector reutilizable), "📷 Agregar foto" y "🗺 Ver en el mapa" (`verPuntoEnMapa()` → `verUbicacionEnMapa()`) en cada renglón de la lista, tope 10.
- *Muertes* (el evento `muerte` y también `muerte_desaparecido`, o sea "Dar muerte" desde Desaparecidos: `abrirFormularioMuerteDesaparecido()`, ids `md-…`; los dos usan `muerte_foto` y el mismo `_ubicMuerte`): el formulario suma fotos y **lugar opcional** (GPS en el celular, o tocar el mapa: `modoColocarMuerte`).
  **El detalle del potrero y la ventana de Desaparecidos son capas a pantalla completa que tapan el mapa** (en el celular): `iniciarMarcarUbicMuerte(idOverlay)` las oculta mientras se toca el mapa, con "✕ Cancelar" en el aviso (`mostrarAvisoModo(texto, alCancelar)`), y `colocarUbicMuerteEn()` / `cancelarMarcarUbicMuerte()` las devuelven con el formulario como estaba.
  El lugar viaja en el evento (`lat`/`lon`, 6 decimales) y queda en el renglón como `ubic` — **aparte de `extra`/`origDatos`**, que comparan las correcciones. Las fotos se
  cuelgan del `eventId` del renglón (`h.fotos`). En el historial: miniaturas, 📷 y 🗺 (con lugar va ahí; sin lugar centra el potrero; oculta `#detalle`, que tapa el mapa).
  Al **editar** una muerte (✏️ = deshacer + formulario nuevo) el lugar se precarga pero las fotos quedan en el renglón tachado.
- **Lección (error real que encontró Chromium, no jsdom):** `estado.puntos.forEach(crearMarcadorPunto)` corría ANTES de `const TIPOS_FOTO` y, al reabrir la app con un punto
  guardado, no cargaba nada (`Cannot access 'TIPOS_FOTO' before initialization`). Lo que corre al cargar y usa un `const` va DESPUÉS de su declaración;
  `tests/probar_fotos_puntos_muertes.js` ahora reabre la app con el `localStorage` ya cargado (`levantar(archivo, servidor, almacen)`).
- **Test**: `tests/probar_fotos_puntos_muertes.js` (9 variantes, en el workflow; verificado con mutaciones: todas en rojo salvo el chequeo de id por tipo, que es una defensa redundante porque un id inexistente igual se ignora).

**Capas de Aguadas e Instalaciones (31/10/2026, a pedido de Pedro).** Los puntos de `TIPOS_PUNTO` se prenden y apagan con dos botones en fila sobre el borde de arriba del mapa, al lado del zoom (`.capas-puntos`, a pedido de Pedro; con ≤345 px de ancho van debajo del zoom): `#btn-capa-agua` ("💧 Aguadas") y `#btn-capa-instalacion` ("🚧 Instal.", corto para que entren entre el zoom y "🛰 Satelital" en un celular de 360 px), en las 9 variantes (fuera de bloques `@`). El texto no cambia: apagada, el botón queda gris y tachado (`.capa-off`), con `aria-pressed` y `title` "Aguadas: ON/OFF". La elección se guarda en `localStorage['<ESTABLECIMIENTO>_capas_puntos']` = `{"agua":true,"instalacion":true}` (por equipo y por campo, fuera de `estado`: no va al Backup ni a Supabase; por defecto todo ON). No se usa `L.layerGroup`: los stubs de Leaflet de las pruebas no lo tienen, así que cada marcador queda guardado en `puntosLayers[id]` y se agrega o se saca del mapa con `ponerCapaPuntos()` (`crearMarcadorPunto` solo lo agrega si su capa está visible). Un punto que llega de otro equipo no prende la capa; uno cargado acá con su capa apagada sí (`prenderCapasSiApagadas()`), y "🗺 Ver en el mapa" de un punto apagado muestra solo ese punto con un marcador temporal, sin prender la capa. Test: `tests/probar_capas_puntos.js` (en el workflow, las 9 variantes).
