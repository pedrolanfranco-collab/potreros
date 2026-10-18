# -*- coding: utf-8 -*-
"""
cargar_sanidad_csv.py -- carga tratamientos de Sanidad desde un CSV hecho a mano.

Para cuando hay unos pocos tratamientos que NO vienen del baston (no pasan por la carpeta
Entrada\\ del Lector XRS2) y no se quieren tipear uno por uno en "+ Cargar tratamiento".
Cada fila del CSV termina como una fila de la tabla de Sanidad del establecimiento, la misma
que escribe la app:

    la_vuelta    -> sanidad_carga               (de ahi la baja bajar_sanidad_de_potreros.py a la Planilla)
    maria_laura  -> sanidad_carga_maria_laura   (requiere la columna dueno)
    pone_chico   -> sanidad_carga_pone_chico    (requiere la columna dueno)

Uso (PowerShell, en esta carpeta):
    python cargar_sanidad_csv.py mis_sanidades.csv                 # SIMULA: valida y dice que cargaria
    python cargar_sanidad_csv.py mis_sanidades.csv --aplicar       # recien ahi inserta
    python cargar_sanidad_csv.py mis_sanidades.csv --establecimiento maria_laura

Columnas (el orden no importa; sin tildes, mayusculas ni espacios da igual; ver sanidad_nuevas.ejemplo.csv):
    obligatorias: fecha, categoria, potrero, cantidad, producto1, dosis1   (+ dueno en maria_laura / pone_chico)
    opcionales:   gen (ultimo digito del anio de nacimiento: 5 = 2025), producto2, dosis2, observaciones
    separador ; o , (se detecta solo); decimales con coma o punto; fecha AAAA-MM-DD o DD/MM/AAAA.

Reglas que lo hacen seguro:
  - TODO O NADA: si una sola fila tiene un error, no se inserta ninguna (ni con --aplicar).
  - El producto se valida contra productos_catalogo (sin importar tildes ni mayusculas) y se guarda
    con el nombre EXACTO del catalogo. Uno que no existe NO se carga: un producto mal escrito
    calcularia una carencia equivocada. Te sugiere los parecidos.
  - Idempotente: el id sale del CONTENIDO de la fila, y el insert ignora los ids que ya existen.
    Correrlo dos veces no duplica nada.
  - Escribe con la clave privada de Supabase (variable SUPABASE_SECRET_KEY o ~/.potreros/.env), que
    nunca se imprime ni se loguea y solo viaja a Supabase (o a localhost, para las pruebas).
"""
import argparse
import csv
import datetime
import difflib
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
from urllib import error, parse, request

SUPA_URL = "https://skkknfjpwcstefcroqjt.supabase.co"
HOSTS_PERMITIDOS = ("skkknfjpwcstefcroqjt.supabase.co", "localhost", "127.0.0.1")

VARIABLE_CLAVE = "SUPABASE_SECRET_KEY"
ARCHIVO_ENV = os.environ.get("POTREROS_ENV") or os.path.join(os.path.expanduser("~"), ".potreros", ".env")

TABLAS = {"la_vuelta": "sanidad_carga",
          "maria_laura": "sanidad_carga_maria_laura",
          "pone_chico": "sanidad_carga_pone_chico"}
CON_DUENO = ("maria_laura", "pone_chico")        # estas dos tablas llevan dueno y NO llevan establecimiento

# nombre normalizado de la columna del CSV -> campo
ALIAS = {
    "fecha": "fecha",
    "categoria": "categoria", "cat": "categoria",
    "potrero": "potrero", "pot": "potrero",
    "cantidad": "cantidad", "cant": "cantidad", "animales": "cantidad", "cabezas": "cantidad",
    "gen": "gen", "generacion": "gen",
    "producto1": "producto1", "producto": "producto1", "prod1": "producto1",
    "dosis1": "dosis1", "dosis": "dosis1",
    "producto2": "producto2", "prod2": "producto2",
    "dosis2": "dosis2",
    "observaciones": "observaciones", "observacion": "observaciones", "obs": "observaciones",
    "nota": "observaciones", "notas": "observaciones",
    "dueno": "dueno", "firma": "dueno", "propietario": "dueno",
}
OBLIGATORIOS = ["fecha", "categoria", "potrero", "cantidad", "producto1", "dosis1"]


# ---------------------------------------------------------------- clave privada
def _clave_privada():
    """(clave, problema): la clave privada, o (None, por que no hay). Rechaza la clave publica."""
    clave = (os.environ.get(VARIABLE_CLAVE) or "").strip().strip('"').strip("'")
    if not clave and os.path.exists(ARCHIVO_ENV):
        try:
            with open(ARCHIVO_ENV, encoding="utf-8-sig") as fh:
                for linea in fh:
                    linea = linea.strip()
                    if linea and not linea.startswith("#") and "=" in linea:
                        k, v = linea.split("=", 1)
                        if k.strip().replace("export ", "") == VARIABLE_CLAVE:
                            clave = v.strip().strip('"').strip("'")
                            break
        except OSError as e:
            return None, "no se pudo leer %s: %s" % (ARCHIVO_ENV, e)
    if not clave:
        return None, "falta %s en %s (o la variable de entorno)" % (VARIABLE_CLAVE, ARCHIVO_ENV)
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


def _cabeceras(clave, json_body=False):
    """apikey siempre; Authorization: Bearer solo para la clave vieja (JWT). Las sb_secret_ no son JWT."""
    cab = {"apikey": clave}
    if clave.startswith("eyJ"):
        cab["Authorization"] = "Bearer " + clave
    if json_body:
        cab["Content-Type"] = "application/json"
    return cab


def _url_valida(url):
    host = (parse.urlparse(url).hostname or "").lower()
    return host in HOSTS_PERMITIDOS


def _rest(base, clave, metodo, ruta, body=None, extra=None):
    cab = _cabeceras(clave, json_body=body is not None)
    if extra:
        cab.update(extra)
    datos = json.dumps(body).encode("utf-8") if body is not None else None
    req = request.Request("%s/rest/v1/%s" % (base.rstrip("/"), ruta), data=datos, headers=cab, method=metodo)
    try:
        with request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()
    except error.HTTPError as e:
        return e.code, e.read()
    except (error.URLError, OSError) as e:
        return 0, str(e).encode("utf-8", "replace")


def _get_json(base, clave, ruta):
    status, cuerpo = _rest(base, clave, "GET", ruta)
    if status != 200:
        raise RuntimeError("Supabase contesto %s en %s" % (status, ruta.split("?")[0]))
    return json.loads(cuerpo.decode("utf-8") or "[]")


# ---------------------------------------------------------------- normalizar / parsear
def _norm(t):
    t = unicodedata.normalize("NFD", str(t if t is not None else ""))
    return "".join(c for c in t if unicodedata.category(c) != "Mn").lower().strip()


def _norm_columna(t):
    return re.sub(r"[^a-z0-9]", "", _norm(t).replace("ñ", "n"))


def _num(txt):
    t = str(txt).strip().replace(" ", "")
    if "," in t and "." in t:                         # 1.234,5 -> 1234.5
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", ".")
    return float(t)


def _fecha(txt, hoy):
    t = str(txt).strip()[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", str(txt).strip()) else str(txt).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.datetime.strptime(t, fmt).date()
        except ValueError:
            pass
    raise ValueError("no entiendo la fecha '%s' (usar AAAA-MM-DD o DD/MM/AAAA)" % txt)


def _separador(texto):
    primera = texto.lstrip("﻿").splitlines()[0] if texto.strip() else ""
    return max((";", ",", "\t"), key=lambda s: primera.count(s))


def leer_csv(ruta):
    """([filas], [avisos]); cada fila es {campo: texto, '_linea': n}."""
    with open(ruta, encoding="utf-8-sig", newline="") as fh:
        texto = fh.read()
    if not texto.strip():
        raise ValueError("el archivo esta vacio")
    lector = csv.reader(io.StringIO(texto), delimiter=_separador(texto))
    filas_crudas = [f for f in lector]
    encabezado = filas_crudas[0]
    campos, ignoradas = [], []
    for col in encabezado:
        campo = ALIAS.get(_norm_columna(col))
        campos.append(campo)
        if campo is None and col.strip():
            ignoradas.append(col.strip())
    repetidos = {c for c in campos if c and campos.count(c) > 1}
    if repetidos:
        raise ValueError("columna repetida: %s" % ", ".join(sorted(repetidos)))
    filas = []
    for n, cruda in enumerate(filas_crudas[1:], start=2):
        if not any(c.strip() for c in cruda):
            continue
        fila = {"_linea": n}
        for campo, valor in zip(campos, cruda):
            if campo:
                fila[campo] = valor.strip()
        filas.append(fila)
    avisos = ["columna ignorada: '%s'" % c for c in ignoradas]
    return filas, avisos, [c for c in campos if c]


# ---------------------------------------------------------------- validar y armar
def _id(est, f, indice):
    base = "|".join(str(x) for x in (est, f["fecha"], f["categoria"], f.get("gen"), f["potrero"], f["cantidad"],
                                      f["producto1"], f["dosis1"], f.get("producto2"), f.get("dosis2"),
                                      f.get("dueno"), indice))
    return "csv_" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:20]


def armar_registros(filas, est, catalogo, hoy):
    """(registros, errores, avisos). Todo o nada: el que llama no inserta si hay errores."""
    por_clave = {_norm(p): p for p in catalogo}
    errores, avisos, registros, vistos = [], [], [], {}
    for fila in filas:
        n = fila["_linea"]
        err = []

        def falta(c):
            return not str(fila.get(c, "")).strip()

        faltan = [c for c in OBLIGATORIOS + (["dueno"] if est in CON_DUENO else []) if falta(c)]
        if faltan:
            errores.append("linea %d: falta %s" % (n, ", ".join(faltan)))
            continue
        reg = {}
        try:
            f = _fecha(fila["fecha"], hoy)
            if f > hoy:
                err.append("la fecha %s es futura" % f.isoformat())
            elif (hoy - f).days > 365:
                avisos.append("linea %d: la fecha %s tiene mas de un anio (revisar el anio)" % (n, f.isoformat()))
            reg["fecha"] = f.isoformat()
        except ValueError as e:
            err.append(str(e))
        reg["categoria"] = fila["categoria"].strip()
        reg["potrero"] = fila["potrero"].strip()
        try:
            c = _num(fila["cantidad"])
            if c != int(c) or c < 1:
                raise ValueError
            reg["cantidad"] = int(c)
        except ValueError:
            err.append("cantidad '%s' no es un entero de 1 o mas" % fila["cantidad"])
        try:
            d1 = _num(fila["dosis1"])
            if d1 <= 0:
                raise ValueError
            reg["dosis1"] = d1
        except ValueError:
            err.append("dosis1 '%s' no es un numero mayor que 0" % fila["dosis1"])

        gen_txt = str(fila.get("gen", "")).strip()
        if gen_txt:
            try:
                g = _num(gen_txt)
                if g != int(g) or g < 0:
                    raise ValueError
                if int(g) >= 10:
                    err.append("gen '%s': va el ULTIMO digito del anio de nacimiento (5 para 2025)" % gen_txt)
                reg["gen"] = int(g)
            except ValueError:
                err.append("gen '%s' no es un numero" % gen_txt)
        else:
            reg["gen"] = None

        for campo_p, campo_d in (("producto1", "dosis1"), ("producto2", "dosis2")):
            nombre = str(fila.get(campo_p, "")).strip()
            if not nombre:
                reg[campo_p] = None
                reg[campo_d] = reg.get(campo_d)
                continue
            if _norm(nombre) in por_clave:
                reg[campo_p] = por_clave[_norm(nombre)]
            else:
                parecidos = difflib.get_close_matches(nombre, list(catalogo), n=3, cutoff=0.5)
                err.append("%s '%s' no esta en el catalogo%s" % (
                    campo_p, nombre, " (parecidos: %s)" % ", ".join(parecidos) if parecidos else ""))
        if reg.get("producto2"):
            try:
                d2 = _num(fila.get("dosis2", ""))
                if d2 <= 0:
                    raise ValueError
                reg["dosis2"] = d2
            except ValueError:
                err.append("producto2 sin una dosis2 valida")
        else:
            reg["producto2"], reg["dosis2"] = None, None
            if str(fila.get("dosis2", "")).strip():
                avisos.append("linea %d: dosis2 sin producto2, se ignora" % n)

        reg["observaciones"] = str(fila.get("observaciones", "")).strip() or None
        if est in CON_DUENO:
            reg["dueno"] = fila["dueno"].strip()
        if err:
            errores.append("linea %d: %s" % (n, "; ".join(err)))
            continue

        clave = (reg["fecha"], reg["categoria"], reg["gen"], reg["potrero"], reg["cantidad"], reg["producto1"],
                 reg["dosis1"], reg["producto2"], reg["dosis2"], reg.get("dueno"))
        vistos[clave] = vistos.get(clave, 0) + 1
        if vistos[clave] > 1:
            avisos.append("linea %d: fila igual a otra del archivo; se carga igual como una segunda" % n)
        reg["id"] = _id(est, reg, vistos[clave] - 1)
        if est not in CON_DUENO:
            reg["establecimiento"] = est
        reg["caravana"] = None                        # grupal, como la app: explicito en null
        reg["sin_caravana"] = None
        reg["_linea"] = n
        registros.append(reg)
    return registros, errores, avisos


def _publico(reg):
    return {k: v for k, v in reg.items() if not k.startswith("_")}


def _resumen(reg):
    p2 = " + %s %s" % (reg["producto2"], reg["dosis2"]) if reg.get("producto2") else ""
    gen = " gen %s" % reg["gen"] if reg.get("gen") is not None else ""
    dueno = " [%s]" % reg["dueno"] if reg.get("dueno") else ""
    return "%s  %s%s%s  potrero %s  x%d  %s %s%s" % (
        reg["fecha"], reg["categoria"], gen, dueno, reg["potrero"], reg["cantidad"],
        reg["producto1"], reg["dosis1"], p2)


# ---------------------------------------------------------------- principal
def main(argv=None, hoy=None):
    ap = argparse.ArgumentParser(description="Carga tratamientos de Sanidad desde un CSV (simula por defecto).")
    ap.add_argument("archivo", help="CSV con los tratamientos")
    ap.add_argument("--establecimiento", choices=sorted(TABLAS), default="la_vuelta")
    ap.add_argument("--aplicar", action="store_true", help="inserta de verdad (sin esto solo simula)")
    ap.add_argument("--url", default=SUPA_URL, help=argparse.SUPPRESS)      # solo para las pruebas (localhost)
    a = ap.parse_args(argv)
    hoy = hoy or datetime.date.today()
    est, tabla = a.establecimiento, TABLAS[a.establecimiento]

    if not _url_valida(a.url):
        print("ERROR: esa direccion no es de Supabase (ni localhost): no se manda la clave.")
        return 1
    try:
        filas, avisos_col, columnas = leer_csv(a.archivo)
    except (OSError, ValueError) as e:
        print("ERROR leyendo %s: %s" % (a.archivo, e))
        return 1
    faltan = [c for c in OBLIGATORIOS + (["dueno"] if est in CON_DUENO else []) if c not in columnas]
    if faltan:
        print("ERROR: al CSV le faltan las columnas: %s" % ", ".join(faltan))
        print("       columnas que entendi: %s" % ", ".join(columnas))
        return 1
    if not filas:
        print("El CSV no tiene filas con datos.")
        return 1

    clave, problema = _clave_privada()
    if not clave:
        print("ERROR: %s" % problema)
        print("       (hace falta para leer el catalogo y para escribir; no se mando nada)")
        return 1
    try:
        catalogo = []
        for desde in range(0, 20000, 1000):
            lote = _get_json(a.url, clave, "productos_catalogo?select=producto&order=producto&limit=1000&offset=%d" % desde)
            catalogo += [r["producto"] for r in lote if r.get("producto")]
            if len(lote) < 1000:
                break
    except (RuntimeError, ValueError) as e:
        print("ERROR leyendo productos_catalogo: %s (sin catalogo no se puede validar el producto)" % e)
        return 1

    registros, errores, avisos = armar_registros(filas, est, catalogo, hoy)
    for av in avisos_col + avisos:
        print("AVISO: %s" % av)
    if errores:
        print("\n%d fila(s) con error; NO se carga nada:" % len(errores))
        for e in errores:
            print("  - %s" % e)
        return 2

    try:
        ids = [r["id"] for r in registros]
        existentes = {r["id"] for r in _get_json(a.url, clave, "%s?select=id&id=in.(%s)" % (tabla, ",".join(ids)))}
    except (RuntimeError, ValueError) as e:
        print("ERROR consultando %s: %s" % (tabla, e))
        return 1
    nuevos = [r for r in registros if r["id"] not in existentes]

    print("\n%s -> %s: %d fila(s) validas, %d ya estaban, %d para cargar" % (
        est, tabla, len(registros), len(registros) - len(nuevos), len(nuevos)))
    for r in registros:
        print("  %s %s" % ("ya estaba" if r["id"] in existentes else "NUEVA    ", _resumen(r)))
    if not nuevos:
        print("\nNo hay nada nuevo para cargar.")
        return 0
    if not a.aplicar:
        print("\n(simulacion: no se escribio nada. Para cargar de verdad, agregar --aplicar)")
        return 0

    status, cuerpo = _rest(a.url, clave, "POST", "%s?on_conflict=id" % tabla, [_publico(r) for r in nuevos],
                           {"Prefer": "resolution=ignore-duplicates,return=minimal"})
    if status not in (200, 201, 204):
        print("ERROR insertando en %s: HTTP %s %s" % (tabla, status, cuerpo.decode("utf-8", "replace")[:300]))
        return 1
    try:                                              # PostgREST puede contestar OK sin haber escrito (RLS): se pide de vuelta
        llegaron = {r["id"] for r in _get_json(a.url, clave, "%s?select=id&id=in.(%s)" % (tabla, ",".join(r["id"] for r in nuevos)))}
    except (RuntimeError, ValueError) as e:
        print("Se envio, pero no pude verificar que llegara (%s). Revisalo en la app." % e)
        return 1
    if len(llegaron) != len(nuevos):
        print("ATENCION: se enviaron %d y solo %d figuran en %s. Revisar permisos (RLS)." % (len(nuevos), len(llegaron), tabla))
        return 1
    print("\nOK: %d tratamiento(s) cargados en %s y verificados." % (len(nuevos), tabla))
    if est == "la_vuelta":
        print("La pantalla Sanidad de la app ya los ve; bajar_sanidad_de_potreros.py (cada hora) los lleva a la Planilla.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
