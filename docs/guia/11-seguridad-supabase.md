# Seguridad en Supabase (RLS, claves, auditorías)

> Parte de la guía del repo (ver `CLAUDE.md` en la raíz). Texto movido sin cambios desde el `CLAUDE.md` anterior al 7/11/2026.

### RLS real por tabla (verificado en Supabase el 12/9/2026, no solo leído del repo)

RLS está **activado** (`relrowsecurity = true`) en las tablas de este proyecto.

**Desde el 27/10/2026 (cierre de la Fase 4, ver más abajo) las tablas operativas ya NO están abiertas a la llave
pública**: `anon` solo contesta si el pedido trae el encabezado `x-clave-campo` con la clave del establecimiento
(`public.establecimientos_con_clave()`; `establecimientos_permitidos()` suma los campos abiertos a propósito, hoy
solo `pone_chico`). La tabla de abajo muestra **qué operaciones permite la política una vez que hay clave** (las
columnas de ✅/❌ son las de antes de la clave y siguen valiendo como "qué operaciones existen"). Excepciones: 
`productos_catalogo` se lee sin clave (lista de referencia); el stream de Pone Chico (`eventos_sync`, `stock_potreros`,
`sanidad_carga_pone_chico`, `sanidad_ultimos`, `sanidad_proximos`, `sanidad_proximos_hechos` y las fotos de su carpeta)
sigue abierto; `movimientos_dicose` sigue sin ningún permiso para `anon`. Quedan fuera de esta auditoría, **legibles con
la llave pública**, `comprobantes`, `proveedores`, `cotizaciones`, `precios_vet` y `alias_productos` (de los proyectos de
Zureo/precios, no de los potreros). Quien tiene la clave de un campo puede escribir en su stream (una clave por campo,
compartida con el empleado de Campo). Para ver el estado real: la consulta de `anon` de `scripts/seguridad/README.md`
y `python scripts/seguridad/verificar_fase4.py --cierre`.

(Antes del cierre: ninguna política filtraba por `establecimiento` y la llave pública podía leer/escribir filas de
cualquier campo; se había aceptado dado el modelo de amenaza —misma familia, sin login— hasta la Fase 4.)

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `eventos_sync` | ✅ | ✅ | ❌ | ❌ *(desde el 30/9/2026: dos políticas, `eventos_sync_select` y `eventos_sync_insert`, solo para `anon`; antes una sola "ALL". Es un registro de solo-agregar: "borrar"/"editar" un movimiento inserta un evento `correccion`, nunca hace DELETE/UPDATE)* |
| `productos_catalogo` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2 de la auditoría: `anon` solo lee; el catálogo lo escribe `actualizar_sanidad_supabase.py` con la clave privada)* |
| `sanidad_carga` (La Vuelta) | ✅ | ✅ | ✅ | ✅ *(7/10/2026: solo filas con `importado_en` vacío)* |
| `sanidad_carga_maria_laura` | ✅ | ✅ | ✅ | ✅ *(7/10/2026)* |
| `sanidad_carga_pone_chico` | ✅ | ✅ | ✅ | ✅ *(7/10/2026)* |
| `sanidad_ultimos` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2: `anon` solo lee; la escribe `actualizar_sanidad_supabase.py` con la clave privada)* |
| `sanidad_proximos` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2: `anon` solo lee; la escribe `actualizar_sanidad_supabase.py` con la clave privada)* |
| `animales_caravana` | ✅ | ❌ | ❌ | ❌ *(10/10/2026, Fase 2: `anon` solo lee; antes tenía una política "ALL". La escribe `publicar_animales.py` con la clave privada. Desde el cierre de la Fase 4 (27/10/2026) solo se lee con la clave del campo)* |
| `stock_potreros` (16/9/2026) | ✅ | ✅ | ✅ | ✅ *(una sola política "ALL", igual criterio que `eventos_sync`)* |
| `sanidad_proximos_hechos` (21/10/2026) | ✅ | ✅ | ❌ | ✅ *(tablero de Sanidad, "Ya se hizo"; solo oculta tarjetas; entró al cierre el 27/10/2026, SELECT/INSERT/DELETE con la clave del campo)* |
| `maestros_dicose` (9/10/2026) | ✅ | ✅ | ❌ | ❌ *(dos políticas para `anon`: SELECT e INSERT, sin UPDATE ni DELETE; catálogos de compradores / comisionistas / clientes y proveedores. La app agrega con `upsert` + `ignoreDuplicates` (ON CONFLICT DO NOTHING). Actualizar o desactivar una entrada lo hace solo la clave privada)* |
| `movimientos_dicose` (9/10/2026) | ❌ | ❌ | ❌ | ❌ *(`anon` sin ningún permiso: ni SELECT, INSERT ni UPDATE; lleva importes, descuentos y DICOSE de terceros. La lee y la llena solo el script de la PC con la clave privada. La vista `movimientos_dicose_vigentes` es `security_invoker = true`)* |

**Fase 2 de la auditoría (10/10/2026) — carencia protegida.** El catálogo de productos y el padrón de
caravanas deciden si un animal figura apto para faena, y con la llave pública (que está en cada app y
en este repo público) cualquiera podía insertarlos o borrarlos. `scripts/seguridad/fase2_carencia.sql`
(transaccional, guarda las políticas viejas en `auditoria_politicas_antes_fase2`; se deshace con
`fase2_carencia_deshacer.sql`) dejó a `anon` solo con SELECT en `productos_catalogo`, `animales_caravana`,
`sanidad_ultimos` y `sanidad_proximos`, le sacó los permisos de tabla de escritura (un intento ahora da
401 `permission denied`, no un 200 vacío) y fijó `creado_en` de `eventos_sync` con un trigger
(`eventos_sync_fijar_creado_en`; `service_role` exceptuado). Antes del SQL se cambiaron los scripts de la
PC que escriben ahí para que usen la clave privada (`SUPABASE_SECRET_KEY` o `~/.potreros/.env`, fuera del
repo y de OneDrive): `publicar_animales.py` y `actualizar_sanidad_supabase.py`. Verificación:
`python scripts/seguridad/verificar_fase2.py` (usa filtros que no coinciden con ninguna fila: no escribe
nada real). Un evento insertado como `anon` sigue entrando y se guarda con la hora del servidor aunque
pida otra. Quedan abiertas a `anon`, a propósito hasta la Fase 4 (clave del campo), las tablas que las
apps escriben: `eventos_sync`, `sanidad_carga*`, `stock_potreros`, `maestros_dicose`.

**`stock_potreros`** (16/9/2026): foto del stock actual por
`establecimiento+potrero+categoria+dueño` (clave `establecimiento,potrero,
clave`, donde `clave` es el mismo formato que `claveAnimal()` en el
cliente), publicada por la propia app en cada acción local que toca
animales y en cada sincronización — nunca leída por la app, solo escrita,
para consultar desde afuera (SQL directo, AppSheet, el conector Hermes).
No es un log que se acumula como `eventos_sync`: cada publicación hace
`upsert` de las categorías con stock y `delete` de las que llegaron a 0, así
que necesita política de `UPDATE`/`DELETE` igual que `eventos_sync` — de
ahí la política "ALL" en vez del patrón sin `UPDATE` de `productos_catalogo`
(que causó el incidente de abajo). **Rollout gradual por
`CONFIG.stockSupabase`**: solo `true` en La Vuelta por ahora; en María
Laura/Pone Chico el código está pero es un no-op hasta que se confirme el
funcionamiento real y se les active el flag.

**`maestros_dicose` y `movimientos_dicose`** (9/10/2026, SQL en `scripts/dicose/`, se corren a mano en el SQL
Editor): la app NO escribe `movimientos_dicose` — las compras, ventas, ventas entre dueños, campo ajeno y traslados
siguen viajando como eventos de `eventos_sync` (las compras/ventas traen el detalle completo — kilos, destare, precio,
comisión, flete, descuentos — en `detalle.fin`, campos opcionales); el script de Excel
(`pasar_traslados_a_excel.py`, en la carpeta Ganaderia\Macros & phyton, fuera de este repo) arma de ahí una fila por
movimiento y la sube con *upsert* por `event_id` (vigente/anulado, `asentado_excel`). Los catálogos
(`maestros_dicose`) los lee la PC al abrir Movimientos DICOSE y los agrega la PC (cola `estado.colaMaestros` si no hay
señal); se siembran desde los Excel con `sembrar_maestros_dicose.py`. Ninguna política permite DELETE; para sacar una
entrada de las listas se pone `activo = false`.
**Destare y peso neto (21/10/2026, a pedido de Pedro, solo PC):** la compra muestra "Kilos neto (bruto − destare)" como campo
de solo lectura (`#cv-kneto`) y la venta ganó "Destare (%)" (`#cv-destare-v`, vacío con "4 a 7": varía entre 4 y 7 %; **obligatorio en 1ª**, aviso en la vista previa fuera de
ese rango; también en las categorías extra; una venta vieja sin destare se edita con 0) y
"Kilos neto en pie" (`#cv-kneto-v`). En una venta 1ª el precio va sobre el neto: `calcVenta()` arma `kilosNeto = kilosPie − destare·kilosPie`,
`kilos` = ese neto, y el rendimiento es res / neto en pie (sin destare da lo mismo que antes). `detalle.fin` de la venta suma `destare`,
`kilosNeto` y `pesoPromNeto`; `kilosPie` sigue siendo el bruto. Test: `tests/probar_finanzas_compraventa.js`.
*Scripts de la PC (revisados el 21/10/2026, carpeta `Ganaderia\Macros & phyton`):* `pasar_traslados_a_excel.py` no necesitó cambios
(al Excel de DICOSE pasa solo cantidades, sin kilos ni importes). `dicose_supabase.py` (`fila_compraventa()`) ya copiaba `importeBruto`,
`neto` y `rendimiento` de `fin` sin recalcular; se le agregó en la rama de venta `"destare"` y `"kilos_neto"` (antes solo en la compra), y
Pedro lo aplicó en la PC con un bloque de PowerShell (copia del original en `dicose_supabase.py.bak`; prueba local con una venta de
2.000 kg al 5 %: `destare 0.05`, `kilos_neto 1900`). Las ventas de antes quedan con esas dos columnas vacías.
**Comisión del intermediario y carga rápida (22/10/2026, a pedido de Pedro, solo PC):** compra y venta tienen comisionista /
intermediario (catálogo `comisionista`, "Directo" por defecto), "% Comisión — habitual 0 a 4" (aviso en la vista previa fuera de ese
rango) y "Con boleta del intermediario (+ IVA 22 % sobre la comisión)" (`IVA_COMISION`, `ivaComision()`). Compra: `costoTotal` suma la
comisión y su IVA. Venta (`#cv-comisionista-v`, `#cv-pcom-v`, `#cv-boleta-v`, nuevo): comisión = % del bruto de cada línea y el neto la
descuenta con su IVA. `fin` suma `conBoleta` e `ivaCom` (y en la venta `comisionista`, `pctCom`, `importeCom`). El tilde **"Carga rápida"
está justo después de la Operación** (antes estaba abajo de la fecha) y la carga rápida acepta **varias categorías** de la misma guía
(`#cv-extra-rapido`, líneas de categoría + cantidad + precio por cabeza opcional; `registrarRapidasCV()` → `registrarOperacionesCV()`, la
misma validación todo-o-nada que la carga completa); cambiar de modo borra las líneas extra, igual que cambiar la operación.
`dicose_supabase.py` llena `pct_comision` / `importe_comision` / `comisionista` solo en la compra hasta que se le aplique el cambio de la
venta; el IVA de la comisión no tiene columna en `movimientos_dicose` (queda en `detalle`).
**Pase automático a DICOSE (22/10/2026):** `scripts/dicose/pasar_traslados_automatico.py` corre cada hora (tarea
"Potreros - Pasar traslados a Excel", instalada con `scripts/dicose/instalar_tarea_traslados.ps1`) y ejecuta
`pasar_traslados_a_excel.py --aplicar` de la carpeta de Pedro: escribe los libros y sube `movimientos_dicose`. No corre si hay un
libro abierto; avisa por ntfy (sin repetir rechazos ni fallas). Detalle en `scripts/dicose/README.md`. Test:
`scripts/dicose/probar_pasar_traslados_automatico.py`.
*Para cambiar un archivo de la PC desde la nube:* pegar en PowerShell un bloque envuelto en `& { … }` (si no, la consola ejecuta línea por
línea y un `elseif`/`else` suelto da "no se reconoce"), que lea/escriba con `[System.IO.File]` conservando BOM y CRLF, sea idempotente y deje
`.bak`; probarlo antes en la nube con `pwsh` (se baja de los releases de GitHub) pasándolo por stdin (`pwsh -Command - < bloque.txt`, con
una línea en blanco al final). Para leer un archivo de la PC, lo más fácil para Pedro es `notepad <archivo>`, Ctrl+A, Ctrl+C y pegar en el chat.
**Clave privada (secret / service_role)**: como este repo es público y la clave `anon` está en cada app,
`movimientos_dicose` no admite `anon` para nada y `maestros_dicose` solo SELECT + INSERT. Los scripts de la PC
(`dicose_supabase.py`, `sembrar_maestros_dicose.py`) escriben con la clave privada, que se lee de la variable de
entorno `SUPABASE_SECRET_KEY` o de `C:\Users\<usuario>\.potreros\.env` (una línea `SUPABASE_SECRET_KEY=...`;
fuera del repo y fuera de OneDrive). **Nunca va al repo, a un log ni a un chat**; los scripts no la imprimen, la
rechazan si es la publicable y no la mandan a otro destino que Supabase o localhost. Sin clave el script sigue solo
con el Excel. Ninguna pantalla de las apps lee `movimientos_dicose` (se verifica con `grep`); si alguna lo hiciera,
a `anon` solo se le puede dar SELECT.

**Auditoría de seguridad (30/9/2026)** — resumen de lo hecho y lo pendiente:
`eventos_sync` ya no permite UPDATE/DELETE a `anon` (verificado en Supabase:
antes un DELETE de `anon` borraba 1 fila, después 0; `count(*)` sin cambios).
La app no hace ni DELETE ni UPDATE sobre esa tabla (0 usos en el template), así
que no hubo que tocar código. **Sigue abierto** el resto de la tabla de arriba
(lectura/escritura pública en las demás tablas, y `animales_caravana` legible
completa con la clave pública). Los datos que llegan de Supabase y de KML/GPX
se tratan como no confiables: `esc()` al pintar y `limpiarTextoRemoto()` al
entrar (ver `tests/probar_seguridad_remoto.js`). Backups: `scripts/backup/`
(el plan de Supabase es gratuito, sin backups automáticos; ver la Fase 5 abajo).

**Fase 5 de la auditoría (10/10/2026) — operación y monitoreo:**
- **Backup** (`scripts/backup/backup_supabase.py`): lee con la clave privada y descubre las tablas
  desde el OpenAPI de `/rest/v1/` (antes era una lista fija de 9 y `maestros_dicose` y
  `movimientos_dicose` no estaban). Sigue andando cuando la Fase 4 cierre la lectura anónima. Si el
  resultado no es OK avisa por ntfy. `restaurar_backup.py` es el simulacro de restauración contra un
  proyecto de Supabase **de prueba** (se niega a escribir en el real); los pasos están en el README
  de la carpeta. `probar_backup.py` y `probar_restaurar.py` corren en el CI (`python3`).
- **Vigilancia** (`vigilar_tareas_sanidad.py`, en `Sanidad\Automatizacion`, fuera del repo): revisa las
  7 tareas programadas (deshabilitada, sin corridas futuras, último resultado con error, sin correr
  hace más de lo esperable) y avisa por mail y ntfy; los domingos manda un "todo en orden" corto.
  El informe semanal de nacimientos había fallado 6 sábados sin que nadie lo supiera.
- **Keep-alive sin la PC**: `.github/workflows/mantener_activo.yml` hace la consulta diaria desde
  GitHub; la tarea de la PC queda de segundo respaldo.
- **Contrato de eventos**: `docs/eventos.md` describe cada `tipo` y su `detalle`. El CI falla si el
  template emite un tipo que no está ahí (`tests/probar_contrato_eventos.js`, que además valida los
  eventos reales de compra, venta, traslado, movimiento solo guía y campo ajeno con la app en jsdom).
  `test_contrato_eventos.py` (en `Ganaderia\Macros & phyton`) pasa esos mismos eventos por las
  funciones `construir_*` de `pasar_traslados_a_excel.py`.
- **El PDF "Animales por potrero" de la PC estuvo roto del 12/9 al 10/10**: `e4d8f2f` cambió la forma
  de `calcularEstadisticasNacimientos()` y el PDF siguió leyendo los campos viejos. Nadie lo notó
  porque jsdom no carga jsPDF; lo encontró el informe semanal. `tests/probar_pdf_animales.js` lo
  aprieta con un jsPDF falso. **Lección:** un botón que genera un archivo necesita una prueba que lo
  apriete, aunque la librería sea externa.

**Fase 4, Release 1 (modo suave) (13/10/2026) — clave del campo.** Hallazgos 12, 15 y 18: la llave pública
(`anon`) está en cada app y en este repo público, así que cualquiera puede insertar eventos falsos en
`eventos_sync` y leer el padrón y los datos comerciales. Cada establecimiento tiene **una clave** (la misma
para su PC, su móvil y Campo; la elige y la carga Pedro, nunca pasa por un chat ni por el repo) que la app manda
en el encabezado `x-clave-campo` de cada pedido a Supabase. **Este release no corta nada**: las políticas
siguen abiertas.
- *En Supabase* (`scripts/seguridad/fase4_clave_campo.sql`, con su `_deshacer.sql`; transaccional e idempotente;
  lo corre Pedro a mano): esquema `private` (no expuesto a la API) con `claves_campo(establecimiento, sal, hash)` y
  `equipos_vistos`; `public.establecimientos_con_clave()` (lee el encabezado y devuelve los campos cuya clave
  coincide; pensada para las políticas como `(select …)`, una vez por consulta); RPC `verificar_clave(est, clave)`
  (una clave mala demora 0,5 s); `private.cargar_clave(est, clave)` (solo Pedro); y un trigger AFTER INSERT en
  `eventos_sync` que anota cada equipo (`dispositivo`, `detalle.v`, `detalle.usuario`, `con_clave`) sin poder romper
  un insert. Los espejos entre campos (`traslado_entrada`, `anular_traslado`) no se anotan: llevan el id del equipo
  de origen con el `establecimiento` de destino. `verificar_fase4.py` comprueba desde afuera; con `--cierre`
  comprueba el release 2.
- *En la app* (template, las 9 variantes; `tests/probar_clave_campo.js`): la clave vive en
  `localStorage['clave_campo_<ESTABLECIMIENTO>']`, fuera de `STORAGE_KEY` (no sale en el Backup JSON ni en "Descargar
  copia", y "Restablecer datos de fábrica" no la borra). Formato: letras sin tildes ni ñ y números, 8 a 64, en minúsculas
  y sin espacios en los extremos. `clienteSupabase()` agrega `global.headers['x-clave-campo']` y se recrea al guardarla.
  La ventana "🔑 Clave del campo" (`#modal-clave-campo`) se abre sola una vez por apertura si no hay clave (con un
  retardo, sin otra ventana abierta, y **nunca** con `navigator.webdriver` ni sin un cliente con `.rpc`); "Guardar"
  llama a `verificar_clave` y **un fallo de verificación (red, función inexistente) nunca se trata como clave
  inválida**: no guarda y avisa que no pudo comprobar. Aviso en el pie (`#aviso-clave`): "Falta la clave del campo"
  (ocre) o "La clave guardada ya no sirve" (rojo; se verifica una vez por apertura). El cartel de "movimientos
  trabados" agrega "revisá la clave del campo" ante 42501 / 401 / 403. `enviarAnulacionTraslado()` ahora lleva
  `origenEstablecimiento` en el detalle (ver `docs/eventos.md`, sección "Clave del campo y eventos que cruzan de
  stream"). Botón "🔑 Clave del campo" en Herramientas (PC: grupo "Este dispositivo").
- *Orden obligatorio*: **el SQL antes que el código desplegado** (una app nueva que llama a `verificar_clave` antes de
  que exista la función solo muestra "no se pudo comprobar", pero no hay forma de cargar la clave); después cargar las
  3 claves, correr `verificar_fase4.py`, publicar, y que cada equipo la cargue una vez.
- *Pone Chico NO usa clave (17/10/2026, a pedido de Pedro)*: `CONFIG.claveCampo` es `true` en La Vuelta y María Laura y
  `false` en Pone Chico. Con `false` la app no muestra la ventana, el aviso del pie ni el botón, no manda `x-clave-campo` y
  no llama a `verificar_clave` (aunque haya una clave vieja guardada). **Para el cierre**: sus políticas deben dejar Pone Chico
  abierto a propósito (o se queda sin sincronizar); ver `scripts/seguridad/README.md`. Test: `probar_clave_campo.js`.
- *Cierre revisado (21/10/2026)*: contempla Pone Chico abierto (`private.campos_abiertos` + `establecimientos_permitidos()`, solo en el stream propio de cada campo; las excepciones entre campos y las tablas sin Pone Chico exigen clave real), `productos_catalogo` legible para todos y `sanidad_ultimos`/`sanidad_proximos` legibles con clave (las lee el tablero). Detalle en `scripts/seguridad/README.md`.
  **Probado el 21/10/2026 contra un Postgres 16 real** (`scripts/seguridad/probar_cierre.js`, PGlite, 68 verificaciones, con el deshacer). Encontró que el SQL
  original **abortaba**: en una política, `= any ((select f()))` falla con `text = text[]` (Postgres lo lee como subconsulta); hay que escribir
  `= any ((select f())::text[])`. Y que **volver a correr `fase4_cierre.sql` reinserta `pone_chico` en `campos_abiertos`**: para ponerle clave, borrarlo y no re-ejecutar el cierre.
- *Release 2, el cierre* (`fase4_cierre.sql` + `_deshacer.sql`): **CORRIDO el 27/10/2026** (por el conector Supabase, a pedido
  de Pedro, en una transacción; respaldos en `auditoria_politicas_antes_fase4` y `auditoria_privilegios_antes_fase4`). Las
  políticas pasaron a exigir `establecimientos_con_clave()`/`establecimientos_permitidos()` en las 11 tablas y en
  `storage.objects` (bucket `fotos-reportes`, ampliado ese día; PR 27). Antes se comprobó: `private.equipos_vistos` sin
  equipos reales activos con `con_clave = false`, los 5 scripts de la PC con `SUPABASE_SECRET_KEY` en `~/.potreros/.env`, el
  informe de nacimientos con las claves y el tablero publicado mandando `x-clave-campo`. **Verificado después**:
  `verificar_fase4.py --cierre` "Todo OK"; con la llave pública, sin clave 0 filas en `sanidad_carga`, `animales_caravana`,
  `stock_potreros`, `sanidad_ultimos` y 401 en `movimientos_dicose`, con la clave de La Vuelta se lee; en una app real se
  probó un traslado La Vuelta → María Laura y una foto de un reporte (subida a Storage + evento `reporte_foto`).
  *Lección de la prueba de la foto*: la foto sale con el reporte solo si ya está elegida en el formulario antes de tocar
  "ubicación actual"; el primer intento no la llevaba y no era un fallo del cierre.
  Para volver atrás: `fase4_cierre_deshacer.sql` (reabre todo). **Pendiente**: rotar el token personal `sbp_` de Hermes
  (ignora RLS), decidir las tablas de otros proyectos de arriba, y vigilar `equipos_vistos`/el cartel "trabados" unos días.

**Pone Chico con clave, etapa 1 (12/11/2026, a pedido de Pedro, tras la auditoría del 12/11).** `CONFIG.claveCampo` pasó a `true` en
Pone Chico (PC y móvil 3.03, Campo 2.03): sus 3 apps muestran la ventana, el aviso del pie y el botón, mandan `x-clave-campo` y llaman
a `verificar_clave`, igual que La Vuelta y María Laura. También el Tablero de Sanidad (`CON_CLAVE.pone_chico`) y Hermes
(`usa_clave_campo`, variable `CLAVE_CAMPO_PONE_CHICO` en `~/.potreros/.env`). **Este release no corta nada**: `pone_chico` sigue en
`private.campos_abiertos`, así que un equipo sin clave (o con versión vieja) sigue sincronizando. Antes de publicar, Pedro carga la
clave con `private.cargar_clave('pone_chico', ...)` (nunca por chat ni por el repo). **Etapa 2, pendiente:** cuando
`private.equipos_vistos` muestre los equipos de Pone Chico con `con_clave = true`, correr
`delete from private.campos_abiertos where establecimiento = 'pone_chico';` (**sin volver a correr `fase4_cierre.sql`: lo reinserta**)
y actualizar `verificar_fase4.py` (`CAMPO_ABIERTO`), `fotos_reportes.sql` y `scripts/seguridad/README.md`, que todavía describen a
Pone Chico abierto porque así está la base.

Dos cosas que explican comportamiento ya visto, no teoría:
- **`productos_catalogo` sin UPDATE** es la causa raíz del incidente del
  12/9/2026 (ver memoria `planilla-sanitaria-v22`): un `PATCH` contra esa
  tabla no da error, da `200` con cuerpo vacío — PostgREST no distingue
  "bloqueado por RLS" de "no había ninguna fila para actualizar". El fix ya
  aplicado en el script publicador es no usar `PATCH` nunca contra esta
  tabla, solo `DELETE`+`POST` (que sí tienen política).
- **`sanidad_carga_maria_laura`/`sanidad_carga_pone_chico` tenían solo SELECT/INSERT**
  hasta el 7/10/2026, cuando se agregó la función de editar/borrar un tratamiento (solo PC):
  se crearon las políticas UPDATE y DELETE **antes** de publicar el código que las asume (el
  mismo error de secuencia, schema/permisos después que código, ya pasó una vez con
  `productos_catalogo`). Si esas políticas faltaran, la app avisa "No se pudo" en vez de decir
  "borrado" (RLS contesta 200 vacío). `sanidad_carga` (La Vuelta) ganó DELETE solo para filas con
  `importado_en` vacío.
