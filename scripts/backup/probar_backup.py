"""Prueba de backup_supabase.py contra un PostgREST falso (no toca la red ni Supabase).

    python scripts/backup/probar_backup.py

Verifica (Fase 5 de la auditoria, 10/10/2026):
  - con clave privada descubre las tablas desde el OpenAPI, deja afuera las vistas y baja todo
    (pagina de a 1000) con la clave privada, nunca con la publica;
  - el manifest tiene las filas y el sha256 de cada archivo, la clave usada y el origen de la lista;
  - si una tabla pierde mas del 10%, o desaparece, sale ALERTA (exit 2), por ntfy, y no se borra
    ningun backup viejo;
  - sin clave privada hace el backup con la publica y la lista fija, pero sale con 1 y avisa;
  - si el OpenAPI falla cae a la lista fija y sale con 1;
  - el tema de ntfy no aparece en el log del backup.
"""
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import threading
import urllib.parse
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backup_supabase as B  # noqa: E402

B.time.sleep = lambda s: None
fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)))
    if not cond:
        fallas.append(nombre)


SECRETA = "sb_secret_de_prueba_0123456789"
TEMA = "tema-ntfy-de-prueba-" + "z" * 20
datos = {}                 # tabla -> lista de filas
vistas = {"movimientos_dicose_vigentes": [{"a": 1}]}
pedidos = []               # (ruta, apikey)
openapi_ok = {"valor": True}
avisos = []                # lo que recibe el ntfy falso


class Falso(BaseHTTPRequestHandler):
    def _responder(self, codigo, cuerpo, extra=None):
        crudo = json.dumps(cuerpo).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(crudo)))
        self.end_headers()
        self.wfile.write(crudo)

    def do_POST(self):                                   # ntfy
        largo = int(self.headers.get("Content-Length", 0))
        avisos.append(json.loads(self.rfile.read(largo).decode("utf-8")))
        self._responder(200, {})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        clave = self.headers.get("apikey", "")
        pedidos.append((url.path, clave))
        if url.path == "/rest/v1/":
            if not openapi_ok["valor"] or clave != SECRETA:
                return self._responder(401, {"message": "Secret API key required"})
            defs = {t: {} for t in list(datos) + list(vistas)}
            return self._responder(200, {"definitions": defs})
        m = re.match(r"^/rest/v1/([a-z_0-9]+)$", url.path)
        tabla = m.group(1) if m else None
        if tabla not in datos and tabla not in vistas:
            return self._responder(404, {"message": "no existe"})
        filas = datos.get(tabla, vistas.get(tabla))
        q = urllib.parse.parse_qs(url.query)
        lim, off = int(q["limit"][0]), int(q["offset"][0])
        trozo = filas[off:off + lim]
        rango = f"{off}-{off + len(trozo) - 1}/{len(filas)}" if trozo else f"*/{len(filas)}"
        self._responder(200, trozo, {"Content-Range": rango})

    def log_message(self, *a):
        pass


servidor = HTTPServer(("127.0.0.1", 0), Falso)
threading.Thread(target=servidor.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{servidor.server_port}"
os.environ["NTFY_URL"] = BASE + "/"
os.environ["NTFY_TOPIC"] = TEMA
B.ARCHIVO_ENV = os.path.join(tempfile.gettempdir(), "no_existe_potreros.env")
B.ENV_XRS2 = B.ARCHIVO_ENV

# -- 1) corrida normal con clave privada ---------------------------------------------------------
datos["eventos_sync"] = [{"id": i, "event_id": f"e{i}", "creado_en": f"2026-10-{1 + i % 28:02d}"} for i in range(2500)]
datos["stock_potreros"] = [{"clave": f"k{i}"} for i in range(5)]
datos["maestros_dicose"] = [{"n": i} for i in range(3)]
B._clave_privada = lambda: (SECRETA, "")
destino = tempfile.mkdtemp()


def correr(destino, **kw):
    sal = io.StringIO()
    with redirect_stdout(sal):
        codigo = B.main(["--destino", destino], base=BASE, **kw)
    return codigo, sal.getvalue()


codigo, salida = correr(destino)
chequear("clave privada: sale con 0", codigo == 0, salida)
carpetas = B.carpetas_backup(destino)
chequear("se creo una carpeta de backup", len(carpetas) == 1, carpetas)
c1 = os.path.join(destino, carpetas[0])
archivos = sorted(f for f in os.listdir(c1) if f.endswith(".json") and f != "manifest.json")
chequear("baja las 3 tablas descubiertas y deja afuera la vista", archivos == ["eventos_sync.json", "maestros_dicose.json", "stock_potreros.json"], archivos)
filas_es = json.load(open(os.path.join(c1, "eventos_sync.json"), encoding="utf-8"))
chequear("pagina: 2500 eventos completos (3 paginas de 1000)", len(filas_es) == 2500 and filas_es[-1]["id"] == 2499, len(filas_es))
man = json.load(open(os.path.join(c1, "manifest.json"), encoding="utf-8"))
chequear("manifest: filas por tabla", man["tablas"]["eventos_sync"]["filas"] == 2500 and man["tablas"]["maestros_dicose"]["filas"] == 3)
chequear("manifest: sha256 coincide con el archivo", man["tablas"]["stock_potreros"]["sha256"] ==
         hashlib.sha256(open(os.path.join(c1, "stock_potreros.json"), "rb").read()).hexdigest())
chequear("manifest: clave privada y lista del OpenAPI", man["clave"] == "privada" and man["tablas_origen"] == "openapi", man)
claves_tablas = {k for p, k in pedidos if p != "/rest/v1/"}
chequear("todas las lecturas de tablas fueron con la clave privada", claves_tablas == {SECRETA}, claves_tablas)
chequear("no hubo aviso por ntfy en una corrida sana", len(avisos) == 0, avisos)

# -- 2) una tabla pierde mas del 10%: ALERTA -----------------------------------------------------
import time as _t
os.rename(c1, os.path.join(destino, "2026-01-01_0000"))      # el backup anterior; la corrida nueva tiene otro nombre
datos["eventos_sync"] = datos["eventos_sync"][:2000]
codigo, salida = correr(destino)
chequear("cayo mas del 10%: ALERTA (exit 2)", codigo == 2 and "ALERTA" in salida, salida)
chequear("la alerta sale por ntfy con la tabla y las cantidades", len(avisos) == 1 and "eventos_sync: 2500 -> 2000" in avisos[0]["message"], avisos)
chequear("ntfy: prioridad alta al tema configurado", avisos and avisos[0]["priority"] == 4 and avisos[0]["topic"] == TEMA)
chequear("con alerta no se borra ningun backup viejo", "2026-01-01_0000" in B.carpetas_backup(destino))

# -- 3) una tabla desaparece ---------------------------------------------------------------------
avisos.clear()
destino3 = tempfile.mkdtemp()
datos["eventos_sync"] = [{"id": i, "event_id": f"e{i}", "creado_en": "2026-10-01"} for i in range(50)]
codigo, _ = correr(destino3)
carpeta = os.path.join(destino3, B.carpetas_backup(destino3)[0])
os.rename(carpeta, os.path.join(destino3, "2026-01-01_0000"))
del datos["maestros_dicose"]
codigo, salida = correr(destino3)
chequear("una tabla del backup anterior ya no existe: ALERTA", codigo == 2 and "maestros_dicose" in salida and "ya no existe" in salida, salida)
datos["maestros_dicose"] = [{"n": i} for i in range(3)]

# -- 4) sin clave privada ------------------------------------------------------------------------
avisos.clear()
pedidos.clear()
B._clave_privada = lambda: (None, "no hay clave privada de Supabase")
destino4 = tempfile.mkdtemp()
datos.update({t: [{"x": 1}] for t in B.TABLAS if t not in datos})     # que la lista fija exista en el falso
codigo, salida = correr(destino4)
man4 = json.load(open(os.path.join(destino4, B.carpetas_backup(destino4)[0], "manifest.json"), encoding="utf-8"))
chequear("sin clave privada: sale con 1 (el backup es parcial)", codigo == 1, salida)
chequear("sin clave privada: manifest dice llave publica y lista fija", man4["clave"] == "publica" and man4["tablas_origen"] == "fija", man4)
chequear("sin clave privada: usa SOLO la llave publica", {k for p, k in pedidos} == {B.SUPA_KEY_PUBLICA}, {k for p, k in pedidos})
chequear("sin clave privada: avisa por ntfy", len(avisos) == 1 and "sin clave privada" in avisos[0]["message"], avisos)

# -- 5) el OpenAPI falla: lista fija -------------------------------------------------------------
avisos.clear()
B._clave_privada = lambda: (SECRETA, "")
openapi_ok["valor"] = False
destino5 = tempfile.mkdtemp()
codigo, salida = correr(destino5)
man5 = json.load(open(os.path.join(destino5, B.carpetas_backup(destino5)[0], "manifest.json"), encoding="utf-8"))
chequear("OpenAPI caido: usa la lista fija y sale con 1", codigo == 1 and man5["tablas_origen"] == "fija", (codigo, man5.get("tablas_origen")))
openapi_ok["valor"] = True

# -- 6) clave publica puesta como privada --------------------------------------------------------
import importlib
os.environ["SUPABASE_SECRET_KEY"] = B.SUPA_KEY_PUBLICA
importlib.reload(B)
clave, problema = B._clave_privada()
chequear("una clave publica puesta como privada se rechaza", clave is None and "PUBLICA" in problema, (clave, problema))
os.environ.pop("SUPABASE_SECRET_KEY")

# -- 7) el tema no queda en el log ---------------------------------------------------------------
log = open(os.path.join(destino, "backup.log"), encoding="utf-8").read()
chequear("el tema de ntfy no aparece en backup.log", TEMA not in log)

servidor.shutdown()
print("\n" + (f"{len(fallas)} FALLA(S): " + "; ".join(fallas) if fallas else "Todo OK"))
sys.exit(1 if fallas else 0)
