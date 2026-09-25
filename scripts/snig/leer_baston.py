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
from datetime import date, datetime

CARPETA_DEFECTO = os.path.join(
    os.environ.get('OneDrive', os.path.expanduser('~')),
    'A Registros PEDRO LANFRANCO CRESPO', 'Lector XRS2', '2025-2026 Ejercicio Actual')

# ------------------------------------------------------------------- alias
# Se mapea SIEMPRE por nombre de columna, nunca por posicion: en el export
# real POTRERO cae en el medio de PRODUCTO2 y "DOSIS 2", asi que el orden no
# sigue ninguna logica que convenga dar por sentada.
ALIAS = {
    # 'ide'/'idv' son como los escribe el export viejo de Tru-Test; 'eid'/'vid'
    # como los escribe la app de Datamars. Son la misma cosa.
    'eid':        ['eid', 'ide', 'electronic id', 'rfid', 'nro electronico'],
    'vid':        ['vid', 'idv', 'visual id', 'visual'],
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
    'VAQUILLONA 1-2': 'Vaquillonas 1-2 años',
    'VAQUILLONA 2-3': 'Vaquillonas 2-3 años',
    'NOVILLITO': 'Novillitos 1-2 años',
    'NOVILLO 2-3': 'Novillos 2-3 años',
    'VACA': 'Vacas',
    # Vaca ultima cria: se va despues de destetar este ternero. Para la app
    # sigue siendo una vaca -- "Vacas de invernada" es la que ya se saco de
    # entore y se esta engordando, que no es lo mismo.
    'VCUT': 'Vacas',
    'TORO': 'Toros',
    'BUEY': 'Bueyes',
}
# Abreviaturas que no alcanzan solas: dicen la familia pero no el tramo de
# edad. Se resuelven con GEN (el año de nacimiento) mas la fecha de la
# sesion. Cada lista va del mas joven al mas viejo, con el tope de edad en
# años que le corresponde a cada tramo; el ultimo se lleva todo el resto.
FAMILIA = {
    'VAQ':        [(12, 'Terneras'), (24, 'Vaquillonas 1-2 años'), (None, 'Vaquillonas 2-3 años')],
    'VAQUILLONA': [(12, 'Terneras'), (24, 'Vaquillonas 1-2 años'), (None, 'Vaquillonas 2-3 años')],
    'NOV':        [(12, 'Terneros'), (24, 'Novillitos 1-2 años'),
                   (36, 'Novillos 2-3 años'), (None, 'Novillos +3 años')],
    'NOVILLO':    [(12, 'Terneros'), (24, 'Novillitos 1-2 años'),
                   (36, 'Novillos 2-3 años'), (None, 'Novillos +3 años')],
}

# Mes en que se asume que pario la generacion. Restar años calendario
# envejece a los animales hasta 12 meses de mas: una vaquillona de la
# generacion 2024 leida en mayo de 2026 tiene 19 meses, no 2 años, y con la
# resta simple caia en "2-3 años" en vez de "1-2". Parir en octubre es el
# promedio de la zona; si tu pariciones se corren, este numero se cambia una
# sola vez aca.
MES_PARICION = 10

def anio_nacimiento(gen, fecha):
    """GEN es el ultimo digito del año de nacimiento: 5 = 2025, 0 = 2020.

    Se resuelve contra la fecha de la sesion, tomando el año mas reciente
    que termine en ese digito y no sea posterior a la sesion. La decada
    queda implicita: un GEN 9 leido en 2026 se toma como 2019, no 2009. Un
    animal de mas de 10 años se clasifica mal por diseño de la codificacion,
    no por este calculo -- para eso esta la edad exacta del SNIG.
    """
    d = re.sub(r'\D', '', str(gen or ''))
    if len(d) != 1 or not fecha:
        return None
    a = fecha.year
    while a % 10 != int(d):
        a -= 1
    return a

def categoria_app(cat, gen, fecha):
    """Devuelve (categoria_de_la_app, motivo_si_no_se_pudo)."""
    clave = (cat or '').strip().upper()
    if not clave:
        return None, 'sin categoria'
    if clave in CATEGORIA_BASTON:
        return CATEGORIA_BASTON[clave], None
    tramos = FAMILIA.get(clave)
    if not tramos:
        return None, 'sin traducir'
    anio = anio_nacimiento(gen, fecha)
    if anio is None:
        return None, 'falta GEN o fecha'
    meses = edad_meses(anio, fecha)
    for tope, destino in tramos:
        if tope is None or meses < tope:
            return destino, None
    return None, 'edad fuera de rango'

def edad_meses(anio_nac, fecha):
    """Meses entre la paricion asumida de esa generacion y la fecha leida."""
    nacio = date(anio_nac, MES_PARICION, 1)
    return (fecha.year - nacio.year) * 12 + (fecha.month - nacio.month)

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

# Los CSV que baja el programa de Tru-Test en la PC no traen encabezado. Este
# es el orden deducido de las sesiones de mayo de 2026. Como el archivo no
# tiene forma de avisar que sus columnas estan en otro orden, cada archivo se
# verifica fila por fila con validar_layout() antes de leerlo: uno que no
# encaje se reporta, no se lee a la fuerza.
LAYOUT_PC = ['eid', 'vid', 'fecha', 'hora', 'propietario', 'categoria', 'gen',
             'potrero', 'producto1', 'producto2', 'dosis1', 'dosis2', 'origen', 'nota']

def validar_layout(filas, layout):
    """Motivos por los que este archivo NO encaja en el layout. Vacio = encaja.

    Las verificaciones son las que el encabezado haria gratis: si una dosis
    trae texto o un producto trae un numero, las columnas estan corridas.
    """
    idx = {c: i for i, c in enumerate(layout)}
    problemas = Counter()
    for fila in filas:
        def v(c):
            i = idx.get(c)
            return fila[i].strip() if i is not None and i < len(fila) else ''
        if len(re.sub(r'\D', '', v('eid'))) < 12:
            problemas['el EID no parece un EID'] += 1
        if not a_fecha(v('fecha')):
            problemas['la fecha no parece una fecha'] += 1
        for c in ('producto1', 'producto2'):
            t = v(c)
            if t and re.fullmatch(r'[\d.,]+', t):
                problemas['%s trae un numero' % c] += 1
        for c in ('dosis1', 'dosis2'):
            t = v(c)
            if t and a_numero(t) is None:
                problemas['%s trae texto' % c] += 1
    return problemas

def parece_dato(encabezados):
    """True si la primera fila del archivo es un animal, no un encabezado.

    Varios exports de la carpeta no traen fila de encabezado: arrancan
    directo con el EID. Sin esto, el lector toma el primer animal como
    nombres de columna, se pierde ese animal y despues no encuentra ninguna
    columna -- que es exactamente lo que paso el 25/9/2026, y el mensaje
    "sin columna eid" no daba ninguna pista de la causa.
    """
    if not encabezados:
        return False
    primera = re.sub(r'\D', '', str(encabezados[0] or ''))
    return len(primera) >= 12          # un EID; ningun encabezado es un numero largo

def titulo(t):
    print('\n' + t); print('-' * len(t))

def volcado_crudo(archivos):
    """Imprime las dos primeras lineas de cada archivo, tal cual vienen.

    Para los archivos sin encabezado es la unica forma de deducir el orden
    de las columnas: hay que mirarlas al lado del nombre de la sesion.
    """
    for ruta in archivos:
        print('\n=== %s' % os.path.basename(ruta))
        try:
            with open(ruta, 'rb') as f:
                crudo = f.read(4000)
            for cod in ('utf-8-sig', 'cp1252', 'latin-1'):
                try:
                    texto = crudo.decode(cod); break
                except UnicodeDecodeError:
                    continue
            for linea in texto.splitlines()[:2]:
                print('   %s' % linea)
        except Exception as e:
            print('   no se pudo leer: %s' % e)

def main():
    args = [a for a in sys.argv[1:] if a != '--crudo']
    archivos = juntar_archivos(args)
    if not archivos:
        sys.exit('No hay ningun .csv para leer.')

    if '--crudo' in sys.argv[1:]:
        volcado_crudo(archivos)
        return

    print('Archivos: %d' % len(archivos))

    # ---- 1. encabezados: iguales o distintos entre sesiones
    por_encabezado = defaultdict(list)
    lecturas = []
    ilegibles = []
    sin_encabezado = []
    for ruta in archivos:
        try:
            enc, filas = leer_csv(ruta)
        except Exception as e:
            ilegibles.append((os.path.basename(ruta), str(e))); continue
        if not enc:
            ilegibles.append((os.path.basename(ruta), 'vacio')); continue
        if parece_dato(enc):
            # No hay encabezado: la primera fila ya es un animal.
            filas = [enc] + filas
            problemas = validar_layout(filas, LAYOUT_PC)
            sin_encabezado.append((os.path.basename(ruta), len(enc), len(filas), problemas))
            if problemas:
                continue          # las columnas no estan donde dice LAYOUT_PC
            mapa = {c: i for i, c in enumerate(LAYOUT_PC) if i < len(enc)}
        else:
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
    if sin_encabezado:
        encajan = [x for x in sin_encabezado if not x[3]]
        no_encajan = [x for x in sin_encabezado if x[3]]
        print('\n   %d archivos SIN encabezado (los que baja el programa de la PC).' % len(sin_encabezado))
        print('   Se leen con el orden fijo LAYOUT_PC, verificando cada fila:\n')
        print('      %-34s %8s %6s  %s' % ('archivo', 'columnas', 'filas', 'estado'))
        for n, cols, fil, prob in sin_encabezado:
            print('      %-34s %8d %6d  %s' % (n, cols, fil, 'ok' if not prob else 'NO ENCAJA'))
        print('\n   Encajan %d, no encajan %d.' % (len(encajan), len(no_encajan)))
        for n, cols, fil, prob in no_encajan:
            print('\n      %s -- por que no encaja:' % n)
            for motivo, veces in prob.most_common():
                print('         %-34s %d filas' % (motivo, veces))
            print('         Mirá las columnas con:  leer_baston.py --crudo')
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
        # propietario/categoria/origen se cuentan en mayuscula: el mismo valor
        # viene escrito de las dos formas segun la sesion, y la traduccion no
        # distingue mayusculas. El potrero se cuenta tal cual, porque en Maria
        # Laura son nombres y ahi las mayusculas son parte del nombre.
        aplastar = campo in ('propietario', 'categoria', 'origen')
        c = Counter((l[campo].strip().upper() if aplastar else l[campo])
                    for l in lecturas if l[campo])
        vacios = sum(1 for l in lecturas if not l[campo])
        print('\n   %s  (%s)' % (campo.upper(), nota))
        if not c:
            print('      siempre vacio')
            continue
        for k, v in c.most_common(20):
            extra = ''
            if campo == 'categoria':
                clave = k.strip().upper()
                if clave in CATEGORIA_BASTON:
                    extra = '  ->  %s' % CATEGORIA_BASTON[clave]
                elif clave in FAMILIA:
                    extra = '  ->  segun GEN (ver abajo)'
                else:
                    extra = '  ->  SIN TRADUCIR'
            print('      %-22s %6d%s' % (k, v, extra))
        if len(c) > 20:
            print('      ... y %d valores mas' % (len(c) - 20))
        if vacios:
            print('      (vacio)                %6d' % vacios)
    todas_cat = {l['categoria'].strip().upper() for l in lecturas if l['categoria']}
    faltan_cat = sorted(c for c in todas_cat
                        if c not in CATEGORIA_BASTON and c not in FAMILIA)
    if faltan_cat:
        print('\n   Categorias sin traducir: %s' % ', '.join(faltan_cat))
        print('   Agregalas a CATEGORIA_BASTON o a FAMILIA arriba en este mismo archivo.')

    titulo('3b. Como queda cada categoria + GEN')
    print('   GEN es el ultimo digito del año de nacimiento (5 = 2025). La edad se')
    print('   cuenta desde una paricion asumida en el mes %d de ese año.' % MES_PARICION)
    print('   Si tus pariciones se corren, se cambia MES_PARICION y listo.\n')
    resueltas = Counter()
    fallidas = Counter()
    for l in lecturas:
        destino, motivo = categoria_app(l['categoria'], l['gen'], l['fecha'])
        clave = (l['categoria'] or '(vacio)').strip().upper()
        if destino:
            anio = anio_nacimiento(l['gen'], l['fecha'])
            meses = edad_meses(anio, l['fecha']) if anio and l['fecha'] else None
            resueltas[(clave, l['gen'] or '-', anio or '-', meses if meses is not None else '-', destino)] += 1
        else:
            fallidas[(clave, l['gen'] or '-', motivo)] += 1
    print('      %-10s %-5s %-7s %-7s %-24s %s' % ('baston', 'GEN', 'nacio', 'meses', 'categoria de la app', 'animales'))
    for (clave, gen, anio, meses, destino), n in sorted(resueltas.items(), key=lambda kv: -kv[1]):
        print('      %-10s %-5s %-7s %-7s %-24s %6d' % (clave, gen, anio, meses, destino, n))
    if fallidas:
        print('\n      Sin resolver:')
        for (clave, gen, motivo), n in sorted(fallidas.items(), key=lambda kv: -kv[1]):
            print('      %-10s %-5s %-32s %6d' % (clave, gen, motivo, n))

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
                        categoria_app(l['categoria'], l['gen'], l['fecha'])[0] or '',
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
