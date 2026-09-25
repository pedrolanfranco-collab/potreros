# -*- coding: utf-8 -*-
"""
leer_baston.py -- Lee los CSV de sesion del baston XRS2 (los que exporta la
app de Datamars desde el movil) y arma el estado por animal.

Es el companero de leer_snig.py. El SNIG dice que animales existen a nombre
de quien; el baston dice cuales pasaron de verdad por la manga, cuanto pesan
y que se les puso. Este script lee TODAS las sesiones de la carpeta, no una,
y se queda con la lectura mas reciente de cada caravana.

Que contesta:
  1. Si todas las sesiones traen el mismo encabezado o cambia entre archivos.
  2. Que valores aparecen en PROPIETARIO, CATEGORIA, POTRERO, ORIGEN, GEN y
     RODEO. Esas listas son las tablas de traduccion que hay que completar
     para que lo del baston entre en la app con los nombres de la app.
  3. Cuantas lecturas traen peso y cuantas traen producto (o sea, cuales
     sesiones fueron de pesada y cuales de sanidad).
  4. El estado por animal, que es lo que despues se publica a
     'animales_caravana'. Lo deja escrito en padron_baston.csv.

Uso:
    python leer_baston.py                      (busca la carpeta del lector)
    python leer_baston.py ruta\\a\\la\\carpeta
    python leer_baston.py archivo1.csv archivo2.csv

Sin dependencias: solo la libreria estandar de Python.
"""
import csv
import io
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

CARPETA_DEFECTO = os.path.join(
    os.environ.get('OneDrive', os.path.expanduser('~')),
    'A Registros PEDRO LANFRANCO CRESPO', 'Lector XRS2', '2025-2026 Ejercicio Actual')

# ------------------------------------------------------------------- alias
# Se mapea SIEMPRE por nombre de columna, nunca por posicion: en el export
# real POTRERO cae en el medio de PRODUCTO2 y "DOSIS 2", asi que el orden no
# sigue ninguna logica que convenga dar por sentada.
ALIAS = {
    'eid':        ['eid', 'electronic id', 'rfid'],
    'vid':        ['vid', 'visual id', 'visual'],
    'fecha':      ['date', 'fecha'],
    'hora':       ['time', 'hora'],
    'propietario':['propietario', 'owner', 'duenio', 'dueno'],
    'gen':        ['gen', 'generacion'],
    'categoria':  ['categoria', 'category'],
    'rodeo':      ['rodeo', 'mob', 'lote'],
    'producto1':  ['producto', 'producto1', 'product'],
    'dosis1':     ['dosis', 'dosis1', 'dose'],
    'producto2':  ['producto2', 'product2'],
    'dosis2':     ['dosis 2', 'dosis2', 'dose 2'],
    'potrero':    ['potrero', 'paddock'],
    'origen':     ['origen', 'origin'],
    'nota':       ['nota', 'notas', 'note', 'comment'],
    'peso':       ['peso', 'weight', 'wt'],
}
OBLIGATORIAS = ['eid', 'fecha']

# Traduccion de lo que escribe el baston a lo que usa la app. Lo que no este
# aca se reporta como desconocido; no se inventa nada.
CATEGORIA_BASTON = {
    'TERNERA': 'Terneras',
    'TERNERO': 'Terneros',
    'VAQUILLONA': 'Vaquillonas 1-2 años',
    'VAQUILLONA 1-2': 'Vaquillonas 1-2 años',
    'VAQUILLONA 2-3': 'Vaquillonas 2-3 años',
    'NOVILLITO': 'Novillitos 1-2 años',
    'NOVILLO 2-3': 'Novillos 2-3 años',
    'NOVILLO': 'Novillos +3 años',
    'VACA': 'Vacas',
    'TORO': 'Toros',
    'BUEY': 'Bueyes',
}

def normalizar(txt):
    t = str(txt or '').strip().lower()
    for a, b in (('á','a'), ('é','e'), ('í','i'), ('ó','o'), ('ú','u'), ('ñ','n')):
        t = t.replace(a, b)
    return re.sub(r'[\s_]+', ' ', t).strip()

def mapear_columnas(encabezados):
    norm = [normalizar(h) for h in encabezados]
    sin_esp = [h.replace(' ', '') for h in norm]
    mapa = {}
    for campo, nombres in ALIAS.items():
        for n in nombres:
            nn = normalizar(n)
            if nn in norm:
                mapa[campo] = norm.index(nn); break
            if nn.replace(' ', '') in sin_esp:
                mapa[campo] = sin_esp.index(nn.replace(' ', '')); break
    return mapa

def id8_de_eid(eid):
    """Ultimos 8 digitos, rellenados a 8. Identica a normalizarCaravana() de
    la app: si estas dos funciones se separan, el cruce deja de existir."""
    d = re.sub(r'\D', '', str(eid or ''))
    return d[-8:].zfill(8) if d else None

def a_numero(txt):
    """Acepta 125, 125.5 y 125,5. El peso viene sin decimales en los
    ejemplos vistos, pero no cuesta nada aguantar las tres formas."""
    t = str(txt or '').strip().replace(',', '.')
    if not t:
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    return int(v) if v.is_integer() else v

def a_fecha(txt):
    t = str(txt or '').strip()
    if not t:
        return None
    for fmt in ('%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d', '%m/%d/%Y'):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    return None

def leer_csv(ruta):
    """Devuelve (encabezados, filas). Prueba varias codificaciones porque el
    export sale del celular y no siempre es UTF-8."""
    with open(ruta, 'rb') as f:
        crudo = f.read()
    for cod in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1'):
        try:
            texto = crudo.decode(cod); break
        except UnicodeDecodeError:
            continue
    else:
        texto = crudo.decode('latin-1', 'replace')
    muestra = texto[:4000]
    delim = ';' if muestra.count(';') > muestra.count(',') else ','
    filas = [f for f in csv.reader(io.StringIO(texto), delimiter=delim) if any(c.strip() for c in f)]
    if not filas:
        return [], []
    return filas[0], filas[1:]

def juntar_archivos(args):
    if not args:
        if not os.path.isdir(CARPETA_DEFECTO):
            sys.exit('No encontre la carpeta del lector:\n    %s\n'
                     'Pasame la carpeta o los archivos:\n'
                     '    python leer_baston.py ruta\\a\\la\\carpeta' % CARPETA_DEFECTO)
        args = [CARPETA_DEFECTO]
    archivos = []
    for a in args:
        if os.path.isdir(a):
            archivos += [os.path.join(a, f) for f in sorted(os.listdir(a)) if f.lower().endswith('.csv')]
        elif os.path.isfile(a):
            archivos.append(a)
        else:
            sys.exit('No existe: %s' % a)
    # tenedores_detectados.csv y padron_baston.csv son salidas nuestras, no
    # sesiones del baston: si quedaron en la carpeta, no las leemos.
    return [a for a in archivos
            if os.path.basename(a).lower() not in ('padron_baston.csv', 'tenedores_detectados.csv')]

def titulo(t):
    print('\n' + t); print('-' * len(t))

def main():
    archivos = juntar_archivos(sys.argv[1:])
    if not archivos:
        sys.exit('No hay ningun .csv para leer.')

    print('Archivos: %d' % len(archivos))

    # ---- 1. encabezados: iguales o distintos entre sesiones
    por_encabezado = defaultdict(list)
    lecturas = []
    ilegibles = []
    for ruta in archivos:
        try:
            enc, filas = leer_csv(ruta)
        except Exception as e:
            ilegibles.append((os.path.basename(ruta), str(e))); continue
        if not enc:
            ilegibles.append((os.path.basename(ruta), 'vacio')); continue
        por_encabezado[tuple(normalizar(h) for h in enc)].append(os.path.basename(ruta))
        mapa = mapear_columnas(enc)
        faltan = [c for c in OBLIGATORIAS if c not in mapa]
        if faltan:
            ilegibles.append((os.path.basename(ruta), 'sin columna ' + ', '.join(faltan))); continue
        def val(fila, campo):
            i = mapa.get(campo)
            return fila[i].strip() if i is not None and i < len(fila) else ''
        for fila in filas:
            eid = val(fila, 'eid')
            id8 = id8_de_eid(eid)
            if not id8:
                continue
            lecturas.append({
                'archivo': os.path.basename(ruta), 'id8': id8, 'ide': re.sub(r'\D', '', eid),
                'vid': val(fila, 'vid'), 'fecha': a_fecha(val(fila, 'fecha')),
                'hora': val(fila, 'hora'), 'propietario': val(fila, 'propietario'),
                'gen': val(fila, 'gen'), 'categoria': val(fila, 'categoria'),
                'rodeo': val(fila, 'rodeo'), 'potrero': val(fila, 'potrero'),
                'origen': val(fila, 'origen'), 'nota': val(fila, 'nota'),
                'producto1': val(fila, 'producto1'), 'dosis1': a_numero(val(fila, 'dosis1')),
                'producto2': val(fila, 'producto2'), 'dosis2': a_numero(val(fila, 'dosis2')),
                'peso': a_numero(val(fila, 'peso')),
            })

    titulo('1. Encabezados')
    if len(por_encabezado) == 1:
        print('   Todas las sesiones traen el MISMO encabezado. El lector puede ser fijo.')
        print('   Columnas: %s' % ', '.join(list(por_encabezado)[0]))
    else:
        print('   Hay %d encabezados distintos. El lector tiene que mapear por nombre' % len(por_encabezado))
        print('   en cada archivo (que es lo que hace), nunca por posicion.\n')
        for i, (enc, arch) in enumerate(sorted(por_encabezado.items(), key=lambda kv: -len(kv[1])), 1):
            print('   Variante %d  (%d archivos)' % (i, len(arch)))
            print('      columnas: %s' % ', '.join(enc))
            print('      ejemplo : %s' % arch[0])
            if len(arch) > 1:
                print('      y %d mas' % (len(arch) - 1))
    if ilegibles:
        print('\n   No pude leer %d archivos:' % len(ilegibles))
        for n, m in ilegibles:
            print('      %-34s %s' % (n, m))

    if not lecturas:
        sys.exit('\nNo saque ninguna lectura. Revisá los archivos.')

    titulo('2. Lecturas')
    print('   Total de lecturas  : %d' % len(lecturas))
    print('   Animales distintos : %d' % len({l['id8'] for l in lecturas}))
    con_peso = [l for l in lecturas if l['peso']]
    con_prod = [l for l in lecturas if l['producto1']]
    con_vid  = [l for l in lecturas if re.sub(r'\D', '', l['vid'] or '')]
    print('   Con peso           : %d' % len(con_peso))
    print('   Con producto       : %d' % len(con_prod))
    print('   Con VID cargado    : %d' % len(con_vid))
    if not con_vid:
        print('\n   El VID viene vacio en todas. O sea que el baston NO confirma el numero')
        print('   visual: el unico puente con el SNIG son los ultimos 8 del EID. Si el')
        print('   "Dispositivo" del SNIG no coincide con eso, no hay como cruzarlos, y eso')
        print('   es justo lo que mide cruzar.py.')
    fechas = sorted({l['fecha'] for l in lecturas if l['fecha']})
    if fechas:
        print('   Fechas             : %s a %s' % (fechas[0].strftime('%d/%m/%Y'), fechas[-1].strftime('%d/%m/%Y')))

    # ---- 3. valores distintos = tablas de traduccion a completar
    titulo('3. Valores que usa el baston (las tablas de traduccion)')
    for campo, nota in (('propietario', 'hay que mapearlo a la firma de la app'),
                        ('categoria',   'hay que mapearlo a las categorias de la app'),
                        ('potrero',     'tiene que coincidir con el nombre del potrero en la app'),
                        ('origen',      'informativo'),
                        ('gen',         'informativo'),
                        ('rodeo',       'informativo, la app no tiene este campo')):
        c = Counter(l[campo] for l in lecturas if l[campo])
        vacios = sum(1 for l in lecturas if not l[campo])
        print('\n   %s  (%s)' % (campo.upper(), nota))
        if not c:
            print('      siempre vacio')
            continue
        for k, v in c.most_common(20):
            extra = ''
            if campo == 'categoria':
                destino = CATEGORIA_BASTON.get(k.strip().upper())
                extra = '  ->  %s' % destino if destino else '  ->  SIN TRADUCIR'
            print('      %-22s %6d%s' % (k, v, extra))
        if len(c) > 20:
            print('      ... y %d valores mas' % (len(c) - 20))
        if vacios:
            print('      (vacio)                %6d' % vacios)
    faltan_cat = sorted({l['categoria'].strip().upper() for l in lecturas
                         if l['categoria'] and l['categoria'].strip().upper() not in CATEGORIA_BASTON})
    if faltan_cat:
        print('\n   Categorias sin traducir: %s' % ', '.join(faltan_cat))
        print('   Agregalas a CATEGORIA_BASTON arriba en este mismo archivo.')

    if con_prod:
        titulo('4. Productos cargados en la manga')
        c = Counter()
        for l in con_prod:
            c[l['producto1']] += 1
            if l['producto2']:
                c[l['producto2']] += 1
        for k, v in c.most_common():
            print('      %-26s %6d' % (k, v))
        print('\n   Estos son tratamientos por animal, con caravana. O sea que el baston')
        print('   puede alimentar sanidad_carga directamente, con cantidad 1 y la caravana')
        print('   puesta, en vez de que alguien los tipee desde el celular.')

    # ---- 5. estado por animal: la ultima lectura de cada uno
    titulo('5. Estado por animal (lo que se publicaria a animales_caravana)')
    def cuando(l):
        return (l['fecha'] or datetime(1900, 1, 1).date(), l['hora'] or '')
    por_animal = {}
    for l in sorted(lecturas, key=cuando):
        por_animal[l['id8']] = l          # la ultima gana
    peso_ultimo = {}
    for l in sorted([x for x in lecturas if x['peso']], key=cuando):
        peso_ultimo[l['id8']] = l         # ultimo peso, que puede ser de otra sesion
    print('   Animales en el padron del baston: %d' % len(por_animal))
    print('   Con algun peso registrado       : %d' % len(peso_ultimo))

    salida = os.path.join(os.path.dirname(os.path.abspath(archivos[0])), 'padron_baston.csv')
    with open(salida, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['id8', 'ide', 'propietario', 'gen', 'categoria_baston', 'categoria_app',
                    'potrero', 'rodeo', 'origen', 'ultima_lectura', 'ultimo_peso', 'peso_fecha',
                    'ultimo_producto', 'ultima_dosis', 'archivo'])
        for id8 in sorted(por_animal):
            l = por_animal[id8]
            p = peso_ultimo.get(id8)
            w.writerow([id8, l['ide'], l['propietario'], l['gen'], l['categoria'],
                        CATEGORIA_BASTON.get((l['categoria'] or '').strip().upper(), ''),
                        l['potrero'], l['rodeo'], l['origen'],
                        l['fecha'].isoformat() if l['fecha'] else '',
                        p['peso'] if p else '', p['fecha'].isoformat() if p and p['fecha'] else '',
                        l['producto1'], l['dosis1'], l['archivo']])
    titulo('Archivo escrito')
    print('   %s' % salida)
    print('\n   Ese es el padron visto por el baston. El paso que sigue es cruzarlo')
    print('   contra el del SNIG:  python cruzar.py <archivo_snig> <carpeta_baston>')

if __name__ == '__main__':
    main()
