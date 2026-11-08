# -*- coding: utf-8 -*-
"""Pruebas de consultar_mcp.py con la red falsa: no toca Supabase ni imprime claves."""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consultar_stock as cs  # noqa: E402
import consultar_mcp as mcp  # noqa: E402

pedidos = []

FILAS = {
    "stock_potreros": [
        {"potrero": "Casco", "clave": "Vacas||Mili", "categoria": "Vacas", "dueno": "Mili", "cantidad": 10, "ug": 10},
        {"potrero": "Casco", "clave": "Vacas||Perico", "categoria": "Vacas", "dueno": "Perico", "cantidad": 5, "ug": 5},
    ],
    "sanidad_ultimos": [{"fecha_txt": "01/10/2026", "categoria": "Vacas", "potrero": "Casco", "cantidad": 15,
                         "productos": "Ivermectina", "dosis": "1 cc", "costo_animal": 3.5}],
    "sanidad_proximos": [{"categoria": "Vacas", "sanidad": "Aftosa", "animales": 15, "dias": 10}],
    "animales_caravana": [{"id8": "123", "categoria": "Vacas", "estado_carencia": "En carencia",
                           "propietario": "Mili", "ultimo_peso": 400}],
    "eventos_sync": [{"tipo": "venta", "potrero": "Casco", "detalle": {"fin": 1000}}],
}


def falsa(metodo, ruta, cuerpo=None, establecimiento=None, extra=None):
    pedidos.append((metodo, ruta, establecimiento))
    tabla = ruta.split("?")[0]
    filas = [dict(f) for f in FILAS[tabla]]
    cols = dict(parse_qs(ruta)).get("select", "")
    if tabla != "stock_potreros" and cols:  # como PostgREST: solo las columnas pedidas
        pedidas = cols.split(",")
        filas = [{k: v for k, v in f.items() if k in pedidas} for f in filas]
    return 200, json.dumps(filas)


def parse_qs(ruta):
    from urllib import parse
    return parse.parse_qsl(ruta.split("?", 1)[1]) if "?" in ruta else []


def j(texto):
    return json.loads(texto)


def main():
    cs.pedir = falsa
    pruebas = []

    basico = mcp.construir("basico", ["maria_laura"])
    completo = mcp.construir("completo", ["la_vuelta", "maria_laura"])

    pruebas += [
        ("basico no tiene la herramienta de eventos", "eventos" not in basico),
        ("completo si la tiene", "eventos" in completo),
        ("ninguna herramienta escribe: solo hay lecturas", set(basico) == {"stock", "sanidad_realizada", "sanidad_proxima", "animales"}),
    ]

    # stock: el basico suma por categoria y no muestra propietarios
    s = j(basico["stock"]())
    texto = json.dumps(s)
    pruebas += [
        ("basico: stock sin propietarios", "Mili" not in texto and "Perico" not in texto and "dueno" not in texto),
        ("basico: suma las categorias de los duenos", s["potreros"][0]["filas"][0]["cantidad"] == 15),
        ("basico: total de animales", s["total_animales"] == 15),
    ]
    c = j(completo["stock"](campo="maria laura"))
    pruebas.append(("completo: ve los propietarios", "Mili" in json.dumps(c) and "Perico" in json.dumps(c)))

    # sanidad: el basico no ve costos
    pruebas += [
        ("basico: sanidad sin costos", "costo_animal" not in basico["sanidad_realizada"]()),
        ("completo: sanidad con costos", "costo_animal" in completo["sanidad_realizada"]()),
        ("basico: proximos funciona", j(basico["sanidad_proxima"]())["cantidad"] == 1),
    ]

    # animales: el basico no ve propietario ni pesos
    a = basico["animales"](caravana="123")
    pruebas += [
        ("basico: animales sin propietario ni peso", "propietario" not in a and "ultimo_peso" not in a),
        ("basico: si ve la carencia", "En carencia" in a),
        ("completo: animales con propietario y peso",
         "propietario" in completo["animales"](caravana="123") and "ultimo_peso" in completo["animales"](caravana="123")),
    ]
    pruebas.append(("completo: eventos devuelve el historial", j(completo["eventos"]())["cantidad"] == 1))

    # acceso por campo
    antes = len(pedidos)
    negado = basico["stock"](campo="La Vuelta")
    pruebas += [
        ("sin pedir campo usa el unico que tiene", j(basico["stock"]())["campo"] == "María Laura"),
        ("basico de Maria Laura NO ve La Vuelta", "No tenes acceso" in negado),
        ("el pedido a La Vuelta ni sale a la red", len(pedidos) == antes + 1 and pedidos[-1][2] == "maria_laura"),
        ("completo de los dos campos usa La Vuelta por defecto", j(completo["stock"]())["campo"] == "La Vuelta"),
    ]

    # nombres malos: error claro, nunca "0"
    pruebas += [
        ("categoria desconocida da error", "No existe la categoria" in basico["stock"](categoria="dinosaurios")),
        ("potrero desconocido da error", "No existe el potrero" in basico["stock"](potrero="Marte")),
        ("caravana con caracteres raros se rechaza", "no es valido" in basico["animales"](caravana="1),(or=")),
        ("campo desconocido da error", "No conozco el campo" in completo["stock"](campo="Narnia")),
    ]

    # solo lecturas
    pruebas.append(("todos los pedidos fueron GET", all(p[0] == "GET" for p in pedidos)))

    # falla cerrado sin configuracion
    env = {k: v for k, v in os.environ.items() if not k.startswith("HERMES_CONSULTA_")}
    r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "consultar_mcp.py")],
                       env=env, capture_output=True, timeout=30)
    pruebas.append(("sin variables el servidor no arranca", r.returncode != 0))
    env.update(HERMES_CONSULTA_PERFIL="completo", HERMES_CONSULTA_CAMPOS="narnia")
    r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "consultar_mcp.py")],
                       env=env, capture_output=True, timeout=30)
    pruebas.append(("con un campo desconocido no arranca", r.returncode != 0))

    fallos = sum(not ok for _, ok in pruebas)
    for etiqueta, ok in pruebas:
        print(("✓ " if ok else "✗ ") + etiqueta)
    print("\n%d/%d pruebas correctas" % (len(pruebas) - fallos, len(pruebas)))
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
