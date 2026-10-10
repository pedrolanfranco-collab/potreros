/*
 * Fase 5 de la auditoría (10/10/2026): contrato de los eventos de `eventos_sync` (docs/eventos.md).
 *
 * Los scripts de la PC (pasar_traslados_a_excel.py), Hermes y el backup leen las filas que escribe la
 * app. Si la app cambia la forma de un evento, esos lectores se rompen en silencio. Esta prueba:
 *
 *  1. ESTÁTICA: todo `tipo` que emite el template está en la tabla de docs/eventos.md, y todo `tipo` de
 *     la tabla se emite (un tipo nuevo sin documentar, o uno documentado que ya no existe, falla).
 *  2. DINÁMICA: maneja La Vuelta y María Laura (PC) contra un servidor compartido, genera con la app
 *     real los eventos que leen los scripts (compra, venta, traslado salida/entrada, movimiento_guia,
 *     envío/retorno de campo ajeno y las correcciones eliminar / agregar_guia / completar_datos /
 *     anular_traslado) y valida de cada uno los campos y tipos que el contrato promete.
 *  3. Con `--salida <archivo>` (o EVENTOS_CONTRATO_SALIDA) deja esas filas en un JSON: es el fixture que
 *     usa test_contrato_eventos.py contra las funciones construir_* del script de Excel.
 *
 * Uso: node tests/probar_contrato_eventos.js la-vuelta-pc/index.html maria-laura-pc/index.html [--salida f.json]
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REGEX_FECHA = /^\d{2}\/\d{2}\/\d{4}$/;
const RAIZ = path.join(__dirname, '..');

// ---------------------------------------------------------------------------------------------
//  1. Estática: tipos del template vs. docs/eventos.md
// ---------------------------------------------------------------------------------------------
function tiposDelTemplate(){
  const t = fs.readFileSync(path.join(RAIZ, 'template', 'potreros.template.html'), 'utf-8');
  const tipos = new Set();
  const re = /enviarEvento\(\s*([^,]+),/g;
  let m;
  while((m = re.exec(t))){
    const arg = m[1].trim();
    let u = /^'([a-z_]+)'$/.exec(arg);
    if(u){ tipos.add(u[1]); continue; }
    u = /\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'$/.exec(arg);      // cond ? 'a' : 'b'
    if(u){ tipos.add(u[1]); tipos.add(u[2]); }
  }
  return tipos;
}
function tiposDocumentados(){
  const d = fs.readFileSync(path.join(RAIZ, 'docs', 'eventos.md'), 'utf-8');
  const bloque = /<!-- tipos:start -->([\s\S]*?)<!-- tipos:end -->/.exec(d);
  if(!bloque) return null;
  const tipos = new Set();
  const re = /^\|\s*`([a-z_]+)`\s*\|/gm;
  let m;
  while((m = re.exec(bloque[1]))) if(m[1] !== 'tipo') tipos.add(m[1]);   // 'tipo' es la cabecera de la tabla
  return tipos;
}
function probarDocumentacion(){
  console.log('\n=== docs/eventos.md vs. template ===');
  const real = tiposDelTemplate(), doc = tiposDocumentados();
  chequear('docs/eventos.md tiene el bloque <!-- tipos:start --> … <!-- tipos:end -->', !!doc);
  if(!doc) return;
  chequear('el template emite al menos 35 tipos de evento (la regex los encuentra)', real.size >= 35, String(real.size));
  const sinDoc = [...real].filter(t => !doc.has(t)).sort();
  const sinCodigo = [...doc].filter(t => !real.has(t)).sort();
  chequear('todo tipo que emite el template está documentado', sinDoc.length === 0, 'falta documentar: ' + sinDoc.join(', '));
  chequear('todo tipo documentado se emite en el template', sinCodigo.length === 0, 'ya no existe: ' + sinCodigo.join(', '));
}

// ---------------------------------------------------------------------------------------------
//  2. Dinámica
// ---------------------------------------------------------------------------------------------
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

// Servidor simulado COMPARTIDO (filtra por columna como Supabase, 23505 por event_id repetido)
function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [] };
  let reloj = Date.parse('2026-10-08T12:00:00Z');
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _orden: null, _modo: 'select',
          select(){ q._modo = 'select'; return q; },
          insert(rows){ q._modo = 'insert'; q._filas = Array.isArray(rows) ? rows : [rows]; return q; },
          delete(){ q._modo = 'delete'; return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          gt(col, val){ q._filtros.push(r => r[col] > val); return q; },
          not(){ return q; },
          in(col, vals){ q._filtros.push(r => vals.includes(r[col])); return q; },
          order(col, opts){ q._orden = { col, asc: !opts || opts.ascending !== false }; return q; },
          then(res){
            filas[tabla] = filas[tabla] || [];
            if(q._modo === 'insert'){
              let error = null;
              q._filas.forEach(f => {
                if(f.event_id && filas[tabla].some(r => r.event_id === f.event_id)){ error = { code: '23505', message: 'duplicate key' }; return; }
                reloj += 10;
                filas[tabla].push(Object.assign({ creado_en: new Date(reloj).toISOString() }, f));
              });
              return Promise.resolve(res({ data: q._filas, error }));
            }
            if(q._modo === 'delete'){
              const antes = filas[tabla].length;
              filas[tabla] = filas[tabla].filter(r => !q._filtros.every(f => f(r)));
              return Promise.resolve(res({ data: null, error: null, count: antes - filas[tabla].length }));
            }
            let data = filas[tabla].filter(r => q._filtros.every(f => f(r)));
            if(q._orden) data = data.slice().sort((a, b) => {
              const av = a[q._orden.col], bv = b[q._orden.col];
              return (av < bv ? -1 : av > bv ? 1 : 0) * (q._orden.asc ? 1 : -1);
            });
            return Promise.resolve(res({ data, error: null }));
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
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true, writable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__establecimiento = function(){ return ESTABLECIMIENTO; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
      window.__config = function(){ return CONFIG; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  win.__toasts = [];
  const toastOriginal = win.toast;
  win.toast = function(m){ win.__toasts.push(m); return toastOriginal(m); };
  return { win, errores };
}

function setValor(win, idOEl, val){
  const el = typeof idOEl === 'string' ? win.document.getElementById(idOEl) : idOEl;
  el.value = val;
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function abrirModo(win, modo){
  win.document.getElementById('btn-guias').click();
  setValor(win, 'mg-modo', modo);
}
function ultimoToast(win){ return win.__toasts[win.__toasts.length - 1] || ''; }

function cargarTraslado(win, o){
  abrirModo(win, 'traslado');
  win.document.getElementById('tr-origen').value = o.origen;
  win.document.getElementById('tr-destino').value = o.destino;
  win.document.getElementById('tr-guia').value = o.guia;
  win.document.getElementById('tr-fecha').value = win.fechaISOHoy();
  win.document.getElementById('tr-obs').value = o.obs || '';
  o.filas.forEach((f, i) => {
    if(i > 0) win.document.getElementById('tr-agregar-fila').click();
    const fila = win.document.querySelectorAll('#tr-filas .tr-fila')[i];
    fila.querySelector('.tr-cat').value = f.cat;
    setValor(win, fila.querySelector('.tr-dueno'), f.dueno);
    if(f.duenoDestino !== undefined) fila.querySelector('.tr-dueno-dest').value = f.duenoDestino;
    fila.querySelector('.tr-cant').value = String(f.cant);
  });
  win.document.getElementById('tr-guardar').click();
}
function cargarMovimientoGuia(win, o){
  win.document.getElementById('btn-guias').click();
  setValor(win, 'mg-modo', 'venta');
  win.document.getElementById('mg-potrero').value = o.potrero;
  win.document.getElementById('mg-guia').value = o.guia;
  win.document.getElementById('mg-desde').value = o.desde;
  win.document.getElementById('mg-hacia').value = o.hacia;
  win.document.getElementById('mg-fecha').value = win.fechaISOHoy();
  win.document.getElementById('mg-obs').value = o.obs || '';
  o.filas.forEach((f, i) => {
    if(i > 0) win.document.getElementById('mg-agregar-fila').click();
    const fila = win.document.querySelectorAll('#mg-filas .mg-fila')[i];
    fila.querySelector('.mg-cat').value = f.cat;
    fila.querySelector('.mg-cant').value = String(f.cant);
  });
  win.document.getElementById('mg-guardar').click();
}
function cargarCampoAjeno(win, o){
  abrirModo(win, 'campo_ajeno');
  setValor(win, 'ca-tipo', o.tipo);
  win.document.getElementById('ca-potrero').value = o.potrero;
  win.document.getElementById('ca-guia').value = o.guia || '';
  o.filas.forEach((f, i) => {
    if(i > 0) win.document.getElementById('ca-agregar-fila').click();
    const fila = win.document.querySelectorAll('#ca-filas .ca-fila')[i];
    fila.querySelector('.ca-cat').value = f.cat;
    fila.querySelector('.ca-dueno').value = f.dueno;
    fila.querySelector('.ca-cant').value = String(f.cant);
  });
  win.document.getElementById('ca-fecha').value = win.fechaISOHoy();
  win.document.getElementById('ca-guardar').click();
}

// Primer renglón de historial vivo de un tipo, en cualquier potrero o en el campo ajeno
function buscarHistorial(win, tipo, filtro){
  const est = win.__est();
  const listas = Object.values(est.potreros).map(p => p.historial || []);
  if(est.campoAjeno && est.campoAjeno.historial) listas.push(est.campoAjeno.historial);
  for(const lista of listas){
    const h = lista.find(x => x.tipo === tipo && !x.eliminado && (!filtro || filtro(x)));
    if(h) return h;
  }
  return null;
}

// ---- el contrato: campo -> tipo. 'string?' / 'number?' aceptan null. 'uuid' es string con formato UUID.
const ITEM = { categoria: 'string', dueno: 'string', cantidad: 'number' };
const CONTRATO = {
  compra: { categoria: 'string', dueno: 'string', cantidad: 'number', precio: 'number?', contraparte: 'string?', guia: 'string?', obs: 'string?' },
  venta: { categoria: 'string', dueno: 'string', cantidad: 'number', precio: 'number?', contraparte: 'string?', guia: 'string?', obs: 'string?' },
  traslado_salida: { items: ['array', ITEM], guia: 'string', obs: 'string?', trasladoId: 'uuid', destino: ['object', { establecimiento: 'string', nombre: 'string', potrero: 'string' }] },
  traslado_entrada: { items: ['array', ITEM], guia: 'string', obs: 'string?', trasladoId: 'uuid', origen: ['object', { establecimiento: 'string', nombre: 'string', potrero: 'string' }] },
  movimiento_guia: { items: ['array', { categoria: 'string', cantidad: 'number' }], desde: 'string', hacia: 'string', guia: 'string', obs: 'string?', movId: 'string' },
  envio_campo_ajeno: { items: ['array', ITEM], guia: 'string?', obs: 'string?' },
  retorno_campo_ajeno: { items: ['array', ITEM], guia: 'string?', obs: 'string?' }
};
const CORRECCIONES = {
  eliminar: { tipoOriginal: 'string', fechaOriginal: 'fecha', reversar: ['object', { tipo: 'string' }] },
  agregar_guia: { tipoOriginal: 'string', categoria: 'string', cantidad: 'number', dueno: 'string', guia: 'string?', fechaOriginal: 'fecha' },
  completar_datos: { tipoOriginal: 'string', categoria: 'string', cantidad: 'number', dueno: 'string', fin: 'object', precio: 'number?', contraparte: 'string?', fechaOriginal: 'fecha' },
  anular_traslado: { tipoOriginal: 'string', trasladoId: 'uuid', guia: 'string?', fechaOriginal: 'fecha' }
};

function validarTipo(v, esperado){
  let nulo = false;
  let e = esperado;
  if(Array.isArray(e)) e = e[0];
  if(typeof e === 'string' && e.endsWith('?')){ nulo = true; e = e.slice(0, -1); }
  if(v === null || v === undefined) return nulo ? '' : 'falta o es null';
  if(e === 'string') return typeof v === 'string' ? '' : 'no es string (' + typeof v + ')';
  if(e === 'number') return typeof v === 'number' && !isNaN(v) ? '' : 'no es number';
  if(e === 'uuid') return typeof v === 'string' && REGEX_UUID.test(v) ? '' : 'no es un UUID';
  if(e === 'fecha') return typeof v === 'string' && REGEX_FECHA.test(v) ? '' : 'no es dd/mm/aaaa';
  if(e === 'array') return Array.isArray(v) && v.length > 0 ? '' : 'no es un arreglo con elementos';
  if(e === 'object') return typeof v === 'object' && !Array.isArray(v) ? '' : 'no es un objeto';
  return 'tipo desconocido en el contrato: ' + e;
}
// Devuelve una lista de problemas ('campo: motivo') de `d` contra `spec`
function problemas(d, spec, prefijo){
  const out = [];
  Object.keys(spec).forEach(campo => {
    const esp = spec[campo];
    const p = validarTipo(d[campo], esp);
    if(p){ out.push((prefijo || '') + campo + ': ' + p); return; }
    if(Array.isArray(esp) && esp[1] && d[campo] !== null && d[campo] !== undefined){
      if(esp[0] === 'array') d[campo].forEach((it, i) => out.push(...problemas(it, esp[1], (prefijo || '') + campo + '[' + i + '].')));
      else out.push(...problemas(d[campo], esp[1], (prefijo || '') + campo + '.'));
    }
  });
  return out;
}
function filaOk(f){
  const p = [];
  if(!REGEX_UUID.test(f.event_id || '')) p.push('event_id no es UUID');
  if(!['la_vuelta', 'maria_laura', 'pone_chico'].includes(f.establecimiento)) p.push('establecimiento ' + f.establecimiento);
  if(typeof f.tipo !== 'string' || !f.tipo) p.push('tipo vacío');
  if(typeof f.potrero !== 'string' || !f.potrero) p.push('potrero vacío');
  if(!f.detalle || typeof f.detalle !== 'object') p.push('detalle no es objeto');
  if(!REGEX_FECHA.test(f.fecha_cliente || '')) p.push('fecha_cliente ' + f.fecha_cliente);
  return p;
}

async function probarFlujos(archivoLV, archivoML, salida){
  console.log(`\n=== Eventos reales de la app: ${archivoLV} + ${archivoML} ===`);
  const servidor = crearServidor();
  const lv = await levantar(archivoLV, servidor);
  const ml = await levantar(archivoML, servidor);
  chequear('La Vuelta y María Laura cargan sin errores', lv.errores.length === 0 && ml.errores.length === 0, lv.errores.concat(ml.errores).join(' | '));
  if(lv.errores.length || ml.errores.length) return;
  const LV = lv.win, ML = ml.win;
  const origen = LV.__potrerosGeo()[0].nombre;
  const otro = LV.__potrerosGeo()[1].nombre;
  const duenos = LV.__config().duenos.filter(d => d);
  const dVende = duenos[0], dCompra = duenos[1];
  const SILVIA = 'Silvia Dutra';
  const a = LV.__est().potreros[origen].animales;
  a[LV.claveAnimal('Vacas', SILVIA)] = 40; a[LV.claveAnimal('Terneros', SILVIA)] = 10;
  a[LV.claveAnimal('Vacas', dVende)] = 20;
  const ev = () => servidor.filas.eventos_sync;
  const nuevos = desde => ev().slice(desde);
  const ultimo = () => ev()[ev().length - 1];

  // ---- compra con guía, y después "completar datos"
  let n = ev().length;
  const okCompra = LV.registrarCompraVenta({ potrero: origen, tipoOp: 'Compra', cat: 'Vacas', dueno: SILVIA, cant: 4, fechaISO: LV.fechaISOHoy(),
    contraparte: 'Proveedor de prueba', obs: '', precio: 900, guiaRaw: 'B111111' });
  await dormir(50);
  chequear('se cargó una compra', okCompra === true, ultimoToast(LV));
  const hCompra = buscarHistorial(LV, 'compra');
  chequear('la compra dejó su renglón de historial', !!hCompra);
  const fCompra = nuevos(n).find(f => f.tipo === 'compra');
  chequear('compra: evento escrito en el stream de La Vuelta', !!fCompra && fCompra.establecimiento === 'la_vuelta' && fCompra.potrero === origen);
  if(fCompra){
    chequear('compra: fila válida (UUID, fecha dd/mm/aaaa, potrero)', filaOk(fCompra).length === 0, filaOk(fCompra).join('; '));
    const p = problemas(fCompra.detalle, CONTRATO.compra);
    chequear('compra: el detalle cumple el contrato', p.length === 0, p.join('; '));
    chequear('compra: la guía va en mayúscula con el formato A123456', fCompra.detalle.guia === 'B111111');
  }

  // ---- venta sin guía, y después "agregar guía"
  n = ev().length;
  const okVenta = LV.registrarCompraVenta({ potrero: origen, tipoOp: 'Venta', cat: 'Vacas', dueno: SILVIA, cant: 2, fechaISO: LV.fechaISOHoy(),
    contraparte: 'Frigorifico de prueba', obs: 'prueba', precio: 1000, guiaRaw: '' });
  await dormir(50);
  chequear('se cargó una venta', okVenta === true, ultimoToast(LV));
  const fVenta = nuevos(n).find(f => f.tipo === 'venta');
  if(fVenta){
    const p = problemas(fVenta.detalle, CONTRATO.venta);
    chequear('venta: fila y detalle cumplen el contrato', filaOk(fVenta).length === 0 && p.length === 0, filaOk(fVenta).concat(p).join('; '));
    chequear('venta sin guía: guia es null (no cadena vacía)', fVenta.detalle.guia === null, JSON.stringify(fVenta.detalle.guia));
  } else chequear('venta: evento escrito', false);
  const hVenta = buscarHistorial(LV, 'venta');

  n = ev().length;
  LV.prompt = () => 'c222222';
  LV.agregarGuiaCompraventa(hVenta.id);
  await dormir(50);
  const cGuia = nuevos(n).find(f => f.tipo === 'correccion');
  chequear('agregar guía: escribe una corrección', !!cGuia && cGuia.detalle.accion === 'agregar_guia', JSON.stringify(cGuia && cGuia.detalle));
  if(cGuia){
    const p = problemas(cGuia.detalle, CORRECCIONES.agregar_guia);
    chequear('agregar_guia: cumple el contrato (tipoOriginal, categoria, cantidad, dueno, guia, fechaOriginal)', p.length === 0, p.join('; '));
    chequear('agregar_guia: la guía queda en mayúscula', cGuia.detalle.guia === 'C222222', cGuia.detalle.guia);
    chequear('agregar_guia: los datos de ubicación coinciden con la venta', cGuia.detalle.categoria === 'Vacas' && cGuia.detalle.cantidad === 2 && cGuia.detalle.dueno === SILVIA);
  }

  n = ev().length;
  const okCompletar = LV.completarDatosCompraVenta(hCompra.id, { kilosNeto: 1700, tipoPrecio: 'Kg', precio: 2.1, importe: 3570 }, 'Proveedor completo');
  await dormir(50);
  chequear('completar datos de la compra', okCompletar === true);
  const cComp = nuevos(n).find(f => f.tipo === 'correccion');
  if(cComp){
    const p = problemas(cComp.detalle, CORRECCIONES.completar_datos);
    chequear('completar_datos: cumple el contrato', cComp.detalle.accion === 'completar_datos' && p.length === 0, p.join('; '));
  } else chequear('completar_datos: escribe una corrección', false);

  // ---- eliminar la venta (corrección con reversar 'sumar')
  n = ev().length;
  LV.borrarHistorial(hVenta.id);
  await dormir(50);
  const cElim = nuevos(n).find(f => f.tipo === 'correccion' && f.detalle.accion === 'eliminar');
  chequear('borrar una venta: corrección eliminar con reversar', !!cElim && cElim.detalle.tipoOriginal === 'venta' && cElim.detalle.reversar && cElim.detalle.reversar.tipo === 'sumar',
    JSON.stringify(cElim && cElim.detalle));
  if(cElim){
    const p = problemas(cElim.detalle, CORRECCIONES.eliminar);
    chequear('eliminar: cumple el contrato', p.length === 0, p.join('; '));
    const r = cElim.detalle.reversar;
    chequear('eliminar venta: reversar lleva potrero, categoria, dueno y cantidad (lo que usa pasar_traslados_a_excel)',
      r.potrero === origen && r.categoria === 'Vacas' && r.dueno === SILVIA && r.cantidad === 2, JSON.stringify(r));
  }

  // ---- traslado La Vuelta -> María Laura
  n = ev().length;
  cargarTraslado(LV, { origen, destino: 'Casco', guia: 'a123456', obs: 'prueba', filas: [
    { cat: 'Vacas', dueno: SILVIA, cant: 8 }, { cat: 'Terneros', dueno: SILVIA, cant: 3 }] });
  await dormir(80);
  const fSal = nuevos(n).find(f => f.tipo === 'traslado_salida');
  const fEnt = nuevos(n).find(f => f.tipo === 'traslado_entrada');
  chequear('traslado: salida y entrada escritas', !!fSal && !!fEnt, ultimoToast(LV));
  if(fSal && fEnt){
    const pS = problemas(fSal.detalle, CONTRATO.traslado_salida), pE = problemas(fEnt.detalle, CONTRATO.traslado_entrada);
    chequear('traslado_salida: cumple el contrato', filaOk(fSal).length === 0 && pS.length === 0, filaOk(fSal).concat(pS).join('; '));
    chequear('traslado_entrada: cumple el contrato', filaOk(fEnt).length === 0 && pE.length === 0, filaOk(fEnt).concat(pE).join('; '));
    chequear('traslado: la salida va al stream de La Vuelta y la entrada al de María Laura', fSal.establecimiento === 'la_vuelta' && fEnt.establecimiento === 'maria_laura');
    chequear('traslado: comparten trasladoId y guía', fSal.detalle.trasladoId === fEnt.detalle.trasladoId && fSal.detalle.guia === 'A123456' && fEnt.detalle.guia === 'A123456');
    chequear('traslado: destino.establecimiento y origen.establecimiento son los del otro campo',
      fSal.detalle.destino.establecimiento === 'maria_laura' && fEnt.detalle.origen.establecimiento === 'la_vuelta');
  }

  // ---- movimiento_guia (venta entre dueños, solo guía)
  n = ev().length;
  cargarMovimientoGuia(LV, { potrero: origen, guia: 'd333333', desde: dVende, hacia: dCompra, obs: 'prueba', filas: [{ cat: 'Vacas', cant: 5 }] });
  await dormir(80);
  const fMov = nuevos(n).find(f => f.tipo === 'movimiento_guia');
  chequear('movimiento_guia: evento escrito', !!fMov, ultimoToast(LV));
  if(fMov){
    const p = problemas(fMov.detalle, CONTRATO.movimiento_guia);
    chequear('movimiento_guia: cumple el contrato', filaOk(fMov).length === 0 && p.length === 0, filaOk(fMov).concat(p).join('; '));
  }

  // ---- envío y retorno de campo ajeno
  n = ev().length;
  cargarCampoAjeno(LV, { tipo: 'envio', potrero: origen, guia: 'e444444', filas: [{ cat: 'Vacas', dueno: SILVIA, cant: 2 }] });
  await dormir(60);
  const fEnv = nuevos(n).find(f => f.tipo === 'envio_campo_ajeno');
  chequear('envio_campo_ajeno: evento escrito', !!fEnv, ultimoToast(LV));
  if(fEnv){
    const p = problemas(fEnv.detalle, CONTRATO.envio_campo_ajeno);
    chequear('envio_campo_ajeno: cumple el contrato', filaOk(fEnv).length === 0 && p.length === 0, filaOk(fEnv).concat(p).join('; '));
  }
  n = ev().length;
  cargarCampoAjeno(LV, { tipo: 'retorno', potrero: otro, guia: '', filas: [{ cat: 'Vacas', dueno: SILVIA, cant: 1 }] });
  await dormir(60);
  const fRet = nuevos(n).find(f => f.tipo === 'retorno_campo_ajeno');
  chequear('retorno_campo_ajeno: evento escrito', !!fRet, ultimoToast(LV));
  if(fRet){
    const p = problemas(fRet.detalle, CONTRATO.retorno_campo_ajeno);
    chequear('retorno_campo_ajeno: cumple el contrato', filaOk(fRet).length === 0 && p.length === 0, filaOk(fRet).concat(p).join('; '));
  }

  // ---- anular el traslado y el movimiento_guia: las correcciones que lee el script de Excel
  n = ev().length;
  const hSal = buscarHistorial(LV, 'traslado_salida');
  LV.borrarHistorial(hSal.id);
  await dormir(80);
  const cTr = nuevos(n).filter(f => f.tipo === 'correccion');
  const cLV = cTr.find(f => f.establecimiento === 'la_vuelta' && f.detalle.accion === 'eliminar');
  const cML = cTr.find(f => f.establecimiento === 'maria_laura' && f.detalle.accion === 'anular_traslado');
  chequear('anular traslado: corrección eliminar en La Vuelta con reversar traslado_salida_ajuste y trasladoId',
    !!cLV && cLV.detalle.tipoOriginal === 'traslado_salida' && cLV.detalle.reversar.tipo === 'traslado_salida_ajuste' && REGEX_UUID.test(cLV.detalle.reversar.trasladoId || ''),
    JSON.stringify(cLV && cLV.detalle));
  chequear('anular traslado: anular_traslado en el stream de María Laura', !!cML && cML.potrero === 'Casco', JSON.stringify(cML));
  if(cML){
    const p = problemas(cML.detalle, CORRECCIONES.anular_traslado);
    chequear('anular_traslado: cumple el contrato', p.length === 0, p.join('; '));
    chequear('anular_traslado: lleva el mismo trasladoId que la salida', !fSal || cML.detalle.trasladoId === fSal.detalle.trasladoId);
  }

  n = ev().length;
  const hMov = buscarHistorial(LV, 'movimiento_guia');
  LV.borrarHistorial(hMov.id);
  await dormir(80);
  const cMov = nuevos(n).find(f => f.tipo === 'correccion' && f.detalle.accion === 'eliminar');
  chequear('anular movimiento_guia: reversar movimiento_guia_ajuste con movId',
    !!cMov && cMov.detalle.tipoOriginal === 'movimiento_guia' && cMov.detalle.reversar.tipo === 'movimiento_guia_ajuste' && !!cMov.detalle.reversar.movId,
    JSON.stringify(cMov && cMov.detalle));

  // ---- todas las filas del servidor, validadas una vez más
  const malas = ev().map(f => ({ t: f.tipo, p: filaOk(f) })).filter(x => x.p.length);
  chequear(`las ${ev().length} filas del registro tienen event_id UUID, stream, potrero, detalle y fecha_cliente`, malas.length === 0, JSON.stringify(malas.slice(0, 3)));

  if(salida){
    const cols = ['event_id', 'establecimiento', 'dispositivo', 'tipo', 'potrero', 'detalle', 'fecha_cliente', 'creado_en'];
    const filas = ev().map(f => { const o = {}; cols.forEach(c => { o[c] = f[c] === undefined ? null : f[c]; }); return o; });
    fs.writeFileSync(salida, JSON.stringify(filas, null, 1), 'utf-8');
    console.log(`  --  fixture con ${filas.length} eventos escrito en ${salida}`);
  }
}

(async () => {
  let args = process.argv.slice(2);
  let salida = process.env.EVENTOS_CONTRATO_SALIDA || null;
  const i = args.indexOf('--salida');
  if(i >= 0){ salida = args[i + 1]; args = args.slice(0, i).concat(args.slice(i + 2)); }
  probarDocumentacion();
  if(args.length >= 2) await probarFlujos(args[0], args[1], salida);
  else console.log('\n(sin las dos apps como argumento: solo se probó la documentación)');
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
