# -*- coding: utf-8 -*-
"""
Migración de una sola corrida (18/9/2026): trae el historial completo de
"Planilla Sanitaria" (La Vuelta) a la tabla Supabase sanidad_carga, para que
quede como la base única y completa del establecimiento (hasta ahora
sanidad_carga solo tenia lo cargado desde la app de potreros; el resto del
historial -- lo cargado directo en el Excel o desde la vieja herramienta
AppSheet -- nunca habia llegado a Supabase).

No se toca el Excel para nada (solo lectura) ni se apaga el puente celular->
Excel (bajar_sanidad_de_potreros.py sigue corriendo igual, como respaldo,
decisión de Pedro del 18/9/2026).

Columna "ID celular" (V) mezcla DOS esquemas distintos, no uno solo:
  - "sc_<timestamp>_<hash>": viene de sanidad_carga (bajar_sanidad_de_potreros.py
    la escribio ahi al bajar la carga desde la app de potreros). Esa fila YA
    esta en sanidad_carga -- hay que saltearla, no volver a insertarla.
  - hex corto (8 caracteres, ej "4c01d5f9"): viene de la vieja herramienta
    AppSheet ("Cargar sanidad"), que nunca escribio en sanidad_carga. Esa fila
    es nueva para Supabase -- se migra con un id fresco.
Y la mayoria de las filas (las cargadas directo a mano en el Excel) no tienen
ID celular en absoluto -- tambien son nuevas.

Por eso el filtro correcto es "el ID celular es exactamente un id que ya
existe en sanidad_carga", no "el ID celular no esta vacio".

Uso:
  python migrar_historial_sanidad_supabase.py            (dry-run: solo
                                                            imprime lo que
                                                            haria)
  python migrar_historial_sanidad_supabase.py --aplicar  (inserta de verdad)
"""
import json
import os
import secrets
import sys
from datetime import datetime, date
from urllib import request, error

import openpyxl

CARPETA = r"C:\Users\Pedro\OneDrive\A Registros PEDRO LANFRANCO CRESPO\Sanidad"
XLSM_LA_VUELTA = os.path.join(CARPETA, "Planilla_Sanitaria_v22.xlsm")
HOJA = "Planilla Sanitaria"
SUPA_URL = "https://skkknfjpwcstefcroqjt.supabase.co"
SUPA_KEY = "sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK"
ESTABLECIMIENTO = "la_vuelta"


def rest(metodo, tabla, query="", body=None, extra_headers=None):
    url = f"{SUPA_URL}/rest/v1/{tabla}{query}"
    headers = {
        "apikey": SUPA_KEY,
        "Authorization": f"Bearer {SUPA_KEY}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = request.Request(url, data=data, headers=headers, method=metodo)
    try:
        with request.urlopen(req) as resp:
            return resp.status, resp.read()
    except error.HTTPError as e:
        return e.code, e.read()


def ids_existentes():
    status, cuerpo = rest("GET", "sanidad_carga",
                           f"?establecimiento=eq.{ESTABLECIMIENTO}&select=id")
    if status != 200:
        raise RuntimeError(f"no pude leer sanidad_carga: {status} {cuerpo}")
    return {r["id"] for r in json.loads(cuerpo)}


def a_fecha_iso(v):
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def generar_id(indice):
    # mismo formato "sc_<timestamp>_<hash>" que ya usa la app, para que no se
    # distinga a simple vista de una carga hecha desde el celular. El indice
    # se suma al timestamp base solo para que, aun corriendo el script dos
    # veces en el mismo milisegundo, dos filas nunca compartan id.
    base_ts = int(datetime.now().timestamp() * 1000)
    return f"sc_{base_ts + indice}_{secrets.token_hex(4)}"


def leer_historial(ruta):
    wb = openpyxl.load_workbook(ruta, data_only=True)
    ws = wb[HOJA]
    filas = []
    for r in range(8, ws.max_row + 1):
        fecha = ws.cell(row=r, column=1).value
        if fecha is None:
            continue
        filas.append({
            "fecha": a_fecha_iso(fecha),
            "categoria": (str(ws.cell(row=r, column=2).value).strip()
                          if ws.cell(row=r, column=2).value else None),
            "gen": (int(ws.cell(row=r, column=3).value)
                    if isinstance(ws.cell(row=r, column=3).value, (int, float)) else None),
            "cantidad": (int(ws.cell(row=r, column=4).value)
                         if isinstance(ws.cell(row=r, column=4).value, (int, float)) else None),
            "potrero": (str(ws.cell(row=r, column=5).value).strip()
                        if ws.cell(row=r, column=5).value is not None else None),
            "producto1": (str(ws.cell(row=r, column=6).value).strip()
                          if ws.cell(row=r, column=6).value else None),
            "dosis1": (float(ws.cell(row=r, column=7).value)
                       if isinstance(ws.cell(row=r, column=7).value, (int, float)) else None),
            "producto2": (str(ws.cell(row=r, column=8).value).strip()
                          if ws.cell(row=r, column=8).value else None),
            "dosis2": (float(ws.cell(row=r, column=9).value)
                       if isinstance(ws.cell(row=r, column=9).value, (int, float)) else None),
            "observaciones": (str(ws.cell(row=r, column=10).value).strip()
                               if ws.cell(row=r, column=10).value else None),
            "_fila_excel": r,
            "_id_celular": ws.cell(row=r, column=22).value,
        })
    return filas


def main():
    aplicar = "--aplicar" in sys.argv

    existentes = ids_existentes()
    print(f"sanidad_carga ({ESTABLECIMIENTO}) ya tiene {len(existentes)} fila(s).")

    filas = leer_historial(XLSM_LA_VUELTA)
    print(f"Planilla Sanitaria tiene {len(filas)} tratamientos con fecha.")

    # sanidad_carga tiene NOT NULL en fecha/categoria/potrero/cantidad/
    # producto1/dosis1 (confirmado contra el esquema real, no supuesto) --
    # son los mismos 6 campos que el formulario "+ Cargar tratamiento" ya
    # exige para dejar guardar. Una fila del Excel a la que le falte
    # cualquiera de estos NO se puede migrar tal cual sin inventar un valor.
    REQUERIDOS = ["fecha", "categoria", "potrero", "cantidad", "producto1", "dosis1"]

    a_insertar = []
    ya_estaban = 0
    incompletas = []
    for f in filas:
        idc = f["_id_celular"]
        if idc and idc in existentes:
            ya_estaban += 1
            continue
        faltantes = [c for c in REQUERIDOS if f[c] is None]
        if faltantes:
            incompletas.append((f["_fila_excel"], faltantes))
            continue
        registro = {
            "id": generar_id(len(a_insertar)),
            "establecimiento": ESTABLECIMIENTO,
            "fecha": f["fecha"],
            "categoria": f["categoria"],
            "dueno": None,
            "potrero": f["potrero"],
            "cantidad": f["cantidad"],
            "gen": f["gen"],
            "producto1": f["producto1"],
            "dosis1": f["dosis1"],
            "producto2": f["producto2"],
            "dosis2": f["dosis2"],
            "observaciones": f["observaciones"],
            # ya estaba en el Excel de origen -- no hace falta que
            # bajar_sanidad_de_potreros.py la vuelva a mandar para alla.
            "importado_en": datetime.now().isoformat(),
        }
        a_insertar.append(registro)

    print(f"Ya estaban en sanidad_carga (por ID celular = id de sanidad_carga): {ya_estaban}")
    print(f"Incompletas en el Excel (falta fecha/categoría/potrero/cantidad/producto1/dosis1) -- NO se migran, quedan solo en el Excel: {len(incompletas)}")
    print(f"Nuevas a insertar: {len(a_insertar)}")

    if incompletas:
        reporte = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migracion_filas_incompletas.txt")
        with open(reporte, "w", encoding="utf-8") as fh:
            fh.write("Filas de 'Planilla Sanitaria' que NO se migraron a sanidad_carga\n")
            fh.write("(les falta un campo obligatorio -- revisar si hace falta completarlas a mano)\n\n")
            for fila_excel, faltantes in incompletas:
                fh.write(f"Fila {fila_excel}: falta {', '.join(faltantes)}\n")
        print(f"Detalle de las {len(incompletas)} filas incompletas guardado en: {reporte}")

    if not aplicar:
        print("\n(dry-run -- no se insertó nada. Correr con --aplicar para insertar de verdad.)")
        print("\nPrimeras 3 filas de muestra:")
        for r in a_insertar[:3]:
            print("  ", r)
        return

    status, cuerpo = rest("POST", "sanidad_carga", "", body=a_insertar,
                           extra_headers={"Prefer": "return=minimal"})
    if status not in (200, 201):
        raise RuntimeError(f"Error insertando en sanidad_carga: {status} {cuerpo}")
    print(f"\nOK: {len(a_insertar)} filas insertadas en sanidad_carga.")


if __name__ == "__main__":
    main()
