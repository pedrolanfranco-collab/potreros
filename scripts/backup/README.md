# Backup de Supabase

`backup_supabase.py` baja las 9 tablas del proyecto a una carpeta fechada
**fuera del repo** (`...\Proyecto Gestion ganadera\backups_supabase\AAAA-MM-DD_HHMM\`),
porque los datos son reales y este repo es público. Solo lee (GET) con la clave
pública; no escribe ni borra nada en Supabase. Sin dependencias (solo Python).

```
python scripts/backup/backup_supabase.py            # destino por defecto
python scripts/backup/backup_supabase.py --destino D:\backups --conservar 60
```

- `manifest.json` de cada carpeta: filas y sha256 por tabla.
- `backup.log` (en la carpeta de destino): una línea por corrida (`OK` / `ERRORES` / `ALERTA`).
- Exit code: 0 todo bien, 1 alguna tabla no se pudo leer, 2 **alerta de borrado**
  (una tabla perdió más del 10% de filas respecto del backup anterior, o
  `eventos_sync` quedó vacía). Con alerta no se borra ningún backup viejo.
- Conserva los últimos 30 (mínimo 3); los más viejos se borran solos.

## Tarea programada (diaria, Windows)

```
schtasks /Create /SC DAILY /ST 12:30 /TN "Backup Supabase potreros" /TR "\"<ruta a python.exe>\" \"C:\Users\Pedro\repos\potreros\scripts\backup\backup_supabase.py\""
```

Si la PC está apagada a esa hora, marcar "Ejecutar la tarea lo antes posible
si se omitió un inicio programado" en sus propiedades (Configuración).

## Restaurar

Cada `<tabla>.json` es una lista de filas tal como las devuelve la API. Para
restaurar una tabla: vaciarla (o dejarla) y cargar el JSON desde el panel de
Supabase (Table Editor → Insert → Import data from JSON/CSV) o con un `POST`
a `/rest/v1/<tabla>` con el arreglo de filas. **Probar una restauración en un
proyecto de prueba** antes de necesitarla de verdad. Ojo: hoy `sanidad_carga_maria_laura`
y `sanidad_carga_pone_chico` no tienen política de UPDATE/DELETE para `anon`
(ver CLAUDE.md), así que desde la clave pública solo se puede insertar.
