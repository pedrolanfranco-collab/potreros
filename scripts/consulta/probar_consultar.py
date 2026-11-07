# -*- coding: utf-8 -*-
"""Pruebas de consultar.py con una red FALSA (no toca internet ni ningun proveedor).

    python scripts/consulta/probar_consultar.py      (o: python -I scripts/consulta/probar_consultar.py)

Verifica:
  - modelos.json: todos por https, a un host de HOSTS_PERMITIDOS, con precios y variable de clave;
    un host ajeno o http se rechaza al cargar;
  - el filtro: no manda archivos .env/.pem ni textos con forma de clave (sbp_, sb_secret_, JWT, sk-, AIza,
    ghp_, llave privada, SUPABASE_SECRET_KEY=...); la clave publicable de las apps si pasa;
  - tope de tamaño; falta de clave (nombra la variable, no muestra nada); presupuesto diario (suma lo de hoy
    del registro, ignora lo de ayer, la variable CONSULTA_PRESUPUESTO_USD manda);
  - todo rechazo pasa ANTES de llamar a cualquier modelo (con 'todos', si falta una clave no se llama a ninguno);
  - el pedido: URL <base_url>/chat/completions, Authorization solo con la clave de ESE proveedor, el nombre
    del campo de tokens de cada modelo, instrucciones de sistema con la advertencia de material no confiable
    y el material entre marcas;
  - reintento: uno solo y solo si es pasajero (503 -> 200 ok; 400 no reintenta; 503 dos veces -> error);
  - registro: una linea por modelo con huella, tamaño, tokens, costo, estado; el material NO se guarda;
  - la clave nunca aparece en la salida, en el registro ni en el error (aunque el proveedor la repita);
  - main(): codigos 0 / 1 / 2, --simular no llama, --listar.
Ninguna prueba abre una conexion: urllib.request.urlopen esta reemplazado por una guardia que falla.
"""
import contextlib
import copy
import datetime
import io
import json
import os
import sys
import tempfile
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consultar as C  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass
fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  -> " + str(detalle)))
    if not cond:
        fallas.append(nombre)


def _red_prohibida(*a, **k):
    raise AssertionError("una prueba intento abrir una conexion real")


urllib.request.urlopen = _red_prohibida  # guardia
C.pedir = lambda *a, **k: _red_prohibida()  # el transporte real tampoco se usa

# Claves falsas armadas por partes, asi este archivo no "parece" tener claves si se lo manda a revisar.
CLAVE_GEMINI = "AIza" + "Sy" + "X" * 33
CLAVE_OPENAI = "sk-" + "prueba" + "Y" * 30
SECRETOS = {
    "sbp_": "sbp_" + "a1" * 20,
    "sb_secret_": "sb_secret_" + "Zz9" * 6,
    "JWT": "eyJ" + "hbGciOiJIUzI1" + "." + "eyJzdWIiOiIxMjM0" + "." + "SflKxwRJSMeKKF2QT4",
    "sk-": CLAVE_OPENAI,
    "AIza": CLAVE_GEMINI,
    "ghp_": "ghp_" + "b" * 36,
    "llave privada": "-----BEGIN " + "RSA PRIVATE KEY-----",
    "SUPABASE_SECRET_KEY=": "SUPABASE_SECRET_KEY" + "=" + "valorsecreto123",
    "CLAVE_CAMPO_X=": "CLAVE_CAMPO_LA_VUELTA" + " = " + "clavedelcampo1",
}

TMP = tempfile.mkdtemp(prefix="probar_consultar_")
os.environ["CONSULTA_REGISTRO_DIR"] = os.path.join(TMP, "registro")
os.environ["POTREROS_ENV"] = os.path.join(TMP, "no_existe.env")
for v in ("GEMINI_API_KEY", "OPENAI_API_KEY", "CONSULTA_PRESUPUESTO_USD"):
    os.environ.pop(v, None)

CFG_REAL = C.cargar_config()


def cfg(verificado=True):
    c = copy.deepcopy(CFG_REAL)
    for m in c["modelos"].values():
        m["verificado"] = verificado  # el aviso de "sin verificar" se prueba aparte
    return c


def con_claves():
    os.environ["GEMINI_API_KEY"] = CLAVE_GEMINI
    os.environ["OPENAI_API_KEY"] = CLAVE_OPENAI


def limpiar_registro():
    r = C.archivo_registro()
    if os.path.exists(r):
        os.remove(r)


def leer_registro():
    if not os.path.exists(C.archivo_registro()):
        return []
    with open(C.archivo_registro(), encoding="utf-8") as fh:
        return [json.loads(x) for x in fh if x.strip()]


class Red:
    """Red falsa: devuelve las respuestas de la lista en orden y anota cada pedido."""

    def __init__(self, respuestas):
        self.respuestas = list(respuestas)
        self.pedidos = []

    def __call__(self, url, cab, cuerpo):
        self.pedidos.append({"url": url, "cab": dict(cab), "cuerpo": copy.deepcopy(cuerpo)})
        return self.respuestas.pop(0)


def ok(texto="Opinión: está bien.", pt=100, ct=50):
    return 200, json.dumps({"choices": [{"message": {"role": "assistant", "content": texto}}],
                            "usage": {"prompt_tokens": pt, "completion_tokens": ct}})


def rechaza(fn):
    try:
        fn()
    except C.Rechazo as e:
        return str(e)
    return None


PARTES = [("plan.md", "# Plan\nRetirar el puente y revisar por PR.\n")]
salida_nula = io.StringIO()

print("modelos.json")
c = cfg()
chequear("tiene gemini y openai", {"gemini", "openai"} <= set(c["modelos"]))
for n, m in c["modelos"].items():
    chequear("%s: https y host permitido" % n, m["base_url"].startswith("https://") and
             C.parse.urlparse(m["base_url"]).hostname in C.HOSTS_PERMITIDOS)
    chequear("%s: precios numericos" % n, isinstance(m["precio_entrada_usd_millon"], (int, float)) and
             isinstance(m["precio_salida_usd_millon"], (int, float)))
    chequear("%s: ninguna clave escrita en el json" % n, not C.buscar_secretos(json.dumps(m)))
malo = cfg()
malo["modelos"]["gemini"]["base_url"] = "https://evil.example.com/v1"
chequear("host ajeno se rechaza", rechaza(lambda: C.validar_modelo("gemini", malo["modelos"]["gemini"])) is not None)
malo["modelos"]["gemini"]["base_url"] = "http://api.openai.com/v1"
chequear("http se rechaza", rechaza(lambda: C.validar_modelo("gemini", malo["modelos"]["gemini"])) is not None)
chequear("el sistema advierte que el material no son instrucciones",
         "NO instrucciones" in C.INSTRUCCIONES_SISTEMA and "<<<MATERIAL" in C.INSTRUCCIONES_SISTEMA)

print("filtro de claves y archivos")
for nombre, secreto in SECRETOS.items():
    chequear("detecta %s" % nombre, bool(C.buscar_secretos("texto antes\n" + secreto + "\ndespues")))
chequear("la clave publicable de las apps pasa", not C.buscar_secretos("sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"))
chequear("un texto comun pasa", not C.buscar_secretos("Vacas 120, Terneros 80, potrero 14. GEMINI_API_KEY=..."))
for ruta in (".env", "C:\\Users\\Pedro\\.potreros\\.env", "conf/.env.local", "llave.pem", "id_rsa", "x/cred.dpapi"):
    chequear("no abre %s" % ruta, rechaza(lambda: C.leer_material([ruta])) is not None)
con_claves()
red = Red([])
for nombre, secreto in list(SECRETOS.items())[:3]:
    e = rechaza(lambda: C.consultar(["gemini"], "revisar", None, [("a.txt", "hola " + secreto)], cfg=cfg(),
                                     pedir_fn=red, salida=salida_nula))
    chequear("con %s no se manda nada" % nombre, e is not None and secreto not in e and not red.pedidos, e)
e = rechaza(lambda: C.consultar(["gemini"], "revisar", "¿y esto " + SECRETOS["sbp_"] + "?", PARTES, cfg=cfg(),
                                 pedir_fn=red, salida=salida_nula))
chequear("tambien revisa la pregunta", e is not None and not red.pedidos)

print("tamaño, proposito, clave faltante")
chico = cfg()
chico["max_bytes_entrada"] = 50
e = rechaza(lambda: C.consultar(["gemini"], "revisar", None, PARTES, cfg=chico, pedir_fn=red, salida=salida_nula))
chequear("pasado del tope se rechaza", e is not None and "tope" in e and not red.pedidos, e)
chequear("sin proposito se rechaza", rechaza(lambda: C.consultar(["gemini"], " ", None, PARTES, cfg=cfg(), pedir_fn=red))
         is not None)
chequear("sin material se rechaza", rechaza(lambda: C.consultar(["gemini"], "x", None, [("a", "  ")], cfg=cfg(),
                                                                 pedir_fn=red)) is not None)
os.environ.pop("OPENAI_API_KEY")
e = rechaza(lambda: C.consultar(["gemini", "openai"], "revisar", None, PARTES, cfg=cfg(), pedir_fn=red,
                                 salida=salida_nula))
chequear("falta una clave: nombra la variable", e is not None and "OPENAI_API_KEY" in e, e)
chequear("falta una clave: no se llamo a ningun modelo", not red.pedidos)
envf = os.path.join(TMP, "prueba.env")
with open(envf, "w", encoding="utf-8") as fh:
    fh.write("# comentario\nOTRA=1\nexport OPENAI_API_KEY=\"%s\"\n" % CLAVE_OPENAI)
os.environ["POTREROS_ENV"] = envf
chequear("lee la clave del .env (con comillas y export)", C.leer_clave("OPENAI_API_KEY") == CLAVE_OPENAI)
os.environ["POTREROS_ENV"] = os.path.join(TMP, "no_existe.env")
con_claves()

print("pedido y respuesta")
limpiar_registro()
red = Red([ok("Respuesta de Gemini."), ok("Respuesta de OpenAI.", 200, 80)])
out = io.StringIO()
res = C.consultar(["gemini", "openai"], "revisar plan", "¿Qué falta?", PARTES, pedido_por="claude-code",
                  cfg=cfg(), pedir_fn=red, salida=out)
chequear("dos pedidos, uno por modelo", len(red.pedidos) == 2)
pg, po = red.pedidos
chequear("url de gemini", pg["url"] == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
         pg["url"])
chequear("url de openai", po["url"] == "https://api.openai.com/v1/chat/completions", po["url"])
chequear("cada clave a su proveedor", pg["cab"]["Authorization"] == "Bearer " + CLAVE_GEMINI and
         po["cab"]["Authorization"] == "Bearer " + CLAVE_OPENAI)
chequear("ninguna clave en el cuerpo", CLAVE_GEMINI not in json.dumps(pg["cuerpo"]) and
         CLAVE_OPENAI not in json.dumps(po["cuerpo"]))
chequear("campo de tokens de cada modelo", "max_tokens" in pg["cuerpo"] and "max_completion_tokens" in po["cuerpo"],
         (list(pg["cuerpo"]), list(po["cuerpo"])))
msgs = pg["cuerpo"]["messages"]
chequear("mensaje de sistema + usuario", [m["role"] for m in msgs] == ["system", "user"])
chequear("material entre marcas, con proposito y pregunta",
         "<<<MATERIAL" in msgs[1]["content"] and "MATERIAL>>>" in msgs[1]["content"] and
         "revisar plan" in msgs[1]["content"] and "¿Qué falta?" in msgs[1]["content"] and
         "Retirar el puente" in msgs[1]["content"])
chequear("sin herramientas en el pedido", "tools" not in pg["cuerpo"] and "functions" not in pg["cuerpo"])
chequear("resultados ok", [r["ok"] for r in res] == [True, True] and res[0]["texto"] == "Respuesta de Gemini.")
reg = leer_registro()
chequear("una linea de registro por modelo", [r["modelo"] for r in reg] == ["gemini", "openai"])
r0 = reg[0]
chequear("registro con huella, tamaño, tokens, costo, estado, quien",
         len(r0["material_sha256"]) == 64 and r0["material_bytes"] > 0 and r0["tokens_entrada"] == 100 and
         r0["tokens_salida"] == 50 and r0["estado"] == "ok" and r0["pedido_por"] == "claude-code", r0)
esperado = (100 * 1.25 + 50 * 10.0) / 1e6
chequear("costo calculado con los precios", abs(r0["costo_usd"] - round(esperado, 6)) < 1e-9, r0["costo_usd"])
texto_reg = open(C.archivo_registro(), encoding="utf-8").read()
chequear("el material NO se guarda en el registro", "Retirar el puente" not in texto_reg)
chequear("ninguna clave en el registro", CLAVE_GEMINI not in texto_reg and CLAVE_OPENAI not in texto_reg)
buf = io.StringIO()
C.imprimir(res, buf)
chequear("la salida marca que es una opinion, no una orden", "no una orden" in buf.getvalue())

err = io.StringIO()
with contextlib.redirect_stderr(err):
    C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(False), pedir_fn=Red([ok()]), salida=salida_nula)
chequear("avisa si el modelo y los precios no estan verificados", "no estan verificados" in err.getvalue())

print("reintentos")
dormidas = []
limpiar_registro()
red = Red([(503, "{}"), ok()])
r = C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, dormir=dormidas.append, salida=salida_nula)[0]
chequear("503 y despues 200: ok en 2 intentos", r["ok"] and r["intentos"] == 2 and len(red.pedidos) == 2 and
         dormidas == [C.ESPERA_REINTENTO_S])
red = Red([(400, json.dumps({"error": {"message": "modelo inexistente"}})), ok()])
r = C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, dormir=dormidas.append, salida=salida_nula)[0]
chequear("400 no se reintenta", not r["ok"] and len(red.pedidos) == 1 and "modelo inexistente" in r["error"], r)
red = Red([(503, "{}"), (503, "{}"), ok()])
r = C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, dormir=dormidas.append, salida=salida_nula)[0]
chequear("pasajera dos veces: error, sin tercer intento", not r["ok"] and len(red.pedidos) == 2)
red = Red([(0, "sin respuesta (URLError)"), (429, "{}")])
r = C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, dormir=dormidas.append, salida=salida_nula)[0]
chequear("sin respuesta y 429 cuentan como pasajeras", not r["ok"] and len(red.pedidos) == 2)
red = Red([(401, json.dumps({"error": {"message": "API key invalida: " + CLAVE_GEMINI}}))])
r = C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, dormir=dormidas.append, salida=salida_nula)[0]
chequear("si el proveedor repite la clave, el error la tapa", CLAVE_GEMINI not in r["error"] and "***" in r["error"],
         r["error"])
red = Red([(200, "no es json")])
r = C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, dormir=dormidas.append, salida=salida_nula)[0]
chequear("respuesta rara: error, no se cae", not r["ok"] and "formato" in r["error"])
reg = leer_registro()
chequear("los errores tambien quedan registrados", [x["estado"] for x in reg] == ["ok", "error", "error", "error",
                                                                                   "error", "error"],
         [x["estado"] for x in reg])
chequear("ninguna clave en el registro tras errores", CLAVE_GEMINI not in open(C.archivo_registro(),
                                                                                 encoding="utf-8").read())

print("presupuesto")
limpiar_registro()
hoy = C.ahora_mvd()
ayer = hoy - datetime.timedelta(days=1)
os.makedirs(C.carpeta_registro(), exist_ok=True)
with open(C.archivo_registro(), "w", encoding="utf-8") as fh:
    fh.write(json.dumps({"fecha": ayer.isoformat(), "costo_usd": 50}) + "\n")
    fh.write(json.dumps({"fecha": hoy.isoformat(), "costo_usd": 0.5}) + "\n")
    fh.write("linea rota\n")
chequear("gasto de hoy suma solo hoy (y aguanta lineas rotas)", abs(C.gasto_de_hoy() - 0.5) < 1e-9, C.gasto_de_hoy())
justo = cfg()
justo["presupuesto_diario_usd"] = 0.5 + C.costo_maximo(justo["modelos"]["gemini"],
                                                       C.armar_mensajes("x", "", PARTES)[0]) - 0.0001
red = Red([ok()])
e = rechaza(lambda: C.consultar(["gemini"], "x", None, PARTES, cfg=justo, pedir_fn=red, salida=salida_nula))
chequear("sin margen para el costo maximo: no consulta", e is not None and "presupuesto" in e and not red.pedidos, e)
justo["presupuesto_diario_usd"] += 0.001
red = Red([ok()])
chequear("con margen: consulta", C.consultar(["gemini"], "x", None, PARTES, cfg=justo, pedir_fn=red,
                                             salida=salida_nula)[0]["ok"])
os.environ["CONSULTA_PRESUPUESTO_USD"] = "0"
red = Red([ok()])
e = rechaza(lambda: C.consultar(["gemini"], "x", None, PARTES, cfg=cfg(), pedir_fn=red, salida=salida_nula))
chequear("CONSULTA_PRESUPUESTO_USD manda sobre el json", e is not None and not red.pedidos)
os.environ.pop("CONSULTA_PRESUPUESTO_USD")
red = Red([ok(), ok()])
todos_cfg = cfg()
todos_cfg["presupuesto_diario_usd"] = 0.5 + C.costo_maximo(todos_cfg["modelos"]["gemini"],
                                                           C.armar_mensajes("x", "", PARTES)[0]) * 1.5
e = rechaza(lambda: C.consultar(["gemini", "openai"], "x", None, PARTES, cfg=todos_cfg, pedir_fn=red,
                                 salida=salida_nula))
chequear("con varios modelos el presupuesto cuenta todos antes de llamar al primero", e is not None and not red.pedidos)

print("main()")
limpiar_registro()
plan = os.path.join(TMP, "plan.md")
with open(plan, "w", encoding="utf-8") as fh:
    fh.write("Plan de prueba\n")


def correr(argv, red=None):
    viejo = C.pedir
    if red is not None:
        C.pedir = red
    o, e = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
            codigo = C.main(argv)
    finally:
        C.pedir = viejo
    return codigo, o.getvalue(), e.getvalue()


codigo, o, e = correr(["--modelo", "gemini", "--proposito", "x", "--archivo", plan, "--simular"])
chequear("--simular: codigo 0, no llama y muestra el costo", codigo == 0 and "SIMULACION" in o and "US$" in o, (o, e))
chequear("--simular no escribe registro", not leer_registro())
codigo, o, e = correr(["--listar"])
chequear("--listar muestra modelos y gasto", codigo == 0 and "gemini" in o and "openai" in o and "Hoy van" in o)
chequear("--listar no muestra claves", CLAVE_GEMINI not in o and CLAVE_OPENAI not in o)
codigo, o, e = correr(["--modelo", "todos", "--proposito", "x", "--archivo", plan], Red([ok("Uno."), ok("Dos.")]))
chequear("todos: codigo 0 y las dos opiniones", codigo == 0 and "Uno." in o and "Dos." in o, (codigo, o, e))
codigo, o, e = correr(["--modelo", "gemini", "--proposito", "x", "--archivo", plan], Red([(400, "{}")]))
chequear("proveedor falla: codigo 1", codigo == 1 and "NO CONTESTO" in o)
codigo, o, e = correr(["--modelo", "nadie", "--proposito", "x", "--archivo", plan])
chequear("modelo desconocido: codigo 2", codigo == 2 and "no conozco" in e)
codigo, o, e = correr(["--modelo", "gemini", "--proposito", "x", "--archivo", os.path.join(TMP, ".env")])
chequear(".env: codigo 2", codigo == 2 and "claves" in e, e)
codigo, o, e = correr(["--modelo", "gemini", "--proposito", "x", "--archivo", plan, "--json"], Red([ok("J.")]))
d = json.loads(o)
chequear("--json valido", codigo == 0 and d[0]["texto"] == "J." and d[0]["modelo"] == "gemini")
guard = os.path.join(TMP, "resp.md")
codigo, o, e = correr(["--modelo", "gemini", "--proposito", "x", "--archivo", plan, "--salida", guard], Red([ok("G.")]))
chequear("--salida guarda la respuesta", codigo == 0 and "G." in open(guard, encoding="utf-8").read())
for v in (o, e):
    chequear("ninguna clave en la salida de main", CLAVE_GEMINI not in v and CLAVE_OPENAI not in v)

print()
if fallas:
    print("FALLARON %d: %s" % (len(fallas), ", ".join(fallas)))
    sys.exit(1)
print("Todo bien.")
