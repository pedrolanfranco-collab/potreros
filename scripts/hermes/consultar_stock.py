# -*- coding: utf-8 -*-
"""
consultar_stock.py -- stock actual por potrero, SOLO LECTURA (para el agente Hermes).

Lee la tabla `stock_potreros` de Supabase con la clave publicable (la misma que usan las apps),
asi que no hace falta ningun token de cuenta. Nunca escribe nada.

    python scripts/hermes/consultar_stock.py                                  # La Vuelta, todo
    python scripts/hermes/consultar_stock.py --establecimiento maria_laura
    python scripts/hermes/consultar_stock.py --potrero 10
    python scripts/hermes/consultar_stock.py --categoria "Vacas" --json

OJO: `stock_potreros` es la FOTO que publican las apps (una fila por potrero, categoria y dueno,
con el stock que tenian al ultimo sincronizar). No es el stock "verdadero": ese es la reproduccion de
`eventos_sync`. Si ningun equipo sincronizo despues de un movimiento, la foto puede estar atrasada.

Las listas de potreros, duenos y categorias que estan aca son copias de template/configs/*.js y
del template; scripts/hermes/probar_consultar_stock.py falla si dejan de coincidir.
"""
import argparse
import json
import os
import sys
import unicodedata
from urllib import error, parse, request

SUPA_URL = "https://skkknfjpwcstefcroqjt.supabase.co"
HOSTS_PERMITIDOS = ("skkknfjpwcstefcroqjt.supabase.co", "localhost", "127.0.0.1")
# Clave PUBLICABLE (anon) de las apps: esta en template/potreros.template.html. No es secreta;
# la clave privada nunca se usa en este script.
CLAVE_PUBLICA = "sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"
TAM_PAGINA = 1000

ESTABLECIMIENTOS = {
    "la_vuelta": {
        "nombre": "La Vuelta",
        "potreros": ["CERRO", "14", "EMBARCADERO", "CERRITO", "17", "15", "18", "BOMBA", "23", "7", "8",
                     "9", "OMBU", "10", "PAST", "26", "21", "TRI", "19", "13", "12", "CALLE", "TAJAMAR",
                     "16", "20", "11", "6", "1", "2", "3", "5"],
        "duenos": ["Pedro Lanfranco", "Silvia Dutra", "Fideicomiso", "Walter Lanfranco"],
        "dueno_obligatorio": False,
        "texto_sin_dueno": "(sin firma)",
        "usa_clave_campo": True,
    },
    "maria_laura": {
        "nombre": "María Laura",
        "potreros": ["Tajamar", "Casco", "Uno", "Rincon", "Manantial"],
        "duenos": ["Silvia", "Perico", "Mili", "Pedro", "Juan Pablo", "Fito"],
        "dueno_obligatorio": True,
        "texto_sin_dueno": "(sin dueño)",
        "usa_clave_campo": True,
    },
    "pone_chico": {
        "nombre": "Pone Chico",
        "potreros": [],
        "duenos": ["Chico", "Pablo", "Kelbi"],
        "dueno_obligatorio": True,
        "texto_sin_dueno": "(sin dueño)",
        "usa_clave_campo": False,
    },
}

# Las 24 categorias de ESPECIES en el template (UG_DEFAULT = bovino + ovino + equino).
CATEGORIAS = [
    "Terneros", "Terneras", "Novillitos 1-2 años", "Novillos 2-3 años", "Novillos +3 años",
    "Vaquillonas 1-2 años", "Vaquillonas 2-3 años", "Vaquillona de invernada", "Vacas",
    "Vacas de invernada", "Toros", "Bueyes", "Otros bovinos",
    "Corderos/as", "Ovejas", "Capones", "Carneros", "Borregos DL", "Borregas DL", "Otros ovinos",
    "Potros/as", "Yeguas", "Caballos", "Otros equinos",
]


# ---------------------------------------------------------------- utilidades compartidas
def normalizar(texto):
    """Sin tildes, sin mayusculas, sin espacios de mas: para comparar lo que tipea una persona."""
    t = unicodedata.normalize("NFD", str(texto if texto is not None else ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.lower().split())


def canonico(lista, texto):
    """El nombre tal como lo escribe la app (de `lista`), o None si no esta."""
    buscado = normalizar(texto)
    for nombre in lista:
        if normalizar(nombre) == buscado:
            return nombre
    return None


def _palabra_coincide(buscada, nombre):
    """Una palabra tipeada encuentra la del nombre si es la misma o una empieza con la otra
    ('vaquillonas' encuentra 'vaquillona'); las palabras de menos de 3 letras tienen que ser iguales."""
    if len(buscada) < 3 or len(nombre) < 3:
        return buscada == nombre
    return buscada.startswith(nombre) or nombre.startswith(buscada)


def categorias_que_coinciden(texto, conocidas):
    """Las categorias de `conocidas` a las que se refiere lo que tipeo la persona. Un nombre completo
    (sin tildes ni mayusculas) encuentra solo esa; si no, cada palabra tipeada tiene que estar en el nombre
    ('vaquillonas' encuentra 'Vaquillonas 1-2 años' y 'Vaquillonas 2-3 años'). [] si no es ninguna."""
    buscado = normalizar(texto)
    exactas = [c for c in conocidas if normalizar(c) == buscado]
    if exactas:
        return exactas[:1]
    palabras = buscado.split()
    if not palabras:
        return []
    return [c for c in conocidas
            if all(any(_palabra_coincide(p, q) for q in normalizar(c).split()) for p in palabras)]


def fmt_num(n):
    """Numero con coma decimal y sin ceros de cola: 0.6 -> '0,6', 2.0 -> '2'."""
    if n is None:
        return "—"
    s = ("%.2f" % float(n)).rstrip("0").rstrip(".")
    return s.replace(".", ",") if s not in ("", "-") else "0"


def animales_txt(n):
    return "%d animal%s" % (n, "" if n == 1 else "es")


def _archivo_env():
    return os.environ.get("POTREROS_ENV") or os.path.join(os.path.expanduser("~"), ".potreros", ".env")


def clave_campo(establecimiento):
    """Clave del campo (encabezado x-clave-campo), de la variable CLAVE_CAMPO_<EST> o de ~/.potreros/.env.
    Nunca se imprime. None si no hay (o si el establecimiento no la usa)."""
    if not ESTABLECIMIENTOS.get(establecimiento, {}).get("usa_clave_campo"):
        return None
    nombre = "CLAVE_CAMPO_" + establecimiento.upper()
    clave = (os.environ.get(nombre) or "").strip().strip('"').strip("'")
    if not clave:
        archivo = _archivo_env()
        if os.path.exists(archivo):
            try:
                with open(archivo, encoding="utf-8-sig") as fh:
                    for linea in fh:
                        linea = linea.strip()
                        if linea and not linea.startswith("#") and "=" in linea:
                            k, v = linea.split("=", 1)
                            if k.strip().replace("export ", "") == nombre:
                                clave = v.strip().strip('"').strip("'")
                                break
            except OSError:
                return None
    return clave or None


def pedir(metodo, ruta, cuerpo=None, establecimiento=None, extra=None):
    """UNICA funcion que habla con la red (las pruebas la reemplazan por una falsa).
    Devuelve (status, texto). status 0 = no hubo respuesta."""
    url = "%s/rest/v1/%s" % (SUPA_URL, ruta)
    host = (parse.urlparse(url).hostname or "").lower()
    if host not in HOSTS_PERMITIDOS:
        raise RuntimeError("host no permitido")
    cab = {"apikey": CLAVE_PUBLICA, "Authorization": "Bearer " + CLAVE_PUBLICA}
    clave = clave_campo(establecimiento) if establecimiento else None
    if clave:
        cab["x-clave-campo"] = clave
    datos = None
    if cuerpo is not None:
        cab["Content-Type"] = "application/json"
        datos = json.dumps(cuerpo).encode("utf-8")
    if extra:
        cab.update(extra)
    req = request.Request(url, data=datos, headers=cab, method=metodo)
    try:
        with request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except (error.URLError, OSError) as e:
        # Solo el tipo de error: el motivo puede traer la URL.
        return 0, "sin respuesta (%s)" % e.__class__.__name__


# ---------------------------------------------------------------- lectura
def normalizar_fila(f):
    cantidad = int(f.get("cantidad") or 0)
    ug = f.get("ug")
    dueno = f.get("dueno") or ""
    categoria = f.get("categoria") or ""
    return {
        "potrero": f.get("potrero") or "",
        "categoria": categoria,
        "dueno": dueno,
        "clave": categoria + "||" + dueno,
        "cantidad": cantidad,
        "ug": float(ug) if ug is not None else None,
    }


def leer_stock(establecimiento, potrero=None, pedir_fn=None):
    """Todas las filas de stock_potreros del establecimiento (paginando de a 1000: PostgREST corta sin
    avisar). Lanza RuntimeError si Supabase no contesta 200. `pedir_fn` permite que cargar_evento use
    su propio transporte (las pruebas lo reemplazan)."""
    fn = pedir_fn or pedir
    filas = []
    desde = 0
    while True:
        q = [("select", "potrero,clave,categoria,dueno,cantidad,ug"),
             ("establecimiento", "eq." + establecimiento),
             ("order", "potrero.asc,clave.asc"),
             ("limit", str(TAM_PAGINA)),
             ("offset", str(desde))]
        if potrero is not None:
            q.append(("potrero", "eq." + potrero))
        ruta = "stock_potreros?" + parse.urlencode(q, quote_via=parse.quote)
        status, cuerpo = fn("GET", ruta, establecimiento=establecimiento)
        if status != 200:
            raise RuntimeError("Supabase contesto %s al leer stock_potreros" % status)
        lote = json.loads(cuerpo or "[]")
        filas.extend(normalizar_fila(f) for f in lote)
        if len(lote) < TAM_PAGINA:
            return filas
        desde += TAM_PAGINA


def orden_natural(nombre):
    """Numeros en orden numerico (2 antes que 10); lo demas despues, en orden alfabetico."""
    if nombre.isdigit():
        return (0, int(nombre), "")
    return (1, 0, normalizar(nombre))


def agrupar(filas, potrero=None, categoria=None, establecimiento="la_vuelta"):
    """Filas -> lista de potreros con sus renglones y totales, filtradas como pidio la persona.
    `categoria` es un nombre o una lista de nombres de categoria."""
    texto_sin = ESTABLECIMIENTOS[establecimiento]["texto_sin_dueno"]
    if isinstance(categoria, str):
        categoria = [categoria]
    categorias_ok = None if categoria is None else {normalizar(c) for c in categoria}
    por_potrero = {}
    for f in filas:
        if potrero is not None and f["potrero"] != potrero:
            continue
        if categorias_ok is not None and normalizar(f["categoria"]) not in categorias_ok:
            continue
        por_potrero.setdefault(f["potrero"], []).append(f)
    if potrero is not None and potrero not in por_potrero:
        por_potrero[potrero] = []
    salida = []
    for nombre in sorted(por_potrero, key=orden_natural):
        renglones = sorted(por_potrero[nombre], key=lambda r: (normalizar(r["categoria"]), normalizar(r["dueno"])))
        animales = sum(r["cantidad"] for r in renglones)
        ug = sum(r["ug"] or 0 for r in renglones)
        salida.append({
            "potrero": nombre,
            "sin_filas": not renglones,
            "filas": [{"categoria": r["categoria"], "dueno": r["dueno"] or None, "cantidad": r["cantidad"], "ug": r["ug"]}
                      for r in renglones],
            "animales": animales,
            "ug": round(ug, 4),
            "_texto_sin": texto_sin,
        })
    return salida


def imprimir_texto(establecimiento, grupos, categoria=None):
    nombre = ESTABLECIMIENTOS[establecimiento]["nombre"]
    print("Stock de %s segun stock_potreros (la foto que publican las apps: si ningun equipo sincronizo "
          "despues de un movimiento, puede estar atrasada)." % nombre)
    total_animales, total_ug = 0, 0.0
    for g in grupos:
        print("")
        print("%s" % g["potrero"])
        if g["sin_filas"]:
            if categoria:
                print("  0 animales de %s (sin filas en stock_potreros)" % categoria)
            else:
                print("  0 animales (sin filas en stock_potreros)")
            continue
        for r in g["filas"]:
            firma = r["dueno"] if r["dueno"] else g["_texto_sin"]
            print("  %s — %s: %d (%s UG)" % (r["categoria"], firma, r["cantidad"], fmt_num(r["ug"])))
        print("  Total del potrero: %s, %s UG" % (animales_txt(g["animales"]), fmt_num(g["ug"])))
        total_animales += g["animales"]
        total_ug += g["ug"]
    print("")
    if not grupos:
        print("No hay filas en stock_potreros para esos filtros.")
    print("TOTAL: %s, %s UG" % (animales_txt(total_animales), fmt_num(total_ug)))


def main(argv=None):
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="Stock actual por potrero (solo lectura, stock_potreros).")
    ap.add_argument("--establecimiento", default="la_vuelta", choices=sorted(ESTABLECIMIENTOS),
                    help="por defecto la_vuelta")
    ap.add_argument("--potrero", help="un solo potrero (sin tildes ni mayusculas da igual)")
    ap.add_argument("--categoria", help="categoria: el nombre completo o parte ('vaquillonas' trae las de 1-2 y "
                                        "2-3 años); sin tildes ni mayusculas da igual")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    args = ap.parse_args(argv)

    est = args.establecimiento
    potrero = None
    if args.potrero is not None:
        potrero = canonico(ESTABLECIMIENTOS[est]["potreros"], args.potrero) or args.potrero.strip()

    try:
        filas = leer_stock(est)
    except RuntimeError as e:
        print("ERROR: %s." % e, file=sys.stderr)
        return 1
    categorias = None
    if args.categoria is not None:
        conocidas = list(CATEGORIAS) + sorted({f["categoria"] for f in filas
                                               if f["categoria"] and f["categoria"] not in CATEGORIAS})
        categorias = categorias_que_coinciden(args.categoria, conocidas)
        if not categorias:
            # Antes un nombre que no coincidia exacto devolvia "0 animales" como si no hubiera ninguno.
            print("ERROR: \"%s\" no es ninguna categoria conocida. Categorias: %s."
                  % (args.categoria.strip(), ", ".join(conocidas)), file=sys.stderr)
            return 2
    categoria = " / ".join(categorias) if categorias else None
    grupos = agrupar(filas, potrero=potrero, categoria=categorias, establecimiento=est)
    if potrero is not None and potrero not in ESTABLECIMIENTOS[est]["potreros"] and not any(
            not g["sin_filas"] for g in grupos):
        print("Aviso: \"%s\" no esta en la lista de potreros de %s (¿nombre bien escrito?)."
              % (potrero, ESTABLECIMIENTOS[est]["nombre"]), file=sys.stderr)

    if args.json:
        total_ug = round(sum(g["ug"] for g in grupos), 4)
        salida = {
            "establecimiento": est,
            "fuente": "stock_potreros",
            "aviso": "foto publicada por las apps; puede estar atrasada si nadie sincronizo despues",
            "potreros": [{k: v for k, v in g.items() if not k.startswith("_")} for g in grupos],
            "total": {"animales": sum(g["animales"] for g in grupos), "ug": total_ug},
        }
        print(json.dumps(salida, ensure_ascii=False, indent=2))
    else:
        imprimir_texto(est, grupos, categoria=categoria)
    return 0


if __name__ == "__main__":
    sys.exit(main())
