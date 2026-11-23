"""Vigila iPasto y sube el crecimiento del pasto por potrero a Supabase (tabla crecimiento_pasto).

    python scripts/ipasto/bajar_crecimiento.py                      # corrida diaria (tarea programada, 9:00)
    python scripts/ipasto/bajar_crecimiento.py --simular            # hace todo menos escribir, guardar estado y avisar
    python scripts/ipasto/bajar_crecimiento.py --historia 2025-01   # primera carga: serie mensual desde ese mes

Que hace (La Vuelta, iPasto establecimiento 233):
  - Entra a iPasto con IPASTO_USUARIO (cedula) e IPASTO_CLAVE del .env.
  - Baja el ultimo mes de crecimiento por potrero, sin Bajo 1, Bajo 5 y Claudia.
  - Si ese mes es mas nuevo que el ultimo guardado en Supabase, lo sube (upsert con la clave privada),
    comprueba que volvieron tantas filas como se mandaron y avisa el resumen ponderado por area.
  - Si el mes no cambia y pasaron mas de 45 dias desde el ultimo mes nuevo, avisa una sola vez.
  - Las fallas (no entra, Supabase no guarda, respuesta rara) avisan urgente una sola vez y salen con 1.

Avisos: ntfy (NTFY_TOPIC) y WhatsApp por Hermes. Estado en ~/.potreros/ipasto_estado.json,
log en ~/.potreros/ipasto.log (rota a ~1 MB). La cedula y la clave nunca se imprimen ni van en un aviso.

Exit: 0 = bien o nada nuevo; 1 = falla.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from http import cookiejar
from urllib import error, request

API = "https://api.ipasto.planagro.uy"
ID_IPASTO = 233
ESTABLECIMIENTO = "la_vuelta"
IGNORAR = {"Bajo 1", "Bajo 5", "Claudia"}          # ya no son del campo
SUPABASE_URL = "https://skkknfjpwcstefcroqjt.supabase.co"
DIAS_SIN_DATO = 45
VARIABLE_CLAVE = "SUPABASE_SECRET_KEY"
TIPOS_USO = "3,4"
TAMANO_LOG_MAX = 1024 * 1024
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
CABECERAS_IPASTO = {
    "Content-Type": "application/json",
    "Origin": "https://ipasto.planagro.uy",
    "Referer": "https://ipasto.planagro.uy/",
    "User-Agent": "Mozilla/5.0",
}
TC = ("tc_actual", "tc_promedio", "tc_min", "tc_max")

_secretos = []        # cedula y clave: se reemplazan por *** en todo lo que se imprime o avisa
_RUTA_LOG = None


class FallaUrgente(Exception):
    """Algo que Pedro tiene que mirar. El mensaje no lleva secretos."""


# ---------------------------------------------------------------- utilidades
def redactar(texto):
    for s in _secretos:
        texto = texto.replace(s, "***")
    return texto


def ruta_en_potreros(nombre):
    base = os.path.join(os.path.expanduser("~"), ".potreros")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, nombre)


def ruta_env():
    return os.environ.get("POTREROS_ENV") or ruta_en_potreros(".env")


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


def anotar(linea):
    """Agrega una linea al log (lo rota si pasa ~1 MB) y la imprime. Sin secretos."""
    linea = redactar(linea)
    try:
        if _RUTA_LOG and os.path.exists(_RUTA_LOG) and os.path.getsize(_RUTA_LOG) > TAMANO_LOG_MAX:
            os.replace(_RUTA_LOG, _RUTA_LOG + ".1")
        if _RUTA_LOG:
            with open(_RUTA_LOG, "a", encoding="utf-8") as fh:
                fh.write("%s %s\n" % (dt.datetime.now().isoformat(timespec="seconds"), linea))
    except OSError:
        pass
    print(linea)


def cargar_estado(ruta):
    try:
        with open(ruta, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def guardar_estado(ruta, estado):
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(estado, fh, ensure_ascii=False, indent=1)


def numero(x):
    if x is None or x == "":
        return 0.0
    return float(str(x).replace(",", "."))


def fmt(x):
    return ("%.1f" % x).replace(".", ",")


def ponderado(pares):
    """Promedio de [(valor, peso)]; si no hay pesos, promedio simple."""
    if not pares:
        return 0.0
    total = sum(p for _, p in pares)
    if total <= 0:
        return sum(v for v, _ in pares) / len(pares)
    return sum(v * p for v, p in pares) / total


# ---------------------------------------------------------------- avisos
def avisar_ntfy(titulo, mensaje, urgente):
    """True si salio por ntfy. Nunca levanta: avisar no puede romper la corrida."""
    tema = (os.environ.get("NTFY_TOPIC") or "").strip()
    if not tema:
        for ruta in (ruta_en_potreros(".env"),
                     r"C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Lector XRS2\.env"):
            tema = leer_env(ruta).get("NTFY_TOPIC", "")
            if tema:
                break
    if not tema:
        anotar("  (sin NTFY_TOPIC: el aviso al celular no sale)")
        return False
    url = os.environ.get("NTFY_URL") or "https://ntfy.sh"
    cuerpo = json.dumps({"topic": tema, "title": titulo, "message": mensaje[:1500],
                         "priority": 4 if urgente else 3,
                         "tags": ["warning"] if urgente else ["white_check_mark"]}).encode("utf-8")
    pedido = request.Request(url, data=cuerpo, method="POST", headers={"Content-Type": "application/json"})
    try:
        with request.urlopen(pedido, timeout=20) as r:
            return 200 <= r.status < 300
    except Exception as e:
        anotar("  no se pudo mandar el aviso por ntfy: %s" % redactar(str(e)))
        return False


def avisar_hermes(titulo, mensaje):
    """WhatsApp a Pedro por Hermes. Si falla o no existe el comando, anota y sigue."""
    texto = "%s\n%s" % (titulo, mensaje)
    try:
        r = subprocess.run(["hermes", "send", "--to", "whatsapp:pedro lanfranco", texto],
                           timeout=60, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            anotar("  Hermes no mandó el WhatsApp (codigo %s)" % r.returncode)
            return False
        return True
    except (OSError, subprocess.SubprocessError) as e:
        anotar("  Hermes no mandó el WhatsApp: %s" % redactar(str(e)))
        return False


def avisar_todos(titulo, mensaje, urgente):
    avisar_ntfy(titulo, mensaje, urgente)
    avisar_hermes(titulo, mensaje)


# ---------------------------------------------------------------- transporte
class Transporte:
    """HTTP real. iPasto necesita las cookies del login, por eso un CookieJar."""

    def __init__(self):
        self.abridor = request.build_opener(request.HTTPCookieProcessor(cookiejar.CookieJar()))

    def pedir(self, metodo, url, datos=None, cab=None):
        req = request.Request(url, data=datos, headers=cab or {}, method=metodo)
        try:
            with self.abridor.open(req, timeout=60) as resp:
                return resp.status, resp.read()
        except error.HTTPError as e:
            return e.code, e.read()
        except (error.URLError, OSError) as e:
            return 0, str(e).encode("utf-8", "replace")


# ---------------------------------------------------------------- clave privada de Supabase
def clave_privada(env):
    """(clave, problema). Rechaza la clave publica. Nunca se imprime."""
    clave = (os.environ.get(VARIABLE_CLAVE) or env.get(VARIABLE_CLAVE) or "").strip().strip('"').strip("'")
    if not clave:
        return None, "falta %s en el .env (o la variable de entorno)" % VARIABLE_CLAVE
    if clave.startswith("sb_publishable_"):
        return None, "esa es la clave PUBLICA (la de las apps): hace falta la secret / service_role"
    if clave.startswith("eyJ"):
        try:
            import base64
            carga = clave.split(".")[1]
            rol = json.loads(base64.urlsafe_b64decode(carga + "=" * (-len(carga) % 4))).get("role")
        except Exception:
            rol = None
        if rol != "service_role":
            return None, "esa clave JWT tiene rol '%s', no service_role: hace falta la clave privada" % rol
    return clave, ""


def cab_supabase(clave):
    cab = {"apikey": clave}
    if clave.startswith("eyJ"):
        cab["Authorization"] = "Bearer " + clave
    return cab


# ---------------------------------------------------------------- iPasto
def ipasto_login(transp, cedula, clave):
    cuerpo = json.dumps({"username": cedula, "password": clave}).encode("utf-8")
    st, _ = transp.pedir("POST", API + "/api/auth/sign-in", cuerpo, CABECERAS_IPASTO)
    if st != 200:
        raise FallaUrgente("iPasto no dejó entrar (status %s)" % st)


def ipasto_get(transp, ruta):
    st, cuerpo = transp.pedir("GET", API + ruta, None, CABECERAS_IPASTO)
    if st != 200:
        raise FallaUrgente("iPasto contestó %s al pedir %s" % (st, ruta.split("?")[0]))
    return json.loads(cuerpo.decode("utf-8") or "null")


def potreros_vigilados(transp):
    data = ipasto_get(transp, "/api/establecimientos/%d/potreros?pageSize=999" % ID_IPASTO) or {}
    return [p for p in (data.get("data") or []) if str(p.get("nombre", "")).strip() not in IGNORAR]


def fila_de(nombre, j):
    return {
        "establecimiento": ESTABLECIMIENTO,
        "potrero_ipasto": nombre,
        "anio": int(j["anio"]),
        "mes": int(j["mes"]),
        "tc_actual": numero(j.get("tcActual")),
        "tc_promedio": numero(j.get("tcPromedio")),
        "tc_min": numero((j.get("tcMin") or {}).get("value")),
        "tc_max": numero((j.get("tcMax") or {}).get("value")),
    }


def sin_dato(fila):
    return all(fila[k] == 0 for k in TC)


def bajar_ultimo_mes(transp, potreros):
    """[(fila, area)] del ultimo mes, de los potreros que tienen dato."""
    salida = []
    for p in potreros:
        j = ipasto_get(transp, "/api/establecimientos/%d/indicadores-seguimiento-forrajero?id=%d&potreroId=%s&tipoUsoSueloId=%s"
                       % (ID_IPASTO, ID_IPASTO, p["id"], TIPOS_USO))
        fila = fila_de(p["nombre"], j)
        if not sin_dato(fila):
            salida.append((fila, numero(p.get("area"))))
    return salida


def bajar_historia(transp, potreros, desde, hasta):
    """Serie mensual por potrero desde 'AAAA-MM' hasta hoy. Saltea los meses en cero."""
    filas = []
    for p in potreros:
        ruta = ("/api/establecimientos/%d/seguimiento-forrajero-tc-mensual-total?fechaComienzo=%s-01&fechaFin=%s"
                "&potreroId=%s&tipoUsoSueloId=%s" % (ID_IPASTO, desde, hasta.isoformat(), p["id"], TIPOS_USO))
        for j in ipasto_get(transp, ruta) or []:
            fila = fila_de(p["nombre"], dict(j, mes=j["month"]))
            if not sin_dato(fila):
                filas.append(fila)
    return filas


# ---------------------------------------------------------------- Supabase
def ultimo_guardado(transp, clave):
    st, cuerpo = transp.pedir("GET", SUPABASE_URL + "/rest/v1/crecimiento_pasto?establecimiento=eq.%s"
                              "&select=anio,mes&order=anio.desc,mes.desc&limit=1" % ESTABLECIMIENTO,
                              None, cab_supabase(clave))
    if st != 200:
        raise FallaUrgente("Supabase contestó %s al leer crecimiento_pasto" % st)
    filas = json.loads(cuerpo.decode("utf-8") or "[]")
    return (int(filas[0]["anio"]), int(filas[0]["mes"])) if filas else None


def guardar(transp, clave, filas):
    """Upsert con la clave privada. RLS que bloquea contesta 200 con lista vacia: se compara la cantidad."""
    cab = dict(cab_supabase(clave))
    cab.update({"Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation"})
    st, cuerpo = transp.pedir("POST", SUPABASE_URL + "/rest/v1/crecimiento_pasto",
                              json.dumps(filas).encode("utf-8"), cab)
    if st not in (200, 201):
        raise FallaUrgente("Supabase contestó %s al guardar el crecimiento de iPasto (no se guardó nada)" % st)
    volvieron = len(json.loads(cuerpo.decode("utf-8") or "[]"))
    if volvieron != len(filas):
        raise FallaUrgente("Supabase no guardó todas las filas de iPasto: volvieron %d de %d (RLS o clave)"
                           % (volvieron, len(filas)))
    return volvieron


def sin_repetidos(filas):
    """Una fila por potrero y mes; la ultima gana (por eso la historia va antes que el mes actual)."""
    d = {}
    for f in filas:
        d[(f["potrero_ipasto"], f["anio"], f["mes"])] = f
    return list(d.values())


# ---------------------------------------------------------------- flujo
def mensaje_subida(mes_ip, pares):
    actual = [(f["tc_actual"], area) for f, area in pares if (f["anio"], f["mes"]) == mes_ip]
    promedio = [(f["tc_promedio"], area) for f, area in pares if (f["anio"], f["mes"]) == mes_ip]
    return ("iPasto subió %s %d: el pasto creció en promedio %s kg MS/ha/día (promedio histórico %s). "
            "Mirá 'Pintar por: Pasto' en la PC de La Vuelta."
            % (MESES[mes_ip[1] - 1], mes_ip[0], fmt(ponderado(actual)), fmt(ponderado(promedio))))


def correr(args, transp, ahora, avisar, estado, ruta_est):
    ahora_dt = ahora()
    hoy = ahora_dt.date()
    env = leer_env(ruta_env())
    cedula = (os.environ.get("IPASTO_USUARIO") or env.get("IPASTO_USUARIO") or "").strip()
    clave = (os.environ.get("IPASTO_CLAVE") or env.get("IPASTO_CLAVE") or "").strip()
    if not cedula or not clave:
        raise FallaUrgente("falta IPASTO_USUARIO o IPASTO_CLAVE en el .env")
    _secretos[:] = [s for s in (cedula, clave) if len(s) >= 3]
    skey, problema = clave_privada(env)
    if problema:
        raise FallaUrgente(problema)

    ipasto_login(transp, cedula, clave)
    potreros = potreros_vigilados(transp)
    pares = bajar_ultimo_mes(transp, potreros)
    if not pares:
        raise FallaUrgente("iPasto no devolvió datos para ningún potrero")
    mes_ip = max((f["anio"], f["mes"]) for f, _ in pares)
    guardado = ultimo_guardado(transp, skey)
    historia = bajar_historia(transp, potreros, args.historia, hoy) if args.historia else []
    estado.setdefault("ultimo_mes_nuevo_en", hoy.isoformat())

    if guardado is None or mes_ip > guardado:
        escribir = sin_repetidos(historia + [f for f, _ in pares])
        if args.simular:
            anotar("SIMULAR: subiría %d fila(s) de iPasto (%s %d); no se escribe ni se avisa"
                   % (len(escribir), MESES[mes_ip[1] - 1], mes_ip[0]))
            anotar(mensaje_subida(mes_ip, pares))
            return 0
        n = guardar(transp, skey, escribir)
        anotar("subidas %d fila(s) a crecimiento_pasto (iPasto %s %d)" % (n, MESES[mes_ip[1] - 1], mes_ip[0]))
        avisar("iPasto: crecimiento del pasto", mensaje_subida(mes_ip, pares), False)
        estado.update({"ultimo_mes_nuevo_en": hoy.isoformat(), "aviso_45": False, "ultimo_error": None})
    else:
        if historia:
            if args.simular:
                anotar("SIMULAR: subiría %d fila(s) de historia; no se escribe" % len(sin_repetidos(historia)))
            else:
                n = guardar(transp, skey, sin_repetidos(historia))
                anotar("historia: subidas %d fila(s)" % n)
        try:
            ultimo = dt.date.fromisoformat(estado["ultimo_mes_nuevo_en"])
        except (ValueError, TypeError):
            ultimo = hoy
            estado["ultimo_mes_nuevo_en"] = hoy.isoformat()
        dias = (hoy - ultimo).days
        anotar("sin mes nuevo: iPasto sigue en %s %d (hace %d dias del ultimo mes nuevo)"
               % (MESES[mes_ip[1] - 1], mes_ip[0], dias))
        if dias > DIAS_SIN_DATO and not estado.get("aviso_45"):
            mensaje = ("iPasto no sube datos nuevos desde hace %d días (último: %s %d)"
                       % (dias, MESES[mes_ip[1] - 1], mes_ip[0]))
            if args.simular:
                anotar("SIMULAR: avisaría: " + mensaje)
            else:
                avisar("iPasto: sin datos nuevos", mensaje, False)
                estado["aviso_45"] = True
        estado["ultimo_error"] = None

    if not args.simular:
        guardar_estado(ruta_est, estado)
    return 0


def _urgente(mensaje, avisar, estado, ruta_est, simular):
    """Aviso urgente una sola vez por mensaje distinto."""
    mensaje = redactar(mensaje)
    anotar("FALLA: %s" % mensaje)
    if estado.get("ultimo_error") != mensaje:
        estado["ultimo_error"] = mensaje
        avisar("iPasto: falla", mensaje, True)
    if not simular:
        try:
            guardar_estado(ruta_est, estado)
        except OSError:
            pass
    return 1


def principal(argv=None, http=None, ahora=None, avisar=None):
    global _RUTA_LOG
    ap = argparse.ArgumentParser(description="Vigila iPasto y sube el crecimiento del pasto a Supabase.")
    ap.add_argument("--simular", action="store_true", help="hace todo menos escribir, guardar estado y avisar")
    ap.add_argument("--historia", metavar="AAAA-MM", help="sube la serie mensual desde ese mes (primera carga)")
    ap.add_argument("--estado", default=None, help="archivo de estado (por defecto ~/.potreros/ipasto_estado.json)")
    ap.add_argument("--log", default=None, help="archivo de log (por defecto ~/.potreros/ipasto.log)")
    args = ap.parse_args(argv)
    if args.historia and not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", args.historia):
        ap.error("--historia tiene que ser AAAA-MM")

    _RUTA_LOG = args.log or ruta_en_potreros("ipasto.log")
    ruta_est = args.estado or ruta_en_potreros("ipasto_estado.json")
    ahora_f = ahora or dt.datetime.now
    avisar_f = avisar or avisar_todos
    transp = http or Transporte()
    estado = cargar_estado(ruta_est)
    try:
        return correr(args, transp, ahora_f, avisar_f, estado, ruta_est)
    except FallaUrgente as e:
        return _urgente(str(e), avisar_f, estado, ruta_est, args.simular)
    except Exception as e:  # cualquier otra cosa: se avisa, sin volcar datos
        return _urgente("falla inesperada (%s)" % type(e).__name__, avisar_f, estado, ruta_est, args.simular)


if __name__ == "__main__":
    sys.exit(principal())
