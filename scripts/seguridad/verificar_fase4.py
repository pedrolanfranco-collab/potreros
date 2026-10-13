# -*- coding: utf-8 -*-
"""Verifica la Fase 4 de la auditoria (clave del campo) desde afuera, con la llave PUBLICA. Solo lee.

Modo normal (release 1, "modo suave"):
  - la funcion `verificar_clave` existe y contesta `false` para una clave inventada;
  - si estan las variables de entorno CLAVE_CAMPO_LA_VUELTA / CLAVE_CAMPO_MARIA_LAURA /
    CLAVE_CAMPO_PONE_CHICO, contesta `true` con la real de cada campo (la clave NUNCA se imprime);
  - las tablas siguen legibles (el modo suave no corta nada).

Modo --cierre (release 2, despues de correr fase4_cierre.sql):
  - SIN el encabezado `x-clave-campo`, cada tabla da 0 filas o un rechazo (401/403);
  - CON la clave (variables de entorno de arriba), cada tabla del campo se deja leer;
  - sanidad_ultimos y sanidad_proximos quedan cerradas aun con clave.
  La escritura sin clave NO se prueba desde aca (un insert que entrara dejaria una fila de prueba en una
  tabla real): se mira en la app, ver scripts/seguridad/README.md.

No escribe nada y no imprime ninguna clave. Las claves reales se leen SOLO de las variables de entorno
(o de `C:\\Users\\<usuario>\\.potreros\\.env`, lineas CLAVE_CAMPO_<CAMPO>=...), nunca de un argumento.

Uso:  python verificar_fase4.py              (release 1)
      python verificar_fase4.py --cierre     (release 2)
Sale con codigo 1 si algo no es lo esperado.
"""
import json
import os
import sys
from urllib import error, parse, request

URL = "https://skkknfjpwcstefcroqjt.supabase.co/rest/v1/"
ANON = "sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"   # la de las apps: es publica

CAMPOS = [
    ("la_vuelta", "CLAVE_CAMPO_LA_VUELTA"),
    ("maria_laura", "CLAVE_CAMPO_MARIA_LAURA"),
    ("pone_chico", "CLAVE_CAMPO_PONE_CHICO"),
]
CLAVE_INVENTADA = "claveinventada0000"   # no es la de ningun campo

# tabla -> (columna con el establecimiento o None, campo fijo de la tabla o None, columna para el select)
TABLAS = [
    ("eventos_sync", "establecimiento", None, "event_id"),
    ("stock_potreros", "establecimiento", None, "potrero"),
    ("sanidad_carga", "establecimiento", "la_vuelta", "id"),
    ("sanidad_carga_maria_laura", None, "maria_laura", "id"),
    ("sanidad_carga_pone_chico", None, "pone_chico", "id"),
    ("animales_caravana", "establecimiento", None, "id8"),
    ("productos_catalogo", None, "*", "producto"),    # '*' = alcanza con la clave de cualquier campo
    ("maestros_dicose", None, "*", "nombre"),
]
CERRADAS = [("sanidad_ultimos", "establecimiento"), ("sanidad_proximos", "establecimiento")]


def leer_env_local():
    """Variables CLAVE_CAMPO_* desde ~/.potreros/.env (sin imprimirlas)."""
    ruta = os.path.join(os.path.expanduser("~"), ".potreros", ".env")
    claves = {}
    try:
        with open(ruta, encoding="utf-8") as f:
            for linea in f:
                linea = linea.strip()
                if linea.startswith("CLAVE_CAMPO_") and "=" in linea:
                    k, v = linea.split("=", 1)
                    claves[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return claves


def claves_reales():
    local = leer_env_local()
    out = {}
    for campo, var in CAMPOS:
        v = os.environ.get(var) or local.get(var)
        if v:
            out[campo] = v
    return out


def pedir(metodo, ruta, cuerpo=None, clave=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    cab = {"apikey": ANON, "Authorization": "Bearer " + ANON, "Content-Type": "application/json"}
    if clave:
        cab["x-clave-campo"] = clave
    req = request.Request(URL + ruta, data=datos, method=metodo, headers=cab)
    try:
        with request.urlopen(req, timeout=30) as r:
            texto = r.read().decode("utf-8", "replace")
            return r.status, texto
    except error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # sin red, DNS, timeout
        return 0, str(e)


def verificar_rpc(est, clave):
    """True/False si la funcion contesta; None si no se pudo preguntar. Devuelve (valor, status)."""
    status, texto = pedir("POST", "rpc/verificar_clave", {"est": est, "clave": clave})
    if status != 200:
        return None, status
    try:
        v = json.loads(texto)
    except ValueError:
        return None, status
    return (v if isinstance(v, bool) else None), status


def filas(texto):
    try:
        v = json.loads(texto)
    except ValueError:
        return None
    return v if isinstance(v, list) else None


def marca(ok, detalle):
    return ("ok  " if ok else "MAL ") + detalle


def modo_suave(claves):
    mal = 0
    print("Release 1 (modo suave)\n")
    print("%-14s %-s" % ("campo", "verificar_clave"))
    # 1. la funcion existe y rechaza una clave inventada
    for campo, _ in CAMPOS:
        v, status = verificar_rpc(campo, CLAVE_INVENTADA)
        if status == 404:
            print("%-14s %s" % (campo, marca(False, "404: falta correr fase4_clave_campo.sql (la funcion no existe)")))
            mal += 1
        elif v is False:
            print("%-14s %s" % (campo, marca(True, "clave inventada -> false")))
        else:
            print("%-14s %s" % (campo, marca(False, "no contesto false (status %s, valor %r)" % (status, v))))
            mal += 1
    # 2. con la real, true (si hay variable de entorno)
    print()
    for campo, var in CAMPOS:
        if campo not in claves:
            print("%-14s %s" % (campo, "--  sin %s: no se prueba la clave real" % var))
            continue
        v, status = verificar_rpc(campo, claves[campo])
        if v is True:
            print("%-14s %s" % (campo, marca(True, "la clave real -> true")))
        else:
            print("%-14s %s" % (campo, marca(False, "la clave real NO verifica (status %s, valor %r): "
                                             "falta cargarla con private.cargar_clave o esta mal" % (status, v))))
            mal += 1
    # 3. el modo suave no corta nada: las tablas siguen legibles con la llave publica
    print()
    print("%-28s %s" % ("tabla", "lectura sin clave (modo suave: tiene que andar)"))
    for tabla, _col, _fijo, sel in TABLAS:
        status, texto = pedir("GET", "%s?select=%s&limit=1" % (tabla, sel))
        ok = status in (200, 206)
        print("%-28s %s" % (tabla, marca(ok, "status %s" % status)))
        mal += (not ok)
    print()
    if mal:
        print("%d verificacion(es) fallaron." % mal)
    else:
        print("Todo OK: verificar_clave funciona y el modo suave no corto nada.")
    return mal


def modo_cierre(claves):
    mal = 0
    print("Release 2 (cierre)\n")
    if not claves:
        print("Sin ninguna CLAVE_CAMPO_*: solo se prueba que SIN clave quede cerrado.\n")
    print("%-28s %-30s %s" % ("tabla", "sin encabezado", "con la clave"))
    for tabla, colest, fijo, sel in TABLAS:
        # sin encabezado: 0 filas o rechazo
        status, texto = pedir("GET", "%s?select=%s&limit=1" % (tabla, sel))
        lista = filas(texto) if status in (200, 206) else None
        cerrado = status in (401, 403) or (lista is not None and len(lista) == 0)
        sin = marca(cerrado, "status %s, %s" % (status, ("%d filas" % len(lista)) if lista is not None else "rechazo"))
        mal += (not cerrado)
        # con la clave del campo de la tabla (o la de cualquiera para las compartidas)
        if fijo == "*":
            claves_usar = list(claves.items())[:1]
        elif fijo:
            claves_usar = [(fijo, claves[fijo])] if fijo in claves else []
        else:
            claves_usar = list(claves.items())
        con_partes = []
        for campo, clave in claves_usar:
            q = "%s?select=%s&limit=1" % (tabla, sel)
            if colest:
                q += "&%s=eq.%s" % (colest, parse.quote(campo))
            st, tx = pedir("GET", q, clave=clave)
            li = filas(tx) if st in (200, 206) else None
            if li is None:
                con_partes.append(marca(False, "%s: status %s" % (campo, st)))
                mal += 1
            elif len(li) == 0:
                con_partes.append("--  %s: 200 sin filas (no hay datos para distinguirlo de cerrado)" % campo)
            else:
                con_partes.append(marca(True, "%s: lee" % campo))
        con = " | ".join(con_partes) if con_partes else "--  sin clave para probar"
        print("%-28s %-30s %s" % (tabla, sin, con))
    print()
    print("%-28s %s" % ("tabla", "tiene que seguir cerrada aun con clave"))
    for tabla, colest in CERRADAS:
        status, texto = pedir("GET", "%s?select=%s&limit=1" % (tabla, colest))
        lista = filas(texto) if status in (200, 206) else None
        cerrado = status in (401, 403) or (lista is not None and len(lista) == 0)
        extra = ""
        if claves:
            campo, clave = list(claves.items())[0]
            st2, tx2 = pedir("GET", "%s?select=%s&limit=1" % (tabla, colest), clave=clave)
            li2 = filas(tx2) if st2 in (200, 206) else None
            cerrado = cerrado and (st2 in (401, 403) or (li2 is not None and len(li2) == 0))
            extra = " / con clave status %s" % st2
        print("%-28s %s" % (tabla, marca(cerrado, "status %s%s" % (status, extra))))
        mal += (not cerrado)
    print()
    if mal:
        print("%d verificacion(es) fallaron: 'MAL' en 'sin encabezado' = sigue abierta; "
              "'MAL' en 'con la clave' = la app dejaria de ver esa tabla." % mal)
    else:
        print("Todo OK: sin clave queda cerrado, con la clave del campo se lee.")
    return mal


def main():
    claves = claves_reales()
    mal = modo_cierre(claves) if "--cierre" in sys.argv[1:] else modo_suave(claves)
    return 1 if mal else 0


if __name__ == "__main__":
    sys.exit(main())
