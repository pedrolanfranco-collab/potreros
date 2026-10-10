# -*- coding: utf-8 -*-
"""Verifica la Fase 2 de la auditoria (carencia protegida) desde afuera, con la llave PUBLICA.

Prueba, para cada tabla, que la llave publica:
  - SIGUE pudiendo leer (las apps y los scripts leen estas tablas);
  - YA NO puede borrar ni modificar.

No escribe nada real: el borrado y la modificacion usan un filtro que no coincide con ninguna fila
("__nada__"), asi que, aunque el permiso siguiera abierto, no cambia ningun dato. Un permiso abierto
se ve porque Supabase contesta 204/200 (se ejecuto sin error) en vez de 401/403 (permission denied).

No prueba INSERT a proposito: en una tabla con todas las columnas opcionales, un POST de prueba podria
dejar una fila vacia. Los permisos de INSERT se miran con la consulta de scripts/seguridad/README.md.

Uso:  python verificar_fase2.py        (sale con codigo 1 si algo sigue abierto o dejo de leerse)
"""
import json
import sys
from urllib import error, request

URL = "https://skkknfjpwcstefcroqjt.supabase.co/rest/v1/"
ANON = "sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"   # la de las apps: es publica

# tabla -> columna que se usa para el filtro "que no coincide con nada"
TABLAS = {
    "productos_catalogo": "producto",
    "animales_caravana": "id8",
    "sanidad_ultimos": "establecimiento",
    "sanidad_proximos": "establecimiento",
}


def pedir(metodo, tabla, query="", cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = request.Request(URL + tabla + query, data=datos, method=metodo, headers={
        "apikey": ANON, "Authorization": "Bearer " + ANON,
        "Content-Type": "application/json", "Prefer": "return=minimal"})
    try:
        with request.urlopen(req, timeout=30) as r:
            return r.status
    except error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def main():
    mal = 0
    print("%-20s %-8s %-10s %-12s" % ("tabla", "leer", "borrar", "modificar"))
    for tabla, col in TABLAS.items():
        leer = pedir("GET", tabla, "?select=%s&limit=1" % col)
        borrar = pedir("DELETE", tabla, "?%s=eq.__nada__" % col)
        modif = pedir("PATCH", tabla, "?%s=eq.__nada__" % col, {col: "__nada__"})
        ok_leer = leer in (200, 206)
        ok_borrar = borrar in (401, 403)
        ok_modif = modif in (401, 403)

        def marca(ok, codigo):
            return ("ok %d" % codigo) if ok else ("MAL %d" % codigo)
        print("%-20s %-8s %-10s %-12s" % (tabla, marca(ok_leer, leer), marca(ok_borrar, borrar), marca(ok_modif, modif)))
        mal += (not ok_leer) + (not ok_borrar) + (not ok_modif)
    print()
    if mal:
        print("%d verificacion(es) fallaron: 'MAL 204/200' en borrar o modificar = sigue abierto; "
              "'MAL 4xx' en leer = las apps dejarian de ver esa tabla." % mal)
    else:
        print("Todo OK: la llave publica lee, y no puede borrar ni modificar.")
    return 1 if mal else 0


if __name__ == "__main__":
    sys.exit(main())
