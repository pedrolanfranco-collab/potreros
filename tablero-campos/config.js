// Configuración del Tablero de Campos. ES EL ÚNICO ARCHIVO QUE HAY QUE TOCAR para usarlo en otro establecimiento.
// Después de cambiarlo, correr desde la raíz del repo:  node tablero-campos/generar.js
//
// Cada campo necesita:
//   id            -> el mismo texto que usa la columna `establecimiento` en Supabase (stock_potreros)
//   nombre        -> lo que se ve en el botón
//   usaClave      -> true si Supabase pide la clave del campo (encabezado x-clave-campo)
//   etiquetaDueno -> "Dueño", "Firma"... (texto del filtro)
//   potreros      -> de dónde salen los dibujos de los potreros. Una de estas dos:
//                      { desdeConfig: 'la-vuelta' }   lee template/configs/la-vuelta.js (potrerosGeo)
//                      { geojson: 'mi-campo.geojson' } lee un GeoJSON en esta carpeta (polígonos con propiedad "nombre"
//                                                      y opcional "area" en hectáreas) — así se exporta desde Google Earth/QGIS
//
// Para mostrar u ocultar un campo, agregalo o sacalo de la lista. El orden de la lista es el orden de los botones.
// El botón "Todos" aparece solo si hay más de un campo.
module.exports = {
  titulo: 'Tablero de Campos',
  supabaseUrl: 'https://skkknfjpwcstefcroqjt.supabase.co',
  supabaseKey: 'sb_publishable_U62qYc-mqby-ZGzE9FG2IA_kzOTGGJK',   // clave pública (anon): solo lee lo que permiten las políticas
  cortesCarga: [0.5, 0.8, 1.2],                                   // UG/ha: límites entre los 4 colores del mapa
  prefijoAlmacen: 'tablero_campos',                               // nombre con que se guarda en el navegador; cambiarlo si otro tablero usa la misma dirección web
  campos: [
    { id: 'la_vuelta',   nombre: 'La Vuelta',   usaClave: true, etiquetaDueno: 'Firma', potreros: { desdeConfig: 'la-vuelta' } },
    { id: 'maria_laura', nombre: 'María Laura', usaClave: true, etiquetaDueno: 'Dueño', potreros: { desdeConfig: 'maria-laura' } },
    // Pone Chico: oculto por ahora (4/11/2026, a pedido de Pedro). Para mostrarlo, sacar las dos barras del principio:
    // { id: 'pone_chico', nombre: 'Pone Chico', usaClave: true, etiquetaDueno: 'Dueño', potreros: { desdeConfig: 'pone-chico' } },
  ],
};
