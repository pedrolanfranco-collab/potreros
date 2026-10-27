# Seguridad de la base (auditoría del 9/10/2026)

Esta carpeta guarda los cambios de permisos de Supabase de la auditoría. El repositorio es
público y la llave `anon` está dentro de cada app, así que **lo que `anon` puede hacer lo puede
hacer cualquiera**. Cada fase tiene su SQL, su vuelta atrás y una verificación.

| Fase | Qué cierra | Archivos |
|---|---|---|
| 2 | Escritura anónima en `productos_catalogo`, `animales_caravana`, `sanidad_ultimos`, `sanidad_proximos`; `creado_en` de `eventos_sync` lo fija el servidor | `fase2_carencia.sql`, `fase2_carencia_deshacer.sql`, `verificar_fase2.py` |
| 4 | Clave del campo: eventos falsos con la llave pública y lectura del padrón y los datos comerciales (en dos releases, ver abajo) | `fase4_clave_campo.sql`, `fase4_clave_campo_deshacer.sql`, `fase4_cierre.sql`, `fase4_cierre_deshacer.sql`, `verificar_fase4.py` |
| (24/10/2026, fuera de las fases) | Bucket `fotos-reportes` para las fotos de los reportes de campo: `anon` solo sube y ve fotos dentro de la carpeta de cada establecimiento, sin UPDATE ni DELETE | `fotos_reportes.sql`, `fotos_reportes_deshacer.sql` |

## Cómo se corre una fase

1. Los scripts de la PC que escriben en esas tablas ya tienen que usar la clave privada
   (`publicar_animales.py`, `actualizar_sanidad_supabase.py`). Se hizo **antes** del SQL.
2. En el panel de Supabase, **SQL Editor**, pegar el contenido de `faseN_*.sql` y apretar **Run**.
   Está envuelto en una transacción: si algo falla, no queda nada aplicado.
3. `python verificar_fase2.py` desde esta carpeta: debe decir `Todo OK`.
4. Dejar que corra la tarea programada del script (o correrlo a mano) y mirar su `.log`.

## La clave privada

Los scripts que escriben leen `SUPABASE_SECRET_KEY` de la variable de entorno o de la línea
`SUPABASE_SECRET_KEY=...` del archivo `C:\Users\<usuario>\.potreros\.env`, **fuera del repo y de
OneDrive**. Es la clave *secret* (empieza con `sb_secret_`), no la *publishable* de las apps.
Nunca va al repo, a un chat ni a un log.

## Qué puede hacer `anon` en cada tabla (consulta de solo lectura)

```sql
select c.relname as tabla,
       has_table_privilege('anon', c.oid, 'select') as leer,
       has_table_privilege('anon', c.oid, 'insert') as insertar,
       has_table_privilege('anon', c.oid, 'update') as modificar,
       has_table_privilege('anon', c.oid, 'delete') as borrar
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
order by 1;
```

Las reglas por tabla (`pg_policies`) y los permisos de tabla se combinan: para escribir hacen
falta **los dos**.

## Fase 4: la clave del campo (13/10/2026)

Hasta ahora cualquiera con la llave pública (`anon`, que está dentro de cada app y en este repo
público) podía escribir eventos falsos en `eventos_sync` y leer el padrón y los datos comerciales.
La Fase 4 le pone una **clave por establecimiento**: la app la manda en el encabezado
`x-clave-campo` de cada pedido y, al final, las políticas solo contestan a quien la trae.

Va en **dos releases**, y el segundo solo se corre cuando el primero ya está en todos los equipos:

| Release | Qué hace | Archivos |
|---|---|---|
| 1, "modo suave" | Deja lista la comprobación de claves y la lista de equipos vistos. **No corta nada**: las políticas siguen abiertas | `fase4_clave_campo.sql`, `fase4_clave_campo_deshacer.sql`, `verificar_fase4.py` |
| 2, el cierre | Las políticas pasan a exigir la clave del campo | `fase4_cierre.sql`, `fase4_cierre_deshacer.sql`, `verificar_fase4.py --cierre` |

### Release 1: pasos exactos (en este orden, **el SQL antes que publicar la app**)

1. **Elegir las 3 claves** (una por campo: La Vuelta, María Laura, Pone Chico). De 8 a 64
   caracteres, **solo letras sin tildes ni ñ y números, sin espacios**; conviene que tengan 12 o
   más y que sean distintas entre sí y de cualquier otra contraseña. Se escriben en minúsculas (la
   app y el servidor pasan todo a minúsculas). Nunca van por el chat ni al repo.
2. **SQL Editor de Supabase → pegar `fase4_clave_campo.sql` → Run.** Es una transacción: si falla,
   no queda nada aplicado. Al final muestra cuántos equipos históricos anotó y las 4 funciones.
3. **Cargar las 3 claves**, una consulta por campo, con las claves reales:

   ```sql
   select private.cargar_clave('la_vuelta',   '<la clave de La Vuelta>');
   select private.cargar_clave('maria_laura', '<la clave de María Laura>');
   select private.cargar_clave('pone_chico',  '<la clave de Pone Chico>');
   ```

   (poner la clave real entre las comillas, sin los `<>`). Contesta `Clave de la_vuelta cargada.` Después,
   **borrar esas consultas del historial del editor** (el SQL Editor guarda las consultas que
   corrés y ahí quedaría la clave en texto). En la base solo queda la sal y el hash.
4. **`python scripts/seguridad/verificar_fase4.py`**: tiene que decir `Todo OK` (la función existe,
   rechaza una clave inventada y las tablas siguen legibles). Para que además pruebe las claves
   reales, ponerlas en `C:\Users\<usuario>\.potreros\.env` (el mismo archivo de la clave privada,
   fuera del repo y de OneDrive), una línea por campo:
   `CLAVE_CAMPO_LA_VUELTA=...`, `CLAVE_CAMPO_MARIA_LAURA=...`, `CLAVE_CAMPO_PONE_CHICO=...`. El
   script no imprime nunca las claves.
5. **Recién ahora se publica la app** (push a `main`; espera al CI). La primera vez que se abre
   cada equipo, la ventana "🔑 Clave del campo" se abre sola: se escribe la clave y listo (queda
   guardada en ese equipo; la comparten la PC, la móvil y Campo del mismo campo si están en el
   mismo navegador). "Más tarde" la cierra hasta la próxima apertura, y el aviso del pie sigue
   ahí. Se puede ver o cambiar desde Herramientas → "🔑 Clave del campo".

Mientras no se cierre, un equipo sin clave anda igual.

### Cómo se sabe cuándo cerrar

Cada evento que llega anota el equipo que lo mandó en `private.equipos_vistos` (campo, equipo,
quién es, versión de la app y si ya mandó la clave). La lista arranca con los equipos que ya
habían escrito alguna vez (todos con `con_clave = false`) y se va completando:

```sql
-- todos los equipos, los que faltan primero
select establecimiento, usuario, dispositivo, version, con_clave, ultima
from private.equipos_vistos
order by establecimiento, con_clave, ultima desc;

-- los que escribieron en los últimos 30 días y todavía NO mandan la clave
select establecimiento, usuario, dispositivo, version, ultima
from private.equipos_vistos
where not con_clave and ultima > now() - interval '30 days'
order by establecimiento, ultima desc;
```

Un equipo que se reinició ("Restablecer datos de fábrica") o que ya no se usa queda con una
`ultima` vieja y no cuenta. Un equipo con la app vieja sin la clave sigue figurando
`con_clave = false` hasta que la actualice y la cargue. La versión (`v`) aparece desde la
Fase 3, paso 4 (11/10/2026).

### Release 2, el cierre: cuándo correrlo

**No correr `fase4_cierre.sql` hasta que se cumplan las tres cosas:**

> **Pone Chico no usa clave (17/10/2026, a pedido de Pedro)** y el cierre ya lo contempla (revisión del 21/10/2026):
> `fase4_cierre.sql` crea `private.campos_abiertos` (hoy `pone_chico`) y `public.establecimientos_permitidos()` = campos con
> clave válida + campos abiertos. Esa función se usa solo en el **stream propio** de cada campo (`eventos_sync`,
> `stock_potreros`, `sanidad_carga_pone_chico`, `sanidad_ultimos`, `sanidad_proximos`); las excepciones entre campos
> (`traslado_entrada`, `anular_traslado`) y las tablas que Pone Chico no usa (`sanidad_carga`, `sanidad_carga_maria_laura`,
> `animales_caravana`, `maestros_dicose`) siguen exigiendo una clave **real**, así nadie se hace pasar por un campo abierto
> para escribir en otro. `productos_catalogo` queda legible para todos (lista de referencia). Para ponerle clave a Pone Chico
> más adelante: `claveCampo: true` en su config, cargar su clave y `delete from private.campos_abiertos where establecimiento = 'pone_chico';`
> (**y no volver a correr `fase4_cierre.sql` después: reinserta `pone_chico`**; lo comprueba `probar_cierre.js`).
> Su fila de `private.claves_campo` no hace falta mientras esté abierto: se saca con
> `delete from private.claves_campo where establecimiento = 'pone_chico';`.

1. la segunda consulta de arriba devuelve **0 filas** (todos los equipos activos ya mandan la clave);
2. **los scripts de la PC que usan la llave pública ya usan la clave privada**
   (`SUPABASE_SECRET_KEY`): `pasar_traslados_a_excel.py`, `sanidad_puente.py`,
   `bajar_sanidad_de_potreros.py`, `regenerar_stock_potreros_excel.py` y `vigilar_tareas_sanidad.py`.
   El informe de nacimientos (`enviar_informe_nacimientos.py`, abre la app con Playwright) necesita
   además la clave del campo en el `localStorage` de su navegador (`clave_campo_la_vuelta`).
   El keep-alive de GitHub sigue andando: contesta 200 con lista vacía.
3. **el Tablero de Sanidad (`tablero-sanidad/`) ya publicado manda la clave del campo** (21/10/2026): toma la que se cargó
   en las apps (mismo origen, `localStorage['clave_campo_<campo>']`) o la pide una vez con su propia ventana, y la manda
   en `x-clave-campo`. Con las políticas cerradas, una lectura sin clave contesta 200 sin filas; el tablero conserva
   entonces la última copia y avisa "Falta la clave". Pone Chico (sin clave) sigue andando. **Publicar el tablero antes del cierre**
   y abrirlo una vez en cada celular: si ese celular no comparte almacenamiento con la app (por ejemplo un acceso directo
   de iPhone), escribe la clave en el tablero.

Después: correr el SQL (guarda las políticas de antes en `auditoria_politicas_antes_fase4`),
`python scripts/seguridad/verificar_fase4.py --cierre` (sin clave todo cerrado salvo lo abierto a propósito —el stream de Pone Chico y `productos_catalogo`—, con la clave anda, incluidas `sanidad_ultimos` y `sanidad_proximos`),
y probar a mano un movimiento y un traslado La Vuelta → María Laura. Para volver atrás:
`fase4_cierre_deshacer.sql`.

**Cómo se probó el SQL del cierre (21/10/2026).** `probar_cierre.js` lo corre, junto con su deshacer, contra un Postgres 16 real
(PGlite, en WASM) con las tablas y políticas de hoy, el release 1 de verdad y claves de juguete, y prueba 68 cosas: lectura y escritura
de `anon` sin clave, con clave mala y con la clave de cada campo; las excepciones de traslado; que `UPDATE`/`DELETE` de `eventos_sync`
sigan imposibles; que `private.*` siga cerrado; que el cierre corra dos veces; qué pasa al sacar a Pone Chico de `campos_abiertos`; y
que el deshacer deje políticas y permisos exactamente como estaban. **Encontró un error que habría frenado el cierre:** `= any ((select f()))`
Postgres lo lee como "ANY de una subconsulta" y falla con `operator does not exist: text = text[]` (el script abortaba entero, sin dejar nada
a medias); por eso las políticas llevan `= any ((select f())::text[])`. PGlite no es dependencia del repo (instrucciones en la cabecera de
`probar_cierre.js`). Límite conocido de `verificar_fase4.py --cierre`: con la llave pública no distingue una tabla de Pone Chico **vacía** de
una que quedó **cerrada** (hoy `stock_potreros`, `sanidad_carga_pone_chico`, `sanidad_ultimos` y `sanidad_proximos` de Pone Chico no tienen
filas); eso lo cubre `probar_cierre.js`, no el verificador.

**Ampliado el 27/10/2026:** el cierre también cubre `sanidad_proximos_hechos` (tablero, "Ya se hizo") y las políticas de `storage.objects` del
bucket `fotos-reportes` (subir y ver solo dentro de la carpeta de un campo con clave válida o abierto; sin UPDATE ni DELETE). Frena si faltan la tabla
(`scripts/sanidad/proximos_hechos.sql`) o el bucket (`fotos_reportes.sql`). `probar_cierre.js` ahora hace 78 verificaciones (con un `storage` de juguete)
y se puso en rojo al mutar la política de fotos. No cubre `comprobantes`, `proveedores`, `cotizaciones`, `precios_vet` ni `alias_productos` (de otros proyectos).

Qué queda abierto aun con la clave, a propósito: quien tiene la clave de un campo puede escribir en
su stream (la clave es una sola por campo, compartida con el empleado de Campo), y quien tiene la de
La Vuelta puede escribir el espejo de un traslado en el stream de María Laura (es lo que permite el
traslado entre campos). Si se filtra una clave, se cambia con `private.cargar_clave` y cada equipo
pide la nueva.

## Bucket `fotos-reportes` (fotos de los reportes, 24/10/2026)

`fotos_reportes.sql` crea el bucket privado y las políticas de `storage.objects` (INSERT y SELECT
para `anon`, solo dentro de las carpetas `la_vuelta`, `maria_laura`, `pone_chico`). Corre **antes**
de publicar la app que sube fotos. **El cierre de la Fase 4 tiene que sumar este bucket**: en
`fase4_cierre.sql` las políticas de `storage.objects` de `fotos-reportes` deben exigir
`establecimientos_con_clave()` (y `establecimientos_permitidos()` para Pone Chico, que sigue abierto),
igual que las de las tablas. (Hecho el 27/10/2026 en `fase4_cierre.sql`.)
