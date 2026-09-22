# Revisión del plan de auditoría Supabase — apps de potreros

Fecha: 21/9/2026

Respuesta al "Plan de Auditoría y Optimización Supabase — Sistema Potreros"
propuesto, después de verificar los puntos clave contra el código real de
`template/potreros.template.html`.

## Lo que sí implementaría (bajo riesgo, corrige algo real)

- **Concurrencia en `publicarStockPotreros`** — confirmado: en la primera
  sincronización dispara `Promise.all` sobre los 31 potreros de La Vuelta sin
  ningún límite de concurrencia (`potreros.template.html:1223`). Batchear de a
  4-6 en lugar de todos de golpe es una mejora chica y segura para conexiones
  móviles lentas.

- **`'muerte_desaparecido'` faltante en `calcularEstadisticasNacimientos`** —
  confirmado: esa query sí trae `'muerte'` en su `.in('tipo', [...])` pero no
  `'muerte_desaparecido'`, mientras que `calcularEstadisticasMuertes` sí lo
  tiene (comparar líneas ~3753 vs ~3885 del template, y sus copias móvil en
  ~5642/~5747). Antes de agregar el tipo que falta conviene entender *por qué*
  la función de nacimientos necesita `'muerte'` en su propia query — probablemente
  sea una inconsistencia real, pero el arreglo en sí es de una línea.

- **Logging de errores más claro en `sincronizar()`** (`console.warn` con el
  detalle del error de Supabase) — gratis, sin riesgo, mejora el diagnóstico
  cuando algo falla en el campo.

## Lo que NO haría, o haría con mucha cautela

- **El `DELETE` en `publicarStockPotrero` no es una redundancia** — es
  deliberado. El comentario en el código (líneas ~1192-1196) explica que el
  upsert va primero y el delete después, precisamente para que un potrero
  nunca quede ausente de la tabla `stock_potreros` si el proceso se corta a
  mitad de camino en una conexión inestable. Sacar el delete "cuando el
  potrero está vacío" reintroduciría el bug de stock fantasma que ya se sufrió
  antes en este proyecto (el caso Piquete, en la memoria del proyecto).

## Lo que descartaría de raíz

**Toda la Sección 3 del plan (capas de caché en memoria con TTL para
catálogo de productos, estadísticas de temporada, sanidad).**

Esta es una app de un solo usuario, offline-first, con tráfico ínfimo a
Supabase (un campo, algunos dispositivos, consultas ocasionales) — no hay
ningún problema de escala real que resolver con caché de sesión. Lo que sí
habría es riesgo concreto de mostrarle a Pedro un número viejo en el celular
mientras la PC ya sincronizó algo distinto entre pestañas o entre aperturas
del modal — exactamente el tipo de bug de "los números no dan" que este
proyecto ya sufrió más de una vez (ver memoria
`verificar-contra-la-realidad-antes-de-fijar-logica-de-stock`).

Es una auditoría escrita con vocabulario de backend de alto tráfico (rate
limiting, TTL de caché, control de concurrencia agresivo) aplicada a una app
que no tiene ese perfil de uso. Los puntos de la Sección 1 y 2 (colas,
tipos de evento) son ajustes puntuales y verificables; la Sección 3 cambia la
arquitectura de "siempre mostrar el dato más fresco posible" por una de
"mostrar lo último que se cacheó", a cambio de un ahorro de tráfico que no
hace falta en este volumen de uso.

## Recomendación

Implementar solo:
1. Batching de concurrencia en `publicarStockPotreros`.
2. Agregar `'muerte_desaparecido'` al filtro de `calcularEstadisticasNacimientos`
   (después de confirmar por qué esa función incluye `'muerte'`).
3. Logging de errores en `sincronizar()`.

Dejar afuera las capas de caché con TTL de la Sección 3, salvo que se
observe lentitud real y reportada en el campo (no solo en el análisis
teórico del plan).
