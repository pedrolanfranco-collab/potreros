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
 *
 * Tercer bug real, encontrado el mismo 12/9/2026 más tarde: restar el total
 * completo de una corrección (sin fijarse si ese potrero todavía tiene
 * tantos) hace que la temporada reste de más cuando esos animales YA se
 * movieron a otro potrero antes de corregir -- el stock real (verificado
 * por Pedro contando en el campo) no coincidía con la temporada por
 * exactamente eso. Corregido para que la temporada lleve su propio saldo
 * por potrero y clampee en 0 igual que aplicarAjusteReversion en el stock
 * -- por eso este archivo ahora necesita que el mock de Supabase soporte
 * `.order()` y asigne `creado_en` a cada evento (el orden cronológico real
 * importa para el clampeo, no solo la fecha que eligió el usuario).
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

// Reloj falso para asignar `creado_en` a los eventos "insertados" por la app
// (la correccion que arma borrarHistorial/editarHistorial) -- en Supabase de
// verdad lo pone el server al insertar. Sigue subiendo desde donde arrancó
// el ultimo evento semilla, así todo lo que la app inserte durante la
// prueba queda DESPUES cronológicamente, que es lo que importa para que el
// saldo por potrero (y su clampeo en 0) de calcularEstadisticasNacimientos
// se calcule en el orden real.
let relojFalso = Date.parse('2026-09-01T00:00:00Z');
function proximoCreadoEn(){ relojFalso += 60000; return new Date(relojFalso).toISOString(); }

function crearServidor(eventosSemilla){
  eventosSemilla.forEach(e=>{ if(!e.creado_en) e.creado_en = proximoCreadoEn(); });
  const filas = { eventos_sync: eventosSemilla.slice() };
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _orden: null,
          select(){ return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          order(col,opts){ q._orden = {col, asc: !opts || opts.ascending!==false}; return q; },
          insert(row){
            filas[tabla] = filas[tabla] || [];
            if(!row.creado_en) row.creado_en = proximoCreadoEn();
            filas[tabla].push(row);
            return Promise.resolve({error:null});
          },
          then(res){
            let data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r)));
            if(q._orden) data = data.slice().sort((a,b)=>{
              const av=a[q._orden.col], bv=b[q._orden.col];
              return (av<bv?-1:av>bv?1:0) * (q._orden.asc?1:-1);
            });
            return Promise.resolve(res({data, error:null}));
          }
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
  // potrero "OTRO" separado de p/otroPotrero: aisla el saldo de este par de
  // nacimientos semilla del resto de la prueba (el saldo por potrero de
  // calcularEstadisticasNacimientos ahora importa para el clampeo).
  const servidor = crearServidor([
    { establecimiento: 'la_vuelta', tipo: 'nacimiento', potrero: 'OTRO', fecha_cliente: fechaHoyTemporada(1), detalle: { cantidad: 5, categoria: 'Terneros' } },
    { establecimiento: 'la_vuelta', tipo: 'nacimiento', potrero: 'OTRO', fecha_cliente: fechaHoyTemporada(2), detalle: { cantidad: 3, categoria: 'Terneros' } },
  ]);
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const antes = await win.__calcNac();
  chequear('antes de borrar nada: 8 Terneros (5+3)', antes.bovino.nacidos === 8, JSON.stringify(antes.bovino));

  // aplicarAjusteReversion arma la clave con claveAnimal(categoria, dueno) --
  // como el "extra" de este nacimiento no lleva dueno (undefined), la clave
  // real es "Terneros||" (dueno vacio), no "Terneros" pelado. Se usa esa
  // misma clave acá para tocar el estado a mano, igual que la haría el
  // formulario real -- si no, un Borrar/Editar resta de una clave distinta
  // a la que se cargó y la prueba no refleja lo que pasa en la app real.
  const claveTerneros = 'Terneros||';

  // cargar una entrada de nacimiento LOCAL (con extra) y borrarla
  const est = win.__est();
  const p = Object.keys(est.potreros)[0];
  const totalAntes = win.__totalPotrero(p);
  est.potreros[p].animales[claveTerneros] = (est.potreros[p].animales[claveTerneros]||0) + 2;
  win.__registrarCambioOcupacion(p, totalAntes);
  const fechaExtra = fechaHoyTemporada(1);
  win.__registrarHistorial(p, 'nacimiento', 'nacimiento: +2 Terneros', {potrero:p, categoria:'Terneros', cantidad:2}, undefined, fechaExtra);
  // simula que ese nacimiento SI se mando como evento en su momento (en la
  // app real pasa solo al cargarlo por el formulario -- aca se lo agrega a
  // mano al servidor simulado porque el test edita el estado directo).
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', potrero: p, fecha_cliente: fechaExtra, detalle: { categoria:'Terneros', cantidad: 2 }, creado_en: proximoCreadoEn() });
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
  est.potreros[p].animales[claveTerneros] = (est.potreros[p].animales[claveTerneros]||0) + 4;
  win.__registrarCambioOcupacion(p, totalAntes2);
  const fechaExtra2 = fechaHoyTemporada(3);
  win.__registrarHistorial(p, 'nacimiento', 'nacimiento: +4 Terneros', {potrero:p, categoria:'Terneros', cantidad:4}, undefined, fechaExtra2);
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', potrero: p, fecha_cliente: fechaExtra2, detalle: { categoria:'Terneros', cantidad: 4 }, creado_en: proximoCreadoEn() });
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
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', potrero: p, fecha_cliente: fechaCorregida, detalle: { categoria:'Terneros', cantidad: 3 }, creado_en: proximoCreadoEn() });
  const luegoDeReenviar = await win.__calcNac();
  chequear('reenviar el valor corregido (3, en vez del 4 original) deja la temporada en 11',
    luegoDeReenviar.bovino.nacidos === 11, 'esperaba 8+3=11, dio: ' + luegoDeReenviar.bovino.nacidos);

  // Bug real encontrado el 12/9/2026 en La Vuelta (stock de Terneros 73 vs
  // 65 en temporada, antes del fix): si se Borra un nacimiento DESPUES de
  // que esos mismos animales ya se movieron a otro potrero, la corrección
  // no los encuentra ahí para restarlos por completo -- aplicarAjusteReversion
  // clampea el STOCK en 0 (correcto, esos animales siguen existiendo en el
  // otro potrero), y calcularEstadisticasNacimientos ahora hace lo mismo
  // con su propio saldo por potrero: solo descuenta de la temporada lo que
  // ese potrero realmente tenía en ese momento, no el total pedido.
  //
  // Usa un PAR DE POTREROS NUEVO (sin tocar todavía) para que el saldo por
  // potrero de la temporada arranque en 0 igual que el estado local -- los
  // pasos anteriores de esta prueba "reenvían" un nacimiento solo al
  // servidor simulado (no al estado local), así que reusar `p` acá
  // mezclaría dos saldos que no son el mismo número por diseño del test,
  // no por un problema real.
  const nombresPotreros = Object.keys(est.potreros);
  const p3 = nombresPotreros[2], p4 = nombresPotreros[3];
  // p3/p4 pueden traer Terneros de la carga inicial de fábrica -- se ponen
  // en 0 primero para que el clampeo de esta prueba se vea con un saldo
  // limpio, no mezclado con stock que no tiene nada que ver con el caso.
  const totalAntesLimpiar3 = win.__totalPotrero(p3), totalAntesLimpiar4 = win.__totalPotrero(p4);
  est.potreros[p3].animales[claveTerneros] = 0;
  est.potreros[p4].animales[claveTerneros] = 0;
  win.__registrarCambioOcupacion(p3, totalAntesLimpiar3); win.__registrarCambioOcupacion(p4, totalAntesLimpiar4);
  const totalAntes3 = win.__totalPotrero(p3);
  est.potreros[p3].animales[claveTerneros] = (est.potreros[p3].animales[claveTerneros]||0) + 6;
  win.__registrarCambioOcupacion(p3, totalAntes3);
  const fechaNac3 = fechaHoyTemporada(4);
  win.__registrarHistorial(p3, 'nacimiento', 'nacimiento: +6 Terneros', {potrero:p3, categoria:'Terneros', cantidad:6}, undefined, fechaNac3);
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'nacimiento', potrero: p3, fecha_cliente: fechaNac3, detalle: { categoria:'Terneros', cantidad: 6 }, creado_en: proximoCreadoEn() });
  // los 6 Terneros ya se movieron a otro potrero ANTES de corregir el
  // nacimiento original (simula un movimiento real ya aplicado, con su
  // propio evento -- si no, el saldo de calcularEstadisticasNacimientos no
  // se entera de que salieron de p3).
  const totalAntesMov = win.__totalPotrero(p3), totalAntesMovD = win.__totalPotrero(p4);
  est.potreros[p3].animales[claveTerneros] -= 6;
  est.potreros[p4].animales[claveTerneros] = (est.potreros[p4].animales[claveTerneros]||0) + 6;
  win.__registrarCambioOcupacion(p3, totalAntesMov); win.__registrarCambioOcupacion(p4, totalAntesMovD);
  servidor.filas.eventos_sync.push({ establecimiento: 'la_vuelta', tipo: 'movimiento', potrero: p3, fecha_cliente: fechaNac3, detalle: { destino: p4, categoria: 'Terneros', categoriaDestino: 'Terneros', cantidad: 6 }, creado_en: proximoCreadoEn() });
  const entradaNac3 = est.potreros[p3].historial.find(h=>h.detalle==='nacimiento: +6 Terneros' && !h.eliminado);
  win.__borrar(entradaNac3.id);
  chequear('borrar un nacimiento ya movido a otro potrero le pone piso de 0 en el STOCK (no queda en -6)',
    est.potreros[p3].animales[claveTerneros] === 0, JSON.stringify(est.potreros[p3].animales));
  const luegoDelClamp = await win.__calcNac();
  // p3 quedó en 0 (todo se había movido a p4) al momento de la corrección --
  // la resta de 6 se clampea del todo (aplicado=0), así que los +6 del
  // nacimiento original quedan contados en la temporada para siempre. Es
  // justo el comportamiento real que causaba 73 (stock) vs 65 (temporada):
  // ahora los dos números se mueven juntos ante el mismo clampeo, en vez de
  // que la temporada reste de más lo que el stock ya no pudo sacar de ahí.
  chequear('la TEMPORADA clampea igual que el stock: no descuenta de más cuando esos animales ya no están ahí',
    luegoDelClamp.bovino.nacidos === 17, 'esperaba 17 (11 + 6 que quedan contados porque la corrección se clampeó del todo), dio: ' + luegoDelClamp.bovino.nacidos);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
