"""Corre pasar_traslados_a_excel.py --aplicar de forma automatica (tarea programada cada hora).

    python scripts/dicose/pasar_traslados_automatico.py
    python scripts/dicose/pasar_traslados_automatico.py --carpeta "C:\\...\\Ganaderia\\Macros & phyton"

Que hace (plan de automatizacion de DICOSE, 22/10/2026):
  - Si alguno de los dos libros de DICOSE esta abierto en Excel (existe su archivo ~$...), no corre
    nada: anota en el log y sale 0. Se reintenta en la proxima hora.
  - Si no, corre `pasar_traslados_a_excel.py --aplicar` en la carpeta del script de Pedro
    (Ganaderia\\Macros & phyton, en OneDrive). Ese script NO se modifica.
  - Lee la salida y avisa por ntfy (mismo tema que el backup, NTFY_TOPIC):
      LISTO ...                       -> aviso normal (solo si hubo renglones que pasar).
      RECHAZADO ...                   -> aviso urgente, solo si el conjunto de rechazos cambio.
      libro abierto (carrera)         -> silencio.
      otra falla / NO SE GUARDO NADA  -> aviso urgente (una vez por mensaje) y sale 1.
      Nada para escribir ni borrar    -> silencio.
  - Guarda la salida en pasar_traslados_automatico.log (rota a ~1 MB) y deja solo los ultimos
    --respaldos-max archivos de la carpeta respaldos\\.

Exit: 0 = corrio bien o no habia nada que hacer (o rechazos que ya se avisaron),
      1 = fallo que hay que mirar (la tarea figura con error).
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.request

CARPETA_DEFECTO = r"C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Ganaderia\Macros & phyton"
LIBROS = ("Movimientos_Ganado_2025vs3.1.xlsm", "Movimientos_Ganado_Maria_Laura.xlsm")
SCRIPT_TRASLADOS = "pasar_traslados_a_excel.py"
NTFY_URL_DEFECTO = "https://ntfy.sh"
TOPE_SEGUNDOS = 25 * 60
TAMANO_LOG_MAX = 1024 * 1024
RE_LISTO = re.compile(r"^LISTO: (\d+) rengl", re.M)
RE_RECHAZO = re.compile(r"^\s*✗ RECHAZADO (\S+): (.*)$", re.M)


def ahora():
    return dt.datetime.now().isoformat(timespec="seconds")


def ruta_estado():
    base = os.path.join(os.path.expanduser("~"), ".potreros")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "pasar_traslados_automatico_estado.json")


def leer_env(ruta):
    """Lee KEY=valor de un .env (sin comillas). {} si no existe."""
    out = {}
    if not os.path.exists(ruta):
        return out
    try:
        with open(ruta, encoding="utf-8-sig") as fh:
            for linea in fh:
                linea = linea.strip()
                if linea and not linea.startswith("#") and "=" in linea:
                    k, v = linea.split("=", 1)
                    out[k.strip().replace("export ", "")] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def avisar_ntfy(titulo, mensaje, urgente):
    """True si salio por ntfy. Nunca levanta: avisar no puede romper la corrida."""
    tema = (os.environ.get("NTFY_TOPIC") or "").strip()
    if not tema:
        for ruta in (os.path.join(os.path.expanduser("~"), ".potreros", ".env"),
                     r"C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Lector XRS2\.env"):
            tema = leer_env(ruta).get("NTFY_TOPIC", "")
            if tema:
                break
    if not tema:
        print("  (sin NTFY_TOPIC: el aviso al celular no sale)")
        return False
    url = os.environ.get("NTFY_URL") or NTFY_URL_DEFECTO
    cuerpo = json.dumps({"topic": tema, "title": titulo, "message": mensaje[:1500],
                         "priority": 4 if urgente else 3,
                         "tags": ["warning"] if urgente else ["white_check_mark"]}).encode("utf-8")
    pedido = urllib.request.Request(url, data=cuerpo, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(pedido, timeout=20) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print("  no se pudo mandar el aviso por ntfy: %s" % e)
        return False


def cargar_estado(ruta):
    try:
        with open(ruta, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def guardar_estado(ruta, estado):
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(estado, fh, ensure_ascii=False, indent=1)


def anotar(ruta_log, linea):
    """Agrega una linea al log; lo rota si pasa ~1 MB (queda el .1 con lo anterior)."""
    try:
        if os.path.exists(ruta_log) and os.path.getsize(ruta_log) > TAMANO_LOG_MAX:
            os.replace(ruta_log, ruta_log + ".1")
        with open(ruta_log, "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (ahora(), linea))
    except OSError:
        pass
    print(linea)


def libro_abierto(carpeta):
    """Excel deja ~$<nombre> junto al libro mientras esta abierto."""
    return [n for n in LIBROS if os.path.exists(os.path.join(carpeta, "~$" + n))]


def podar_respaldos(carpeta, maximo, ruta_log):
    """Deja los ultimos `maximo` archivos de respaldos\\ (por nombre: el nombre empieza con la fecha)."""
    rep = os.path.join(carpeta, "respaldos")
    if not os.path.isdir(rep):
        return
    archivos = sorted(f for f in os.listdir(rep) if os.path.isfile(os.path.join(rep, f)))
    for viejo in archivos[:-maximo] if maximo > 0 else archivos:
        try:
            os.remove(os.path.join(rep, viejo))
        except OSError as e:
            anotar(ruta_log, "no se pudo borrar respaldo viejo %s: %s" % (viejo, e))


def correr(carpeta, python, ruta_log):
    """Corre el script de Pedro y devuelve (codigo, salida). codigo None = se paso del tope."""
    cmd = [python, SCRIPT_TRASLADOS, "--aplicar"]
    kwargs = {"cwd": carpeta, "capture_output": True, "text": True, "encoding": "utf-8", "errors": "replace",
              "timeout": TOPE_SEGUNDOS}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    try:
        r = subprocess.run(cmd, **kwargs)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired as e:
        salida = (e.stdout or "") if isinstance(e.stdout, str) else ""
        return None, salida + "\n(se paso del tope de %d min)" % (TOPE_SEGUNDOS // 60)


def procesar(salida, codigo, estado, ruta_log):
    """Decide los avisos segun la salida. Devuelve el codigo de salida de esta corrida."""
    if codigo is None:
        mensaje = "pasar_traslados_a_excel.py se paso del tope de tiempo. Revisar la PC."
        return _urgente(estado, "timeout", "DICOSE: falla al pasar traslados", mensaje, ruta_log, 1)
    rechazos = RE_RECHAZO.findall(salida)
    if rechazos:
        firma = sorted(t for t, _ in rechazos)
        if firma != estado.get("rechazos", []):
            estado["rechazos"] = firma
            detalle = "\n".join("%s: %s" % (t[:8], m) for t, m in rechazos)
            anotar(ruta_log, "rechazos nuevos: %d" % len(rechazos))
            avisar_ntfy("DICOSE: %d traslado(s) sin pasar" % len(rechazos), detalle, urgente=True)
        else:
            anotar(ruta_log, "rechazos ya avisados (%d), sin aviso nuevo" % len(rechazos))
    else:
        if estado.get("rechazos"):
            estado["rechazos"] = []
            anotar(ruta_log, "no quedan rechazos")

    # con traslados rechazados el script de Pedro sale con 1 a proposito: eso ya se avisa arriba, no es una falla
    if rechazos and codigo == 1 and "NO SE GUARDÓ NADA" not in salida:
        return 0

    if codigo == 0:
        m = RE_LISTO.search(salida)
        if m and int(m.group(1)) > 0:
            anotar(ruta_log, "LISTO: %s renglon(es) escritos" % m.group(1))
            avisar_ntfy("DICOSE al día", "Se pasaron %s renglón(es) al Excel y a movimientos_dicose." % m.group(1),
                        urgente=False)
        elif "Nada para escribir ni borrar" in salida:
            anotar(ruta_log, "nada para escribir ni borrar")
        return 0

    if codigo == 2 and "ABIERTO" in salida:
        anotar(ruta_log, "libro abierto en Excel (carrera): se reintenta en la proxima hora")
        return 0
    if "NO SE GUARDÓ NADA" in salida:
        return _urgente(estado, "no_guardo", "DICOSE: no se guardó nada",
                        "Una verificacion no cerro: no se guardo ningun libro. Mirar pasar_traslados_automatico.log.",
                        ruta_log, 1)
    if codigo == 2:
        ultima = [l for l in salida.splitlines() if l.strip().startswith("ERROR")]
        mensaje = ultima[-1] if ultima else "el script salio con error 2"
        return _urgente(estado, "error2:" + mensaje[:80], "DICOSE: el pase no pudo correr", mensaje, ruta_log, 1)
    mensaje = "pasar_traslados_a_excel.py salio con codigo %s" % codigo
    return _urgente(estado, "codigo%s" % codigo, "DICOSE: falla al pasar traslados", mensaje, ruta_log, 1)


def _urgente(estado, clave, titulo, mensaje, ruta_log, codigo_salida):
    """Aviso urgente una sola vez por mensaje distinto."""
    anotar(ruta_log, "FALLA: %s" % mensaje)
    if estado.get("ultima_falla") != clave:
        estado["ultima_falla"] = clave
        avisar_ntfy(titulo, mensaje, urgente=True)
    return codigo_salida


def principal(argv=None):
    ap = argparse.ArgumentParser(description="Pasa los traslados a los Excel de DICOSE y a Supabase, automaticamente.")
    ap.add_argument("--carpeta", default=CARPETA_DEFECTO, help="carpeta donde esta pasar_traslados_a_excel.py")
    ap.add_argument("--python", default=sys.executable, help="interprete de Python para correr el script de Pedro")
    ap.add_argument("--respaldos-max", type=int, default=60, help="cuantos respaldos de .xlsm guardar")
    ap.add_argument("--estado", default=None, help="archivo de estado (avisos ya mandados)")
    args = ap.parse_args(argv)

    carpeta = args.carpeta
    ruta_log = os.path.join(carpeta, "pasar_traslados_automatico.log")
    ruta_est = args.estado or ruta_estado()

    if not os.path.isdir(carpeta):
        anotar(ruta_log if os.path.isdir(os.path.dirname(ruta_log)) else os.devnull,
               "ERROR: no existe la carpeta %s" % carpeta)
        return 1
    if not os.path.exists(os.path.join(carpeta, SCRIPT_TRASLADOS)):
        anotar(ruta_log, "ERROR: no existe %s en %s" % (SCRIPT_TRASLADOS, carpeta))
        return 1

    abiertos = libro_abierto(carpeta)
    if abiertos:
        anotar(ruta_log, "Excel abierto (%s): no se corre; se reintenta en la proxima hora" % ", ".join(abiertos))
        return 0

    estado = cargar_estado(ruta_est)
    codigo, salida = correr(carpeta, args.python, ruta_log)
    # el log guarda la salida completa de la corrida (lo que vio Pedro en la consola)
    anotar(ruta_log, "--- salida de %s (codigo %s) ---\n%s" % (SCRIPT_TRASLADOS, codigo, salida.rstrip()))
    resultado = procesar(salida, codigo, estado, ruta_log)
    guardar_estado(ruta_est, estado)
    podar_respaldos(carpeta, args.respaldos_max, ruta_log)
    return resultado


if __name__ == "__main__":
    sys.exit(principal())
