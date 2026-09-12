/*
 * Prueba ad-hoc: si se borra O EDITA una carga de nacimiento (o muerte), el
 * conteo de "Temporada" tiene que descontarla -- antes solo restaba del
 * STOCK, nunca del total de nacimientos/muertes de la temporada. Bug real
 * encontrado el 9/9: el sistema mostraba 51 nacimientos cuando el numero
 * real (tras borrar una carga duplicada) era 49.
 *
 * Segundo bug real, encontrado el 12/9/2026: "Editar" tampoco descontaba
 * (a proposito, por diseño original) porque se asumia que el usuario
 * siempre reenvia el formulario con el valor corregido -- pero "Editar" ya
 * resta del stock real ANTES de esa recarga, y si el usuario cancela en vez
 * de reenviar, esos animales quedan restados del stock para siempre sin que
 * la temporada se entere. Corregido para descontar en los dos casos.
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

function crearServidor(eventosSemilla){
  const filas = { eventos_sync: eventosSemilla.slice() };
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          select(){ return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          insert(row){ filas[tabla] = filas[tabla] || []; filas[tabla].push(row); return Promise.resolve({error:null}); },
          then(res){ const data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r))); return Promise.resolve(res({data, error:null})); }
        };
        return q;
      } };
    }
  };
}

async function levantar(archivo, servidor){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + ';window.__est = function(){ return estado; };window.__calcNac = calcularEstadisticasNacimientos; window.__borrar = borrarHistorial; window.__editar = editarHistorial; window.__registrarHistorial = registrarHistorial; window.__registrarCambioOcupacion = registrarCambioOcupacion; window.__totalPotrero = totalPotrero; window.__establecimiento = function(){ return ESTABLECIMIENTO; };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

function fechaHoyTemporada(diaOffset){
  const hoy = new Date();
  let mes = hoy.getMonth() + 1, anio = hoy.getFullYear();
  if(mes < 8){ mes = 9; anio -= 1; }
  const dia = String(Math.min(28, 1 + diaOffset)).padStart(2,'0');
  return `${dia}/${String(mes).padStart(2,'0')}/${anio}`;
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor([
    { establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaHoyTemporada(1), detalle: { cantidad: 5, categoria: 'Terneros' } },
    { establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaHoyTemporada(2), detalle: { cantidad: 3, categoria: 'Terneros' } },
  ]);
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const antes = await win.__calcNac();
  chequear('antes de borrar nada: 8 Terneros (5+3)', antes.bovino.nacidos === 8, JSON.stringify(antes.bovino));

  // cargar una entrada de nacimiento LOCAL (con extra) y borrarla
  const est = win.__est();
  const p = Object.keys(est.potreros)[0];
  const totalAntes = win.__totalPotrero(p);
  est.potreros[p].animales['Terneros'] = (est.potreros[p].animales['Terneros']||0) + 2;
  win.__registrarCambioOcupacion(p, totalAntes);
  const fechaExtra = fechaHoyTemporada(1);
  win.__registrarHistorial(p, 'nacimiento', 'nacimiento: +2 Terneros', {potrero:p, categoria:'Terneros', cantidad:2}, undefined, fechaExtra);
  // simula que ese nacimiento SI se mando como evento en su momento (en la
  // app real pasa solo al cargarlo por el formulario -- aca se lo agrega a
  // mano al servidor simulado porque el test edita el estado directo).
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaExtra, detalle: { categoria:'Terneros', cantidad: 2 } });
  const entrada = est.potreros[p].historial.find(h=>h.tipo==='nacimiento' && !h.eliminado);
  win.__borrar(entrada.id);

  // el evento de correccion recien mandado tiene que llevar fechaOriginal
  const enviados = servidor.filas.eventos_sync;
  const correccion = enviados.find(e=>e.tipo==='correccion');
  chequear('la correccion se mando con fechaOriginal', !!(correccion && correccion.detalle.fechaOriginal), JSON.stringify(correccion));

  // agregamos la correccion "manualmente" al servidor simulado (en la app real
  // ya habria llegado sola por el insert real) y recalculamos
  const despues = await win.__calcNac();
  chequear('despues de borrar la carga de +2: sigue en 8 (no debe contar la que se borro)',
    despues.bovino.nacidos === 8, 'dio: ' + despues.bovino.nacidos);

  // "Editar" resta del stock real apenas se confirma (aplicarAjusteReversion
  // corre igual que en "Borrar"), ANTES de que el usuario llegue a reenviar
  // el formulario con el valor corregido -- si cancela esa recarga en vez de
  // reenviarla, la unica huella que queda es la correccion con esos animales
  // restados. Bug real encontrado el 12/9/2026 (La Vuelta, potrero OMBU): un
  // "Editar" sin reenvio dejo -7 Terneros afuera del stock que la temporada
  // seguia contando como si hubieran nacido. Por eso "Editar" tiene que
  // descontarse de la temporada igual que "Borrar" -- si el usuario SI
  // reenvia el valor corregido, ese reenvio entra como un evento 'nacimiento'
  // nuevo y se suma aparte (no se compensa de mas).
  const totalAntes2 = win.__totalPotrero(p);
  est.potreros[p].animales['Terneros'] = (est.potreros[p].animales['Terneros']||0) + 4;
  win.__registrarCambioOcupacion(p, totalAntes2);
  const fechaExtra2 = fechaHoyTemporada(3);
  win.__registrarHistorial(p, 'nacimiento', 'nacimiento: +4 Terneros', {potrero:p, categoria:'Terneros', cantidad:4}, undefined, fechaExtra2);
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaExtra2, detalle: { categoria:'Terneros', cantidad: 4 } });
  const entradaEditar = est.potreros[p].historial.find(h=>h.detalle==='nacimiento: +4 Terneros' && !h.eliminado);
  win.__editar(entradaEditar.id);
  const luegoDeEditar = await win.__calcNac();
  chequear('editar sin reenviar una carga de nacimiento SI descuenta de la temporada (vuelve a 8)',
    luegoDeEditar.bovino.nacidos === 8, 'esperaba 12-4=8, dio: ' + luegoDeEditar.bovino.nacidos);

  // Si despues de "Editar" el usuario SI reenvia el formulario con el valor
  // corregido, ese reenvio es un evento 'nacimiento' nuevo e independiente:
  // se suma aparte y el resultado final tiene que reflejar solo el valor
  // corregido, no el original ni una resta doble.
  const fechaCorregida = fechaHoyTemporada(3);
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaCorregida, detalle: { categoria:'Terneros', cantidad: 3 } });
  const luegoDeReenviar = await win.__calcNac();
  chequear('reenviar el valor corregido (3, en vez del 4 original) deja la temporada en 11',
    luegoDeReenviar.bovino.nacidos === 11, 'esperaba 8+3=11, dio: ' + luegoDeReenviar.bovino.nacidos);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
