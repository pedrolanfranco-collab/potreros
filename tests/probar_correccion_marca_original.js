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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); } };
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
  // Pone Chico arranca sin potreros (POTREROS_GEO=[]) -- se sintetizan dos
  // minimos (hace falta un segundo para probar movimientos entre potreros),
  // ya que esta prueba no pasa por seleccionarPotrero/renderDetalle (que si
  // necesitarian info geografica).
  if(Object.keys(est.potreros).length === 0){
    est.potreros['TEST'] = { animales: {}, historial: [] };
    est.potreros['TEST2'] = { animales: {}, historial: [] };
  }
  const nombres = Object.keys(est.potreros);
  const potrero = nombres[0];
  const potrero2 = nombres[1] || nombres[0];

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

  if(potrero2 === potrero){
    console.log('  (sin un segundo potrero real disponible -- se salta la parte de movimientos entre potreros)');
    return;
  }

  // Caso 4: "movimiento" (una sola categoria) entre DOS potreros -- tiene
  // que tachar la entrada tanto en el origen como en el destino, sin dejar
  // ninguna linea "correccion" suelta de ningun lado.
  const antesOrigen4 = est.potreros[potrero].historial.length;
  const antesDestino4 = est.potreros[potrero2].historial.length;
  win.__aplicarRemoto({
    establecimiento, tipo: 'movimiento', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026', detalle: { categoria: 'Vacas', cantidad: 5, destino: potrero2 }
  });
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026',
    detalle: { historialId: 'h_noCoincideMov', tipoOriginal: 'movimiento', accion: 'eliminar',
      reversar: { tipo: 'mover', origen: potrero2, destino: potrero, categoria: 'Vacas', categoriaDestino: 'Vacas', dueno: null, cantidad: 5 },
      fechaOriginal: '09/09/2026' }
  });
  const nuevasOrigen4 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - antesOrigen4);
  const nuevasDestino4 = est.potreros[potrero2].historial.slice(0, est.potreros[potrero2].historial.length - antesDestino4);
  chequear('movimiento: no quedo ninguna linea "correccion" suelta (ni origen ni destino)',
    !nuevasOrigen4.some(h=>h.tipo==='correccion') && !nuevasDestino4.some(h=>h.tipo==='correccion'),
    JSON.stringify({nuevasOrigen4, nuevasDestino4}));
  const movOrigen4 = nuevasOrigen4.find(h=>h.tipo==='movimiento');
  const movDestino4 = nuevasDestino4.find(h=>h.tipo==='movimiento');
  chequear('movimiento: se tacho el lado origen', !!(movOrigen4 && movOrigen4.eliminado && /ELIMINADO/.test(movOrigen4.detalle)), JSON.stringify(movOrigen4));
  chequear('movimiento: se tacho el lado destino', !!(movDestino4 && movDestino4.eliminado && /ELIMINADO/.test(movDestino4.detalle)), JSON.stringify(movDestino4));

  // Caso 5: "movimiento" dentro del MISMO potrero (recategorizacion) -- un
  // solo lado, no debe intentar buscar un segundo potrero.
  const antes5 = est.potreros[potrero].historial.length;
  win.__aplicarRemoto({
    establecimiento, tipo: 'movimiento', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026', detalle: { categoria: 'Terneros', categoriaDestino: 'Vaquillonas 1-2 años', cantidad: 2, destino: potrero }
  });
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026',
    detalle: { historialId: 'h_noCoincideRecat', tipoOriginal: 'movimiento', accion: 'eliminar',
      reversar: { tipo: 'mover', origen: potrero, destino: potrero, categoria: 'Vaquillonas 1-2 años', categoriaDestino: 'Terneros', dueno: null, cantidad: 2 },
      fechaOriginal: '09/09/2026' }
  });
  const nuevas5 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - antes5);
  chequear('recategorizacion (mismo potrero): una sola linea nueva, tachada, sin generica',
    nuevas5.length === 1 && nuevas5[0].eliminado && /ELIMINADO/.test(nuevas5[0].detalle), JSON.stringify(nuevas5));

  // Caso 6: "movimiento_todo" -- items entre dos potreros.
  const antesOrigen6 = est.potreros[potrero].historial.length;
  const antesDestino6 = est.potreros[potrero2].historial.length;
  const items6 = [{ categoria: 'Vacas', cantidad: 10 }, { categoria: 'Terneros', cantidad: 4 }];
  win.__aplicarRemoto({
    establecimiento, tipo: 'movimiento_todo', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026', detalle: { destino: potrero2, items: items6 }
  });
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026',
    detalle: { historialId: 'h_noCoincideTodo', tipoOriginal: 'movimiento_todo', accion: 'eliminar',
      reversar: { tipo: 'mover_todo', origen: potrero2, destino: potrero, items: items6 },
      fechaOriginal: '09/09/2026' }
  });
  const nuevasOrigen6 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - antesOrigen6);
  const nuevasDestino6 = est.potreros[potrero2].historial.slice(0, est.potreros[potrero2].historial.length - antesDestino6);
  chequear('movimiento_todo: quedo etiquetado como movimiento_todo (no como movimiento a secas)',
    nuevasOrigen6.every(h=>h.tipo==='movimiento_todo') && nuevasDestino6.every(h=>h.tipo==='movimiento_todo'),
    JSON.stringify({nuevasOrigen6, nuevasDestino6}));
  chequear('movimiento_todo: no quedo ninguna linea "correccion" suelta',
    nuevasOrigen6.length === 1 && nuevasOrigen6[0].eliminado && nuevasDestino6.length === 1 && nuevasDestino6[0].eliminado,
    JSON.stringify({nuevasOrigen6, nuevasDestino6}));

  // Caso 7: "movimiento_multi" -- varias categorias entre dos potreros.
  const antesOrigen7 = est.potreros[potrero].historial.length;
  const antesDestino7 = est.potreros[potrero2].historial.length;
  const items7 = [{ categoria: 'Vacas', cantidad: 3 }, { categoria: 'Toros', categoriaDestino: 'Toros', cantidad: 1 }];
  win.__aplicarRemoto({
    establecimiento, tipo: 'movimiento_multi', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026', detalle: { destino: potrero2, items: items7 }
  });
  win.__aplicarRemoto({
    establecimiento, tipo: 'correccion', potrero, dispositivo: 'disp_origen',
    fecha_cliente: '09/09/2026',
    detalle: { historialId: 'h_noCoincideMulti', tipoOriginal: 'movimiento_multi', accion: 'eliminar',
      reversar: { tipo: 'mover_multi', origen: potrero2, destino: potrero, items: items7 },
      fechaOriginal: '09/09/2026' }
  });
  const nuevasOrigen7 = est.potreros[potrero].historial.slice(0, est.potreros[potrero].historial.length - antesOrigen7);
  const nuevasDestino7 = est.potreros[potrero2].historial.slice(0, est.potreros[potrero2].historial.length - antesDestino7);
  chequear('movimiento_multi: no quedo ninguna linea "correccion" suelta (ni origen ni destino)',
    nuevasOrigen7.length === 1 && nuevasOrigen7[0].eliminado && nuevasDestino7.length === 1 && nuevasDestino7[0].eliminado,
    JSON.stringify({nuevasOrigen7, nuevasDestino7}));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
