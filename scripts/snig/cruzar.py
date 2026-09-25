# -*- coding: utf-8 -*-
"""
cruzar.py -- Cruza el padron del SNIG contra las lecturas del baston.

Este es el paso 1 del documento docs/integracion-snig-xrs2-app.pdf, el que
hay que correr ANTES de escribir el publicador de animales_caravana, porque
de su resultado depende que la clave del padron pueda seguir siendo el id8.

La pregunta concreta que contesta:

    El SNIG publica "Dispositivo", 8 digitos y ningun numero electronico.
    El baston lee un EID de 15 y deja el VID (el visual) vacio. El unico
    puente posible son los ultimos 8 del EID. ¿Coinciden de verdad?

Si coinciden en todos, el cruce por id8 alcanza y la app no se toca. Si no
coinciden en unos pocos, son excepciones a anotar. Si no coinciden en
muchos, la clave del padron tiene que cambiar y hay que revisar la app.

Aparte del cruce, saca las listas que sirven para ir a buscar animales:
  - En el SNIG y nunca leido por el baston: vendido sin transferir, muerto
    sin declarar, perdido, o simplemente no paso por la manga.
  - Leido por el baston y no en el SNIG a mi nombre: transferencia que el
    vendedor no hizo, o ganado de un tercero.

Uso:
    python cruzar.py <archivo_snig> [carpeta_o_csv_del_baston ...]

Sin dependencias: solo la libreria estandar.
"""
import csv
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leer_snig
import leer_baston

def titulo(t):
    print('\n' + t); print('-' * len(t))

def escribir(ruta, encabezados, filas):
    with open(ruta, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(encabezados)
        w.writerows(filas)
    print('   %-42s %d filas' % (os.path.basename(ruta), len(filas)))

def main():
    if len(sys.argv) < 2:
        sys.exit('Uso:\n    python cruzar.py <archivo_snig> [carpeta_del_baston]')
    ruta_snig = sys.argv[1]
    if not os.path.isfile(ruta_snig):
        sys.exit('No existe el archivo del SNIG: %s' % ruta_snig)

    snig = leer_snig.cargar_animales(ruta_snig)
    print('SNIG   : %d animales vivos  (%s)' % (len(snig), os.path.basename(ruta_snig)))

    archivos = leer_baston.juntar_archivos(sys.argv[2:])
    lecturas = []
    for ruta in archivos:
        try:
            enc, filas = leer_baston.leer_csv(ruta)
        except Exception:
            continue
        if not enc:
            continue
        mapa = leer_baston.mapear_columnas(enc)
        if any(c not in mapa for c in leer_baston.OBLIGATORIAS):
            continue
        for fila in filas:
            def val(campo):
                i = mapa.get(campo)
                return fila[i].strip() if i is not None and i < len(fila) else ''
            id8 = leer_baston.id8_de_eid(val('eid'))
            if not id8:
                continue
            lecturas.append({
                'id8': id8, 'ide': val('eid'), 'fecha': leer_baston.a_fecha(val('fecha')),
                'hora': val('hora'), 'propietario': val('propietario'),
                'categoria': val('categoria'), 'potrero': val('potrero'),
                'peso': leer_baston.a_numero(val('peso')), 'archivo': os.path.basename(ruta),
            })
    print('Baston : %d lecturas en %d archivos' % (len(lecturas), len(archivos)))
    if not snig or not lecturas:
        sys.exit('Falta una de las dos puntas: no hay nada que cruzar.')

    por_id8_snig = {}
    for a in snig:
        por_id8_snig.setdefault(a['id8'], a)
    por_id8_bast = {}
    for l in sorted(lecturas, key=lambda x: (x['fecha'] or leer_baston.a_fecha('1/1/1900'), x['hora'] or '')):
        por_id8_bast[l['id8']] = l

    s = set(por_id8_snig)
    b = set(por_id8_bast)
    ambos, solo_s, solo_b = s & b, s - b, b - s

    # ------------------------------------------------------- LA respuesta
    titulo('LA PREGUNTA: ¿coincide el Dispositivo del SNIG con los ultimos 8 del EID?')
    print('   Animales en el SNIG          : %d' % len(s))
    print('   Animales leidos por el baston: %d' % len(b))
    print('   Cruzan por id8               : %d' % len(ambos))
    print('   Solo en el SNIG              : %d' % len(solo_s))
    print('   Solo en el baston            : %d' % len(solo_b))
    pct = 100.0 * len(ambos) / len(b) if b else 0
    print('\n   Cruza el %.1f%% de lo que leyo el baston.' % pct)
    if pct >= 95:
        print('   VEREDICTO: el cruce por id8 funciona. La app no se toca y el padron')
        print('   puede seguir con la clave (establecimiento, id8). Lo que no cruza son')
        print('   casos sueltos a mirar en las listas de abajo, no un problema de formato.')
    elif pct >= 50:
        print('   VEREDICTO: cruza la mayoria pero se pierde una parte grande. Antes de')
        print('   seguir hay que entender por que: mirá abajo si los que no cruzan tienen')
        print('   algo en comun (una compra entera, un rango de numeros, una fecha).')
    else:
        print('   VEREDICTO: NO cruza. El Dispositivo del SNIG no son los ultimos 8 del')
        print('   EID. Antes de escribir el publicador hay que encontrar cual es la')
        print('   relacion real entre los dos numeros; el diseño del padron cambia.')

    # Pista util cuando no cruza: ¿son del mismo largo? ¿comparten prefijo?
    if solo_b and solo_s:
        titulo('Pista: como se ven los numeros que no cruzan')
        print('   Del SNIG (Dispositivo, primeros 5):')
        for a in sorted(solo_s)[:5]:
            print('      %s   (crudo: %s)' % (a, por_id8_snig[a]['dispositivo_crudo']))
        print('   Del baston (EID -> id8, primeros 5):')
        for a in sorted(solo_b)[:5]:
            print('      %s   (EID: %s)' % (a, por_id8_bast[a]['ide']))

    # ------------------------------------------------------- C1
    titulo('C1. En el SNIG y nunca leido por el baston  (%d)' % len(solo_s))
    if solo_s:
        c = Counter(por_id8_snig[a]['categoria'] or '(sin categoria)' for a in solo_s)
        for k, v in c.most_common():
            print('      %-26s %6d' % (k, v))
        print('\n   Vendidos sin transferir, muertos sin declarar, perdidos, o que no')
        print('   pasaron por la manga en el periodo. La lista completa queda en el CSV.')

    titulo('C1. Leido por el baston y no en el SNIG a mi nombre  (%d)' % len(solo_b))
    if solo_b:
        c = Counter(por_id8_bast[a]['propietario'] or '(sin propietario)' for a in solo_b)
        for k, v in c.most_common():
            print('      %-26s %6d' % (k, v))
        print('\n   Transferencias que el vendedor no hizo, numeros mal leidos, o ganado')
        print('   de un tercero que todavia no esta en tenedores.csv.')

    # ------------------------------------------------------- discrepancias
    titulo('Discrepancias entre los que SI cruzan')
    difs = []
    for id8 in sorted(ambos):
        a, l = por_id8_snig[id8], por_id8_bast[id8]
        cat_b = leer_baston.CATEGORIA_BASTON.get((l['categoria'] or '').strip().upper())
        if cat_b and a['categoria'] and cat_b != a['categoria']:
            difs.append((id8, 'categoria', a['categoria'], l['categoria']))
    if difs:
        c = Counter((d[2], d[3]) for d in difs)
        print('   Categoria derivada del SNIG  vs  categoria del baston:')
        for (x, y), n in c.most_common():
            print('      %-26s %-20s %6d' % (x, y, n))
        print('\n   No todas son errores: la del SNIG sale de la edad y la del baston la')
        print('   puso una persona. Las de borde (el que justo cumple años) son normales.')
    else:
        print('   Ninguna diferencia de categoria entre los que cruzan.')

    # ------------------------------------------------------- archivos
    salida = os.path.dirname(os.path.abspath(ruta_snig))
    titulo('Archivos escritos en %s' % salida)
    escribir(os.path.join(salida, 'c1_solo_snig.csv'),
             ['id8', 'dispositivo_crudo', 'sexo', 'raza', 'edad_meses', 'categoria',
              'propietario', 'tenedor', 'fecha_ingreso', 'documento'],
             [[por_id8_snig[a][k] if k != 'fecha_ingreso'
               else (por_id8_snig[a][k].isoformat() if por_id8_snig[a][k] else '')
               for k in ('id8', 'dispositivo_crudo', 'sexo', 'raza', 'edad_meses', 'categoria',
                         'propietario', 'tenedor', 'fecha_ingreso', 'documento')]
              for a in sorted(solo_s)])
    escribir(os.path.join(salida, 'c1_solo_baston.csv'),
             ['id8', 'ide', 'propietario', 'categoria', 'potrero', 'peso', 'ultima_lectura', 'archivo'],
             [[por_id8_bast[a]['id8'], por_id8_bast[a]['ide'], por_id8_bast[a]['propietario'],
               por_id8_bast[a]['categoria'], por_id8_bast[a]['potrero'], por_id8_bast[a]['peso'],
               por_id8_bast[a]['fecha'].isoformat() if por_id8_bast[a]['fecha'] else '',
               por_id8_bast[a]['archivo']] for a in sorted(solo_b)])
    escribir(os.path.join(salida, 'cruzan.csv'),
             ['id8', 'snig_categoria', 'baston_categoria', 'snig_tenedor',
              'baston_propietario', 'baston_potrero', 'baston_peso', 'ultima_lectura'],
             [[id8, por_id8_snig[id8]['categoria'], por_id8_bast[id8]['categoria'],
               por_id8_snig[id8]['tenedor'], por_id8_bast[id8]['propietario'],
               por_id8_bast[id8]['potrero'], por_id8_bast[id8]['peso'],
               por_id8_bast[id8]['fecha'].isoformat() if por_id8_bast[id8]['fecha'] else '']
              for id8 in sorted(ambos)])

if __name__ == '__main__':
    main()
