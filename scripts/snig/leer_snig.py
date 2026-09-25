# -*- coding: utf-8 -*-
"""
leer_snig.py -- Lee el export de animales del SNIG y cuenta lo que hay adentro.

Es el paso 1 del documento docs/integracion-snig-xrs2-app.pdf: antes de
escribir el publicador que llena 'animales_caravana', hay que saber que trae
de verdad el archivo. Este script no escribe nada en Supabase ni toca la app:
solo lee el .xls y escupe un informe por pantalla mas un CSV.

Que contesta:
  1. Cuantos animales hay, y cuantos quedan despues de filtrar los muertos.
  2. Si el numero de Dispositivo perdio ceros a la izquierda al abrirse como
     numero -- eso rompe el cruce con el baston y es invisible a simple vista.
  3. Que codigos aparecen en Propietario / Ubicacion / Tenedor, con cuantos
     animales cada uno. Esa lista es la que hay que completar a mano en
     tenedores.csv; el script la deja escrita en tenedores_detectados.csv.
  4. Cuantos animales tienen Propietario distinto de Tenedor (ganado de un
     tercero en el campo, o mio en campo ajeno).
  5. El stock por categoria, derivado de Sexo + Edad(meses) con los mismos
     cortes que usa la app, para poder compararlo con lo que dice la app.

Uso:
    python leer_snig.py                     (busca el mas nuevo en Descargas)
    python leer_snig.py ruta\\al\\archivo.xls

Sin dependencias, salvo para un .xls binario de verdad: ahi necesita xlrd
(pip install xlrd). Si no lo queres instalar, abri el archivo en Excel y
guardalo como "Texto (delimitado por tabulaciones)" -- este script lee ese
formato sin nada instalado.
"""
import csv
import io
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from html.parser import HTMLParser

# ---------------------------------------------------------------- categorias
# Mismas categorias y mismos cortes de edad que usa la app (ESPECIES.bovino en
# template/potreros.template.html). Si alguna vez cambian alla, cambian aca.
CORTES = [
    # (edad_meses_hasta, categoria_hembra, categoria_macho)
    (12,    'Terneras',                'Terneros'),
    (24,    'Vaquillonas 1-2 años',    'Novillitos 1-2 años'),
    (36,    'Vaquillonas 2-3 años',    'Novillos 2-3 años'),
    (10**6, 'Vacas',                   'Novillos +3 años'),
]

def categoria_por_edad(sexo, meses):
    """El SNIG no trae categoria: la deriva de sexo + edad.

    OJO con lo que esto NO puede saber: si un macho es toro, buey o novillo
    (el SNIG no dice si esta castrado), ni si una hembra es de invernada.
    Todos los machos de mas de 3 años caen en 'Novillos +3 años'. Los toros
    hay que corregirlos a mano o sacarlos de la comparacion.
    """
    if meses is None:
        return None
    s = (sexo or '').strip().lower()
    if s.startswith('h'):
        i = 1
    elif s.startswith('m'):
        i = 2
    else:
        return None
    for tope, hembra, macho in CORTES:
        if meses < tope:
            return hembra if i == 1 else macho
    return None

# ------------------------------------------------------------------- alias
# El SNIG cambia encabezados entre versiones. Cada campo acepta varios
# nombres; si falta uno obligatorio, el script corta con un mensaje claro en
# vez de seguir con una columna en blanco.
ALIAS = {
    'dispositivo':  ['dispositivo', 'nro dispositivo', 'numero de dispositivo',
                     'caravana', 'nro caravana', 'diio', 'visual'],
    'ide':          ['ide', 'die', 'electronico', 'nro electronico',
                     'identificacion electronica', 'eid'],
    'raza':         ['raza'],
    'cruza':        ['cruza'],
    'sexo':         ['sexo'],
    'edad_meses':   ['edadmeses', 'edad meses', 'edad(meses)', 'edad en meses'],
    'edad_dias':    ['edaddias', 'edad dias', 'edad (dias)', 'edad en dias'],
    'propietario':  ['propietario', 'duenio', 'dueno'],
    'ubicacion':    ['ubicacion'],
    'tenedor':      ['tenedor'],
    'status_vida':  ['status de vida', 'estado de vida', 'status vida'],
    'status_traza': ['status de trazabilidad', 'status trazabilidad'],
    'errores':      ['errores', 'error'],
    'fecha_ingreso':['fecha ingreso a ubicacion actual', 'fecha de ingreso'],
    'documento':    ['documento de ingreso a ubicacion actual', 'documento de ingreso'],
    'fecha_ident':  ['fecha identificacion', 'fecha de identificacion'],
    'fecha_reg':    ['fecha registro', 'fecha de registro'],
}
OBLIGATORIAS = ['dispositivo', 'sexo', 'tenedor']

def normalizar(txt):
    """Baja a minuscula, saca acentos y aplasta espacios, para comparar
    encabezados sin depender de como vino escrito."""
    t = str(txt or '').strip().lower()
    for a, b in (('á','a'), ('é','e'), ('í','i'), ('ó','o'), ('ú','u'), ('ñ','n')):
        t = t.replace(a, b)
    t = re.sub(r'[\s_]+', ' ', t)
    return t.strip()

def mapear_columnas(encabezados):
    """encabezados -> {campo: indice}. Tolera 'Edad(meses)' y 'Edad (meses)'."""
    norm = [normalizar(h) for h in encabezados]
    sin_espacios = [h.replace(' ', '') for h in norm]
    mapa = {}
    for campo, nombres in ALIAS.items():
        for n in nombres:
            nn = normalizar(n)
            if nn in norm:
                mapa[campo] = norm.index(nn); break
            if nn.replace(' ', '') in sin_espacios:
                mapa[campo] = sin_espacios.index(nn.replace(' ', '')); break
    return mapa

# ------------------------------------------------------------------ lectura
class TablaHTML(HTMLParser):
    """Algunos exports se llaman .xls pero adentro son una tabla HTML."""
    def __init__(self):
        super().__init__()
        self.filas = []; self._fila = None; self._celda = None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self._fila = []
        elif tag in ('td', 'th') and self._fila is not None: self._celda = []
    def handle_data(self, data):
        if self._celda is not None: self._celda.append(data)
    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self._celda is not None:
            self._fila.append(''.join(self._celda).strip()); self._celda = None
        elif tag == 'tr' and self._fila is not None:
            if any(c for c in self._fila): self.filas.append(self._fila)
            self._fila = None

def decodificar(crudo):
    for cod in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1'):
        try:
            return crudo.decode(cod), cod
        except UnicodeDecodeError:
            continue
    return crudo.decode('latin-1', 'replace'), 'latin-1 (con reemplazos)'

def leer_tabla(ruta):
    """Devuelve (filas, descripcion_del_formato). filas[0] son los encabezados.

    No confia en la extension: mira los primeros bytes. Un archivo que se
    llama .xls puede ser OLE2 de verdad, un .xlsx, una tabla HTML o texto
    con tabulaciones, y el SNIG ha mandado mas de una de esas formas.
    """
    with open(ruta, 'rb') as f:
        crudo = f.read()

    if crudo[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
        try:
            import xlrd
        except ImportError:
            sys.exit(
                'Este archivo es un .xls binario de verdad y falta la libreria para leerlo.\n'
                'Dos salidas, cualquiera sirve:\n'
                '  1) pip install xlrd\n'
                '  2) abrilo en Excel y guardalo como "Texto (delimitado por tabulaciones)",\n'
                '     y corre este script sobre ese archivo.')
        libro = xlrd.open_workbook(ruta)
        hoja = libro.sheet_by_index(0)
        filas = []
        for i in range(hoja.nrows):
            fila = []
            for celda in hoja.row(i):
                # Un numero entero no tiene que quedar como "24443447.0".
                if celda.ctype == 2 and float(celda.value).is_integer():
                    fila.append(str(int(celda.value)))
                else:
                    fila.append(str(celda.value).strip())
            filas.append(fila)
        return filas, '.xls binario (xlrd)'

    if crudo[:2] == b'PK':
        sys.exit('Esto es un .xlsx, no un .xls. Guardalo como "Texto (delimitado por '
                 'tabulaciones)" o decimelo y lo agrego al script.')

    texto, cod = decodificar(crudo)

    if '<table' in texto[:20000].lower():
        p = TablaHTML(); p.feed(texto)
        if not p.filas:
            sys.exit('Parece HTML pero no encontre ninguna tabla adentro.')
        return p.filas, 'tabla HTML disfrazada de .xls (%s)' % cod

    muestra = texto[:8000]
    delim = '\t' if muestra.count('\t') >= max(muestra.count(';'), muestra.count(',')) \
            else (';' if muestra.count(';') > muestra.count(',') else ',')
    filas = [f for f in csv.reader(io.StringIO(texto), delimiter=delim) if any(c.strip() for c in f)]
    nombre = {'\t': 'tabulaciones', ';': 'punto y coma', ',': 'comas'}[delim]
    return filas, 'texto separado por %s (%s)' % (nombre, cod)

# ----------------------------------------------------------------- utilidad
def a_entero(txt):
    d = re.sub(r'[^\d\-]', '', str(txt or ''))
    try:
        return int(d)
    except ValueError:
        return None

def a_fecha(txt):
    """El SNIG escribe 11/7/2025 = 11 de julio. Dia primero, siempre."""
    t = str(txt or '').strip()
    if not t:
        return None
    for fmt in ('%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d', '%d-%m-%Y'):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    return None

def cargar_animales(ruta, solo_vivos=True):
    """Lee el export y devuelve una lista de dicts, para usar desde cruzar.py.

    'id8' sale de rellenar Dispositivo a 8 digitos, igual que
    normalizarCaravana() en la app: si Excel se comio un cero, esto lo
    devuelve. El informe de main() es el que avisa cuantos fueron.
    """
    filas, _ = leer_tabla(ruta)
    if not filas:
        return []
    encabezados = filas[0]
    mapa = mapear_columnas(encabezados)
    faltan = [c for c in OBLIGATORIAS if c not in mapa]
    if faltan:
        raise ValueError('Al export del SNIG le faltan columnas: %s. Encabezados: %s'
                         % (', '.join(faltan), ', '.join(encabezados)))
    out = []
    for fila in filas[1:]:
        if not any(c.strip() for c in fila):
            continue
        def val(campo):
            i = mapa.get(campo)
            return fila[i].strip() if i is not None and i < len(fila) else ''
        if solo_vivos and 'status_vida' in mapa and not normalizar(val('status_vida')).startswith('vivo'):
            continue
        d = re.sub(r'\D', '', val('dispositivo'))
        if not d:
            continue
        meses = a_entero(val('edad_meses'))
        if meses is None:
            dias = a_entero(val('edad_dias'))
            meses = int(dias / 30.4375) if dias is not None else None
        out.append({
            'id8': d.zfill(8), 'dispositivo_crudo': d, 'sexo': val('sexo'),
            'raza': val('raza'), 'edad_meses': meses,
            'propietario': val('propietario'), 'ubicacion': val('ubicacion'),
            'tenedor': val('tenedor'), 'status_vida': val('status_vida'),
            'categoria': categoria_por_edad(val('sexo'), meses),
            'fecha_ingreso': a_fecha(val('fecha_ingreso')), 'documento': val('documento'),
        })
    return out

def buscar_en_descargas():
    carpeta = os.path.join(os.path.expanduser('~'), 'Downloads')
    if not os.path.isdir(carpeta):
        return None
    cand = [os.path.join(carpeta, f) for f in os.listdir(carpeta)
            if f.lower().startswith('animales') and f.lower().endswith(('.xls', '.xlsx', '.csv', '.txt'))]
    return max(cand, key=os.path.getmtime) if cand else None

def titulo(t):
    print('\n' + t)
    print('-' * len(t))

# -------------------------------------------------------------------- main
def main():
    ruta = sys.argv[1] if len(sys.argv) > 1 else buscar_en_descargas()
    if not ruta:
        sys.exit('No encontre ningun "animales*.xls" en Descargas. Pasame la ruta:\n'
                 '    python leer_snig.py ruta\\al\\archivo.xls')
    if not os.path.isfile(ruta):
        sys.exit('No existe el archivo: %s' % ruta)

    filas, formato = leer_tabla(ruta)
    print('Archivo : %s' % ruta)
    print('Formato : %s' % formato)
    print('Filas   : %d (incluyendo el encabezado)' % len(filas))

    encabezados = filas[0]
    mapa = mapear_columnas(encabezados)
    faltan = [c for c in OBLIGATORIAS if c not in mapa]
    if faltan:
        print('\nEncabezados encontrados:')
        for h in encabezados:
            print('   - %s' % h)
        sys.exit('\nNo encontre estas columnas obligatorias: %s\n'
                 'Agregalas al diccionario ALIAS arriba en este mismo archivo.' % ', '.join(faltan))

    def val(fila, campo):
        i = mapa.get(campo)
        return fila[i].strip() if i is not None and i < len(fila) else ''

    datos = []
    for fila in filas[1:]:
        if not any(c.strip() for c in fila):
            continue
        datos.append(fila)

    titulo('1. Columnas que voy a usar')
    for campo in ALIAS:
        i = mapa.get(campo)
        print('   %-14s %s' % (campo, encabezados[i] if i is not None else '(no viene en este export)'))

    # ---- 2. dispositivo: ceros perdidos y duplicados
    titulo('2. Numero de dispositivo (la clave del cruce)')
    largos = Counter()
    vistos = Counter()
    sin_numero = 0
    for fila in datos:
        d = re.sub(r'\D', '', val(fila, 'dispositivo'))
        if not d:
            sin_numero += 1; continue
        largos[len(d)] += 1
        vistos[d.zfill(8)] += 1
    for largo in sorted(largos):
        marca = '  <-- le faltan ceros a la izquierda' if largo < 8 else ''
        print('   %d digitos: %d animales%s' % (largo, largos[largo], marca))
    if sin_numero:
        print('   sin numero: %d animales' % sin_numero)
    cortos = sum(v for k, v in largos.items() if k < 8)
    if cortos:
        print('\n   %d animales traen menos de 8 digitos. Casi seguro Excel los leyo como' % cortos)
        print('   numero y se comio los ceros de adelante. El script los rellena con zfill(8),')
        print('   igual que normalizarCaravana() en la app. Si el numero de verdad tiene')
        print('   menos de 8 digitos, esto esta mal y hay que mirarlo.')
    else:
        print('\n   Todos con 8 digitos: no se perdio ningun cero. Es la mejor noticia posible.')
    repetidos = {k: v for k, v in vistos.items() if v > 1}
    if repetidos:
        print('\n   %d dispositivos aparecen mas de una vez:' % len(repetidos))
        for k, v in list(sorted(repetidos.items()))[:10]:
            print('      %s x%d' % (k, v))
        print('   Un dispositivo repetido rompe la clave (establecimiento, id8) del padron.')
    else:
        print('   Sin repetidos: la clave (establecimiento, id8) es valida.')
    if 'ide' not in mapa:
        print('\n   Este export NO trae el numero electronico de 15 digitos, solo el')
        print('   visual de 8. El cruce con el baston se hace entonces por los ultimos 8')
        print('   del EID que lee el baston, que es justo lo que ya hace la app.')

    # ---- 3. estados
    titulo('3. Estado de los animales')
    for campo, etiqueta in (('status_vida', 'Status de vida'),
                            ('status_traza', 'Status de trazabilidad'),
                            ('errores', 'Errores')):
        if campo not in mapa:
            continue
        c = Counter(val(f, campo) or '(vacio)' for f in datos)
        print('   %s:' % etiqueta)
        for k, v in c.most_common():
            print('      %-28s %6d' % (k, v))

    vivos = [f for f in datos
             if 'status_vida' not in mapa or normalizar(val(f, 'status_vida')).startswith('vivo')]
    print('\n   Animales vivos: %d de %d' % (len(vivos), len(datos)))
    print('   El resto de este informe cuenta solo los vivos.')

    # ---- 4. codigos SNIG
    titulo('4. Codigos de Propietario / Ubicacion / Tenedor')
    print('   Esta es la lista que hay que traducir en tenedores.csv. Cada codigo')
    print('   de 9 digitos es un tenedor del SNIG; la app no sabe nada de el hasta')
    print('   que le digamos a que establecimiento y firma corresponde.\n')
    codigos = defaultdict(lambda: Counter())
    for f in vivos:
        for campo in ('propietario', 'ubicacion', 'tenedor'):
            if campo in mapa:
                v = val(f, campo)
                if v:
                    codigos[v][campo] += 1
    for cod in sorted(codigos, key=lambda c: -sum(codigos[c].values())):
        c = codigos[cod]
        print('   %-14s  propietario:%6d   ubicacion:%6d   tenedor:%6d'
              % (cod, c['propietario'], c['ubicacion'], c['tenedor']))

    # ---- 5. propietario != tenedor
    if 'propietario' in mapa and 'tenedor' in mapa:
        titulo('5. Animales con Propietario distinto de Tenedor')
        pares = Counter((val(f, 'propietario'), val(f, 'tenedor'))
                        for f in vivos if val(f, 'propietario') != val(f, 'tenedor'))
        if not pares:
            print('   Ninguno: en este export todo lo que tengo es mio y esta donde dice.')
        else:
            print('   Propietario -> Tenedor          Animales')
            for (p, t), n in pares.most_common():
                print('   %-14s -> %-14s %6d' % (p, t, n))
            print('\n   Estos son los que van a aparecer como diferencia en la conciliacion C1')
            print('   hasta que el codigo del tercero este cargado en tenedores.csv.')

    # ---- 6. stock por categoria derivada
    titulo('6. Stock por categoria (derivado de Sexo + Edad)')
    if 'edad_meses' not in mapa and 'edad_dias' not in mapa:
        print('   Este export no trae edad: no puedo derivar categoria.')
    else:
        por_tenedor = defaultdict(lambda: Counter())
        sin_cat = 0
        for f in vivos:
            meses = a_entero(val(f, 'edad_meses'))
            if meses is None:
                dias = a_entero(val(f, 'edad_dias'))
                meses = int(dias / 30.4375) if dias is not None else None
            cat = categoria_por_edad(val(f, 'sexo'), meses)
            if cat is None:
                sin_cat += 1; continue
            por_tenedor[val(f, 'tenedor')][cat] += 1
        for ten in sorted(por_tenedor):
            total = sum(por_tenedor[ten].values())
            print('\n   Tenedor %s  (%d animales)' % (ten, total))
            for cat, n in sorted(por_tenedor[ten].items(), key=lambda kv: -kv[1]):
                print('      %-26s %6d' % (cat, n))
        if sin_cat:
            print('\n   %d animales sin categoria (sexo o edad vacios).' % sin_cat)
        print('\n   Recordá: el SNIG no dice si un macho esta castrado, asi que todos los')
        print('   machos de mas de 3 años caen en "Novillos +3 años". Los toros los vas a')
        print('   tener que descontar a mano cuando compares con el stock de la app.')

    # ---- 7. fechas
    if 'fecha_ingreso' in mapa:
        titulo('7. Fechas de ingreso a la ubicacion actual')
        fechas = [d for d in (a_fecha(val(f, 'fecha_ingreso')) for f in vivos) if d]
        if fechas:
            print('   De %s a %s' % (min(fechas).strftime('%d/%m/%Y'), max(fechas).strftime('%d/%m/%Y')))
            por_anio = Counter(d.year for d in fechas)
            for a in sorted(por_anio):
                print('      %d: %d animales' % (a, por_anio[a]))
        sin_fecha = len(vivos) - len(fechas)
        if sin_fecha:
            print('   %d animales sin fecha de ingreso legible.' % sin_fecha)

    if 'edad_dias' in mapa:
        dias = [a_entero(val(f, 'edad_dias')) for f in vivos]
        dias = [d for d in dias if d]
        if dias:
            nac = date.today() - timedelta(days=max(dias))
            titulo('8. Fecha de corte del export')
            print('   El animal mas viejo tiene %d dias. Si el export se bajo hoy, nacio' % max(dias))
            print('   alrededor del %s. Sirve para confirmar de que dia es la foto:' % nac.strftime('%d/%m/%Y'))
            print('   la edad del SNIG es a la fecha del export, no a la de hoy.')

    # ---- CSV para completar a mano
    salida = os.path.join(os.path.dirname(os.path.abspath(ruta)), 'tenedores_detectados.csv')
    with open(salida, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['codigo_snig', 'animales', 'aparece_como', 'tenedor', 'tipo_tenencia',
                    'establecimiento_app', 'firma_app', 'dicose', 'padron', 'departamento',
                    'area_ha', 'activo', 'notas'])
        for cod in sorted(codigos, key=lambda c: -sum(codigos[c].values())):
            c = codigos[cod]
            roles = '+'.join(k for k in ('propietario', 'ubicacion', 'tenedor') if c[k])
            w.writerow([cod, c['tenedor'] or sum(c.values()), roles,
                        '', '', '', '', '', '', '', '', 'si', ''])
    titulo('Archivo escrito')
    print('   %s' % salida)
    print('\n   Completá a mano las columnas vacias (tenedor, tipo_tenencia,')
    print('   establecimiento_app, firma_app) y ese pasa a ser el tenedores.csv')
    print('   del documento. Es lo unico que traduce el mundo SNIG al mundo de la app.')

if __name__ == '__main__':
    main()
