# -*- coding: utf-8 -*-
"""Controla la guia del repo (CLAUDE.md, AGENTS.md y docs/guia/). Sin red.

    python scripts/guia/probar_guia.py

- CLAUDE.md y AGENTS.md tienen el mismo cuerpo (solo cambia el encabezado): si se cambia uno, se cambia el otro.
- CLAUDE.md no pasa de TOPE_BYTES: se carga entero en cada sesion, el detalle va en docs/guia/.
- Todo archivo de docs/guia/ figura en el indice de CLAUDE.md, y todo archivo del indice existe.
"""
import os
import re
import sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TOPE_BYTES = 16000
fallas = []


def chequear(nombre, cond, detalle=""):
    print(("  OK  " if cond else "  MAL ") + nombre + ("" if cond else "  -> " + str(detalle)))
    if not cond:
        fallas.append(nombre)


def leer(rel):
    with open(os.path.join(RAIZ, rel), encoding="utf-8") as fh:
        return fh.read()


claude = leer("CLAUDE.md")
agents = leer("AGENTS.md")
cuerpo = lambda s: s.split("\n", 3)[3] if s.count("\n") >= 3 else s
chequear("CLAUDE.md y AGENTS.md tienen el mismo cuerpo", cuerpo(claude) == cuerpo(agents))
tam = len(claude.encode("utf-8"))
chequear("CLAUDE.md pesa menos de %d bytes" % TOPE_BYTES, tam <= TOPE_BYTES,
         "%d bytes: pasar el detalle a docs/guia/" % tam)
archivos = sorted(f for f in os.listdir(os.path.join(RAIZ, "docs", "guia")) if f.endswith(".md"))
indice = set(re.findall(r"`(\d\d-[a-z0-9-]+\.md)`", claude))
chequear("hay archivos en docs/guia/", bool(archivos))
for f in archivos:
    chequear("%s figura en el indice de CLAUDE.md" % f, f in indice)
for f in sorted(indice):
    chequear("%s del indice existe" % f, f in archivos)

print()
if fallas:
    print("FALLARON %d: %s" % (len(fallas), ", ".join(fallas)))
    sys.exit(1)
print("Todo bien.")
