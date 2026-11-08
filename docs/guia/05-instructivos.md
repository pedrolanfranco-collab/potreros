# Instructivos de las apps

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### Instructivos (Campo, móvil y PC) (29-30/10/2026, a pedido de Pedro)

Tres páginas fijas, una por tipo de app, con **todas** sus funciones, para mandarle el link una sola vez a quien las usa (uno solo para
los 3 campos; las diferencias van en la tabla "Según tu campo" de cada una):

| Página | App | Link |
|---|---|---|
| `instructivo-campo/index.html` | Campo (`*-movil-campo/`, empleados) | `pedrolanfranco-collab.github.io/potreros/instructivo-campo/` |
| `instructivo-movil/index.html` | móvil completa (`*-movil/`) | `pedrolanfranco-collab.github.io/potreros/instructivo-movil/` |
| `instructivo-pc/index.html` | PC (`*-pc/`; se ordena como la caja 🛠 Herramientas: Consultar / Mapa y potreros / Exportar y respaldo / Este dispositivo) | `pedrolanfranco-collab.github.io/potreros/instructivo-pc/` |

Son **a mano** como `tablero-sanidad/`: no pasan por `generar.js`, no tienen `sw.js` propio, ni librerías, ni red (sin scripts, enlaces
externos ni imágenes; con modo oscuro y un ancho de lectura acotado). Las abre el botón **📖 Instructivo** (`btn-instructivo`, siempre
con `window.open` en otra pestaña): en Campo, en Herramientas (bloques `@simple`); en la móvil completa, en Herramientas (`@completo`
dentro de `@movil`); en la PC, en Herramientas › Este dispositivo (`@pc`). Las tres usan **una sola función**, `abrirInstructivo(url)`, y
cada variante solo dice qué carpeta abre. Sin señal: el `sw.js` de cada carpeta de app precarga SU página (`'../instructivo-campo/'`,
`'../instructivo-movil/'` o `'../instructivo-pc/'` en `PRECACHE_URLS`, a mano) pero **su alcance no cubre esas carpetas**, así que el
botón, sin conexión, lee la copia de la caché y la abre como `blob:` (los saltos del índice `#…` andan igual).

**Regla: todo cambio visible en una app (un botón, un campo de formulario, una validación, un texto, un aviso) actualiza SU instructivo y
su "Novedades de esta versión" en el MISMO PR**, junto con las versiones de "Actualizado para" (`data-version`: `versionMovilSimple` en
Campo, `versionMovil` en la móvil completa, `versionPc` en la PC, de los 3 configs). Un cambio en código compartido toca más de una
página. Se lee el formulario real en el template antes de escribir un paso: nombres de botones exactos, con su emoji. Los botones que la
app no muestra (`btn-resync-puntos`, `display:none` en la móvil y en Campo, y los
controles de "Dibujar potrero") no van: están en `excepciones` de la prueba, con su motivo.

`tests/probar_instructivos.js` (en el workflow, sin argumentos; reemplaza a `probar_instructivo_campo.js`) falla si, en alguna de las
tres páginas: un botón de sus 3 variantes (`id="btn-…"`, `data-accion`, `data-sub`, los de las ventanas Desaparecidos/Vecinos y todo
botón con id o `data-*` cuyo texto lleva un emoji o una flecha) no figura en la página con su emoji (`excepciones` lleva el motivo de cada
uno; un botón nuevo oculto en el HTML obliga a decidir, en `ocultoPorConfig`); las versiones de la página no son las de los config o el
encabezado de la app; hay un `href="#x"` sin su `id`; falta `btn-instructivo` (en la PC, dentro de "Este dispositivo"), aparece en la
app que no es o abre otra carpeta; falta el precache en un `sw.js` o hay uno de más; el botón no abre su carpeta en jsdom (con señal,
y sin señal desde la caché como `blob:`); o la página gana scripts, enlaces externos o red. También da por hecha la tabla "Según tu
campo" (`claveCampo`, `caravanasHabilitado`, `duenoLabel`, `duenoObligatorio`, `guiasHabilitado`, `dicoseHabilitado`,
`trasladoHabilitado`, `pesadasHistorial`, `datosFaltantes`, `completarCsvBaston`, `usaExcelBridge`, `mapLabels`, `puntosSeed`, `padronOffline` de cada
config): si cambian, hay que actualizar la tabla y la prueba. Antes de commitear un cambio de prueba, `node tests/sync-skill.js` (solo
en la PC de Pedro).
