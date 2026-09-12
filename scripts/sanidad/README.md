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
