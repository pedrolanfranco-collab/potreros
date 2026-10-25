# -*- coding: utf-8 -*-
"""Pruebas de consultar_stock.py con una red FALSA (no toca internet ni Supabase).

    python scripts/hermes/probar_consultar_stock.py      (o: python -I scripts/hermes/probar_consultar_stock.py)

Verifica:
  - paginacion: 1.003 filas salen en 2 pedidos (offset 0 y 1000) y todas cuentan;
  - potrero sin filas: "0 animales (sin filas en stock_potreros)";
  - filtro por categoria sin tildes ni mayusculas ("novillitos 1-2 anos" encuentra "Novillitos 1-2 años");
  - --json sale valido y marca los potreros sin filas;
  - un error de Supabase sale con codigo 1 y sin traceback;
  - el transporte real (pedir) manda apikey/Authorization y x-clave-campo solo cuando corresponde,
    desde la variable de entorno o desde ~/.potreros/.env (aca, un archivo temporal), y no imprime la clave;
  - las listas copiadas (potreros, duenos, categorias, duenoObligatorio, clave publicable) coinciden con
    template/configs/*.js y template/potreros.template.html.
Ninguna prueba abre una conexion: urllib.request.urlopen esta reemplazado por una guardia que falla.
"""
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from urllib import parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consultar_stock as CS  # noqa: E402

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
try:
    sys.stdout.reconfigure(encoding="utf-8")  # la consola de Windows no es UTF-8 por defecto
except (AttributeError, ValueError):
    pass
fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  -> " + str(detalle)))
    if not cond:
        fallas.append(nombre)


def _red_prohibida(*a, **k):
    raise AssertionError("una prueba intento abrir una conexion real")


urllib.request.urlopen = _red_prohibida  # guardia: ninguna prueba sale a la red


class FakeResp:
    def __init__(self, status, texto):
        self.status = status
        self._t = texto

    def read(self):
        return self._t.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _filas_fake(total_pot_nombre="P", n=1003, est="la_vuelta"):
    """Dataset grande para paginar: n filas, todas en el potrero P<k> con categoria 'Vacas'."""
    return [{"establecimiento": est, "potrero": "%s%d" % (total_pot_nombre, i // 50), "clave": "Vacas||",
             "categoria": "Vacas", "dueno": "", "cantidad": 1, "ug": 1.0} for i in range(n)]


class FakeStock:
    """Responde como PostgREST a los GET de stock_potreros: filtra por establecimiento y potrero, pagina por limit/offset."""

    def __init__(self, filas, status=200):
        self.filas = filas
        self.status = status
        self.pedidos = []

    def __call__(self, metodo, ruta, cuerpo=None, establecimiento=None, extra=None):
        self.pedidos.append((metodo, ruta))
        if self.status != 200:
            return self.status, '{"code":"XX000","message":"caida de prueba"}'
        tabla, _, query = ruta.partition("?")
        q = parse.parse_qs(query, keep_blank_values=True)
        rows = [f for f in self.filas if f["establecimiento"] == q["establecimiento"][0][3:]]
        if "potrero" in q:
            rows = [f for f in rows if f["potrero"] == q["potrero"][0][3:]]
        off = int(q.get("offset", ["0"])[0])
        lim = int(q.get("limit", ["1000"])[0])
        return 200, json.dumps(rows[off:off + lim])


def correr(argv, fake):
    """Corre main() con la red falsa. Devuelve (codigo, stdout, stderr)."""
    viejo = CS.pedir
    CS.pedir = fake
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            codigo = CS.main(argv)
    finally:
        CS.pedir = viejo
    return codigo, out.getvalue(), err.getvalue()


def fila(potrero, categoria, dueno, cantidad, ug, est="la_vuelta"):
    return {"establecimiento": est, "potrero": potrero, "clave": categoria + "||" + dueno,
            "categoria": categoria, "dueno": dueno, "cantidad": cantidad, "ug": ug}


FILAS_LV = [
    fila("10", "Vaquillonas 1-2 años", "", 1, 0.6),
    fila("10", "Vacas", "Pedro Lanfranco", 5, 5.0),
    fila("14", "Terneros", "", 10, 5.0),
    fila("2", "Novillitos 1-2 años", "Silvia Dutra", 3, 2.1),
    fila("6", "Vacas", "", 2, 2.0),
]


def prueba_paginacion():
    print("Paginacion")
    fake = FakeStock(_filas_fake(n=1003))
    codigo, out, err = correr(["--json"], fake)
    pedidos_lecturas = [r for m, r in fake.pedidos if m == "GET"]
    offsets = sorted(int(parse.parse_qs(r.partition("?")[2])["offset"][0]) for r in pedidos_lecturas)
    chequear("pide de a 1000: dos pedidos con offset 0 y 1000", offsets == [0, 1000], offsets)
    datos = json.loads(out)
    chequear("cuenta las 1.003 filas (total 1003 animales)", datos["total"]["animales"] == 1003, datos["total"])
    chequear("sale con codigo 0", codigo == 0, codigo)


def prueba_potrero_sin_filas():
    print("Potrero sin filas")
    codigo, out, err = correr(["--potrero", "7"], FakeStock(FILAS_LV))
    chequear("informa 0 animales con la frase fija", "0 animales (sin filas en stock_potreros)" in out, out)
    chequear("sale con codigo 0", codigo == 0, codigo)
    codigo, out, err = correr(["--potrero", "10"], FakeStock(FILAS_LV))
    chequear("un potrero con filas lista sus renglones y el total",
             "Vaquillonas 1-2 años — (sin firma): 1 (0,6 UG)" in out and "Total del potrero: 6 animales, 5,6 UG" in out, out)


def prueba_categoria_sin_tildes():
    print("Filtro por categoria")
    codigo, out, err = correr(["--categoria", "novillitos 1-2 anos"], FakeStock(FILAS_LV))
    chequear("'novillitos 1-2 anos' encuentra 'Novillitos 1-2 años'", "Novillitos 1-2 años" in out, out)
    chequear("y no trae las vacas", "Vacas" not in out, out)
    codigo, out, err = correr(["--potrero", "6", "--categoria", "terneros"], FakeStock(FILAS_LV))
    chequear("categoria sin filas en el potrero: 0 animales de esa categoria",
             "0 animales de Terneros (sin filas en stock_potreros)" in out, out)


def prueba_json_y_error():
    print("JSON y errores")
    codigo, out, err = correr(["--establecimiento", "maria_laura", "--potrero", "tajamar", "--json"],
                              FakeStock([fila("Tajamar", "Vacas", "Silvia", 4, 4.0, est="maria_laura")]))
    datos = json.loads(out)
    chequear("--json es JSON valido y el potrero se canoniza ('tajamar' -> 'Tajamar')",
             datos["potreros"][0]["potrero"] == "Tajamar" and datos["total"]["animales"] == 4, datos)
    chequear("la salida JSON dice que la fuente es stock_potreros", datos["fuente"] == "stock_potreros", datos)
    codigo, out, err = correr(["--potrero", "99", "--json"], FakeStock(FILAS_LV))
    datos = json.loads(out)
    chequear("un potrero sin filas aparece en el JSON con sin_filas=true",
             datos["potreros"][0]["sin_filas"] is True and datos["potreros"][0]["animales"] == 0, datos)
    codigo, out, err = correr([], FakeStock(FILAS_LV, status=500))
    chequear("error de Supabase: codigo 1 y mensaje en stderr", codigo == 1 and "ERROR" in err, (codigo, err))
    chequear("error de Supabase: sin traceback", "Traceback" not in err and "Traceback" not in out, err)


def prueba_transporte():
    print("Transporte real (pedir) con urlopen falso")
    capturas = []

    def urlopen_falso(req, timeout=None):
        capturas.append(req)
        return FakeResp(201, "")

    viejo_open = urllib.request.urlopen
    viejo_env = dict(os.environ)
    tmp = tempfile.mkdtemp(prefix="hermes_env_")
    archivo = os.path.join(tmp, ".env")
    with open(archivo, "w", encoding="utf-8") as fh:
        fh.write("# clave de prueba\nCLAVE_CAMPO_MARIA_LAURA=clave-de-archivo-1234\n")
    try:
        urllib.request.urlopen = urlopen_falso
        os.environ["POTREROS_ENV"] = archivo
        os.environ["CLAVE_CAMPO_LA_VUELTA"] = "clave-de-entorno-5678"
        os.environ.pop("CLAVE_CAMPO_PONE_CHICO", None)
        st, _ = CS.pedir("GET", "stock_potreros?select=potrero", establecimiento="la_vuelta")
        r = capturas[-1]
        chequear("responde 201 del urlopen falso (status pasa tal cual)", st == 201, st)
        chequear("manda apikey con la clave publicable", r.get_header("Apikey") == CS.CLAVE_PUBLICA, r.headers)
        chequear("manda Authorization Bearer con la clave publicable",
                 r.get_header("Authorization") == "Bearer " + CS.CLAVE_PUBLICA, "")
        chequear("la clave del campo viaja en x-clave-campo (variable de entorno)",
             r.get_header("X-clave-campo") == "clave-de-entorno-5678", "")
        CS.pedir("GET", "x", establecimiento="maria_laura")
        chequear("maria_laura: la clave sale del .env (sin variable de entorno)",
                 capturas[-1].get_header("X-clave-campo") == "clave-de-archivo-1234", "")
        CS.pedir("GET", "x", establecimiento="pone_chico")
        chequear("pone_chico no usa clave: no manda el encabezado",
                 capturas[-1].get_header("X-clave-campo") is None, "")
        os.environ.pop("CLAVE_CAMPO_LA_VUELTA", None)
        POTREROS_SIN = os.path.join(tmp, "no_existe.env")
        os.environ["POTREROS_ENV"] = POTREROS_SIN
        CS.pedir("GET", "x", establecimiento="la_vuelta")
        chequear("sin clave en ningun lado: no manda x-clave-campo (las politicas siguen abiertas)",
                 capturas[-1].get_header("X-clave-campo") is None, "")
        # Un 409 no es excepcion para pedir(): llega como (409, cuerpo)
        def cerrado(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 409, "Conflict", None,
                                         io.BytesIO(b'{"code":"23505","message":"duplicate key"}'))
        urllib.request.urlopen = cerrado
        st, cuerpo = CS.pedir("POST", "eventos_sync", cuerpo={"a": 1}, establecimiento="la_vuelta")
        chequear("un HTTP 409 vuelve como (409, cuerpo) y no revienta", st == 409 and "23505" in cuerpo, (st, cuerpo))
        def sin_red(req, timeout=None):
            raise urllib.error.URLError("sin conexion de prueba")
        urllib.request.urlopen = sin_red
        st, cuerpo = CS.pedir("GET", "x", establecimiento="la_vuelta")
        chequear("sin red vuelve como status 0", st == 0, st)
    finally:
        urllib.request.urlopen = viejo_open
        os.environ.clear()
        os.environ.update(viejo_env)
        for f in (archivo,):
            try:
                os.remove(f)
            except OSError:
                pass
        try:
            os.rmdir(tmp)
        except OSError:
            pass


def _leer(ruta):
    with open(os.path.join(RAIZ, ruta), encoding="utf-8") as fh:
        return fh.read()


def prueba_listas_contra_la_app():
    print("Listas copiadas contra la app")
    for est, archivo in (("la_vuelta", "la-vuelta"), ("maria_laura", "maria-laura"), ("pone_chico", "pone-chico")):
        t = _leer("template/configs/%s.js" % archivo)
        ini = t.index('"potrerosGeo": [')
        fin = t.index('\n  "', ini + 5)
        nombres = re.findall(r'^      "nombre": "([^"]*)"', t[ini:fin], re.M)
        chequear("%s: potreros iguales a potrerosGeo" % est, nombres == CS.ESTABLECIMIENTOS[est]["potreros"],
                 (nombres, CS.ESTABLECIMIENTOS[est]["potreros"]))
        ini = t.index('"duenos": [')
        fin = t.index("]", ini)
        duenos = re.findall(r'"([^"]+)"', t[ini + len('"duenos": ['):fin])
        chequear("%s: duenos iguales a la config" % est, duenos == CS.ESTABLECIMIENTOS[est]["duenos"], duenos)
        m = re.search(r'"duenoObligatorio": (true|false)', t)
        chequear("%s: duenoObligatorio igual a la config" % est,
                 (m.group(1) == "true") == CS.ESTABLECIMIENTOS[est]["dueno_obligatorio"], m and m.group(1))
        m = re.search(r'"claveCampo": (true|false)', t)
        chequear("%s: usa_clave_campo igual a claveCampo" % est,
                 (m.group(1) == "true") == CS.ESTABLECIMIENTOS[est]["usa_clave_campo"], m and m.group(1))
        m = re.search(r'"establecimiento": "([^"]+)"', t)
        chequear("%s: id de establecimiento" % est, m and m.group(1) == est, m and m.group(1))
    tpl = _leer("template/potreros.template.html")
    bloque = tpl[tpl.index("const ESPECIES = {"):tpl.index("const ESPECIE_LABEL")]
    cats = re.findall(r'"([^"]+)":\s*[\d.]+', bloque)
    chequear("las 24 categorias son las de ESPECIES del template", sorted(cats) == sorted(CS.CATEGORIAS),
             (len(cats), sorted(set(cats) ^ set(CS.CATEGORIAS))))
    m = re.search(r"const SUPABASE_ANON_KEY = '([^']+)'", tpl)
    chequear("la clave publicable es la del template (no se imprime)", bool(m) and m.group(1) == CS.CLAVE_PUBLICA)
    m = re.search(r"const SUPABASE_URL = '([^']+)'", tpl)
    chequear("la URL es la del template", bool(m) and m.group(1) == CS.SUPA_URL)


def prueba_normalizar():
    print("Normalizacion")
    chequear("normalizar quita tildes, mayusculas y espacios de mas",
             CS.normalizar("  Vaquillonas   1-2 AÑOS ") == "vaquillonas 1-2 anos")
    chequear("canonico devuelve el nombre de la app", CS.canonico(CS.CATEGORIAS, "toros") == "Toros")
    chequear("canonico de algo que no existe es None", CS.canonico(CS.CATEGORIAS, "vacas flacas") is None)


def main():
    prueba_paginacion()
    prueba_potrero_sin_filas()
    prueba_categoria_sin_tildes()
    prueba_json_y_error()
    prueba_transporte()
    prueba_listas_contra_la_app()
    prueba_normalizar()
    print("")
    if fallas:
        print("FALLARON %d: %s" % (len(fallas), "; ".join(fallas)))
        return 1
    print("Todo OK (consultar_stock).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
