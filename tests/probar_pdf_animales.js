/*
 * Fase 5 de la auditoría (10/10/2026): el botón "⬇ PDF: Animales por potrero" de las apps de PC.
 *
 * Desde el 12/9/2026 (commit e4d8f2f) los nacimientos se calculan por especie
 * ({bovino, ovino, filasPorCategoria}) y el PDF siguió leyendo los campos viejos
 * (nacimientosTemporada, vacas, pct, filasPorMes): al apretar el botón tiraba
 * "Cannot read properties of undefined (reading 'length')" y no bajaba nada. Lo encontró el
 * informe semanal de nacimientos (Playwright), que aprieta ese botón solo. Ninguna prueba
 * apretaba el botón porque jsPDF es una librería externa que no se carga en jsdom.
 *
 * Cubre: con eventos de nacimiento de la temporada el PDF se guarda con los números
 * correctos (terneros nacidos y tabla por categoría); sin conexión y sin datos guardados el
 * PDF se guarda igual con "N/D" y sin la tabla mensual.
 *
 * Uso: node tests/probar_pdf_animales.js <index.html> [<index.html> ...]
 * (el botón solo existe en las variantes PC; en las demás se omite)
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
// El manejador del botón es async: si tira un error, jsdom lo deja como promesa rechazada de Node.
const rechazosNode = [];
process.on('unhandledRejection', e => rechazosNode.push(String((e && e.message) || e)));

function limites(){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; },
    isValid(){ return true; }, pad(){ return b; }, getNorth(){ return -31.9; },
    getSouth(){ return -32.0; }, getEast(){ return -56.3; }, getWest(){ return -56.4; },
    contains(){ return true; } };
  return b;
}
function stubLeaflet(win){
  const conocidos = {
    getBounds: () => limites(), getLatLng: () => ({ lat: -31.98, lng: -56.34 }),
    getElement: () => win.document.createElement('div'),
    getTooltip: () => ({ setContent(){}, getElement(){ return win.document.createElement('div'); } }),
    getPopup: () => ({ setContent(){}, isOpen(){ return false; } }), isPopupOpen: () => false
  };
  const capa = () => {
    const o = new Proxy({ __capa: true }, {
      get(t, prop){
        if(prop in t) return t[prop];
        if(typeof prop !== 'string') return undefined;
        if(conocidos[prop]) return conocidos[prop];
        return () => o;
      }, has(){ return true; } });
    return o;
  };
  const mapa = { _capas: new Set(), setView(){ return mapa; }, fitBounds(){ return mapa; },
    on(){ return mapa; }, addLayer(l){ mapa._capas.add(l); return mapa; },
    removeLayer(l){ mapa._capas.delete(l); return mapa; }, hasLayer(l){ return mapa._capas.has(l); },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

// jsPDF falso: guarda cada autoTable (cabecera y cuerpo) y el nombre con que se hizo save()
function stubJsPDF(win){
  const registro = { tablas: [], guardados: [], textos: [] };
  win.jspdf = { jsPDF: function(){
    const doc = {
      setFontSize(){}, setTextColor(){}, setFont(){},
      text(t){ registro.textos.push(String(t)); },
      autoTable(o){ registro.tablas.push({ head: o.head, body: o.body }); doc.lastAutoTable = { finalY: 40 + registro.tablas.length * 20 }; },
      save(nombre){ registro.guardados.push(nombre); },
      lastAutoTable: { finalY: 0 }
    };
    return doc;
  } };
  return registro;
}

// `eventos`: filas que devuelve eventos_sync para las consultas del informe (null = la consulta falla)
async function levantarApp(archivo, { eventos, enLinea }){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  const pdf = stubJsPDF(win);
  win.supabase = { createClient(){ return { from(tabla){
    const q = new Proxy({}, { get(t, prop){
      if(prop === 'then'){
        return res => Promise.resolve({ data: tabla === 'eventos_sync' ? (eventos || []) : [], error: null }).then(res);
      }
      return () => q;
    } });
    return q;
  } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: !!enLinea, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo); } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(80);
  return { win, errores, pdf };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const hoy = new Date();
  const anio = (hoy.getMonth() + 1) >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1;   // misma regla que la app

  // ---- 1) con conexión y nacimientos en la temporada
  {
    const eventos = [
      { tipo: 'nacimiento', potrero: 'X', fecha_cliente: `15/09/${anio}`, detalle: { categoria: 'Terneros', cantidad: 3 }, creado_en: '2026-09-15T12:00:00Z' },
      { tipo: 'nacimiento', potrero: 'X', fecha_cliente: `20/10/${anio}`, detalle: { categoria: 'Corderos/as', cantidad: 2 }, creado_en: '2026-10-20T12:00:00Z' }
    ];
    const { win, errores, pdf } = await levantarApp(archivo, { eventos, enLinea: true });
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const boton = win.document.getElementById('btn-exportar-pdf-animales');
    if(!boton){ console.log('  --  esta variante no tiene el botón de PDF (se omite)'); return; }

    rechazosNode.length = 0;
    boton.click();
    await dormir(150);
    const rechazos = rechazosNode.slice();

    chequear('el PDF se guarda con el nombre esperado',
      pdf.guardados.length === 1 && /_animales_por_potrero_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.guardados[0]),
      JSON.stringify(pdf.guardados) + ' ' + rechazos.join(' | '));
    chequear('no hubo errores sin atrapar', rechazos.length === 0, rechazos.join(' | '));
    const resumen = pdf.tablas[0];
    chequear('primera tabla: resumen con la columna de terneros nacidos',
      !!resumen && /Terneros nacidos temp\./.test(String(resumen.head[0][5])), JSON.stringify(resumen && resumen.head));
    chequear('terneros nacidos de la temporada = 3', !!resumen && resumen.body[0][5] === 3, JSON.stringify(resumen && resumen.body[0]));
    const pct = resumen && resumen.body[0][6];
    chequear('porcentaje s/ vacas es un % o "—"', typeof pct === 'string' && (/^\d+(\.\d)?%$/.test(pct) || pct === '—'), String(pct));
    const mensual = pdf.tablas.find(t => t.head[0][0] === 'Categoría' && t.head[0][1] === 'Ago');
    chequear('tabla mes a mes por categoría (Terneros y Corderos/as)',
      !!mensual && mensual.body.length === 2 && mensual.body[0][0] === 'Terneros' && mensual.body[1][0] === 'Corderos/as',
      JSON.stringify(mensual));
    chequear('terneros: 3 en septiembre', !!mensual && mensual.body[0][2] === 3 && mensual.body[0][6] === 3, JSON.stringify(mensual && mensual.body[0]));
    chequear('corderos/as: 2 en octubre', !!mensual && mensual.body[1][3] === 2 && mensual.body[1][6] === 2, JSON.stringify(mensual && mensual.body[1]));
  }

  // ---- 2) sin conexión y sin datos guardados: igual se guarda, con N/D y sin la tabla mensual
  {
    const { win, errores, pdf } = await levantarApp(archivo, { eventos: [], enLinea: false });
    if(errores.length){ chequear('(sin conexión) carga sin errores', false, errores[0]); return; }
    rechazosNode.length = 0;
    win.document.getElementById('btn-exportar-pdf-animales').click();
    await dormir(150);
    const rechazos = rechazosNode.slice();
    chequear('(sin conexión) el PDF se guarda igual', pdf.guardados.length === 1 && rechazos.length === 0, JSON.stringify(pdf.guardados) + ' ' + rechazos.join(' | '));
    const resumen = pdf.tablas[0];
    chequear('(sin conexión) nacimientos y % figuran como N/D', !!resumen && resumen.body[0][5] === 'N/D' && resumen.body[0][6] === 'N/D', JSON.stringify(resumen && resumen.body[0]));
    chequear('(sin conexión) no se dibuja la tabla mensual vacía', !pdf.tablas.some(t => t.head[0][0] === 'Categoría' && t.head[0][1] === 'Ago'));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('Uso: node tests/probar_pdf_animales.js <index.html> [...]'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
