# Tablero de Campos

Página para la PC que muestra el stock por potrero: mapa pintado por carga (UG/ha), totales, detalle por potrero y
tablas. **Solo lee**: no cambia nada en la base de datos.

## Qué necesita

- Una base Supabase con la tabla `stock_potreros` (columnas `establecimiento`, `potrero`, `categoria`, `dueno`,
  `cantidad`, `ug`, `especie`, `actualizado_en`). La llenan las apps de potreros.
- Los dibujos de los potreros: desde un config de las apps o desde un archivo GeoJSON.
- Node.js para correr el generador.

## Cómo usarlo en otro establecimiento

1. Copiá la carpeta `tablero-campos/`.
2. Abrí `config.js` y cambiá:
   - `titulo`: el nombre que se ve arriba.
   - `supabaseUrl` y `supabaseKey`: los de **tu** proyecto (la clave pública "anon" o "publishable").
   - `campos`: un renglón por campo. El `id` tiene que ser igual al valor de `establecimiento` en `stock_potreros`.
     Va en minúsculas, sin espacios ni guiones (por ejemplo `mi_campo`).
3. Los potreros: exportalos de Google Earth o QGIS como **GeoJSON**, guardá el archivo en esta carpeta y poné
   `potreros: { geojson: 'mi-campo.geojson' }`. Cada polígono tiene que tener el nombre del potrero en la propiedad
   `nombre` (o `name`), igual que en `stock_potreros`. Si tiene `area` (hectáreas), se usa; si no, se mide del dibujo.
   El `area` va solo como número (por ejemplo `12.5` o `12,5`), sin puntos de miles. Si un potrero tiene varias partes,
   se dibuja solo la primera: mejor unirlas en un polígono antes de exportar.
4. Desde la carpeta de arriba corré:

   ```
   node tablero-campos/generar.js
   ```

   Eso escribe `tablero-campos/index.html`. Ese es el archivo que se publica o se abre en el navegador.

## Cosas a saber

- Si la base pide clave del campo (`usaClave: true`), la página la pide una vez y la guarda en ese navegador.
- Los colores del mapa se cortan en `cortesCarga` (UG/ha). Cambialos en `config.js` si tu campo maneja otras cargas.
- Si dos tableros se publican en la **misma dirección web** (mismo usuario de GitHub Pages), poné un
  `prefijoAlmacen` distinto en cada `config.js` (por ejemplo `tablero_mi_campo`), para que no se mezcle lo guardado.
- Si `generar.js` encuentra un problema, lo dice en castellano y no escribe nada. Los avisos con ⚠ no frenan: leelos igual.
