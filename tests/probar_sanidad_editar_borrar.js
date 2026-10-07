/*
 * Prueba ad-hoc: editar y borrar un tratamiento de Sanidad ya cargado, solo en la PC
 * (7/10/2026). Los tratamientos viven en la tabla de CONFIG.tablaSanidad (no en
 * eventos_sync). Cubre:
 *   - ✏️/🗑 solo en la PC (la movil completa y Campo no los tienen);
 *   - La Vuelta: lo que el Excel ya importo (importado_en) no se puede tocar;
 *   - borrar pide confirmacion, y con RLS bloqueando (el servidor contesta 200 con
 *     lista vacia, como PostgREST) la app AVISA en vez de decir "borrado";
 *   - editar precarga el formulario (catalogo y "Otro", grupal e individual, dueno
 *     en Maria Laura/Pone Chico) y actualiza la MISMA fila, sin crear otra;
 *   - una tarjeta todavia en la cola offline se edita/borra localmente.
 *
 * Uso: node probar_sanidad_editar_borrar.js la-vuelta-pc/index.html maria-laura-pc/index.html [...]
 *      (por cada "<prefijo>-pc" levanta tambien "<prefijo>-movil" y "<prefijo>-movil-campo")
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

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


/* Servidor falso con "permisos": si permisos.update / permisos.delete estan en false
   contesta 200 con la lista vacia (asi contesta PostgREST cuando RLS bloquea). */
function crearServidor(){
  const tablas = { eventos_sync: [], productos_catalogo: [
    { producto: 'Ivermectina', categoria: 'Parásitos', dias_retiro: 28, dias_residual: null, valor_dosis_ml: 0.5 },
    { producto: 'Garrapaticida X', categoria: 'Garrapata', dias_retiro: 14, dias_residual: 30, valor_dosis_ml: 0.3 }
  ] };
  const permisos = { update: true, delete: true };
  const registro = { llamadas: [] };
  return {
    tablas, permisos, registro,
    createClient(){
      return { from(nombre){
        tablas[nombre] = tablas[nombre] || [];
        const q = {
          _modo: 'select', _filtros: [], _orden: null, _devolver: false, _cambios: null, _filas: null,
          select(){ if(q._modo === 'select') q._modo = 'select'; else q._devolver = true; return q; },
          insert(rows){ q._modo = 'insert'; q._filas = Array.isArray(rows) ? rows : [rows]; return q; },
          update(obj){ q._modo = 'update'; q._cambios = obj; return q; },
          delete(){ q._modo = 'delete'; return q; },
          upsert(rows){ q._modo = 'insert'; q._filas = Array.isArray(rows) ? rows : [rows]; return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          is(col, val){ q._filtros.push(r => (r[col] == null) === (val === null)); return q; },
          gt(col, val){ q._filtros.push(r => r[col] > val); return q; },
          gte(col, val){ q._filtros.push(r => r[col] >= val); return q; },
          in(col, vals){ q._filtros.push(r => vals.includes(r[col])); return q; },
          not(){ return q; },
          limit(){ return q; },
          order(col, o){ q._orden = { col, asc: !o || o.ascending !== false }; return q; },
          then(res){
            registro.llamadas.push({ tabla: nombre, modo: q._modo });
            const filas = tablas[nombre];
            const quedan = () => filas.filter(r => q._filtros.every(f => f(r)));
            if(q._modo === 'insert'){
              q._filas.forEach(f => filas.push(Object.assign({}, f)));
              return Promise.resolve(res({ data: q._filas, error: null }));
            }
            if(q._modo === 'update'){
              if(!permisos.update) return Promise.resolve(res({ data: [], error: null }));
              const objetivo = quedan();
              objetivo.forEach(r => Object.assign(r, q._cambios));
              return Promise.resolve(res({ data: q._devolver ? objetivo.map(r => Object.assign({}, r)) : null, error: null }));
            }
            if(q._modo === 'delete'){
              if(!permisos.delete) return Promise.resolve(res({ data: [], error: null }));
              const objetivo = quedan();
              tablas[nombre] = filas.filter(r => !objetivo.includes(r));
              return Promise.resolve(res({ data: q._devolver ? objetivo : null, error: null }));
            }
            let data = quedan();
            if(q._orden) data = data.slice().sort((a, b) => { const av = a[q._orden.col], bv = b[q._orden.col]; return (av < bv ? -1 : av > bv ? 1 : 0) * (q._orden.asc ? 1 : -1); });
            return Promise.resolve(res({ data: data.map(r => Object.assign({}, r)), error: null }));
          }
        };
        return q;
      } };
    }
  };
}

async function levantar(archivo, servidor, antes){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  if(antes) antes(win);
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__establecimiento = function(){ return ESTABLECIMIENTO; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
      window.__config = function(){ return CONFIG; };
      window.__storageKey = function(){ return STORAGE_KEY; };
      window.__nuevosKey = function(){ return POTREROS_NUEVOS_KEY; };
      
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}



const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const ids = (win) => Array.from(win.document.querySelectorAll('#sanidad-lista [data-sanidad-editar]')).map(b => b.dataset.sanidadEditar);
const hayBorrar = (win, id) => !!win.document.querySelector(`#sanidad-lista [data-sanidad-borrar="${id}"]`);
async function abrirSanidad(dev){
  click(dev.win, dev.win.document.getElementById('btn-sanidad'));
  await dormir(80);
}
const toastTxt = (win) => win.document.getElementById('toast').textContent;

async function probarEstablecimiento(archivoPc){
  console.log('\n=== ' + archivoPc + ' ===');
  const base = archivoPc.replace(/-pc[\\/]index\.html$/, '');
  const servidor = crearServidor();
  const A = await levantar(archivoPc, servidor);
  const F = await levantar(base + '-movil/index.html', servidor);
  const C = await levantar(base + '-movil-campo/index.html', servidor);
  const errores = [...A.errores, ...F.errores, ...C.errores];
  chequear('las 3 apps (PC, móvil completa, Campo) cargan sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const win = A.win;
  const tabla = win.__config().tablaSanidad;
  const nativa = !win.__config().usaExcelBridge;       // María Laura / Pone Chico (sin Excel)
  const estab = win.__establecimiento();
  const geo = win.__potrerosGeo();
  const potrero = geo.length ? geo[0].nombre : 'PotreroX';
  const categoria = win.eval('opcionesCategorias()').match(/value="([^"]+)"/)[1];
  const dueno = nativa ? (win.__config().duenos || ['Dueño'])[0] : null;
  const hoy = win.fechaISOHoy();
  const fila = (id, extra) => Object.assign({ id, fecha: hoy, categoria, potrero, cantidad: 10, gen: null,
    producto1: 'Ivermectina', dosis1: 1, producto2: null, dosis2: null, observaciones: 'obs-' + id, caravana: null, sin_caravana: null },
    nativa ? { dueno } : { establecimiento: estab, importado_en: null }, extra || {});
  servidor.tablas[tabla] = [
    fila('sc_1'),
    fila('sc_ind', { cantidad: 1, caravana: '12345678', sin_caravana: false, producto1: 'ProductoRaro', producto2: 'Garrapaticida X', dosis2: 2 }),
    fila('sc_3'),
    fila('sc_4')
  ];
  if(!nativa) servidor.tablas[tabla].push(fila('sc_excel', { importado_en: '2026-10-01T00:00:00Z' }));
  const filasServidor = () => servidor.tablas[tabla];

  // --- botones: solo en la PC
  await abrirSanidad(A);
  chequear('la PC muestra ✏️ y 🗑 en los tratamientos cargados', ids(win).includes('sc_1') && hayBorrar(win, 'sc_1'), ids(win).join(','));
  if(!nativa) chequear('La Vuelta: lo que el Excel ya importó NO tiene botones', !ids(win).includes('sc_excel') && !hayBorrar(win, 'sc_excel'));
  await abrirSanidad(F); await abrirSanidad(C);
  chequear('la móvil completa NO tiene los botones', ids(F.win).length === 0 && F.win.document.querySelectorAll('#sanidad-lista [data-sanidad-borrar]').length === 0);
  chequear('Campo NO tiene los botones', ids(C.win).length === 0 && C.win.document.querySelectorAll('#sanidad-lista [data-sanidad-borrar]').length === 0);

  // --- borrar: confirm en falso no hace nada; en verdadero borra
  win.confirm = () => false;
  click(win, win.document.querySelector('[data-sanidad-borrar="sc_1"]'));
  await dormir(60);
  chequear('borrar con confirm en falso no cambia nada', filasServidor().some(r => r.id === 'sc_1'));
  win.confirm = () => true;
  if(!nativa){
    win.__est().historialSanidad = [{ id: 'sc_1', fecha: hoy, categoria, potrero, producto1: 'Ivermectina', dosis1: 1, producto2: null, dosis2: null, cantidad: 10 }];
  }
  click(win, win.document.querySelector('[data-sanidad-borrar="sc_1"]'));
  await dormir(120);
  chequear('borrar con confirm en verdadero lo saca de la tabla', !filasServidor().some(r => r.id === 'sc_1'));
  chequear('y la lista se actualiza sola', !ids(win).includes('sc_1'));
  chequear('y avisa "Tratamiento borrado"', /Tratamiento borrado/.test(toastTxt(win)), toastTxt(win));
  if(!nativa) chequear('La Vuelta: también sale de "Mis cargas recientes"', !win.__est().historialSanidad.some(h => h.id === 'sc_1'));

  // --- sin permiso (RLS bloquea): avisa y NO dice borrado
  servidor.permisos.delete = false;
  click(win, win.document.querySelector('[data-sanidad-borrar="sc_3"]'));
  await dormir(120);
  chequear('sin permiso de borrado: la fila sigue y avisa', filasServidor().some(r => r.id === 'sc_3') && /No se pudo/.test(toastTxt(win)), toastTxt(win));
  chequear('y NO dice "Tratamiento borrado"', !/Tratamiento borrado/.test(toastTxt(win)));
  servidor.permisos.delete = true;

  // --- La Vuelta: el Excel lo importó mientras tanto (la tarjeta ya estaba dibujada)
  if(!nativa){
    filasServidor().find(r => r.id === 'sc_4').importado_en = '2026-10-07T01:00:00Z';
    click(win, win.document.querySelector('[data-sanidad-borrar="sc_4"]'));
    await dormir(120);
    chequear('La Vuelta: si el Excel lo importó mientras tanto, no se borra y avisa', filasServidor().some(r => r.id === 'sc_4') && /No se pudo/.test(toastTxt(win)), toastTxt(win));
    filasServidor().find(r => r.id === 'sc_4').importado_en = null;
  }

  // --- editar uno individual con producto fuera del catálogo y producto 2 del catálogo
  const antes = filasServidor().length;
  click(win, win.document.querySelector('[data-sanidad-editar="sc_ind"]'));
  await dormir(120);
  const d = win.document;
  chequear('editar abre el formulario en modo corrección', d.getElementById('form-sanidad').style.display === 'block' && d.getElementById('sc-guardar').textContent === 'Guardar corrección');
  chequear('y lo abre en modo individual, con la caravana', d.getElementById('sc-fila-caravana').style.display !== 'none' && d.getElementById('sc-caravana').value === '12345678');
  chequear('precarga fecha, categoría, potrero y cantidad', d.getElementById('sc-fecha').value === hoy && d.getElementById('sc-categoria').value === categoria && d.getElementById('sc-potrero').value === potrero && d.getElementById('sc-cantidad').value === '1');
  if(nativa) chequear('precarga el dueño', d.getElementById('sc-dueno').value === dueno, d.getElementById('sc-dueno').value);
  chequear('un producto que no está en el catálogo queda como "Otro" con su texto', d.getElementById('sc-producto1').value === '__otro__' && d.getElementById('sc-producto1-otro').value === 'ProductoRaro' && d.getElementById('sc-producto1-otro').style.display !== 'none',
    d.getElementById('sc-producto1').value + '|' + d.getElementById('sc-producto1-otro').value);
  chequear('un producto del catálogo se elige en el desplegable', d.getElementById('sc-producto2').value === 'Garrapaticida X');
  chequear('precarga dosis y observaciones', d.getElementById('sc-dosis1').value === '1' && d.getElementById('sc-dosis2').value === '2' && d.getElementById('sc-obs').value === 'obs-sc_ind');
  d.getElementById('sc-dosis1').value = '3';
  d.getElementById('sc-obs').value = 'corregido';
  d.getElementById('sc-guardar').click();
  await dormir(150);
  const editada = filasServidor().find(r => r.id === 'sc_ind');
  chequear('guardar actualiza la MISMA fila (dosis y observaciones)', !!editada && editada.dosis1 === 3 && editada.observaciones === 'corregido', JSON.stringify(editada));
  chequear('no crea una fila nueva', filasServidor().length === antes);
  chequear('conserva la caravana, el producto y el establecimiento', editada.caravana === '12345678' && editada.producto1 === 'ProductoRaro' && (nativa || editada.establecimiento === estab));
  chequear('cierra el formulario y avisa', d.getElementById('form-sanidad').style.display === 'none' && /corregido/.test(toastTxt(win)), toastTxt(win));

  // --- editar uno grupal
  click(win, win.document.querySelector('[data-sanidad-editar="sc_3"]'));
  await dormir(120);
  chequear('un tratamiento grupal se abre sin la fila de caravana', d.getElementById('sc-fila-caravana').style.display === 'none' && d.getElementById('sc-producto1').value === 'Ivermectina');
  d.getElementById('sc-cantidad').value = '25';
  d.getElementById('sc-guardar').click();
  await dormir(150);
  chequear('corrige la cantidad en la misma fila', filasServidor().find(r => r.id === 'sc_3').cantidad === 25);

  // --- sin permiso de edición: avisa y no cambia
  servidor.permisos.update = false;
  click(win, win.document.querySelector('[data-sanidad-editar="sc_3"]'));
  await dormir(120);
  d.getElementById('sc-cantidad').value = '99';
  d.getElementById('sc-guardar').click();
  await dormir(150);
  chequear('sin permiso de edición: no cambia y avisa', filasServidor().find(r => r.id === 'sc_3').cantidad === 25 && /No se pudo/.test(toastTxt(win)), toastTxt(win));
  chequear('y el formulario queda abierto para no perder lo tipeado', d.getElementById('form-sanidad').style.display === 'block');
  servidor.permisos.update = true;
  click(win, d.getElementById('sc-cancelar'));
  chequear('cancelar vuelve el botón a "Guardar"', d.getElementById('sc-guardar').textContent === 'Guardar');

  // --- cargar uno nuevo sigue funcionando (y no pisa nada)
  const antesNuevo = filasServidor().length;
  await win.abrirFormSanidad(false);
  d.getElementById('sc-cantidad').value = '4';
  d.getElementById('sc-producto1').value = 'Ivermectina';
  d.getElementById('sc-dosis1').value = '1';
  d.getElementById('sc-guardar').click();
  await dormir(150);
  chequear('"Guardar" de un tratamiento nuevo sigue agregando una fila', filasServidor().length === antesNuevo + 1);

  // --- una tarjeta todavía en la cola (sin señal) se edita y se borra localmente
  win.__est().colaSanidad = [fila('sc_cola', { cantidad: 7 })];
  win.renderSanidadLista(filasServidor());
  chequear('la tarjeta de la cola tiene ✏️ y 🗑', !!d.querySelector('[data-sanidad-editar="sc_cola"][data-sanidad-cola="1"]'));
  const llamadasAntes = servidor.registro.llamadas.length;
  click(win, d.querySelector('[data-sanidad-editar="sc_cola"]'));
  await dormir(120);
  d.getElementById('sc-cantidad').value = '8';
  d.getElementById('sc-guardar').click();
  await dormir(150);
  chequear('editar una de la cola cambia la cola, sin tocar el servidor', win.__est().colaSanidad[0].cantidad === 8 && !filasServidor().some(r => r.id === 'sc_cola'));
  win.renderSanidadLista(filasServidor());
  click(win, d.querySelector('[data-sanidad-borrar="sc_cola"]'));
  await dormir(120);
  chequear('borrar una de la cola la saca de la cola', win.__est().colaSanidad.length === 0);
}

(async () => {
  for(const a of process.argv.slice(2)) await probarEstablecimiento(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
