# -*- coding: utf-8 -*-
"""Prueba de `verificar_fase4.py --cierre` sin tocar Supabase: cambia `pedir()` por un doble que imita a
PostgREST con las politicas del cierre (Pone Chico abierto a proposito) y a PostgREST con todo abierto (hoy).

Comprueba que el verificador:
  - da `Todo OK` con el servidor ya cerrado (todo lo de La Vuelta y Maria Laura cerrado sin clave, Pone Chico
    abierto, lo compartido y sanidad_ultimos/proximos cerrados, con la clave todo se lee);
  - falla si el cierre NO se corrio (todo abierto), si Pone Chico quedo cerrado, o si alguna fila de otro campo
    se escapa sin clave;
  - no imprime nunca una clave.
Uso:   python probar_verificar_fase4.py
"""
import contextlib
import io
import json
import os
import sys
from urllib import parse

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verificar_fase4 as v  # noqa: E402

CLAVES = {"la_vuelta": "claveprueba1lv", "maria_laura": "claveprueba1ml"}
FALLAS = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)))
    if not cond:
        FALLAS.append(nombre)


# Datos: una fila de cada campo en cada tabla de varios campos.
FILAS = {
    "eventos_sync": [{"event_id": "a", "establecimiento": "la_vuelta"}, {"event_id": "b", "establecimiento": "maria_laura"},
                     {"event_id": "c", "establecimiento": "pone_chico"}],
    "stock_potreros": [{"potrero": "1", "establecimiento": "la_vuelta"}, {"potrero": "1", "establecimiento": "maria_laura"},
                       {"potrero": "1", "establecimiento": "pone_chico"}],
    "sanidad_carga": [{"id": 1, "establecimiento": "la_vuelta"}],
    "sanidad_carga_maria_laura": [{"id": 1}],
    "sanidad_carga_pone_chico": [{"id": 1}],
    "animales_caravana": [{"id8": "11111111", "establecimiento": "la_vuelta"}],
    "productos_catalogo": [{"producto": "Ivomec"}],
    "maestros_dicose": [{"nombre": "Fulano"}],
    "sanidad_ultimos": [{"establecimiento": "la_vuelta"}],
    "sanidad_proximos": [{"establecimiento": "la_vuelta"}],
}
FIJO = {"sanidad_carga": "la_vuelta", "sanidad_carga_maria_laura": "maria_laura", "sanidad_carga_pone_chico": "pone_chico"}


def servidor(modo, pone_chico_cerrado=False, fuga_de_otro_campo=False):
    """Doble de v.pedir(). modo: 'cerrado' (politicas del cierre) o 'abierto' (como hoy)."""
    def pedir(metodo, ruta, cuerpo=None, clave=None):
        tabla, _, qs = ruta.partition("?")
        q = parse.parse_qs(qs)
        campos_con_clave = [c for c, k in CLAVES.items() if clave == k]
        if tabla not in FILAS:
            return 404, "{}"
        filas = list(FILAS[tabla])
        if modo == "cerrado":
            if tabla in ("sanidad_ultimos", "sanidad_proximos"):
                return 401, '{"message":"permission denied"}'
            autorizados = set(campos_con_clave) | (set() if pone_chico_cerrado else {"pone_chico"})
            if tabla in ("eventos_sync", "stock_potreros"):
                filas = [f for f in filas if f["establecimiento"] in autorizados]
                if fuga_de_otro_campo and tabla == "eventos_sync":
                    filas = list(FILAS[tabla])
            elif tabla == "sanidad_carga_pone_chico":
                filas = filas if "pone_chico" in autorizados else []
            elif tabla in FIJO:
                filas = filas if FIJO[tabla] in campos_con_clave else []
            elif tabla == "animales_caravana":
                filas = [f for f in filas if f["establecimiento"] in campos_con_clave]
            else:  # productos_catalogo, maestros_dicose: la clave de cualquier campo
                filas = filas if campos_con_clave else []
        # filtros de la consulta
        for col, vals in q.items():
            if col in ("select", "limit"):
                continue
            op, _, valor = vals[0].partition(".")
            if op == "eq":
                filas = [f for f in filas if f.get(col) == valor]
            elif op == "neq":
                filas = [f for f in filas if f.get(col) != valor]
        return 200, json.dumps(filas[: int(q.get("limit", ["1000"])[0])])
    return pedir


PRIVADA = "sb_secret_PRUEBA_1234567890"


def privado(ruta, privada):
    """Doble de v.pedir_privada(): la clave privada salta las politicas, asi que ve todas las filas."""
    assert privada == PRIVADA
    tabla, _, qs = ruta.partition("?")
    q = parse.parse_qs(qs)
    filas = list(FILAS[tabla])
    for col, vals in q.items():
        if col in ("select", "limit"):
            continue
        op, _, valor = vals[0].partition(".")
        filas = [f for f in filas if (f.get(col) == valor) == (op == "eq")]
    return 200, json.dumps(filas[: int(q.get("limit", ["1000"])[0])])


def correr(modo, privada=PRIVADA, **kw):
    original = (v.pedir, v.pedir_privada)
    v.pedir, v.pedir_privada = servidor(modo, **kw), privado
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            mal = v.modo_cierre(CLAVES, privada)
    finally:
        v.pedir, v.pedir_privada = original
    return mal, out.getvalue()


mal, salida = correr("cerrado")
chequear("servidor cerrado como deja el cierre: 0 verificaciones fallidas", mal == 0, salida)
chequear("y dice 'Todo OK'", "Todo OK" in salida, salida)
chequear("muestra que Pone Chico quedo abierto a proposito", "abierta a proposito" in salida and "pone_chico sin clave: lee" in salida, salida)
chequear("no imprime ninguna clave (ni la de los campos ni la privada)", not any(k in salida for k in list(CLAVES.values()) + [PRIVADA]), salida)

mal, salida = correr("cerrado", privada=None)
chequear("sin clave privada tambien da Todo OK (los datos de Pone Chico existen y se leen)", mal == 0 and "Todo OK" in salida, salida)

mal, salida = correr("abierto")
chequear("con todo abierto (cierre sin correr): falla", mal > 0 and "Todo OK" not in salida, salida)

mal, salida = correr("cerrado", pone_chico_cerrado=True)
chequear("si Pone Chico quedo cerrado (y hay clave privada para saber que hay datos): falla", mal > 0 and "CERRADA" in salida, salida)

mal, salida = correr("cerrado", privada=None, pone_chico_cerrado=True)
chequear("sin clave privada, 'cerrada' y 'vacia' no se distinguen: lo avisa en vez de dar por bueno en silencio",
         "sin SUPABASE_SECRET_KEY" in salida, salida)

mal, salida = correr("cerrado", fuga_de_otro_campo=True)
chequear("si eventos_sync deja ver filas de otro campo sin clave: falla", mal > 0, salida)

print("\n" + (f"{len(FALLAS)} FALLA(S): " + "; ".join(FALLAS) if FALLAS else "Todo OK"))
sys.exit(1 if FALLAS else 0)
