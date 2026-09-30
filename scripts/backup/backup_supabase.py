"""Backup de las tablas de Supabase de las apps de potreros.

Solo LEE (GET) con la clave publica (la misma que ya esta en las apps y en
scripts/sanidad/*.py) -- no escribe ni borra nada en Supabase. Guarda una
carpeta por corrida, FUERA del repo (los datos son reales, el repo es publico):

    <destino>/AAAA-MM-DD_HHMM/<tabla>.json   una lista de filas por tabla
    <destino>/AAAA-MM-DD_HHMM/manifest.json  filas y sha256 de cada archivo
    <destino>/backup.log                     una linea por corrida

Alerta (exit 2): si una tabla perdio mas del 10% de sus filas respecto del
backup anterior, o eventos_sync quedo vacia. Es la senal de que alguien
borro datos -- el backup nuevo se guarda igual, y el anterior NO se pisa ni
se borra (la limpieza de viejos nunca toca los 3 mas recientes).

Exit 0 = todo bien, 1 = alguna tabla no se pudo leer, 2 = alerta de borrado.

Uso:
    python backup_supabase.py                      # destino por defecto (OneDrive)
    python backup_supabase.py --destino D:\\backups --conservar 60
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SUPA_URL = "https://skkknfjpwcstefcroqjt.supabase.co"
SUPA_KEY = "sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"  # publica, igual que en las apps

DESTINO_DEFECTO = r"C:\Users\Pedro\OneDrive\Proyecto Gestion ganadera\backups_supabase"

# tabla -> columnas para ordenar (paginacion estable). None = orden por defecto
# del servidor; en ese caso el total se verifica contra Content-Range.
TABLAS = {
    "eventos_sync": "creado_en.asc,id.asc",
    "stock_potreros": None,
    "sanidad_carga": None,
    "sanidad_carga_maria_laura": None,
    "sanidad_carga_pone_chico": None,
    "sanidad_ultimos": None,
    "sanidad_proximos": None,
    "productos_catalogo": None,
    "animales_caravana": None,
}

PAGINA = 1000
UMBRAL_CAIDA = 0.10
PATRON_CARPETA = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}$")


def pedir(url, reintentos=3):
    """GET con reintentos. Devuelve (cuerpo_json, content_range)."""
    ultimo = None
    for intento in range(reintentos):
        req = urllib.request.Request(url, headers={
            "apikey": SUPA_KEY,
            "Authorization": f"Bearer {SUPA_KEY}",
            "Prefer": "count=exact",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8")), r.headers.get("Content-Range", "")
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode("utf-8", "replace")[:300]
            ultimo = f"HTTP {e.code}: {cuerpo}"
            if e.code in (400, 401, 403, 404):  # no se arregla reintentando
                break
        except Exception as e:  # red caida, timeout
            ultimo = str(e)
        time.sleep(2 * (intento + 1))
    raise RuntimeError(ultimo)


def bajar_tabla(tabla, orden, base=None):
    base = base or SUPA_URL
    filas, desde, total = [], 0, None
    while True:
        q = {"select": "*", "limit": PAGINA, "offset": desde}
        if orden:
            q["order"] = orden
        datos, rango = pedir(f"{base}/rest/v1/{tabla}?{urllib.parse.urlencode(q)}")
        filas.extend(datos)
        m = re.search(r"/(\d+)$", rango or "")
        if m:
            total = int(m.group(1))
        if len(datos) < PAGINA:
            break
        desde += PAGINA
    if total is not None and total != len(filas):
        raise RuntimeError(f"se esperaban {total} filas y se bajaron {len(filas)} (cambio la tabla a mitad de la descarga; reintentar)")
    return filas


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def carpetas_backup(destino):
    return sorted(d for d in os.listdir(destino)
                  if PATRON_CARPETA.match(d) and os.path.isdir(os.path.join(destino, d)))


def conteos_anteriores(destino, excluir):
    previas = [d for d in carpetas_backup(destino) if d != excluir]
    if not previas:
        return {}
    try:
        with open(os.path.join(destino, previas[-1], "manifest.json"), encoding="utf-8") as f:
            return {t: v.get("filas") for t, v in json.load(f).get("tablas", {}).items() if v.get("filas") is not None}
    except Exception:
        return {}


def main(argv=None, tablas=None, base=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--destino", default=DESTINO_DEFECTO)
    ap.add_argument("--conservar", type=int, default=30, help="cuantos backups conservar (minimo 3)")
    args = ap.parse_args(argv)
    tablas = tablas or TABLAS
    conservar = max(3, args.conservar)

    os.makedirs(args.destino, exist_ok=True)
    nombre = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    carpeta = os.path.join(args.destino, nombre)
    os.makedirs(carpeta, exist_ok=True)
    anteriores = conteos_anteriores(args.destino, nombre)

    manifest = {"creado": datetime.datetime.now().isoformat(timespec="seconds"), "supabase": SUPA_URL, "tablas": {}}
    errores, alertas = [], []

    for tabla, orden in tablas.items():
        try:
            filas = bajar_tabla(tabla, orden, base)
        except Exception as e:
            manifest["tablas"][tabla] = {"error": str(e)}
            errores.append(f"{tabla}: {e}")
            print(f"  ERROR {tabla}: {e}")
            continue
        ruta = os.path.join(carpeta, tabla + ".json")
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(filas, f, ensure_ascii=False, indent=1)
        manifest["tablas"][tabla] = {"filas": len(filas), "sha256": sha256(ruta)}
        antes = anteriores.get(tabla)
        marca = ""
        if antes and len(filas) < antes * (1 - UMBRAL_CAIDA):
            alertas.append(f"{tabla}: {antes} -> {len(filas)} filas")
            marca = "  <-- ALERTA: cayo mas del 10%"
        if tabla == "eventos_sync" and not filas:
            alertas.append("eventos_sync esta VACIA")
        print(f"  {tabla}: {len(filas)} filas{marca}")

    with open(os.path.join(carpeta, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    # Limpieza: solo carpetas con nombre de backup, y nunca las 3 mas recientes.
    # Si hubo alerta no se borra nada: los viejos pueden ser lo unico sano que queda.
    if not alertas:
        todas = carpetas_backup(args.destino)
        for viejo in todas[:-conservar]:
            shutil.rmtree(os.path.join(args.destino, viejo))

    estado = "ALERTA" if alertas else ("ERRORES" if errores else "OK")
    resumen = "; ".join(alertas + errores)
    with open(os.path.join(args.destino, "backup.log"), "a", encoding="utf-8") as f:
        f.write(f"{manifest['creado']} {estado} {nombre} {resumen}\n")
    print(f"{estado}: {carpeta}" + (f"\n  {resumen}" if resumen else ""))
    return 2 if alertas else (1 if errores else 0)


if __name__ == "__main__":
    sys.exit(main())
