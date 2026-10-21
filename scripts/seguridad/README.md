# Seguridad de la base (auditoría del 9/10/2026)

Esta carpeta guarda los cambios de permisos de Supabase de la auditoría. El repositorio es
público y la llave `anon` está dentro de cada app, así que **lo que `anon` puede hacer lo puede
hacer cualquiera**. Cada fase tiene su SQL, su vuelta atrás y una verificación.

| Fase | Qué cierra | Archivos |
|---|---|---|
| 2 | Escritura anónima en `productos_catalogo`, `animales_caravana`, `sanidad_ultimos`, `sanidad_proximos`; `creado_en` de `eventos_sync` lo fija el servidor | `fase2_carencia.sql`, `fase2_carencia_deshacer.sql`, `verificar_fase2.py` |
| 4 | Clave del campo: eventos falsos con la llave pública y lectura del padrón y los datos comerciales (en dos releases, ver abajo) | `fase4_clave_campo.sql`, `fase4_clave_campo_deshacer.sql`, `fase4_cierre.sql`, `fase4_cierre_deshacer.sql`, `verificar_fase4.py`; pruebas sin tocar Supabase: `probar_cierre.js` (el SQL contra un Postgres real) y `probar_verificar_fase4.py` |

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
-- (sin Pone Chico: no usa clave, sus equipos figuran con_clave = false para siempre y no cuentan)
select establecimiento, usuario, dispositivo, version, ultima
from private.equipos_vistos
where not con_clave and ultima > now() - interval '30 days'
  and establecimiento <> 'pone_chico'
order by establecimiento, ultima desc;
```

Un equipo que se reinició ("Restablecer datos de fábrica") o que ya no se usa queda con una
`ultima` vieja y no cuenta. Un equipo con la app vieja sin la clave sigue figurando
`con_clave = false` hasta que la actualice y la cargue. La versión (`v`) aparece desde la
Fase 3, paso 4 (11/10/2026).

### Release 2, el cierre: cuándo correrlo

**No correr `fase4_cierre.sql` hasta que se cumplan las tres cosas:**

> **Pone Chico no usa clave (17/10/2026, a pedido de Pedro) y el cierre lo deja abierto a propósito (21/10/2026).**
> `CONFIG.claveCampo` es `false` en sus 3 apps, que no mandan `x-clave-campo`. Con las políticas "solo con clave" quedaría
> sin poder leer ni escribir, así que `fase4_cierre.sql` crea `public.establecimientos_autorizados()` (los campos cuya clave
> trae el pedido **más** `pone_chico`) y la usa solo en las filas propias de ese campo: su stream de `eventos_sync`, su
> `stock_potreros` y `sanidad_carga_pone_chico`. Lo que **no** se abre: `productos_catalogo` (costos por dosis) y
> `maestros_dicose` (compradores y proveedores con su DICOSE) siguen pidiendo la clave de algún campo, porque no tienen
> columna de campo y abrirlos sería abrirlos para cualquiera; una app de Pone Chico sin clave ve esas dos listas vacías
> (el selector de productos queda solo con "Otro"). Tampoco se abre el espejo de un traslado (Pone Chico no hace traslados),
> ni `sanidad_carga` ni `animales_caravana`. Hoy Pone Chico tiene 9 eventos de prueba y nada más, así que lo abierto no
> expone datos reales.
>
> **Para ponerle clave a Pone Chico más adelante:** `create or replace` de `establecimientos_autorizados()` con
> `array[]::text[]` en lugar de `array['pone_chico']::text[]`, `claveCampo: true` en `template/configs/pone-chico.js`, vaciar
> `ABIERTAS_CAMPO_ABIERTO` en `verificar_fase4.py`, sacar el `and establecimiento <> 'pone_chico'` de la consulta de arriba, y que
> cada equipo cargue la clave (la de `pone_chico` ya está cargada en `private.claves_campo`).

1. la segunda consulta de arriba devuelve **0 filas** (todos los equipos activos de La Vuelta y María Laura ya mandan la clave);
2. **los scripts de la PC que usan la llave pública ya usan la clave privada**
   (`SUPABASE_SECRET_KEY`): `pasar_traslados_a_excel.py`, `sanidad_puente.py`,
   `bajar_sanidad_de_potreros.py`, `regenerar_stock_potreros_excel.py` y `vigilar_tareas_sanidad.py`.
   **Hecho el 13/10/2026 y verificado el 21/10/2026** (sus pruebas dan "Todo OK" y una lectura real con la clave da 200).
   El informe de nacimientos (`enviar_informe_nacimientos.py`, abre la app con Playwright) necesita
   además la clave del campo en el `localStorage` de su navegador (`clave_campo_la_vuelta`).
   El keep-alive de GitHub sigue andando: contesta 200 con lista vacía.
3. **el Tablero de Sanidad (`tablero-sanidad/`, 16/10/2026) tiene la clave del campo.** Lee con la llave pública
   `sanidad_proximos`, `sanidad_ultimos`, `stock_potreros`, `animales_caravana` y `sanidad_carga*`; el cierre deja
   `sanidad_ultimos` y `sanidad_proximos` sin política para `anon` ("ninguna app las lee" ya no es cierto) y pide la
   clave en las demás, así que **sin este paso el tablero queda sin datos**. Hay que decidir cómo se leen
   `sanidad_ultimos`/`sanidad_proximos` con clave (política por establecimiento, como `animales_caravana`) y agregarle
   la ventana de clave; el aviso rojo del tablero ("la PC no publica hace más de 6 h") no distingue clave mala de falta de datos.

Después: correr el SQL (guarda las políticas de antes en `auditoria_politicas_antes_fase4`),
`python scripts/seguridad/verificar_fase4.py --cierre` (sin clave todo cerrado salvo las filas de Pone Chico, con la clave
anda; si `SUPABASE_SECRET_KEY` está en `~/.potreros/.env` además distingue "tabla de Pone Chico vacía" de "quedó cerrada"),
y probar a mano un movimiento y un traslado La Vuelta → María Laura. Para volver atrás:
`fase4_cierre_deshacer.sql`.

**Cómo se probó el SQL del cierre (21/10/2026).** `fase4_cierre.sql` no se estrenó en producción: `probar_cierre.js` lo corre
contra un Postgres 16 real (PGlite, en WASM) con las tablas y las políticas de hoy, el release 1 de verdad y claves de juguete,
y prueba 54 cosas (lectura y escritura de `anon` sin clave, con clave mala y con la clave de cada campo; las excepciones de
traslado; que `UPDATE`/`DELETE` de `eventos_sync` sigan imposibles; que el cierre corra dos veces; y que el deshacer deje las
políticas y los permisos exactamente como estaban). Encontró un error que habría frenado el cierre: `= any ((select f()))`
Postgres lo lee como "ANY de una subconsulta" y falla con `operator does not exist: text = text[]`; por eso las políticas usan
`= any ((select f())::text[])`. PGlite no es dependencia del repo (instrucciones en la cabecera de `probar_cierre.js`).
`probar_verificar_fase4.py` prueba el verificador contra un servidor simulado.

Qué queda abierto aun con la clave, a propósito: quien tiene la clave de un campo puede escribir en
su stream (la clave es una sola por campo, compartida con el empleado de Campo), y quien tiene la de
La Vuelta puede escribir el espejo de un traslado en el stream de María Laura (es lo que permite el
traslado entre campos). Si se filtra una clave, se cambia con `private.cargar_clave` y cada equipo
pide la nueva.
