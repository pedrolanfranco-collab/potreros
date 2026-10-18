# -*- coding: utf-8 -*-
"""Prueba de cargar_sanidad_csv.py contra un PostgREST falso (no toca la red ni Supabase).

    python scripts/sanidad/probar_cargar_sanidad_csv.py

Verifica:
  - simula por defecto: valida, lista lo que cargaria y NO escribe;
  - con --aplicar inserta solo lo nuevo, con la clave privada (apikey, sin Bearer), y lo verifica;
  - idempotente: una segunda corrida no inserta nada;
  - todo o nada: una fila con error (producto fuera del catalogo, fecha futura, dosis ausente, gen de 4
    digitos, cantidad 0, producto2 sin dosis2) frena TODO, tambien con --aplicar;
  - producto sin importar tildes ni mayusculas, guardado con el nombre exacto del catalogo, y con sugerencias;
  - separador ; y , , decimales con coma, fechas AAAA-MM-DD y DD/MM/AAAA, encabezados con tildes y alias;
  - filas iguales en el archivo -> ids distintos; el id no cambia si cambian solo las observaciones;
  - maria_laura / pone_chico: tabla propia, exigen dueno, no llevan establecimiento;
  - la clave nunca se imprime, no viaja a otra direccion que Supabase/localhost, y una clave publica o
    ausente corta antes de mandar nada;
  - si el servidor contesta OK pero no guardo (RLS), lo detecta.
"""
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
import cargar_sanidad_csv as C  # noqa: E402

fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)))
    if not cond:
        fallas.append(nombre)


SECRETA = "sb_secret_de_prueba_0123456789"
HOY = datetime.date(2026, 10, 18)
CATALOGO = ["Bovisan Total Se", "Ricoverm", "Ivermectina 1%", "Ácido Fólico"]


class Falso:
    """Estado del servidor falso."""
    tablas = {}            # tabla -> {id: fila}
    posts = []             # (tabla, query, headers, filas)
    gets = []              # (path, headers)
    perder_escrituras = False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _responder(self, codigo, cuerpo):
        datos = json.dumps(cuerpo).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        tabla = u.path.split("/")[-1]
        Falso.gets.append((self.path, {k.lower(): v for k, v in self.headers.items()}))
        if tabla == "productos_catalogo":
            off = int(q.get("offset", ["0"])[0])
            return self._responder(200, [{"producto": p} for p in CATALOGO] if off == 0 else [])
        if "id" in q:
            ids = q["id"][0].strip("in.()").split(",")
            return self._responder(200, [{"id": i} for i in ids if i in Falso.tablas.get(tabla, {})])
        self._responder(200, [])

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        tabla = u.path.split("/")[-1]
        largo = int(self.headers.get("Content-Length", 0))
        filas = json.loads(self.rfile.read(largo).decode("utf-8"))
        Falso.posts.append((tabla, u.query, {k.lower(): v for k, v in self.headers.items()}, filas))
        if not Falso.perder_escrituras:
            for f in filas:
                Falso.tablas.setdefault(tabla, {}).setdefault(f["id"], f)
        self._responder(201, [])


servidor = HTTPServer(("127.0.0.1", 0), Handler)
URL = "http://127.0.0.1:%d" % servidor.server_address[1]
threading.Thread(target=servidor.serve_forever, daemon=True).start()


def reiniciar():
    Falso.tablas, Falso.posts, Falso.gets, Falso.perder_escrituras = {}, [], [], False


def csv_temp(texto):
    fd, ruta = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write(texto)
    return ruta


def correr(texto, *args, clave=SECRETA, hoy=HOY):
    """(codigo, salida). Escribe el CSV temporal y corre main() con la clave dada."""
    ruta = csv_temp(texto)
    viejo = os.environ.get(C.VARIABLE_CLAVE)
    viejo_env = C.ARCHIVO_ENV
    C.ARCHIVO_ENV = os.path.join(tempfile.gettempdir(), "no_existe_potreros.env")
    if clave:
        os.environ[C.VARIABLE_CLAVE] = clave
    else:
        os.environ.pop(C.VARIABLE_CLAVE, None)
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            codigo = C.main([ruta, "--url", URL] + list(args), hoy=hoy)
    finally:
        os.remove(ruta)
        C.ARCHIVO_ENV = viejo_env
        if viejo is None:
            os.environ.pop(C.VARIABLE_CLAVE, None)
        else:
            os.environ[C.VARIABLE_CLAVE] = viejo
    return codigo, buf.getvalue()


BUENO = ("fecha;categoria;potrero;cantidad;gen;producto1;dosis1;producto2;dosis2;observaciones\n"
         "2026-10-15;Vacas;12;60;;bovisan total se;5;;;sin gen\n"
         "16/10/2026;Terneros;21;80;6;Ricoverm;2,5;Bovisan Total Se;5;con gen y dos productos\n")

print("Simulacion por defecto")
reiniciar()
cod, sal = correr(BUENO)
chequear("simula: codigo 0 y no escribe", cod == 0 and not Falso.posts, sal)
chequear("lista las dos filas como NUEVA", sal.count("NUEVA") == 2 and "2 para cargar" in sal, sal)
chequear("avisa que fue una simulacion", "simulacion" in sal)
chequear("lee el catalogo con la clave privada (apikey, sin Bearer)",
         any("productos_catalogo" in p and h.get("apikey") == SECRETA and "authorization" not in h for p, h in Falso.gets))
chequear("la clave no sale en la salida", SECRETA not in sal)

print("Con --aplicar")
reiniciar()
cod, sal = correr(BUENO, "--aplicar")
chequear("codigo 0 y un solo POST", cod == 0 and len(Falso.posts) == 1, sal)
tabla, query, cab, filas = Falso.posts[0]
chequear("va a sanidad_carga con on_conflict=id e ignore-duplicates", tabla == "sanidad_carga" and "on_conflict=id" in query
         and "ignore-duplicates" in cab.get("prefer", ""))
chequear("manda apikey y no Bearer", cab.get("apikey") == SECRETA and "authorization" not in cab)
f0, f1 = filas
chequear("La Vuelta: establecimiento, sin dueno, caravana y sin_caravana en null",
         f0["establecimiento"] == "la_vuelta" and "dueno" not in f0 and f0["caravana"] is None and f0["sin_caravana"] is None)
chequear("producto con el nombre exacto del catalogo", f0["producto1"] == "Bovisan Total Se")
chequear("coma decimal, fecha DD/MM/AAAA, gen y producto2", f1["dosis1"] == 2.5 and f1["fecha"] == "2026-10-16" and f1["gen"] == 6
         and f1["producto2"] == "Bovisan Total Se" and f1["dosis2"] == 5.0)
chequear("sin gen -> null, sin producto2 -> null", f0["gen"] is None and f0["producto2"] is None and f0["dosis2"] is None)
chequear("el id empieza con csv_ y no hay campos internos", f0["id"].startswith("csv_") and not any(k.startswith("_") for k in f0))
chequear("verifica que llegaron", "verificados" in sal)
chequear("La Vuelta avisa de la Planilla", "Planilla" in sal)
ids1 = [f["id"] for f in filas]

print("Idempotencia")
cod, sal = correr(BUENO, "--aplicar")
chequear("segunda corrida: ya estaban, no hay POST nuevo", cod == 0 and len(Falso.posts) == 1 and sal.count("ya estaba ") == 2, sal)
cod, sal = correr(BUENO.replace("sin gen", "otra observacion"), "--aplicar")
chequear("cambiar solo las observaciones no duplica", len(Falso.posts) == 1 and "No hay nada nuevo" in sal)

print("Todo o nada")
reiniciar()
malo = BUENO + "2026-10-16;Vacas;3;10;;Producto Inventado;1;;;x\n"
cod, sal = correr(malo, "--aplicar")
chequear("un producto fuera del catalogo frena todo", cod == 2 and not Falso.posts, sal)
chequear("lo nombra con su linea", "linea 4" in sal and "no esta en el catalogo" in sal)
cod, sal = correr(BUENO + "2026-10-16;Vacas;3;10;;Ricoveer;1;;;x\n", "--aplicar")
chequear("sugiere el parecido", "Ricoverm" in sal and cod == 2, sal)
casos = [
    ("fecha futura", "2026-12-01;Vacas;3;10;;Ricoverm;1;;;", "futura"),
    ("fecha ilegible", "ayer;Vacas;3;10;;Ricoverm;1;;;", "no entiendo la fecha"),
    ("sin dosis", "2026-10-16;Vacas;3;10;;Ricoverm;;;;", "falta dosis1"),
    ("dosis cero", "2026-10-16;Vacas;3;10;;Ricoverm;0;;;", "dosis1"),
    ("cantidad 0", "2026-10-16;Vacas;3;0;;Ricoverm;1;;;", "cantidad"),
    ("cantidad con decimales", "2026-10-16;Vacas;3;2,5;;Ricoverm;1;;;", "cantidad"),
    ("gen de 4 digitos", "2026-10-16;Vacas;3;10;2025;Ricoverm;1;;;", "ULTIMO digito"),
    ("producto2 sin dosis2", "2026-10-16;Vacas;3;10;;Ricoverm;1;Bovisan Total Se;;", "dosis2"),
    ("falta categoria", "2026-10-16;;3;10;;Ricoverm;1;;;", "falta categoria"),
]
for nombre, linea, esperado in casos:
    reiniciar()
    cod, sal = correr(BUENO.split("\n")[0] + "\n" + linea + "\n", "--aplicar")
    chequear("error: " + nombre, cod == 2 and not Falso.posts and esperado in sal, sal)

print("Formatos")
reiniciar()
coma = ("Fecha,Categoría,Potrero,Cantidad,Producto,Dosis,Obs\n"
        '2026-10-15,Vacas,12,60,"ÁCIDO FÓLICO","1,5",con coma\n')
cod, sal = correr(coma, "--aplicar")
chequear("separador coma, encabezados con tildes y alias, producto sin tildes/mayusculas",
         cod == 0 and Falso.posts and Falso.posts[0][3][0]["producto1"] == "Ácido Fólico" and Falso.posts[0][3][0]["dosis1"] == 1.5, sal)
chequear("si todas las columnas se entienden no hay avisos de columnas", "columna ignorada" not in sal)
cod, sal = correr(BUENO.replace("observaciones", "color_de_la_caravana"))
chequear("una columna que no conoce se ignora con aviso", "columna ignorada: 'color_de_la_caravana'" in sal and cod == 0, sal)
reiniciar()
cod, sal = correr("fecha;categoria\n2026-10-15;Vacas\n")
chequear("columnas obligatorias que faltan", cod == 1 and "faltan las columnas" in sal and "potrero" in sal, sal)
cod, sal = correr("fecha;categoria;potrero;cantidad;producto1;dosis1\n")
chequear("sin filas", cod == 1, sal)
reiniciar()
dup = ("fecha;categoria;potrero;cantidad;producto1;dosis1\n"
       "2026-10-15;Vacas;12;60;Ricoverm;1\n2026-10-15;Vacas;12;60;Ricoverm;1\n")
cod, sal = correr(dup, "--aplicar")
ids = [f["id"] for f in Falso.posts[0][3]] if Falso.posts else []
chequear("dos filas iguales en el archivo se cargan como dos, con ids distintos", len(ids) == 2 and ids[0] != ids[1] and "igual a otra" in sal, sal)

print("Maria Laura / Pone Chico")
for est, tabla_esp in (("maria_laura", "sanidad_carga_maria_laura"), ("pone_chico", "sanidad_carga_pone_chico")):
    reiniciar()
    cod, sal = correr(BUENO, "--establecimiento", est, "--aplicar")
    chequear(est + ": sin la columna dueno no carga", cod == 1 and "dueno" in sal and not Falso.posts, sal)
    conduenyo = BUENO.replace("observaciones", "dueno;observaciones").replace(";sin gen", ";Pedro;sin gen").replace(";con gen y dos productos", ";Silvia;con gen")
    conduenyo = ("fecha;categoria;potrero;cantidad;gen;producto1;dosis1;producto2;dosis2;dueno\n"
                 "2026-10-15;Vacas;12;60;;Ricoverm;5;;;Pedro\n")
    cod, sal = correr(conduenyo, "--establecimiento", est, "--aplicar")
    ok = cod == 0 and Falso.posts and Falso.posts[0][0] == tabla_esp
    fila = Falso.posts[0][3][0] if Falso.posts else {}
    chequear(est + ": va a " + tabla_esp + " con dueno y sin establecimiento",
             ok and fila.get("dueno") == "Pedro" and "establecimiento" not in fila, sal)
    chequear(est + ": no habla de la Planilla", "Planilla" not in sal)

print("Clave y destino")
reiniciar()
cod, sal = correr(BUENO, clave=None)
chequear("sin clave privada: avisa y no manda nada", cod == 1 and "SUPABASE_SECRET_KEY" in sal and not Falso.gets and not Falso.posts, sal)
cod, sal = correr(BUENO, clave="sb_publishable_clave_publica_de_prueba")
chequear("la clave publica se rechaza antes de mandar", cod == 1 and "PUBLICA" in sal and not Falso.gets, sal)
ruta = csv_temp(BUENO)
os.environ[C.VARIABLE_CLAVE] = SECRETA
buf = io.StringIO()
with redirect_stdout(buf):
    cod = C.main([ruta, "--url", "https://servidor-ajeno.example.com"], hoy=HOY)
os.environ.pop(C.VARIABLE_CLAVE, None)
os.remove(ruta)
chequear("una direccion que no es Supabase: no manda la clave", cod == 1 and "no es de Supabase" in buf.getvalue() and not Falso.gets, buf.getvalue())
chequear("el destino real esta permitido y es el de siempre", C._url_valida(C.SUPA_URL) and not C._url_valida("https://skkknfjpwcstefcroqjt.supabase.co.malo.com"))

print("RLS: contesta OK pero no guarda")
reiniciar()
Falso.perder_escrituras = True
cod, sal = correr(BUENO, "--aplicar")
chequear("lo detecta y sale con error", cod == 1 and "ATENCION" in sal and "RLS" in sal, sal)

servidor.shutdown()
print("\nTODO OK" if not fallas else "\n%d FALLAS: %s" % (len(fallas), "; ".join(fallas)))
sys.exit(1 if fallas else 0)
