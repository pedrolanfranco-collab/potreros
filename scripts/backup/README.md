# Backup de Supabase

`backup_supabase.py` baja todas las tablas del proyecto a una carpeta fechada **fuera del
repo** (`...\Proyecto Gestion ganadera\backups_supabase\AAAA-MM-DD_HHMM\`), porque los datos
son reales y este repo es público. Solo lee (GET); no escribe ni borra nada en Supabase. Sin
dependencias (solo Python).

```
python scripts/backup/backup_supabase.py            # destino por defecto
python scripts/backup/backup_supabase.py --destino D:\backups --conservar 60
```

## Qué baja y con qué clave

Desde la Fase 5 de la auditoría (10/10/2026) lee con la **clave privada**
(`SUPABASE_SECRET_KEY`, variable de entorno o `~/.potreros/.env`, fuera del repo y de OneDrive):

- **Descubre las tablas solo**, desde el OpenAPI de `/rest/v1/` (que solo entrega a la clave
  privada). Una tabla nueva entra al backup sin tocar el script. Antes era una lista fija de 9 y
  `maestros_dicose` y `movimientos_dicose` quedaron afuera.
- **Sigue andando cuando la Fase 4 cierre la lectura anónima.** Con la llave pública el backup
  saldría vacío y parecería un borrado masivo.
- Las **vistas** (`VISTAS` en el script, hoy `movimientos_dicose_vigentes`) se saltean: son
  derivadas y su cantidad de filas baja con cada anulación.

Sin clave privada hace el backup como antes (llave pública y la lista fija) pero **termina con
código 1 y avisa**: ese backup solo tiene lo que ve la app.

## Resultado y avisos

- `manifest.json` de cada carpeta: filas y sha256 por tabla, qué clave se usó (`privada` /
  `publica`) y de dónde salió la lista (`openapi` / `fija`).
- `backup.log` (en la carpeta de destino): una línea por corrida (`OK` / `ERRORES` / `ALERTA`).
- Exit code: 0 todo bien, 1 alguna tabla no se pudo leer o falta la clave privada, 2 **alerta de
  borrado** (una tabla perdió más del 10% de filas respecto del backup anterior, una tabla del
  backup anterior ya no existe, o `eventos_sync` quedó vacía). Con alerta no se borra ningún
  backup viejo.
- Si el resultado no es `OK` sale una **notificación al celular por ntfy** (el tema es
  `NTFY_TOPIC`, de la variable de entorno, `~/.potreros/.env` o el `.env` de Lector XRS2). Solo
  viajan nombres de tablas y cantidades. Además lo ve `vigilar_tareas_sanidad.py`.
- Conserva los últimos 30 (mínimo 3); los más viejos se borran solos.

## Tarea programada (diaria, Windows)

```
schtasks /Create /SC DAILY /ST 12:30 /TN "Backup Supabase potreros" /TR "\"<ruta a python.exe>\" \"C:\Users\Pedro\repos\potreros\scripts\backup\backup_supabase.py\""
```

Si la PC está apagada a esa hora, marcar "Ejecutar la tarea lo antes posible si se omitió un
inicio programado" en sus propiedades (Configuración).

## Restaurar, y probar que se puede

Cada `<tabla>.json` es una lista de filas tal como las devuelve la API. **Un backup que nunca se
restauró es una esperanza**: `restaurar_backup.py` hace el simulacro contra un proyecto de
Supabase **de prueba** (gratis, aparte del real) y se niega a escribir en el de producción.

Una sola vez:

1. En supabase.com crear un proyecto gratis, por ejemplo `potreros-restauracion`.
2. En `~/.potreros/.env` (el mismo archivo de la clave privada; no va al chat ni al repo):

   ```
   SUPABASE_RESTORE_URL=https://<ref-del-proyecto-de-prueba>.supabase.co
   SUPABASE_RESTORE_SECRET_KEY=sb_secret_...
   ```
3. `python scripts/backup/restaurar_backup.py esquema --salida esquema_restauracion.sql`
   escribe el SQL de las 12 tablas (lo lee del OpenAPI del proyecto real). Pegarlo en el **SQL
   Editor del proyecto de prueba** y correrlo.

Cada simulacro:

```
python scripts/backup/restaurar_backup.py cargar --carpeta "...\backups_supabase\2026-10-10_1230"
```

Verifica el sha256 de cada archivo contra el manifest, lo sube de a 500 filas y compara las
filas de cada tabla y los `event_id` de `eventos_sync` uno por uno. Dice **RESTAURACION
VERIFICADA** o lista qué no coincide. Para repetirlo sobre las mismas tablas: correr el esquema
con `--con-drop`. `verificar` solo compara, sin cargar.

El esquema copia columnas, tipos, `NOT NULL`, defaults simples, claves primarias y el `UNIQUE`
de `eventos_sync.event_id`. No copia políticas ni triggers (para un simulacro de **datos** no
hacen falta). Si algún día hay que restaurar de verdad el proyecto real, las políticas salen de
los SQL de `scripts/seguridad/`, `scripts/dicose/` y `scripts/sanidad/`.

Ojo, restaurando en el real: `sanidad_carga_maria_laura` y `sanidad_carga_pone_chico` no tienen
política de UPDATE/DELETE para `anon` (ver CLAUDE.md), y desde la clave pública solo se puede
insertar; con la clave privada no hay ese límite.

## Pruebas

```
python scripts/backup/probar_backup.py       # contra un PostgREST falso, no toca la red
python scripts/backup/probar_restaurar.py
```

Corren en el CI (`.github/workflows/probar.yml`).
