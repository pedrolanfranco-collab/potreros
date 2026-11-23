# iPasto: crecimiento del pasto por potrero

`bajar_crecimiento.py` entra a iPasto (cédula y clave de Pedro), baja el último mes de tasa de crecimiento
de cada potrero de La Vuelta (sin Bajo 1, Bajo 5 y Claudia) y lo sube a la tabla `crecimiento_pasto` de
Supabase. Todos los días sube lo que iPasto trae (es idempotente: así entran los potreros que iPasto publica
tarde y las correcciones). Cuando el mes es más nuevo que el último guardado, avisa el promedio ponderado por
área. Si no sube un mes nuevo hace 45 días, avisa una vez. Las fallas avisan urgente una sola vez y salen con 1.

Avisos: ntfy (`NTFY_TOPIC`) y WhatsApp por Hermes. Estado: `~/.potreros/ipasto_estado.json`. Log: `~/.potreros/ipasto.log`.

## .env (`~/.potreros/.env`, o el de `POTREROS_ENV`)
- `IPASTO_USUARIO`: la cédula de Pedro.
- `IPASTO_CLAVE`: la clave de iPasto.
- `SUPABASE_SECRET_KEY`: la clave privada (secret / service_role). Nunca la pública.

## Primera carga
Después del merge a main:
```powershell
cd C:\Users\Pedro\repos\potreros
python scripts\ipasto\bajar_crecimiento.py --historia 2025-01 --simular
python scripts\ipasto\bajar_crecimiento.py --historia 2025-01
```
El primer comando solo muestra lo que subiría. El segundo lo sube.

## Instalar la tarea (una vez, en la PC)
Después del merge a main:
```powershell
cd C:\Users\Pedro\repos\potreros
powershell -ExecutionPolicy Bypass -File scripts\ipasto\instalar_tarea_ipasto.ps1
```
Corre todos los días a las 9:00. Estado: `Get-ScheduledTaskInfo -TaskName "iPasto - Vigilar crecimiento (potreros)"`.

## Pruebas
```powershell
python -I scripts\ipasto\probar_bajar_crecimiento.py
```
Usan iPasto y Supabase falsos: no tocan la red ni la base.

## Deshacer el SQL
`crecimiento_pasto_deshacer.sql` borra la tabla `crecimiento_pasto` (y sus datos; se pueden volver a bajar con `--historia`).
