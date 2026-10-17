/*
 * Fase 4 de la auditoría, Release 1 ("modo suave"): la CLAVE DEL CAMPO (13/10/2026).
 *
 * Cada establecimiento tiene una clave (la misma para su PC, su móvil y Campo). La app la guarda en
 * `clave_campo_<ESTABLECIMIENTO>` (fuera de STORAGE_KEY) y la manda en el encabezado `x-clave-campo` de cada
 * pedido a Supabase. En este release las políticas siguen abiertas: la clave todavía no corta nada.
 *
 * Qué se prueba, en las 9 variantes:
 *  - el cliente de Supabase se crea con el encabezado `x-clave-campo` cuando hay clave, y se vuelve a crear al guardarla;
 *  - la ventana "🔑 Clave del campo": se abre sola sin clave (y no con clave), "Más tarde", ✕ y Escape, botón en
 *    Herramientas, formato de la clave, `verificar_clave` false / true / error (un fallo de verificación NUNCA se
 *    trata como clave inválida) y que no guarda mientras no verifique;
 *  - el aviso del pie en sus dos estados ("falta" y "ya no sirve"), la verificación una sola vez por apertura;
 *  - no se abre sola con automatización (navigator.webdriver), con otra ventana abierta (¿Quién sos?) ni sin un
 *    cliente que pueda comprobarla;
 *  - "Restablecer datos de fábrica" NO borra la clave, y la clave no sale en el Backup JSON, en el estado
 *    guardado ni en la copia de las colas;
 *  - la anulación de un traslado (anular_traslado, en el stream del destino) lleva `origenEstablecimiento`;
 *  - el cartel de movimientos trabados dice "revisá la clave del campo" ante un 42501 / 401 / 403 y no ante otros.
 *
 * Pone Chico no usa clave (17/10/2026): sus 3 variantes se prueban aparte, con probarVarianteSinClave.
 *
 * Las claves de acá son de JUGUETE: ninguna es la de un campo real.
 *
 * Uso: node probar_clave_campo.js la-vuelta-pc/index.html [...]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

const CLAVE = 'claveprueba1';           // de juguete
const CLAVE_ESCRITA = '  ClavePrueba1 '; // como la escribiría alguien: mayúsculas y espacios en los extremos

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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; },
    doubleClickZoom: { disable(){}, enable(){} } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

function estDeArchivo(archivo){
  if(/la-vuelta/.test(archivo)) return 'la_vuelta';
  if(/maria-laura/.test(archivo)) return 'maria_laura';
  return 'pone_chico';
}

/* opciones: usuario ('Pedro' por defecto; '' = sin nombre, así "¿Quién sos?" se abre solo), clave (guardada de
   antemano), webdriver, conRpc (true), enLinea (true), responder(args) -> {data, error} (por defecto, false). */
async function levantar(archivo, op){
  op = Object.assign({ usuario: 'Pedro', clave: null, webdriver: false, conRpc: true, enLinea: true }, op || {});
  const est = estDeArchivo(archivo);
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if(!/Not implemented: navigation/i.test(e.message || '')) errores.push('jsdomError: ' + (e.stack || e.message)); });
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  const srv = { creaciones: [], rpc: [], insertados: [], responder: op.responder || (() => ({ data: false, error: null })) };
  win.supabase = { createClient(url, key, opts){
    srv.creaciones.push({ url, key, opts });
    const c = { from(tabla){
      const q = new Proxy({}, { get(t, prop){
        if(prop === 'insert') return (row) => { srv.insertados.push({ tabla, row }); return Promise.resolve({ error: null }); };
        if(prop === 'then') return (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
        return () => q;
      } });
      return q;
    } };
    if(op.conRpc){
      c.rpc = (nombre, args) => {
        srv.rpc.push({ nombre, args, headers: (opts && opts.global && opts.global.headers) || null });
        try{ return Promise.resolve(srv.responder(args)); }catch(e){ return Promise.reject(e); }
      };
    }
    return c;
  } };
  Object.defineProperty(win.navigator, 'onLine', { get(){ return op.enLinea; }, configurable: true });
  if(op.webdriver) Object.defineProperty(win.navigator, 'webdriver', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const capturados = [];
  win.URL.createObjectURL = (blob) => { capturados.push(blob); return 'blob:x'; };
  win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  // el retardo para abrir la ventana sola (3500 ms) y su reintento (2500 ms) se acortan; lo demás queda igual
  const setTimeoutReal = win.setTimeout.bind(win);
  win.setTimeout = (fn, ms, ...a) => setTimeoutReal(fn, (ms === 3500 || ms === 2500) ? 20 : ms, ...a);
  if(op.usuario) win.localStorage.setItem('potreros_nombre_usuario', op.usuario);
  if(op.clave) win.localStorage.setItem('clave_campo_' + est, op.clave);
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  // `const`/`let` de un eval no quedan globales: __ev evalúa dentro del mismo ámbito que la app
  try{ win.eval(codigo + '\n;window.__ev = (s) => eval(s);'); }catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await esperar(80);
  const doc = win.document;
  const api = {
    win, doc, srv, errores, est, capturados,
    modal: () => doc.getElementById('modal-clave-campo'),
    abierta: () => doc.getElementById('modal-clave-campo').style.display === 'flex',
    aviso: () => doc.getElementById('aviso-clave'),
    error: () => { const e = doc.getElementById('clave-error'); return e.style.display === 'none' ? '' : e.textContent; },
    click: (id) => doc.getElementById(id).dispatchEvent(new win.Event('click', { bubbles: true })),
    escribir: (v) => { doc.getElementById('clave-input').value = v; },
    guardada: () => win.localStorage.getItem('clave_campo_' + est),
    ev: (codigoJs) => win.__ev(codigoJs),
    nombre: () => win.__ev('CONFIG.nombre'),
    leerBlob: (blob) => new Promise((res, rej) => { const r = new win.FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(blob); })
  };
  return api;
}

/* 17/10/2026, a pedido de Pedro: Pone Chico NO usa clave del campo (CONFIG.claveCampo = false). Ni ventana, ni
   aviso, ni botón, ni encabezado, ni verificación, aunque haya una clave vieja guardada en el equipo. */
async function probarVarianteSinClave(archivo){
  console.log('\n=== ' + archivo + ' (sin clave del campo) ===');
  for(const guardada of [null, 'clavevieja123']){
    const t = await levantar(archivo, { clave: guardada });
    const rotulo = guardada ? ' (con una clave vieja guardada)' : '';
    if(t.errores.length){ chequear('carga sin errores' + rotulo, false, t.errores[0]); return; }
    chequear('carga sin errores' + rotulo, true);
    await esperar(120);
    chequear('la ventana no se abre sola' + rotulo, !t.modal() || !t.abierta());
    chequear('no hay aviso en el pie' + rotulo, !t.aviso());
    const btn = t.doc.getElementById('btn-clave-campo');
    chequear('el botón "Clave del campo" está oculto' + rotulo, !btn || btn.style.display === 'none');
    if(btn){ t.click('btn-clave-campo'); chequear('tocar el botón no abre la ventana' + rotulo, !t.abierta()); }
    t.ev('clienteSupabase()');
    const creaciones = t.srv.creaciones;
    chequear('el cliente de Supabase no manda x-clave-campo' + rotulo,
      creaciones.length > 0 && creaciones.every(c => !(c.opts && c.opts.global && c.opts.global.headers && c.opts.global.headers['x-clave-campo'])),
      JSON.stringify(creaciones.map(c => c.opts && c.opts.global && c.opts.global.headers)));
    chequear('no se llamó a verificar_clave' + rotulo, t.srv.rpc.length === 0, JSON.stringify(t.srv.rpc));
  }
}

async function probarVariante(archivo){
  if(/pone-chico/.test(archivo)) return probarVarianteSinClave(archivo);
  console.log('\n=== ' + archivo + ' ===');
  const hayRestablecer = !/movil-campo/.test(archivo);
  const hayBackup = !/movil-campo/.test(archivo);

  // ---- sin clave: se abre sola, aviso "falta", cliente sin encabezado
  {
    const t = await levantar(archivo);
    if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
    chequear('carga sin errores', true);
    chequear('existe la ventana #modal-clave-campo', !!t.modal());
    if(!t.modal()) return;
    await esperar(80);
    chequear('sin clave guardada, la ventana "Clave del campo" se abre sola', t.abierta());
    const nombre = t.nombre();
    chequear('título "🔑 Clave del campo"', /Clave del campo/.test(t.modal().querySelector('h3').textContent));
    chequear('subtítulo: "<campo> · se pide una sola vez en este equipo"',
      t.doc.getElementById('clave-subtitulo').textContent === nombre + ' · se pide una sola vez en este equipo',
      t.doc.getElementById('clave-subtitulo').textContent);
    chequear('texto: "Escribí la clave de <campo>. Si no la tenés, pedísela a Pedro."',
      t.doc.getElementById('clave-texto').textContent === 'Escribí la clave de ' + nombre + '. Si no la tenés, pedísela a Pedro.',
      t.doc.getElementById('clave-texto').textContent);
    const input = t.doc.getElementById('clave-input');
    chequear('el campo es de texto visible (no password) y de 44 px / 16 px',
      input.getAttribute('type') === 'text' && /44px/.test(t.doc.documentElement.innerHTML.match(/#clave-input\{[^}]*\}/)[0]) && /16px/.test(t.doc.documentElement.innerHTML.match(/#clave-input\{[^}]*\}/)[0]));
    chequear('botones "Guardar" y "Más tarde" y la nota gris',
      t.doc.getElementById('clave-guardar').textContent === 'Guardar' && t.doc.getElementById('clave-mas-tarde').textContent === 'Más tarde'
      && /Sin la clave la app sigue andando por ahora\. Más adelante va a hacer falta para sincronizar\./.test(t.modal().textContent));
    chequear('aviso del pie: "🔑 Falta la clave del campo · tocá para cargarla"',
      !!t.aviso() && t.aviso().textContent === '🔑 Falta la clave del campo · tocá para cargarla' && t.aviso().className === 'falta',
      t.aviso() && t.aviso().textContent);
    chequear('el aviso está debajo del estado de sincronización',
      t.aviso() && t.aviso().previousElementSibling && t.aviso().previousElementSibling.id === 'estado-sync');
    chequear('el cliente de Supabase se creó SIN encabezado x-clave-campo',
      t.srv.creaciones.length >= 1 && t.srv.creaciones.every(c => !(c.opts.global && c.opts.global.headers && c.opts.global.headers['x-clave-campo'])),
      JSON.stringify(t.srv.creaciones.map(c => c.opts.global && c.opts.global.headers)));
    chequear('no se llamó a verificar_clave solo (no hay nada que verificar)', t.srv.rpc.length === 0);

    // "Más tarde" cierra, no guarda y no se vuelve a abrir sola
    t.click('clave-mas-tarde');
    chequear('"Más tarde" cierra la ventana', !t.abierta());
    await esperar(120);
    chequear('"Más tarde": no se vuelve a abrir sola en esta apertura', !t.abierta());
    chequear('"Más tarde": no se guardó nada', t.guardada() === null);
    chequear('"Más tarde": el aviso del pie sigue', !!t.aviso());

    // el aviso abre la ventana
    t.aviso().dispatchEvent(new t.win.Event('click', { bubbles: true }));
    chequear('tocar el aviso del pie abre la ventana', t.abierta());
    // la ✕
    t.click('clave-cerrar-x');
    chequear('la ✕ cierra como "Más tarde"', !t.abierta());
    // Escape
    t.click('btn-clave-campo');
    chequear('"🔑 Clave del campo" en Herramientas abre la ventana', t.abierta());
    t.doc.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    chequear('Escape cierra la ventana', !t.abierta());
    // el botón está en el lugar de siempre ("Este dispositivo" en la PC)
    const btn = t.doc.getElementById('btn-clave-campo');
    chequear('el botón "🔑 Clave del campo" existe y dice eso', !!btn && /🔑 Clave del campo/.test(btn.textContent));
    if(/-pc\//.test(archivo)){
      const grupo = btn.closest('.hg');
      chequear('PC: está en el grupo "Este dispositivo"', !!grupo && /Este dispositivo/.test(grupo.querySelector('.hg-titulo').textContent));
    }
    t.click('btn-herramientas');
    t.click('btn-clave-campo');
    chequear('desde Herramientas: se cierra la caja y se abre la ventana',
      t.doc.getElementById('modal-herramientas').style.display === 'none' && t.abierta());
  }

  // ---- formato de la clave: ni siquiera se pregunta al servidor
  {
    const t = await levantar(archivo);
    if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
    await esperar(80);
    const casos = [['', /Escribí la clave/], ['abc', /al menos 8 caracteres/], ['clave con espacios', /sin espacios/],
      ['contraseña1', /sin tildes ni ñ/], ['claveconáccento', /sin tildes ni ñ/], ['a'.repeat(65), /al menos 8 caracteres/]];
    for(const [valor, re] of casos){
      t.escribir(valor);
      t.click('clave-guardar');
      await esperar(20);
      chequear('clave mal formada ' + JSON.stringify(valor.length > 20 ? valor.slice(0, 8) + '…' : valor) + ': mensaje claro', re.test(t.error()), t.error());
    }
    chequear('clave mal formada: no se llamó a verificar_clave ni se guardó nada', t.srv.rpc.length === 0 && t.guardada() === null);
    chequear('clave mal formada: la ventana sigue abierta', t.abierta());
  }

  // ---- verificar_clave devuelve false: no guarda, mensaje de clave incorrecta
  {
    const t = await levantar(archivo, { responder: () => ({ data: false, error: null }) });
    await esperar(80);
    t.escribir(CLAVE_ESCRITA);
    t.click('clave-guardar');
    await esperar(40);
    const nombre = t.nombre();
    chequear('verificar_clave false: "Esa no es la clave de <campo>. Revisala y probá de nuevo."',
      t.error() === 'Esa no es la clave de ' + nombre + '. Revisala y probá de nuevo.', t.error());
    chequear('verificar_clave false: no se guardó la clave', t.guardada() === null);
    chequear('verificar_clave false: la ventana sigue abierta y el botón vuelve a estar disponible',
      t.abierta() && !t.doc.getElementById('clave-guardar').disabled);
    chequear('se llamó a verificar_clave con el campo y la clave normalizada (minúsculas, sin espacios)',
      t.srv.rpc.length === 1 && t.srv.rpc[0].nombre === 'verificar_clave'
      && t.srv.rpc[0].args.est === t.est && t.srv.rpc[0].args.clave === CLAVE, JSON.stringify(t.srv.rpc[0] && t.srv.rpc[0].args));
  }

  // ---- fallos de verificación: NUNCA son "clave inválida", y no guardan
  {
    const MSG = /No se pudo comprobar la clave ahora \(sin conexión\)\. Probá de nuevo cuando tengas señal\./;
    const variantes = [
      ['error del RPC', { responder: () => ({ data: null, error: { message: 'function not found', code: 'PGRST202' } }) }],
      ['el RPC tira una excepción (red)', { responder: () => { throw new Error('Failed to fetch'); } }],
      ['respuesta rara', { responder: () => ({ data: 'x', error: null }) }],
      ['sin conexión', { enLinea: false }],
      ['cliente sin rpc', { conRpc: false }]
    ];
    for(const [nombre, op] of variantes){
      const t = await levantar(archivo, op);
      await esperar(80);
      t.click('btn-clave-campo');
      t.escribir(CLAVE);
      t.click('clave-guardar');
      await esperar(40);
      chequear('[' + nombre + '] mensaje de "no se pudo comprobar", no de clave incorrecta', MSG.test(t.error()) && !/Esa no es la clave/.test(t.error()), t.error());
      chequear('[' + nombre + '] no se guardó la clave', t.guardada() === null);
    }
  }

  // ---- verificar_clave devuelve true: guarda (normalizada), cierra, recrea el cliente con el encabezado y sincroniza
  {
    const t = await levantar(archivo, { responder: () => ({ data: true, error: null }) });
    await esperar(80);
    chequear('(antes) el cliente no mandaba la clave', t.srv.creaciones.every(c => !(c.opts.global && c.opts.global.headers)));
    const antes = t.srv.creaciones.length;
    t.escribir(CLAVE_ESCRITA);
    t.click('clave-guardar');
    await esperar(80);
    chequear('verificar_clave true: la clave quedó en clave_campo_<campo>, normalizada', t.guardada() === CLAVE, String(t.guardada()));
    chequear('verificar_clave true: la ventana se cerró', !t.abierta());
    chequear('verificar_clave true: el aviso del pie desapareció', !t.aviso());
    const ultimo = t.srv.creaciones[t.srv.creaciones.length - 1];
    chequear('se volvió a crear el cliente, ahora con el encabezado x-clave-campo',
      t.srv.creaciones.length > antes && ultimo.opts.global.headers && ultimo.opts.global.headers['x-clave-campo'] === CLAVE,
      JSON.stringify(ultimo && ultimo.opts.global && ultimo.opts.global.headers));
    chequear('el cliente nuevo conserva el timeout de red de siempre (global.fetch)', typeof ultimo.opts.global.fetch === 'function');
    chequear('la clave no está en el estado guardado de la app (STORAGE_KEY)',
      !String(t.win.localStorage.getItem(t.ev('STORAGE_KEY')) || '').includes(CLAVE));
  }

  // ---- con la clave guardada: encabezado desde el arranque, no se abre sola, se verifica UNA vez
  {
    const t = await levantar(archivo, { clave: CLAVE, responder: () => ({ data: true, error: null }) });
    if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
    await esperar(80);
    const primero = t.srv.creaciones[0];
    chequear('con clave guardada, el cliente nace con el encabezado x-clave-campo',
      !!primero && primero.opts.global.headers && primero.opts.global.headers['x-clave-campo'] === CLAVE,
      JSON.stringify(primero && primero.opts.global));
    chequear('con clave guardada, la ventana NO se abre sola', !t.abierta());
    chequear('con clave guardada y verificada, el pie no muestra ningún aviso', !t.aviso());
    await t.ev('sincronizar(false)');
    await t.ev('sincronizar(false)');
    await esperar(40);
    const verificaciones = t.srv.rpc.filter(r => r.args.clave === CLAVE);
    chequear('la clave guardada se verifica UNA sola vez por apertura (aunque haya varias sincronizaciones)',
      verificaciones.length === 1, String(verificaciones.length));
    chequear('el RPC de verificación también viaja con el encabezado', verificaciones[0] && verificaciones[0].headers && verificaciones[0].headers['x-clave-campo'] === CLAVE);
    chequear('con la clave guardada, la ventana lo dice y deja cambiarla',
      (t.click('btn-clave-campo'), t.abierta() && /ya tiene la clave cargada/.test(t.doc.getElementById('clave-cargada').textContent)));
  }

  // ---- la clave guardada ya no sirve: aviso rojo; un error de red no cambia nada
  {
    const t = await levantar(archivo, { clave: CLAVE, responder: () => ({ data: false, error: null }) });
    await esperar(80);
    await t.ev('sincronizar(false)');
    await esperar(40);
    chequear('la guardada no verifica: aviso rojo "🔑 La clave guardada ya no sirve · tocá para cambiarla"',
      !!t.aviso() && t.aviso().textContent === '🔑 La clave guardada ya no sirve · tocá para cambiarla' && t.aviso().className === 'invalida',
      t.aviso() && t.aviso().textContent);
    chequear('la guardada no verifica: la ventana NO se abre sola', !t.abierta());
    t.aviso().dispatchEvent(new t.win.Event('click', { bubbles: true }));
    chequear('tocar el aviso rojo abre la ventana, que dice que ya no sirve',
      t.abierta() && /ya no sirve/.test(t.doc.getElementById('clave-cargada').textContent));
    const t2 = await levantar(archivo, { clave: CLAVE, responder: () => { throw new Error('Failed to fetch'); } });
    await esperar(80);
    await t2.ev('sincronizar(false)');
    await esperar(40);
    chequear('error de red al verificar la guardada: no cambia el estado (sin aviso)', !t2.aviso());
  }

  // ---- no se abre sola: automatización, otra ventana abierta, sin cliente que compruebe
  {
    const t = await levantar(archivo, { webdriver: true });
    await esperar(120);
    chequear('con navigator.webdriver (automatización) no se abre sola', !t.abierta());
    chequear('con navigator.webdriver el aviso del pie igual está', !!t.aviso());
    const t2 = await levantar(archivo, { conRpc: false });
    await esperar(120);
    chequear('con un cliente sin rpc no se abre sola', !t2.abierta());
    const t3 = await levantar(archivo, { usuario: '' });
    await esperar(120);
    chequear('con "¿Quién sos?" abierta, no se abre encima', t3.doc.getElementById('modal-usuario').style.display === 'flex' && !t3.abierta());
    t3.click('usuario-cancelar');
    await esperar(120);
    chequear('al cerrar "¿Quién sos?", se abre sola', t3.abierta());
  }

  // ---- Restablecer datos de fábrica NO borra la clave
  if(hayRestablecer){
    const t = await levantar(archivo, { clave: CLAVE });
    await esperar(60);
    const tieneBoton = !!t.doc.getElementById('btn-restablecer');
    chequear('existe "Restablecer datos de fábrica"', tieneBoton);
    if(tieneBoton){
      t.click('btn-restablecer');
      chequear('"Restablecer datos de fábrica" NO borra la clave del campo', t.guardada() === CLAVE, String(t.guardada()));
      chequear('(y sí borra el estado y el ID de dispositivo, como siempre)',
        t.win.localStorage.getItem(t.ev('STORAGE_KEY')) === null && t.win.localStorage.getItem(t.ev('DISPOSITIVO_KEY')) === null);
    }
  }

  // ---- la clave no sale en ningún archivo que la app descarga
  {
    const t = await levantar(archivo, { clave: CLAVE, responder: () => ({ data: true, error: null }) });
    await esperar(60);
    await t.ev('sincronizar(false)');
    if(hayBackup){
      t.click('btn-exportar-json');
      const blob = t.capturados[t.capturados.length - 1];
      const texto = blob ? await t.leerBlob(blob) : '';
      chequear('el Backup JSON se generó', texto.length > 10);
      chequear('el Backup JSON NO contiene la clave', !texto.includes(CLAVE) && !/clave_campo|x-clave-campo/i.test(texto));
    }
    t.ev('estado.colaSync.push({event_id:"11111111-1111-4111-8111-111111111111",tipo:"ingreso",potrero:"P",detalle:{},fecha_cliente:"01/01/2026"})');
    const antes = t.capturados.length;
    t.ev('descargarCopiaColas()');
    const copia = t.capturados[t.capturados.length - 1];
    chequear('"Descargar copia" generó un archivo', t.capturados.length === antes + 1);
    const textoCopia = copia ? await t.leerBlob(copia) : '';
    chequear('"Descargar copia" NO contiene la clave', textoCopia.length > 10 && !textoCopia.includes(CLAVE) && !/clave_campo|x-clave-campo/i.test(textoCopia));
    chequear('el estado en memoria no contiene la clave', !JSON.stringify(t.ev('estado')).includes(CLAVE));
  }

  // ---- anular_traslado lleva el campo de origen (la política del cierre lo mira)
  {
    const t = await levantar(archivo, { clave: CLAVE });
    await esperar(60);
    t.ev("enviarAnulacionTraslado({fecha:'01/10/2026'}, {destino:{establecimiento:'otro_campo', potrero:'Casco'}, trasladoId:'22222222-2222-4222-8222-222222222222', guia:'a123456'}, '33333333-3333-4333-8333-333333333333')");
    await esperar(60);
    const fila = t.srv.insertados.find(x => x.tabla === 'eventos_sync' && x.row.tipo === 'correccion' && x.row.detalle.accion === 'anular_traslado');
    chequear('anular_traslado: se escribe una corrección en el stream del destino', !!fila && fila.row.establecimiento === 'otro_campo', JSON.stringify(fila));
    chequear('anular_traslado: detalle.origenEstablecimiento es el id de ESTE campo (no un nombre para mostrar)',
      !!fila && fila.row.detalle.origenEstablecimiento === t.est && t.est !== t.nombre(), JSON.stringify(fila && fila.row.detalle));
    chequear('anular_traslado: conserva los campos de siempre (tipoOriginal, trasladoId, guia, fechaOriginal)',
      !!fila && fila.row.detalle.tipoOriginal === 'traslado_entrada' && fila.row.detalle.trasladoId === '22222222-2222-4222-8222-222222222222'
      && fila.row.detalle.guia === 'a123456' && fila.row.detalle.fechaOriginal === '01/10/2026');
  }

  // ---- cartel de movimientos trabados: pista de la clave solo ante permisos
  {
    const t = await levantar(archivo, { clave: CLAVE });
    await esperar(60);
    if(!t.ev('!!CONFIG.colaOrdenada')){
      console.log('  · sin colaOrdenada: no hay cartel de trabados, se salta.');
    }else{
      const trabar = (codigo, status) => t.ev(`
        estado.colaSync = [{event_id:'44444444-4444-4444-8444-444444444444',tipo:'ingreso',potrero:'P',detalle:{},fecha_cliente:'01/01/2026'}];
        estado.fallos = {sync:{codigo:${JSON.stringify(codigo)},mensaje:'x',status:${status},fecha:new Date().toISOString(),permanente:true,intentos:1}};
        renderAvisoTrabado(); document.getElementById('aviso-trabado').textContent;`);
      chequear('42501: el cartel dice "revisá la clave del campo 🔑"', /revisá la clave del campo 🔑/.test(trabar('42501', 401)));
      chequear('401 sin código: el cartel dice "revisá la clave del campo 🔑"', /revisá la clave del campo 🔑/.test(trabar('', 401)));
      chequear('403: el cartel dice "revisá la clave del campo 🔑"', /revisá la clave del campo 🔑/.test(trabar('', 403)));
      chequear('22P02 (400): el cartel NO habla de la clave', !/clave del campo/.test(trabar('22P02', 400)));
    }
  }
}

(async () => {
  for(const archivo of process.argv.slice(2)) await probarVariante(archivo);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
