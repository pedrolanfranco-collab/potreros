# -*- coding: utf-8 -*-
"""
consultar_mcp.py -- herramientas de SOLO LECTURA para los perfiles de consulta de Hermes.

Es un servidor MCP (stdio). Hermes lo arranca desde el config.yaml de cada perfil, y ese perfil NO tiene
terminal, archivos ni navegador: esta es la unica forma en que alcanza los datos. Lo que cada persona puede ver
lo fija la variable de entorno con que se arranca el servidor, no un texto que el modelo pueda saltarse:

    HERMES_CONSULTA_PERFIL   basico | completo
    HERMES_CONSULTA_CAMPOS   la_vuelta | maria_laura | la_vuelta,maria_laura

  basico    stock y sanidad SIN costos, SIN propietarios y SIN pesos. Sin herramienta de eventos.
  completo  todo lo que hay en las tablas: costos, propietarios, pesos, historial de eventos.

Sin las dos variables (o con un valor desconocido) el servidor no arranca: falla cerrado.
Solo hace GET a Supabase con la llave publicable y la clave del campo; nunca escribe.
Para cargar movimientos esta cargar_evento.py, que solo usa Pedro desde su propio perfil.

    HERMES_CONSULTA_PERFIL=basico HERMES_CONSULTA_CAMPOS=maria_laura python consultar_mcp.py
"""
import functools
import json
import os
import re
import sys
from urllib import parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consultar_stock as cs  # noqa: E402

PERFILES = ("basico", "completo")
LIMITE_MAXIMO = 100
NOTA_FOTO = ("Cifras de stock_potreros: la foto que publican las apps; puede estar atrasada si ningun "
             "equipo sincronizo despues de un movimiento.")

COLS_ANIMAL_BASICO = ("id8,ide,categoria,potrero,estado_vida,estado_carencia,fecha_apto,dias_restantes,"
                      "producto_carencia,proximo_tratamiento")
COLS_ANIMAL_COMPLETO = COLS_ANIMAL_BASICO + (",sexo,gen,propietario,ultimo_peso,peso_fecha,ganancia_diaria,"
                                             "pesadas_totales,rodeo,nota,nota_fecha,baja_motivo,baja_fecha,baja_guia")
COLS_SANIDAD_BASICO = "fecha_txt,categoria,potrero,cantidad,productos,dosis,estado,apto_txt,dias_hace,observaciones"
COLS_SANIDAD_COMPLETO = COLS_SANIDAD_BASICO + ",costo_animal"
COLS_PROXIMOS = "categoria,sanidad,animales,ultimo_producto,prevista_txt,dias,estado"
COLS_EVENTOS = "tipo,potrero,detalle,fecha_cliente,creado_en,dispositivo"

SEGURO = re.compile(r"^[\w\-\. /áéíóúñÁÉÍÓÚÑ]{1,40}$")


class ConsultaError(Exception):
    """Algo que se le explica a la persona en palabras simples."""


def _config():
    perfil = (os.environ.get("HERMES_CONSULTA_PERFIL") or "").strip().lower()
    campos = [c.strip() for c in (os.environ.get("HERMES_CONSULTA_CAMPOS") or "").split(",") if c.strip()]
    if perfil not in PERFILES:
        raise SystemExit("HERMES_CONSULTA_PERFIL debe ser basico o completo")
    if not campos or any(c not in cs.ESTABLECIMIENTOS for c in campos):
        raise SystemExit("HERMES_CONSULTA_CAMPOS tiene que listar campos conocidos: " + ", ".join(cs.ESTABLECIMIENTOS))
    return perfil, campos


# ---------------------------------------------------------------- utilidades
def elegir_campo(campo, campos):
    """El campo pedido (por clave o por nombre), solo si la persona tiene acceso. Sin pedirlo:
    La Vuelta si tiene acceso, si no el primero que tenga."""
    texto = cs.normalizar(campo)
    if not texto:
        return "la_vuelta" if "la_vuelta" in campos else campos[0]
    for clave, conf in cs.ESTABLECIMIENTOS.items():
        if texto in (cs.normalizar(clave), cs.normalizar(conf["nombre"])):
            if clave in campos:
                return clave
            raise ConsultaError("No tenes acceso a los datos de %s." % conf["nombre"])
    nombres = ", ".join(cs.ESTABLECIMIENTOS[c]["nombre"] for c in campos)
    raise ConsultaError("No conozco el campo '%s'. Los que podes consultar: %s." % (campo, nombres))


def _seguro(texto, que):
    texto = (texto or "").strip()
    if not SEGURO.match(texto):
        raise ConsultaError("%s no es valido (letras, numeros, espacios, hasta 40)." % que)
    return texto


def _limite(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = 20
    return max(1, min(n, LIMITE_MAXIMO))


def _categoria(texto):
    """Las categorias a las que se refiere el texto; error si ninguna (nunca devolver 0 por un nombre mal escrito)."""
    if not (texto or "").strip():
        return None
    coinciden = cs.categorias_que_coinciden(texto, cs.CATEGORIAS)
    if not coinciden:
        raise ConsultaError("No existe la categoria '%s'. Categorias: %s." % (texto, ", ".join(cs.CATEGORIAS)))
    return coinciden


def _potrero(texto, est):
    if not (texto or "").strip():
        return None
    conf = cs.ESTABLECIMIENTOS[est]
    nombre = cs.canonico(conf["potreros"], texto)
    if nombre is None:
        raise ConsultaError("No existe el potrero '%s' en %s. Potreros: %s." % (
            texto, conf["nombre"], ", ".join(conf["potreros"])))
    return nombre


def _leer(tabla, est, select, extra=None, orden=None, limite=None):
    """UNICO punto que habla con la red: un GET. Las pruebas reemplazan cs.pedir."""
    q = [("select", select), ("establecimiento", "eq." + est)]
    q += list(extra or [])
    if orden:
        q.append(("order", orden))
    if limite:
        q.append(("limit", str(limite)))
    ruta = "%s?%s" % (tabla, parse.urlencode(q, quote_via=parse.quote, safe=",.*()"))
    status, cuerpo = cs.pedir("GET", ruta, establecimiento=est)
    if status != 200:
        raise ConsultaError("Supabase contesto %s al leer %s; proba de nuevo en un rato." % (status, tabla))
    return json.loads(cuerpo or "[]")


def _salida(datos):
    return json.dumps(datos, ensure_ascii=False, separators=(",", ":"), default=str)


def _protegido(fn):
    """Un error esperado se vuelve texto claro; nunca un traceback ni un detalle interno."""
    @functools.wraps(fn)  # conserva los parametros: el servidor arma el esquema de cada herramienta con ellos
    def envuelta(*args, **kwargs):
        try:
            return _salida(fn(*args, **kwargs))
        except ConsultaError as e:
            return _salida({"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return _salida({"error": "No pude consultar (%s)." % e.__class__.__name__})
    envuelta.__annotations__ = {**fn.__annotations__, "return": str}
    return envuelta


# ---------------------------------------------------------------- herramientas
def construir(perfil, campos):
    """{nombre: funcion} con lo que este perfil puede usar. Lo que no puede, ni existe."""
    completo = perfil == "completo"

    def stock(campo: str = "", potrero: str = "", categoria: str = ""):
        """Stock de animales por potrero. campo: La Vuelta o Maria Laura (vacio = el campo por defecto).
        potrero y categoria son filtros opcionales ('vaquillonas' trae todas las de ese nombre)."""
        est = elegir_campo(campo, campos)
        pot = _potrero(potrero, est)
        cats = _categoria(categoria)
        grupos = cs.agrupar(cs.leer_stock(est, pot), pot, cats, est)
        potreros = []
        for g in grupos:
            if g["sin_filas"] and pot is None:
                continue
            if completo:
                filas = [{"categoria": f["categoria"], "dueno": f["dueno"], "cantidad": f["cantidad"], "ug": f["ug"]}
                         for f in g["filas"]]
            else:  # sin propietarios: se suma por categoria
                por_cat = {}
                for f in g["filas"]:
                    c = por_cat.setdefault(f["categoria"], {"categoria": f["categoria"], "cantidad": 0, "ug": 0.0})
                    c["cantidad"] += f["cantidad"]
                    c["ug"] = round(c["ug"] + (f["ug"] or 0), 4)
                filas = list(por_cat.values())
            potreros.append({"potrero": g["potrero"], "animales": g["animales"], "ug": g["ug"], "filas": filas})
        return {"campo": cs.ESTABLECIMIENTOS[est]["nombre"], "potreros": potreros,
                "total_animales": sum(p["animales"] for p in potreros),
                "total_ug": round(sum(p["ug"] for p in potreros), 4), "nota": NOTA_FOTO}

    def sanidad_realizada(campo: str = "", potrero: str = "", categoria: str = "", limite: int = 20):
        """Ultimos tratamientos sanitarios aplicados (fecha, categoria, potrero, cantidad, productos, dosis,
        desde cuando estan aptos). Mas nuevos primero."""
        est = elegir_campo(campo, campos)
        extra = []
        pot = _potrero(potrero, est)
        if pot is not None:
            extra.append(("potrero", "eq." + pot))
        cats = _categoria(categoria)
        if cats:
            extra.append(("categoria", "in.(%s)" % ",".join('"%s"' % c for c in cats)))
        cols = COLS_SANIDAD_COMPLETO if completo else COLS_SANIDAD_BASICO
        filas = _leer("sanidad_ultimos", est, cols, extra, "fecha.desc", _limite(limite))
        return {"campo": cs.ESTABLECIMIENTOS[est]["nombre"], "tratamientos": filas, "cantidad": len(filas)}

    def sanidad_proxima(campo: str = "", categoria: str = ""):
        """Proximos tratamientos sanitarios previstos (categoria, que sanidad, fecha prevista, dias, estado)."""
        est = elegir_campo(campo, campos)
        extra = []
        cats = _categoria(categoria)
        if cats:
            extra.append(("categoria", "in.(%s)" % ",".join('"%s"' % c for c in cats)))
        filas = _leer("sanidad_proximos", est, COLS_PROXIMOS, extra, "dias.asc", LIMITE_MAXIMO)
        return {"campo": cs.ESTABLECIMIENTOS[est]["nombre"], "proximos": filas, "cantidad": len(filas)}

    def animales(campo: str = "", caravana: str = "", potrero: str = "", categoria: str = "",
                 estado_carencia: str = "", limite: int = 30):
        """Animales por caravana (numero visual o electronico): si estan en carencia, hasta cuando, producto,
        proximo tratamiento. Filtros opcionales por potrero, categoria y estado de carencia."""
        est = elegir_campo(campo, campos)
        extra = []
        if (caravana or "").strip():
            c = _seguro(caravana, "La caravana")
            extra.append(("or", "(id8.eq.%s,ide.eq.%s)" % (c, c)))
        pot = _potrero(potrero, est)
        if pot is not None:
            extra.append(("potrero", "eq." + pot))
        cats = _categoria(categoria)
        if cats:
            extra.append(("categoria", "in.(%s)" % ",".join('"%s"' % c for c in cats)))
        if (estado_carencia or "").strip():
            extra.append(("estado_carencia", "ilike.*%s*" % _seguro(estado_carencia, "El estado")))
        n = _limite(limite)
        cols = COLS_ANIMAL_COMPLETO if completo else COLS_ANIMAL_BASICO
        filas = _leer("animales_caravana", est, cols, extra, "id8.asc", n + 1)
        return {"campo": cs.ESTABLECIMIENTOS[est]["nombre"], "animales": filas[:n],
                "hay_mas": len(filas) > n, "cantidad": min(len(filas), n)}

    herramientas = {"stock": stock, "sanidad_realizada": sanidad_realizada,
                    "sanidad_proxima": sanidad_proxima, "animales": animales}

    if completo:
        def eventos(campo: str = "", tipo: str = "", potrero: str = "", limite: int = 30):
            """Historial de eventos del campo (movimientos, nacimientos, muertes, compras, ventas, sanidad,
            lluvias...), mas nuevos primero. tipo es opcional (por ejemplo 'venta', 'nacimiento')."""
            est = elegir_campo(campo, campos)
            extra = []
            if (tipo or "").strip():
                extra.append(("tipo", "eq." + _seguro(tipo, "El tipo")))
            pot = _potrero(potrero, est)
            if pot is not None:
                extra.append(("potrero", "eq." + pot))
            filas = _leer("eventos_sync", est, COLS_EVENTOS, extra, "creado_en.desc", _limite(limite))
            return {"campo": cs.ESTABLECIMIENTOS[est]["nombre"], "eventos": filas, "cantidad": len(filas)}
        herramientas["eventos"] = eventos

    return {nombre: _protegido(fn) for nombre, fn in herramientas.items()}


def main():
    perfil, campos = _config()
    try:  # mcp 1.x
        from mcp.server.fastmcp import FastMCP as Servidor
    except ImportError:  # mcp 2.x (el de Hermes) lo renombro
        from mcp.server.mcpserver import MCPServer as Servidor
    servidor = Servidor("consulta-potreros")
    for nombre, fn in construir(perfil, campos).items():
        servidor.tool(name=nombre)(fn)
    servidor.run()  # stdio


if __name__ == "__main__":
    main()
