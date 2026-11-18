# `actualizar_sanidad_supabase.py`

**Desde el 18/11/2026 la copia que corre es la del repo** (a pedido de Pedro): la tarea programada de Windows (Task
Scheduler, cada hora) apunta a

```
C:\Users\Pedro\repos\potreros\scripts\sanidad\actualizar_sanidad_supabase.py
```

así cada `git pull` en `main` deja corriendo la versión revisada y probada en el CI, sin copiar archivos a mano. Los
`.xlsx` que lee siguen en OneDrive (`CARPETA`) y el log sigue en `Sanidad\Automatizacion\actualizar_sanidad_supabase.log`
(o donde diga la variable `SANIDAD_LOG`), no adentro del repo. Condición: la carpeta del repo en la PC queda en la rama
`main` (si una sesión de trabajo cambia de rama ahí, la tarea corre esa rama).

Hasta el 18/11/2026 corría la copia de OneDrive
(`...\Sanidad\Automatizacion\actualizar_sanidad_supabase.py`) y esta era solo historial. Esa copia queda sin uso: se
puede renombrar a `.viejo`.

### Pasar la tarea programada a la copia del repo (una sola vez, en PowerShell)

1. Ver qué corre hoy la tarea (no cambia nada):
   ```powershell
   $t = Get-ScheduledTask | Where-Object { ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -match 'actualizar_sanidad_supabase' }
   $t | Select-Object TaskName, TaskPath, @{n='Programa';e={$_.Actions[0].Execute}}, @{n='Argumentos';e={$_.Actions[0].Arguments}}
   ```
2. Si `Programa` es Python (`python.exe` / `pythonw.exe`) y `Argumentos` es la ruta del `.py` de OneDrive, cambiarla:
   ```powershell
   $a = $t.Actions[0]
   $nueva = New-ScheduledTaskAction -Execute $a.Execute -Argument '"C:\Users\Pedro\repos\potreros\scripts\sanidad\actualizar_sanidad_supabase.py"' -WorkingDirectory 'C:\Users\Pedro\repos\potreros\scripts\sanidad'
   Set-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Action $nueva
   Start-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath
   ```
   (si la tarea corre un `.bat` u otra cosa, no cambiar: mirar primero qué hace.)
3. Mirar el final del log: tiene que aparecer una corrida nueva sin `ERROR`.

### Categorías unificadas (18/11/2026)

Al publicar Próximos y Últimos traduce cada categoría al patrón (las 24 de la app) con `public.categorias_alias`
(`scripts/categorias/`). En Próximos, si dos filas quedan con la misma categoría y sanidad (p. ej. "Vaca" y "Vacas" con
Garrapata) queda la del tratamiento más nuevo: así los vencimientos con nombre viejo se cierran solos. Sin la tabla, o
sin poder leerla, publica como antes sin traducir y deja un `AVISO` en el log. Prueba:
`scripts/sanidad/probar_unificar_categorias.py` (en el CI).

Publica el catálogo compartido de productos (`productos_catalogo`, leído
directo de la hoja "Costo productos" del Excel de La Vuelta) y los paneles
de solo lectura `sanidad_proximos`/`sanidad_ultimos`, a partir de los
`.xlsx` que la Planilla Sanitaria ya exporta.

## Qué clave de Supabase usa cada script de la PC (13/10/2026, Fase 4)

Desde el 13/10/2026 los scripts de la PC que hablan con Supabase usan la **clave privada**
(`SUPABASE_SECRET_KEY`: variable de entorno o línea en `~/.potreros/.env`, fuera del repo y de OneDrive),
porque la Fase 4 cierra la lectura y escritura anónimas. Mandan solo `apikey: <clave>`; una `sb_secret_...`
no va como `Authorization: Bearer`. Sin la clave, cada uno avisa "falta SUPABASE_SECRET_KEY en
~/.potreros/.env" y no manda nada.

| Script (en OneDrive) | Qué hace en Supabase | Sin la clave privada |
|---|---|---|
| `Ganaderia\Macros & phyton\pasar_traslados_a_excel.py` | lee `eventos_sync` (y sube a `movimientos_dicose`) | sale con código 2 antes de abrir Excel |
| `Lector XRS2\sanidad_puente.py` | lee `productos_catalogo`, escribe `sanidad_carga` | `enviar()` devuelve el error, no manda nada |
| `Lector XRS2\publicar_animales.py` | escribe `animales_caravana` | no publica (Fase 2) |
| `Sanidad\Automatizacion\bajar_sanidad_de_potreros.py` | lee y marca `sanidad_carga` | log + código 1 |
| `Sanidad\Automatizacion\actualizar_sanidad_supabase.py` | escribe catálogo, `sanidad_ultimos`, `sanidad_proximos` | no sube (Fase 2) |
| `Sanidad\regenerar_stock_potreros_excel.py` | lee `stock_potreros` | mensaje + código 1, no toca el Excel |
| `Sanidad\Automatizacion\vigilar_tareas_sanidad.py` | lee `sanidad_carga` | cae a la pública solo como respaldo y lo avisa como problema |
| `Proyecto Gestion ganadera\Automatizacion\mantener_supabase_activo.py` | lee 1 fila de `eventos_sync` | cae a la pública como respaldo, AVISO en el log |
| `scripts\backup\backup_supabase.py` | lee todas las tablas | termina con código 1 (Fase 5) |

`enviar_informe_nacimientos.py` no usa Supabase directamente: abre las apps PC en un navegador y, si están
`CLAVE_CAMPO_LA_VUELTA` / `CLAVE_CAMPO_MARIA_LAURA` en el mismo `.env`, deja esa clave del campo en el
`localStorage` (`clave_campo_la_vuelta` / `clave_campo_maria_laura`) antes de cargar la página.
`scripts\seguridad\verificar_fase2.py` usa la llave pública a propósito (prueba lo que `anon` NO puede hacer).

## `cargar_sanidad_csv.py` — cargar tratamientos desde un CSV hecho a mano (18/10/2026)

Para unos pocos tratamientos que **no vienen del bastón** (no pasan por `Entrada\` del Lector XRS2) y que no se
quieren tipear uno por uno en "+ Cargar tratamiento". Cada fila termina como una fila de la tabla de Sanidad
del establecimiento, la misma que escribe la app. **Corre en la PC** (necesita la clave privada de Supabase en
`~/.potreros/.env`, igual que los demás scripts de esta carpeta); en Windows PowerShell, desde la carpeta del repo:

```powershell
cd C:\Users\Pedro\repos\potreros\scripts\sanidad
python cargar_sanidad_csv.py C:\ruta\a\mis_sanidades.csv              # SIMULA: valida y lista, no escribe
python cargar_sanidad_csv.py C:\ruta\a\mis_sanidades.csv --aplicar    # recién ahí inserta y verifica
python cargar_sanidad_csv.py C:\ruta\a\mis_sanidades.csv --establecimiento maria_laura
```

- Columnas (el orden no importa; sin tildes/mayúsculas/espacios da igual): **obligatorias** `fecha, categoria, potrero,
  cantidad, producto1, dosis1` (+ `dueno` en María Laura / Pone Chico); **opcionales** `gen` (último dígito del año de
  nacimiento: 5 = 2025), `producto2`, `dosis2`, `observaciones`. Ver `sanidad_nuevas.ejemplo.csv`.
- Separador `;` o `,` (se detecta), decimales con coma o punto, fecha `AAAA-MM-DD` o `DD/MM/AAAA`.
- **Todo o nada**: una sola fila con error y no se carga ninguna, ni con `--aplicar`. El **producto** se valida contra
  `productos_catalogo` y se guarda con el nombre exacto del catálogo; si no existe no se carga (te sugiere los parecidos):
  un producto mal escrito calcularía una carencia equivocada.
- **Idempotente**: el id (`csv_…`) sale del contenido de la fila (sin las observaciones) y el insert ignora los que ya
  existen: correrlo dos veces no duplica. Dos filas idénticas en el mismo archivo se cargan como dos.
- La Vuelta: queda en `sanidad_carga` con `importado_en` vacío, así que la pantalla Sanidad de la app la ve al instante y
  `bajar_sanidad_de_potreros.py` (cada hora) la lleva a la Planilla Sanitaria. Prueba: `probar_cargar_sanidad_csv.py`
  (servidor falso, corre en el CI; no toca Supabase).


## `proximos_hechos.sql` — "Ya se hizo" en el tablero de Sanidad (21/10/2026)

Crea `sanidad_proximos_hechos`, donde el tablero (`tablero-sanidad/`) guarda los vencimientos de Próximos que ya se
hicieron para ocultarlos en todos los equipos (la Planilla regenera `sanidad_proximos` cada hora, así que borrar ahí no
sirve). Correrlo **una vez** en el SQL Editor de Supabase; es transaccional e idempotente y al final muestra `rls = true`
y las 3 políticas (SELECT, INSERT, DELETE para `anon`). Se deshace con `proximos_hechos_deshacer.sql`. Sin la tabla el
tablero anda igual, sin el botón.
