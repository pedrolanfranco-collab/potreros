# -*- coding: utf-8 -*-
"""Prueba de cargar_factura.py contra un Supabase falso (PostgREST + Storage en localhost; sin internet).

    python -I scripts/hermes/probar_cargar_factura.py

Verifica:
  - simula por defecto y NO escribe nada; con --aplicar sin SI tampoco;
  - factura USD con alias por codigo: comprobante con su campo, precios_vet con cantidad x envase, stock que sube;
  - producto sin conteo en ese campo: conteo inicial 0 el dia ANTERIOR a la factura, con uid fijo (no se duplica);
  - conteo posterior a la factura: avisa que esa compra no suma;
  - la misma factura otra vez (aunque el numero venga escrito distinto): "ya estaba", no se duplica nada;
  - producto nuevo para el proveedor: sin "producto" frena y sugiere parecidos; con producto del catalogo crea el alias;
    con producto fuera del catalogo frena;
  - BRL con cotizacion (la guarda), sin cotizacion (carga el stock igual y avisa), con la del dia anterior;
  - frena (sin escribir nada): sin campo, Pone Chico, total que no cierra, proveedor desconocido, fecha futura,
    lista de precios, linea en 0, factura de otro campo;
  - dos lineas del mismo producto y envase se suman (precios_vet guarda una);
  - una linea "no_stock" (balde, caravana) cuenta para el total pero no entra al stock ni crea alias; puede ir en 0;
    si todas son "no_stock", frena;
  - sin el indice unico de comprobantes (SQL sin correr) igual carga;
  - si el servidor dice OK pero no guarda, lo detecta (codigo 2);
  - la foto va al bucket fotos-precios y queda en foto_path;
  - la clave nunca se imprime, una clave publica o ausente corta antes de mandar nada, y no viaja a otro host.
"""
import copy
import datetime
import io
import json
import os
import sys
import tempfile
import threading
import urllib.parse
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_factura as F  # noqa: E402

fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)[:600]))
    if not cond:
        fallas.append(nombre)


SECRETA = "sb_secret_de_prueba_0123456789"
HOY = datetime.date(2026, 11, 17)

UNICOS = {
    "alias_productos": [("proveedor_id", "texto_proveedor")],
    "cotizaciones": [("fecha", "moneda")],
    "comprobantes": [("proveedor_id", "tipo", "numero")],
    "precios_vet": [("comprobante_id", "producto", "contenido_envase")],
    "insumos_ajustes": [("uid",)],
}


def base_inicial():
    return {
        "proveedores": [{"id": 1, "nombre": "El Gaucho", "moneda": "USD", "iva_incluido": False},
                        {"id": 2, "nombre": "Santana", "moneda": "BRL", "iva_incluido": True}],
        "productos_catalogo": [{"producto": p, "valor_dosis_ml": v} for p, v in
                               [("MEXIVER", 0.013), ("Bovisan Total Se", 0.392), ("Tickxan Pour on plus", 0.0344),
                                ("Aspersin", 0.05), ("Ivermectina 1%", 0.02), ("Vanguard 20%", 0.1)]],
        "insumos_alias": [{"texto": "vanguard", "producto": "Vanguard 20%"}],
        "alias_productos": [
            {"id": 1, "proveedor_id": 1, "codigo_proveedor": "100533", "texto_proveedor": "MEXIVER x 500 ml",
             "producto": "MEXIVER", "contenido_envase": 500, "dosis_por_envase": None},
            {"id": 2, "proveedor_id": 1, "codigo_proveedor": "100777", "texto_proveedor": "BOVISAN TOTAL SE x 250ml",
             "producto": "Bovisan Total Se", "contenido_envase": 250, "dosis_por_envase": 50},
            {"id": 3, "proveedor_id": 2, "codigo_proveedor": None, "texto_proveedor": "Aspersin 1 L",
             "producto": "Aspersin", "contenido_envase": 1000, "dosis_por_envase": None}],
        "cotizaciones": [{"fecha": "2026-11-10", "moneda": "BRL", "usd_por_unidad": 0.18, "fuente": "BCU"}],
        "comprobantes": [{"id": 1, "proveedor_id": 1, "tipo": "factura", "numero": "e-Factura A 106208",
                          "fecha": "2026-10-17", "moneda": "USD", "total": 409.0, "condicion": "credito",
                          "establecimiento": "la_vuelta", "foto_path": None}],
        "precios_vet": [{"id": 1, "comprobante_id": 1, "proveedor_id": 1, "producto": "MEXIVER", "fecha": "2026-10-17",
                         "cantidad": 2, "contenido_envase": 500, "dosis_por_envase": None, "precio_unitario": 13,
                         "moneda": "USD", "iva_incluido": False}],
        "insumos_ajustes": [{"id": 1, "establecimiento": "la_vuelta", "producto": "Aspersin", "fecha": "2026-11-04",
                             "tipo": "inicial", "cantidad_ml": 15000, "uid": "00000000-0000-4000-8000-000000000001"},
                            {"id": 2, "establecimiento": "la_vuelta", "producto": "mexiver", "fecha": "2026-11-01",
                             "tipo": "inicial", "cantidad_ml": 1000, "uid": "00000000-0000-4000-8000-000000000002"}],
    }


class Falso:
    db = {}
    posts = []
    fotos = {}
    headers = []
    sin_indice_comprobantes = False
    perder_escrituras = False


def insumo_nombre(t):
    k = (t or "").strip().lower()
    for a in Falso.db["insumos_alias"]:
        if a["texto"] == k:
            return a["producto"]
    for c in Falso.db["productos_catalogo"]:
        if c["producto"].strip().lower() == k:
            return c["producto"]
    return (t or "").strip()


def stock_insumos():
    """Como la vista (sin tratamientos ni baño): ultimo conteo + compras y ajustes posteriores."""
    ini = {}
    for a in Falso.db["insumos_ajustes"]:
        if a["tipo"] == "inicial":
            k = (a["establecimiento"], insumo_nombre(a["producto"]))
            if k not in ini or (a["fecha"], a["id"]) > (ini[k]["fecha"], ini[k]["id"]):
                ini[k] = a
    comps = {c["id"]: c for c in Falso.db["comprobantes"]}
    filas = []
    for (est, prod), a in ini.items():
        ent = sum(p["cantidad"] * p["contenido_envase"] for p in Falso.db["precios_vet"]
                  if comps[p["comprobante_id"]]["establecimiento"] == est and insumo_nombre(p["producto"]) == prod
                  and p["fecha"] > a["fecha"])
        st = a["cantidad_ml"] + ent
        filas.append({"establecimiento": est, "producto": prod, "fecha_conteo": a["fecha"], "inicial_ml": a["cantidad_ml"],
                      "entradas_ml": ent, "salidas_ml": 0, "stock_ml": st,
                      "estado": "ok" if st > 0 else ("sin stock" if st == 0 else "NEGATIVO - revisar")})
    return filas


def filtrar(filas, q):
    out = list(filas)
    for k, vs in q.items():
        if k in ("select", "order", "limit", "offset", "on_conflict"):
            continue
        v = vs[0]
        if v.startswith("eq."):
            out = [f for f in out if str(f.get(k)) == v[3:]]
        elif v.startswith("lte."):
            out = [f for f in out if f.get(k) is not None and str(f.get(k)) <= v[4:]]
        elif v.startswith("in.("):
            vals = v[4:-1].split(",")
            out = [f for f in out if str(f.get(k)) in vals]
    if "order" in q:
        campo, _, sentido = q["order"][0].partition(".")
        out.sort(key=lambda f: str(f.get(campo)), reverse=(sentido == "desc"))
    off = int(q.get("offset", ["0"])[0])
    lim = int(q.get("limit", ["100000"])[0])
    return out[off:off + lim]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _resp(self, codigo, cuerpo):
        datos = json.dumps(cuerpo).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        Falso.headers.append(dict(self.headers.items()))
        u = urllib.parse.urlparse(self.path)
        tabla = u.path.split("/")[-1]
        q = urllib.parse.parse_qs(u.query)
        filas = stock_insumos() if tabla == "stock_insumos" else Falso.db.get(tabla)
        if filas is None:
            return self._resp(404, {"message": "no existe " + tabla})
        self._resp(200, filtrar(filas, q))

    def do_POST(self):
        Falso.headers.append(dict(self.headers.items()))
        u = urllib.parse.urlparse(self.path)
        largo = int(self.headers.get("Content-Length") or 0)
        datos = self.rfile.read(largo)
        if u.path.startswith("/storage/v1/object/"):
            Falso.fotos[u.path[len("/storage/v1/object/"):]] = datos
            return self._resp(200, {"Key": u.path})
        tabla = u.path.split("/")[-1]
        q = urllib.parse.parse_qs(u.query)
        filas = json.loads(datos.decode("utf-8"))
        Falso.posts.append((tabla, q, filas))
        unicos = list(UNICOS.get(tabla, []))
        if tabla == "comprobantes" and Falso.sin_indice_comprobantes:
            unicos = []
        oc = q.get("on_conflict", [None])[0]
        if oc and tuple(oc.split(",")) not in unicos:
            return self._resp(400, {"code": "42P10", "message": "there is no unique or exclusion constraint matching"})
        if Falso.perder_escrituras:
            return self._resp(201, [])
        nuevas = []
        for f in filas:
            choca = any(all(str(f.get(c)) == str(e.get(c)) and f.get(c) is not None for c in u_)
                        for u_ in unicos for e in Falso.db[tabla])
            if choca:
                if oc:
                    continue
                return self._resp(409, {"code": "23505", "message": "duplicate key"})
            f = dict(f)
            if tabla not in ("cotizaciones",):
                f["id"] = max([e.get("id", 0) for e in Falso.db[tabla]] + [0]) + 1
            Falso.db[tabla].append(f)
            nuevas.append(f)
        self._resp(201, nuevas if "return=representation" in (self.headers.get("Prefer") or "") else [])


srv = HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d" % srv.server_port
os.environ["POTREROS_ENV"] = os.path.join(tempfile.mkdtemp(), "no-existe.env")


def reset():
    Falso.db = base_inicial()
    Falso.posts, Falso.fotos, Falso.headers = [], {}, []
    Falso.sin_indice_comprobantes = False
    Falso.perder_escrituras = False
    os.environ[F.VARIABLE_CLAVE] = SECRETA


def correr(factura, *extra, foto=None):
    texto = factura if isinstance(factura, str) else json.dumps(factura)
    argv = ["--json", "-", "--url", URL] + list(extra)
    if foto:
        argv += ["--foto", foto]
    buf = io.StringIO()
    stdin_real, sys.stdin = sys.stdin, io.StringIO("")     # el SI nunca viene del teclado: input() da EOF = "no"
    try:
        with redirect_stdout(buf):
            codigo = F.main(argv, hoy=HOY, entrada=io.StringIO(texto))
    finally:
        sys.stdin = stdin_real
    salida = buf.getvalue()
    if SECRETA in salida:
        fallas.append("la clave aparecio en la salida")
    return codigo, salida


def gaucho(**cambios):
    f = {"proveedor": "El Gaucho", "tipo": "factura", "numero": "A 107001", "fecha": "2026-11-15", "moneda": "USD",
         "total": 175.6, "condicion": "credito", "establecimiento": "la_vuelta",
         "lineas": [{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 4, "precio_unitario": 14.0},
                    {"codigo": "100777", "texto": "BOVISAN TOTAL SE x 250ml", "cantidad": 5, "precio_unitario": 23.92}]}
    f.update(cambios)
    return f


def escrituras():
    return [p for p in Falso.posts]


# ---------------------------------------------------------------------------------------------------------------
print("Simula por defecto")
reset()
cod, out = correr(gaucho())
chequear("simular devuelve 0", cod == 0, out)
chequear("simular no escribe nada", not escrituras(), Falso.posts)
chequear("muestra el stock de MEXIVER 1000 -> 3000", "1000 → 3000" in out, out)
chequear("Bovisan sin conteo: avisa que arranca en 0", "sin conteo: arranca en 0" in out and "1250" in out, out)
chequear("muestra el USD/ml nuevo con variacion", "USD/ml 0.028" in out and "%" in out, out)
chequear("pide --aplicar", "--aplicar" in out, out)

print("--aplicar sin SI no escribe")
reset()
cod, out = correr(gaucho(), "--aplicar")       # input() sin teclado -> EOF -> no
chequear("sin SI devuelve 1", cod == 1, out)
chequear("sin SI no escribe", not escrituras(), Falso.posts)

print("Carga real con --aplicar --si")
reset()
cod, out = correr(gaucho(), "--aplicar", "--si")
chequear("devuelve 0", cod == 0, out)
comp = [c for c in Falso.db["comprobantes"] if c["numero"] == "A 107001"]
chequear("comprobante guardado con su campo", len(comp) == 1 and comp[0]["establecimiento"] == "la_vuelta", comp)
pv = [p for p in Falso.db["precios_vet"] if comp and p["comprobante_id"] == comp[0]["id"]]
chequear("dos lineas en precios_vet con cantidad y envase",
         sorted((p["producto"], p["cantidad"], p["contenido_envase"]) for p in pv) ==
         [("Bovisan Total Se", 5, 250), ("MEXIVER", 4, 500)], pv)
chequear("iva_incluido del proveedor", all(p["iva_incluido"] is False for p in pv), pv)
ini = [a for a in Falso.db["insumos_ajustes"] if a["producto"] == "Bovisan Total Se"]
chequear("conteo 0 de Bovisan el dia anterior a la factura",
         len(ini) == 1 and ini[0]["cantidad_ml"] == 0 and ini[0]["fecha"] == "2026-11-14" and ini[0]["tipo"] == "inicial"
         and ini[0]["dispositivo"] == "hermes-script" and ini[0]["autor"] == "Hermes", ini)
chequear("MEXIVER (ya con conteo) no recibe otro conteo",
         len([a for a in Falso.db["insumos_ajustes"] if insumo_nombre(a["producto"]) == "MEXIVER"]) == 1)
chequear("informa el stock nuevo leido de vuelta", "MEXIVER" in out and "3000 ml" in out and "1250 ml" in out, out)
chequear("apikey sin Bearer (clave sb_secret)",
         all({k.lower(): v for k, v in h.items()}.get("apikey") == SECRETA
             and "authorization" not in {k.lower() for k in h} for h in Falso.headers), Falso.headers[:1])

print("La misma factura otra vez no duplica")
n_comp, n_pv, n_aj = len(Falso.db["comprobantes"]), len(Falso.db["precios_vet"]), len(Falso.db["insumos_ajustes"])
Falso.posts = []
cod, out = correr(gaucho(numero="A-107001"), "--aplicar", "--si")
chequear("devuelve 0 y dice que ya estaba", cod == 0 and "ya estaba cargada completa" in out, out)
chequear("no escribio nada", not escrituras() and len(Falso.db["comprobantes"]) == n_comp
         and len(Falso.db["precios_vet"]) == n_pv and len(Falso.db["insumos_ajustes"]) == n_aj, Falso.posts)
cod, out = correr(gaucho(numero="e-Factura A107001"))
chequear("'e-Factura A107001' es la misma factura", cod == 0 and "ya estaba" in out, out)

print("Factura vieja ya cargada sin conteo: crea solo el conteo 0")
reset()
vieja = gaucho(numero="e-Factura A 106208", fecha="2026-10-17", total=26.0,
               lineas=[{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 2, "precio_unitario": 13}])
cod, out = correr(vieja, "--aplicar", "--si")
chequear("con conteo posterior: ya estaba completa, no escribe", cod == 0 and "ya estaba cargada completa" in out
         and not escrituras(), out)
reset()
Falso.db["insumos_ajustes"] = [a for a in Falso.db["insumos_ajustes"] if a["producto"] != "mexiver"]
cod, out = correr(vieja, "--aplicar", "--si")
chequear("sin conteo: crea solo el conteo 0 del dia anterior", cod == 0 and any(
    a["producto"] == "MEXIVER" and a["fecha"] == "2026-10-16" and a["cantidad_ml"] == 0 for a in Falso.db["insumos_ajustes"]), out)
chequear("no crea comprobante ni lineas", len(Falso.db["comprobantes"]) == 1 and len(Falso.db["precios_vet"]) == 1)
n_aj = len(Falso.db["insumos_ajustes"])
cod, out = correr(vieja, "--aplicar", "--si")
chequear("otra vez: ya completa, el conteo no se duplica", cod == 0 and len(Falso.db["insumos_ajustes"]) == n_aj
         and "ya estaba cargada completa" in out, out)

print("Conteo posterior a la factura")
reset()
cod, out = correr(gaucho(fecha="2026-10-30"))
chequear("avisa que la compra de MEXIVER no suma", "NO suma (conteo del 2026-11-01)" in out, out)

print("Producto nuevo para el proveedor")
reset()
nueva = gaucho(total=60.0, lineas=[{"codigo": "200111", "texto": "IVERMECTINA 1% x 500 ml", "cantidad": 2,
                                    "precio_unitario": 30.0}])
cod, out = correr(nueva, "--aplicar", "--si")
chequear("sin producto frena (1) y sugiere", cod == 1 and "Ivermectina 1%" in out and "Parecidos" in out, out)
chequear("no escribio nada", not escrituras(), Falso.posts)
nueva["lineas"][0]["producto"] = "ivermectina 1%"
nueva["lineas"][0]["contenido_ml"] = 500
cod, out = correr(nueva, "--aplicar", "--si")
chequear("con producto del catalogo carga", cod == 0, out)
al = [a for a in Falso.db["alias_productos"] if a["codigo_proveedor"] == "200111"]
chequear("crea el alias con el nombre exacto del catalogo y el envase",
         len(al) == 1 and al[0]["producto"] == "Ivermectina 1%" and al[0]["contenido_envase"] == 500, al)
chequear("precios_vet con el nombre exacto", any(p["producto"] == "Ivermectina 1%" for p in Falso.db["precios_vet"]))
reset()
mala = gaucho(total=60.0, lineas=[{"codigo": "9", "texto": "COSA RARA", "cantidad": 2, "precio_unitario": 30.0,
                                   "producto": "Cosa rara", "contenido_ml": 100}])
cod, out = correr(mala, "--aplicar", "--si")
chequear("producto fuera del catalogo frena", cod == 1 and "no está en productos_catalogo" in out and not escrituras(), out)
reset()
sin_ml = gaucho(total=60.0, lineas=[{"codigo": "9", "texto": "IVERMEC", "cantidad": 2, "precio_unitario": 30.0,
                                     "producto": "Ivermectina 1%"}])
cod, out = correr(sin_ml)
chequear("producto nuevo sin contenido_ml frena", cod == 1 and "contenido_ml" in out, out)

print("Santana en reales")
reset()
san = {"proveedor": "santana", "numero": "000123", "fecha": "2026-11-12", "moneda": "BRL", "total": 300,
       "establecimiento": "ML", "cotizacion_usd": 0.175,
       "lineas": [{"texto": "Aspersin 1 L", "cantidad": 2, "precio_unitario": 150}]}
cod, out = correr(san, "--aplicar", "--si")
chequear("carga (0)", cod == 0, out)
chequear("guarda la cotizacion del dia", any(c["fecha"] == "2026-11-12" and c["usd_por_unidad"] == 0.175
                                             for c in Falso.db["cotizaciones"]), Falso.db["cotizaciones"])
c2 = [c for c in Falso.db["comprobantes"] if c["numero"] == "000123"]
chequear("va a maria_laura (ML)", c2 and c2[0]["establecimiento"] == "maria_laura", c2)
chequear("Aspersin en ML sin conteo: conteo 0 del 11/11",
         any(a["establecimiento"] == "maria_laura" and a["producto"] == "Aspersin" and a["fecha"] == "2026-11-11"
             for a in Falso.db["insumos_ajustes"]))
chequear("USD/ml con la cotizacion (150*0.175/1000)", "USD/ml 0.0262" in out, out)
reset()
san2 = dict(san, cotizacion_usd=None, fecha="2026-11-13")
cod, out = correr(san2)
chequear("sin cotizacion del dia usa la anterior y avisa", cod == 0 and "del 2026-11-10" in out, out)
reset()
Falso.db["cotizaciones"] = []
cod, out = correr(san2, "--aplicar", "--si")
chequear("sin ninguna cotizacion carga el stock igual", cod == 0 and any(c["numero"] == "000123" for c in Falso.db["comprobantes"]), out)
chequear("y avisa que el precio queda pendiente", "sin cotización BRL" in out and "PENDIENTE" in out, out)

print("Rechazos (no escribe nada)")
casos = [
    ("sin campo", gaucho(establecimiento=None), "a qué campo"),
    ("Pone Chico", gaucho(establecimiento="pone_chico"), "Pone Chico"),
    ("total que no cierra", gaucho(total=999), "suman"),
    ("proveedor desconocido", gaucho(proveedor="Agroveterinaria X"), "no está dado de alta"),
    ("fecha futura", gaucho(fecha="2026-12-01"), "futura"),
    ("lista de precios", gaucho(tipo="lista"), "no entra al stock"),
    ("sin numero", gaucho(numero=""), "número"),
    ("linea en 0", gaucho(total=56.0, lineas=[{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 4,
                                                "precio_unitario": 14.0},
                                               {"codigo": "100777", "texto": "x", "cantidad": 1, "precio_unitario": 0}]),
     "bonificada"),
    ("JSON roto", "{no es json", "JSON"),
]
for nombre, fac, texto in casos:
    reset()
    cod, out = correr(fac, "--aplicar", "--si")
    chequear("%s frena" % nombre, cod == 1 and texto in out and not escrituras(), out)
reset()
Falso.db["comprobantes"][0]["numero"] = "A 107001"
cod, out = correr(gaucho(establecimiento="maria_laura"), "--aplicar", "--si")
chequear("factura ya cargada en otro campo frena", cod == 1 and "ya está cargada para la_vuelta" in out and not escrituras(), out)
reset()
cod, out = correr(gaucho(subtotal=175.6, total=214.23))
chequear("con subtotal sin IVA compara contra el subtotal", cod == 0, out)

print("Dos lineas del mismo producto y envase")
reset()
dup = gaucho(total=60.0, lineas=[{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 2, "precio_unitario": 14.0},
                                 {"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 2, "precio_unitario": 16.0}])
cod, out = correr(dup, "--aplicar", "--si")
pv = [p for p in Falso.db["precios_vet"] if p["producto"] == "MEXIVER" and p["fecha"] == "2026-11-15"]
chequear("se suman en una fila con precio promedio", cod == 0 and len(pv) == 1 and pv[0]["cantidad"] == 4
         and abs(pv[0]["precio_unitario"] - 15.0) < 1e-9, pv)

print("Lineas que no son productos veterinarios (no_stock)")
reset()
mixta = gaucho(subtotal=62.5, total=63.93,
               lineas=[{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 4, "precio_unitario": 14.0},
                       {"codigo": "300200", "texto": "BALDE 10 L", "cantidad": 1, "precio_unitario": 6.5,
                        "no_stock": True}])
cod, out = correr(mixta)
chequear("simula: el balde sale como 'no va al stock' y no frena", cod == 0 and "BALDE 10 L" in out
         and "no va al stock" in out and "1000 → 3000" in out, out)
cod, out = correr(mixta, "--aplicar", "--si")
c4 = [c for c in Falso.db["comprobantes"] if c["numero"] == "A 107001"]
pv = [p for p in Falso.db["precios_vet"] if c4 and p["comprobante_id"] == c4[0]["id"]]
chequear("carga solo el MEXIVER; el comprobante guarda el total con IVA",
         cod == 0 and [p["producto"] for p in pv] == ["MEXIVER"] and c4[0]["total"] == 63.93, (out, pv))
chequear("el balde no crea alias ni conteo", not any("BALDE" in (x.get("texto_proveedor") or "") for x in Falso.db["alias_productos"])
         and not any("balde" in (x.get("producto") or "").lower() for x in Falso.db["insumos_ajustes"]))
reset()
mal_total = gaucho(total=56.0, lineas=[{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 4, "precio_unitario": 14.0},
                                       {"texto": "BALDE 10 L", "cantidad": 1, "precio_unitario": 6.5, "no_stock": True}])
cod, out = correr(mal_total)
chequear("la linea no_stock cuenta para la suma (si falta en el total, frena)", cod == 1 and "suman 62.50" in out, out)
reset()
regalo = gaucho(total=56.0, lineas=[{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 4, "precio_unitario": 14.0},
                                    {"texto": "GORRO PROMOCION", "cantidad": 1, "precio_unitario": 0, "no_stock": True}])
cod, out = correr(regalo)
chequear("una linea no_stock en 0 se acepta", cod == 0 and "GORRO PROMOCION" in out, out)
reset()
solo_balde = gaucho(total=6.5, lineas=[{"texto": "BALDE 10 L", "cantidad": 1, "precio_unitario": 6.5, "no_stock": True}])
cod, out = correr(solo_balde, "--aplicar", "--si")
chequear("todas no_stock: frena sin escribir", cod == 1 and "no hay productos veterinarios" in out and not escrituras(), out)

print("Sin el indice unico de comprobantes (SQL sin correr)")
reset()
Falso.sin_indice_comprobantes = True
cod, out = correr(gaucho(), "--aplicar", "--si")
chequear("carga igual", cod == 0 and len([c for c in Falso.db["comprobantes"] if c["numero"] == "A 107001"]) == 1, out)

print("Servidor que dice OK y no guarda")
reset()
Falso.perder_escrituras = True
cod, out = correr(gaucho(), "--aplicar", "--si")
chequear("lo detecta (2) y pide correr otra vez", cod == 2 and "otra vez" in out, out)

print("Foto")
reset()
foto = os.path.join(tempfile.mkdtemp(), "factura.jpg")
with open(foto, "wb") as fh:
    fh.write(b"\xff\xd8\xff fake jpg")
cod, out = correr(gaucho(), "--aplicar", "--si", foto=foto)
c3 = [c for c in Falso.db["comprobantes"] if c["numero"] == "A 107001"]
chequear("sube al bucket fotos-precios", "fotos-precios/el-gaucho/2026-11-15_a107001.jpg" in Falso.fotos, list(Falso.fotos))
chequear("guarda foto_path", c3 and c3[0]["foto_path"] == "el-gaucho/2026-11-15_a107001.jpg", c3)

print("Clave")
reset()
os.environ[F.VARIABLE_CLAVE] = "sb_publishable_abc"
cod, out = correr(gaucho())
chequear("clave publica corta antes de mandar nada", cod == 1 and "PUBLICA" in out and not Falso.headers, out)
reset()
del os.environ[F.VARIABLE_CLAVE]
cod, out = correr(gaucho())
chequear("sin clave corta antes de mandar nada", cod == 1 and "falta SUPABASE_SECRET_KEY" in out and not Falso.headers, out)
reset()
buf = io.StringIO()
with redirect_stdout(buf):
    cod = F.main(["--json", "-", "--url", "https://otro-host.example.com"], hoy=HOY, entrada=io.StringIO(json.dumps(gaucho())))
chequear("no manda la clave a otro host", cod == 1 and "no es de Supabase" in buf.getvalue() and not Falso.headers)

srv.shutdown()
print("")
if fallas:
    print("FALLARON %d: %s" % (len(fallas), "; ".join(fallas)))
    sys.exit(1)
print("Todo bien.")
