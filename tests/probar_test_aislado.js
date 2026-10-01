/*
 * Auditoría de seguridad (1/10/2026): la copia de PRUEBA la-vuelta-test NO tiene
 * que hablar nunca con Supabase. Antes usaba las tablas de producción (con la
 * etiqueta la_vuelta_test) y podía mezclar sanidad/stock con datos reales.
 *
 * Con un Supabase simulado que registra cada uso, se fuerza todo lo que antes
 * escribía en la base (enviar un evento, sincronizar, publicar stock) y se
 * verifica que no hubo NINGÚN createClient ni NINGÚN from(); que la URL y la
 * clave no quedaron en el archivo; y que el evento queda en la cola local.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

function stubLeaflet(win){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; }, isValid(){ return true; },
    pad(){ return b; }, getNorth(){ return -31.9; }, getSouth(){ return -32.0; }, getEast(){ return -56.3; },
    getWest(){ return -56.4; }, contains(){ return true; } };
  const capa = () => { const o = new Proxy({ __capa: true }, { get(t, p){ if(p in t) return t[p]; if(typeof p !== 'string') return undefined;
    if(p === 'getBounds') return () => b; if(p === 'getLatLng') return () => ({ lat: -31.98, lng: -56.34 });
    if(p === 'getElement') return () => win.document.createElement('div'); return () => o; }, has(){ return true; } }); return o; };
  const mapa = { _c: new Set(), setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._c.add(l); return mapa; }, removeLayer(l){ mapa._c.delete(l); return mapa; }, hasLayer(l){ return mapa._c.has(l); },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._c.add(c); return c; }, polygon(){ return capa(); },
    marker(){ return capa(); }, circleMarker(){ return capa(); }, circle(){ return capa(); }, divIcon(){ return {}; },
    latLng(a, b2){ return { lat: a, lng: b2 }; }, latLngBounds(){ return b; } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

(async () => {
  const archivo = process.argv[2] || 'la-vuelta-test/index.html';
  console.log('\n=== ' + archivo + ' ===');
  const bruto = fs.readFileSync(archivo, 'utf-8');
  chequear('el archivo no contiene la URL ni la clave de Supabase', !/skkknfjpwcstefcroqjt|sb_publishable/.test(bruto));

  const usos = { createClient: 0, from: 0 };
  const supabaseFalso = { createClient(){ usos.createClient++; return { from(){ usos.from++; const q = new Proxy({}, { get(t, p){ if(p === 'then') return r => Promise.resolve({ data: [], error: null }).then(r); return () => q; } }); return q; } }; } };

  const html = bruto.replace(/<script src="https?:\/\/[^"]*"[^>]*><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push(e.stack || e.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = supabaseFalso;
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + ';window.__est = ()=>estado; window.__sync = sincronizar; window.__env = enviarEvento; window.__stock = publicarStockPotreros; window.__cli = clienteSupabase;'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 80));
  chequear('la app carga sin errores', errores.length === 0, errores[0]);
  if(errores.length){ process.exit(1); }

  const potrero = Object.keys(win.__est().potreros)[0];
  chequear('clienteSupabase() devuelve null (no hay cliente)', win.__cli() === null);
  try { await win.__env('lluvia', null, { id: 'x1', mm: 5 }); } catch(e){}
  try { await win.__env('ingreso', potrero, { cantidad: 3, categoria: 'Vacas' }); } catch(e){}
  try { await win.__sync(true); } catch(e){}
  try { await win.__stock(Object.keys(win.__est().potreros)); } catch(e){}
  await new Promise(r => setTimeout(r, 150));

  chequear('ningún createClient (la librería de Supabase no se usó)', usos.createClient === 0, 'createClient x' + usos.createClient);
  chequear('ninguna consulta a una tabla (ni lectura ni escritura)', usos.from === 0, 'from() x' + usos.from);
  const cola = (win.__est().colaSync || []).length;
  chequear('los eventos quedan guardados en el teléfono (cola local)', cola >= 2, 'cola=' + cola);

  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
