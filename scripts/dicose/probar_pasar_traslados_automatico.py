"""Prueba de pasar_traslados_automatico.py con un pasar_traslados_a_excel.py falso y un ntfy falso.

    python scripts/dicose/probar_pasar_traslados_automatico.py

No toca Excel, ni Supabase, ni ntfy de verdad: el script de Pedro se reemplaza por uno falso que
imprime lo que pasaria con el modo elegido en FAKE_MODO, y ntfy es un servidor local que guarda los avisos.

Verifica (plan de automatizacion DICOSE, 22/10/2026):
  - con un libro abierto (existe ~$...) no corre el script y no avisa;
  - LISTO con renglones -> 1 aviso normal; LISTO 0 / nada para escribir -> silencio;
  - rechazos -> 1 aviso urgente; la misma corrida otra vez -> ningun aviso nuevo; rechazos distintos -> avisa;
  - "libro abierto" de Excel (codigo 2) -> silencio y sale 0;
  - falta la clave privada (codigo 2) -> aviso urgente y sale 1, una sola vez por mensaje;
  - "NO SE GUARDO NADA" -> aviso urgente y sale 1;
  - la poda deja exactamente --respaldos-max archivos en respaldos\\.
"""
import http.server
import io
import json
import os
import shutil
import sys
import tempfile
import threading
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pasar_traslados_automatico as A  # noqa: E402

fallas = []

FALSO = r'''
import os, sys
modo = os.environ.get("FAKE_MODO", "")
if modo == "listo":
    print("LISTO: 3 renglón(es) escritos, 0 borrados y 0 actualizados.")
    sys.exit(0)
if modo == "listo0":
    print("LISTO: 0 renglón(es) escritos, 0 borrados y 0 actualizados.")
    sys.exit(0)
if modo == "vacio":
    print("Nada para escribir ni borrar.")
    sys.exit(0)
if modo == "rechazo_a":
    print("  ✗ RECHAZADO aaaaaaaa1: la categoría 'Bueyes' no tiene fila en el libro")
    print("Nada para escribir ni borrar.")
    sys.exit(1)
if modo == "rechazo_b":
    print("  ✗ RECHAZADO bbbbbbbb2: el dueño 'X' no tiene bloque")
    print("Nada para escribir ni borrar.")
    sys.exit(1)
if modo == "abierto":
    print("ERROR: Movimientos_Ganado_2025vs3.1.xlsm está ABIERTO en Excel. Cerralo y volvé a correr.")
    sys.exit(2)
if modo == "clave":
    print("ERROR: falta SUPABASE_SECRET_KEY en ~/.potreros/.env. No se pueden leer los eventos de Supabase.")
    sys.exit(2)
if modo == "noguardo":
    print("✗ Verificación: el cambio de Inventario no coincide")
    print("NO SE GUARDÓ NADA (ninguno de los dos libros). Revisá los avisos de arriba.")
    sys.exit(1)
print("excepción inesperada")
sys.exit(3)
'''

recibidos = []


class Ntfy(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        largo = int(self.headers.get("Content-Length", 0))
        recibidos.append(json.loads(self.rfile.read(largo).decode("utf-8")))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *a):
        pass


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)))
    if not cond:
        fallas.append(nombre)


def correr(carpeta, estado, modo, extra=None):
    """Corre principal() con el script falso; devuelve (codigo, avisos_nuevos)."""
    os.environ["FAKE_MODO"] = modo
    antes = len(recibidos)
    argv = ["--carpeta", carpeta, "--estado", estado, "--respaldos-max", "60"] + (extra or [])
    with redirect_stdout(io.StringIO()):
        codigo = A.principal(argv)
    return codigo, recibidos[antes:]


def nueva_carpeta():
    d = tempfile.mkdtemp(prefix="dicose_prueba_")
    with open(os.path.join(d, A.SCRIPT_TRASLADOS), "w", encoding="utf-8") as fh:
        fh.write(FALSO)
    return d


def main():
    srv = http.server.HTTPServer(("127.0.0.1", 0), Ntfy)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.environ["NTFY_URL"] = "http://127.0.0.1:%d/" % srv.server_address[1]
    os.environ["NTFY_TOPIC"] = "tema-de-prueba"
    tmp = tempfile.mkdtemp(prefix="dicose_estado_")
    estado = os.path.join(tmp, "estado.json")
    carpeta = nueva_carpeta()
    try:
        # 1) libro abierto: no corre nada, no avisa
        open(os.path.join(carpeta, "~$" + A.LIBROS[0]), "w").close()
        cod, av = correr(carpeta, estado, "listo")
        chequear("con el Excel abierto: sale 0 y no avisa", cod == 0 and av == [], (cod, av))
        chequear("con el Excel abierto: el log dice que se reintenta", "Excel abierto" in open(os.path.join(carpeta, "pasar_traslados_automatico.log"), encoding="utf-8").read())
        os.remove(os.path.join(carpeta, "~$" + A.LIBROS[0]))

        # 2) LISTO con renglones -> 1 aviso normal
        cod, av = correr(carpeta, estado, "listo")
        chequear("LISTO con renglones: sale 0 y manda 1 aviso normal", cod == 0 and len(av) == 1 and av[0]["priority"] == 3, (cod, av))

        # 3) LISTO 0 y nada para escribir -> silencio
        cod, av = correr(carpeta, estado, "listo0")
        chequear("LISTO 0 renglones: silencio", cod == 0 and av == [], av)
        cod, av = correr(carpeta, estado, "vacio")
        chequear("nada para escribir: silencio y sale 0", cod == 0 and av == [], av)

        # 4) rechazos: 1 urgente; repetido -> nada; distinto -> avisa
        cod, av = correr(carpeta, estado, "rechazo_a")
        chequear("rechazo nuevo: 1 aviso urgente y sale 0", cod == 0 and len(av) == 1 and av[0]["priority"] == 4, (cod, av))
        cod, av = correr(carpeta, estado, "rechazo_a")
        chequear("mismo rechazo otra vez: ningun aviso nuevo", cod == 0 and av == [], av)
        cod, av = correr(carpeta, estado, "rechazo_b")
        chequear("rechazo distinto: avisa de nuevo", cod == 0 and len(av) == 1, av)
        cod, av = correr(carpeta, estado, "vacio")
        chequear("cuando se resuelven los rechazos: no avisa y sale 0", cod == 0 and av == [], av)

        # 5) libro abierto de Excel detectado por el propio script (codigo 2): silencio, sale 0
        cod, av = correr(carpeta, estado, "abierto")
        chequear("el script dice ABIERTO (carrera): silencio y sale 0", cod == 0 and av == [], (cod, av))

        # 6) falta la clave privada: urgente una vez, sale 1
        cod, av = correr(carpeta, estado, "clave")
        chequear("falta la clave privada: aviso urgente y sale 1", cod == 1 and len(av) == 1 and av[0]["priority"] == 4, (cod, av))
        cod, av = correr(carpeta, estado, "clave")
        chequear("la misma falla otra vez: no repite el aviso, igual sale 1", cod == 1 and av == [], av)

        # 7) no se guardo nada: urgente, sale 1
        cod, av = correr(carpeta, estado, "noguardo")
        chequear("NO SE GUARDÓ NADA: aviso urgente y sale 1", cod == 1 and len(av) == 1 and av[0]["priority"] == 4, (cod, av))

        # 8) poda: 65 respaldos -> quedan 60 (los mas nuevos)
        rep = os.path.join(carpeta, "respaldos")
        os.makedirs(rep, exist_ok=True)
        for i in range(65):
            open(os.path.join(rep, "2026-10-%03d_libro.xlsm" % i), "w").close()
        cod, av = correr(carpeta, estado, "vacio")
        quedan = sorted(os.listdir(rep))
        chequear("poda: quedan exactamente 60 respaldos y son los mas nuevos",
                 len(quedan) == 60 and quedan[0] == "2026-10-005_libro.xlsm", (len(quedan), quedan[:1]))

        # 9) sin el archivo del script: sale 1 y no corre nada
        sin = tempfile.mkdtemp(prefix="dicose_vacia_")
        cod, av = correr(sin, estado, "listo")
        chequear("sin pasar_traslados_a_excel.py: sale 1 y no avisa", cod == 1 and av == [], (cod, av))
        shutil.rmtree(sin, ignore_errors=True)
    finally:
        srv.shutdown()
        shutil.rmtree(carpeta, ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if fallas:
        print("HAY FALLAS: %d" % len(fallas))
        sys.exit(1)
    print("TODO OK")


if __name__ == "__main__":
    main()
