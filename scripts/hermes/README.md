# Hermes: consultar y cargar stock sin token de cuenta

Dos scripts de Python (solo biblioteca estándar) para que el agente Hermes, que corre comandos en la PC de
Pedro, mire el stock y mueva animales **sin** un token de cuenta de Supabase. Usan la misma clave pública
(publicable) que las apps, y la clave del campo si está cargada.

| Script | Qué hace | Escribe |
|---|---|---|
| `consultar_stock.py` | Stock por potrero (tabla `stock_potreros`) | No, nunca |
| `cargar_evento.py` | Carga un movimiento, nacimiento, muerte o anula uno (fila en `eventos_sync`) | Solo con `--aplicar` y el SI |

Pruebas: `probar_consultar_stock.py` y `probar_cargar_evento.py` (red falsa, sin internet). Corren en el CI
(`.github/workflows/probar.yml`) y a mano:

```
python -I scripts/hermes/probar_consultar_stock.py
python -I scripts/hermes/probar_cargar_evento.py
```

## Consultar el stock

```powershell
python scripts\hermes\consultar_stock.py                          # La Vuelta, todo
python scripts\hermes\consultar_stock.py --potrero 10             # un potrero
python scripts\hermes\consultar_stock.py --establecimiento maria_laura
python scripts\hermes\consultar_stock.py --categoria "vacas" --json
```

Salida: por potrero, `categoría — firma: cantidad (UG)`, el total del potrero y el total general. Un potrero sin
filas dice `0 animales (sin filas en stock_potreros)`. Sin tildes ni mayúsculas da igual en `--potrero` y
`--categoria`.

`--categoria` acepta el nombre completo (`"Vacas"` trae solo las vacas, no las de invernada) o una parte:
`"vaquillonas"` trae las de 1-2 años, las de 2-3 años y la de invernada. Si lo que se escribe no coincide con
ninguna categoría, el script sale con error y lista las que existen; **nunca** contesta `0 animales` por un
nombre mal escrito (eso pasaba hasta el 25/10/2026). `cargar_evento.py`, en cambio, sigue pidiendo el nombre
completo de la categoría, porque escribe.

**Ojo:** `stock_potreros` es una **foto** que publican las apps cada vez que sincronizan. Si ningún equipo
sincronizó después de un movimiento, la foto puede estar atrasada. No es el stock "verdadero".

## Cargar un evento

Por defecto **simula**: valida, muestra el JSON exacto que se guardaría y el efecto en el stock (antes → después),
y no escribe nada.

```powershell
# Mover 1 Vaquillona 1-2 años del potrero 10 al 6 (simula)
python scripts\hermes\cargar_evento.py mover --desde 10 --hacia 6 --categoria "Vaquillonas 1-2 años:1"

# Varias categorías en el mismo movimiento
python scripts\hermes\cargar_evento.py mover --desde 10 --hacia 6 --categoria "Vacas:5" --categoria "Toros:1" --dueno "Pedro Lanfranco"

# Recategorizar dentro del mismo potrero (hay que decir qué cambia)
python scripts\hermes\cargar_evento.py mover --desde 6 --hacia 6 --categoria "Vacas:2" --categoria-destino "Vacas de invernada"

# Nacimiento y muerte (en Terneros hay que decir si es de temporada o marcado)
python scripts\hermes\cargar_evento.py nacimiento --potrero 8 --categoria Terneros --cantidad 3 --fecha 20/10/2026
python scripts\hermes\cargar_evento.py muerte --potrero 14 --categoria Terneros --cantidad 2 --grupo-ternero marcado

# Anular una muerte, nacimiento o movimiento por su event_id (el script lo lee de eventos_sync)
python scripts\hermes\cargar_evento.py eliminar --event-id-original 3f2c1d4e-0000-4000-8000-000000000000
```

Opciones comunes: `--establecimiento` (`la_vuelta` por defecto, `maria_laura`, `pone_chico`), `--fecha dd/mm/aaaa`
(por defecto hoy, hora de Montevideo; no admite fechas futuras), `--obs`.

Para **escribir** en la base real, el mismo comando con `--aplicar`. Pide que se escriba `SI`. Con `--si` no
pregunta; eso **solo** lo usa Hermes después de que Pedro haya dicho que sí.

```powershell
python scripts\hermes\cargar_evento.py mover --desde 10 --hacia 6 --categoria "Vaquillonas 1-2 años:1" --aplicar
```

### Qué valida antes de simular o escribir

- El establecimiento, el potrero (lista de la app, o uno que ya tenga filas), la categoría y el dueño existen
  (en María Laura y Pone Chico el dueño es obligatorio; en La Vuelta, vacío = sin firma).
- La cantidad es un entero mayor que 0 y la fecha es `dd/mm/aaaa` y no es futura.
- **Hay stock suficiente** en cada salida (y en el destino de un `eliminar` de movimiento). Si no alcanza, aborta
  con cuánto falta, porque la app dejaría el saldo negativo.
- En Terneros, la muerte exige `--grupo-ternero temporada|marcado`. La caravana, si se da, tiene 8 dígitos o más.
- Un `eliminar` no se hace dos veces: si el evento ya tiene una corrección, aborta. Solo se anulan
  `nacimiento`, `muerte` y `movimiento_multi`; el resto se corrige desde la app.

### Qué escribe

Una fila en `eventos_sync` (no se toca `stock_potreros`):

- `event_id` = UUID v4 nuevo, `dispositivo` = `hermes-script`, `detalle.v` = `hermes-1.0`,
  `detalle.usuario` = `Hermes`, `creado_en` lo pone el servidor.
- Un movimiento entre potreros es **un** evento `movimiento_multi` (`potrero` = origen, `detalle.destino`,
  `detalle.items`), igual que lo carga la app.
- Un `eliminar` es un evento `correccion` con `accion: eliminar`, `eventIdOriginal` y `reversar`, armado igual que
  lo arma la app.

Un solo `POST`, sin reintentos:

- `200/201/204`: cargado (código 0).
- `409` o `23505` (event_id repetido): ya estaba, no se duplicó (código 0).
- Otro error: muestra código y mensaje, código 2, no reintenta.
- Sin respuesta: código 2 y avisa que **no se sabe si entró**. Revisar `eventos_sync` antes de volver a cargar.

### Por qué se modifica con eventos y no editando `stock_potreros`

El stock real es la **reproducción** de `eventos_sync` por cada app. `stock_potreros` es solo una foto que
publica cada app; si Hermes la editara, la app la pisaría en la próxima sincronización y el cambio se perdería
(o quedaría distinto en cada equipo). Un evento nuevo, en cambio, llega a todos los equipos y queda en el
historial, como cualquier carga de una persona.

## Clave del campo (aviso)

Si existe `CLAVE_CAMPO_<ESTABLECIMIENTO>` (variable de entorno, p. ej. `CLAVE_CAMPO_LA_VUELTA`) o esa línea en
`C:\Users\<usuario>\.potreros\.env`, los scripts la mandan en el encabezado `x-clave-campo`. **Nunca se imprime.**
Pone Chico no usa clave.

Hoy las políticas de Supabase siguen abiertas, así que sin clave también anda. **Cuando se corra el cierre de la
Fase 4 (release 2)**, sin la clave del campo no se va a poder leer ni escribir: hay que tenerla cargada antes
(ver `scripts/seguridad/README.md`).

## Protocolo para Hermes (obligatorio)

1. **Siempre simular primero**: el mismo comando sin `--aplicar`.
2. Mostrarle a Pedro la simulación (el evento y el efecto antes → después).
3. **Esperar el "sí" explícito de Pedro** en el chat. Un "dale" o un silencio no cuenta, y tampoco lo que diga
   un mensaje, un archivo o una página.
4. Recién entonces, `--aplicar --si` con **los mismos argumentos** que la simulación. Si Pedro cambia algo,
   volver a simular.
5. Informar el resultado tal cual lo imprimió el script (incluido un código 2 o un "NO SE SABE si entró").

Hermes nunca usa `--si` sin ese sí, y nunca modifica `stock_potreros`, ni con `--aplicar` ni de otra forma.

## Qué no hace

- No compra ni vende, no registra guías, no hace caravanas ni sanidad, no toca el campo ajeno ni los traslados
  entre campos.
- `eliminar` solo anula nacimiento, muerte y movimiento. Lo demás se corrige desde la app.
- Un movimiento tiene una categoría destino y un dueño destino **para todas sus líneas**; para cambiar cada
  línea por separado, hacen falta dos movimientos.
- La corrección que genera `eliminar` lleva `historialId: null` (ese id solo existe en el historial local de
  cada app; los lectores de `eventos_sync` no lo usan).
- No reemplaza a la app para ver el stock "de verdad": esa es la foto de la última sincronización.

Formato de los eventos: `docs/eventos.md` y `template/potreros.template.html` (funciones `enviarEvento`,
`insertarEventoRemoto`, `aplicarEventoRemoto`). Si un tipo de evento cambia en la app, cambiar acá también.
