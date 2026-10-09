/*
 * Fase 1 de la auditoría de las apps de potreros (9/10/2026): arreglos chicos que no
 * tenían ninguna prueba.
 *
 *  1. Textos sin escapar: el popup del potrero (dueño / categoría), la lista de campo
 *     ajeno y los valores precargados de los formularios (✏️ de un registro con comillas
 *     o HTML en las observaciones, la contraparte, la guía o la caravana).
 *  2. Si el navegador no deja guardar (memoria llena, modo privado) aparece un cartel
 *     hasta que un guardado vuelva a andar; antes solo quedaba un aviso en la consola.
 *  3. El filtro `in` del borrado de stock escapa comillas y barras del dueño.
 *  4. Importar un backup: valida la forma antes de tocar nada, pide confirmación con un
 *     resumen, conserva los envíos pendientes de este equipo, y si no puede guardar o
 *     interpretar el archivo no cambia nada.
 *
 * Uso: node tests/probar_fase1_arreglos.js <index.html> [<index.html> ...]
 * (las variantes PC y móvil de los 3 establecimientos; la lista de Campo ajeno y el
 * borrado de stock se prueban donde existen).
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

// Servidor simulado que registra cada consulta encadenada (tabla + métodos con sus argumentos).
function levantarApp(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const llamadas = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return { from(tabla){
    const cadena = [];
    const q = new Proxy({}, { get(t, prop){
      if(prop === 'then') return res => { llamadas.push({ tabla, cadena }); return Promise.resolve({ data: [], error: null }).then(res); };
      return (...args) => { cadena.push([prop, args]); return q; };
    } });
    return q;
  } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.__pwn = 0;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + ';window.__x = { est: ()=>estado, geo: ()=>POTREROS_GEO, cfg: CONFIG, clave: STORAGE_KEY,' +
      ' guardar: guardarEstado, popup: (typeof popupContenidoPotrero === "function" ? popupContenidoPotrero : null), form: mostrarFormulario, listaPg: (typeof listaPostgrest === "function" ? listaPostgrest : null),' +
      ' pub: publicarStockPotrero, detalle: renderDetalle,' +
      ' imp: (typeof importarBackupTexto === "function" ? importarBackupTexto : null),' +
      ' ajeno: (typeof renderCampoAjenoLista === "function" ? renderCampoAjenoLista : null) };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  return new Promise(r => setTimeout(() => r({ win, errores, llamadas }), 80));
}

const COORDS_OK = [[-31.98, -56.34], [-31.98, -56.33], [-31.97, -56.33], [-31.97, -56.34]];
// Pone Chico arranca sin potreros: se crea uno de prueba. `conGeo` lo agrega también a POTREROS_GEO
// (sin polígono dibujado), lo que alcanza para los formularios pero rompe actualizarTodo().
function prepararPotrero(win, conGeo){
  const x = win.__x;
  let potrero = Object.keys(x.est().potreros)[0];
  if(!potrero){
    potrero = 'TEST';
    x.est().potreros[potrero] = { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
    if(conGeo) x.geo().push({ nombre: potrero, coords: COORDS_OK, area: 1 });
  }
  return potrero;
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');

  // ---------------------------------------------------------------- 1. textos escapados
  {
    const { win, errores } = await levantarApp(archivo);
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const x = win.__x, doc = win.document;
    // Regresión (9/10/2026): guardarEstado() se llama al arrancar cuando hay claves por migrar (La Vuelta),
    // ANTES de que se declaren sus variables internas. Con `let` declarado más abajo eso rompía el arranque.
    if(/la-vuelta/.test(archivo)) chequear('el guardado inicial (migración de claves) ocurre al arrancar', win.localStorage.getItem(x.clave) !== null);
    const potrero = prepararPotrero(win, true);

    if(x.popup){
      x.est().potreros[potrero].animales = { 'Vacas<img src=x onerror="window.__pwn=2">||Due<b id="zz">ño</b>': 4 };
      const caja = doc.createElement('div');
      caja.innerHTML = x.popup(potrero);
      chequear('popup del potrero: dueño y categoría con HTML se ven como texto',
        !caja.querySelector('img') && !caja.querySelector('b#zz') && caja.textContent.includes('<img src=x'), caja.innerHTML);
    } else {
      console.log('  --  popup del potrero: esta variante no tiene etiquetas en el mapa (se omite)');
    }

    if(x.ajeno && doc.getElementById('campo-ajeno-lista')){
      x.est().campoAjeno = { animales: {}, historial: [{ fecha: '01/02/2026', tipo: 'envio', potrero: '<img src=x onerror="window.__pwn=3">',
        items: [{ cantidad: 2, categoria: 'Vacas<img src=y>', dueno: 'Pe"<b>dro' }],
        guia: '<u>A1</u>', obs: '<svg onload="window.__pwn=4">', usuario: '<i>u</i>' }] };
      x.ajeno();
      const lista = doc.getElementById('campo-ajeno-lista');
      chequear('lista de campo ajeno: potrero, categoría, dueño, guía, obs y usuario con HTML se ven como texto',
        !lista.querySelector('img') && !lista.querySelector('svg') && !lista.querySelector('b') && !lista.querySelector('u') && !lista.querySelector('i') &&
        lista.textContent.includes('<img src=x'), lista.innerHTML);
    } else {
      console.log('  --  lista de campo ajeno: no existe en esta variante (se omite)');
    }

    x.detalle(potrero); // el formulario se pinta dentro del panel de detalle del potrero
    const OBS = 'x" onfocus="window.__pwn=5" y="<b id="zz2">';
    for(const accion of ['muerte', 'nacimiento', 'compraventa']){
      x.form(potrero, accion, { categoria: 'Vacas', cantidad: 2, dueno: 'Pe"dro', _fechaISO: '2026-02-01', _tipoOp: 'Compra',
        obs: OBS, contraparte: OBS, guia: 'A12"3456', caravana: '12345"678', precio: '5"0' });
      const campos = ['f-obs', 'f-contraparte', 'f-guia', 'f-caravana'].map(id => doc.getElementById(id)).filter(Boolean);
      if(!campos.length){ console.log('  --  formulario "' + accion + '": no tiene campos de texto en esta variante (se omite)'); continue; }
      const esperado = { 'f-obs': OBS, 'f-contraparte': OBS, 'f-guia': 'A12"3456', 'f-caravana': '12345"678' };
      chequear('formulario "' + accion + '": el valor precargado con comillas llega entero y no abre atributos',
        campos.every(c => c.value === esperado[c.id] && !c.hasAttribute('onfocus')) && !doc.getElementById('zz2'),
        campos.map(c => c.id + '=' + JSON.stringify(c.value)).join(' '));
    }
    chequear('ningún script se ejecutó', win.__pwn === 0, 'window.__pwn=' + win.__pwn);
  }

  // ---------------------------------------------------------------- 2. aviso si no se puede guardar
  {
    const { win, errores } = await levantarApp(archivo);
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const x = win.__x, doc = win.document;
    const proto = win.Storage.prototype, original = proto.setItem;
    const cartel = () => doc.querySelectorAll('#aviso-no-guardado');
    chequear('con el guardado andando no hay cartel', cartel().length === 0);
    proto.setItem = function(){ throw new Error('QuotaExceededError'); };
    x.guardar();
    chequear('si el navegador no deja guardar, aparece el cartel (role=alert)',
      cartel().length === 1 && cartel()[0].getAttribute('role') === 'alert' && /No se pudo guardar/.test(cartel()[0].textContent));
    x.guardar(); x.guardar();
    chequear('varios guardados fallidos seguidos no apilan carteles', cartel().length === 1, 'carteles=' + cartel().length);
    cartel()[0].click();
    chequear('tocar el cartel lo oculta', cartel().length === 0);
    x.guardar();
    chequear('un guardado fallido más no lo vuelve a mostrar después de ocultarlo', cartel().length === 0);
    proto.setItem = original;
    x.guardar();
    chequear('cuando el guardado vuelve a andar sigue sin cartel', cartel().length === 0);
    proto.setItem = function(){ throw new Error('QuotaExceededError'); };
    x.guardar();
    chequear('una falla nueva después de haberse recuperado vuelve a avisar', cartel().length === 1);
    proto.setItem = original;
    x.guardar();
    chequear('al recuperarse el guardado, el cartel desaparece solo', cartel().length === 0);
  }

  // ---------------------------------------------------------------- 3. filtro `in` del borrado de stock
  {
    const { win, errores, llamadas } = await levantarApp(archivo);
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const x = win.__x;
    const lista = x.listaPg ? x.listaPg(['Vacas||Pe"dro', 'a\\b', 'x,y)']) : '(no existe listaPostgrest)';
    chequear('listaPostgrest escapa comillas y barras, y deja intactas comas y paréntesis',
      lista === '("Vacas||Pe\\"dro","a\\\\b","x,y)")', lista);
    if(x.cfg.stockSupabase){
      const potrero = prepararPotrero(win, true);
      x.est().potreros[potrero].animales = { 'Vacas||Pe"dro': 3, 'Terneros||': 2 };
      llamadas.length = 0;
      await x.pub(potrero);
      const borrado = llamadas.find(l => l.tabla === 'stock_potreros' && l.cadena.some(c => c[0] === 'delete'));
      const filtro = borrado && borrado.cadena.find(c => c[0] === 'not');
      chequear('el borrado de stock manda el filtro `in` con el dueño escapado',
        !!filtro && filtro[1][2] === '("Vacas||Pe\\"dro","Terneros||")', filtro ? filtro[1][2] : 'sin filtro');
    } else {
      console.log('  --  stock en Supabase apagado en esta app (se omite el borrado)');
    }
  }

  // ---------------------------------------------------------------- 4. importar un backup
  {
    const { win, errores } = await levantarApp(archivo);
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const x = win.__x;
    if(!x.imp){ chequear('importarBackupTexto existe en esta variante', false); return; }
    const potrero = prepararPotrero(win, false);
    const tieneDueno = /maria[_-]laura|pone[_-]chico/.test(archivo);
    const clave = tieneDueno ? 'Vacas||Pedro' : 'Vacas||';
    const est0 = x.est();
    est0.colaSync = [{ event_id: 'e-pendiente', tipo: 'nacimiento', potrero, detalle: {}, fecha_cliente: '01/02/2026' }];
    est0.colaSanidad = [{ id: 'sc_a' }];
    const antes = JSON.stringify(est0);
    const intacto = () => x.est() === est0 && JSON.stringify(x.est()) === antes;

    let confirmaciones = 0, mensaje = '', respuesta = true;
    win.confirm = m => { confirmaciones++; mensaje = m; return respuesta; };

    const malos = [
      ['texto que no es JSON', 'esto no es json'],
      ['un arreglo en vez de un objeto', '[]'],
      ['potreros como arreglo', JSON.stringify({ potreros: [] })],
      ['cantidad que no es número', JSON.stringify({ potreros: { X: { animales: { 'Vacas||': 'mucho' } } } })],
      ['cantidad absurda', JSON.stringify({ potreros: { X: { animales: { 'Vacas||': 1e9 } } } })],
      ['historial que no es arreglo', JSON.stringify({ potreros: { X: { animales: {}, historial: 'no' } } })],
      ['clave __proto__', '{"potreros":{"__proto__":{"animales":{}}}}'],
      ['ugCoef que no es objeto', JSON.stringify({ potreros: {}, ugCoef: 'x' })],
      ['cola que no es arreglo', JSON.stringify({ potreros: {}, colaSync: 'x' })]
    ];
    for(const [nombre, texto] of malos){
      const r = x.imp(texto);
      chequear('backup inválido (' + nombre + ') se rechaza con un motivo', r.ok === false && !r.cancelado && typeof r.error === 'string' && r.error.length > 5, JSON.stringify(r));
    }
    chequear('los backups inválidos no pidieron confirmación ni cambiaron nada', confirmaciones === 0 && intacto());

    const backup = JSON.parse(JSON.stringify(est0));
    backup.potreros[potrero] = backup.potreros[potrero] || { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
    backup.potreros[potrero].animales = { [clave]: 7 };
    delete backup.colaSync; // un backup viejo sin cola: antes dejaba estado.colaSync indefinido
    backup.colaSanidad = [{ id: 'sc_a' }, { id: 'sc_b' }];

    respuesta = false;
    let r = x.imp(JSON.stringify(backup));
    chequear('si se cancela la confirmación no se cambia nada', r.cancelado === true && confirmaciones === 1 && intacto(), JSON.stringify(r));
    chequear('la confirmación muestra el resumen y avisa de los 2 envíos pendientes',
      /REEMPLAZA/.test(mensaje) && /animales/.test(mensaje) && /Hay 2 envío\(s\) todavía sin mandar/.test(mensaje), mensaje);

    respuesta = true;
    const proto = win.Storage.prototype, original = proto.setItem;
    proto.setItem = function(){ throw new Error('QuotaExceededError'); };
    r = x.imp(JSON.stringify(backup));
    chequear('si no se puede guardar el backup, falla con un motivo y no cambia nada',
      r.ok === false && /No se pudo guardar/.test(r.error || '') && intacto(), JSON.stringify(r));
    proto.setItem = original;

    r = x.imp(JSON.stringify(backup));
    const est1 = x.est();
    chequear('un backup válido y confirmado se importa', r.ok === true && est1 !== est0, JSON.stringify(r));
    chequear('el estado importado tiene los animales del backup', (est1.potreros[potrero].animales[clave] || 0) === 7, JSON.stringify(est1.potreros[potrero].animales));
    chequear('lo guardado en el navegador es el backup', JSON.parse(win.localStorage.getItem(x.clave)).potreros[potrero].animales[clave] === 7);
    chequear('los envíos pendientes de este equipo se conservan aunque el backup no traiga cola',
      Array.isArray(est1.colaSync) && est1.colaSync.some(e => e.event_id === 'e-pendiente'), JSON.stringify(est1.colaSync));
    chequear('las colas se unen sin repetir (sc_a una sola vez, más sc_b)',
      est1.colaSanidad.length === 2 && est1.colaSanidad.some(e => e.id === 'sc_a') && est1.colaSanidad.some(e => e.id === 'sc_b'), JSON.stringify(est1.colaSanidad));
    chequear('el estado importado trae los valores por defecto que una recarga agregaría',
      Array.isArray(est1.colaStock) && Array.isArray(est1.colaMaestros) && est1.maestros && Array.isArray(est1.historialSanidad));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('Uso: node tests/probar_fase1_arreglos.js <index.html> ...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
