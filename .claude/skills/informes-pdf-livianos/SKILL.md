---
name: informes-pdf-livianos
description: Producir informes en PDF y Word que Pedro pueda realmente mandar, por mail, por Drive o por WhatsApp, a un tercero (un proveedor, un técnico, el banco, un socio, el contador, el Plan Agropecuario). Usar SIEMPRE que pida "un informe", "un reporte", "algo para mandarle a", "pasámelo en PDF", "en Word por si lo quiero editar", "subilo a Drive y pasame el link", o cuando haya que adjuntar un documento a un correo. El problema que resuelve no es redactar, sino que un PDF armado de la manera obvia pesa 150 KB y NO SE PUEDE adjuntar ni subir desde acá, porque los archivos viajan carácter por carácter y se corrompen. Trae la receta para que salga de 30 KB con el mismo diseño, el checklist para revisarlo y cómo entregarlo verificando que llegó entero.
---

# Informes en PDF y Word que se puedan mandar

## El problema real

Un informe lindo no sirve si no se puede entregar. Los adjuntos de Gmail y las
subidas a Drive se mandan como base64 dentro de la llamada a la herramienta, o
sea que el modelo tiene que **transcribir el archivo entero carácter por
carácter**. Eso impone dos límites duros que conviene tener presentes desde antes
de empezar a maquetar:

- **Leer** el base64 desde Bash se corta arriba de ~30 KB por lectura (el harness
  lo manda a un archivo y sólo te muestra el principio). O sea que un archivo
  grande hay que leerlo partido.
- **Escribir** el base64 en la llamada tiene el límite de tokens de una
  respuesta, y —más importante— la probabilidad de equivocarse en un carácter
  crece con el largo. Con ~47.000 caracteres ya salió mal una vez y la API lo
  rechazó.

**La regla práctica: un archivo de hasta ~15 KB entra cómodo en una sola lectura
y se transcribe sin problemas. Hasta ~30 KB se puede, en dos partes, con
cuidado. Arriba de 60 KB, no lo intentes: rehacé el archivo más chico.**

Por eso el orden correcto es al revés de lo intuitivo: **primero asegurate de que
el formato va a dar chico, después maquetá**. Rehacer un informe de 78 KB porque
no entra en un adjunto cuesta mucho más que generarlo bien de entrada.

## Qué pesa en un PDF

Casi todo el peso son **las fuentes embebidas**. Un informe de 4 páginas de texto
tiene ~9 KB de contenido real; el resto son los tipos de letra. De ahí salen las
dos decisiones que hacen la diferencia:

1. **Subsetear las fuentes** a los caracteres que el documento realmente usa. Un
   informe en español usa ~100 glifos distintos. DejaVu Sans completa pesa 700 KB;
   subseteada a 100 glifos, 9 KB.
2. **Usar fpdf2, no Chromium.** `chromium --print-to-pdf` escribe los streams de
   texto posicionando glifo por glifo, y eso solo ya son 35 KB en 4 páginas.
   fpdf2 escribe texto normal y ocupa una fracción.

Resultado medido sobre el mismo informe de 4 páginas: Chromium 156 KB → con
Ghostscript 113 KB → con fuentes subseteadas 78 KB → **con fpdf2 29 KB**. Mismo
contenido, mismo diseño.

## Preparar el ambiente

```bash
pip install --quiet fpdf2 fonttools
apt-get update -q && apt-get install -y -q poppler-utils   # pdftoppm, para mirar el resultado
```

Si `import fpdf` falla con `_cffi_backend`, corré `pip install --upgrade cffi` y
volvé a probar; es un choque con el `cryptography` del sistema.

## Generar el PDF

### 1. Subsetear las fuentes

Sacá los caracteres del texto del propio documento, no de una lista inventada —
si falta un glifo aparece un cuadradito y no te enterás hasta que lo mirás.

```bash
python3 - <<'PY'
import re, html
texto = open('contenido.txt', encoding='utf-8').read()   # o el texto que vayas a maquetar
base   = ''.join(chr(c) for c in range(32, 127))         # ASCII imprimible, SIEMPRE
extra  = '•→—–·""''…áéíóúñüÁÉÍÓÚÑÜ¡¿ºª€'                 # acentos y signos del español
chars  = sorted(set(texto + base + extra) - set('\n\r\t'))
open('glifos.txt','w',encoding='utf-8').write(''.join(chars))
print(len(chars), 'glifos')
PY

D=/usr/share/fonts/truetype/dejavu
mkdir -p fuentes
for par in "DejaVuSans:sans" "DejaVuSans-Bold:sansb"; do
  src=${par%%:*}; out=${par##*:}
  pyftsubset $D/$src.ttf --text-file=glifos.txt --output-file=fuentes/$out.ttf \
    --layout-features='' --no-hinting \
    --drop-tables+=GSUB,GPOS,DSIG,LTSH,VDMX,hdmx,gasp
done
```

**Incluí siempre el ASCII imprimible completo**, aunque el texto que tengas a
mano no lo use. Si falta un carácter, fpdf2 no falla: avisa por `stderr`
(`Font ... is missing the following glyphs`) y lo dibuja como nada. En una prueba
faltaba el guion común y el pie de página decía `informespdflivianos` en vez de
`informes-pdf-livianos`, sin ningún error. **Tratá ese aviso como un error**: si
aparece, agregá el carácter y volvé a subsetear.

Dos caras (normal y negrita) alcanzan para un informe. **Evitá la monoespaciada**:
es una fuente entera (~8 KB) que normalmente sólo se usa para un diagrama de
flechas, y ese diagrama se lee igual o mejor con la tipografía común, como una
lista con flechas verdes.

### 2. Maquetar

`scripts/informe.py` trae los bloques armados —título, secciones, párrafos con
**negrita** en línea, viñetas, tablas con encabezado y filas alternas, recuadros
destacados y la fila de números grandes— ya con los dos defectos de abajo
corregidos. Importalo y escribí sólo el contenido:

```python
import sys; sys.path.insert(0, 'scripts')
from informe import Informe

doc = Informe('fuentes', titulo='Sensor de nivel del tanque australiano',
              subtitulo='Qué estamos haciendo en el campo y dónde entra el sensor')
doc.meta([('Establecimiento: ', 'La Vuelta — Rivera'), ('Fecha: ', '17/09/2026')])
doc.h1('1. Para qué les escribimos')
doc.p('En el campo el agua es el factor que **manda sobre el pastoreo**...')
doc.kpis([('81','PUNTOS','RELEVADOS'), ('4','TANQUES','')])
doc.tabla([38,70,70], [['', 'App A', 'App B'], ['Qué resuelve', '...', '...']], primera_negrita=True)
doc.vinetas(['**Mapa real** con los polígonos de cada potrero.', '...'])
doc.recuadro(lambda: doc.vinetas(['...']), titulo='Lo que necesitaríamos', color='naranja')
doc.pie('Establecimiento La Vuelta — Rivera, Uruguay · 17/09/2026')
doc.guardar('informe.pdf')
```

### 3. Mirar todas las páginas — esto no se saltea

```bash
pdftoppm -jpeg -r 72 informe.pdf pag && ls pag-*.jpg
```

Y después **abrí cada imagen y miralas**. No alcanza con que el script no dé
error: los dos defectos que aparecieron la primera vez eran invisibles en el
código y saltaban a la vista en la imagen.

- **Filas alternas de una tabla en verde oscuro sobre texto oscuro, ilegibles.**
  fpdf2 pinta las filas con el color de relleno vigente, no con el que le pasaste
  en `cell_fill_color`. Si justo antes dibujaste un recuadro con acento verde,
  la tabla hereda ese verde. `informe.py` fija el color antes de cada tabla.
- **Una viñeta sola al pie de una página y su texto en la siguiente.** Pasa si
  dibujás el puntito y después el texto: el salto de página lo dispara el texto,
  cuando el puntito ya quedó escrito arriba. `informe.py` mide el alto del texto
  con `offset_rendering()` **antes** de dibujar y decide el salto ahí.
- **Páginas en blanco.** Si aparece una, casi siempre es un `add_page()` manual
  compitiendo con el salto automático. Sacá el manual y dejá que fpdf2 decida, o
  usá `will_page_break(alto)`.

Verificá también el conteo de páginas y que no haya páginas casi vacías:

```bash
for p in 1 2 3 4; do echo "pag $p: $(pdftotext -f $p -l $p informe.pdf - | grep -c .) lineas"; done
```

## Generar el Word

Cuando Pedro pide "también en Word por si lo quiero editar", el .docx es el
documento maestro editable y pesa poco (~15 KB), así que no tiene el problema del
PDF. Se arma con `docx` de npm (`require('docx')`, ya instalado o
`npm install docx`). Los detalles de esa librería están en la skill `docx`; lo que
importa acá:

- Las tablas necesitan `columnWidths` en la tabla **y** `width` en cada celda,
  las dos en `WidthType.DXA`, y los anchos tienen que sumar el ancho de la tabla.
- Sombreado con `ShadingType.CLEAR`, nunca `SOLID` (sale negro).
- Las viñetas van con una config de `numbering`, nunca con un `•` literal.
- Nada de `\n`: un `Paragraph` por renglón.
- Validalo antes de entregar:
  `python3 <skill-docx>/scripts/office/validate.py informe.docx`

Ojo: **LibreOffice puede no estar instalado** en este ambiente (`soffice` existe
pero sin el módulo Writer), así que no cuentes con convertir .docx → PDF para
verificar. Verificá el .docx extrayendo su texto con `zipfile` + `ElementTree`
sobre `word/document.xml` y comprobando que estén todos los párrafos y viñetas.

## Entregar

### Por mail (Gmail)

Un adjunto de ~15 KB se transcribe bien. Codificá y leé el base64 de una:

```bash
base64 -w0 informe.docx | wc -c    # si da menos de ~25.000, entra en una lectura
```

Después de mandar, verificá con `get_message` (formato `MINIMAL`): el
`sizeEstimate` tiene que ser coherente con el tamaño del adjunto.

### Por Drive

`create_file` con `contentMimeType`, `base64Content` y
**`disableConversionToGoogleType: true`**. Sin ese flag, subir un .docx falla con
"Request contains an invalid argument" porque intenta convertirlo a Google Doc.

Verificá siempre después de subir, de estas dos maneras:

1. El `fileSize` que devuelve tiene que coincidir **exactamente** con el tamaño
   local. Si no coincide, algo se transcribió mal.
2. Pedile a Drive que te lea el archivo con `read_file_content`. Si devuelve el
   texto completo y con los acentos bien, el documento está sano aunque el
   tamaño baile por unos bytes.

Si la API contesta "The file content is not a valid base64 string", la
transcripción se rompió: **no reintentes a ciegas**, achicá el archivo y volvé a
intentar con menos caracteres.

### Siempre, además

Mandale el archivo a Pedro por `SendUserFile` aunque también lo hayas subido a
algún lado. Es la vía que nunca falla y le sirve para adjuntarlo él mismo.

## Sobre el contenido

El formato es la mitad; la otra mitad es que el informe le sirva al que lo lee.
Para un tercero que no conoce el campo:

- Abrí con **por qué le estás escribiendo**, en lenguaje llano, antes de cualquier
  detalle técnico. Un párrafo que explique el problema real del campo vale más que
  tres de especificaciones.
- Poné los **números concretos** que ya tenés (cantidad de puntos, metros, hectáreas,
  cabezas). Dan credibilidad y evitan la conversación de "¿de qué tamaño es esto?".
- Si le estás pidiendo algo, hacelo **explícito y ordenado por importancia**, en su
  propio recuadro. Y decí también qué **no** necesitás de ellos: baja la barrera.
- Cerrá con un próximo paso chico y concreto.
- No pongas datos que no hagan falta: claves, tokens, coordenadas exactas del
  establecimiento. Va a un tercero.
