"""Simulacro de restauracion del backup de Supabase, contra un proyecto de PRUEBA.

Un backup que nunca se restauro es una esperanza, no un backup. Este script carga una carpeta de
backup_supabase.py en OTRO proyecto de Supabase (gratis, aparte del real) y compara que quedo
todo. NUNCA escribe en el proyecto real: se niega si el destino es el de produccion.

Una vez, para preparar el proyecto de prueba (lo crea Pedro en supabase.com, plan gratis):
  1. Poner en ~/.potreros/.env (fuera del repo; NO se pega en ningun chat):
         SUPABASE_RESTORE_URL=https://<ref-del-proyecto-de-prueba>.supabase.co
         SUPABASE_RESTORE_SECRET_KEY=sb_secret_...        (Project Settings > API Keys)
  2. python restaurar_backup.py esquema --salida esquema_restauracion.sql
     (lee el OpenAPI del proyecto REAL con la clave privada y escribe el SQL de las tablas)
  3. Pegar ese SQL en el SQL Editor del proyecto de PRUEBA y correrlo.

Cada simulacro:
  python restaurar_backup.py cargar --carpeta "<destino>\\2026-10-10_1230"
     verifica el sha256 de cada archivo contra el manifest, los sube de a 500 filas y compara
     las filas de cada tabla (y los event_id de eventos_sync, uno por uno) con el manifest.
  python restaurar_backup.py verificar --carpeta ...     solo compara, sin cargar

Para repetirlo: correr el esquema con --con-drop (borra y recrea las tablas del proyecto de prueba).
Exit 0 = restauracion verificada, 1 = algo no coincide / no se pudo cargar, 2 = destino no valido.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backup_supabase as B  # noqa: E402

VARIABLE_URL = "SUPABASE_RESTORE_URL"
VARIABLE_CLAVE = "SUPABASE_RESTORE_SECRET_KEY"
LOTE = 500
TIPOS_SQL = {"text", "uuid", "jsonb", "integer", "bigint", "numeric", "boolean", "date",
             "timestamp with time zone", "name[]", "text[]"}


# --------------------------------------------------------------------------------------------
#  Destino
# --------------------------------------------------------------------------------------------
def _destino():
    """(url, clave, problema). Solo del entorno o de ~/.potreros/.env; nunca de la linea de comandos."""
    cfg = B._leer_env(B.ARCHIVO_ENV)
    url = (os.environ.get(VARIABLE_URL) or cfg.get(VARIABLE_URL, "")).strip().rstrip("/")
    clave = (os.environ.get(VARIABLE_CLAVE) or cfg.get(VARIABLE_CLAVE, "")).strip()
    if not url or not clave:
        return None, None, (f"falta {VARIABLE_URL} y/o {VARIABLE_CLAVE} en {B.ARCHIVO_ENV} "
                            "(el proyecto de PRUEBA, no el real)")
    return url, clave, ""


def validar_destino(url, clave):
    """Texto con el problema, o '' si el destino es un proyecto de prueba valido."""
    real = urllib.parse.urlparse(B.SUPA_URL).netloc
    host = urllib.parse.urlparse(url).netloc
    ref_real = real.split(".")[0]
    if host == real or ref_real in url:
        return "ese es el proyecto REAL de produccion: la restauracion solo va a un proyecto de prueba"
    local = host.startswith("127.0.0.1") or host.startswith("localhost")
    if not local and not (url.startswith("https://") and host.endswith(".supabase.co")):
        return "la URL del proyecto de prueba tiene que ser https://<ref>.supabase.co"
    if clave.startswith("sb_publishable_"):
        return "esa es una clave PUBLICA: hace falta la secret del proyecto de prueba"
    return ""


# --------------------------------------------------------------------------------------------
#  Esquema
# --------------------------------------------------------------------------------------------
def _sql_default(valor):
    if valor is None:
        return None
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return str(valor)
    s = str(valor)
    if "nextval" in s:
        return None
    if "(" in s or s.lower() in ("true", "false", "null") or re.match(r"^'.*'(::[a-z ]+)?$", s):
        return s                                   # funcion (now(), gen_random_uuid()) o literal ya con comillas
    return "'" + s.replace("'", "''") + "'"


def ddl_desde_openapi(doc, con_drop=False):
    """SQL para crear en el proyecto de prueba las mismas tablas (columnas, tipos, NOT NULL, defaults
    simples, clave primaria). No copia politicas ni triggers: para un simulacro de DATOS no hacen falta
    (la clave privada los saltea) y las tablas quedan con RLS activado y sin politicas, o sea cerradas."""
    partes = ["-- Esquema para el simulacro de restauracion (generado por restaurar_backup.py).",
              "-- Correr en el SQL Editor del proyecto de PRUEBA, nunca en el real.", ""]
    for tabla in sorted(doc.get("definitions") or {}):
        if tabla in B.VISTAS:
            continue
        d = doc["definitions"][tabla]
        requeridas = set(d.get("required") or [])
        cols, pk = [], []
        for col, p in (d.get("properties") or {}).items():
            tipo = p.get("format") or "text"
            if tipo not in TIPOS_SQL:
                tipo = "text"
            linea = f'  "{col}" {tipo}'
            if col in requeridas:
                linea += " not null"
            por_defecto = _sql_default(p.get("default"))
            if por_defecto is not None:
                linea += f" default {por_defecto}"
            cols.append(linea)
            if "<pk/>" in (p.get("description") or ""):
                pk.append(f'"{col}"')
        if pk:
            cols.append(f"  primary key ({', '.join(pk)})")
        if tabla == "eventos_sync" and "event_id" in (d.get("properties") or {}):
            cols.append("  unique (event_id)")        # el OpenAPI no muestra los UNIQUE; la app depende de este
        if con_drop:
            partes.append(f'drop table if exists public."{tabla}" cascade;')
        partes.append(f'create table if not exists public."{tabla}" (\n' + ",\n".join(cols) + "\n);")
        partes.append(f'alter table public."{tabla}" enable row level security;')
        partes.append("")
    return "\n".join(partes)


# --------------------------------------------------------------------------------------------
#  Carga y verificacion
# --------------------------------------------------------------------------------------------
def _pedir(metodo, url, clave, cuerpo=None, extra=None):
    cab = {"apikey": clave, "Authorization": f"Bearer {clave}"}
    cab.update(extra or {})
    datos = None
    if cuerpo is not None:
        datos = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        cab["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=datos, method=metodo, headers=cab)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            crudo = r.read().decode("utf-8")
            return r.status, (json.loads(crudo) if crudo.strip() else None), r.headers.get("Content-Range", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300], ""


def contar(base, clave, tabla):
    """Filas de la tabla en el destino (Content-Range), o (None, motivo)."""
    st, cuerpo, rango = _pedir("GET", f"{base}/rest/v1/{tabla}?select=*&limit=1", clave, extra={"Prefer": "count=exact"})
    if st != 200:
        return None, f"HTTP {st}: {cuerpo}"
    m = re.search(r"/(\d+)$", rango or "")
    return (int(m.group(1)), "") if m else (None, "sin Content-Range")


def ids_destino(base, clave, tabla, columna):
    """Conjunto de valores de `columna` en el destino (paginado de a 1000)."""
    vistos, desde = set(), 0
    while True:
        q = urllib.parse.urlencode({"select": columna, "order": columna + ".asc", "limit": 1000, "offset": desde})
        st, cuerpo, _ = _pedir("GET", f"{base}/rest/v1/{tabla}?{q}", clave)
        if st != 200:
            raise RuntimeError(f"HTTP {st}: {cuerpo}")
        vistos.update(f[columna] for f in cuerpo)
        if len(cuerpo) < 1000:
            return vistos
        desde += 1000


def restaurar(carpeta, base, clave, cargar=True, imprimir=print):
    """Devuelve la lista de problemas (vacia = restauracion verificada)."""
    problemas = []
    try:
        with open(os.path.join(carpeta, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as e:
        return [f"no puedo leer el manifest de {carpeta}: {e}"]
    imprimir(f"Backup {os.path.basename(os.path.normpath(carpeta))}: {len(manifest.get('tablas', {}))} tablas, "
             f"clave {manifest.get('clave', '?')}, lista {manifest.get('tablas_origen', '?')}")
    if manifest.get("clave") == "publica":
        problemas.append("ese backup se hizo con la llave publica: puede estar incompleto")

    for tabla, info in sorted(manifest.get("tablas", {}).items()):
        if "error" in info:
            problemas.append(f"{tabla}: el backup no pudo leerla ({info['error'][:80]})")
            continue
        esperadas = info["filas"]
        ruta = os.path.join(carpeta, tabla + ".json")
        try:
            crudo = open(ruta, "rb").read()
        except OSError as e:
            problemas.append(f"{tabla}: falta el archivo ({e})")
            continue
        if hashlib.sha256(crudo).hexdigest() != info.get("sha256"):
            problemas.append(f"{tabla}: el archivo NO coincide con el sha256 del manifest (backup danado)")
            continue
        filas = json.loads(crudo.decode("utf-8"))
        if len(filas) != esperadas:
            problemas.append(f"{tabla}: el manifest dice {esperadas} filas y el archivo tiene {len(filas)}")
            continue

        if cargar:
            antes, motivo = contar(base, clave, tabla)
            if antes is None:
                problemas.append(f"{tabla}: no existe en el proyecto de prueba ({motivo}); corre el SQL del esquema")
                continue
            if antes:
                problemas.append(f"{tabla}: el proyecto de prueba ya tiene {antes} filas; correr el esquema con --con-drop")
                continue
            fallo = None
            for i in range(0, len(filas), LOTE):
                st, cuerpo, _ = _pedir("POST", f"{base}/rest/v1/{tabla}", clave, filas[i:i + LOTE],
                                       {"Prefer": "return=minimal"})
                if st not in (200, 201, 204):
                    fallo = f"HTTP {st} en el lote {i // LOTE + 1}: {cuerpo}"
                    break
            if fallo:
                problemas.append(f"{tabla}: {fallo}")
                continue

        n, motivo = contar(base, clave, tabla)
        if n is None:
            problemas.append(f"{tabla}: no pude contar en el destino ({motivo})")
        elif n != esperadas:
            problemas.append(f"{tabla}: el backup tiene {esperadas} filas y el destino {n}")
        else:
            extra = ""
            if tabla == "eventos_sync":
                try:
                    en_backup = {f.get("event_id") for f in filas}
                    en_destino = ids_destino(base, clave, tabla, "event_id")
                    if en_backup != en_destino:
                        problemas.append(f"{tabla}: los event_id no coinciden (faltan {len(en_backup - en_destino)}, "
                                         f"sobran {len(en_destino - en_backup)})")
                        extra = "  <-- event_id NO coinciden"
                    else:
                        extra = f"  (los {len(en_backup)} event_id coinciden uno por uno)"
                except Exception as e:
                    problemas.append(f"{tabla}: no pude comparar los event_id: {e}")
            imprimir(f"  {tabla}: {n} filas {'cargadas y ' if cargar else ''}verificadas{extra}")
    return problemas


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="orden", required=True)
    e = sub.add_parser("esquema", help="escribe el SQL de las tablas para el proyecto de prueba")
    e.add_argument("--salida", default="esquema_restauracion.sql")
    e.add_argument("--con-drop", action="store_true", help="borra y recrea las tablas (para repetir el simulacro)")
    c = sub.add_parser("cargar", help="carga una carpeta de backup en el proyecto de prueba y la verifica")
    c.add_argument("--carpeta", required=True)
    v = sub.add_parser("verificar", help="solo compara una carpeta de backup con el proyecto de prueba")
    v.add_argument("--carpeta", required=True)
    args = ap.parse_args(argv)

    if args.orden == "esquema":
        clave, problema = B._clave_privada()
        if not clave:
            print("ERROR:", problema)
            return 1
        try:
            doc, _ = B.pedir(f"{B.SUPA_URL}/rest/v1/", clave, aceptar="application/openapi+json")
        except Exception as ex:
            print("ERROR leyendo el OpenAPI:", ex)
            return 1
        sql = ddl_desde_openapi(doc, args.con_drop)
        with open(args.salida, "w", encoding="utf-8") as f:
            f.write(sql)
        n = sql.count("create table")
        print(f"Esquema de {n} tablas escrito en {args.salida}. Pegarlo en el SQL Editor del proyecto de PRUEBA.")
        return 0

    url, clave, problema = _destino()
    if not url:
        print("ERROR:", problema)
        return 2
    invalido = validar_destino(url, clave)
    if invalido:
        print("ERROR:", invalido)
        return 2
    problemas = restaurar(args.carpeta, url, clave, cargar=(args.orden == "cargar"))
    if problemas:
        print("\nNO SE PUDO VERIFICAR LA RESTAURACION:")
        for p in problemas:
            print("  -", p)
        return 1
    print("\nRESTAURACION VERIFICADA: cada tabla del backup quedo completa en el proyecto de prueba.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
