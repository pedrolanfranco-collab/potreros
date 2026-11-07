# Tableros (Sanidad y Campos)

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

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
publica hace más de 6 h. **Clave del campo (21/10/2026):** La Vuelta y María Laura piden la clave; el tablero toma la que ya se cargó en las apps (mismo origen, `clave_campo_<campo>`) o la pide una vez, la comprueba con `verificar_clave` y la manda en `x-clave-campo`; Pone Chico no la usa. Sin clave y con las políticas cerradas no pisa la última copia con una lectura vacía. Test:
`tests/probar_tablero_sanidad.js`.
**"Ya se hizo" en los vencidos (21/10/2026, a pedido de Pedro):** `sanidad_proximos` la regenera la Planilla cada hora y arrastra
vencidos viejos (23 en La Vuelta, el más viejo de jul/2025, varios con nombres de categoría viejos como "Nov. 2 a 3"), así que borrar ahí no
sirve. Cada tarjeta **vencida** tiene "✓ Ya se hizo" (confirmación en la página, sin `confirm()`) que inserta en `sanidad_proximos_hechos`
(establecimiento + categoría + sanidad + `fecha_prevista` como fecha; `on_conflict` + `ignore-duplicates`) y la oculta **en todos los equipos**;
quedan en "Marcados como hechos (N)" con "Deshacer" (DELETE por `id`, se confirma con `return=representation`). Se compara sin mayúsculas ni
espacios y por fecha prevista: si la Planilla registra un tratamiento nuevo, la fecha cambia y el próximo vencimiento vuelve a aparecer. **Es la
única escritura del tablero.** Sin la tabla (SQL no corrido) o si no se puede leer, no hay botón y se ven todos. SQL:
`scripts/sanidad/proximos_hechos.sql` (+ `_deshacer.sql`; lo corre Pedro, probado en un Postgres local con roles `anon`/`service_role`).
Los falsos Supabase de la prueba deben atender `sanidad_proximos_hechos` **antes** que `sanidad_proximos` (la URL contiene las dos).

**Cómo se trabajó y qué recordar (16/10/2026):**
- Cada cambio al tablero fue por **PR y merge a `main` cuando el CI está en verde**, a pedido de Pedro; una vez mergeado, la rama de
  trabajo se reinicia desde `main` (`git checkout -B <rama> origin/main`) antes del siguiente cambio.
- **Desde el entorno de Claude en la nube no se puede abrir `github.io`** (el proxy contesta 403): el deploy se confirma mirando el
  run de Actions en `main` (`jsdom` y `publicar` en success), no con `curl` a la URL. La vista real la prueba Pedro en el teléfono.
- **Cambiar el ícono no actualiza un acceso directo ya instalado** en la pantalla de inicio: hay que borrarlo y volver a agregarlo.
- Las capturas de la presentación se sacan con Playwright (Chromium ya instalado) y `fetch` interceptado con datos de ejemplo; no
  hay forma de verlas con datos reales hasta que Pedro abre la página.

### Tablero de Campos (`tablero-campos/`, 4/11/2026, a pedido de Pedro)

Página suelta de **solo lectura para la PC**, al estilo del portal de FieldData (`pedrolanfranco-collab.github.io/potreros/tablero-campos/`).
Botones por campo (hoy **La Vuelta y María Laura**; Pone Chico oculto a pedido de Pedro) + **Todos** si hay más de uno; tarjetas (cabezas, UG, carga UG/ha, potreros con animales, último dato);
mapa satelital con los potreros pintados por carga (cortes `CORTES_CARGA` = 0,5 / 0,8 / 1,2 UG/ha), cabezas o con/sin animales;
panel de detalle al hacer clic; tablas de potreros (ordenables) y por categoría; filtro de dueño/firma.
Lee **solo `stock_potreros`** con `fetch` (paginado de a 1000). La clave del campo funciona igual que en tablero-sanidad
(`clave_campo_<campo>`, `verificar_clave`, `x-clave-campo`); una lectura vacía de un campo con clave **no pisa** la copia guardada
salvo que la clave se confirme buena (ahí vacío es vacío). La única llamada que no es GET es `rpc/verificar_clave`.
**La carga del potrero usa siempre todas las UG del potrero**, aunque haya filtro de dueño (el pasto lo comen todos); la carga total
es UG de los potreros dibujados / sus ha. Superficie: el `area` del config; si está vacío, se mide del polígono (se muestra con "≈").
**No es una app generada por `template/generar.js`**: `fuente.html` se escribe a mano; **`tablero-campos/config.js` decide qué campos
se ven** (id = `establecimiento`, nombre, si usa clave, etiqueta del dueño, de dónde salen los potreros: `desdeConfig` o un `geojson`),
la URL/clave de Supabase, el título y los cortes de carga. `node tablero-campos/generar.js` pega todo eso como `const TABLERO` en
`index.html`. Pensado para que otro establecimiento lo reuse cambiando solo `config.js` (ver `tablero-campos/LEEME.md`).
Si cambian los límites en un config de las apps o `config.js`, correr ese generador (CI corre `--check`). También dibuja los potreros importados en ese navegador (`<campo>_potreros_nuevos`, `<campo>_limites_potreros`,
validados con `coordsValidas`). Sin `sw.js` ni íconos propios (para no servir datos viejos).
Test: `tests/probar_tablero_campos.js`.
