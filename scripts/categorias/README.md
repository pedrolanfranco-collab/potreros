# Categorías de animales: patrón único (18/11/2026)

La misma categoría se escribía de cuatro formas: la app ("Vacas de invernada"), la Planilla Sanitaria vieja
("V. Inv."), el bastón/SNIG ("Vaca de invernada", "VINV") y el Excel de DICOSE ("VINV"). Por eso los vencimientos con
nombre viejo de `sanidad_proximos` nunca se cerraban solos.

| Archivo | Qué hace |
|---|---|
| `categorias.sql` | Crea `public.categorias` (el patrón: las 24 de `ESPECIES` del template), `public.categorias_alias` (nombre viejo en minúsculas → patrón, las 25 equivalencias que aprobó Pedro el 18/11/2026) y `public.categoria_patron(t)`. Copia cada "Ya se hizo" del tablero a su nombre del patrón. Aditivo, en una transacción, se puede correr dos veces. |
| `categorias_deshacer.sql` | Saca todo lo anterior y las marcas copiadas (no toca las originales). |
| `probar_categorias.js` | 31 verificaciones contra Postgres real (PGlite, sin tocar Supabase); también que las 24 del SQL sean exactamente las del template. Cómo instalar PGlite: ver el encabezado. |

Decisiones de Pedro (18/11/2026): "Teros/as" → Terneros; "Vaq. +2" → Vaquillonas 2-3 años; "Toritos" → Toros;
"Consumo" y "Sin categoría" quedan como están; el resto como se propuso.

**Quién la usa:** `scripts/sanidad/actualizar_sanidad_supabase.py`, al publicar Próximos y Últimos. Las apps no la leen
(hoy no hace falta). Solo la clave privada tiene permiso; la llave pública no. **No se reescribe ningún dato
histórico**: `sanidad_carga` queda igual que el Excel.

**Una categoría nueva** se agrega primero a `ESPECIES` del template (la prueba falla si el SQL y el template no
coinciden) y después a `public.categorias`. **Un nombre viejo nuevo** que aparezca (en la Planilla o el bastón) se
agrega a `public.categorias_alias` en minúsculas.
