/*
 * Prueba ad-hoc: cuando un dispositivo recibe (via sync, o al reconstruir
 * todo desde cero) tanto la carga original como la correccion que la borra
 * o edita, tiene que quedar UNA sola linea de historial -- la original,
 * tachada -- en vez de dos lineas sueltas y sin relacionar (la carga
 * "viva" de un lado, y un "Corrección (sincronizada): se eliminó..." sin
 * decir cual, del otro). El id de historial que manda la correccion
 * (historialId) es local al dispositivo que la genero y NUNCA coincide con
 * el id que un dispositivo DISTINTO le asigna a la misma carga al
 * aplicarla via aplicarEventoRemoto -- por eso hay que emparejar por
 * potrero+tipo+categoria+cantidad+dueño+fecha en vez de por ese id.
 *
 * Bug real encontrado el 9/9 auditando La Vuelta: un nacimiento de 3
 * Terneros en el potrero 11, cargado y borrado por error el mismo dia,
 * seguia apareciendo entero (sin tachar) en el historial de cualquier
 * dispositivo que no fuera el que hizo el borrado.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return { from(){ const q = { select(){ return q; }, eq(){ return q; }, in(){ return q; },
    order(){ return q; }, gt(){ return q; }, insert(){ return Promise.resolve({error:null}); },
    then(res){ return Promise.resolve(res({data:[], error:null})); } }; return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + ';window.__est = function(){ return estado; };window.__aplicarRemoto = aplicarEventoRemoto; window.__establecimiento = function(){ return ESTABLECIMIENTO; };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const est = win.__est();
  const establecimiento = win.__establecimiento();
  // Pone Chico arranca sin potreros (POTREROS_GEO=[]) -- se sintetiza uno
  // minimo, ya que esta prueba no pasa por seleccionarPotrero/renderDetalle
  // (que si necesitarian info geografica).
  if(Object.keys(est.potreros).length === 0){
    est.potreros['TEST'] = { animales: {}, historial: [] };
  }
  const potrero = Object.keys(est.potreros)[0];

  // Caso 1: "Borrar" -- la correccion debe encontrar y tachar la carga
  // original en vez de agregar una linea suelta.
  const totalAntes1 = est.potreros[potrero].historial.length;
  win.__aplicarRemoto({
    establecimiento, tipo: 'nacimiento', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026', detalle: { categoria: 'Terneros', cantidad: 3 }
  });
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026',
    detalle: { historialId: 'h_esteIdNuncaVaACoincidir', tipoOriginal: 'nacimiento', accion: 'eliminar',
      reversar: { tipo: 'restar', potrero, categoria: 'Terneros', cantidad: 3, dueno: null },
      fechaOriginal: '09/09/2026' }
  });
  const histDespues1 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - totalAntes1);
  chequear('borrar: se agrego exactamente 1 linea de historial (no 2)',
    histDespues1.length === 1, 'lineas nuevas: ' + JSON.stringify(histDespues1.map(h=>h.detalle)));
  const nac1 = histDespues1.find(h=>h.tipo==='nacimiento');
  chequear('borrar: la carga original quedo marcada eliminada', !!(nac1 && nac1.eliminado),
    JSON.stringify(nac1));
  chequear('borrar: el detalle dice ELIMINADO', !!(nac1 && /ELIMINADO/.test(nac1.detalle)), JSON.stringify(nac1 && nac1.detalle));
  chequear('borrar: no quedo una linea "correccion" separada', !histDespues1.some(h=>h.tipo==='correccion'),
    JSON.stringify(histDespues1));

  // Caso 2: "Editar" -- mismo emparejamiento, pero el texto final es distinto.
  const totalAntes2 = est.potreros[potrero].historial.length;
  win.__aplicarRemoto({
    establecimiento, tipo: 'nacimiento', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '08/09/2026', detalle: { categoria: 'Terneros', cantidad: 5 }
  });
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '08/09/2026',
    detalle: { historialId: 'h_otroIdQueTampocoCoincide', tipoOriginal: 'nacimiento', accion: 'editar',
      reversar: { tipo: 'restar', potrero, categoria: 'Terneros', cantidad: 5, dueno: null },
      fechaOriginal: '08/09/2026' }
  });
  const histDespues2 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - totalAntes2);
  chequear('editar: se agrego exactamente 1 linea de historial (no 2)',
    histDespues2.length === 1, JSON.stringify(histDespues2.map(h=>h.detalle)));
  const nac2 = histDespues2.find(h=>h.tipo==='nacimiento');
  chequear('editar: la carga original quedo marcada eliminada, con texto EDITADO', !!(nac2 && nac2.eliminado && /EDITADO/.test(nac2.detalle)),
    JSON.stringify(nac2));

  // Caso 3 (respaldo): si NO hay ninguna carga que matchee (cantidad
  // distinta), tiene que seguir cayendo en el comportamiento viejo -- una
  // linea generica de "Corrección (sincronizada)" -- para no perder el
  // rastro de la correccion cuando el emparejamiento no encuentra nada.
  const totalAntes3 = est.potreros[potrero].historial.length;
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '07/09/2026',
    detalle: { historialId: 'h_sinMatch', tipoOriginal: 'nacimiento', accion: 'eliminar',
      reversar: { tipo: 'restar', potrero, categoria: 'Terneros', cantidad: 999, dueno: null },
      fechaOriginal: '07/09/2026' }
  });
  const histDespues3 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - totalAntes3);
  chequear('sin match: cae en la linea generica de respaldo (no se pierde la correccion)',
    histDespues3.length === 1 && histDespues3[0].tipo === 'correccion', JSON.stringify(histDespues3));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
