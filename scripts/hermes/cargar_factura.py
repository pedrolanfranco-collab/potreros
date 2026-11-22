# -*- coding: utf-8 -*-
"""
cargar_factura.py -- carga una factura de veterinaria (El Gaucho, Santana) como ENTRADA de stock de Insumos.

Hermes lee la foto que Pedro manda por WhatsApp, arma un JSON con las lineas y llama a este script. Por defecto
SIMULA: valida, empareja cada linea con el catalogo y muestra que entraria al stock del campo y como cambia el
precio por ml. Para escribir hace falta --aplicar; ademas pide que se escriba SI (salvo con --si, que Hermes usa
SOLO despues del "si" explicito de Pedro).

    python scripts/hermes/cargar_factura.py --json factura.json                 # simula
    python scripts/hermes/cargar_factura.py --json factura.json --aplicar       # escribe (pide SI)
    python scripts/hermes/cargar_factura.py --json - --foto factura.jpg ...     # JSON por la entrada + foto

Formato del JSON (ver README.md de esta carpeta):
    {"proveedor": "El Gaucho", "tipo": "factura", "numero": "A 106208", "fecha": "2026-11-17",
     "moneda": "USD", "subtotal": 312.5, "total": 312.5, "condicion": "credito",
     "establecimiento": "la_vuelta", "cotizacion_usd": null,
     "lineas": [{"codigo": "100533", "texto": "MEXIVER x 500 ml", "cantidad": 4, "precio_unitario": 38.9,
                 "producto": null, "contenido_ml": null, "dosis_por_envase": null},
                {"codigo": "300200", "texto": "BALDE 10 L", "cantidad": 1, "precio_unitario": 6.5, "no_stock": true}]}
Una linea con "no_stock": true (caravana, balde, alambre: lo que no es un producto veterinario) cuenta para que
las lineas sumen el total, pero no entra al stock ni toca precios.

Que escribe (todo con la clave PRIVADA: desde la Fase 6 estas tablas estan cerradas a la llave publica):
  1. alias_productos  -- solo para lineas sin alias, con el producto EXACTO del catalogo que confirmo Pedro.
  2. cotizaciones     -- BRL/UYU, si vino cotizacion_usd y esa fecha no estaba.
  3. comprobantes     -- la factura, con su establecimiento (si ya estaba, la reusa: no se duplica).
  4. precios_vet      -- una fila por producto: cantidad x contenido_envase = ml que ENTRAN al stock. El trigger
                         trg_precios_catalogo pasa el USD/ml nuevo a productos_catalogo (costo de la planilla).
  5. insumos_ajustes  -- si el producto no tenia conteo en ese campo: conteo inicial 0 el dia ANTERIOR a la
                         factura, asi el stock arranca con lo comprado (decision de Pedro, 17/11/2026).
Despues lee de vuelta stock_insumos y solo da por hecho lo que volvio.

La salida del stock no la hace este script: la vista movimientos_insumo resta cada tratamiento de la planilla
sanitaria (dosis x animales) y el baño. La app la muestra en "Insumos" (RPC stock_insumos_app).

Codigos de salida: 0 = simulado / cargado / ya estaba; 1 = rechazado (no se escribio nada); 2 = error de red o
del servidor (leer el mensaje: puede haber quedado a medias, se arregla corriendo el MISMO JSON otra vez).
"""
import argparse
import datetime
import difflib
import json
import os
import re
import sys
import unicodedata
import uuid
from urllib import error, parse, request

SUPA_URL = "https://skkknfjpwcstefcroqjt.supabase.co"
HOSTS_PERMITIDOS = ("skkknfjpwcstefcroqjt.supabase.co", "localhost", "127.0.0.1")
VARIABLE_CLAVE = "SUPABASE_SECRET_KEY"
BUCKET_FOTOS = "fotos-precios"

ESTABLECIMIENTOS = {                 # lo que puede escribir Hermes -> valor de la base
    "la_vuelta": "la_vuelta", "la vuelta": "la_vuelta", "lv": "la_vuelta",
    "maria_laura": "maria_laura", "maria laura": "maria_laura", "ml": "maria_laura",
}
SIN_INSUMOS = ("pone_chico", "pone chico", "pc")
TIPOS = ("factura", "otro")          # listas, presupuestos y gondola NO son compras: no suman stock
MONEDAS = ("USD", "BRL", "UYU")
NAMESPACE_UID = uuid.UUID("6f1c2b7e-9a43-4d55-8e0b-3f2a1c9d7b10")   # fijo: el mismo JSON da el mismo uid


class Rechazo(Exception):
    """La factura no se carga (dato faltante o dudoso). No se escribio nada."""


class ErrorServidor(Exception):
    """Supabase no contesto o contesto con error."""


# ---------------------------------------------------------------- clave y transporte
def _archivo_env():
    return os.environ.get("POTREROS_ENV") or os.path.join(os.path.expanduser("~"), ".potreros", ".env")


def clave_privada():
    """(clave, problema). Rechaza la clave publica. Nunca se imprime."""
    clave = (os.environ.get(VARIABLE_CLAVE) or "").strip().strip('"').strip("'")
    ruta = _archivo_env()
    if not clave and os.path.exists(ruta):
        try:
            with open(ruta, encoding="utf-8-sig") as fh:
                for linea in fh:
                    linea = linea.strip()
                    if linea and not linea.startswith("#") and "=" in linea:
                        k, v = linea.split("=", 1)
                        if k.strip().replace("export ", "") == VARIABLE_CLAVE:
                            clave = v.strip().strip('"').strip("'")
                            break
        except OSError as e:
            return None, "no se pudo leer %s: %s" % (ruta, e)
    if not clave:
        return None, "falta %s en %s (o la variable de entorno)" % (VARIABLE_CLAVE, ruta)
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


def url_valida(url):
    return (parse.urlparse(url).hostname or "").lower() in HOSTS_PERMITIDOS


class Supa:
    """PostgREST + Storage con la clave privada. Solo habla con Supabase o localhost (pruebas)."""

    def __init__(self, base, clave):
        self.base, self.clave = base.rstrip("/"), clave

    def _cab(self, extra=None):
        cab = {"apikey": self.clave}
        if self.clave.startswith("eyJ"):
            cab["Authorization"] = "Bearer " + self.clave
        if extra:
            cab.update(extra)
        return cab

    def _pedir(self, metodo, url, datos=None, cab=None):
        req = request.Request(url, data=datos, headers=cab or {}, method=metodo)
        try:
            with request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read()
        except error.HTTPError as e:
            return e.code, e.read()
        except (error.URLError, OSError) as e:
            return 0, str(e).encode("utf-8", "replace")

    def get(self, ruta):
        """Todas las filas (pagina de a 1000: PostgREST corta sin avisar)."""
        filas, desde = [], 0
        while True:
            sep = "&" if "?" in ruta else "?"
            st, cuerpo = self._pedir("GET", "%s/rest/v1/%s%slimit=1000&offset=%d" % (self.base, ruta, sep, desde),
                                     cab=self._cab())
            if st != 200:
                raise ErrorServidor("Supabase contesto %s al leer %s: %s" % (
                    st or "sin respuesta", ruta.split("?")[0], cuerpo.decode("utf-8", "replace")[:200]))
            lote = json.loads(cuerpo.decode("utf-8") or "[]")
            filas += lote
            if len(lote) < 1000:
                return filas
            desde += 1000

    def post(self, tabla, filas, on_conflict=None, devolver=False):
        q = "?on_conflict=%s" % on_conflict if on_conflict else ""
        prefer = ["resolution=ignore-duplicates"] if on_conflict else []
        prefer.append("return=representation" if devolver else "return=minimal")
        st, cuerpo = self._pedir("POST", "%s/rest/v1/%s%s" % (self.base, tabla, q),
                                 json.dumps(filas).encode("utf-8"),
                                 self._cab({"Content-Type": "application/json", "Prefer": ",".join(prefer)}))
        if st not in (200, 201, 204):
            raise ErrorServidor("Supabase contesto %s al escribir %s: %s" % (
                st or "sin respuesta (NO SE SABE si entro)", tabla, cuerpo.decode("utf-8", "replace")[:300]))
        return json.loads(cuerpo.decode("utf-8") or "[]") if devolver and cuerpo else []

    def subir_foto(self, ruta_storage, datos, tipo):
        st, cuerpo = self._pedir("POST", "%s/storage/v1/object/%s/%s" % (self.base, BUCKET_FOTOS, ruta_storage),
                                 datos, self._cab({"Content-Type": tipo, "x-upsert": "true"}))
        if st not in (200, 201):
            raise ErrorServidor("Storage contesto %s: %s" % (st or "sin respuesta", cuerpo.decode("utf-8", "replace")[:200]))


# ---------------------------------------------------------------- normalizar
def norm(t):
    t = unicodedata.normalize("NFD", str(t if t is not None else ""))
    return " ".join("".join(c for c in t if unicodedata.category(c) != "Mn").lower().split())


def norm_numero(n):
    """'e-Factura A 106208', 'A-106208' y 'a106208' son la misma factura."""
    t = re.sub(r"[^0-9a-z]", "", norm(n))
    t = re.sub(r"^(efactura|factura|eticket|ticket|nro|numero|n)+", "", t)
    return t


def digitos(n):
    grupos = re.findall(r"\d+", str(n or ""))
    return max(grupos, key=len).lstrip("0") if grupos else ""


def numero(v, que, positivo=True):
    if isinstance(v, bool) or v is None or v == "":
        raise Rechazo("falta %s" % que)
    try:
        if isinstance(v, str):
            t = v.strip().replace(" ", "")
            t = t.replace(".", "").replace(",", ".") if ("," in t and "." in t) else t.replace(",", ".")
            v = float(t)
        v = float(v)
    except (TypeError, ValueError):
        raise Rechazo("%s no es un numero: %r" % (que, v))
    if v != v or (positivo and v <= 0) or v < 0:
        raise Rechazo("%s tiene que ser mayor que 0 (vino %s)" % (que, v))
    return v


def fecha_iso(t, hoy):
    t = str(t or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            f = datetime.datetime.strptime(t[:10] if fmt == "%Y-%m-%d" else t, fmt).date()
            break
        except ValueError:
            f = None
    if f is None:
        raise Rechazo("no entiendo la fecha '%s' (AAAA-MM-DD o DD/MM/AAAA)" % t)
    if f > hoy:
        raise Rechazo("la fecha %s es futura" % f.isoformat())
    return f


def ml(v):
    return ("%.1f" % v).rstrip("0").rstrip(".")


# ---------------------------------------------------------------- leer y validar el JSON
def leer_factura(texto, hoy):
    try:
        d = json.loads(texto)
    except ValueError as e:
        raise Rechazo("el JSON no se entiende (%s)" % e)
    if not isinstance(d, dict):
        raise Rechazo("el JSON tiene que ser un objeto {...}")

    est_txt = norm(d.get("establecimiento"))
    if est_txt.replace("_", " ") in SIN_INSUMOS or est_txt in SIN_INSUMOS:
        raise Rechazo("Pone Chico no lleva stock de Insumos: la factura va a La Vuelta o a María Laura")
    est = ESTABLECIMIENTOS.get(est_txt) or ESTABLECIMIENTOS.get(est_txt.replace("_", " "))
    if not est:
        raise Rechazo("falta a qué campo va la factura (\"establecimiento\": la_vuelta o maria_laura). "
                      "Preguntarle a Pedro; no se adivina")

    tipo = norm(d.get("tipo") or "factura")
    if tipo not in TIPOS:
        raise Rechazo("tipo '%s': solo se cargan compras (factura u otro ticket de compra). Una lista de precios "
                      "o un presupuesto no entra al stock" % tipo)
    moneda = str(d.get("moneda") or "").strip().upper()
    if moneda not in MONEDAS:
        raise Rechazo("moneda '%s' (USD, BRL o UYU)" % (d.get("moneda") or ""))
    nro = str(d.get("numero") or "").strip()
    if not norm_numero(nro):
        raise Rechazo("falta el número de la factura (sin número no se puede evitar cargarla dos veces)")
    f = fecha_iso(d.get("fecha"), hoy)
    proveedor = str(d.get("proveedor") or "").strip()
    if not proveedor:
        raise Rechazo("falta el proveedor")
    total = numero(d.get("total"), "total")
    subtotal = numero(d.get("subtotal"), "subtotal") if d.get("subtotal") not in (None, "") else None
    cot = numero(d.get("cotizacion_usd"), "cotizacion_usd") if d.get("cotizacion_usd") not in (None, "") else None
    if cot is not None and moneda == "USD":
        cot = None
    if cot is not None and not (0.0001 < cot < 10):
        raise Rechazo("cotizacion_usd = USD que vale 1 %s (p. ej. 0,18 para el real); vino %s" % (moneda, cot))

    lineas = d.get("lineas")
    if not isinstance(lineas, list) or not lineas:
        raise Rechazo("la factura no trae líneas")
    salida = []
    for i, l in enumerate(lineas, 1):
        if not isinstance(l, dict):
            raise Rechazo("línea %d: no es un objeto" % i)
        que = "línea %d (%s)" % (i, l.get("texto") or l.get("codigo") or "?")
        no_stock = l.get("no_stock") is True or norm(l.get("no_stock")) in ("true", "si", "1")
        salida.append({
            "n": i,
            "no_stock": no_stock,
            "codigo": str(l.get("codigo") or "").strip() or None,
            "texto": " ".join(str(l.get("texto") or "").split()) or None,
            "cantidad": numero(l.get("cantidad"), "%s: cantidad" % que),
            "precio_unitario": numero(l.get("precio_unitario"), "%s: precio_unitario (una línea bonificada "
                                      "en 0 no se carga por acá: va como ajuste)" % que, positivo=not no_stock),
            "producto": str(l.get("producto") or "").strip() or None,
            "contenido_ml": numero(l.get("contenido_ml"), "%s: contenido_ml" % que)
            if l.get("contenido_ml") not in (None, "") else None,
            "dosis_por_envase": numero(l.get("dosis_por_envase"), "%s: dosis_por_envase" % que)
            if l.get("dosis_por_envase") not in (None, "") else None,
        })
        if not salida[-1]["codigo"] and not salida[-1]["texto"]:
            raise Rechazo("%s: sin código ni texto no se puede emparejar" % que)
    if all(l["no_stock"] for l in salida):
        raise Rechazo("todas las líneas están marcadas \"no_stock\": no hay productos veterinarios para cargar al "
                      "stock (la factura igual va a la contabilidad)")

    suma = round(sum(l["cantidad"] * l["precio_unitario"] for l in salida), 2)
    contra, cual = (subtotal, "subtotal") if subtotal is not None else (total, "total")
    if abs(suma - contra) > max(0.05, contra * 0.005):
        raise Rechazo("las líneas suman %.2f y el %s de la factura es %.2f: releer la foto (si el total incluye "
                      "IVA, mandar también \"subtotal\" sin IVA)" % (suma, cual, contra))
    return {"proveedor": proveedor, "tipo": tipo, "numero": nro, "fecha": f, "moneda": moneda, "total": total,
            "condicion": (str(d.get("condicion") or "").strip().lower() or None), "establecimiento": est,
            "cotizacion_usd": cot, "lineas": salida, "suma": suma}


# ---------------------------------------------------------------- armar lo que se cargaria
def nombre_insumo(t, alias_ins, catalogo_lower):
    """Igual que insumo_nombre() de la base: alias de insumos -> catalogo sin mayusculas -> el texto."""
    k = (t or "").strip().lower()
    return alias_ins.get(k) or catalogo_lower.get(k) or (t or "").strip()


def preparar(fac, supa):
    """Lee lo necesario de Supabase y arma el plan. Lanza Rechazo si algo no cierra."""
    avisos = []
    provs = supa.get("proveedores?select=id,nombre,moneda,iva_incluido&order=id")
    prov = next((p for p in provs if norm(p["nombre"]) == norm(fac["proveedor"])), None)
    if not prov:
        parecidos = difflib.get_close_matches(norm(fac["proveedor"]), [norm(p["nombre"]) for p in provs], n=3, cutoff=0.5)
        raise Rechazo("el proveedor '%s' no está dado de alta (hay: %s)%s. Uno nuevo se agrega en proveedores con "
                      "el OK de Pedro" % (fac["proveedor"], ", ".join(p["nombre"] for p in provs) or "ninguno",
                                          (" — ¿quisiste decir %s?" % " / ".join(parecidos)) if parecidos else ""))
    if prov["moneda"] != fac["moneda"]:
        avisos.append("%s factura en %s y esta vino en %s: confirmar la moneda" % (prov["nombre"], prov["moneda"], fac["moneda"]))

    catalogo = supa.get("productos_catalogo?select=producto,valor_dosis_ml&order=producto")
    cat_exacto = {c["producto"]: c for c in catalogo}
    cat_norm = {}
    for c in catalogo:
        cat_norm.setdefault(norm(c["producto"]), c["producto"])
    cat_lower = {c["producto"].strip().lower(): c["producto"] for c in catalogo}
    alias_ins = {a["texto"]: a["producto"] for a in supa.get("insumos_alias?select=texto,producto")}
    alias = supa.get("alias_productos?select=id,codigo_proveedor,texto_proveedor,producto,contenido_envase,"
                     "dosis_por_envase&proveedor_id=eq.%d&order=id" % prov["id"])
    por_codigo = {norm(a["codigo_proveedor"]): a for a in alias if a.get("codigo_proveedor")}
    por_texto = {norm(a["texto_proveedor"]): a for a in alias}

    errores, items, alias_nuevos, fuera = [], {}, [], []
    for l in fac["lineas"]:
        que = "línea %d (%s)" % (l["n"], l["texto"] or l["codigo"])
        if l["no_stock"]:             # no es un producto veterinario (caravana, balde...): solo cuenta para el total
            fuera.append(l)
            continue
        a = (por_codigo.get(norm(l["codigo"])) if l["codigo"] else None) or \
            (por_texto.get(norm(l["texto"])) if l["texto"] else None)
        if a:
            producto, contenido, dosis = a["producto"], float(a["contenido_envase"]), a.get("dosis_por_envase")
            if l["producto"] and norm(l["producto"]) != norm(producto):
                avisos.append("%s: el alias guardado dice '%s' (no '%s'); se usa el alias" % (que, producto, l["producto"]))
            if l["contenido_ml"] and abs(l["contenido_ml"] - contenido) > 0.01:
                avisos.append("%s: el alias guardado dice %s ml por envase (no %s); se usa el alias" % (
                    que, ml(contenido), ml(l["contenido_ml"])))
            nuevo = False
        else:
            if not l["producto"]:
                parecidos = difflib.get_close_matches(norm(l["texto"] or ""), list(cat_norm), n=4, cutoff=0.4)
                errores.append("%s: producto nuevo para %s. Pedro tiene que confirmar a qué producto del catálogo "
                               "corresponde (\"producto\") y cuántos ml trae el envase (\"contenido_ml\")%s" % (
                                   que, prov["nombre"], (". Parecidos: " + " / ".join(cat_norm[p] for p in parecidos))
                                   if parecidos else ""))
                continue
            producto = cat_exacto.get(l["producto"]) and l["producto"] or cat_norm.get(norm(l["producto"]))
            if not producto:
                parecidos = difflib.get_close_matches(norm(l["producto"]), list(cat_norm), n=4, cutoff=0.4)
                errores.append("%s: '%s' no está en productos_catalogo (no se crean productos desde acá)%s" % (
                    que, l["producto"], (". Parecidos: " + " / ".join(cat_norm[p] for p in parecidos)) if parecidos else ""))
                continue
            if not l["contenido_ml"]:
                errores.append("%s: falta \"contenido_ml\" (ml por envase: 5 L = 5000)" % que)
                continue
            if not l["texto"]:
                errores.append("%s: un producto nuevo necesita \"texto\" (la descripción tal cual la factura)" % que)
                continue
            contenido, dosis, nuevo = l["contenido_ml"], l["dosis_por_envase"], True
            alias_nuevos.append({"proveedor_id": prov["id"], "codigo_proveedor": l["codigo"],
                                 "texto_proveedor": l["texto"], "producto": producto,
                                 "contenido_envase": contenido, "dosis_por_envase": dosis})
            por_texto[norm(l["texto"])] = alias_nuevos[-1]
            if l["codigo"]:
                por_codigo[norm(l["codigo"])] = alias_nuevos[-1]
        clave = (producto, round(contenido, 3))
        if clave in items:            # mismo producto y envase dos veces: precios_vet guarda uno solo -> se suman
            it = items[clave]
            gasto = it["cantidad"] * it["precio_unitario"] + l["cantidad"] * l["precio_unitario"]
            it["cantidad"] += l["cantidad"]
            it["precio_unitario"] = round(gasto / it["cantidad"], 4)
            it["lineas"].append(l["n"])
            avisos.append("%s: '%s' ya venía en otra línea; se suman (precio promedio)" % (que, producto))
        else:
            items[clave] = {"producto": producto, "contenido": contenido, "dosis": dosis, "cantidad": l["cantidad"],
                            "precio_unitario": l["precio_unitario"], "alias_nuevo": nuevo, "lineas": [l["n"]]}
    if errores:
        raise Rechazo("hay líneas que no se pueden cargar:\n  - " + "\n  - ".join(errores))

    # cotizacion
    tc, cot_nueva = 1.0, None
    if fac["moneda"] != "USD":
        f = fac["fecha"].isoformat()
        cots = supa.get("cotizaciones?select=fecha,usd_por_unidad&moneda=eq.%s&fecha=lte.%s&order=fecha.desc"
                        % (fac["moneda"], f))
        exacta = next((c for c in cots if c["fecha"] == f), None)
        if fac["cotizacion_usd"] is not None:
            tc = fac["cotizacion_usd"]
            if not exacta:
                cot_nueva = {"fecha": f, "moneda": fac["moneda"], "usd_por_unidad": tc, "fuente": "factura (Hermes)"}
            elif abs(float(exacta["usd_por_unidad"]) - tc) > 1e-6:
                avisos.append("ya hay cotización %s del %s (%s); se deja esa" % (fac["moneda"], f, exacta["usd_por_unidad"]))
                tc = float(exacta["usd_por_unidad"])
        elif cots:
            tc = float(cots[0]["usd_por_unidad"])
            if cots[0]["fecha"] != f:
                avisos.append("se usa la cotización %s del %s (no hay del día de la factura)" % (fac["moneda"], cots[0]["fecha"]))
        else:
            tc = None
            avisos.append("sin cotización %s: el STOCK se carga igual, pero el precio por ml del catálogo queda como "
                          "estaba hasta cargar el tipo de cambio" % fac["moneda"])

    # factura ya cargada?
    comps = supa.get("comprobantes?select=id,tipo,numero,fecha,total,establecimiento&proveedor_id=eq.%d&order=id" % prov["id"])
    existente = None
    for c in comps:
        if c["tipo"] != fac["tipo"]:
            continue
        mismo = norm_numero(c["numero"]) == norm_numero(fac["numero"]) or (
            digitos(c["numero"]) and digitos(c["numero"]) == digitos(fac["numero"]) and c["fecha"] == fac["fecha"].isoformat())
        if mismo:
            existente = c
            break
    if existente and existente.get("establecimiento") != fac["establecimiento"]:
        raise Rechazo("esa factura (%s, id %s) ya está cargada para %s, no para %s. Si estaba mal el campo, se "
                      "corrige a mano con Pedro" % (existente["numero"], existente["id"],
                                                    existente.get("establecimiento"), fac["establecimiento"]))
    if not existente:
        for c in comps:
            if c["fecha"] == fac["fecha"].isoformat() and c.get("total") is not None and \
                    abs(float(c["total"]) - fac["total"]) < 0.01:
                avisos.append("OJO: ya hay otra factura de %s del mismo día y el mismo total (n° %s). ¿No es la misma "
                              "leída distinta?" % (prov["nombre"], c["numero"]))
    ya_lineas = set()
    if existente:
        for p in supa.get("precios_vet?select=producto,contenido_envase&comprobante_id=eq.%d" % existente["id"]):
            ya_lineas.add((p["producto"], round(float(p["contenido_envase"]), 3)))

    # conteo inicial y stock actual del campo
    est = fac["establecimiento"]
    iniciales = {}
    for a in supa.get("insumos_ajustes?select=producto,fecha&tipo=eq.inicial&establecimiento=eq.%s" % est):
        nom = nombre_insumo(a["producto"], alias_ins, cat_lower)
        if nom not in iniciales or a["fecha"] > iniciales[nom]:
            iniciales[nom] = a["fecha"]
    stock = {r["producto"]: r for r in supa.get("stock_insumos?select=producto,stock_ml,fecha_conteo,estado"
                                                 "&establecimiento=eq.%s" % est)}
    for (producto, _), it in items.items():
        nom = nombre_insumo(producto, alias_ins, cat_lower)
        it["nombre_stock"] = nom
        it["ml"] = it["cantidad"] * it["contenido"]
        it["ya_estaba"] = (producto, round(it["contenido"], 3)) in ya_lineas
        conteo = iniciales.get(nom)
        it["conteo"] = conteo
        it["stock_antes"] = float(stock[nom]["stock_ml"]) if nom in stock and stock[nom]["stock_ml"] is not None else None
        if conteo and conteo >= fac["fecha"].isoformat():
            it["suma"] = False
            avisos.append("%s: el conteo del galpón es del %s (igual o posterior a la factura): esta compra NO suma al "
                          "stock (se supone que ya estaba contada). El precio sí se actualiza" % (producto, conteo))
        else:
            it["suma"] = True
        it["usd_ml_nuevo"] = round(it["precio_unitario"] * tc / it["contenido"], 4) if tc else None
        actual = cat_exacto.get(producto, {}).get("valor_dosis_ml")
        it["usd_ml_actual"] = float(actual) if actual is not None else None

    sin_conteo = sorted({it["nombre_stock"] for it in items.values() if not it["conteo"]})
    return {"prov": prov, "items": list(items.values()), "fuera": fuera, "alias_nuevos": alias_nuevos, "cot_nueva": cot_nueva,
            "tc": tc, "existente": existente, "sin_conteo": sin_conteo, "avisos": avisos}


def uid_conteo(est, producto, prov_id, nro):
    return str(uuid.uuid5(NAMESPACE_UID, "inicial-por-factura|%s|%s|%s|%s" % (est, producto, prov_id, norm_numero(nro))))


def mostrar(fac, plan):
    est = {"la_vuelta": "La Vuelta", "maria_laura": "María Laura"}[fac["establecimiento"]]
    print("Factura %s n° %s del %s — %s %.2f — para %s" % (
        plan["prov"]["nombre"], fac["numero"], fac["fecha"].strftime("%d/%m/%Y"), fac["moneda"], fac["total"], est))
    if plan["existente"]:
        print("(esta factura YA ESTÁ cargada: id %s; solo se completa lo que falte)" % plan["existente"]["id"])
    print("")
    for it in plan["items"]:
        precio = ""
        if it["usd_ml_nuevo"] is not None:
            precio = "  USD/ml %s" % it["usd_ml_nuevo"]
            if it["usd_ml_actual"]:
                precio += " (antes %s, %+.1f%%)" % (it["usd_ml_actual"], (it["usd_ml_nuevo"] / it["usd_ml_actual"] - 1) * 100)
        if it["ya_estaba"]:
            efecto = "ya estaba cargado" + ("; sin conteo: se crea el conteo en 0" if not it["conteo"] else "")
        elif not it["suma"]:
            efecto = "NO suma (conteo del %s)" % it["conteo"]
        elif not it["conteo"]:
            efecto = "sin conteo: arranca en 0 → %s ml (menos lo aplicado desde el %s)" % (
                ml(it["ml"]), fac["fecha"].strftime("%d/%m"))
        else:
            antes = it["stock_antes"]
            efecto = ("stock %s → %s ml" % (ml(antes), ml(antes + it["ml"]))) if antes is not None else "suma %s ml" % ml(it["ml"])
        print("  %-28s %s × %s ml = %s ml   %s%s%s" % (
            it["producto"], ml(it["cantidad"]), ml(it["contenido"]), ml(it["ml"]), efecto, precio,
            "   [producto nuevo para este proveedor]" if it["alias_nuevo"] else ""))
    for l in plan.get("fuera", []):
        print("  %-28s %s × %s %s   no va al stock (no es un producto veterinario)" % (
            (l["texto"] or l["codigo"])[:28], ml(l["cantidad"]), ("%.2f" % l["precio_unitario"]), fac["moneda"]))
    for av in plan["avisos"]:
        print("AVISO: %s" % av)


def aplicar(fac, plan, supa, foto=None):
    prov, est = plan["prov"], fac["establecimiento"]
    if plan["alias_nuevos"]:
        supa.post("alias_productos", plan["alias_nuevos"], on_conflict="proveedor_id,texto_proveedor")
    if plan["cot_nueva"]:
        supa.post("cotizaciones", [plan["cot_nueva"]], on_conflict="fecha,moneda")

    comp = plan["existente"]
    if not comp:
        foto_path = None
        if foto:
            ext = os.path.splitext(foto)[1].lower() or ".jpg"
            tipo = {".png": "image/png", ".pdf": "application/pdf", ".webp": "image/webp"}.get(ext, "image/jpeg")
            foto_path = "%s/%s_%s%s" % (re.sub(r"[^a-z0-9]+", "-", norm(prov["nombre"])).strip("-"),
                                        fac["fecha"].isoformat(), norm_numero(fac["numero"]) or "sin-numero", ext)
            try:
                with open(foto, "rb") as fh:
                    supa.subir_foto(foto_path, fh.read(), tipo)
            except (OSError, ErrorServidor) as e:
                print("AVISO: no se pudo subir la foto (%s); la factura se carga igual, sin foto." % e)
                foto_path = None
        fila = {"proveedor_id": prov["id"], "tipo": fac["tipo"], "numero": fac["numero"],
                "fecha": fac["fecha"].isoformat(), "moneda": fac["moneda"], "total": fac["total"],
                "condicion": fac["condicion"], "establecimiento": est, "foto_path": foto_path}
        try:
            supa.post("comprobantes", [fila], on_conflict="proveedor_id,tipo,numero")
        except ErrorServidor as e:
            if "42P10" not in str(e):       # sin el indice unico (SQL sin correr): insert comun, ya se miro que no estaba
                raise
            supa.post("comprobantes", [fila])
        vuelta = supa.get("comprobantes?select=id,numero,establecimiento&proveedor_id=eq.%d&tipo=eq.%s&numero=eq.%s"
                          % (prov["id"], fac["tipo"], parse.quote(fac["numero"], safe="")))
        if not vuelta:
            raise ErrorServidor("la factura no aparece en comprobantes después de guardarla (¿permisos?). No se "
                                "cargaron las líneas")
        comp = vuelta[0]

    lineas = [{"comprobante_id": comp["id"], "proveedor_id": prov["id"], "producto": it["producto"],
               "fecha": fac["fecha"].isoformat(), "cantidad": it["cantidad"], "contenido_envase": it["contenido"],
               "dosis_por_envase": it["dosis"], "precio_unitario": it["precio_unitario"], "moneda": fac["moneda"],
               "iva_incluido": bool(prov["iva_incluido"])} for it in plan["items"] if not it["ya_estaba"]]
    if lineas:
        supa.post("precios_vet", lineas, on_conflict="comprobante_id,producto,contenido_envase")

    conteos = []
    dia_antes = (fac["fecha"] - datetime.timedelta(days=1)).isoformat()
    for nom in plan["sin_conteo"]:
        conteos.append({"establecimiento": est, "producto": nom, "fecha": dia_antes, "tipo": "inicial",
                        "cantidad_ml": 0, "uid": uid_conteo(est, nom, prov["id"], fac["numero"]),
                        "nota": "conteo 0 por factura %s %s" % (prov["nombre"], fac["numero"]),
                        "dispositivo": "hermes-script", "autor": "Hermes"})
    if conteos:
        supa.post("insumos_ajustes", conteos, on_conflict="uid")

    # verificar: solo se da por hecho lo que volvio
    guardadas = {(p["producto"], round(float(p["contenido_envase"]), 3))
                 for p in supa.get("precios_vet?select=producto,contenido_envase&comprobante_id=eq.%d" % comp["id"])}
    faltan = [it["producto"] for it in plan["items"] if (it["producto"], round(it["contenido"], 3)) not in guardadas]
    if faltan:
        raise ErrorServidor("Supabase contestó OK pero no aparecen: %s. Correr el MISMO JSON otra vez" % ", ".join(faltan))
    if conteos:
        uids = ",".join(c["uid"] for c in conteos)
        volvieron = supa.get("insumos_ajustes?select=uid&uid=in.(%s)" % uids)
        if len(volvieron) != len(conteos):
            raise ErrorServidor("los conteos en 0 no aparecen todos en insumos_ajustes. Correr el MISMO JSON otra vez")

    nombres = {it["nombre_stock"] for it in plan["items"]}
    stock = [r for r in supa.get("stock_insumos?select=producto,stock_ml,entradas_ml,salidas_ml,estado"
                                 "&establecimiento=eq.%s" % est) if r["producto"] in nombres]
    print("\nOK: factura %s n° %s cargada para %s (comprobante %s, %d producto(s)%s%s)." % (
        prov["nombre"], fac["numero"], est, comp["id"], len(lineas),
        ", %d alias nuevo(s)" % len(plan["alias_nuevos"]) if plan["alias_nuevos"] else "",
        ", %d conteo(s) en 0" % len(conteos) if conteos else ""))
    if not lineas:
        print("No había líneas nuevas: la factura ya estaba completa (no se duplicó nada).")
    print("Stock en Insumos ahora:")
    for r in sorted(stock, key=lambda r: r["producto"]):
        print("  %-28s %s ml (entradas %s, salidas %s) %s" % (r["producto"], ml(float(r["stock_ml"])),
              ml(float(r["entradas_ml"])), ml(float(r["salidas_ml"])), r["estado"]))
    falta_stock = nombres - {r["producto"] for r in stock}
    for n in sorted(falta_stock):
        print("  %-28s (no aparece en stock_insumos: revisar el nombre / insumos_alias)" % n)
    if plan["tc"] is None:
        print("PENDIENTE: cargar la cotización %s del %s para que se actualice el precio por ml." % (
            fac["moneda"], fac["fecha"].isoformat()))
    return 0


def pedir_confirmacion():
    try:
        return input("Escribí SI para cargarla en la base REAL: ").strip() == "SI"
    except EOFError:
        return False


def main(argv=None, hoy=None, entrada=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description="Carga una factura de veterinaria como entrada de Insumos (simula por defecto).")
    ap.add_argument("--json", required=True, help="archivo JSON con la factura, o - para leerlo de la entrada")
    ap.add_argument("--foto", help="foto/PDF de la factura (opcional): se guarda en el bucket privado fotos-precios")
    ap.add_argument("--aplicar", action="store_true", help="ESCRIBE en la base real. Sin esto solo simula")
    ap.add_argument("--si", action="store_true", help="no pide el SI por teclado (solo después del OK de Pedro)")
    ap.add_argument("--url", default=SUPA_URL, help=argparse.SUPPRESS)       # solo para las pruebas (localhost)
    a = ap.parse_args(argv)
    hoy = hoy or datetime.date.today()

    if not url_valida(a.url):
        print("ERROR: esa dirección no es de Supabase (ni localhost): no se manda la clave.")
        return 1
    try:
        if a.json == "-":
            texto = (entrada or sys.stdin).read()
        else:
            with open(a.json, encoding="utf-8-sig") as fh:
                texto = fh.read()
        fac = leer_factura(texto, hoy)
    except OSError as e:
        print("ERROR leyendo %s: %s" % (a.json, e))
        return 1
    except Rechazo as e:
        print("NO SE CARGA: %s." % e)
        return 1
    if a.foto and not os.path.isfile(a.foto):
        print("NO SE CARGA: no encuentro la foto %s." % a.foto)
        return 1

    clave, problema = clave_privada()
    if not clave:
        print("ERROR: %s (no se mandó nada)." % problema)
        return 1
    supa = Supa(a.url, clave)
    try:
        plan = preparar(fac, supa)
    except Rechazo as e:
        print("NO SE CARGA: %s." % e)
        return 1
    except ErrorServidor as e:
        print("ERROR: %s. No se escribió nada." % e)
        return 2

    mostrar(fac, plan)
    pendiente = plan["alias_nuevos"] or plan["cot_nueva"] or not plan["existente"] or plan["sin_conteo"] or \
        any(not it["ya_estaba"] for it in plan["items"])
    if not pendiente:
        print("\nEsta factura ya estaba cargada completa: no se duplicó nada.")
        return 0
    if not a.aplicar:
        print("\nNada se escribió (simulación). Para cargarla: el mismo comando con --aplicar (pide el SI).")
        return 0
    if not a.si and not pedir_confirmacion():
        print("No se cargó: no se escribió SI.")
        return 1
    try:
        return aplicar(fac, plan, supa, a.foto)
    except ErrorServidor as e:
        print("ERROR: %s." % e)
        print("Puede haber quedado a medias: correr el MISMO comando otra vez completa lo que falte sin duplicar.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
