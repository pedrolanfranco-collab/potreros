# -*- coding: utf-8 -*-
"""Verifica la Fase 4 de la auditoria (clave del campo) desde afuera, con la llave PUBLICA. Solo lee.

Modo normal (release 1, "modo suave"):
  - la funcion `verificar_clave` existe y contesta `false` para una clave inventada;
  - si estan las variables de entorno CLAVE_CAMPO_LA_VUELTA / CLAVE_CAMPO_MARIA_LAURA /
    CLAVE_CAMPO_PONE_CHICO, contesta `true` con la real de cada campo (la clave NUNCA se imprime);
  - las tablas siguen legibles (el modo suave no corta nada).

Modo --cierre (release 2, despues de correr fase4_cierre.sql):
  - SIN el encabezado `x-clave-campo`, cada tabla da 0 filas o un rechazo (401/403);
  - EXCEPCION a proposito: Pone Chico no usa clave (CONFIG.claveCampo = false), asi que sus filas propias
    (eventos_sync y stock_potreros con establecimiento = pone_chico, y sanidad_carga_pone_chico) tienen que
    seguir legibles sin clave, y en las tablas de varios campos todo LO DEMAS tiene que dar 0 filas;
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
# Tablas cuyas filas de Pone Chico quedan abiertas (sin clave) tras el cierre: ver fase4_cierre.sql,
# public.establecimientos_autorizados(). Si Pone Chico pasa a usar clave, vaciar este conjunto.
CAMPO_ABIERTO = "pone_chico"
ABIERTAS_CAMPO_ABIERTO = {"eventos_sync", "stock_potreros", "sanidad_carga_pone_chico"}


def leer_env_local():
    """Variables de ~/.potreros/.env (sin imprimirlas). utf-8-sig: el archivo puede traer BOM."""
    ruta = os.path.join(os.path.expanduser("~"), ".potreros", ".env")
    claves = {}
    try:
        with open(ruta, encoding="utf-8-sig") as f:
            for linea in f:
                linea = linea.strip()
                if linea and not linea.startswith("#") and "=" in linea:
                    k, v = linea.split("=", 1)
                    claves[k.strip().replace("export ", "")] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return claves


def clave_privada():
    """SUPABASE_SECRET_KEY (variable de entorno o ~/.potreros/.env), o None. Se usa SOLO para saber si una tabla
    tiene filas (lectura): sin ella los chequeos de 'abierta a proposito' no distinguen 'vacia' de 'cerrada'."""
    return os.environ.get("SUPABASE_SECRET_KEY") or leer_env_local().get("SUPABASE_SECRET_KEY") or None


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


def pedir_privada(ruta, privada):
    """GET de solo lectura con la clave privada (no pasa por las politicas). Devuelve (status, texto)."""
    cab = {"apikey": privada}
    if privada.startswith("eyJ"):                 # formato viejo (JWT); las sb_secret_ no van como Bearer
        cab["Authorization"] = "Bearer " + privada
    req = request.Request(URL + ruta, method="GET", headers=cab)
    try:
        with request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


def hay_datos_abiertos(tabla, colest, sel, privada):
    """True/False si la tabla tiene filas del campo abierto (mirando con la clave privada); None si no se sabe."""
    if not privada:
        return None
    q = "%s?select=%s&limit=1" % (tabla, sel) + (("&%s=eq.%s" % (colest, CAMPO_ABIERTO)) if colest else "")
    st, tx = pedir_privada(q, privada)
    li = filas(tx) if st in (200, 206) else None
    return None if li is None else len(li) > 0


def vacia_o_cerrada(tabla, colest, sel, privada):
    """Texto y 'mal' para una tabla abierta a proposito que contesto 200 sin filas."""
    datos = hay_datos_abiertos(tabla, colest, sel, privada)
    if datos is True:
        return "MAL tiene filas de %s pero sin clave no se ve ninguna: quedo CERRADA" % CAMPO_ABIERTO, 1
    if datos is False:
        return "--  200 sin filas (la tabla no tiene datos de %s)" % CAMPO_ABIERTO, 0
    return "--  200 sin filas (sin SUPABASE_SECRET_KEY no se distingue de cerrada)", 0


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


def modo_cierre(claves, privada=None):
    mal = 0
    print("Release 2 (cierre)\n")
    if not claves:
        print("Sin ninguna CLAVE_CAMPO_*: solo se prueba que SIN clave quede cerrado.\n")
    if not privada:
        print("Sin SUPABASE_SECRET_KEY: si una tabla de %s contesta 'sin filas' no se sabe si esta vacia o cerrada.\n" % CAMPO_ABIERTO)
    print("%-28s %-30s %s" % ("tabla", "sin encabezado", "con la clave"))
    for tabla, colest, fijo, sel in TABLAS:
        abierta = tabla in ABIERTAS_CAMPO_ABIERTO
        base = "%s?select=%s&limit=1" % (tabla, sel)
        if abierta and fijo == CAMPO_ABIERTO:
            # tabla propia del campo sin clave (sanidad_carga_pone_chico): tiene que estar ABIERTA
            status, texto = pedir("GET", base)
            lista = filas(texto) if status in (200, 206) else None
            if lista is None:
                sin = marca(False, "abierta a proposito, pero contesta status %s" % status)
                mal += 1
            elif len(lista) == 0:
                txt, falla = vacia_o_cerrada(tabla, colest, sel, privada)
                sin = "abierta a proposito: " + txt
                mal += falla
            else:
                sin = marca(True, "abierta a proposito (%s sin clave): lee" % CAMPO_ABIERTO)
        else:
            # sin encabezado: 0 filas o rechazo. En las tablas de varios campos con un campo abierto, se
            # excluyen las filas de ese campo: lo demas tiene que estar cerrado.
            q_sin = base + (("&%s=neq.%s" % (colest, CAMPO_ABIERTO)) if abierta and colest else "")
            status, texto = pedir("GET", q_sin)
            lista = filas(texto) if status in (200, 206) else None
            cerrado = status in (401, 403) or (lista is not None and len(lista) == 0)
            sin = marca(cerrado, "status %s, %s" % (status, ("%d filas" % len(lista)) if lista is not None else "rechazo"))
            mal += (not cerrado)
            if abierta and colest:
                # y las filas del campo abierto tienen que seguir legibles sin clave
                st_a, tx_a = pedir("GET", base + "&%s=eq.%s" % (colest, CAMPO_ABIERTO))
                li_a = filas(tx_a) if st_a in (200, 206) else None
                if li_a is None:
                    sin += " | " + marca(False, "%s sin clave: status %s" % (CAMPO_ABIERTO, st_a))
                    mal += 1
                elif len(li_a) == 0:
                    txt, falla = vacia_o_cerrada(tabla, colest, sel, privada)
                    sin += " | %s sin clave: %s" % (CAMPO_ABIERTO, txt)
                    mal += falla
                else:
                    sin += " | " + marca(True, "%s sin clave: lee" % CAMPO_ABIERTO)
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
    mal = modo_cierre(claves, clave_privada()) if "--cierre" in sys.argv[1:] else modo_suave(claves)
    return 1 if mal else 0


if __name__ == "__main__":
    sys.exit(main())
