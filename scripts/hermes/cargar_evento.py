# -*- coding: utf-8 -*-
"""
cargar_evento.py -- carga eventos en `eventos_sync` para que las apps los reproduzcan (para Hermes).

El stock NO se edita en `stock_potreros` (esa tabla es solo una foto que publican las apps). Se
modifica escribiendo un evento: cada app lo lee al sincronizar y ajusta su stock igual que si lo
hubiera cargado una persona. Por eso el formato sale de template/potreros.template.html (enviarEvento,
movimiento_multi, nacimiento, muerte, correccion) y esta descrito en docs/eventos.md.

Subcomandos:
    mover       movimiento entre potreros, una o varias categorias (un evento movimiento_multi)
    nacimiento  suma animales a un potrero
    muerte      resta animales (en Terneros hay que decir si es de temporada o marcado)
    eliminar    anula un nacimiento, muerte o movimiento_multi por su event_id (un evento correccion)

SIEMPRE SIMULA por defecto: valida, muestra el JSON exacto del evento y el efecto en el stock, y no
escribe nada. Para escribir hace falta --aplicar; ademas pide que escribas SI (salvo con --si, que
solo debe usar Hermes despues del OK de Pedro).

Ejemplos (PowerShell):
    python scripts/hermes/cargar_evento.py mover --desde 10 --hacia 6 --categoria "Vaquillonas 1-2 años:1"
    python scripts/hermes/cargar_evento.py mover --desde 10 --hacia 6 --categoria "Vacas:5" --categoria "Toros:1" --aplicar
    python scripts/hermes/cargar_evento.py muerte --potrero 14 --categoria Terneros --cantidad 2 --grupo-ternero marcado
    python scripts/hermes/cargar_evento.py nacimiento --potrero 8 --categoria Terneros --cantidad 3 --fecha 20/10/2026
    python scripts/hermes/cargar_evento.py eliminar --event-id-original 3f2c...-...-... --aplicar --si

Clave del campo: si hay CLAVE_CAMPO_LA_VUELTA (variable de entorno) o esa linea en ~/.potreros/.env,
viaja en el encabezado x-clave-campo. Nunca se imprime.
"""
import argparse
import datetime
import json
import os
import re
import sys
import uuid
from urllib import parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consultar_stock as CS  # noqa: E402  (listas compartidas, leer_stock y el transporte de lectura)

VERSION_DETALLE = "hermes-1.0"      # detalle.v: quien escribio el evento (solo diagnostico)
DISPOSITIVO = "hermes-script"       # no es el id de ningun equipo real
USUARIO = "Hermes"                  # detalle.usuario
# Uruguay esta en UTC-3 todo el año desde 2015 (sin horario de verano). No usamos zoneinfo porque en
# Windows necesita el paquete tzdata, que no viene con Python.
TZ_MVD = datetime.timezone(datetime.timedelta(hours=-3))
TIPOS_ELIMINABLES = ("nacimiento", "muerte", "movimiento_multi")
GRUPOS_TERNERO = ("temporada", "marcado")
REGEX_FECHA = re.compile(r"^\d{2}/\d{2}/\d{4}$")
REGEX_CARAVANA = re.compile(r"^\d{8,}$")


class Rechazo(Exception):
    """Algo que impide cargar el evento: no se simula ni se escribe nada."""


def pedir(metodo, ruta, cuerpo=None, establecimiento=None, extra=None):
    """UNICA funcion que habla con la red para escribir (las pruebas la reemplazan por una falsa).
    Las lecturas pasan por consultar_stock.pedir; las dos son GET/POST a la misma API con la misma clave."""
    return CS.pedir(metodo, ruta, cuerpo=cuerpo, establecimiento=establecimiento, extra=extra)


def hoy_mvd():
    return datetime.datetime.now(TZ_MVD).date()


def fecha_dmy(texto):
    """dd/mm/aaaa, real y no futura (la app no deja cargar fechas de mañana)."""
    if texto is None:
        return hoy_mvd().strftime("%d/%m/%Y")
    if not REGEX_FECHA.match(texto):
        raise Rechazo("la fecha tiene que ser dd/mm/aaaa (llegó %r)" % texto)
    try:
        f = datetime.datetime.strptime(texto, "%d/%m/%Y").date()
    except ValueError:
        raise Rechazo("la fecha %s no existe" % texto)
    if f > hoy_mvd():
        raise Rechazo("la fecha %s es futura" % texto)
    return texto


def clave_de(categoria, dueno):
    return categoria + "||" + (dueno or "")


def cantidad_valida(valor):
    try:
        n = int(valor)
    except (TypeError, ValueError):
        raise Rechazo("la cantidad tiene que ser un número entero (llegó %r)" % (valor,))
    if n < 1:
        raise Rechazo("la cantidad tiene que ser mayor que 0")
    return n


def resolver_potrero(est, texto, filas):
    """Nombre canonico del potrero: el de la lista de la app o uno que ya tenga filas en stock_potreros."""
    nombres = list(CS.ESTABLECIMIENTOS[est]["potreros"]) + sorted({f["potrero"] for f in filas})
    nombre = CS.canonico(nombres, texto or "")
    if nombre is None:
        raise Rechazo("el potrero %r no existe en %s" % (texto, CS.ESTABLECIMIENTOS[est]["nombre"]))
    return nombre


def resolver_categoria(texto):
    cat = CS.canonico(CS.CATEGORIAS, texto or "")
    if cat is None:
        raise Rechazo("la categoría %r no existe (las de la app: %s)" % (texto, ", ".join(CS.CATEGORIAS)))
    return cat


def resolver_dueno(est, texto):
    """'' = sin asignar (La Vuelta). En María Laura y Pone Chico el dueño es obligatorio."""
    cfg = CS.ESTABLECIMIENTOS[est]
    if texto is None or texto.strip() == "":
        if cfg["dueno_obligatorio"]:
            raise Rechazo("en %s el dueño es obligatorio (%s)" % (cfg["nombre"], ", ".join(cfg["duenos"])))
        return ""
    d = CS.canonico(cfg["duenos"], texto)
    if d is None:
        raise Rechazo("el dueño %r no está en la lista de %s (%s)"
                      % (texto, cfg["nombre"], ", ".join(cfg["duenos"])))
    return d


def mapa_stock(filas):
    return {(f["potrero"], f["clave"]): f["cantidad"] for f in filas}


def evento(est, tipo, potrero, detalle, fecha):
    """Arma la fila como la pide `insertarEventoRemoto` de la app (sin creado_en: lo fija el servidor)."""
    d = dict(detalle)
    d["v"] = VERSION_DETALLE
    d["usuario"] = USUARIO
    return {
        "event_id": str(uuid.uuid4()),
        "establecimiento": est,
        "dispositivo": DISPOSITIVO,
        "tipo": tipo,
        "potrero": potrero,
        "detalle": d,
        "fecha_cliente": fecha,
    }


def aplicar_ops(stock, ops):
    """Copia del stock con los deltas aplicados en orden (como la app)."""
    nuevo = dict(stock)
    for potrero, cat, dueno, delta in ops:
        k = (potrero, clave_de(cat, dueno))
        nuevo[k] = nuevo.get(k, 0) + delta
    return nuevo


def texto_firma(est, dueno):
    return (" de " + dueno) if dueno else " " + CS.ESTABLECIMIENTOS[est]["texto_sin_dueno"]


def revisar_negativos(est, stock_antes, stock_despues, ops):
    """Si una salida deja un saldo negativo, se aborta (la app lo dejaria negativo o lo truncaria en 0)."""
    problemas = []
    vistos = set()
    for potrero, cat, dueno, delta in ops:
        k = (potrero, clave_de(cat, dueno))
        if delta < 0 and stock_despues.get(k, 0) < 0 and k not in vistos:
            vistos.add(k)
            problemas.append("faltan %d %s%s en %s: hay %d"
                             % (-stock_despues[k], cat, texto_firma(est, dueno), potrero, stock_antes.get(k, 0)))
    if problemas:
        raise Rechazo("no hay stock suficiente (la app dejaría saldo negativo):\n  - " + "\n  - ".join(problemas))


# ---------------------------------------------------------------- construccion por subcomando
def construir_mover(args, est, fecha, filas):
    origen = resolver_potrero(est, args.desde, filas)
    destino = resolver_potrero(est, args.hacia, filas)
    if not args.categoria:
        raise Rechazo("falta --categoria CAT:N")
    cat_destino_fija = resolver_categoria(args.categoria_destino) if args.categoria_destino else None
    dueno_origen = resolver_dueno(est, args.dueno)
    dueno_destino_fijo = resolver_dueno(est, args.dueno_destino) if args.dueno_destino is not None else None

    if origen == destino and cat_destino_fija is None and dueno_destino_fijo is None:
        raise Rechazo("para recategorizar en el mismo potrero hay que dar --categoria-destino o --dueno-destino")
    items, ops, vistos = [], [], set()
    for texto in args.categoria:
        if ":" not in texto:
            raise Rechazo("--categoria tiene que ser CAT:N (llegó %r)" % texto)
        nombre_cat, cant = texto.rsplit(":", 1)
        cat = resolver_categoria(nombre_cat)
        if cat in vistos:
            raise Rechazo("la categoría %s está repetida" % cat)
        vistos.add(cat)
        n = cantidad_valida(cant)
        cat_dest = cat_destino_fija or cat
        dueno_dest = dueno_destino_fijo if dueno_destino_fijo is not None else dueno_origen
        if origen == destino and cat_dest == cat and dueno_dest == dueno_origen:
            raise Rechazo("%s no cambia de categoría ni de dueño dentro de %s" % (cat, origen))
        item = {"categoria": cat, "categoriaDestino": cat_dest, "dueno": dueno_origen, "cantidad": n}
        if dueno_destino_fijo is not None:
            item["duenoDestino"] = dueno_destino_fijo  # la app solo lo manda cuando hubo cambio elegido
        items.append(item)
        ops.append((origen, cat, dueno_origen, -n))
        ops.append((destino, cat_dest, dueno_dest, n))
    detalle = {"destino": destino, "items": items, "obs": args.obs or None}
    return evento(est, "movimiento_multi", origen, detalle, fecha), ops, \
        "Movimiento %s → %s" % (origen, destino)


def construir_nacimiento(args, est, fecha, filas):
    pot = resolver_potrero(est, args.potrero, filas)
    cat = resolver_categoria(args.categoria)
    dueno = resolver_dueno(est, args.dueno)
    n = cantidad_valida(args.cantidad)
    detalle = {"categoria": cat, "dueno": dueno, "cantidad": n, "obs": args.obs or None}
    return evento(est, "nacimiento", pot, detalle, fecha), [(pot, cat, dueno, n)], \
        "Nacimiento +%d %s en %s" % (n, cat, pot)


def construir_muerte(args, est, fecha, filas):
    pot = resolver_potrero(est, args.potrero, filas)
    cat = resolver_categoria(args.categoria)
    dueno = resolver_dueno(est, args.dueno)
    n = cantidad_valida(args.cantidad)
    caravana = args.caravana or None
    if caravana is not None and not REGEX_CARAVANA.match(caravana):
        raise Rechazo("la caravana tiene que tener al menos 8 dígitos numéricos")
    detalle = {"categoria": cat, "dueno": dueno, "cantidad": n, "obs": args.obs or None, "caravana": caravana}
    if cat == "Terneros":
        if args.grupo_ternero not in GRUPOS_TERNERO:
            raise Rechazo("en Terneros hay que elegir --grupo-ternero temporada|marcado")
        detalle["grupoTernero"] = args.grupo_ternero
    elif args.grupo_ternero is not None:
        raise Rechazo("--grupo-ternero solo se usa con la categoría Terneros")
    return evento(est, "muerte", pot, detalle, fecha), [(pot, cat, dueno, -n)], \
        "Muerte -%d %s en %s" % (n, cat, pot)


def buscar_original(est, event_id, pedir_fn):
    """Lee el evento que se quiere anular y verifica que no tenga ya una corrección. Solo SELECT."""
    try:
        uuid.UUID(event_id)
    except ValueError:
        raise Rechazo("--event-id-original no es un UUID válido")
    q = [("select", "event_id,tipo,potrero,detalle,fecha_cliente"),
         ("establecimiento", "eq." + est), ("event_id", "eq." + event_id)]
    status, cuerpo = pedir_fn("GET", "eventos_sync?" + parse.urlencode(q, quote_via=parse.quote), establecimiento=est)
    if status != 200:
        raise RuntimeError("Supabase contestó %s al leer el evento original" % status)
    filas = json.loads(cuerpo or "[]")
    if len(filas) != 1:
        raise Rechazo("no encuentro el evento %s en %s" % (event_id, CS.ESTABLECIMIENTOS[est]["nombre"]))
    orig = filas[0]
    if orig.get("tipo") not in TIPOS_ELIMINABLES:
        raise Rechazo("eliminar solo sirve para %s; un %s se corrige desde la app"
                      % (", ".join(TIPOS_ELIMINABLES), orig.get("tipo")))
    q2 = [("select", "event_id,detalle"), ("establecimiento", "eq." + est), ("tipo", "eq.correccion"),
          ("detalle->>eventIdOriginal", "eq." + event_id)]
    status, cuerpo = pedir_fn("GET", "eventos_sync?" + parse.urlencode(q2, quote_via=parse.quote), establecimiento=est)
    if status != 200:
        raise RuntimeError("Supabase contestó %s al buscar correcciones" % status)
    if json.loads(cuerpo or "[]"):
        raise Rechazo("ese evento ya tiene una corrección cargada: no se anula dos veces")
    return orig


def construir_eliminar(args, est, fecha, filas, orig):
    d = orig.get("detalle") or {}
    tipo = orig["tipo"]
    pot = orig["potrero"]
    fecha_orig = orig.get("fecha_cliente")
    if tipo == "nacimiento":
        reversar = {"tipo": "restar", "potrero": pot, "categoria": d["categoria"],
                    "dueno": d.get("dueno", ""), "cantidad": d["cantidad"]}
        ops = [(pot, d["categoria"], d.get("dueno", ""), -d["cantidad"])]
    elif tipo == "muerte":
        reversar = {"tipo": "sumar", "potrero": pot, "categoria": d["categoria"],
                    "dueno": d.get("dueno", ""), "cantidad": d["cantidad"]}
        if d.get("grupoTernero") in GRUPOS_TERNERO:
            reversar["grupoTernero"] = d["grupoTernero"]
        ops = [(pot, d["categoria"], d.get("dueno", ""), d["cantidad"])]
    else:  # movimiento_multi: el ajuste inverso sale de lo que el evento original dejo escrito
        destino_orig = d["destino"]
        items = d["items"]
        reversar = {"tipo": "mover_multi", "origen": destino_orig, "destino": pot, "items": items}
        ops = []
        for it in items:
            dueno_dest = it["duenoDestino"] if "duenoDestino" in it else it.get("dueno", "")
            cat_dest = it.get("categoriaDestino") or it["categoria"]
            ops.append((destino_orig, cat_dest, dueno_dest, -it["cantidad"]))
            ops.append((pot, it["categoria"], it.get("dueno", ""), it["cantidad"]))
    detalle = {"tipoOriginal": tipo, "historialId": None, "accion": "eliminar", "reversar": reversar,
               "fechaOriginal": fecha_orig, "eventIdOriginal": orig["event_id"]}
    if args.obs:
        detalle["obs"] = args.obs
    return evento(est, "correccion", pot, detalle, fecha), ops, "Eliminar %s del %s" % (tipo, fecha_orig)


# ---------------------------------------------------------------- simular / escribir
def mostrar_simulacion(est, evento_, stock_antes, stock_despues, ops, titulo):
    print("SIMULACIÓN (no se escribió nada). %s — %s" % (titulo, CS.ESTABLECIMIENTOS[est]["nombre"]))
    print("Evento que se cargaría en eventos_sync:")
    print(json.dumps(evento_, ensure_ascii=False, indent=2))
    print("")
    print("Efecto en el stock (según stock_potreros: es la foto de las apps, puede estar atrasada):")
    vistos = []
    for potrero, cat, dueno, _delta in ops:
        k = (potrero, clave_de(cat, dueno))
        if k not in vistos:
            vistos.append(k)
    for k in vistos:
        potrero, clave = k
        cat, _, dueno = clave.partition("||")
        print("  %s — %s%s: %d → %d" % (potrero, cat, texto_firma(est, dueno),
                                       stock_antes.get(k, 0), stock_despues.get(k, 0)))


def escribir(est, evento_, pedir_fn):
    """Un solo POST. Sin reintentos: si no hay respuesta se avisa y se deja decidir a Pedro."""
    status, cuerpo = pedir_fn("POST", "eventos_sync", cuerpo=evento_, establecimiento=est,
                              extra={"Prefer": "return=minimal"})
    codigo, mensaje = "", ""
    try:
        datos = json.loads(cuerpo) if cuerpo and cuerpo.strip().startswith("{") else {}
        codigo = str(datos.get("code") or "")
        mensaje = str(datos.get("message") or "")[:200]
    except ValueError:
        pass
    if status in (200, 201, 204):
        print("Cargado en eventos_sync (event_id %s)." % evento_["event_id"])
        return 0
    if status == 409 or codigo == "23505":
        print("Ya estaba cargado (ese event_id existe): no se duplicó nada.")
        return 0
    if status == 0:
        print("No hubo respuesta de Supabase: NO SE SABE si el evento entró (event_id %s). Revisar "
              "eventos_sync antes de volver a cargar algo." % evento_["event_id"])
        return 2
    print("Supabase rechazó el evento: código %s, mensaje %s (HTTP %s). No se reintentó."
          % (codigo or "—", mensaje or "—", status))
    return 2


def pedir_confirmacion():
    try:
        return input("Escribí SI para cargarlo en la base REAL: ").strip() == "SI"
    except EOFError:
        return False


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    comunes = argparse.ArgumentParser(add_help=False)
    comunes.add_argument("--establecimiento", default="la_vuelta", choices=sorted(CS.ESTABLECIMIENTOS))
    comunes.add_argument("--fecha", help="dd/mm/aaaa (por defecto hoy, hora de Montevideo)")
    comunes.add_argument("--obs", help="observación (opcional)")
    comunes.add_argument("--aplicar", action="store_true",
                         help="ESCRIBE en la base real. Sin esto solo simula")
    comunes.add_argument("--si", action="store_true",
                         help="no pide el SI por teclado (solo después del OK de Pedro)")

    ap = argparse.ArgumentParser(description="Carga eventos en eventos_sync (por defecto simula).")
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mover", parents=[comunes], help="movimiento entre potreros")
    m.add_argument("--desde", required=True, help="potrero de origen")
    m.add_argument("--hacia", required=True, help="potrero de destino (el mismo para recategorizar)")
    m.add_argument("--categoria", action="append", metavar="CAT:N",
                   help="categoría y cantidad, p. ej. \"Vacas:5\" (se puede repetir)")
    m.add_argument("--dueno", default=None, help="dueño/firma de origen ('' o sin dar = sin asignar en La Vuelta)")
    m.add_argument("--categoria-destino", default=None, help="categoría de destino para todas las líneas")
    m.add_argument("--dueno-destino", default=None, help="dueño/firma de destino para todas las líneas")

    n = sub.add_parser("nacimiento", parents=[comunes], help="suma animales")
    n.add_argument("--potrero", required=True)
    n.add_argument("--categoria", required=True)
    n.add_argument("--cantidad", required=True, type=int)
    n.add_argument("--dueno", default=None)

    mu = sub.add_parser("muerte", parents=[comunes], help="resta animales")
    mu.add_argument("--potrero", required=True)
    mu.add_argument("--categoria", required=True)
    mu.add_argument("--cantidad", required=True, type=int)
    mu.add_argument("--dueno", default=None)
    mu.add_argument("--grupo-ternero", choices=GRUPOS_TERNERO, default=None,
                    help="obligatorio con Terneros: temporada o marcado")
    mu.add_argument("--caravana", default=None, help="opcional, 8 dígitos o más")

    el = sub.add_parser("eliminar", parents=[comunes], help="anula un evento por su event_id")
    el.add_argument("--event-id-original", required=True, help="event_id del evento que se anula")

    args = ap.parse_args(argv)
    est = args.establecimiento

    try:
        fecha = fecha_dmy(args.fecha)
        original = None
        if args.cmd == "eliminar":
            original = buscar_original(est, args.event_id_original, pedir)
        filas = CS.leer_stock(est, pedir_fn=pedir)
        if args.cmd == "mover":
            evento_, ops, titulo = construir_mover(args, est, fecha, filas)
        elif args.cmd == "nacimiento":
            evento_, ops, titulo = construir_nacimiento(args, est, fecha, filas)
        elif args.cmd == "muerte":
            evento_, ops, titulo = construir_muerte(args, est, fecha, filas)
        else:
            evento_, ops, titulo = construir_eliminar(args, est, fecha, filas, original)
        antes = mapa_stock(filas)
        despues = aplicar_ops(antes, ops)
        revisar_negativos(est, antes, despues, ops)
    except Rechazo as e:
        print("NO SE CARGA: %s." % e, file=sys.stderr)
        return 1
    except RuntimeError as e:
        print("ERROR: %s. No se escribió nada." % e, file=sys.stderr)
        return 2

    mostrar_simulacion(est, evento_, antes, despues, ops, titulo)
    if not args.aplicar:
        print("")
        print("Nada se escribió. Para cargarlo: el mismo comando con --aplicar (pide el SI).")
        return 0
    if not args.si and not pedir_confirmacion():
        print("No se cargó: no se escribió SI.")
        return 1
    return escribir(est, evento_, pedir)


if __name__ == "__main__":
    sys.exit(main())
