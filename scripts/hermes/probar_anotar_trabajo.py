# -*- coding: utf-8 -*-
"""Pruebas de anotar_trabajo.py con una red FALSA (no toca internet ni Supabase).

    python scripts/hermes/probar_anotar_trabajo.py      (o: python -I scripts/hermes/probar_anotar_trabajo.py)

Verifica:
  - simular (sin --aplicar) no hace ningun POST;
  - --aplicar sin SI no escribe; con SI hay exactamente 1 POST con la forma que pide la app
    (event_id UUID, detalle.v, detalle.usuario, fecha dd/mm/aaaa, dispositivo, Prefer return=minimal);
  - --tipo evento arma un `evento_manejo` con el trabajo en detalle.tipo (potrero, categoria, cantidad, obs);
  - --tipo destete arma un `evento_manejo` "Destete";
  - --tipo tarea arma un `tarea_creada` con fecha prevista FUTURA (los hitos de un protocolo);
  - falta --trabajo, tipo de tarea que no existe en el tema, punto inexistente y fecha futura en un hecho
    abortan SIN POST;
  - --tipo limpieza busca el punto por nombre y arma `limpieza_punto`.
Ninguna prueba abre una conexion: urllib.request.urlopen esta reemplazado por una guardia que falla.
"""
import builtins
import contextlib
import io
import json
import os
import sys
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_evento as CE  # noqa: E402
import anotar_trabajo as AT  # noqa: E402

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

PUNTOS = [
    {"tipo": "punto_creado", "detalle": {"id": "p1", "nombre": "Bebedero 1", "subtipo": "bebedero"}},
    {"tipo": "punto_creado", "detalle": {"id": "p2", "nombre": "Tanque del Cerro", "subtipo": "tanque"}},
    {"tipo": "punto_renombrado", "detalle": {"id": "p1", "nombre": "Bebedero del monte"}},
]


class FakeSupa:
    """Un PostgREST falso: responde los GET de puntos y el POST de eventos_sync."""

    def __init__(self, post=(201, "")):
        self.post = post
        self.llamadas = []

    def posts(self):
        return [c for c in self.llamadas if c["metodo"] == "POST"]

    def __call__(self, metodo, ruta, cuerpo=None, establecimiento=None, extra=None):
        self.llamadas.append({"metodo": metodo, "ruta": ruta, "cuerpo": cuerpo,
                              "extra": dict(extra or {}), "est": establecimiento})
        if metodo == "POST":
            return self.post
        tabla, _, _q = ruta.partition("?")
        if tabla == "eventos_sync":
            return 200, json.dumps(PUNTOS)
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
            codigo = AT.main(argv)
    finally:
        CE.pedir = viejo
        builtins.input = viejo_input
    return codigo, out.getvalue(), err.getvalue()


IATF = ["--tipo", "evento", "--trabajo", "IATF - dia 0: colocacion del implante",
        "--potrero", "11", "--categoria", "Vacas", "--cantidad", "98", "--fecha", "21/11/2026",
        "--obs", "RIC-BE 2 ml + implante"]


print("== un trabajo cualquiera (la IATF del dia 0) ==")
fake = FakeSupa()
cod, out, err = correr(IATF, fake)
chequear("simula sin escribir", cod == 0 and not fake.posts(), cod)
chequear("avisa que no escribio", "Nada se escribió" in out, out)
chequear("muestra el evento_manejo", "evento_manejo" in out, out)

fake = FakeSupa()
cod, out, err = correr(IATF + ["--aplicar"], fake, entrada="no")
chequear("--aplicar sin SI: no escribe", cod == 1 and not fake.posts(), (cod, out, err))

fake = FakeSupa()
cod, out, err = correr(IATF + ["--aplicar", "--si"], fake)
posts = fake.posts()
chequear("--aplicar --si: 1 POST", cod == 0 and len(posts) == 1, (cod, len(posts), err))
if posts:
    c = posts[0]["cuerpo"]
    chequear("tipo evento_manejo", c["tipo"] == "evento_manejo", c["tipo"])
    chequear("el trabajo va en detalle.tipo", c["detalle"]["tipo"].startswith("IATF"), c["detalle"].get("tipo"))
    chequear("potrero en la columna y en el detalle", c["potrero"] == "11" and c["detalle"]["potrero"] == "11")
    chequear("categoria y cantidad", c["detalle"]["categoria"] == "Vacas" and c["detalle"]["cantidad"] == 98)
    chequear("obs", c["detalle"]["obs"] == "RIC-BE 2 ml + implante")
    chequear("fecha dd/mm/aaaa", c["fecha_cliente"] == "21/11/2026", c["fecha_cliente"])
    chequear("event_id UUID v4", str(uuid.UUID(c["event_id"])) == c["event_id"], c["event_id"])
    chequear("establecimiento", c["establecimiento"] == "la_vuelta")
    chequear("dispositivo", c["dispositivo"] == CE.DISPOSITIVO, c["dispositivo"])
    chequear("detalle.v y detalle.usuario", c["detalle"]["v"] == CE.VERSION_DETALLE
             and c["detalle"]["usuario"] == CE.USUARIO)
    chequear("Prefer return=minimal", posts[0]["extra"].get("Prefer") == "return=minimal", posts[0]["extra"])

print("== lo que NO se carga ==")
fake = FakeSupa()
cod, out, err = correr(["--tipo", "evento", "--potrero", "11"], fake)
chequear("evento sin --trabajo: no carga", cod == 1 and not fake.posts() and "NO SE CARGA" in err, (cod, err))

fake = FakeSupa()
cod, out, err = correr(["--tipo", "evento", "--trabajo", "Pesada", "--fecha", "30/11/2026"], fake)
chequear("hecho con fecha futura: no carga", cod == 1 and not fake.posts(), (cod, err))

fake = FakeSupa()
cod, out, err = correr(["--tipo", "tarea", "--tema", "Ganado", "--tipo-tarea", "Alambrado",
                        "--fecha-prevista", "28/11/2026"], fake)
chequear("tipo de tarea que no es del tema: no carga", cod == 1 and not fake.posts(), (cod, err))

fake = FakeSupa()
cod, out, err = correr(["--tipo", "limpieza", "--punto", "bebedero 9", "--aplicar", "--si"], fake)
chequear("punto inexistente: no carga", cod == 1 and not fake.posts() and "no encuentro" in err, (cod, err))

print("== la tarea programada para adelante (un hito del protocolo) ==")
fake = FakeSupa()
cod, out, err = correr(["--tipo", "tarea", "--tema", "Ganado", "--tipo-tarea", "Destete final",
                        "--fecha-prevista", "28/11/2026", "--potrero", "11",
                        "--obs", "IATF dia 7: retiro del implante + eCG", "--aplicar", "--si"], fake)
posts = fake.posts()
chequear("tarea futura: 1 POST", cod == 0 and len(posts) == 1, (cod, len(posts), err))
if posts:
    c = posts[0]["cuerpo"]
    chequear("tipo tarea_creada", c["tipo"] == "tarea_creada", c["tipo"])
    chequear("tema y tipo", c["detalle"]["temaGrupo"] == "Ganado" and c["detalle"]["tipo"] == "Destete final")
    chequear("fecha prevista futura", c["detalle"]["fechaPrevista"] == "28/11/2026"
             and c["fecha_cliente"] == "28/11/2026")
    chequear("el tema es lo observado", c["detalle"]["tema"] == "IATF dia 7: retiro del implante + eCG")

print("== destete y limpieza ==")
fake = FakeSupa()
cod, out, err = correr(["--tipo", "destete", "--potrero", "11", "--categoria", "Terneros",
                        "--cantidad", "40", "--aplicar", "--si"], fake)
posts = fake.posts()
chequear("destete: 1 POST evento_manejo Destete", cod == 0 and len(posts) == 1
         and posts[0]["cuerpo"]["tipo"] == "evento_manejo"
         and posts[0]["cuerpo"]["detalle"]["tipo"] == "Destete", (cod, err))
if posts:
    chequear("destete: fecha de hoy", posts[0]["cuerpo"]["fecha_cliente"]
             == CE.hoy_mvd().strftime("%d/%m/%Y"), posts[0]["cuerpo"]["fecha_cliente"])

fake = FakeSupa()
cod, out, err = correr(["--tipo", "limpieza", "--punto", "tanque del cerro", "--aplicar", "--si"], fake)
posts = fake.posts()
chequear("limpieza: 1 POST limpieza_punto", cod == 0 and len(posts) == 1
         and posts[0]["cuerpo"]["tipo"] == "limpieza_punto", (cod, err))
if posts:
    d = posts[0]["cuerpo"]["detalle"]
    chequear("limpieza: el punto es el del nombre", d["puntoId"] == "p2" and d["puntoNombre"] == "Tanque del Cerro")

fake = FakeSupa()
cod, out, err = correr(["--tipo", "limpieza", "--punto", "monte", "--aplicar", "--si"], fake)
chequear("limpieza: el nombre renombrado cuenta", cod == 0 and fake.posts()
         and fake.posts()[0]["cuerpo"]["detalle"]["puntoId"] == "p1", (cod, err))

print("== corregir y anular un evento ya cargado ==")
ID_MANEJO = "0bc31e29-7883-428a-aa6e-9a96de130b8b"
fake = FakeSupa()
cod, out, err = correr(["--tipo", "corregir", "--event-id", ID_MANEJO,
                        "--trabajo", "Destete temporario - tablillas nasales", "--potrero", "11",
                        "--categoria", "Terneros", "--cantidad", "98", "--fecha", "21/11/2026",
                        "--obs", "Tablillas nasales 11 dias + Ectosules Plus 10 cc", "--aplicar", "--si"], fake)
posts = fake.posts()
chequear("corregir: 1 POST evento_manejo_editado", cod == 0 and len(posts) == 1
         and posts[0]["cuerpo"]["tipo"] == "evento_manejo_editado", (cod, err))
if posts:
    d = posts[0]["cuerpo"]["detalle"]
    chequear("corregir: el mismo id", d["id"] == ID_MANEJO, d["id"])
    chequear("corregir: el tipo corregido", d["tipo"] == "Destete temporario - tablillas nasales", d["tipo"])
    chequear("corregir: la fecha del hecho", d["fecha"] == "21/11/2026", d.get("fecha"))

fake = FakeSupa()
cod, out, err = correr(["--tipo", "corregir", "--event-id", ID_MANEJO, "--fecha", "21/11/2026"], fake)
chequear("corregir sin --trabajo: no carga", cod == 1 and not fake.posts() and "NO SE CARGA" in err, (cod, err))

fake = FakeSupa()
cod, out, err = correr(["--tipo", "anular"], fake)
chequear("anular sin --event-id: no carga", cod == 1 and not fake.posts() and "NO SE CARGA" in err, (cod, err))

fake = FakeSupa()
cod, out, err = correr(["--tipo", "anular", "--event-id", ID_MANEJO, "--aplicar", "--si"], fake)
posts = fake.posts()
chequear("anular: 1 POST evento_manejo_eliminado con el id", cod == 0 and len(posts) == 1
         and posts[0]["cuerpo"]["tipo"] == "evento_manejo_eliminado"
         and posts[0]["cuerpo"]["detalle"]["id"] == ID_MANEJO, (cod, err))

print("== corregir una tarea (por ejemplo, agregarle repeticion) ==")
ID_TAREA = "e42dbce5-e119-4b19-b80d-a7b4dfb85959"
fake = FakeSupa()
cod, out, err = correr(["--tipo", "tarea-corregir", "--event-id", ID_TAREA, "--tema", "Otras",
                        "--tipo-tarea", "Otra…", "--fecha-prevista", "12/12/2026", "--cada-dias", "20",
                        "--obs", "Comprar pastillas para los perros (Lola y Miley)", "--aplicar", "--si"], fake)
posts = fake.posts()
chequear("tarea-corregir: 1 POST tarea_editada", cod == 0 and len(posts) == 1
         and posts[0]["cuerpo"]["tipo"] == "tarea_editada", (cod, err))
if posts:
    d = posts[0]["cuerpo"]["detalle"]
    chequear("tarea-corregir: el mismo id", d["id"] == ID_TAREA, d["id"])
    chequear("tarea-corregir: la repeticion", d.get("cadaDias") == 20, d.get("cadaDias"))
    chequear("tarea-corregir: fecha prevista futura", d["fechaPrevista"] == "12/12/2026", d.get("fechaPrevista"))
    chequear("tarea-corregir: tema y tipo", d["temaGrupo"] == "Otras" and d["tipo"] == "Otra…")

fake = FakeSupa()
cod, out, err = correr(["--tipo", "tarea-corregir", "--tema", "Otras", "--tipo-tarea", "Otra…"], fake)
chequear("tarea-corregir sin --event-id: no carga", cod == 1 and not fake.posts() and "NO SE CARGA" in err, (cod, err))

print("")
if fallas:
    print("FALLARON %d: %s" % (len(fallas), " | ".join(fallas)))
    sys.exit(1)
print("Todo OK")
