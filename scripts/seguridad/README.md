# Seguridad de la base (auditoría del 9/10/2026)

Esta carpeta guarda los cambios de permisos de Supabase de la auditoría. El repositorio es
público y la llave `anon` está dentro de cada app, así que **lo que `anon` puede hacer lo puede
hacer cualquiera**. Cada fase tiene su SQL, su vuelta atrás y una verificación.

| Fase | Qué cierra | Archivos |
|---|---|---|
| 2 | Escritura anónima en `productos_catalogo`, `animales_caravana`, `sanidad_ultimos`, `sanidad_proximos`; `creado_en` de `eventos_sync` lo fija el servidor | `fase2_carencia.sql`, `fase2_carencia_deshacer.sql`, `verificar_fase2.py` |

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
