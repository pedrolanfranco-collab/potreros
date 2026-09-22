/*
 * probar_dibujar_potrero.js — "✏️ Dibujar potrero" (20/9/2026, a pedido de
 * Pedro: en la PC se puede dibujar el límite de un potrero que falta,
 * clickeando el mapa, y ponerle nombre). Solo existe en la variante PC
 * (dibujar precisión con mouse; en el celular sigue siendo Importar KML).
 *
 * No hay plugin de dibujo (Leaflet vanilla nomás) -- se arma a mano con
 * map.on('click')/dblclick, reusando el MISMO alta que ya usa
 * importarLimitesKML() (POTREROS_GEO, estado.potreros, AREA_CALCULADA,
 * dibujarPotrero, POTREROS_NUEVOS_KEY, evento 'potrero_creado'), así que
 * "🗑 Eliminar potrero" ya sabe borrarlo sin ningún cambio adicional.
 *
 * Reusa los stubs de probar_eliminar_potrero.js (mismo Leaflet falso, mismo
 * override de location.reload).
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [] };
  return { filas, createClient(){ return { from(tabla){
    const arr = () => (filas[tabla] = filas[tabla] || []);
    const q = { _filtros: [], _delete: false,
      insert(obj){ arr().push(obj); return Promise.resolve({ error: null }); },
      select(){ return q; }, eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
      gt(col, val){ q._filtros.push(r => r[col] > val); return q; }, order(){ return q; },
      delete(){ q._delete = true; return q; },
      then(res){
        const a = arr();
        if(q._delete){
          for(let i=a.length-1;i>=0;i--){ if(q._filtros.every(f=>f(a[i]))) a.splice(i,1); }
          return Promise.resolve(res({ error: null }));
        }
        const data = a.filter(r => q._filtros.every(f => f(r)));
        return Promise.resolve(res({ data, error: null }));
      }
    };
    return q;
  } }; } };
}

function limites(){
  const b = { getCenter(){ return { lat: -31.385, lng: -55.426 }; }, extend(){ return b; }, isValid(){ return true; }, pad(){ return b; },
    getNorth(){ return -31.3; }, getSouth(){ return -31.4; }, getEast(){ return -55.4; }, getWest(){ return -55.5; }, contains(){ return true; } };
  return b;
}
function stubLeaflet(win){
  const conocidos = {
    getBounds: () => limites(), getLatLng: () => ({ lat: -31.385, lng: -55.426 }),
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
  const mapa = {
    _capas: new Set(), _dblClickZoomEnabled: true, setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; }, removeLayer(l){ mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); }, getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; },
    doubleClickZoom: { disable(){ mapa._dblClickZoomEnabled = false; }, enable(){ mapa._dblClickZoomEnabled = true; } }
  };
  win.__mapa = mapa;
  win.L = {
    map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); }, circle(){ return capa(); },
    divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; }, latLngBounds(){ return limites(); }
  };
}

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const servidor = crearServidor();
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.JSZip = require('jszip');
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.__alerts = [];
  win.alert = (msg)=>{ win.__alerts.push(msg); };
  win.confirm = () => win.__confirmRespuesta !== undefined ? win.__confirmRespuesta : true;
  win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.__recargoLlamado = false;
  try{ Object.defineProperty(win, 'location', { value: Object.assign(Object.create(win.location), { reload: ()=>{ win.__recargoLlamado = true; } }), configurable: true }); }
  catch(e){ win.location.reload = ()=>{ win.__recargoLlamado = true; }; }

  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo +
    '\n;window.__est = function(){ return estado; };' +
    '\n;window.__potreros = function(){ return POTREROS_GEO; };' +
    '\n;window.__potrerosNuevosKey = function(){ return POTREROS_NUEVOS_KEY; };' +
    '\n;window.__areaCalculada = function(){ return AREA_CALCULADA; };' +
    '\n;window.__modoDibujo = function(){ return modoDibujarPotrero; };' +
    '\n;window.__vertices = function(){ return verticesDibujo; };' +
    '\n;window.__poligonos = function(){ return poligonos; };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 80));
  return { win, errores, servidor };
}

async function probarPC(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores, servidor } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  chequear('carga sin errores de JS', true);

  chequear('existe el botón "✏️ Dibujar potrero"', !!doc.getElementById('btn-dibujar-potrero'));
  chequear('existe el modal para poner el nombre', !!doc.getElementById('modal-dibujar-potrero'));

  // Pone Chico arranca sin potreros (potrerosGeo: []) -- sembrar uno
  // sintético para poder probar el rechazo por nombre repetido.
  if(!win.__potreros().length){
    const geoSemilla = {nombre:'YA_EXISTE', area:null, coords:[[-31.30,-55.40],[-31.31,-55.40],[-31.31,-55.41]]};
    win.__potreros().push(geoSemilla);
    win.__est().potreros['YA_EXISTE'] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null};
    win.dibujarPotrero(geoSemilla);
  }

  // 1) Abrir el modal.
  doc.getElementById('btn-dibujar-potrero').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('el modal se abre', doc.getElementById('modal-dibujar-potrero').style.display === 'flex');

  // 2) Nombre vacío rechaza.
  doc.getElementById('dp-nombre').value = '';
  doc.getElementById('dp-empezar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('nombre vacío no arranca a dibujar', win.__modoDibujo() === null);
  chequear('nombre vacío avisa', doc.getElementById('toast').textContent === 'Ingresá un nombre para el potrero');

  // 3) Nombre repetido (uno que ya existe de fábrica) rechaza.
  const nombreExistente = win.__potreros()[0].nombre;
  doc.getElementById('dp-nombre').value = nombreExistente;
  doc.getElementById('dp-empezar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('nombre repetido no arranca a dibujar', win.__modoDibujo() === null);
  chequear('nombre repetido avisa', doc.getElementById('toast').textContent === `Ya existe un potrero "${nombreExistente}"`);
  chequear('el modal sigue abierto tras el rechazo', doc.getElementById('modal-dibujar-potrero').style.display === 'flex');

  // 4) "Cancelar" del modal de nombre lo cierra sin arrancar nada.
  doc.getElementById('dp-cancelar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('Cancelar cierra el modal de nombre', doc.getElementById('modal-dibujar-potrero').style.display === 'none');
  chequear('Cancelar no dejó modo dibujo activo', win.__modoDibujo() === null);

  // 5) Nombre nuevo válido arranca el modo dibujo.
  const nombreNuevo = 'Potrero Dibujado';
  doc.getElementById('btn-dibujar-potrero').dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.getElementById('dp-nombre').value = nombreNuevo;
  doc.getElementById('dp-empezar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('el modal se cierra al empezar a dibujar', doc.getElementById('modal-dibujar-potrero').style.display === 'none');
  chequear('modoDibujarPotrero queda con el nombre', win.__modoDibujo() && win.__modoDibujo().nombre === nombreNuevo, JSON.stringify(win.__modoDibujo()));
  chequear('el doble click del mapa se desactiva mientras se dibuja', win.__mapa._dblClickZoomEnabled === false);
  chequear('aparece el control flotante de dibujo', !!doc.querySelector('.dibujo-controles'));
  chequear('arranca en 0 puntos', doc.querySelector('.db-contador').textContent === '0 puntos');
  chequear('"Terminar" arranca deshabilitado', doc.getElementById('db-terminar').disabled === true);

  // 6) Agregar 2 vértices -- todavía no alcanza para terminar.
  win.agregarVerticeDibujo({ lat: -31.390, lng: -55.430 });
  win.agregarVerticeDibujo({ lat: -31.391, lng: -55.430 });
  chequear('van 2 puntos', win.__vertices().length === 2);
  chequear('el contador muestra 2 puntos', doc.querySelector('.db-contador').textContent === '2 puntos');
  chequear('"Terminar" sigue deshabilitado con 2 puntos', doc.getElementById('db-terminar').disabled === true);
  win.terminarDibujoPotrero();
  chequear('terminar con menos de 3 puntos no hace nada', win.__modoDibujo() !== null && win.__potreros().every(p=>p.nombre!==nombreNuevo));

  // 7) Deshacer un punto y volver a agregar.
  win.agregarVerticeDibujo({ lat: -31.391, lng: -55.431 });
  chequear('van 3 puntos', win.__vertices().length === 3);
  chequear('"Terminar" ya se habilita con 3 puntos', doc.getElementById('db-terminar').disabled === false);
  win.deshacerVerticeDibujo();
  chequear('deshacer saca el último punto (quedan 2)', win.__vertices().length === 2);
  chequear('"Terminar" se vuelve a deshabilitar tras deshacer', doc.getElementById('db-terminar').disabled === true);
  win.agregarVerticeDibujo({ lat: -31.391, lng: -55.431 });

  // 8) Terminar con 3 puntos crea el potrero de punta a punta.
  win.terminarDibujoPotrero();
  chequear('modoDibujarPotrero se limpia tras terminar', win.__modoDibujo() === null);
  chequear('desaparece el control flotante', !doc.querySelector('.dibujo-controles'));
  chequear('el doble click del mapa se reactiva', win.__mapa._dblClickZoomEnabled === true);

  const nuevo = win.__potreros().find(p=>p.nombre===nombreNuevo);
  chequear('el potrero nuevo quedó en POTREROS_GEO con 3 vértices', !!nuevo && nuevo.coords.length === 3, JSON.stringify(nuevo));
  chequear('estado.potreros tiene una entrada vacía para el potrero nuevo',
    !!win.__est().potreros[nombreNuevo] && Object.keys(win.__est().potreros[nombreNuevo].animales).length === 0);
  chequear('AREA_CALCULADA quedó calculada (> 0)', win.__areaCalculada()[nombreNuevo] > 0, win.__areaCalculada()[nombreNuevo]);
  chequear('quedó dibujado en el mapa (poligonos)', !!win.__poligonos()[nombreNuevo]);

  const guardadosNuevos = JSON.parse(win.localStorage.getItem(win.__potrerosNuevosKey()) || '[]');
  chequear('quedó persistido en POTREROS_NUEVOS_KEY (igual que un import)', guardadosNuevos.some(p=>p.nombre===nombreNuevo));

  const eventoCreado = servidor.filas.eventos_sync.find(f=>f.tipo==='potrero_creado' && f.potrero===nombreNuevo);
  chequear('se mandó el evento potrero_creado', !!eventoCreado);
  chequear('el evento lleva los 3 vértices', !!eventoCreado && eventoCreado.detalle.coords.length === 3, eventoCreado && JSON.stringify(eventoCreado.detalle));

  // 9) "🗑 Eliminar potrero" ya sabe borrarlo, sin cambios adicionales --
  //    porque quedó marcado como "nuevo" exactamente igual que uno importado.
  //    (eliminarPotrero() nunca saca la entrada de POTREROS_GEO en memoria --
  //    se apoya en el location.reload() del final para reconstruirlo todo
  //    desde POTREROS_NUEVOS_KEY ya actualizado; achá el reload está
  //    stubbeado, así que lo que sí se puede verificar es lo persistido.)
  win.__confirmRespuesta = true;
  await win.eliminarPotrero(nombreNuevo);
  chequear('desapareció de estado.potreros', !win.__est().potreros[nombreNuevo]);
  const nuevosTrasBorrar = JSON.parse(win.localStorage.getItem(win.__potrerosNuevosKey()) || '[]');
  chequear('desapareció de POTREROS_NUEVOS_KEY', !nuevosTrasBorrar.some(p=>p.nombre===nombreNuevo));
  chequear('mandó el evento potrero_eliminado', servidor.filas.eventos_sync.some(f=>f.tipo==='potrero_eliminado' && f.potrero===nombreNuevo));
  chequear('avisó que la página se recarga', win.__alerts.some(a=>a.includes('recargar')));

  // 10) "Cancelar" a mitad de dibujar no crea nada.
  const antesDeCancelar = win.__potreros().length;
  const otroNombre = 'Se Cancela';
  doc.getElementById('btn-dibujar-potrero').dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.getElementById('dp-nombre').value = otroNombre;
  doc.getElementById('dp-empezar').dispatchEvent(new win.Event('click', { bubbles: true }));
  win.agregarVerticeDibujo({ lat: -31.395, lng: -55.435 });
  win.agregarVerticeDibujo({ lat: -31.396, lng: -55.435 });
  win.agregarVerticeDibujo({ lat: -31.396, lng: -55.436 });
  doc.getElementById('db-cancelar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('Cancelar durante el dibujo no crea el potrero', win.__potreros().length === antesDeCancelar && win.__potreros().every(p=>p.nombre!==otroNombre));
  chequear('Cancelar limpia modoDibujarPotrero', win.__modoDibujo() === null);
  chequear('Cancelar limpia los vértices', win.__vertices().length === 0);
  chequear('Cancelar saca el control flotante', !doc.querySelector('.dibujo-controles'));
  chequear('Cancelar reactiva el doble click del mapa', win.__mapa._dblClickZoomEnabled === true);

  // 11) Sincronizado: otro dispositivo que recibe el mismo evento
  //     potrero_creado (el que mandó terminarDibujoPotrero() en el paso 8)
  //     construye el potrero igual, sin dibujarlo a mano.
  chequear('el evento capturado sirve para reconstruir en otro dispositivo',
    !!eventoCreado && Array.isArray(eventoCreado.detalle.coords) && eventoCreado.detalle.coords.length === 3);
  win.aplicarEventoRemoto({ tipo: 'potrero_creado', potrero: 'Llegado De Otro Dispositivo',
    detalle: { coords: [[-31.40,-55.40],[-31.41,-55.40],[-31.41,-55.41]], area: null } });
  chequear('sincronizado: el potrero llega igual por evento remoto',
    win.__potreros().some(p=>p.nombre==='Llegado De Otro Dispositivo'));
}

async function probarMovilNoTieneElBoton(archivo){
  console.log('\n=== ' + archivo + ' (no debe tener Dibujar potrero) ===');
  const { win, errores } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  chequear('el botón "Dibujar potrero" NO existe en móvil', !doc.getElementById('btn-dibujar-potrero'));
  chequear('el modal tampoco existe en móvil', !doc.getElementById('modal-dibujar-potrero'));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos){
    if(/-movil\//.test(a) || a.includes('movil')) await probarMovilNoTieneElBoton(a);
    else await probarPC(a);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
