# -*- coding: utf-8 -*-
"""Bloques de maquetado para informes en PDF con fpdf2.

Existe para no reescribir cada vez el encabezado, las tablas y los recuadros, y
sobre todo para no volver a caer en dos defectos que no se ven en el código y sí
en la página impresa:

  * fpdf2 pinta las filas alternas de una tabla con el color de relleno VIGENTE,
    no con el que se le pasa en cell_fill_color. Si venís de dibujar un recuadro
    con acento verde, la tabla hereda ese verde y el texto queda ilegible.
    Por eso tabla() fija el color justo antes.

  * Una viñeta dibuja primero el punto y después el texto. Si el salto de página
    lo dispara el texto, el punto ya quedó escrito al pie de la página anterior y
    aparece huérfano. Por eso vinetas() mide el alto con offset_rendering() ANTES
    de dibujar nada y decide el salto ahí.

Uso mínimo:

    from informe import Informe
    doc = Informe('fuentes', titulo='...', subtitulo='...')
    doc.h1('1. Sección'); doc.p('Texto con **negrita**.')
    doc.guardar('informe.pdf')

Espera un directorio con sans.ttf y sansb.ttf ya subseteadas (ver SKILL.md).
"""

from fpdf import FPDF
from fpdf.fonts import FontFace
from fpdf.enums import TableCellFillMode, TableBordersLayout

VERDE   = (27, 94, 32)
VERDE2  = (46, 92, 50)
ACENTO  = (46, 125, 50)
GRIS    = (90, 107, 92)
TEXTO   = (29, 43, 31)
SUBT    = (65, 96, 63)
BG_ENC  = (232, 245, 233)   # encabezado de tabla
BG_ALT  = (247, 251, 247)   # filas alternas
BG_CAJA = (244, 250, 244)
BG_NAR  = (255, 248, 241)
BORDE   = (217, 232, 218)
BORDE2  = (200, 230, 201)
NARANJA = (230, 81, 0)

PALETA = {
    'verde':   dict(bg=BG_CAJA, accent=ACENTO,  border=BORDE2,          titulo=VERDE),
    'naranja': dict(bg=BG_NAR,  accent=NARANJA, border=(255, 224, 178), titulo=NARANJA),
    'neutro':  dict(bg=BG_CAJA, accent=BORDE2,  border=BORDE2,          titulo=VERDE),
}


class Informe:
    def __init__(self, dir_fuentes, titulo=None, subtitulo=None,
                 autor=None, ancho_util=178.0, margen=16.0):
        self.W = ancho_util
        self.M = margen
        pdf = FPDF(orientation='P', unit='mm', format='A4')
        pdf.set_auto_page_break(True, margin=16)
        pdf.set_margins(margen, 18, margen)
        pdf.add_font('rs', '',  f'{dir_fuentes}/sans.ttf')
        pdf.add_font('rs', 'B', f'{dir_fuentes}/sansb.ttf')
        if titulo:
            pdf.set_title(titulo)
        if autor:
            pdf.set_author(autor)
        pdf.add_page()
        self.pdf = pdf
        if titulo:
            self.portada(titulo, subtitulo)

    # ── piezas ────────────────────────────────────────────────
    def portada(self, titulo, subtitulo=None):
        p = self.pdf
        y0 = p.get_y()
        alto = 13.5 if subtitulo else 9.0
        p.set_fill_color(*ACENTO)
        p.rect(self.M, y0, 1.6, alto, style='F')
        p.set_xy(self.M + 4.5, y0)
        p.set_font('rs', 'B', 19); p.set_text_color(*VERDE)
        p.cell(0, 8.6, titulo, new_x='LMARGIN', new_y='NEXT')
        if subtitulo:
            p.set_xy(self.M + 4.5, p.get_y())
            p.set_font('rs', '', 11); p.set_text_color(*SUBT)
            p.cell(0, 5.4, subtitulo, new_x='LMARGIN', new_y='NEXT')
        p.ln(4.2)

    def meta(self, pares, size=8.8):
        """Línea de datos 'Etiqueta: valor · Etiqueta: valor', que corta sola."""
        p = self.pdf
        for i, (etiqueta, valor) in enumerate(pares):
            p.set_font('rs', 'B', size); we = p.get_string_width(etiqueta)
            p.set_font('rs', '',  size); wv = p.get_string_width(valor)
            corta = p.get_x() + we + wv > self.M + self.W
            if corta:
                p.ln(size * 0.5); p.set_x(self.M)
            elif i:
                # el separador se dibuja ANTES del ítem, no después: así un corte
                # de renglón no deja un '·' colgando al final de la línea anterior
                p.set_font('rs', '', size); p.set_text_color(*GRIS)
                p.cell(p.get_string_width('   ·   '), 4.4, '   ·   ')
            p.set_font('rs', 'B', size); p.set_text_color(*VERDE2)
            p.cell(we, 4.4, etiqueta)
            p.set_font('rs', '', size); p.set_text_color(*GRIS)
            p.cell(wv, 4.4, valor)
        p.ln(4.8)

    def h1(self, texto):
        p = self.pdf
        if p.will_page_break(18):
            p.add_page()
        p.ln(2.4)
        p.set_font('rs', 'B', 12.5); p.set_text_color(*VERDE)
        p.cell(0, 6, texto, new_x='LMARGIN', new_y='NEXT')
        y = p.get_y() + 0.6
        p.set_draw_color(165, 214, 167); p.set_line_width(0.5)
        p.line(self.M, y, self.M + self.W, y)
        p.ln(2.5)

    def h2(self, texto):
        p = self.pdf
        p.ln(1.6)
        p.set_font('rs', 'B', 10.6); p.set_text_color(*VERDE2)
        p.cell(0, 5.4, texto, new_x='LMARGIN', new_y='NEXT')
        p.ln(1.0)

    def p(self, texto, size=10, align='J', alto=4.55, despues=1.8):
        """Párrafo. Acepta **negrita** en línea (markdown de fpdf2)."""
        p = self.pdf
        p.set_font('rs', '', size); p.set_text_color(*TEXTO)
        p.multi_cell(self.W, alto, texto, align=align, markdown=True,
                     new_x='LMARGIN', new_y='NEXT')
        if despues:
            p.ln(despues)

    def vinetas(self, items, size=10, sangria=4.0, pad_der=0.0, alto=4.45):
        """Cada viñeta decide el salto de página ANTES de dibujar el punto, para
        que no quede huérfano al pie con su texto en la página siguiente."""
        p = self.pdf
        ancho = self.W - sangria - 3.2 - pad_der
        p.set_text_color(*TEXTO)
        for it in items:
            p.set_font('rs', '', size)
            y_ref = p.get_y()
            with p.offset_rendering() as seco:
                p.set_xy(self.M + sangria + 3.2, y_ref)
                p.multi_cell(ancho, alto, it, align='J', markdown=True,
                             new_x='LMARGIN', new_y='NEXT')
                necesita = p.get_y() - y_ref
            if seco.page_break_triggered or p.will_page_break(necesita):
                p.add_page()
            y0 = p.get_y()
            p.set_xy(self.M + sangria, y0); p.cell(3.2, alto, '•')
            p.set_xy(self.M + sangria + 3.2, y0)
            p.multi_cell(ancho, alto, it, align='J', markdown=True,
                         new_x='LMARGIN', new_y='NEXT')
            p.ln(0.5)

    def tabla(self, anchos, filas, primera_negrita=False, col_derecha=(), size=9.2):
        """anchos en mm, deben sumar el ancho útil. filas[0] es el encabezado."""
        p = self.pdf
        p.set_fill_color(*BG_ALT)      # fpdf2 usa el fill vigente para las alternas
        encabezado = FontFace(emphasis='BOLD', color=VERDE, fill_color=BG_ENC)
        bordes = TableBordersLayout.ALL
        with p.table(col_widths=anchos, width=sum(anchos), line_height=4.6,
                     text_align='LEFT', padding=(1.5, 2.0, 1.5, 2.0),
                     headings_style=encabezado, cell_fill_color=BG_ALT,
                     cell_fill_mode=TableCellFillMode.ROWS,
                     borders_layout=bordes) as t:
            p.set_draw_color(*BORDE); p.set_line_width(0.15)
            p.set_font('rs', '', size); p.set_text_color(*TEXTO)
            for ri, fila in enumerate(filas):
                row = t.row()
                for ci, celda in enumerate(fila):
                    estilo = (FontFace(emphasis='BOLD')
                              if ri > 0 and primera_negrita and ci == 0 else None)
                    row.cell(str(celda), style=estilo,
                             align='RIGHT' if (ri > 0 and ci in col_derecha) else 'LEFT')
        p.ln(2.0)

    def kpis(self, items, alto=15.0):
        """Fila de números grandes: [(valor, linea1, linea2), ...]"""
        p = self.pdf
        p.ln(1.0)
        y = p.get_y(); ancho = self.W / len(items)
        for i, (valor, l1, l2) in enumerate(items):
            x = self.M + i * ancho
            p.set_fill_color(*BG_CAJA); p.set_draw_color(*BORDE2); p.set_line_width(0.2)
            p.rect(x + 0.6, y, ancho - 1.2, alto, style='DF')
            p.set_xy(x + 0.6, y + 2.0)
            p.set_font('rs', 'B', 15); p.set_text_color(*VERDE)
            p.cell(ancho - 1.2, 6.2, str(valor), align='C')
            p.set_font('rs', '', 6.2); p.set_text_color(*GRIS)
            p.set_xy(x + 0.6, y + 8.4);  p.cell(ancho - 1.2, 2.9, l1.upper(), align='C')
            p.set_xy(x + 0.6, y + 11.1); p.cell(ancho - 1.2, 2.9, l2.upper(), align='C')
        p.set_y(y + alto); p.ln(3.4)

    def recuadro(self, cuerpo, titulo=None, color='verde', pad=3.4):
        """Recuadro con borde izquierdo de color. `cuerpo` es una función sin
        argumentos que dibuja el contenido; se la llama dos veces (una en seco
        para medir el alto, otra de verdad), así que no debe tener efectos
        colaterales fuera del PDF."""
        p = self.pdf
        c = PALETA[color]

        def dibujar():
            if titulo:
                p.set_x(self.M + pad)
                p.set_font('rs', 'B', 10.6); p.set_text_color(*c['titulo'])
                p.multi_cell(self.W - 2 * pad, 5.2, titulo,
                             new_x='LMARGIN', new_y='NEXT')
                p.ln(1.0)
            cuerpo()

        def medir():
            y0 = p.get_y()
            with p.offset_rendering() as seco:
                p.set_xy(self.M + pad, y0 + pad)
                dibujar()
                y1 = p.get_y()
            return y0, y1, seco.page_break_triggered

        y0, y1, se_pasa = medir()
        if se_pasa:
            p.add_page()
            y0, y1, _ = medir()
        alto = y1 - y0 + pad
        p.set_fill_color(*c['bg']); p.set_draw_color(*c['border']); p.set_line_width(0.2)
        p.rect(self.M, y0, self.W, alto, style='DF')
        p.set_fill_color(*c['accent'])
        p.rect(self.M, y0, 1.2, alto, style='F')
        p.set_xy(self.M + pad, y0 + pad)
        dibujar()
        p.set_y(y0 + alto); p.ln(2.2)

    def flujo(self, origen, nota, salidas):
        """Diagrama simple 'origen → consecuencias', en tipografía normal.
        Se lee igual que el arte ASCII y ahorra embeber una fuente monoespaciada
        entera (~8 KB), que en un informe de 30 KB es una cuarta parte."""
        p = self.pdf

        def cuerpo():
            p.set_x(self.M + 3.4); p.set_font('rs', '', 9.6); p.set_text_color(*TEXTO)
            p.multi_cell(self.W - 6.8, 4.6, origen, markdown=True,
                         new_x='LMARGIN', new_y='NEXT')
            if nota:
                p.set_x(self.M + 3.4); p.set_font('rs', '', 8.6); p.set_text_color(*GRIS)
                p.multi_cell(self.W - 6.8, 4.0, nota, new_x='LMARGIN', new_y='NEXT')
            p.ln(1.2)
            for s in salidas:
                y = p.get_y()
                p.set_xy(self.M + 9.0, y)
                p.set_font('rs', 'B', 9.4); p.set_text_color(*ACENTO)
                p.cell(5.0, 4.4, '→')
                p.set_xy(self.M + 14.0, y)
                p.set_font('rs', '', 9.4); p.set_text_color(*TEXTO)
                p.multi_cell(self.W - 17.4, 4.4, s, new_x='LMARGIN', new_y='NEXT')
                p.ln(0.4)

        self.recuadro(cuerpo, color='neutro')

    def pie(self, texto, size=8.4):
        p = self.pdf
        p.ln(4)
        y = p.get_y()
        p.set_draw_color(*BORDE2); p.set_line_width(0.2)
        p.line(self.M, y, self.M + self.W, y)
        p.ln(1.8)
        p.set_font('rs', '', size); p.set_text_color(107, 125, 109)
        p.multi_cell(self.W, 4.0, texto, new_x='LMARGIN', new_y='NEXT')

    def guardar(self, ruta):
        self.pdf.output(ruta)
        return self.pdf.pages_count
