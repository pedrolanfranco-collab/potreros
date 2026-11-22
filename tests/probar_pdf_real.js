/*
 * Los PDF de la PC con el jsPDF y el jspdf-autotable DE VERDAD (18/11/2026, punto 9 del informe de auditoría:
 * jsPDF 2.5.1 -> 4.2.1 y autotable 3.8.2 -> 5.0.9).
 *
 * Las otras pruebas usan un jsPDF falso (probar_pdf_animales.js): si una versión nueva de la librería cambia algo
 * que la app usa (doc.autoTable, doc.lastAutoTable.finalY, setFont...), no se darían cuenta. Acá se cargan los
 * mismos archivos que baja la app (los de tests/node_modules, que son el paquete de npm que sirve cdn.jsdelivr.net)
 * y se aprietan los 3 botones de PDF.
 *
 * Controla:
 *   - las versiones del <script src> de la app son las de tests/package.json, y el integrity (SRI) del <script>
 *     coincide con el archivo del paquete: si alguien cambia la versión en un lado y no en el otro, o el hash no
 *     corresponde, falla acá y no en el celular de Pedro (con SRI malo el navegador no carga la librería);
 *   - "PDF: Estado", "PDF: Animales por potrero" y "PDF: Historial" generan un PDF válido (%PDF-, al menos una
 *     página, %%EOF) sin errores.
 *
 * Uso: node tests/probar_pdf_real.js <index.html> [<index.html> ...]   (solo las variantes PC tienen los botones)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
const rechazosNode = [];
process.on('unhandledRejection', e => rechazosNode.push(String((e && e.stack) || e)));

const MODS = path.join(__dirname, 'node_modules');
const PAQUETES = {
  jspdf: { archivo: path.join(MODS, 'jspdf', 'dist', 'jspdf.umd.min.js'), url: v => `https://cdn.jsdelivr.net/npm/jspdf@${v}/dist/jspdf.umd.min.js` },
  'jspdf-autotable': { archivo: path.join(MODS, 'jspdf-autotable', 'dist', 'jspdf.plugin.autotable.min.js'), url: v => `https://cdn.jsdelivr.net/npm/jspdf-autotable@${v}/dist/jspdf.plugin.autotable.min.js` },
};
const versiones = require('./package.json').devDependencies;
const sri = archivo => 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(archivo)).digest('base64');

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

async function levantarApp(archivo){
  const html = fs.readFileSync(archivo, 'utf-8');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  // las librerías reales, como las carga el navegador (UMD: quedan en window.jspdf y autotable se engancha sola)
  win.eval(fs.readFileSync(PAQUETES.jspdf.archivo, 'utf-8'));
  win.eval(fs.readFileSync(PAQUETES['jspdf-autotable'].archivo, 'utf-8'));
  const guardados = [];
  if(win.jspdf && win.jspdf.jsPDF){
    win.jspdf.jsPDF.API.save = function(nombre){
      const bytes = Buffer.from(this.output('arraybuffer'));
      guardados.push({ nombre, paginas: this.getNumberOfPages(), bytes });
      return this;
    };
  }
  win.supabase = { createClient(){ return { from(){
    const q = new Proxy({}, { get(t, prop){
      if(prop === 'then') return res => Promise.resolve({ data: [], error: null }).then(res);
      return () => q;
    } });
    return q;
  } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script:not([src])')).map(s => s.textContent).join('\n');
  try { win.eval(codigo); } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(80);
  return { win, errores, guardados };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const html = fs.readFileSync(archivo, 'utf-8');
  for(const [nombre, p] of Object.entries(PAQUETES)){
    const url = p.url(versiones[nombre]);
    const tag = (html.match(new RegExp(`<script src="${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"[^>]*>`)) || [])[0];
    chequear(`la app carga ${nombre}@${versiones[nombre]} (la de tests/package.json)`, !!tag, url);
    if(tag) chequear(`el integrity de ${nombre} es el del paquete`, tag.includes(`integrity="${sri(p.archivo)}"`), sri(p.archivo));
  }

  const { win, errores, guardados } = await levantarApp(archivo);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  chequear('jsPDF real cargado, con autoTable', !!(win.jspdf && win.jspdf.jsPDF && win.jspdf.jsPDF.API.autoTable));
  const botones = ['btn-exportar-pdf', 'btn-exportar-pdf-animales', 'btn-exportar-pdf-historial'];
  for(const id of botones){
    const boton = win.document.getElementById(id);
    if(!boton){ chequear(`existe el botón ${id}`, false); continue; }
    const antes = guardados.length;
    rechazosNode.length = 0;
    boton.click();
    await dormir(300);
    const g = guardados[antes];
    chequear(`${id}: se guarda un PDF`, guardados.length === antes + 1, rechazosNode.join(' | '));
    if(g){
      const texto = g.bytes.toString('latin1');
      chequear(`${id}: PDF válido (${g.paginas} pág., ${g.bytes.length} bytes)`,
        texto.startsWith('%PDF-') && texto.trimEnd().endsWith('%%EOF') && g.paginas >= 1, g.nombre);
    }
    chequear(`${id}: sin errores sin atrapar`, rechazosNode.length === 0, rechazosNode.join(' | '));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('Uso: node tests/probar_pdf_real.js <index.html> [...]'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
