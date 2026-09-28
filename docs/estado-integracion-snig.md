# Estado: integración SNIG + bastón XRS2 + app

Última actualización: **25/9/2026**. Rama: `main-0i92w9`.

Para retomar: leé "Dónde quedamos" y "Para arrancar mañana". El resto es
el registro de lo que se averiguó, para no volver a preguntarlo.

---

## Dónde quedamos

Los tres lectores están escritos y probados. El del SNIG ya corrió contra
el archivo real. **El del bastón, con el código nuevo, todavía no se
corrió nunca**, y `cruzar.py` tampoco: la pregunta que abrió todo esto
—si el `Dispositivo` del SNIG son de verdad los últimos 8 del EID— sigue
sin respuesta medida.

---

## Hechos confirmados

### El export del SNIG

- Se llama `.xls` pero **es una tabla HTML**. Los scripts lo detectan por
  los primeros bytes, no por la extensión. Abrirlo en Excel y guardarlo
  como CSV es lo que haría perder los ceros de la izquierda: no hace
  falta, el script lo lee directo.
- Columnas: `Dispositivo, Raza, Cruza, Sexo, Edad(meses), Edad (dias),
  Propietario, Ubicacion, Tenedor, Status de vida, Status de
  trazabilidad, Errores, Fecha ingreso a ubicacion actual, Documento de
  ingreso a ubicacion actual, Fecha identificacion, Fecha registro`.
- **No trae el número electrónico de 15 dígitos**, solo el visual de 8.
- Corrida real sobre `animales_202499_209202617_321.xls`:
  - 746 animales, **todos vivos**, todos con 8 dígitos, **sin ceros
    perdidos y sin repetidos**. La clave `(establecimiento, id8)` sirve.
  - 21 con `Errores: Si`, 5 `No Trazado`, 16 sin sexo o sin edad.
  - Los 746 bajo un solo código: `130563651`.
- No trae categoría: se deriva de `Sexo` + `Edad(meses)`. El SNIG no dice
  si un macho está castrado, así que **todos los machos de +3 años caen
  en "Novillos +3 años"** y los toros hay que descontarlos a mano.

### Los códigos (tenedores)

Formato: **numérico de 9 dígitos = tiene campo propio**; **prefijo FF =
no tiene campo**.

| código | quién | rol | export |
|---|---|---|---|
| `130563651` | La Vuelta (campo) / firma **Pedro Lanfranco** | tenedor y propietario | sí, el que ya bajamos |
| `FF0567061` | **Silvia Dutra** | propietaria **y tenedora**, sin campo | hay que bajarlo aparte |
| `FF0133347` | **Fideicomiso** | confirmar si es como Silvia | **sin acceso** |
| `130718973` | **Walter Lanfranco** | campo propio, ganado a pastoreo | **sin acceso**; se conocen sus 5 toros |
| `111000344` | María Laura | — | transitorio, confirmar |
| *(vacío)* | Pone Chico | — | sin DICOSE todavía |

**Consecuencia clave: los 746 NO son el stock de La Vuelta, son el stock
de la firma Pedro Lanfranco.** Silvia es tenedora, así que sus animales
están bajo su propio DICOSE aunque pastoreen en La Vuelta, y no salen en
ese export. Comparar los 746 contra el total de la app **da corto por
diseño**, no por un error.

### El bastón

Hay **dos formatos, y hay que leer los dos**: la app del celular solo ve
las sesiones cargadas desde el celular, así que elegir uno pierde
sesiones enteras.

**a) App de Datamars (celular), CON encabezado:**
`EID,VID,Date,Time,PROPIETARIO,GEN,CATEGORIA,RODEO,PRODUCTO,DOSIS,PRODUCTO2,POTRERO,DOSIS 2,ORIGEN,NOTA,PESO`

**b) Programa de Tru-Test (PC), SIN encabezado**, 14 columnas. Orden
deducido y verificado en 14 de 15 archivos:
`eid, vid, fecha, hora, propietario, categoria, gen, potrero, producto1,
producto2, dosis1, dosis2, origen, nota`

Lo que lo confirma: en `1078_BANO_MRODRIG` el campo `origen` queda en
`miguel` — comprados a Miguel Rodríguez, igual que el nombre del archivo.
**`1081_TERAS_G5` es el único que no encaja** y el script lo aísla solo.

El EID viene con 15 dígitos y el **VID casi siempre vacío**: el bastón no
confirma el número visual, así que el único puente con el SNIG son los
últimos 8 del EID.

### Vocabulario del bastón

- **`GEN` = último dígito del año de nacimiento** (5 = 2025, 0 = 2020).
- **`VAQ`** = vaquillona → el tramo (1-2 o 2-3 años) sale de `GEN`.
- **`VCUT`** = vaca última cría → se mapea a **"Vacas"** (no a "Vacas de
  invernada": esa ya salió de entore).
- `PROPIETARIO` viene como `PEDRO`, `SILVIA`, `FIDEICOMISO`.
- `ORIGEN` a veces trae de quién se compró (`miguel`, `richard r`).

---

## Lo que está hecho

Todo en `scripts/snig/`, sin dependencias, solo lee y escribe CSV. **No
toca Supabase ni la app.**

| archivo | qué hace |
|---|---|
| `leer_snig.py` | Lee el export, informa, escribe `tenedores_detectados.csv` |
| `leer_baston.py` | Lee los dos formatos, informa, escribe `padron_baston.csv`. `--crudo` vuelca las primeras líneas |
| `cruzar.py` | Cruza los dos por `id8` y da el veredicto. Escribe `c1_solo_snig.csv`, `c1_solo_baston.csv`, `cruzan.csv` |
| `tenedores.csv` | La tabla que traduce entre los tres vocabularios |

`tenedores.csv` traduce `codigo_snig` ↔ `firma_app` ↔ `propietario_baston`,
y con `tiene_export` separa las firmas que no se pueden conciliar de las
diferencias de verdad — si no, el ganado de Walter y del Fideicomiso
aparecería como "no figura a tu nombre" para siempre.

---

## Para arrancar mañana

```powershell
cd C:\Users\Pedro\repos\potreros
git pull
python scripts\snig\leer_baston.py
python scripts\snig\cruzar.py "C:\Users\Pedro\Downloads\animales_202499_209202617_321.xls"
```

**Correr el `git pull` ANTES del script** — dos veces se corrió al revés y
la salida fue de la versión vieja.

De esa salida importan tres cosas:

1. El **veredicto de `cruzar.py`**: qué porcentaje cruza. Con ≥95% el
   diseño sigue como está; abajo de eso hay que entender qué se pierde.
2. **"3b. Como queda cada categoria + GEN"**: si las categorías quedan
   como las diría Pedro.
3. La lista de **`POTRERO`**: tiene que coincidir con los nombres de los
   potreros de La Vuelta.

Recordar al mirar `c1_solo_baston.csv`: los animales de Silvia, del
Fideicomiso y de Walter van a aparecer ahí **y no son diferencias** —
falta su export, nada más.

---

## Lo que falta

**Para cerrar el paso 1:**
- [ ] Correr `leer_baston.py` y `cruzar.py` con el código actual.
- [ ] Ver las "Columnas del archivo que NO estoy usando" del SNIG: `Fecha
      ingreso a ubicacion actual` existe pero el lector no la reconoce, y
      el nombre real todavía no lo vimos.
- [ ] El **"📊 Stock total"** de la app, para ver contra qué comparar.

**Datos que faltan conseguir:**
- [ ] Export del SNIG de `FF0567061` (Silvia) — se entra al SNIG con **ese
      DICOSE y su contraseña**, no con el de Pedro.
- [ ] Las caravanas de los **5 toros de Walter** → van a un
      `padron_manual.csv`.
- [ ] Confirmar si el **Fideicomiso** es propietario y tenedor como Silvia.
- [ ] Confirmar el DICOSE real de **María Laura**.

**Después, el publicador:**
- [ ] Crear `animales_caravana` en Supabase **con política ALL** (SELECT
      para `anon`, más INSERT/UPDATE/DELETE para el publicador). Primero
      el schema, después el código — el antecedente de
      `productos_catalogo` sin UPDATE está en el CLAUDE.md.
- [ ] `publicar_animales.py`, primero solo con lo que ya tenemos.
- [ ] Tarea programada, igual que `actualizar_sanidad_supabase.py`.

**Deuda:**
- [ ] La sección 3 del PDF `docs/integracion-snig-xrs2-app.pdf` quedó
      vieja: decía `dicose` con barra y la clave es el código de 9
      dígitos o FF. Regenerar con `docs/generar_pdf_integracion.py`.
- [ ] Limpieza de git: la rama local tiene commits de merge que no están
      en GitHub, y cada `pull` arma otro. Ver `git log --oneline
      origin/main-0i92w9..HEAD`; si son todos "Merge branch...",
      `git reset --hard origin/main-0i92w9` y `git config pull.ff only`.

---

## Límites de diseño que no hay que cruzar

- **`animales_caravana` es solo de lectura para la app.** El stock se
  sigue armando con `eventos_sync` y nada más. Si el padrón escribiera en
  `estado.potreros` habría dos fuentes de verdad para el mismo número, y
  se separan el día que alguien mueva hacienda sin bastón. El `POTRERO`
  del bastón es referencia ("dónde lo vi la última vez"), no stock.
- **El peso va a `animales_caravana.ultimo_peso`**, no a `eventos_sync`:
  una pesada no cambia el stock y ensuciaría el replay.
- **Los códigos se comparan sin distinguir mayúsculas.** `ff0567061` y
  `FF0567061` son el mismo; el SNIG puede mandarlos de las dos formas.

---

## Errores ya cometidos en este trabajo

Para no repetirlos:

- **"No viene en el export" tapaba "no reconocí la columna".** El informe
  del SNIG decía que faltaba la fecha de ingreso cuando la columna
  estaba. Ahora lista las columnas que no usa. Es el mismo error que el
  `select` sin `potrero`: no falla, da otra cosa.
- **Los "17 encabezados distintos" del bastón eran 15 animales.** El
  lector tomaba la primera fila de datos como encabezado. El mensaje
  "sin columna eid" apuntaba a una causa equivocada.
- **Restar años calendario envejecía a los animales hasta 12 meses.** Una
  vaquillona generación 2024 leída en mayo de 2026 tiene 19 meses, y
  caía en "2-3 años". Se cuenta desde `MES_PARICION` (octubre).
- **Los `.pyc` se commitearon sin querer** y hacían un merge en cada
  pull. Ya están en `.gitignore`.
- **Se supuso que el ganado de Silvia estaría en el export de La Vuelta.**
  No: es tenedora, está bajo su propio DICOSE.
