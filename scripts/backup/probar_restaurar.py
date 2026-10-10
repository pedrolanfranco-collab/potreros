"""Prueba de restaurar_backup.py contra un PostgREST falso (no toca la red ni Supabase).

    python scripts/backup/probar_restaurar.py

Verifica (Fase 5 de la auditoria, 10/10/2026):
  - el esquema generado desde el OpenAPI: columnas, tipos, NOT NULL, defaults, clave primaria,
    UNIQUE(event_id) en eventos_sync, RLS activado, sin las vistas, y --con-drop;
  - se niega a escribir en el proyecto real de produccion, en una URL que no sea de Supabase y con
    la llave publica, sin mandar ni un pedido;
  - carga una carpeta de backup completa, con la clave del proyecto de prueba, y la verifica
    (filas por tabla y los event_id de eventos_sync uno por uno);
  - un archivo alterado (sha256 distinto) no se carga; una tabla que falta en el destino y una
    tabla del destino que ya tiene filas se informan;
  - un backup hecho con la llave publica se marca como posiblemente incompleto.
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
import restaurar_backup as R  # noqa: E402

fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)))
    if not cond:
        fallas.append(nombre)


SECRETA = "sb_secret_de_prueba_destino"
destino_tablas = {}        # tabla -> filas (solo existen las que el SQL del esquema habria creado)
pedidos = []               # (metodo, ruta, apikey)


class Falso(BaseHTTPRequestHandler):
    def _responder(self, codigo, cuerpo=None, extra=None):
        crudo = b"" if cuerpo is None else json.dumps(cuerpo).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(crudo)))
        self.end_headers()
        self.wfile.write(crudo)

    def _tabla(self):
        url = urllib.parse.urlparse(self.path)
        m = re.match(r"^/rest/v1/([a-z_0-9]+)$", url.path)
        return (m.group(1) if m else None), urllib.parse.parse_qs(url.query)

    def do_GET(self):
        tabla, q = self._tabla()
        pedidos.append(("GET", self.path.split("?")[0], self.headers.get("apikey", "")))
        if tabla not in destino_tablas:
            return self._responder(404, {"message": "relation does not exist"})
        filas = destino_tablas[tabla]
        lim, off = int(q["limit"][0]), int(q.get("offset", ["0"])[0])
        cols = q.get("select", ["*"])[0]
        trozo = filas[off:off + lim]
        if cols != "*":
            trozo = [{c: f.get(c) for c in cols.split(",")} for f in trozo]
        rango = f"{off}-{off + len(trozo) - 1}/{len(filas)}" if trozo else f"*/{len(filas)}"
        if tabla == "tabla_rara":                         # una respuesta 2xx inesperada que trae filas reales
            return self._responder(203, [{"campo": "FILA-REAL-QUE-NO-SE-IMPRIME"}], {"Content-Range": rango})
        parcial = not (off == 0 and len(trozo) == len(filas))
        self._responder(206 if parcial else 200, trozo, {"Content-Range": rango})

    def do_POST(self):
        tabla, _ = self._tabla()
        largo = int(self.headers.get("Content-Length", 0))
        cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
        pedidos.append(("POST", self.path.split("?")[0], self.headers.get("apikey", "")))
        if tabla not in destino_tablas:
            return self._responder(404, {"message": "relation does not exist"})
        destino_tablas[tabla].extend(cuerpo)
        self._responder(201)

    def log_message(self, *a):
        pass


servidor = HTTPServer(("127.0.0.1", 0), Falso)
threading.Thread(target=servidor.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{servidor.server_port}"


def hacer_backup(raiz, tablas, clave="privada", alterar=None):
    carpeta = os.path.join(raiz, "2026-10-10_1230")
    os.makedirs(carpeta)
    man = {"creado": "2026-10-10T12:30:00", "clave": clave, "tablas_origen": "openapi", "tablas": {}}
    for t, filas in tablas.items():
        ruta = os.path.join(carpeta, t + ".json")
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(filas, f, ensure_ascii=False, indent=1)
        man["tablas"][t] = {"filas": len(filas), "sha256": hashlib.sha256(open(ruta, "rb").read()).hexdigest()}
    if alterar:                                    # cambia un caracter DESPUES de calcular el sha256
        ruta = os.path.join(carpeta, alterar + ".json")
        t = open(ruta, encoding="utf-8").read()
        open(ruta, "w", encoding="utf-8").write(t.replace("e1", "eX", 1))
    with open(os.path.join(carpeta, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(man, f)
    return carpeta


def correr_restaurar(carpeta, clave=SECRETA, base=BASE):
    sal = io.StringIO()
    problemas = []
    with redirect_stdout(sal):
        problemas = R.restaurar(carpeta, base, clave, cargar=True)
    return problemas, sal.getvalue()


# -- 1) esquema ----------------------------------------------------------------------------------
doc = {"definitions": {
    "eventos_sync": {"required": ["id", "tipo"], "properties": {
        "id": {"default": "gen_random_uuid()", "description": "Note:\nThis is a Primary Key.<pk/>", "format": "uuid"},
        "tipo": {"format": "text"}, "detalle": {"format": "jsonb"},
        "creado_en": {"default": "now()", "format": "timestamp with time zone"},
        "event_id": {"format": "uuid"}}},
    "stock_potreros": {"required": ["establecimiento", "clave"], "properties": {
        "establecimiento": {"description": "<pk/>", "format": "text"}, "clave": {"description": "<pk/>", "format": "text"},
        "dueno": {"default": "", "format": "text"}, "cantidad": {"format": "integer"}, "ug": {"format": "numeric"},
        "contador": {"default": "nextval('x_seq'::regclass)", "format": "bigint"}}},
    "auditoria_politicas_antes_fase2": {"properties": {"roles": {"format": "name[]", "type": "array"},
                                                       "raro": {"format": "tipo_inventado"}}},
    "movimientos_dicose_vigentes": {"properties": {"a": {"format": "text"}}},
}}
sql = R.ddl_desde_openapi(doc)
chequear("esquema: una tabla por definicion, sin las vistas", sql.count("create table") == 3 and "movimientos_dicose_vigentes" not in sql, sql)
chequear("esquema: tipos, NOT NULL y defaults", '"id" uuid not null default gen_random_uuid()' in sql and
         '"creado_en" timestamp with time zone default now()' in sql and '"dueno" text default \'\'' in sql, sql)
chequear("esquema: clave primaria simple y compuesta", 'primary key ("id")' in sql and 'primary key ("establecimiento", "clave")' in sql, sql)
chequear("esquema: UNIQUE(event_id) solo en eventos_sync", sql.count("unique (event_id)") == 1)
chequear("esquema: un default con nextval no se copia", "nextval" not in sql)
chequear("esquema: name[] se conserva y un tipo desconocido cae a text", '"roles" name[]' in sql and '"raro" text' in sql, sql)
chequear("esquema: RLS activado en cada tabla", sql.count("enable row level security") == 3)
chequear("esquema: sin --con-drop no borra nada", "drop table" not in sql)
chequear("esquema: con --con-drop borra y recrea", R.ddl_desde_openapi(doc, True).count("drop table if exists") == 3)

# -- 2) destino invalido: ni un pedido -----------------------------------------------------------
chequear("destino: el proyecto REAL se rechaza", "REAL" in R.validar_destino(B.SUPA_URL, SECRETA))
chequear("destino: tambien con el ref en otra URL", "REAL" in R.validar_destino("https://skkknfjpwcstefcroqjt.supabase.co/", SECRETA))
chequear("destino: una URL que no es de Supabase se rechaza", "supabase.co" in R.validar_destino("https://ejemplo.com", SECRETA))
chequear("destino: http sin local se rechaza", R.validar_destino("http://abc.supabase.co", SECRETA) != "")
chequear("destino: la llave publica se rechaza", "PUBLICA" in R.validar_destino("https://abc.supabase.co", "sb_publishable_x"))
chequear("destino: un proyecto de prueba valido pasa", R.validar_destino("https://abc.supabase.co", SECRETA) == "")
pedidos.clear()
os.environ[R.VARIABLE_URL] = B.SUPA_URL
os.environ[R.VARIABLE_CLAVE] = SECRETA
carpeta_x = hacer_backup(tempfile.mkdtemp(), {"stock_potreros": [{"clave": "k"}]})
sal = io.StringIO()
with redirect_stdout(sal):
    codigo = R.main(["cargar", "--carpeta", carpeta_x])
chequear("main: con el destino REAL sale con 2 y no manda ningun pedido", codigo == 2 and not pedidos, (codigo, pedidos))

# -- 3) carga completa ---------------------------------------------------------------------------
os.environ[R.VARIABLE_URL] = BASE
eventos = [{"id": f"i{n}", "event_id": f"e{n}", "tipo": "movimiento"} for n in range(1203)]    # 3 lotes
tablas = {"eventos_sync": eventos, "stock_potreros": [{"clave": f"k{n}"} for n in range(7)], "maestros_dicose": [{"n": 1}]}
destino_tablas.update({t: [] for t in tablas})
carpeta = hacer_backup(tempfile.mkdtemp(), tablas)
pedidos.clear()
problemas, salida = correr_restaurar(carpeta)
chequear("carga: sin problemas", problemas == [], problemas)
chequear("carga: todas las filas quedaron en el destino", {t: len(f) for t, f in destino_tablas.items()} ==
         {"eventos_sync": 1203, "stock_potreros": 7, "maestros_dicose": 1}, {t: len(f) for t, f in destino_tablas.items()})
chequear("carga: eventos_sync en 3 lotes de a 500 como maximo", sum(1 for m, p, k in pedidos if m == "POST" and p.endswith("eventos_sync")) == 3)
chequear("carga: usa solo la clave del proyecto de prueba", {k for m, p, k in pedidos} == {SECRETA})
chequear("carga: verifica los event_id uno por uno", "event_id coinciden uno por uno" in salida, salida)

# -- 4) problemas --------------------------------------------------------------------------------
destino_tablas.update({t: [] for t in tablas})
carpeta = hacer_backup(tempfile.mkdtemp(), {"eventos_sync": [{"id": "1", "event_id": "e1"}], "stock_potreros": [{"clave": "k"}]},
                       alterar="eventos_sync")
problemas, _ = correr_restaurar(carpeta)
chequear("archivo alterado: se detecta por el sha256 y NO se carga", any("sha256" in p for p in problemas) and destino_tablas["eventos_sync"] == [], problemas)
chequear("archivo alterado: la otra tabla si se carga", len(destino_tablas["stock_potreros"]) == 1)

problemas, _ = correr_restaurar(hacer_backup(tempfile.mkdtemp(), {"tabla_que_no_esta": [{"a": 1}]}))
chequear("tabla que falta en el destino: se informa", any("no existe" in p for p in problemas), problemas)

destino_tablas["stock_potreros"] = [{"clave": "vieja"}]
problemas, _ = correr_restaurar(hacer_backup(tempfile.mkdtemp(), {"stock_potreros": [{"clave": "k"}]}))
chequear("destino con filas: no se mezcla, se pide --con-drop", any("ya tiene 1 filas" in p for p in problemas), problemas)

problemas, _ = correr_restaurar(hacer_backup(tempfile.mkdtemp(), {"stock_potreros": [{"clave": "k"}]}, clave="publica"))
chequear("backup con llave publica: se marca como posiblemente incompleto", any("llave publica" in p for p in problemas), problemas)

# -- 4b) PostgREST contesta 206 (parcial): la verificacion lo acepta; un 2xx raro nunca imprime filas
destino_tablas.update({t: [] for t in tablas})
destino_tablas["tabla_rara"] = [{"campo": "x"}]
carpeta206 = hacer_backup(tempfile.mkdtemp(), tablas)
problemas, salida = correr_restaurar(carpeta206)
chequear("206 parcial: la carga se verifica igual (como contesta PostgREST de verdad)", problemas == [], problemas)
problemas, salida = correr_restaurar(hacer_backup(tempfile.mkdtemp(), {"tabla_rara": [{"campo": "x"}]}))
chequear("una respuesta 2xx inesperada se informa sin imprimir las filas del cuerpo",
         problemas and not any("FILA-REAL" in p for p in problemas) and "FILA-REAL" not in salida, problemas)

# -- 5) main de punta a punta --------------------------------------------------------------------
destino_tablas.update({t: [] for t in tablas})
carpeta = hacer_backup(tempfile.mkdtemp(), tablas)
sal = io.StringIO()
with redirect_stdout(sal):
    codigo = R.main(["cargar", "--carpeta", carpeta])
chequear("main cargar: exit 0 y dice RESTAURACION VERIFICADA", codigo == 0 and "RESTAURACION VERIFICADA" in sal.getvalue(), sal.getvalue())
with redirect_stdout(io.StringIO()) as sal2:
    codigo = R.main(["verificar", "--carpeta", carpeta])
chequear("main verificar: sin cargar, exit 0", codigo == 0)

servidor.shutdown()
print("\n" + (f"{len(fallas)} FALLA(S): " + "; ".join(fallas) if fallas else "Todo OK"))
sys.exit(1 if fallas else 0)
