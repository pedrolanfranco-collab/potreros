# Recuperación de WhatsApp en Hermes — 6/11/2026

## Qué se comprobó

El gateway seguía vivo desde el 4/11. El 6/11 recibió un mensaje a las 08:50,
produjo una respuesta a las 09:09 y falló al enviarla, incluido el segundo intento
a las 09:11. El puente Node acumulaba desconexiones 428/503 y conexiones locales
en CLOSE_WAIT. Su `/health` no respondió en ocho segundos. El archivo de estado
todavía mostraba el `connected` del 4/11.

El origen exacto del bloqueo de Node no quedó demostrado: los códigos de cierre
no permiten distinguir por sí solos red, servicio de WhatsApp o librería Baileys.
Los dos comandos internos que agotaron 300 segundos explican parte de la demora
de procesamiento; no prueban el origen de la falla de transporte.

Sí se verificó el defecto que prolongaba la caída: `_poll_messages()` en el
adaptador instalado reintentaba para siempre ante errores mientras el proceso
Node siguiera vivo. No avisaba al mecanismo de recuperación del gateway.
Está reportado en el proyecto: https://github.com/NousResearch/hermes-agent/issues/80091.
Relacionado: https://github.com/NousResearch/hermes-agent/issues/63277.

El reinicio recuperó la conexión y Hermes reenvió la respuesta pendiente.

## Arreglo local

`scripts/hermes/preparar_watchdog.py` prepara un parche sobre la versión instalada
(0.21.3, commit reportado `69fd61b0efbe2bf7f412714ed8c35e40dfddc534`).
Agrega una tarea independiente del procesamiento de mensajes al adaptador:

- Consulta `/health` cada 10 segundos con límite de tiempo.
- Publica `retrying` al detectar una falla, en lugar de conservar `connected`.
- Tres consultas fallidas consecutivas activan un error recuperable. Un puente
  colgado se detecta normalmente en unos 30–40 segundos, más la reconexión.
- HTTP 200 con estado desconectado tampoco cuenta como saludable: deja un margen
  de 120 segundos para que Baileys reconecte antes de pedir recuperación.
- Una recuperación temporal pone el contador a cero y restaura el estado.
- Al desconectar se cancela también la tarea de vigilancia.

El callback existente del gateway marca la plataforma como fallida, conserva la
cola de recuperación, desconecta el adaptador y activa su reconexión con espera
progresiva. El parche no agrega otro mecanismo de matar procesos ni borra la
sesión de WhatsApp. No hace consultas al modelo ni envía mensajes de prueba.

## Preparación, prueba e instalación

Desde la raíz del repo, con Python y el Python del entorno de Hermes:

```powershell
python scripts/hermes/preparar_watchdog.py
& "$env:USERPROFILE/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" scripts/hermes/test_watchdog.py
python scripts/hermes/preparar_watchdog.py --instalar
```

Preparar escribe el adaptador y el diff en `scripts/hermes/watchdog_preparado/`
(salidas ignoradas por Git). Instalar exige que el original siga teniendo el
mismo SHA-256 que cuando se preparó y que coincida con el resultado probado.
Conserva el original como `adapter.py.pre-watchdog-<hash>` y reemplaza el archivo
atómicamente. Un código diferente requiere revisión: no aplica a ciegas.

Las nueve pruebas usan el adaptador real preparado y un servidor HTTP local bajo
un `HERMES_HOME` temporal: servicio sano sin mensajes, HTTP 500 persistente,
recuperación tras dos errores, servidor colgado, desconexión prolongada y breve,
respuesta inválida, parada intencional y cancelación/limpieza al desconectar.
No usan la conexión de WhatsApp de Pedro. Pasaron las nueve el 6/11.

Después de instalar hay que reiniciar el gateway para cargar el código nuevo y
verificar `/health`, el nuevo PID y la fecha de conexión. No basta el texto
`connected` de un archivo viejo.

Aplicado el 6/11: respaldo `adapter.py.pre-watchdog-b7fae2a8a3ab`.
El reinicio posterior terminó con `drained cleanly`, gateway nuevo PID 6488 y
conexión confirmada a las 09:50:32. La consulta directa a `/health` contestó
`connected`, cola 0; el gateway recibió un mensaje y preparó su respuesta en
22,3 segundos. No se provocó una falla en el WhatsApp de producción para probar
la recuperación: el fallo se reprodujo únicamente con el servidor descartable.

## Límites y mantenimiento

Este arreglo evita que este tipo de bloqueo quede indefinidamente sin atención;
no puede impedir cortes de Internet o del servicio de WhatsApp. Necesita que el
proceso Python del gateway siga atendiendo su bucle de eventos. Tampoco convierte
las tareas internas lentas en rápidas.

Es un parche local al adaptador instalado. Una actualización de Hermes puede
reemplazarlo: revisar si la versión nueva incorpora el arreglo oficial antes de
volver a preparar/aplicar. El instalador se niega a pisar un watchdog ya presente.
Para revertir, restaurar la copia original correspondiente y reiniciar Hermes.
