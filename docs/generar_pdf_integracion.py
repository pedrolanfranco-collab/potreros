# -*- coding: utf-8 -*-
"""
Genera el PDF "Integracion SNIG + baston XRS2 + app de potreros".
Salida: /home/user/potreros/docs/integracion-snig-xrs2-app.pdf
"""
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether,
                                PageBreak, NextPageTemplate, Flowable)

# ---------- paleta (la misma de la app) ----------
VERDE   = colors.HexColor('#2b3a24')
CAMPO   = colors.HexColor('#5c7a4a')
CLARO   = colors.HexColor('#8fae72')
TIERRA  = colors.HexColor('#7a5236')
CREMA   = colors.HexColor('#f3ecd9')
CREMALT = colors.HexColor('#faf6ea')
OCRE    = colors.HexColor('#c68a3b')
ROJO    = colors.HexColor('#a1402e')
TEXTO   = colors.HexColor('#241f16')
SUAVE   = colors.HexColor('#5a5340')
LINEA   = colors.HexColor('#d8cead')

SALIDA = '/home/user/potreros/docs/integracion-snig-xrs2-app.pdf'
TITULO = 'Integracion SNIG + baston XRS2 + app de potreros'

# ---------- estilos ----------
def E(name, **kw):
    base = dict(name=name, fontName='Helvetica', fontSize=9.5, leading=13.5,
                textColor=TEXTO, alignment=TA_LEFT, spaceAfter=0)
    base.update(kw)
    return ParagraphStyle(**base)

st_tapa_t   = E('tapa_t', fontName='Helvetica-Bold', fontSize=23, leading=27, textColor=CREMALT)
st_tapa_s   = E('tapa_s', fontSize=11, leading=16, textColor=CLARO)
st_tapa_m   = E('tapa_m', fontSize=8.5, leading=12, textColor=CREMA)
st_h1       = E('h1', fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=VERDE, spaceAfter=3)
st_h1n      = E('h1n', fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=OCRE)
st_h2       = E('h2', fontName='Helvetica-Bold', fontSize=10.5, leading=14, textColor=TIERRA, spaceAfter=2)
st_body     = E('body', spaceAfter=5)
st_bullet   = E('bullet', leftIndent=11, bulletIndent=2, spaceAfter=3)
st_small    = E('small', fontSize=8.3, leading=11.5, textColor=SUAVE)
st_th       = E('th', fontName='Helvetica-Bold', fontSize=8.2, leading=10.5, textColor=CREMALT)
st_td       = E('td', fontSize=8.2, leading=10.5)
st_td_b     = E('td_b', fontName='Helvetica-Bold', fontSize=8.2, leading=10.5)
st_mono     = E('mono', fontName='Courier', fontSize=7.9, leading=11, textColor=colors.HexColor('#1d2b18'))
st_call_t   = E('call_t', fontName='Helvetica-Bold', fontSize=9.3, leading=12.5, textColor=VERDE)
st_call     = E('call', fontSize=8.8, leading=12.3, textColor=TEXTO)
st_pie      = E('pie', fontSize=7.5, leading=9.5, textColor=SUAVE)

def P(t, s=st_body):   return Paragraph(t, s)
def B(t):              return Paragraph(t, st_bullet, bulletText='•')
def N(t, n):           return Paragraph(t, st_bullet, bulletText=str(n) + '.')
def S(h):              return Spacer(1, h)

class Regla(Flowable):
    """Linea fina de separacion."""
    def __init__(self, ancho, color=LINEA, grosor=0.7):
        Flowable.__init__(self); self.ancho = ancho; self.color = color; self.grosor = grosor
    def wrap(self, aw, ah): return (self.ancho or aw, self.grosor + 2)
    def draw(self):
        self.canv.setStrokeColor(self.color); self.canv.setLineWidth(self.grosor)
        self.canv.line(0, 1, self.ancho, 1)

ANCHO = A4[0] - 40*mm   # ancho util del frame

def H1(num, txt):
    t = Table([[Paragraph(num, st_h1n), Paragraph(txt, st_h1)]],
              colWidths=[13*mm, ANCHO - 13*mm])
    t.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'),
                           ('LEFTPADDING', (0,0), (-1,-1), 0),
                           ('RIGHTPADDING', (0,0), (-1,-1), 0),
                           ('TOPPADDING', (0,0), (-1,-1), 0),
                           ('BOTTOMPADDING', (0,0), (-1,-1), 2)]))
    return KeepTogether([S(7), t, Regla(ANCHO, CLARO, 1.1), S(5)])

def H2(txt):
    return KeepTogether([S(4), Paragraph(txt, st_h2)])

def tabla(filas, anchos, encabezado=True, fuente_td=st_td):
    datos = []
    for i, fila in enumerate(filas):
        est = st_th if (encabezado and i == 0) else fuente_td
        datos.append([c if isinstance(c, Flowable) else Paragraph(str(c), est) for c in fila])
    t = Table(datos, colWidths=anchos, repeatRows=1 if encabezado else 0)
    cmds = [
        ('GRID', (0,0), (-1,-1), 0.4, LINEA),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ]
    if encabezado:
        cmds += [('BACKGROUND', (0,0), (-1,0), CAMPO),
                 ('LINEBELOW', (0,0), (-1,0), 0.8, VERDE)]
        for r in range(2, len(datos), 2):
            cmds.append(('BACKGROUND', (0,r), (-1,r), CREMALT))
    else:
        for r in range(1, len(datos), 2):
            cmds.append(('BACKGROUND', (0,r), (-1,r), CREMALT))
    t.setStyle(TableStyle(cmds))
    return t

def codigo(lineas):
    cuerpo = [[Paragraph(l.replace(' ', '&nbsp;') or '&nbsp;', st_mono)] for l in lineas]
    t = Table(cuerpo, colWidths=[ANCHO])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#eef0e4')),
        ('BOX', (0,0), (-1,-1), 0.5, LINEA),
        ('LINEBEFORE', (0,0), (0,-1), 2.2, CLARO),
        ('LEFTPADDING', (0,0), (-1,-1), 7),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('TOPPADDING', (0,0), (-1,-1), 0.6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0.6),
    ]))
    return KeepTogether([S(3), t, S(5)])

def aviso(titulo, texto, color=OCRE, fondo=colors.HexColor('#fbf3e2')):
    interno = [[Paragraph(titulo, st_call_t)], [Paragraph(texto, st_call)]]
    t = Table(interno, colWidths=[ANCHO])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), fondo),
        ('LINEBEFORE', (0,0), (0,-1), 3, color),
        ('BOX', (0,0), (-1,-1), 0.4, LINEA),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 7),
        ('TOPPADDING', (0,0), (0,0), 6),
        ('BOTTOMPADDING', (0,0), (0,0), 1),
        ('TOPPADDING', (0,1), (0,1), 0),
        ('BOTTOMPADDING', (0,1), (0,1), 6),
    ]))
    return KeepTogether([S(4), t, S(5)])

# ---------- tapa ----------
def dibujar_tapa(canv, doc):
    canv.saveState()
    W, H = A4
    canv.setFillColor(VERDE); canv.rect(0, H-118*mm, W, 118*mm, stroke=0, fill=1)
    canv.setFillColor(colors.HexColor('#233019')); canv.rect(0, H-118*mm, W, 6*mm, stroke=0, fill=1)
    canv.setFillColor(CREMA); canv.rect(0, 0, W, H-118*mm, stroke=0, fill=1)
    # franja de acento, bien arriba del texto
    canv.setFillColor(OCRE); canv.rect(20*mm, H-38*mm, 26*mm, 1.6*mm, stroke=0, fill=1)
    canv.restoreState()

def dibujar_pagina(canv, doc):
    canv.saveState()
    W, H = A4
    canv.setFillColor(CREMALT); canv.rect(0, 0, W, H, stroke=0, fill=1)
    # cabecera
    canv.setFillColor(VERDE); canv.rect(0, H-14*mm, W, 14*mm, stroke=0, fill=1)
    canv.setFont('Helvetica', 7.5); canv.setFillColor(CREMA)
    canv.drawString(20*mm, H-9.2*mm, TITULO)
    canv.drawRightString(W-20*mm, H-9.2*mm, 'La Vuelta / Maria Laura / Pone Chico  -  Rivera')
    # pie
    canv.setStrokeColor(LINEA); canv.setLineWidth(0.6)
    canv.line(20*mm, 13*mm, W-20*mm, 13*mm)
    canv.setFont('Helvetica', 7.5); canv.setFillColor(SUAVE)
    canv.drawString(20*mm, 9*mm, '25/9/2026')
    canv.drawRightString(W-20*mm, 9*mm, 'Pagina %d' % (doc.page - 1))
    canv.restoreState()

# ---------- documento ----------
os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
doc = BaseDocTemplate(SALIDA, pagesize=A4,
                      leftMargin=20*mm, rightMargin=20*mm,
                      topMargin=20*mm, bottomMargin=18*mm,
                      title=TITULO, author='Pedro Lanfranco',
                      subject='Padron por animal y conciliacion por tenedor')

frame_tapa = Frame(20*mm, 18*mm, ANCHO, A4[1]-38*mm, id='tapa',
                   leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
frame_cuerpo = Frame(20*mm, 16*mm, ANCHO, A4[1]-36*mm, id='cuerpo',
                     leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([
    PageTemplate(id='tapa', frames=[frame_tapa], onPage=dibujar_tapa),
    PageTemplate(id='cuerpo', frames=[frame_cuerpo], onPage=dibujar_pagina),
])

F = []   # flowables

# ============================ TAPA ============================
F += [S(28*mm),
      P('PROYECTO GESTION GANADERA', st_tapa_m),
      S(4),
      P('Integracion SNIG +<br/>baston XRS2 +<br/>app de potreros', st_tapa_t),
      S(10),
      P('Padron por animal, archivo de tenedores y las tres conciliaciones '
        'que hay que poder correr sin pensar.', st_tapa_s),
      S(16),
      P('Pedro Lanfranco Crespo &nbsp;|&nbsp; Rivera, Uruguay &nbsp;|&nbsp; 25 de setiembre de 2026', st_tapa_m),
      S(36*mm)]

resumen = [
    ('Lo que ya funciona',
     'La app ya lee un padron por animal desde Supabase (<b>animales_caravana</b>) y muestra '
     'la ficha con APTO / NO APTO / CARENCIA DESCONOCIDA. Esta prendido solo en La Vuelta '
     '(<b>caravanasHabilitado</b>).'),
    ('Lo que falta',
     'El script que llena esa tabla cruzando las tres fuentes, y el <b>archivo de tenedores</b> '
     'que es el unico puente entre el numero de DICOSE del SNIG y el establecimiento + firma '
     'con que habla la app.'),
    ('La regla de oro',
     'La app no importa archivos nunca. La PC publica a Supabase, la app solo lee. '
     'Todo lo de este documento pasa en la PC, no en el celular.'),
]
filas = []
for t, d in resumen:
    filas.append([Paragraph(t, st_td_b), Paragraph(d, st_td)])
tr = tabla(filas, [38*mm, ANCHO-38*mm], encabezado=False)
F += [tr, S(6),
      P('Contenido: (1) lo que la app ya hace, (2) las tres fuentes de datos, (3) el archivo de '
        'tenedores, (4) las tres conciliaciones, (5) el contrato con la app, (6) el peso, '
        '(7) el plan en orden, (8) lo que falta confirmar.', st_small)]

F += [NextPageTemplate('cuerpo'), PageBreak()]

# ============================ 1 ============================
F += [H1('1', 'Que hay hoy, verificado en el codigo')]
F += [P('Esto no es un plan en el aire: la mitad ya esta hecha. El 24/9/2026 se agrego a las seis '
        'variantes de la app el boton <b>"Buscar caravana"</b> y la caravana opcional dentro de '
        '"+ Cargar tratamiento". Lo que sigue sale de leer el template, no de suponer.')]

F += [H2('Lo que la app hace con una caravana')]
F += [B('<b>Normaliza</b> el numero: <b>normalizarCaravana()</b> saca todo lo que no sea digito, '
        'toma los <b>ultimos 8</b> y rellena con ceros a la izquierda. El baston da un EID de 15 '
        'digitos y el SNIG publica el visual de 8: esa funcion es la que los hace coincidir.'),
      B('<b>Consulta</b> <b>animales_caravana</b> filtrando por <b>establecimiento</b> + <b>id8</b>. '
        'Solo SELECT, un registro.'),
      B('<b>Muestra la ficha</b>: categoria, sexo, generacion, firma, potrero, ultimo peso con fecha, '
        'ultima lectura, proximo tratamiento, y arriba de todo el semaforo de carencia.'),
      B('Si la caravana <b>no esta</b> en el padron, avisa; no inventa un animal. Sin señal, avisa '
        'y no rompe.'),
      B('En el formulario de tratamiento, al tipear la caravana muestra <b>de quien es antes de '
        'guardar</b>, y exige <b>cantidad = 1</b> (una caravana es un animal). La manda en la '
        'columna <b>caravana</b> de <b>sanidad_carga</b>, solo si el establecimiento tiene el padron '
        'publicado.')]

F += [aviso('Para que existe todo esto',
            'Un tratamiento cargado al animal equivocado termina en una carencia equivocada, y eso '
            'es un animal que se va a faena cuando no debia. El semaforo del corral es la razon de '
            'ser del padron; el peso y la categoria son el premio.')]

F += [H2('Las columnas que la app lee (contrato: no se pueden renombrar)')]
cols = [
    ['Columna', 'Tipo', 'Para que la usa la app'],
    ['establecimiento', 'text', 'Filtro. Mismos valores que ESTABLECIMIENTO (la_vuelta, etc.)'],
    ['id8', 'text', 'Clave de busqueda. 8 digitos, con ceros a la izquierda si hace falta'],
    ['ide', 'text', 'EID de 15 digitos. Informativo / trazabilidad'],
    ['categoria', 'text', 'Ficha. Ideal: mismas categorias que usa la app'],
    ['sexo', 'text', 'Ficha (HEMBRA / MACHO)'],
    ['gen', 'text', 'Generacion. Ficha'],
    ['propietario', 'text', 'Ficha, con la etiqueta Firma (La Vuelta) o Dueño'],
    ['potrero', 'text', 'Ficha. Donde el padron cree que esta'],
    ['estado_carencia', 'text', 'Semaforo. Exactamente: APTO, NO APTO, CARENCIA DESCONOCIDA'],
    ['fecha_apto', 'date', 'Hasta cuando no puede ir a faena'],
    ['dias_restantes', 'int', 'Cuantos dias faltan'],
    ['producto_carencia', 'text', 'Por que producto esta en espera'],
    ['proximo_tratamiento', 'date', 'Ficha'],
    ['ultimo_peso', 'int', 'Ficha. Sale del baston'],
    ['peso_fecha', 'date', 'Fecha de ese peso'],
    ['ultima_lectura', 'date', 'Ultima vez que paso por la manga'],
]
F += [tabla(cols, [34*mm, 15*mm, ANCHO-49*mm])]
F += [S(3), P('Cualquier valor distinto de <b>NO APTO</b> o <b>CARENCIA DESCONOCIDA</b> la app lo '
              'toma como apto. Si el script publica "no apto" en minuscula, el animal aparece verde. '
              'Es el error mas caro de esta lista.', st_small)]

# ============================ 2 ============================
F += [H1('2', 'Las tres fuentes y para que sirve cada una')]
F += [P('Cada archivo contesta una pregunta distinta. Confundirlas es lo que hace que una '
        'conciliacion no cierre nunca.')]

fuentes = [
    ['Fuente', 'Que es', 'Clave', 'Contesta'],
    ['<b>SNIG</b><br/>animales_*.xls',
     'El padron oficial: que caravanas figuran a nombre de cada tenedor (DICOSE). '
     'Descargado de la web del SNIG.',
     'Caravana visual + DIE electronico, por tenedor',
     'Que animales <b>dice el Estado</b> que tengo, y a nombre de quien'],
    ['<b>Baston XRS2</b><br/>1075_SesionNNNN.csv / .xls',
     'Lo que realmente paso por la manga en una sesion: EID leido, fecha y hora, peso y '
     'los traits que se cargan en el baston.',
     'EID de 15 digitos',
     'Que animales <b>estan de verdad</b>, cuanto pesan y cuando los vi'],
    ['<b>Tenedores</b><br/>tenedores.csv (a crear)',
     'La tabla de traduccion entre el mundo DICOSE y el mundo de la app. Es el archivo '
     'nuevo de este documento.',
     'Numero de DICOSE',
     'Que <b>establecimiento y firma</b> de la app es cada tenedor del SNIG'],
    ['<i>(ya existe)</i><br/>Planilla Sanitaria',
     'Tratamientos y plazos de retiro por producto. Ya publica productos_catalogo, '
     'sanidad_ultimos y sanidad_proximos por tarea programada.',
     'Producto / caravana',
     'Si el animal esta en periodo de espera'],
]
filas = [[Paragraph(c, st_th if i == 0 else st_td) for c in f] for i, f in enumerate(fuentes)]
F += [tabla(fuentes, [30*mm, 55*mm, 32*mm, ANCHO-117*mm])]

F += [aviso('Los nombres exactos de columna hay que confirmarlos contra los archivos reales',
            'El SNIG y el baston cambian encabezados entre versiones de export. El script no debe '
            'depender de una posicion de columna ni de un nombre exacto: conviene una tabla de '
            'alias (por ejemplo, aceptar "EID", "Nro Electronico", "DIE" como lo mismo) y '
            '<b>fallar con un mensaje claro</b> si no encuentra una columna obligatoria. Un export '
            'que cambio un encabezado y paso callado es peor que uno que corta.',
            ROJO, colors.HexColor('#f7ece9'))]

F += [H2('La regla del cruce: visual de 8 contra electronico de 15')]
F += [codigo([
    'EID del baston   858000057179343',
    'id8 (clave)             57179343     <- ultimos 8, rellenados a 8',
    'visual del SNIG         57179343     <- tiene que dar lo mismo',
    '',
    "normalizarCaravana('858000057179343')  ->  '57179343'",
    "normalizarCaravana('  571-793 43 ')    ->  '57179343'",
    "normalizarCaravana('179343')           ->  '00179343'   <- ojo",
])]
F += [P('Lo primero que hay que medir, antes de escribir el publicador entero: <b>en cuantos animales '
        'el visual del SNIG NO coincide con los ultimos 8 del electronico</b>. Si son cero, el cruce '
        'por <b>id8</b> alcanza para todo. Si son unos pocos, hay que cruzar por EID cuando existe y '
        'guardar la excepcion en el archivo de tenedores o en una lista aparte. Si son muchos, la '
        'clave del padron tiene que pasar a ser el EID y hay que revisar la funcion de la app.', st_body)]

# ============================ 3 ============================
F += [H1('3', 'El archivo de tenedores (lo nuevo)')]
F += [P('El SNIG habla en <b>numeros de DICOSE</b>. La app habla en <b>establecimiento + firma</b>. '
        'Sin una tabla que traduzca, ninguna comparacion entre los dos mundos se puede automatizar: '
        'queda siempre alguien mirando dos pantallas. Ese es todo el trabajo de este archivo.')]

F += [H2('Esquema propuesto: tenedores.csv')]
esq = [
    ['Columna', 'Ejemplo', 'Obligatoria', 'Nota'],
    ['dicose', '123456/7', 'si', 'Clave. Como figura en el SNIG, tal cual'],
    ['tenedor', 'PEDRO LANFRANCO CRESPO', 'si', 'Nombre del tenedor en el SNIG'],
    ['titular_snig', 'Pedro Lanfranco Crespo', 'no', 'Si el titular difiere del tenedor'],
    ['tipo_tenencia', 'propia', 'si', 'propia / arrendada / pastoreo / capitalizacion'],
    ['establecimiento_app', 'la_vuelta', 'si', 'Exactamente el ESTABLECIMIENTO de la app, o vacio si no esta en la app'],
    ['firma_app', 'Pedro Lanfranco', 'no', 'La firma/dueño de la app. Vacio = sin asignar'],
    ['padron', '45821', 'no', 'Padron rural'],
    ['departamento', 'Rivera', 'si', ''],
    ['seccional', '9', 'no', 'Seccional policial (la pide el DICOSE)'],
    ['area_ha', '412.5', 'no', 'Superficie declarada. Sirve para carga por hectarea'],
    ['activo', 'si', 'si', 'Para no borrar historia cuando se deja un campo'],
    ['desde', '2019-07-01', 'no', 'Alta de la tenencia'],
    ['hasta', '', 'no', 'Baja. Vacio = vigente'],
    ['notas', 'Arrendamiento a Fulano, vence 6/2027', 'no', ''],
]
F += [tabla(esq, [33*mm, 41*mm, 21*mm, ANCHO-95*mm])]

F += [H2('Como se llena y donde vive')]
F += [B('Una fila por <b>DICOSE</b>, no por establecimiento: un mismo campo puede tener dos DICOSE '
        '(propio y arrendado) y un mismo DICOSE puede cubrir dos padrones. La relacion DICOSE -> '
        '(establecimiento, firma) es de muchos a uno, y en algun caso al reves.'),
      B('Los DICOSE se sacan del propio export del SNIG (la columna de tenedor) mas la Declaracion '
        'Jurada anual: el export solo trae los que tienen animales hoy, la DJ trae todos.'),
      B('Se guarda <b>al lado de publicar_animales.py</b>, en la carpeta del lector XRS2, y se '
        'versiona junto con el script. Es dato de configuracion, no dato operativo: cambia dos '
        'veces por año, no todos los dias.'),
      B('En UTF-8 y con separador coma. Si se edita en Excel, guardar como "CSV UTF-8" — el CSV '
        'comun de Excel en español rompe los acentos y el script empieza a no encontrar tenedores.')]

F += [aviso('Por que no una tabla de Supabase',
            'Podria ser, pero no hace falta todavia: la app no necesita leer los tenedores, solo el '
            'publicador los usa, y un CSV al lado del script se edita sin pedirle permiso a nadie y '
            'queda en el git. El dia que la app tenga que mostrar "de que DICOSE es este animal", '
            'ahi si conviene subirlo — y ahi vale acordarse de crear la tabla <b>y sus politicas</b> '
            'antes de escribir el codigo que las asume.')]

# ============================ 4 ============================
F += [H1('4', 'Las tres conciliaciones')]
F += [P('"Comparar" en concreto son tres comparaciones distintas, con tres claves distintas y tres '
        'acciones distintas cuando no cierran. Conviene que el script las escriba a tres planillas '
        'separadas, no a un resumen: lo que se necesita es la lista de caravanas para ir a buscarlas.')]

F += [H2('C1. Padron SNIG contra lecturas del baston')]
F += [P('Clave: <b>id8</b>. Es la que mas plata mueve, porque encuentra las dos fugas clasicas.', st_body)]
c1 = [
    ['Caso', 'Que significa', 'Que hacer'],
    ['Esta en SNIG, nunca leida por el baston',
     'Animal que figura a mi nombre y no aparece en la manga. Vendido sin transferir, muerto sin '
     'declarar, perdido, o simplemente no paso por la manga en el periodo.',
     'Filtrar por <b>ultima_lectura</b> anterior al ultimo encierre general. Lo que queda es la '
     'lista para declarar bajas o buscar animales.'],
    ['Leida por el baston, no esta en SNIG a mi nombre',
     'Animal fisico que el Estado no cuenta como mio: transferencia pendiente del vendedor, '
     'caravana mal tipeada, o animal de un tercero (pastoreo / capitalizacion).',
     'Reclamar la transferencia, o registrar el DICOSE del tercero en <b>tenedores.csv</b> para '
     'que deje de aparecer como diferencia.'],
    ['En los dos, con tenedor distinto al esperado',
     'El animal esta, pero colgado del DICOSE equivocado.',
     'Transferencia interna entre DICOSE propios. Es lo que ordena la DJ de fin de ejercicio.'],
]
F += [tabla(c1, [42*mm, 56*mm, ANCHO-98*mm])]

F += [H2('C2. SNIG por tenedor contra el stock de la app')]
F += [P('Clave: <b>tenedores.csv</b> (DICOSE -> establecimiento + firma). Aca hay que ser honesto con '
        'lo que se puede comparar y lo que no.', st_body)]
F += [B('<b>Se compara bien el total de cabezas</b> por establecimiento y por firma. La app guarda '
        '<b>estado.potreros[potrero].animales["categoria||dueño"]</b>, asi que sumar por firma es '
        'directo; el stock ya se publica a <b>stock_potreros</b> en cada accion y cada sincronizacion, '
        'con lo cual la comparacion se puede hacer con SQL puro, sin abrir la app.'),
      B('<b>No se comparan las categorias tal cual.</b> El SNIG no tiene "Novillito 1-2": tiene sexo y '
        'fecha de nacimiento. La categoria hay que derivarla por edad a la fecha de corte, y aun asi '
        'va a haber discrepancias de borde (el animal que cumple los dos años en el medio del '
        'ejercicio). Comparar por categoria derivada sirve para detectar un error grueso, no para '
        'cuadrar al animal.'),
      B('<b>El desfasaje temporal es real, no un error.</b> El SNIG refleja lo declarado; la app '
        'refleja lo que pasa en el campo el mismo dia. Una diferencia de pocos dias entre un '
        'movimiento y su declaracion no es una inconsistencia: por eso la comparacion va siempre '
        'con una <b>fecha de corte explicita</b> en la planilla de salida.')]

F += [H2('C3. Tratamientos cargados contra el padron')]
F += [P('Clave: <b>id8</b> otra vez, ahora contra <b>sanidad_carga.caravana</b>.', st_body)]
F += [B('Caravana cargada en un tratamiento que <b>no existe</b> en el padron: numero mal tipeado. '
        'Es el caso que la app ya avisa en pantalla, pero el aviso se puede ignorar y la fila queda.'),
      B('Caravana cargada en un tratamiento <b>de otro establecimiento</b>: se cargo desde la app '
        'equivocada. Detectable porque el padron dice otro <b>establecimiento</b>.'),
      B('Animales con <b>CARENCIA DESCONOCIDA</b>: no es un error de carga, es un producto sin '
        '<b>dias_retiro</b> en el catalogo. La lista de productos que aparecen ahi es la lista de '
        'lo que falta completar en la Planilla Sanitaria.')]

# ============================ 5 ============================
F += [H1('5', 'Como se compatibiliza con la app')]
F += [P('El contrato es corto y conviene no romperlo: <b>la PC escribe, la app lee</b>. La app no '
        'importa un .xls ni un .csv en ningun momento; el celular en el corral solo hace un SELECT '
        'por <b>id8</b>.')]

F += [codigo([
    'SNIG animales_*.xls  ---+',
    'Sesiones XRS2 (.csv)  ---+--->  publicar_animales.py  --->  animales_caravana',
    'tenedores.csv        ---+        (PC, tarea programada)         (Supabase)',
    'Planilla Sanitaria   ---+                |                          |',
    '                                         |                          | SELECT por id8',
    '                                         v                          v',
    '                              conciliacion_C1/C2/C3.xlsx      app: Buscar caravana',
    '                                  (para Pedro, en la PC)      (los 6 index.html)',
])]

F += [H2('Lo que hay que hacer en Supabase, antes que nada')]
F += [B('Crear <b>animales_caravana</b> con las columnas de la seccion 1 y clave primaria '
        '<b>(establecimiento, id8)</b> — misma forma que <b>stock_potreros</b>, que usa '
        '<b>(establecimiento, potrero, clave)</b>.'),
      B('Politicas de RLS: <b>SELECT</b> para <b>anon</b> (lo necesita la app) y ademas '
        '<b>INSERT / UPDATE / DELETE</b>, porque el publicador hace <b>upsert</b> de lo vigente y '
        '<b>delete</b> de lo que ya no esta. Es el criterio de <b>eventos_sync</b> y '
        '<b>stock_potreros</b>: una politica "ALL".'),
      B('<b>No repetir el caso de productos_catalogo</b>, que quedo sin politica de UPDATE: un PATCH '
        'contra esa tabla no da error, da <b>200 con cuerpo vacio</b>, porque PostgREST no distingue '
        '"bloqueado por RLS" de "no habia ninguna fila para actualizar". Se perdieron horas con eso. '
        'Si el publicador va a hacer upsert, la politica de UPDATE tiene que existir <b>antes</b>.')]

F += [aviso('El orden que este proyecto ya aprendio a golpes',
            'Primero el schema y los permisos en Supabase; despues el codigo que los asume. Paso al '
            'revez dos veces: con <b>productos_catalogo</b> y con la columna <b>event_id</b> de '
            '<b>eventos_sync</b>. Y cuando un id nuevo va a una columna tipada, verificar el formato '
            'exacto: <b>event_id</b> se genero una vez con el generador de ids de historial '
            '("h_...") contra una columna <b>uuid</b>, y todos los inserts empezaron a fallar con '
            '22P02 sin que nada lo mostrara en pantalla.',
            ROJO, colors.HexColor('#f7ece9'))]

F += [H2('Lo que hay que hacer en la app (poco, y ya esta casi todo)')]
hacer = [
    ['Que', 'Estado', 'Detalle'],
    ['Leer el padron', 'Hecho', 'buscarCaravana() + fichaCaravanaHTML() en el template'],
    ['Normalizar 15 -> 8', 'Hecho', 'normalizarCaravana()'],
    ['Caravana en el tratamiento', 'Hecho', 'columna caravana en sanidad_carga desde el 24/9/2026'],
    ['Prender Maria Laura / Pone Chico', 'Pendiente', 'caravanasHabilitado: true en su config, recien '
     'cuando tengan padron publicado. Hoy el codigo esta pero es inerte'],
    ['Mostrar peso historico / ADPV', 'Opcional', 'Ver seccion 6. Hoy la ficha ya muestra ultimo_peso'],
]
F += [tabla(hacer, [46*mm, 22*mm, ANCHO-68*mm])]

F += [aviso('Si se toca el template, el ritual de siempre',
            'Subir <b>versionPc</b> / <b>versionMovil</b> en <b>template/configs/&lt;nombre&gt;.js</b>, '
            'correr <b>node template/generar.js</b> (reescribe los index.html, los maestros de OneDrive '
            'y el CACHE de cada sw.js) y recien despues commitear. Sin bump de version, un celular que '
            'ya instalo la PWA sigue sirviendo la version vieja para siempre. Y nunca editar un '
            'index.html a mano: el CI lo detecta con --check y falla.')]

# ============================ 6 ============================
F += [H1('6', 'El peso: donde guardarlo')]
F += [P('El baston trae peso, y el peso es lo unico de todo esto que ademas sirve para decidir '
        'plata: cuando vender, que lote va primero, si la ganancia diaria justifica el suplemento. '
        'Tres opciones, en orden de esfuerzo.')]
peso = [
    ['Opcion', 'Que implica', 'Recomendacion'],
    ['<b>A.</b> Solo ultimo_peso en animales_caravana',
     'El publicador pone el peso mas reciente y su fecha. Cero cambios en la app: la ficha ya lo '
     'muestra.',
     '<b>Empezar aca.</b> Es gratis y ya funciona'],
    ['<b>B.</b> Tabla pesadas aparte (id8, fecha, peso, sesion)',
     'Historia completa por animal. Habilita ADPV, curvas por lote, comparar potreros. Nueva tabla '
     'y politicas; la app tendria que leerla para mostrar la curva.',
     'Cuando la pregunta sea "cuanto gano este lote", no "cuanto pesa este animal"'],
    ['<b>C.</b> Meter el peso en eventos_sync',
     'Mezclar una medicion con un log de movimientos de hacienda.',
     '<b>No.</b> eventos_sync es el libro de movimientos que reconstruye el stock; una pesada no '
     'cambia el stock y ensuciaria el replay'],
]
F += [tabla(peso, [50*mm, 62*mm, ANCHO-112*mm])]

# ============================ 7 ============================
F += [H1('7', 'Plan de trabajo, en orden')]
F += [P('Cada paso deja algo usable. No hace falta terminar el 7 para que el 3 sirva.', st_body)]
pasos = [
    ('Medir el cruce.', 'Un script de 30 lineas que abre el export del SNIG y una sesion del baston y '
     'contesta una sola pregunta: cuantos visuales no coinciden con los ultimos 8 del electronico. '
     'Todo lo demas depende de esa respuesta.'),
    ('Escribir tenedores.csv a mano.', 'Con el esquema de la seccion 3, aunque sea con tres filas. Sin '
     'este archivo no hay C2 posible.'),
    ('Crear animales_caravana en Supabase, con politica ALL.', 'Antes de escribir el publicador, no '
     'despues.'),
    ('publicar_animales.py, version minima.', 'Solo SNIG + tenedores -> animales_caravana, sin peso ni '
     'carencia. Con eso, "Buscar caravana" en el corral ya dice de quien es el animal.'),
    ('Sumar el baston.', 'ultimo_peso, peso_fecha, ultima_lectura. La ficha se completa sola.'),
    ('Sumar la carencia.', 'Cruzar con lo que ya publica la Planilla Sanitaria (sanidad_ultimos y los '
     'dias_retiro de productos_catalogo) y calcular estado_carencia. Recien aca el semaforo es de fiar.'),
    ('Las tres planillas de conciliacion.', 'C1, C2 y C3 a un .xlsx por corrida, con fecha de corte en '
     'la primera fila.'),
    ('Tarea programada.', 'Igual que actualizar_sanidad_supabase.py: Task Scheduler de Windows, '
     'apuntando a la copia de OneDrive, con la copia en el repo solo para tener git log.'),
    ('Prender Maria Laura y Pone Chico.', 'caravanasHabilitado: true cuando su padron este publicado y '
     'verificado. Mismo rollout gradual que stockSupabase.'),
]
for i, (t, d) in enumerate(pasos, 1):
    F += [N('<b>' + t + '</b> ' + d, i)]

# ============================ 8 ============================
F += [H1('8', 'Que falta confirmar')]
F += [P('Lo honesto: este documento se escribio desde el codigo de la app, que se puede leer, y no '
        'desde los archivos del SNIG y del baston, que estan en la PC. Estas seis cosas hay que '
        'mirarlas en los archivos reales antes de escribir el publicador.')]
F += [B('Los <b>encabezados exactos</b> del export del SNIG (<b>animales_*.xls</b>): como se llaman la '
        'caravana visual, el electronico, el sexo, la fecha de nacimiento y el tenedor.'),
      B('Los <b>encabezados exactos</b> del archivo del baston (<b>1075_SesionNNNN.csv</b>), y si el '
        '.csv y el .xls traen lo mismo o uno trae mas traits que el otro. Si traen lo mismo, usar el '
        'csv: es mas facil de parsear y no depende de una libreria de Excel.'),
      B('Si el visual de 8 coincide con los ultimos 8 del electronico en <b>todos</b> los animales '
        '(paso 1 del plan).'),
      B('La <b>lista completa de DICOSE</b>, incluidos arrendamientos, pastoreos y capitalizaciones, y '
        'a que establecimiento de la app corresponde cada uno.'),
      B('Si hay <b>animales de terceros</b> en los campos, y de quien: son los que van a aparecer como '
        'diferencia en C1 hasta que esten en el archivo de tenedores.'),
      B('Como se cargan los <b>traits de sanidad en el baston</b>: si el tratamiento queda en el '
        'archivo de sesion, el baston puede llegar a ser la fuente del tratamiento y no solo del peso.')]

F += [S(10), Regla(ANCHO, CLARO, 1.1), S(4)]
F += [P('Documento de trabajo. La parte de la app esta verificada contra '
        '<b>template/potreros.template.html</b> y <b>tests/probar_caravana.js</b> en la rama '
        '<b>main-0i92w9</b>; la parte del SNIG y del baston es el diseño propuesto, sujeto a los seis '
        'puntos de la seccion 8.', st_pie)]

doc.build(F)
print('OK ->', SALIDA)
