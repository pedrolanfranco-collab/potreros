# -*- coding: utf-8 -*-
"""anotar_trabajo.py -- anota trabajos de campo dictados por Pedro en `eventos_sync`.

Tres cosas, que son las que pide por WhatsApp:
  - *destete*   -> `evento_manejo` tipo "Destete" (potrero, categoria, cantidad, obs). No toca stock.
  - *evento*    -> `evento_manejo` de un trabajo cualquiera: IATF, caravaneo, pesada, recuento, recorrida.
  - *limpieza*  -> `limpieza_punto` (limpieza de un bebedero o un tanque; el punto se busca por nombre).
  - *arreglo* / *tarea* -> `tarea_creada` (Infraestructura/Mantenimiento: algo roto para reparar;
                  con --tema Ganado sirve para programar un trabajo, p. ej. el dia 7 de una IATF).
  - *corregir*  -> `evento_manejo_editado`: rehace un evento de manejo ya cargado (mismo id) cuando se anoto mal.
  - *anular*    -> `evento_manejo_eliminado`: lo deja sin efecto (tombstone por id).

Simula siempre por defecto: para escribir hay que pasar `--aplicar` (y pide el SI; con `--si` no lo pide,
que es lo que usa Hermes despues del OK de Pedro).
"""
import argparse
import datetime
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_evento as CE  # noqa: E402

TEMAS = ("Ganado", "Infraestructura", "Mantenimiento", "Otras")
TEMAS_TAREA = {
    "Ganado": ["Inicio de entore", "Fin de entore", "Inicio destete temporario (DT)",
               "Fin destete temporario (DT)", "Destete final", "Otra…"],
    "Infraestructura": ["Alambrado", "Bebedero", "Tajamar", "Portera", "Otra…"],
    "Mantenimiento": ["Limpieza de tanque", "Limpieza de bebedero", "Otra…"],
    "Otras": ["Otra…"],
}


def fecha_prevista(texto):
    """dd/mm/aaaa para una tarea: a diferencia del resto, puede ser futura."""
    import re as _re
    if texto is None:
        return CE.hoy_mvd().strftime("%d/%m/%Y")
    if not _re.match(r"^\d{2}/\d{2}/\d{4}$", texto):
        raise CE.Rechazo("la fecha tiene que ser dd/mm/aaaa (llegó %r)" % texto)
    try:
        datetime.datetime.strptime(texto, "%d/%m/%Y")
    except ValueError:
        raise CE.Rechazo("la fecha %s no existe" % texto)
    return texto


def confirmar(mensaje, log=print):
    """Confirmacion por teclado (solo cuando se corre a mano, sin --si)."""
    try:
        return input(mensaje).strip().upper() == "SI"
    except EOFError:
        return False


def puntos_de(est, pedir_fn, log=print):
    """Los puntos (bebederos, tanques, ...) reconstruidos de los eventos, por nombre en minusculas."""
    from urllib import parse
    q = {"select": "tipo,detalle", "order": "creado_en.asc,id.asc"}
    status, cuerpo = pedir_fn("GET", "eventos_sync?" + parse.urlencode(q, quote_via=parse.quote),
                              establecimiento=est)
    if status != 200:
        raise CE.Rechazo("no pude leer los puntos (HTTP %s)" % status)
    import json
    puntos = {}
    for fila in json.loads(cuerpo or "[]"):
        d = fila.get("detalle") or {}
        pid = d.get("id")
        if not pid:
            continue
        if fila["tipo"] == "punto_creado":
            puntos[pid] = {"id": pid, "nombre": str(d.get("nombre") or "").strip(),
                           "subtipo": str(d.get("subtipo") or d.get("tipo") or "").strip()}
        elif fila["tipo"] == "punto_renombrado" and pid in puntos:
            puntos[pid]["nombre"] = str(d.get("nombre") or "").strip()
        elif fila["tipo"] == "punto_eliminado":
            puntos.pop(pid, None)
    return [p for p in puntos.values() if p["nombre"]]


def buscar_punto(est, texto, pedir_fn):
    """Busca un punto por nombre (o por parte del nombre). Si hay varios, los muestra y no elige."""
    puntos = puntos_de(est, pedir_fn)
    if not puntos:
        raise CE.Rechazo("no encontre ningun punto cargado en %s" % est)
    t = str(texto or "").strip().lower()
    exacto = [p for p in puntos if p["nombre"].lower() == t]
    if len(exacto) == 1:
        return exacto[0]
    parecidos = [p for p in puntos if t and t in p["nombre"].lower()]
    if len(parecidos) == 1:
        return parecidos[0]
    if not parecidos:
        nombres = ", ".join(sorted(p["nombre"] for p in puntos)[:12])
        raise CE.Rechazo("no encuentro el punto '%s'; los que hay son: %s" % (texto, nombres))
    raise CE.Rechazo("'%s' coincide con varios puntos: %s"
                     % (texto, ", ".join(p["nombre"] for p in parecidos)))


def construir_destete(args, est, fecha, pedir_fn):
    if not str(args.potrero or "").strip():
        raise CE.Rechazo("falta --potrero")
    potrero = str(args.potrero).strip()
    detalle = {"id": str(uuid.uuid4()), "tipo": "Destete",
               "usuario": (args.quien or "Hermes").strip()}
    if potrero:
        detalle["potrero"] = potrero
    if args.categoria:
        detalle["categoria"] = str(args.categoria).strip()
    if args.cantidad:
        detalle["cantidad"] = int(args.cantidad)
    if args.obs:
        detalle["obs"] = str(args.obs).strip()
    return CE.evento(est, "evento_manejo", potrero, detalle, fecha), "Destete"


def construir_limpieza(args, est, fecha, pedir_fn):
    if not str(args.punto or "").strip():
        raise CE.Rechazo("falta --punto (el nombre del bebedero o del tanque)")
    p = buscar_punto(est, args.punto, pedir_fn)
    detalle = {"id": str(uuid.uuid4()), "puntoId": p["id"], "puntoNombre": p["nombre"],
               "puntoSubtipo": p["subtipo"], "fecha": fecha, "quien": (args.quien or "").strip(),
               "obs": (args.obs or "").strip(), "usuario": (args.quien or "Hermes").strip()}
    return CE.evento(est, "limpieza_punto", est, detalle, fecha), "Limpieza de %s" % p["nombre"]


def _detalle_tarea(args, fecha, pedir_fn, est, ident=None):
    """El detalle de una tarea (lo comparten el alta `tarea_creada` y la correccion `tarea_editada`)."""
    tema = str(args.tema or "Mantenimiento").strip()
    if tema not in TEMAS:
        raise CE.Rechazo("tema '%s' (tiene que ser uno de: %s)" % (tema, ", ".join(TEMAS)))
    tipo = str(args.tipo_tarea or (TEMAS_TAREA[tema][0])).strip()
    if tipo not in TEMAS_TAREA[tema]:
        raise CE.Rechazo("tipo '%s' no esta en el tema %s (hay: %s)"
                         % (tipo, tema, ", ".join(TEMAS_TAREA[tema])))
    detalle = {"ts": datetime.datetime.now().isoformat(timespec="seconds"),
               "temaGrupo": tema, "tema": str(args.obs or tipo).strip()[:160], "tipo": tipo,
               "fechaPrevista": fecha, "usuario": (args.quien or "Hermes").strip()}
    if ident:
        detalle["id"] = ident
    else:
        detalle["id"] = str(uuid.uuid4())
    if args.punto:
        p = buscar_punto(est, args.punto, pedir_fn)
        detalle["puntoId"] = p["id"]
        detalle["puntoNombre"] = p["nombre"]
    elif args.potrero:
        detalle["potrero"] = str(args.potrero).strip()
    if args.cada_dias:
        detalle["cadaDias"] = int(args.cada_dias)
    if args.obs:
        detalle["obs"] = str(args.obs).strip()
    return detalle


def construir_arreglo(args, est, fecha, pedir_fn):
    detalle = _detalle_tarea(args, fecha, pedir_fn, est)
    return CE.evento(est, "tarea_creada", detalle.get("potrero") or (detalle.get("puntoNombre") or est),
                     detalle, fecha), "%s (%s)" % (detalle["tipo"], detalle["temaGrupo"])


def construir_tarea_corregir(args, est, fecha, pedir_fn):
    """Rehace una tarea ya creada (mismo id): `tarea_editada`. Sirve, por ejemplo, para agregarle repeticion."""
    ident = str(args.event_id or "").strip()
    if not ident:
        raise CE.Rechazo("falta --event-id (el id de la tarea que se corrige)")
    detalle = _detalle_tarea(args, fecha, pedir_fn, est, ident=ident)
    return CE.evento(est, "tarea_editada", detalle.get("potrero") or (detalle.get("puntoNombre") or est),
                     detalle, fecha), "correccion de la tarea %s: %s (%s)" % (ident[:8], detalle["tipo"],
                                                                            detalle["temaGrupo"])


def construir_evento(args, est, fecha, pedir_fn):
    """Un trabajo de campo cualquiera (IATF, caravaneo, pesada, recuento, recorrida...).

    Es un `evento_manejo`: queda en el historial y en el Calendario de la app, y no toca el stock.
    """
    trabajo = str(args.trabajo or "").strip()
    if not trabajo:
        raise CE.Rechazo("falta --trabajo (que se hizo, p. ej. 'IATF - dia 0: colocacion del implante')")
    potrero = str(args.potrero or "").strip()
    detalle = {"id": str(uuid.uuid4()), "tipo": trabajo[:80],
               "usuario": (args.quien or "Hermes").strip()}
    if potrero:
        detalle["potrero"] = potrero
    if args.categoria:
        detalle["categoria"] = str(args.categoria).strip()
    if args.cantidad:
        detalle["cantidad"] = int(args.cantidad)
    if args.obs:
        detalle["obs"] = str(args.obs).strip()
    return CE.evento(est, "evento_manejo", potrero or est, detalle, fecha), trabajo


def construir_corregir(args, est, fecha, pedir_fn):
    """Corrige un evento de manejo ya cargado (mismo id): `evento_manejo_editado`."""
    ident = str(args.event_id or "").strip()
    if not ident:
        raise CE.Rechazo("falta --event-id (el id del evento de manejo que se corrige)")
    trabajo = str(args.trabajo or "").strip()
    if not trabajo:
        raise CE.Rechazo("falta --trabajo (el tipo corregido)")
    potrero = str(args.potrero or "").strip()
    detalle = {"id": ident, "ts": datetime.datetime.now().isoformat(timespec="seconds"),
               "fecha": fecha, "tipo": trabajo[:80], "usuario": (args.quien or "Hermes").strip()}
    if potrero:
        detalle["potrero"] = potrero
    if args.categoria:
        detalle["categoria"] = str(args.categoria).strip()
    if args.cantidad:
        detalle["cantidad"] = int(args.cantidad)
    if args.obs:
        detalle["obs"] = str(args.obs).strip()
    return CE.evento(est, "evento_manejo_editado", potrero or est, detalle, fecha), \
        "correccion de %s" % ident[:8]


def construir_anular(args, est, fecha, pedir_fn):
    """Anula un evento de manejo ya cargado: `evento_manejo_eliminado` (deja el tombstone por id)."""
    ident = str(args.event_id or "").strip()
    if not ident:
        raise CE.Rechazo("falta --event-id (el id del evento de manejo que se anula)")
    detalle = {"id": ident, "ts": datetime.datetime.now().isoformat(timespec="seconds")}
    return CE.evento(est, "evento_manejo_eliminado", est, detalle, fecha), \
        "anulacion de %s" % ident[:8]


CONSTRUCTORES = {"destete": construir_destete, "limpieza": construir_limpieza,
                 "arreglo": construir_arreglo, "tarea": construir_arreglo,
                 "tarea-corregir": construir_tarea_corregir,
                 "evento": construir_evento, "corregir": construir_corregir,
                 "anular": construir_anular}
TAREAS = ("arreglo", "tarea", "tarea-corregir")   # los unicos que pueden programarse para adelante


def main(argv=None):
    ap = argparse.ArgumentParser(description="Anota un trabajo de campo en eventos_sync (simula por defecto).")
    ap.add_argument("--tipo", required=True, choices=sorted(CONSTRUCTORES),
                    help="destete | evento | tarea (arreglo) | tarea-corregir | limpieza | corregir | anular")
    ap.add_argument("--event-id", dest="event_id", help="con corregir/anular: el id del evento de manejo")
    ap.add_argument("--establecimiento", default="la_vuelta",
                    choices=("la_vuelta", "maria_laura", "pone_chico"))
    ap.add_argument("--fecha", "--fecha-prevista", dest="fecha",
                    help="dd/mm/aaaa (por defecto hoy). En tarea/arreglo es la fecha prevista de la tarea")
    ap.add_argument("--potrero")
    ap.add_argument("--categoria")
    ap.add_argument("--cantidad", type=int)
    ap.add_argument("--trabajo", help="con --tipo evento: que se hizo (IATF, caravaneo, pesada, ...)")
    ap.add_argument("--punto", help="nombre del punto (bebedero, tanque, ...)")
    ap.add_argument("--tema", help="Ganado | Infraestructura | Mantenimiento | Otras") 
    ap.add_argument("--tipo-tarea", dest="tipo_tarea", help="el tipo dentro del tema")
    ap.add_argument("--cada-dias", dest="cada_dias", type=int)
    ap.add_argument("--quien", help="quien lo hizo (texto libre)")
    ap.add_argument("--obs")
    ap.add_argument("--aplicar", action="store_true", help="ESCRIBE en la base real")
    ap.add_argument("--si", action="store_true", help="no pide el SI por teclado")
    args = ap.parse_args(argv)

    est = args.establecimiento
    fecha = args.fecha or CE.hoy_mvd().strftime("%d/%m/%Y")
    try:
        if args.fecha:
            # destete y limpieza son hechos (no futuros); la tarea puede programarse para adelante
            fecha = fecha_prevista(args.fecha) if args.tipo in TAREAS else CE.fecha_dmy(args.fecha)
        evento_, titulo = CONSTRUCTORES[args.tipo](args, est, fecha, CE.pedir)
    except CE.Rechazo as e:
        print("NO SE CARGA: %s." % e, file=sys.stderr)
        return 1
    except RuntimeError as e:
        print("ERROR: %s. No se escribió nada." % e, file=sys.stderr)
        return 2

    print("Trabajo para anotar: %s — %s — %s" % (titulo, est, fecha))
    print("Tipo de evento: %s" % evento_["tipo"])
    print("Detalle: %s" % evento_["detalle"])
    if not args.aplicar:
        print("")
        print("Nada se escribió. Para anotarlo: el mismo comando con --aplicar (pide el SI).")
        return 0
    if not args.si and not confirmar("Escribí SI para confirmar: "):
        print("No se cargó: no se escribió SI.")
        return 1
    return CE.escribir(est, evento_, CE.pedir)


if __name__ == "__main__":
    sys.exit(main())
