# -*- coding: utf-8 -*-
"""Prueba de la unificacion de categorias en actualizar_sanidad_supabase.py (18/11/2026). Sin red ni Excel.

    python scripts/sanidad/probar_unificar_categorias.py

- categoria_patron: traduce con la tabla, sin importar mayusculas ni espacios; lo que no esta queda igual.
- unificar_proximos: "Vaca"/Garrapata vieja y "Vacas"/Garrapata nueva quedan en UNA fila, la mas nueva; respeta el
  orden; no junta filas sin categoria; "Consumo" queda como esta.
- unificar_ultimos: solo traduce, no junta.
- leer_equivalencias: arma el mapa en minusculas; si Supabase no contesta, devuelve {} y deja un AVISO en el log
  (se publica igual, sin traducir).
"""
import os
import sys
import tempfile
import types

sys.dont_write_bytecode = True
sys.modules.setdefault("openpyxl", types.ModuleType("openpyxl"))   # el script lo importa; aca no se usa
tmp = tempfile.mkdtemp()
os.environ["SANIDAD_LOG"] = os.path.join(tmp, "sanidad.log")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import actualizar_sanidad_supabase as S  # noqa: E402

fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  -> " + str(detalle)))
    if not cond:
        fallas.append(nombre)


MAPA = {"vaca": "Vacas", "v. inv.": "Vacas de invernada", "teros/as": "Terneros", "toritos": "Toros"}

print("categoria_patron")
chequear("Vaca -> Vacas", S.categoria_patron("Vaca", MAPA) == "Vacas")
chequear("'  V. INV. ' -> Vacas de invernada", S.categoria_patron("  V. INV. ", MAPA) == "Vacas de invernada")
chequear("Consumo queda igual", S.categoria_patron("Consumo", MAPA) == "Consumo")
chequear("None queda None", S.categoria_patron(None, MAPA) is None)
chequear("sin tabla ({}) no cambia nada", S.categoria_patron("Vaca", {}) == "Vaca")


def prox(cat, san, ultimo, prevista, animales=1):
    return {"establecimiento": "la_vuelta", "categoria": cat, "sanidad": san, "animales": animales,
            "ultimo_tratamiento": ultimo, "fecha_prevista": prevista, "estado": "x"}


print("unificar_proximos")
filas = [
    prox("Vaca", "Garrapata", "2026-05-22", "2026-06-26", 223),     # vieja: el vencido que no se cerraba
    prox("Toros", "Garrapata", "2026-04-28", "2026-05-19", 17),
    prox("Vacas", "Garrapata", "2026-10-01", "2026-11-05", 256),    # nueva, mismo destino
    prox("Teros/as", "Vacunas", "2026-04-03", "2026-09-30", 112),
    prox("Consumo", "Otros", "2026-01-01", "2026-02-01"),
    prox(None, "Garrapata", "2026-01-01", "2026-02-01"),
    prox(None, "Garrapata", "2026-03-01", "2026-04-01"),
    prox("Toritos", "Garrapata", "2026-01-07", "2026-01-28", 2),     # Toros/Garrapata: la de Toros es mas nueva
]
out = S.unificar_proximos(filas, MAPA)
vacas = [f for f in out if f["categoria"] == "Vacas" and f["sanidad"] == "Garrapata"]
chequear("Vaca + Vacas / Garrapata -> una sola fila", len(vacas) == 1, vacas)
chequear("queda la del tratamiento mas nuevo (01-10, 256 animales)",
         vacas and vacas[0]["ultimo_tratamiento"] == "2026-10-01" and vacas[0]["animales"] == 256, vacas)
toros = [f for f in out if f["categoria"] == "Toros"]
chequear("Toritos + Toros / Garrapata -> una, la de Toros (28-04)", len(toros) == 1 and toros[0]["ultimo_tratamiento"] == "2026-04-28", toros)
chequear("Teros/as -> Terneros", any(f["categoria"] == "Terneros" and f["sanidad"] == "Vacunas" for f in out))
chequear("Consumo queda como esta", any(f["categoria"] == "Consumo" for f in out))
chequear("las filas sin categoria no se juntan", len([f for f in out if f["categoria"] is None]) == 2)
chequear("6 filas de 8, en el orden de la Planilla",
         [f["categoria"] for f in out] == ["Vacas", "Toros", "Terneros", "Consumo", None, None], [f["categoria"] for f in out])
chequear("no modifica las filas de entrada", filas[0]["categoria"] == "Vaca")

print("unificar_ultimos")
ult = [{"categoria": "Vaca", "fecha": "2026-10-01"}, {"categoria": "Vacas", "fecha": "2026-10-02"}, {"categoria": None}]
u = S.unificar_ultimos(ult, MAPA)
chequear("traduce y no junta (3 filas)", [f["categoria"] for f in u] == ["Vacas", "Vacas", None], u)

print("leer_equivalencias")
S.rest = lambda *a, **k: (200, b'[{"alias": "vaca", "categoria": "Vacas"}, {"alias": " V. Inv. ", "categoria": "Vacas de invernada"}]')
m = S.leer_equivalencias()
chequear("arma el mapa en minusculas", m == {"vaca": "Vacas", "v. inv.": "Vacas de invernada"}, m)
S.rest = lambda *a, **k: (404, b'{"message": "relation does not exist"}')
chequear("tabla que no existe -> {}", S.leer_equivalencias() == {})


def _corta(*a, **k):
    raise RuntimeError("sin red")


S.rest = _corta
chequear("sin red -> {}", S.leer_equivalencias() == {})
with open(os.environ["SANIDAD_LOG"], encoding="utf-8") as fh:
    registro = fh.read()
chequear("deja AVISO en el log (sigue publicando sin unificar)", registro.count("AVISO") == 2, registro)
chequear("el log va a SANIDAD_LOG (no adentro del repo)", S.LOG == os.environ["SANIDAD_LOG"])

print("\nTodo OK" if not fallas else "\nFALLARON %d: %s" % (len(fallas), ", ".join(fallas)))
sys.exit(1 if fallas else 0)
