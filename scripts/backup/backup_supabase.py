"""Backup de las tablas de Supabase de las apps de potreros.

Solo LEE (GET) -- no escribe ni borra nada en Supabase. Guarda una carpeta por corrida,
FUERA del repo (los datos son reales, el repo es publico):

    <destino>/AAAA-MM-DD_HHMM/<tabla>.json   una lista de filas por tabla
    <destino>/AAAA-MM-DD_HHMM/manifest.json  filas y sha256 de cada archivo
    <destino>/backup.log                     una linea por corrida

Clave (Fase 5 de la auditoria, 10/10/2026): lee con la clave PRIVADA (SUPABASE_SECRET_KEY, de
la variable de entorno o de ~/.potreros/.env, fuera del repo y de OneDrive) por dos razones:
  1. ve TODAS las tablas aunque las politicas de lectura de la llave publica se cierren
     (Fase 4, clave del campo): con la publica el backup saldria vacio y parecera un borrado;
  2. descubre solo las tablas desde el OpenAPI de /rest/v1/ (solo lo entrega a la clave
     privada), asi una tabla nueva entra al backup sin tocar este archivo.
Sin clave privada hace el backup como antes (la llave publica y la lista fija de tablas) pero
termina con codigo 1 y avisa: ese backup solo tiene lo que ve la app.

Alerta (exit 2): si una tabla perdio mas del 10% de sus filas respecto del backup anterior,
una tabla del backup anterior ya no existe, o eventos_sync quedo vacia. Es la senal de que
alguien borro datos -- el backup nuevo se guarda igual, y el anterior NO se pisa ni se borra
(la limpieza de viejos nunca toca los 3 mas recientes).

Aviso al celular: si el resultado no es OK sale una notificacion por ntfy (NTFY_TOPIC, en la
variable de entorno, ~/.potreros/.env o el .env de Lector XRS2). Solo viajan nombres de tablas
y cantidades de filas.

Exit 0 = todo bien, 1 = alguna tabla no se pudo leer / sin clave privada, 2 = alerta de borrado.

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
SUPA_KEY_PUBLICA = "sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"  # publica, igual que en las apps
SUPA_KEY = SUPA_KEY_PUBLICA  # nombre viejo, por si algo externo lo importa

VARIABLE_CLAVE = "SUPABASE_SECRET_KEY"
ARCHIVO_ENV = os.environ.get("POTREROS_ENV") or os.path.join(os.path.expanduser("~"), ".potreros", ".env")
ENV_XRS2 = r"C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Lector XRS2\.env"  # donde ya vive NTFY_TOPIC
NTFY_URL_DEFECTO = "https://ntfy.sh/"

DESTINO_DEFECTO = r"C:\Users\Pedro\OneDrive\Proyecto Gestion ganadera\backups_supabase"

# Lista fija: se usa solo si no se puede listar desde el OpenAPI (sin clave privada o la consulta
# fallo). tabla -> columnas para ordenar (paginacion estable). None = orden por defecto del
# servidor; en ese caso el total se verifica contra Content-Range.
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
ORDEN = {"eventos_sync": "creado_en.asc,id.asc"}
# Vistas: el OpenAPI las lista igual que las tablas, pero son derivadas (y una anulacion baja sus
# filas, que dispararia una falsa alerta de borrado). Una vista nueva que no se agregue aca se
# respalda como si fuera una tabla: no pasa nada grave, solo duplica datos.
VISTAS = {"movimientos_dicose_vigentes"}

PAGINA = 1000
UMBRAL_CAIDA = 0.10
PATRON_CARPETA = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}$")


def _leer_env(ruta):
    cfg = {}
    try:
        with open(ruta, encoding="utf-8-sig") as fh:
            for linea in fh:
                linea = linea.strip()
                if linea and not linea.startswith("#") and "=" in linea:
                    k, v = linea.split("=", 1)
                    cfg[k.strip().replace("export ", "")] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return cfg


def _clave_privada():
    """(clave, problema): la clave privada, o (None, por que no hay). Rechaza la clave publica."""
    clave = (os.environ.get(VARIABLE_CLAVE) or "").strip().strip('"').strip("'")
    if not clave:
        clave = _leer_env(ARCHIVO_ENV).get(VARIABLE_CLAVE, "")
    if not clave:
        return None, "no hay clave privada de Supabase: poner %s=... en %s" % (VARIABLE_CLAVE, ARCHIVO_ENV)
    if clave.startswith("sb_publishable_"):
        return None, "esa es la clave PUBLICA (la de las apps): hace falta la secret / service_role"
    if clave.startswith("eyJ"):                      # formato viejo (JWT): el rol va en el payload
        try:
            import base64
            carga = clave.split(".")[1]
            rol = json.loads(base64.urlsafe_b64decode(carga + "=" * (-len(carga) % 4))).get("role")
        except Exception:
            rol = None
        if rol != "service_role":
            return None, "esa clave JWT tiene rol '%s', no service_role: hace falta la clave privada" % rol
    return clave, ""


def avisar_ntfy(titulo, mensaje, urgente=True):
    """True si salio por ntfy. Nunca levanta (avisar no puede romper el backup)."""
    tema = (os.environ.get("NTFY_TOPIC") or "").strip()
    for ruta in (ARCHIVO_ENV, ENV_XRS2):
        if not tema:
            tema = _leer_env(ruta).get("NTFY_TOPIC", "")
    if not tema:
        print("  (sin NTFY_TOPIC: el aviso al celular no sale)")
        return False
    url = os.environ.get("NTFY_URL") or NTFY_URL_DEFECTO
    cuerpo = json.dumps({"topic": tema, "title": titulo, "message": mensaje[:1500],
                         "priority": 4 if urgente else 3,
                         "tags": ["warning"] if urgente else ["white_check_mark"]}).encode("utf-8")
    pedido = urllib.request.Request(url, data=cuerpo, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(pedido, timeout=20) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print("  no se pudo mandar el aviso por ntfy: %s" % e)
        return False


def pedir(url, clave=None, reintentos=3, aceptar=None):
    """GET con reintentos. Devuelve (cuerpo_json, content_range)."""
    clave = clave or SUPA_KEY_PUBLICA
    ultimo = None
    for intento in range(reintentos):
        cabeceras = {"apikey": clave, "Authorization": f"Bearer {clave}", "Prefer": "count=exact"}
        if aceptar:
            cabeceras["Accept"] = aceptar
        req = urllib.request.Request(url, headers=cabeceras)
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


def listar_tablas(base=None, clave=None):
    """Nombres de las tablas desde el OpenAPI de PostgREST (solo lo entrega la clave privada)."""
    base = base or SUPA_URL
    datos, _ = pedir(f"{base}/rest/v1/", clave, aceptar="application/openapi+json")
    nombres = sorted(n for n in (datos.get("definitions") or {}) if n not in VISTAS)
    if not nombres:
        raise RuntimeError("el OpenAPI no devolvio ninguna tabla")
    return nombres


def bajar_tabla(tabla, orden, base=None, clave=None):
    base = base or SUPA_URL
    filas, desde, total = [], 0, None
    while True:
        q = {"select": "*", "limit": PAGINA, "offset": desde}
        if orden:
            q["order"] = orden
        datos, rango = pedir(f"{base}/rest/v1/{tabla}?{urllib.parse.urlencode(q)}", clave)
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
    conservar = max(3, args.conservar)

    os.makedirs(args.destino, exist_ok=True)
    nombre = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    carpeta = os.path.join(args.destino, nombre)
    os.makedirs(carpeta, exist_ok=True)
    anteriores = conteos_anteriores(args.destino, nombre)

    errores, alertas = [], []
    clave_priv, problema = _clave_privada()
    clave = clave_priv or SUPA_KEY_PUBLICA
    origen = "indicada"
    if tablas is None:
        if clave_priv:
            try:
                tablas = {n: ORDEN.get(n) for n in listar_tablas(base, clave)}
                origen = "openapi"
            except Exception as e:
                tablas = dict(TABLAS)
                origen = "fija"
                errores.append(f"no pude listar las tablas, uso la lista fija (puede faltar alguna): {e}")
        else:
            tablas = dict(TABLAS)
            origen = "fija"
            errores.append(f"sin clave privada ({problema}): backup con la llave publica y la lista fija, "
                           "solo tiene lo que ve la app")

    manifest = {"creado": datetime.datetime.now().isoformat(timespec="seconds"), "supabase": base or SUPA_URL,
                "clave": "privada" if clave_priv else "publica", "tablas_origen": origen, "tablas": {}}

    for tabla, orden in tablas.items():
        try:
            filas = bajar_tabla(tabla, orden, base, clave)
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

    # Una tabla que estaba en el backup anterior y ya no esta en la lista: se borro o se renombro.
    if origen in ("openapi", "indicada"):
        for t in sorted(anteriores):
            if t not in tablas:
                alertas.append(f"{t}: estaba en el backup anterior y ya no existe")

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
    if estado != "OK":
        avisar_ntfy(f"Backup de Supabase: {estado}", resumen, urgente=True)
    return 2 if alertas else (1 if errores else 0)


if __name__ == "__main__":
    sys.exit(main())
