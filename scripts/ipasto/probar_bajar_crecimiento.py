"""Prueba de bajar_crecimiento.py con iPasto y Supabase falsos (en memoria; sin red).

    python -I scripts/ipasto/probar_bajar_crecimiento.py

Verifica:
  a) mes nuevo -> sube filas, excluye Bajo 1 / Claudia y el potrero sin dato, avisa una vez, guarda estado;
  b) mismo mes que el guardado -> no escribe ni avisa;
  c) el upsert devuelve lista vacia -> sale 1 y avisa urgente;
  d) login 401 -> sale 1, avisa urgente una sola vez, y el aviso no trae la cedula ni la clave;
  e) 46 dias sin mes nuevo -> avisa una vez; la segunda corrida no vuelve a avisar;
  f) --simular -> no escribe, no avisa, no guarda estado;
  g) --historia -> sube la serie mensual (sin repetir la clave potrero/mes, sin meses en cero);
  h) falta usuario o clave -> sale 1 sin pedir nada; clave publica -> sale 1 sin pedir nada.
"""
import datetime as dt
import json
import os
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bajar_crecimiento as B  # noqa: E402

fallas = []
CEDULA = "11111111"
CLAVE = "CLAVE-FALSA-123"
CLAVE_SB = "sb_secret_FALSA_0000000000"
HOY = dt.datetime(2026, 11, 16, 9, 0)


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  " + str(detalle)))
    if not cond:
        fallas.append(nombre)


class Falso:
    """Transporte falso: iPasto y Supabase en memoria. Guarda lo que le llega al POST."""
    POTREROS = [
        {"id": 1, "nombre": "Potrero A", "area": "100"},
        {"id": 2, "nombre": "Bajo 1", "area": "50"},
        {"id": 3, "nombre": "Potrero B", "area": "300"},
        {"id": 4, "nombre": "Claudia", "area": "10"},
        {"id": 5, "nombre": "Potrero C", "area": "80"},   # sin dato: todos los tc en 0
    ]

    def __init__(self, mes=(2026, 10), guardado=(2026, 9), login=200, subida="todas", nuevo_potrero=False):
        self.mes, self.guardado, self.login, self.subida = mes, guardado, login, subida
        self.nuevo_potrero = nuevo_potrero
        self.pedidos = []      # (metodo, url)
        self.subidas = []      # filas que llegaron al POST

    def pedir(self, metodo, url, datos=None, cab=None):
        self.pedidos.append((metodo, url))
        if "/api/auth/sign-in" in url:
            return self.login, json.dumps({"msg": "usuario %s clave %s no valida" % (CEDULA, CLAVE)}).encode()
        if "/potreros?" in url:
            lista = list(self.POTREROS)
            if self.nuevo_potrero:
                lista.append({"id": 6, "nombre": "Potrero D", "area": "60"})
            return 200, json.dumps({"data": lista}).encode()
        if "indicadores-seguimiento-forrajero" in url:
            pid = int(re.search(r"potreroId=(\d+)", url).group(1))
            anio, mes = self.mes
            if pid == 5:
                tc = ("0", "0", "0", "0")
            elif pid == 1:
                tc = ("12,5", "10,0", "5,0", "30,0")
            elif pid == 6:
                tc = ("7,0", "6,0", "2,0", "9,0")
            else:
                tc = ("20,0", "15,0", "5,0", "30,0")
            j = {"anio": anio, "mes": mes, "tcActual": tc[0], "tcPromedio": tc[1],
                 "tcMin": {"value": tc[2]}, "tcMax": {"value": tc[3]}}
            return 200, json.dumps(j).encode()
        if "seguimiento-forrajero-tc-mensual-total" in url:
            pid = int(re.search(r"potreroId=(\d+)", url).group(1))
            serie = []
            for anio in (2025, 2026):
                for mes in range(1, 13):
                    if (anio, mes) > self.mes:
                        break
                    if pid == 5 or (pid == 3 and (anio, mes) == (2025, 3)):
                        valores = ("0", "0", "0", "0")
                    else:
                        valores = ("9,0", "8,0", "4,0", "12,0")
                    serie.append({"month": mes, "anio": anio, "tcActual": valores[0], "tcPromedio": valores[1],
                                  "tcMin": {"value": valores[2]}, "tcMax": {"value": valores[3]}})
            return 200, json.dumps(serie).encode()
        if "/rest/v1/crecimiento_pasto" in url and metodo == "GET":
            if self.guardado is None:
                return 200, b"[]"
            return 200, json.dumps([{"anio": self.guardado[0], "mes": self.guardado[1]}]).encode()
        if "/rest/v1/crecimiento_pasto" in url and metodo == "POST":
            filas = json.loads(datos.decode("utf-8"))
            self.subidas.extend(filas)
            return 200, (json.dumps(filas).encode() if self.subida == "todas" else b"[]")
        return 404, b"no esperado"

    def pidio_post(self):
        return any(m == "POST" and "crecimiento_pasto" in u for m, u in self.pedidos)


def preparar(tmp, env_extra=None):
    """Un .env falso y las variables reales fuera del proceso."""
    envf = os.path.join(tmp, ".env")
    lineas = ["IPASTO_USUARIO=%s" % CEDULA, "IPASTO_CLAVE=%s" % CLAVE, "SUPABASE_SECRET_KEY=%s" % CLAVE_SB]
    if env_extra is not None:
        lineas = env_extra
    with open(envf, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lineas) + "\n")
    os.environ["POTREROS_ENV"] = envf
    for k in ("IPASTO_USUARIO", "IPASTO_CLAVE", "SUPABASE_SECRET_KEY", "NTFY_TOPIC"):
        os.environ.pop(k, None)
    return envf


def correr(fake, tmp, extra=(), ahora=HOY, estado_ruta=None):
    """Corre principal() con el falso; devuelve (codigo, avisos[(titulo, mensaje, urgente)])."""
    avisos = []
    est = estado_ruta or os.path.join(tmp, "estado.json")
    argv = ["--estado", est, "--log", os.path.join(tmp, "ipasto.log")] + list(extra)
    codigo = B.principal(argv, http=fake, ahora=lambda: ahora,
                         avisar=lambda t, m, u: avisos.append((t, m, u)))
    return codigo, avisos


def nuevo_tmp():
    return tempfile.mkdtemp(prefix="ipasto_prueba_")


def main():
    tmps = []
    try:
        # a) mes nuevo
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(mes=(2026, 10), guardado=(2026, 9))
        cod, av = correr(f, tmp)
        nombres = {r["potrero_ipasto"] for r in f.subidas}
        chequear("a) mes nuevo: sube solo Potrero A y B",
                 cod == 0 and nombres == {"Potrero A", "Potrero B"} and len(f.subidas) == 2, (cod, nombres, f.subidas))
        chequear("a) no sube Bajo 1, Claudia ni el potrero sin dato",
                 not (nombres & {"Bajo 1", "Claudia", "Potrero C"}), nombres)
        chequear("a) avisa una sola vez, sin urgencia", len(av) == 1 and av[0][2] is False, av)
        chequear("a) el aviso trae mes, promedio ponderado por area (18,1) e historico (13,8)",
                 len(av) == 1 and "octubre 2026" in av[0][1] and "18,1" in av[0][1] and "13,8" in av[0][1],
                 av[0][1] if av else av)
        with open(os.path.join(tmp, "estado.json"), encoding="utf-8") as fh:
            est = json.load(fh)
        chequear("a) guarda estado: ultimo mes nuevo hoy, aviso_45 falso",
                 est.get("ultimo_mes_nuevo_en") == "2026-11-16" and est.get("aviso_45") is False, est)

        # b) mismo mes que el guardado: sube lo que trae (upsert) pero no avisa
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(mes=(2026, 10), guardado=(2026, 10))
        cod, av = correr(f, tmp)
        chequear("b) mismo mes: hace upsert de sus filas, no avisa, sale 0",
                 cod == 0 and f.pidio_post() and len(f.subidas) == 2 and av == [], (cod, len(f.subidas), av))

        # b2) mismo mes con un potrero nuevo: lo sube sin avisar
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(mes=(2026, 10), guardado=(2026, 10), nuevo_potrero=True)
        cod, av = correr(f, tmp)
        nombres = {r["potrero_ipasto"] for r in f.subidas}
        chequear("b2) mismo mes con potrero nuevo: sube el potrero nuevo sin avisar",
                 cod == 0 and "Potrero D" in nombres and av == [], (cod, nombres, av))

        # i) --simular con login 401: sale 1, cero avisos, no toca el estado
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(login=401)
        cod, av = correr(f, tmp, extra=["--simular"])
        chequear("i) --simular con login 401: sale 1 y no avisa",
                 cod == 1 and av == [] and not os.path.exists(os.path.join(tmp, "estado.json")), (cod, av))

        # c) upsert devuelve lista vacia
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(mes=(2026, 10), guardado=(2026, 9), subida="vacia")
        cod, av = correr(f, tmp)
        chequear("c) upsert vacio: sale 1 y avisa urgente",
                 cod == 1 and len(av) == 1 and av[0][2] is True and "volvieron 0 de 2" in av[0][1], (cod, av))

        # d) login 401: urgente una vez, sin secretos
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(login=401)
        cod, av = correr(f, tmp)
        chequear("d) login 401: sale 1 y avisa urgente",
                 cod == 1 and len(av) == 1 and av[0][2] is True, (cod, av))
        chequear("d) el aviso no trae la cedula ni la clave falsas",
                 all(CEDULA not in m and CLAVE not in m for _, m, _ in av), av)
        cod2, av2 = correr(f, tmp)
        chequear("d) la misma falla otra vez: sale 1 sin repetir el aviso",
                 cod2 == 1 and av2 == [], (cod2, av2))

        # e) 46 dias sin mes nuevo: avisa una vez
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        est_ruta = os.path.join(tmp, "estado.json")
        with open(est_ruta, "w", encoding="utf-8") as fh:
            json.dump({"ultimo_mes_nuevo_en": "2026-10-01", "aviso_45": False}, fh)
        f = Falso(mes=(2026, 10), guardado=(2026, 10))
        cod, av = correr(f, tmp, estado_ruta=est_ruta)
        chequear("e) 46 dias sin mes nuevo: avisa una vez",
                 cod == 0 and len(av) == 1 and "46 días" in av[0][1], (cod, av))
        cod2, av2 = correr(f, tmp, estado_ruta=est_ruta)
        chequear("e) segunda corrida: no vuelve a avisar", cod2 == 0 and av2 == [], (cod2, av2))

        # f) --simular: no escribe, no avisa, no guarda estado
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(mes=(2026, 10), guardado=(2026, 9))
        cod, av = correr(f, tmp, extra=["--simular"])
        chequear("f) --simular: sale 0, sin POST, sin avisos, sin estado",
                 cod == 0 and not f.pidio_post() and av == [] and not os.path.exists(os.path.join(tmp, "estado.json")),
                 (cod, av))

        # g) --historia: serie mensual, sin duplicar potrero/mes, sin meses en cero
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp)
        f = Falso(mes=(2026, 10), guardado=(2026, 9))
        cod, av = correr(f, tmp, extra=["--historia", "2025-01"])
        claves = {(r["potrero_ipasto"], r["anio"], r["mes"]) for r in f.subidas}
        chequear("g) --historia: sube la serie, 43 filas unicas (22 de A y 21 de B, sin 2025-03 de B)",
                 cod == 0 and len(claves) == 43 and len(f.subidas) == 43 and ("Potrero B", 2025, 3) not in claves,
                 (cod, len(claves), len(f.subidas)))
        chequear("g) --historia: incluye meses de 2025", any(r["anio"] == 2025 for r in f.subidas))

        # h) faltan credenciales / clave publica: no pide nada
        tmp = nuevo_tmp(); tmps.append(tmp); preparar(tmp, env_extra=["IPASTO_USUARIO=%s" % CEDULA, "SUPABASE_SECRET_KEY=%s" % CLAVE_SB])
        f = Falso()
        cod, av = correr(f, tmp)
        chequear("h) falta la clave de iPasto: sale 1, urgente, sin pedidos",
                 cod == 1 and av and av[0][2] is True and f.pedidos == [], (cod, av))
        tmp = nuevo_tmp(); tmps.append(tmp)
        preparar(tmp, env_extra=["IPASTO_USUARIO=%s" % CEDULA, "IPASTO_CLAVE=%s" % CLAVE,
                                 "SUPABASE_SECRET_KEY=sb_publishable_FALSA"])
        f = Falso()
        cod, av = correr(f, tmp)
        chequear("h) clave publica en vez de la privada: sale 1 sin pedidos",
                 cod == 1 and f.pedidos == [] and av and "PUBLICA" in av[0][1], (cod, av))
    finally:
        for t in tmps:
            shutil.rmtree(t, ignore_errors=True)

    print()
    if fallas:
        print("HAY FALLAS: %d" % len(fallas))
        sys.exit(1)
    print("TODO OK")


if __name__ == "__main__":
    main()
