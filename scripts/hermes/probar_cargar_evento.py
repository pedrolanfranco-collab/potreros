# -*- coding: utf-8 -*-
"""Pruebas de cargar_evento.py con una red FALSA (no toca internet ni Supabase).

    python scripts/hermes/probar_cargar_evento.py      (o: python -I scripts/hermes/probar_cargar_evento.py)

Verifica:
  - simular (sin --aplicar) no hace ningun POST y muestra el evento exacto y el efecto en el stock;
  - --aplicar sin --si pide el SI: sin SI no hay POST; con SI hay exactamente 1 POST;
  - --aplicar --si hace exactamente 1 POST con la forma que pide la app: event_id UUID v4, sin creado_en,
    detalle.v y detalle.usuario, fecha dd/mm/aaaa, dispositivo hermes-script, Prefer return=minimal;
  - stock insuficiente, categoria o potrero inexistente, fecha futura, dueño obligatorio, grupo de Terneros
    y caravana mal escrita abortan SIN POST;
  - 409 (event_id repetido) cuenta como ya cargado (codigo 0); 400 sale con codigo 2 y NO reintenta;
    sin respuesta sale con codigo 2 y avisa que no se sabe si entro;
  - eliminar: arma la correccion desde el evento original (muerte, nacimiento, movimiento_multi), no deja
    anular dos veces, y no anula tipos que no sabe reversar;
  - la clave del campo viaja en x-clave-campo y nunca aparece en la salida;
  - el transporte real (pedir) hace un solo POST aunque el servidor falle.
Ninguna prueba abre una conexion: urllib.request.urlopen esta reemplazado por una guardia que falla.
"""
import builtins
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from urllib import parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consultar_stock as CS  # noqa: E402
import cargar_evento as CE  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")  # la consola de Windows no es UTF-8 por defecto
except (AttributeError, ValueError):
    pass
fallas = []
CLAVE_PRUEBA = "clave-de-prueba-zz9"


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  -> " + str(detalle)))
    if not cond:
        fallas.append(nombre)


def _red_prohibida(*a, **k):
    raise AssertionError("una prueba intento abrir una conexion real")


urllib.request.urlopen = _red_prohibida  # guardia: ninguna prueba sale a la red


def fila(est, potrero, categoria, dueno, cantidad):
    ug = None
    return {"potrero": potrero, "clave": categoria + "||" + dueno, "categoria": categoria, "dueno": dueno,
            "cantidad": cantidad, "ug": ug, "establecimiento": est}


STOCK_LV = [
    fila("la_vuelta", "10", "Vaquillonas 1-2 años", "", 1),
    fila("la_vuelta", "10", "Vacas", "Pedro Lanfranco", 5),
    fila("la_vuelta", "14", "Terneros", "", 10),
    fila("la_vuelta", "6", "Vacas", "", 2),
    fila("la_vuelta", "6", "Vaquillonas 1-2 años", "", 0),  # no deberia existir (la foto no publica ceros)
]
STOCK_ML = [fila("maria_laura", "Tajamar", "Vacas", "Silvia", 4)]


class FakeSupa:
    """Un PostgREST falso: responde los GET de stock_potreros y eventos_sync, y el POST de eventos_sync."""

    def __init__(self, stock=None, eventos=None, correcciones=None, post=(201, ""), get_status=200):
        self.stock = stock if stock is not None else STOCK_LV
        self.eventos = eventos or []
        self.correcciones = correcciones or []
        self.post = post
        self.get_status = get_status
        self.llamadas = []

    def posts(self):
        return [c for c in self.llamadas if c["metodo"] == "POST"]

    def __call__(self, metodo, ruta, cuerpo=None, establecimiento=None, extra=None):
        self.llamadas.append({"metodo": metodo, "ruta": ruta, "cuerpo": cuerpo, "extra": dict(extra or {}),
                              "est": establecimiento})
        if metodo == "POST":
            return self.post
        if self.get_status != 200:
            return self.get_status, '{"code":"XX000","message":"caida de prueba"}'
        tabla, _, query = ruta.partition("?")
        q = parse.parse_qs(query, keep_blank_values=True)
        if tabla == "stock_potreros":
            rows = [f for f in self.stock if f["establecimiento"] == q["establecimiento"][0][3:]]
            return 200, json.dumps(rows)
        if tabla == "eventos_sync":
            if "event_id" in q:
                eid = q["event_id"][0][3:]
                rows = [e for e in self.eventos if e["event_id"] == eid]
                return 200, json.dumps(rows)
            if "detalle->>eventIdOriginal" in q:
                eid = q["detalle->>eventIdOriginal"][0][3:]
                rows = [c for c in self.correcciones if c["detalle"].get("eventIdOriginal") == eid]
                return 200, json.dumps(rows)
        return 404, "{}"


def correr(argv, fake, entrada=None):
    """Corre main() con la red falsa. `entrada` es lo que se escribe en el SI (None = no se pregunta)."""
    viejo = CE.pedir
    viejo_input = builtins.input
    CE.pedir = fake
    if entrada is not None:
        builtins.input = lambda prompt="": entrada
    else:
        def no_debe_preguntar(prompt=""):
            raise AssertionError("pidió el SI sin hacer falta")
        builtins.input = no_debe_preguntar
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            codigo = CE.main(argv)
    finally:
        CE.pedir = viejo
        builtins.input = viejo_input
    return codigo, out.getvalue(), err.getvalue()


def cuerpo_post(fake):
    return fake.posts()[0]["cuerpo"]


# ---------------------------------------------------------------- casos
def prueba_simulacion():
    print("Simular (sin --aplicar)")
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vaquillonas 1-2 años:1"],
                              fake)
    chequear("simular sale con codigo 0", codigo == 0, (codigo, err))
    chequear("simular NO hace ningun POST", fake.posts() == [], fake.llamadas)
    chequear("muestra el evento (tipo movimiento_multi y destino)",
             '"tipo": "movimiento_multi"' in out and '"destino": "6"' in out, out)
    chequear("muestra el efecto: 10 pasa de 1 a 0 y 6 pasa de 0 a 1 en Vaquillonas 1-2 años",
             "10 — Vaquillonas 1-2 años (sin firma): 1 → 0" in out and "6 — Vaquillonas 1-2 años (sin firma): 0 → 1" in out,
             out)
    chequear("dice que no escribio nada", "Nada se escribió" in out, out)


def prueba_aplicar_con_si():
    print("--aplicar --si")
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vaquillonas 1-2 años:1",
                               "--aplicar", "--si"], fake)
    posts = fake.posts()
    chequear("exactamente 1 POST", len(posts) == 1, len(posts))
    chequear("sale con codigo 0 y dice cargado", codigo == 0 and "Cargado" in out, (codigo, out, err))
    if not posts:
        return
    p = posts[0]
    c = p["cuerpo"]
    chequear("el POST va a eventos_sync", p["ruta"] == "eventos_sync", p["ruta"])
    chequear("columnas exactas (sin creado_en: lo pone el servidor)",
             set(c.keys()) == {"event_id", "establecimiento", "dispositivo", "tipo", "potrero", "detalle", "fecha_cliente"},
             sorted(c.keys()))
    try:
        u = uuid.UUID(c["event_id"])
        es_v4 = u.version == 4 and str(u) == c["event_id"]
    except (ValueError, TypeError):
        es_v4 = False
    chequear("event_id es un UUID v4 valido", es_v4, c.get("event_id"))
    chequear("establecimiento y dispositivo", c["establecimiento"] == "la_vuelta" and c["dispositivo"] == "hermes-script", c)
    chequear("tipo movimiento_multi con potrero de origen", c["tipo"] == "movimiento_multi" and c["potrero"] == "10", c)
    chequear("fecha_cliente dd/mm/aaaa", bool(re.match(r"^\d{2}/\d{2}/\d{4}$", c["fecha_cliente"])), c["fecha_cliente"])
    d = c["detalle"]
    chequear("detalle con las claves de la app (destino, items, obs, v, usuario)",
             set(d.keys()) == {"destino", "items", "obs", "v", "usuario"}, sorted(d.keys()))
    chequear("detalle.v y detalle.usuario", d["v"] == "hermes-1.0" and d["usuario"] == "Hermes", d)
    it = d["items"][0]
    chequear("item con categoria, categoriaDestino, dueno, cantidad (entero)",
             set(it.keys()) == {"categoria", "categoriaDestino", "dueno", "cantidad"} and isinstance(it["cantidad"], int)
             and it["dueno"] == "" and it["categoriaDestino"] == "Vaquillonas 1-2 años", it)
    chequear("Prefer: return=minimal", p["extra"].get("Prefer") == "return=minimal", p["extra"])
    chequear("el resultado muestra el event_id que se mando", c["event_id"] in out, out)


def prueba_confirmacion():
    print("Confirmacion por teclado")
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vaquillonas 1-2 años:1",
                               "--aplicar"], fake, entrada="no")
    chequear("con --aplicar y sin SI: no hay POST", fake.posts() == [], fake.llamadas)
    chequear("sale con codigo 1 y dice que no se escribió SI", codigo == 1 and "no se escribió SI" in out, (codigo, out))
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vaquillonas 1-2 años:1",
                               "--aplicar"], fake, entrada="SI")
    chequear("con --aplicar y SI escrito: 1 POST y codigo 0", len(fake.posts()) == 1 and codigo == 0, (codigo, err))
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vaquillonas 1-2 años:1",
                               "--aplicar"], fake, entrada="")
    chequear("sin SI (vacio): no hay POST", fake.posts() == [] and codigo == 1, (codigo, fake.llamadas))


def prueba_stock_insuficiente():
    print("Stock insuficiente y validaciones (todas sin POST)")
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vaquillonas 1-2 años:3",
                                "--aplicar", "--si"], fake)
    chequear("salida con 3 de una categoria que hay 1: codigo 1, sin POST",
             codigo == 1 and fake.posts() == [], (codigo, fake.llamadas))
    chequear("el mensaje dice cuantos faltan y cuantos hay", "faltan 2" in err and "hay 1" in err, err)
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vacas flacas:1",
                                "--aplicar", "--si"], fake)
    chequear("categoria inexistente: codigo 1 sin POST", codigo == 1 and fake.posts() == [] and "no existe" in err, err)
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "99", "--hacia", "6", "--categoria", "Vacas:1",
                                "--aplicar", "--si"], fake)
    chequear("potrero inexistente: codigo 1 sin POST", codigo == 1 and fake.posts() == [] and "no existe" in err, err)
    fake = FakeSupa()
    codigo, out, err = correr(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--fecha", "31/12/2999", "--aplicar", "--si"], fake)
    chequear("fecha futura: codigo 1 sin POST", codigo == 1 and fake.posts() == [] and "futura" in err, err)
    codigo, out, err = correr(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--fecha", "2026-10-20", "--aplicar", "--si"], FakeSupa())
    chequear("fecha en formato ISO: codigo 1 (la app usa dd/mm/aaaa)", codigo == 1 and "dd/mm/aaaa" in err, err)
    codigo, out, err = correr(["mover", "--desde", "6", "--hacia", "6", "--categoria", "Vacas:1",
                                "--aplicar", "--si"], FakeSupa())
    chequear("recategorizar en el mismo potrero sin --categoria-destino ni --dueno-destino: codigo 1 sin POST",
             codigo == 1 and "--categoria-destino" in err, err)
    codigo, out, err = correr(["mover", "--desde", "6", "--hacia", "6", "--categoria", "Vacas:1",
                                "--categoria-destino", "Vaquillonas 2-3 años", "--aplicar", "--si"], FakeSupa())
    chequear("recategorizar en el mismo potrero con categoria destino: codigo 0 (simula)", codigo == 0, err)


def prueba_muerte_y_dueno():
    print("Muerte, grupo de Terneros y dueño")
    fake = FakeSupa()
    codigo, out, err = correr(["muerte", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--aplicar", "--si"], fake)
    chequear("muerte de Terneros sin --grupo-ternero: codigo 1 sin POST",
             codigo == 1 and fake.posts() == [] and "temporada|marcado" in err, err)
    fake = FakeSupa()
    codigo, out, err = correr(["muerte", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--grupo-ternero", "marcado", "--aplicar", "--si"], fake)
    chequear("muerte de Terneros marcado: 1 POST y grupoTernero viaja en detalle",
             len(fake.posts()) == 1 and codigo == 0 and cuerpo_post(fake)["detalle"].get("grupoTernero") == "marcado",
             (codigo, err))
    if fake.posts():
        chequear("muerte: tipo muerte, sin grupo en otra categoria no hace falta",
                 cuerpo_post(fake)["tipo"] == "muerte", cuerpo_post(fake))
    fake = FakeSupa()
    codigo, out, err = correr(["muerte", "--potrero", "6", "--categoria", "Vacas", "--cantidad", "1",
                                "--grupo-ternero", "marcado"], fake)
    chequear("--grupo-ternero con una categoria que no es Terneros: codigo 1", codigo == 1 and "solo se usa con" in err, err)
    fake = FakeSupa()
    codigo, out, err = correr(["muerte", "--potrero", "6", "--categoria", "Vacas", "--cantidad", "1",
                                "--caravana", "123", "--aplicar", "--si"], fake)
    chequear("caravana de menos de 8 digitos: codigo 1 sin POST", codigo == 1 and fake.posts() == [], err)
    fake = FakeSupa(stock=STOCK_ML)
    codigo, out, err = correr(["nacimiento", "--establecimiento", "maria_laura", "--potrero", "Tajamar",
                                "--categoria", "Vacas", "--cantidad", "1", "--aplicar", "--si"], fake)
    chequear("María Laura: el dueño es obligatorio (sin --dueno: codigo 1 sin POST)",
             codigo == 1 and fake.posts() == [] and "obligatorio" in err, err)
    fake = FakeSupa(stock=STOCK_ML)
    codigo, out, err = correr(["nacimiento", "--establecimiento", "maria_laura", "--potrero", "Tajamar",
                                "--categoria", "Vacas", "--cantidad", "1", "--dueno", "Silvia"], fake)
    chequear("María Laura con dueño de la lista: simula bien", codigo == 0 and "Silvia" in out, (codigo, err))
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vacas:1",
                                "--dueno", "Fulano Inventado", "--aplicar", "--si"], fake)
    chequear("dueño que no está en la lista: codigo 1 sin POST", codigo == 1 and fake.posts() == [] and "no está" in err, err)
    fake = FakeSupa()
    codigo, out, err = correr(["mover", "--desde", "10", "--hacia", "6", "--categoria", "Vacas:1",
                                "--dueno", "pedro lanfranco", "--aplicar", "--si"], fake)
    chequear("el dueño se acepta sin mayusculas ni tildes y se guarda con el nombre de la app",
             codigo == 0 and cuerpo_post(fake)["detalle"]["items"][0]["dueno"] == "Pedro Lanfranco", (codigo, err))


def prueba_respuestas():
    print("Respuestas de Supabase al escribir")
    fake = FakeSupa(post=(409, '{"code":"23505","message":"duplicate key value violates unique constraint"}'))
    codigo, out, err = correr(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--aplicar", "--si"], fake)
    chequear("409 (event_id repetido) cuenta como ya cargado: codigo 0 y no duplica",
             codigo == 0 and "Ya estaba" in out and len(fake.posts()) == 1, (codigo, out, err))
    fake = FakeSupa(post=(400, '{"code":"22P02","message":"invalid input syntax for type uuid"}'))
    codigo, out, err = correr(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--aplicar", "--si"], fake)
    chequear("400: codigo 2, muestra el codigo y NO reintenta (un solo POST)",
             codigo == 2 and "22P02" in out and len(fake.posts()) == 1 and "No se reintentó" in out, (codigo, out))
    fake = FakeSupa(post=(0, "sin respuesta (URLError)"))
    codigo, out, err = correr(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--aplicar", "--si"], fake)
    chequear("sin respuesta: codigo 2, avisa que no se sabe si entró, un solo POST",
             codigo == 2 and "NO SE SABE" in out and len(fake.posts()) == 1, (codigo, out))
    fake = FakeSupa(get_status=500)
    codigo, out, err = correr(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                                "--aplicar", "--si"], fake)
    chequear("si no puede leer el stock: codigo 2, sin POST", codigo == 2 and fake.posts() == [], (codigo, err))


def prueba_eliminar():
    print("Eliminar (correccion)")
    eid_muerte = str(uuid.uuid4())
    eid_nac = str(uuid.uuid4())
    eid_mov = str(uuid.uuid4())
    eventos = [
        {"event_id": eid_muerte, "establecimiento": "la_vuelta", "tipo": "muerte", "potrero": "14",
         "detalle": {"categoria": "Terneros", "dueno": "", "cantidad": 2, "obs": None, "caravana": None,
                     "grupoTernero": "temporada", "v": "pc-3.74"}, "fecha_cliente": "20/10/2026"},
        {"event_id": eid_nac, "establecimiento": "la_vuelta", "tipo": "nacimiento", "potrero": "6",
         "detalle": {"categoria": "Vacas", "dueno": "", "cantidad": 9, "obs": None}, "fecha_cliente": "19/10/2026"},
        {"event_id": eid_mov, "establecimiento": "la_vuelta", "tipo": "movimiento_multi", "potrero": "10",
         "detalle": {"destino": "6", "items": [{"categoria": "Vacas", "categoriaDestino": "Vacas", "dueno": "",
                                                "cantidad": 2}], "obs": None},
         "fecha_cliente": "18/10/2026"},
        {"event_id": str(uuid.uuid4()), "establecimiento": "la_vuelta", "tipo": "venta", "potrero": "10",
         "detalle": {"categoria": "Vacas", "dueno": "", "cantidad": 1}, "fecha_cliente": "17/10/2026"},
    ]
    fake = FakeSupa(eventos=eventos)
    codigo, out, err = correr(["eliminar", "--event-id-original", eid_muerte], fake)
    chequear("simular la anulacion de una muerte: codigo 0 sin POST", codigo == 0 and fake.posts() == [], err)
    chequear("la simulacion muestra que la muerte vuelve: Terneros 10 → 12 en 14",
             "14 — Terneros (sin firma): 10 → 12" in out, out)
    codigo, out, err = correr(["eliminar", "--event-id-original", eid_muerte, "--aplicar", "--si"], fake)
    posts = fake.posts()
    chequear("anular la muerte escribe 1 correccion", codigo == 0 and len(posts) == 1, (codigo, err))
    if posts:
        c = posts[0]["cuerpo"]
        d = c["detalle"]
        chequear("la correccion va al mismo potrero, tipo correccion",
                 c["tipo"] == "correccion" and c["potrero"] == "14", c)
        chequear("accion eliminar, eventIdOriginal y tipoOriginal muerte",
                 d["accion"] == "eliminar" and d["eventIdOriginal"] == eid_muerte and d["tipoOriginal"] == "muerte", d)
        chequear("reversar es sumar 2 Terneros de temporada en 14 (lo que deshace la muerte)",
                 d["reversar"] == {"tipo": "sumar", "potrero": "14", "categoria": "Terneros", "dueno": "",
                                   "cantidad": 2, "grupoTernero": "temporada"}, d["reversar"])
        chequear("fechaOriginal es la del evento original", d["fechaOriginal"] == "20/10/2026", d)
    fake = FakeSupa(eventos=eventos)
    codigo, out, err = correr(["eliminar", "--event-id-original", eid_nac], fake)
    chequear("anular un nacimiento de 9 Vacas en 6 (hay 2): codigo 1, faltan 7, sin POST",
             codigo == 1 and fake.posts() == [] and "faltan 7" in err, (codigo, err))
    fake = FakeSupa(eventos=eventos)
    codigo, out, err = correr(["eliminar", "--event-id-original", eid_mov, "--aplicar", "--si"], fake)
    posts = fake.posts()
    chequear("anular un movimiento 10→6 (2 Vacas): 1 correccion con reversar mover_multi 6→10",
             codigo == 0 and len(posts) == 1 and posts[0]["cuerpo"]["detalle"]["reversar"] == {
                 "tipo": "mover_multi", "origen": "6", "destino": "10",
                 "items": [{"categoria": "Vacas", "categoriaDestino": "Vacas", "dueno": "", "cantidad": 2}]},
             (codigo, err, posts[0]["cuerpo"]["detalle"] if posts else None))
    fake = FakeSupa(eventos=eventos)
    codigo, out, err = correr(["eliminar", "--event-id-original", str(uuid.uuid4())], fake)
    chequear("un event_id que no existe: codigo 1, sin POST", codigo == 1 and fake.posts() == [] and "no encuentro" in err, err)
    codigo, out, err = correr(["eliminar", "--event-id-original", "no-es-uuid"], FakeSupa(eventos=eventos))
    chequear("un event_id mal formado: codigo 1 sin consultar", codigo == 1 and "UUID" in err, err)
    fake = FakeSupa(eventos=eventos)
    codigo, out, err = correr(["eliminar", "--event-id-original", "00000000-0000-4000-8000-000000000001"], fake)
    chequear("(sanity) ese UUID no existe", codigo == 1, codigo)
    fake = FakeSupa(eventos=eventos, correcciones=[{"event_id": str(uuid.uuid4()), "detalle": {"eventIdOriginal": eid_muerte}}])
    codigo, out, err = correr(["eliminar", "--event-id-original", eid_muerte, "--aplicar", "--si"], fake)
    chequear("ya corregido: no se anula dos veces (codigo 1, sin POST)",
             codigo == 1 and fake.posts() == [] and "ya tiene una corrección" in err, err)
    venta = eventos[3]
    fake = FakeSupa(eventos=eventos)
    codigo, out, err = correr(["eliminar", "--event-id-original", venta["event_id"]], fake)
    chequear("una venta no se anula desde Hermes (codigo 1)", codigo == 1 and "se corrige desde la app" in err, err)


def prueba_clave_y_transporte():
    print("Clave del campo y transporte real (pedir) con urlopen falso")
    capturas = []

    class Resp:
        def __init__(self, status, texto):
            self.status = status
            self._t = texto

        def read(self):
            return self._t.encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen_falso(req, timeout=None):
        capturas.append(req)
        if req.get_method() == "GET":
            if "stock_potreros" in req.full_url:
                return Resp(200, json.dumps(STOCK_LV))
            return Resp(200, "[]")
        return Resp(201, "")

    viejo_open = urllib.request.urlopen
    viejo_env = dict(os.environ)
    tmp = tempfile.mkdtemp(prefix="hermes_ev_")
    try:
        urllib.request.urlopen = urlopen_falso
        os.environ["POTREROS_ENV"] = os.path.join(tmp, "no_existe.env")
        os.environ["CLAVE_CAMPO_LA_VUELTA"] = CLAVE_PRUEBA
        viejo_pedir = CE.pedir
        CE.pedir = CE.CS.pedir  # sin red falsa a nivel de pedir: se pasa por el transporte real
        # El transporte real llama a CS.pedir; CE.pedir delega ahi. Lo dejamos como esta.
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            codigo = CE.main(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                              "--aplicar", "--si"])
        CE.pedir = viejo_pedir
        posts = [r for r in capturas if r.get_method() == "POST"]
        chequear("con el transporte real: 1 POST y codigo 0", len(posts) == 1 and codigo == 0, (codigo, err.getvalue()))
        if posts:
            chequear("el POST lleva x-clave-campo (de la variable de entorno)",
                     posts[0].get_header("X-clave-campo") == CLAVE_PRUEBA, "")
            chequear("el POST lleva Prefer return=minimal", posts[0].get_header("Prefer") == "return=minimal", "")
        chequear("la clave NO aparece en la salida ni en el error",
                 CLAVE_PRUEBA not in out.getvalue() and CLAVE_PRUEBA not in err.getvalue(),
                 out.getvalue())
        # Un error del servidor: ni reintenta ni imprime la clave
        def urlopen_400(req, timeout=None):
            capturas.append(req)
            if req.get_method() == "GET":
                return Resp(200, json.dumps(STOCK_LV))
            raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", None,
                                         io.BytesIO(b'{"code":"42501","message":"permission denied"}'))
        urllib.request.urlopen = urlopen_400
        capturas.clear()
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            codigo = CE.main(["nacimiento", "--potrero", "14", "--categoria", "Terneros", "--cantidad", "2",
                              "--aplicar", "--si"])
        posts = [r for r in capturas if r.get_method() == "POST"]
        chequear("error 42501 del servidor: codigo 2, un solo POST, sin la clave en pantalla",
                 codigo == 2 and len(posts) == 1 and "42501" in out.getvalue() and CLAVE_PRUEBA not in out.getvalue(),
                 (codigo, out.getvalue()))
    finally:
        urllib.request.urlopen = viejo_open
        os.environ.clear()
        os.environ.update(viejo_env)
        try:
            os.rmdir(tmp)
        except OSError:
            pass


def main():
    prueba_simulacion()
    prueba_aplicar_con_si()
    prueba_confirmacion()
    prueba_stock_insuficiente()
    prueba_muerte_y_dueno()
    prueba_respuestas()
    prueba_eliminar()
    prueba_clave_y_transporte()
    print("")
    if fallas:
        print("FALLARON %d: %s" % (len(fallas), "; ".join(fallas)))
        return 1
    print("Todo OK (cargar_evento).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
