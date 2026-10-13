# `actualizar_sanidad_supabase.py`

Copia de historial/backup. El archivo que de verdad corre es el de OneDrive,
vía una tarea programada de Windows (Task Scheduler) que corre por hora —
**editá siempre ese** y después copiá el cambio acá, nunca al revés:

```
C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Sanidad\Automatizacion\actualizar_sanidad_supabase.py
```

Publica el catálogo compartido de productos (`productos_catalogo`, leído
directo de la hoja "Costo productos" del Excel de La Vuelta) y los paneles
de solo lectura `sanidad_proximos`/`sanidad_ultimos`, a partir de los
`.xlsx` que la Planilla Sanitaria ya exporta. Nada de esto se ejecuta desde
este repo ni desde CI — la tarea programada apunta a la ruta de OneDrive de
arriba, no a esta carpeta. Este copia solo existe para tener historial con
`git log`/`git blame` de un script que, hasta el 12/9/2026, no estaba
versionado en ningún lado.

Para verificar que las dos copias coinciden:

```bash
diff "/c/Users/Pedro/OneDrive/A Registros PEDRO LANFRANCO CRESPO/Sanidad/Automatizacion/actualizar_sanidad_supabase.py" \
     "actualizar_sanidad_supabase.py"
```

Sin salida = coinciden.

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
