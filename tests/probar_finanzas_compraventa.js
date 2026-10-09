/*
 * Prueba ad-hoc: compras y ventas COMPLETAS (9/10/2026) -- formulario de la PC con los campos de las
 * hojas Compras / Ventas del Excel, catálogos de compradores / comisionistas / clientes (tabla
 * maestros_dicose), carga rápida desde el celular y "✍ Completar datos" desde la PC.
 *
 * Cubre: las fórmulas (calcCompra / calcVenta) contra valores reales de las hojas del Excel; el
 * formulario PC (obligatorios, vista previa, evento con detalle.fin, historial, transacción);
 * Pieza (dos compras vinculadas) y VCUT; altas de catálogo (misma lista en otro dispositivo,
 * duplicados, cola sin señal); la móvil sigue con el formulario rápido; completar datos desde la PC
 * llega al celular sin tocar el stock; edición precargada; y que un evento viejo o hostil no rompa nada.
 *
 * Uso: node tests/probar_finanzas_compraventa.js <la-vuelta-pc.html> <la-vuelta-movil.html> <maria-laura-pc.html> [...]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
const cerca = (a, b, tol) => a !== null && a !== undefined && Math.abs(a - b) <= (tol || 0.005);

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

// Servidor simulado compartido: eventos_sync, stock_potreros y maestros_dicose (select / insert / upsert / delete)
function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [], maestros_dicose: [] };
  let reloj = Date.parse('2026-10-09T12:00:00Z');
  const servidor = { filas, tablaCaida: false, violaciones: [] };
  servidor.createClient = function(){
    return { from(tabla){
      const q = {
        _filtros: [], _orden: null, _modo: 'select',
        select(){ q._modo='select'; return q; },
        insert(rows){ q._modo='insert'; q._filas = Array.isArray(rows)?rows:[rows]; return q; },
        upsert(rows, opts){ q._modo='upsert'; q._filas = Array.isArray(rows)?rows:[rows]; q._opts = opts || {}; return q; },
        delete(){ q._modo='delete'; return q; },
        eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
        gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
        not(){ return q; },
        in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
        order(col,opts){ q._orden = {col, asc: !opts || opts.ascending!==false}; return q; },
        then(res){
          filas[tabla] = filas[tabla] || [];
          // Políticas reales de Supabase (scripts/dicose/*.sql): movimientos_dicose NO admite a anon para nada y
          // maestros_dicose solo SELECT + INSERT (el upsert tiene que ser ignoreDuplicates; sin UPDATE ni DELETE)
          if(tabla === 'movimientos_dicose' || (tabla === 'maestros_dicose' && (q._modo === 'delete' || (q._modo === 'upsert' && !q._opts.ignoreDuplicates)))){
            servidor.violaciones.push(q._modo + ' ' + tabla);
            return Promise.resolve(res({data: null, error: {code: '42501', message: 'permission denied for table ' + tabla}}));
          }
          if(tabla === 'maestros_dicose' && servidor.tablaCaida) return Promise.resolve(res({data: null, error: {code: '42P01', message: 'relation does not exist'}}));
          if(q._modo==='insert'){
            let error = null;
            q._filas.forEach(f=>{
              if(f.event_id && filas[tabla].some(r=>r.event_id===f.event_id)){ error = {code:'23505', message:'duplicate key'}; return; }
              reloj += 10;
              filas[tabla].push(Object.assign({creado_en: new Date(reloj).toISOString()}, f));
            });
            return Promise.resolve(res({data:q._filas, error}));
          }
          if(q._modo==='upsert'){
            q._filas.forEach(f=>{
              const i = filas[tabla].findIndex(r=>r.tipo===f.tipo && r.nombre===f.nombre);
              if(i >= 0){ if(!q._opts.ignoreDuplicates) filas[tabla][i] = Object.assign({}, filas[tabla][i], f); return; }
              reloj += 10;
              filas[tabla].push(Object.assign({creado_en: new Date(reloj).toISOString(), activo: true}, f));
            });
            return Promise.resolve(res({data:q._filas, error:null}));
          }
          if(q._modo==='delete'){
            const antes = filas[tabla].length;
            filas[tabla] = filas[tabla].filter(r=>!q._filtros.every(f=>f(r)));
            return Promise.resolve(res({data:null, error:null, count: antes-filas[tabla].length}));
          }
          let data = filas[tabla].filter(r=>q._filtros.every(f=>f(r)));
          if(q._orden) data = data.slice().sort((a,b)=>{
            const av=a[q._orden.col], bv=b[q._orden.col];
            return (av<bv?-1:av>bv?1:0) * (q._orden.asc?1:-1);
          });
          return Promise.resolve(res({data, error:null}));
        }
      };
      return q;
    } };
  };
  return servidor;
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
const ultimoToast = win => win.__toasts[win.__toasts.length-1] || '';
const E = (W, id) => W.document.getElementById(id);
function poner(W, id, v, evento){
  const e = E(W, id);
  e.value = String(v);
  e.dispatchEvent(new W.Event(evento || 'input', { bubbles: true }));
}
function abrirCV(W, tipo){
  E(W, 'btn-guias').click();
  const s = E(W, 'mg-modo'); s.value = 'compraventa'; s.dispatchEvent(new W.Event('change', { bubbles: true }));
  poner(W, 'cv-tipo', tipo, 'change');
}
const MAESTROS = {
  comprador: ['Pedro', 'Silvia', 'Caro', 'Sofi', 'Feli', 'Pauli', 'Mili'].map(n => ({nombre: n, dicose: '', tipo: '', activo: true})),
  comisionista: ['Julio Xavier', 'Fabian Braga', 'Directo'].map(n => ({nombre: n, dicose: '', tipo: '', activo: true})),
  contraparte: [
    {nombre: 'Nebio Domingez', dicose: '', tipo: 'Cliente', activo: true},
    {nombre: 'Walter Lanfranco', dicose: '130718973', tipo: 'Productor', activo: true},
    {nombre: 'Frigorifico Canelones', dicose: '020000376', tipo: 'Destinatario', activo: true}
  ]
};

async function probarPC(archivoPC, archivoMovil){
  const etiqueta = archivoPC.replace('/index.html', '');
  console.log(`\n=== Compras y ventas completas (${archivoPC}) ===`);
  const servidor = crearServidor();
  // los catálogos ya están en Supabase (los sembró el script)
  MAESTROS.comprador.forEach(m => servidor.filas.maestros_dicose.push({tipo: 'comprador', nombre: m.nombre, activo: true}));
  MAESTROS.comisionista.forEach(m => servidor.filas.maestros_dicose.push({tipo: 'comisionista', nombre: m.nombre, activo: true}));
  MAESTROS.contraparte.forEach(m => servidor.filas.maestros_dicose.push({tipo: 'contraparte', nombre: m.nombre, dicose: m.dicose || null, tipo_contraparte: m.tipo, activo: true}));
  const pc = await levantar(archivoPC, servidor);
  const pc2 = await levantar(archivoPC, servidor);                 // otra PC
  const mv = archivoMovil ? await levantar(archivoMovil, servidor) : null;
  chequear(`${etiqueta}: carga sin errores`, pc.errores.length === 0 && pc2.errores.length === 0 && (!mv || mv.errores.length === 0), pc.errores.concat(pc2.errores, mv ? mv.errores : []).join(' | '));
  if(pc.errores.length) return;
  const W = pc.win, W2 = pc2.win;
  const potrero = W.__potrerosGeo()[0].nombre;
  const dueno = W.__config().duenos[0];
  const kA = c => W.claveAnimal(c, dueno);
  const aW = W.__est().potreros[potrero].animales;

  // ---- 1) las fórmulas, contra valores reales de las hojas del Excel ----
  // Compras fila 10: 6 VINV, 2210 kg brutos, destare 5 %, a U$S 1,8 por kg -> neto 2099,5; importe 3779,1
  let c = W.calcCompra({cantidad: 6, tipoPrecio: 'Kg', kilosBrutos: 2210, destare: 0.05, precio: 1.8, pctCom: 0, flete: 0});
  chequear(`${etiqueta}: calcCompra por kg (fila real de Compras): neto 2099,5 e importe 3779,1`, cerca(c.kilosNeto, 2099.5) && cerca(c.importe, 3779.1) && cerca(c.promedio, 2099.5 / 6), JSON.stringify(c));
  // Compras fila 13: 2 cabezas "Pieza" a U$S 450 -> importe 900 (no depende de los kilos)
  c = W.calcCompra({cantidad: 2, tipoPrecio: 'Pieza', kilosBrutos: 662, destare: 0.05, precio: 450, pctCom: 0, flete: 0});
  chequear(`${etiqueta}: calcCompra por pieza: importe 900`, cerca(c.importe, 900) && cerca(c.kilosNeto, 628.9), JSON.stringify(c));
  c = W.calcCompra({cantidad: 10, tipoPrecio: 'Kg', kilosBrutos: 4000, destare: 0.05, precio: 2.5, pctCom: 0.02, flete: 100});
  chequear(`${etiqueta}: calcCompra con comisión y flete: comisión 190, costo total 9790, por cabeza 979`, cerca(c.importeCom, 190) && cerca(c.costoTotal, 9790) && cerca(c.costoCab, 979) && cerca(c.costoKg, 9790 / 3800, 0.0001), JSON.stringify(c));
  chequear(`${etiqueta}: calcCompra con datos incompletos devuelve null (no NaN)`, W.calcCompra({cantidad: 5, tipoPrecio: 'Kg'}).importe === null);
  // Ventas fila 4: 32 Vacas Inv, 2ª, 4,7431 $/kg, 19524,3 kg -> 92605,84
  let v = W.calcVenta({cantidad: 32, precioTipo: '2ª', precioKg: 4.74310694573302, kilosRes: 19524.3, kilosPie: 40000});
  chequear(`${etiqueta}: calcVenta 2ª (fila real de Ventas): bruto 92605,84`, cerca(v.importeBruto, 92605.84, 0.01), JSON.stringify(v));
  v = W.calcVenta({cantidad: 20, precioTipo: '2ª', precioKg: 4.56, kilosRes: 4232.2, kilosPie: 8000, imeba: 377.29, inia: 75.46, mevir: 37.73, inac: 20, mgap: 76, sepb: 40, gastos: 2.71});
  chequear(`${etiqueta}: calcVenta con descuentos: total 629,19 y neto = bruto − descuentos`, cerca(v.descuentos, 629.19) && cerca(v.neto, 4.56 * 4232.2 - 629.19, 0.01) && cerca(v.rendimiento, 4232.2 / 8000, 0.0001) && cerca(v.pesoProm, 400), JSON.stringify(v));
  v = W.calcVenta({cantidad: 8, precioTipo: '1ª', precioKg: 2.95, kilosPie: 1513});
  chequear(`${etiqueta}: calcVenta 1ª usa los kilos en pie: 2,95 × 1513 = 4463,35`, cerca(v.importeBruto, 4463.35) && v.descuentos === null, JSON.stringify(v));
  chequear(`${etiqueta}: códigos del Excel: Vacas→VACA, Vacas de invernada→VINV, VCUT, Pieza, Terneros→TERNERO; ventas: Vacas Inv`,
    W.catExcelCompra('Vacas') === 'VACA' && W.catExcelCompra('Vacas de invernada') === 'VINV' && W.catExcelCompra('Vacas', 'vcut') === 'VCUT'
    && W.catExcelCompra('Vacas', 'pieza') === 'Pieza' && W.catExcelCompra('Terneros') === 'TERNERO' && W.catExcelVenta('Vacas de invernada') === 'Vacas Inv' && W.catExcelVenta('Terneras') === 'Terneros/as');

  // ---- 2) los catálogos llegan al sincronizar y alimentan las listas ----
  E(W, 'btn-guias').click();                       // al abrir Movimientos DICOSE (PC) se traen los catálogos al día
  await dormir(100);
  chequear(`${etiqueta}: la PC bajó los catálogos de Supabase (7 compradores, 3 comisionistas, 3 contrapartes)`,
    W.maestrosDe('comprador').length === 7 && W.maestrosDe('comisionista').length === 3 && W.maestrosDe('contraparte').length === 3,
    JSON.stringify(Object.fromEntries(Object.entries(W.__est().maestros).map(([k, x]) => [k, x.length]))));
  abrirCV(W, 'Compra');
  const opts = id => Array.from(E(W, id).options).map(o => o.value);
  chequear(`${etiqueta}: la lista de compradores muestra los del Excel y "Agregar nuevo"`, opts('cv-comprador').includes('Sofi') && opts('cv-comprador').includes('__nuevo__'));
  chequear(`${etiqueta}: el origen solo ofrece clientes y productores (no destinatarios) y el destino los destinatarios`,
    opts('cv-origen').includes('Walter Lanfranco') && !opts('cv-origen').includes('Frigorifico Canelones') && opts('cv-destino').includes('Frigorifico Canelones'));
  chequear(`${etiqueta}: "Directo" queda por defecto como comisionista`, E(W, 'cv-comisionista').value === 'Directo');
  chequear(`${etiqueta}: en la PC se ve el formulario completo y se oculta el rápido`, E(W, 'cv-pc').style.display === 'block' && E(W, 'cv-simple').style.display === 'none' && E(W, 'cv-compra-pc').style.display === 'block');

  // ---- 3) compra completa por kg, con comisión y flete ----
  aW[kA('Vacas')] = 0;
  const totalAntes = W.totalPotrero(potrero), evAntes = servidor.filas.eventos_sync.length, trAntes = (W.__est().transacciones || []).length;
  poner(W, 'cv-potrero', potrero, 'change'); poner(W, 'cv-cat', 'Vacas', 'change'); poner(W, 'cv-dueno', dueno, 'change');
  poner(W, 'cv-cant', 10); poner(W, 'cv-fecha', W.fechaISOHoy(), 'change'); poner(W, 'cv-guia', 'k100001');
  poner(W, 'cv-origen', 'Walter Lanfranco', 'change');
  chequear(`${etiqueta}: al elegir el origen se ve su DICOSE`, /130718973/.test(E(W, 'cv-origen-dicose').textContent), E(W, 'cv-origen-dicose').textContent);
  poner(W, 'cv-comprador', 'Pedro', 'change');
  poner(W, 'cv-kbrutos', 4000); poner(W, 'cv-destare', 5); poner(W, 'cv-pcompra', 2.5); poner(W, 'cv-comisionista', 'Fabian Braga', 'change'); poner(W, 'cv-pcom', 2); poner(W, 'cv-flete', 100); poner(W, 'cv-pago', 'Pendiente', 'change'); poner(W, 'cv-km', 120);
  chequear(`${etiqueta}: la vista previa calcula como el Excel (neto 3.800, costo total 9.790)`,
    /3\.800/.test(E(W, 'cv-resumen-compra').textContent) && /9\.790/.test(E(W, 'cv-resumen-compra').textContent), E(W, 'cv-resumen-compra').textContent);
  E(W, 'cv-guardar').click();
  await dormir(60);
  chequear(`${etiqueta}: la compra suma 10 vacas al potrero`, aW[kA('Vacas')] === 10 && W.totalPotrero(potrero) === totalAntes + 10, String(aW[kA('Vacas')]));
  const evCompra = servidor.filas.eventos_sync.slice(evAntes).find(r => r.tipo === 'compra');
  const fin = evCompra && evCompra.detalle.fin;
  chequear(`${etiqueta}: el evento trae el detalle completo (fin) con kilos, destare, importe, comisión, flete, pago y km`,
    !!fin && fin.op === 'compra' && fin.catExcel === 'VACA' && fin.comprador === 'Pedro' && fin.origen === 'Walter Lanfranco' && fin.tipoPrecio === 'Kg'
    && cerca(fin.kilosBrutos, 4000) && cerca(fin.destare, 0.05) && cerca(fin.kilosNeto, 3800) && cerca(fin.precio, 2.5) && cerca(fin.importe, 9500)
    && cerca(fin.pctCom, 0.02) && cerca(fin.importeCom, 190) && fin.comisionista === 'Fabian Braga' && cerca(fin.flete, 100) && fin.pagado === false && fin.km === 120 && cerca(fin.costoTotal, 9790),
    JSON.stringify(fin));
  chequear(`${etiqueta}: el evento mantiene los campos de siempre (contraparte = origen, guía en mayúscula, precio por cabeza = importe / cantidad)`,
    evCompra.detalle.contraparte === 'Walter Lanfranco' && evCompra.detalle.guia === 'K100001' && cerca(evCompra.detalle.precio, 950) && evCompra.detalle.cantidad === 10, JSON.stringify(evCompra.detalle));
  const hCompra = W.__est().potreros[potrero].historial[0];
  chequear(`${etiqueta}: el historial muestra el resumen con kilos e importe`, /3\.800/.test(hCompra.detalle) && /9\.500/.test(hCompra.detalle) && hCompra.extra.fin && hCompra.extra.fin.importe === 9500, hCompra.detalle);
  chequear(`${etiqueta}: la transacción (reporte económico) usa el importe real y guarda el detalle`,
    (W.__est().transacciones || []).length === trAntes + 1 && cerca(W.__est().transacciones[0].total, 9500) && W.__est().transacciones[0].fin.importeCom === 190);
  chequear(`${etiqueta}: el formulario limpia los kilos y el precio para la próxima`, E(W, 'cv-kbrutos').value === '' && E(W, 'cv-pcompra').value === '' && E(W, 'cv-guia').value === '');

  // ---- 4) obligatorios ----
  const evSin = servidor.filas.eventos_sync.length;
  poner(W, 'cv-kbrutos', 1000); E(W, 'cv-guardar').click();
  chequear(`${etiqueta}: sin precio / origen NO registra y dice qué falta`, servidor.filas.eventos_sync.length === evSin && /Faltan datos de la compra/.test(ultimoToast(W)) && /Precio/.test(ultimoToast(W)), ultimoToast(W));
  poner(W, 'cv-kbrutos', '');

  // ---- 5) compra por pieza y VCUT ----
  poner(W, 'cv-cant', 2); poner(W, 'cv-tprecio', 'Pieza', 'change'); poner(W, 'cv-origen', 'Nebio Domingez', 'change'); poner(W, 'cv-kbrutos', 662); poner(W, 'cv-pcompra', 450);
  chequear(`${etiqueta}: el rótulo del precio cambia a "por pieza"`, /pieza/i.test(E(W, 'cv-label-pcompra').textContent));
  poner(W, 'cv-variante', 'vcut', 'change');
  E(W, 'cv-guardar').click();
  await dormir(60);
  const evVcut = servidor.filas.eventos_sync.filter(r => r.tipo === 'compra').pop();
  chequear(`${etiqueta}: por pieza el importe es precio × cabezas (900) y la vaca de última cría lleva el código VCUT`,
    cerca(evVcut.detalle.fin.importe, 900) && evVcut.detalle.fin.catExcel === 'VCUT' && evVcut.detalle.fin.variante === 'vcut' && evVcut.detalle.categoria === 'Vacas', JSON.stringify(evVcut.detalle.fin));

  // ---- 6) Pieza = vaca con cría al pie: dos compras vinculadas ----
  const kT = W.claveAnimal('Terneros', dueno), tern0 = aW[kT] || 0, vacas0 = aW[kA('Vacas')];
  poner(W, 'cv-cant', 3); poner(W, 'cv-tprecio', 'Pieza', 'change'); poner(W, 'cv-origen', 'Nebio Domingez', 'change'); poner(W, 'cv-kbrutos', 1500); poner(W, 'cv-pcompra', 700);
  poner(W, 'cv-variante', 'pieza', 'change'); poner(W, 'cv-guia', 'p200002');
  const evP = servidor.filas.eventos_sync.length;
  E(W, 'cv-guardar').click();
  await dormir(80);
  const evsPieza = servidor.filas.eventos_sync.slice(evP).filter(r => r.tipo === 'compra');
  chequear(`${etiqueta}: Pieza suma 3 vacas Y 3 terneros al stock`, aW[kA('Vacas')] === vacas0 + 3 && (aW[kT] || 0) === tern0 + 3, `${aW[kA('Vacas')]} / ${aW[kT]}`);
  chequear(`${etiqueta}: …como DOS eventos vinculados (misma guía y mismo pieza.id): la vaca con el detalle y la cría sin importe`,
    evsPieza.length === 2 && evsPieza[0].detalle.fin.pieza.rol === 'vaca' && evsPieza[1].detalle.fin.pieza.rol === 'cria' && evsPieza[0].detalle.fin.pieza.id === evsPieza[1].detalle.fin.pieza.id
    && evsPieza[1].detalle.categoria === 'Terneros' && evsPieza[1].detalle.guia === 'P200002' && evsPieza[0].detalle.fin.catExcel === 'Pieza' && cerca(evsPieza[0].detalle.fin.importe, 2100) && evsPieza[1].detalle.fin.importe === undefined,
    JSON.stringify(evsPieza.map(e => e.detalle.fin)));
  chequear(`${etiqueta}: la cría de una Pieza no figura como "faltan datos" en la lista`, !W.movimientosConGuia().find(r => r.guia === 'P200002' && r.faltanDatos));

  // ---- 7) venta completa con descuentos ----
  abrirCV(W, 'Venta');
  chequear(`${etiqueta}: en una venta se ve el bloque de venta y se oculta el de compra`, E(W, 'cv-venta-pc').style.display === 'block' && E(W, 'cv-compra-pc').style.display === 'none');
  const kVI = W.claveAnimal('Vacas de invernada', dueno); aW[kVI] = 30;
  poner(W, 'cv-potrero', potrero, 'change'); poner(W, 'cv-cat', 'Vacas de invernada', 'change'); poner(W, 'cv-dueno', dueno, 'change'); poner(W, 'cv-cant', 20);
  poner(W, 'cv-fecha', W.fechaISOHoy(), 'change'); poner(W, 'cv-guia', 'm300003');
  poner(W, 'cv-destino', 'Frigorifico Canelones', 'change');
  chequear(`${etiqueta}: al elegir el destino se ve su DICOSE`, /020000376/.test(E(W, 'cv-destino-dicose').textContent));
  poner(W, 'cv-ptipo', '2ª', 'change'); poner(W, 'cv-pkg', 4.56); poner(W, 'cv-kpie', 8000); poner(W, 'cv-kres', 4232.2); poner(W, 'cv-plazo', 30);
  poner(W, 'cv-imeba', 377.29); poner(W, 'cv-inia', 75.46); poner(W, 'cv-mevir', 37.73); poner(W, 'cv-inac', 20); poner(W, 'cv-mgap', 76); poner(W, 'cv-sepb', 40); poner(W, 'cv-gastos', 2.71);
  chequear(`${etiqueta}: la vista previa de la venta muestra bruto, descuentos, neto y rendimiento`, /19\.298|19\.297/.test(E(W, 'cv-resumen-venta').textContent) && /52,9|52,8|52,9/.test(E(W, 'cv-resumen-venta').textContent), E(W, 'cv-resumen-venta').textContent);
  const evV = servidor.filas.eventos_sync.length;
  E(W, 'cv-guardar').click();
  await dormir(60);
  const evVenta = servidor.filas.eventos_sync.slice(evV).find(r => r.tipo === 'venta');
  const fv = evVenta && evVenta.detalle.fin;
  chequear(`${etiqueta}: la venta resta 20 vacas de invernada`, aW[kVI] === 10, String(aW[kVI]));
  chequear(`${etiqueta}: el evento de venta trae precio tipo, $/kg, kilos, descuentos, neto y destino`,
    !!fv && fv.op === 'venta' && fv.catExcel === 'Vacas Inv' && fv.precioTipo === '2ª' && cerca(fv.precioKg, 4.56) && cerca(fv.kilosRes, 4232.2) && cerca(fv.importeBruto, 19298.83, 0.01)
    && cerca(fv.descuentos, 629.19) && cerca(fv.neto, 19298.83 - 629.19, 0.01) && fv.destino === 'Frigorifico Canelones' && fv.plazo === 30 && evVenta.detalle.contraparte === 'Frigorifico Canelones', JSON.stringify(fv));
  const sinKilos = servidor.filas.eventos_sync.length;
  poner(W, 'cv-cant', 1); poner(W, 'cv-pkg', 4); poner(W, 'cv-kres', '');
  E(W, 'cv-guardar').click();
  chequear(`${etiqueta}: una venta 2ª sin kilos de la res NO registra`, servidor.filas.eventos_sync.length === sinKilos && /Kilos 2ª/.test(ultimoToast(W)), ultimoToast(W));

  // ---- 8) altas de catálogo desde la PC ----
  abrirCV(W, 'Compra');
  poner(W, 'cv-comisionista', '__nuevo__', 'change');
  chequear(`${etiqueta}: "➕ Agregar nuevo…" abre el alta (comisionista: solo pide el nombre)`, E(W, 'cv-nuevo').style.display === 'block' && E(W, 'cv-nuevo-tcontra-fila').style.display === 'none');
  poner(W, 'cv-nuevo-nombre', 'Caio Nuevo'); E(W, 'cv-nuevo-ok').click();
  await dormir(60);
  chequear(`${etiqueta}: el nuevo comisionista queda elegido en la lista`, E(W, 'cv-comisionista').value === 'Caio Nuevo' && E(W, 'cv-nuevo').style.display === 'none');
  chequear(`${etiqueta}: …y se guardó en Supabase (maestros_dicose)`, servidor.filas.maestros_dicose.some(r => r.tipo === 'comisionista' && r.nombre === 'Caio Nuevo') && (W.__est().colaMaestros || []).length === 0);
  poner(W, 'cv-origen', '__nuevo__', 'change');
  chequear(`${etiqueta}: el alta de una contraparte pide tipo y DICOSE`, E(W, 'cv-nuevo-tcontra-fila').style.display !== 'none' && E(W, 'cv-nuevo-dicose-fila').style.display !== 'none');
  poner(W, 'cv-nuevo-nombre', 'Productor Nuevo SA'); poner(W, 'cv-nuevo-tcontra', 'Productor', 'change'); poner(W, 'cv-nuevo-dicose', 'FF0999999'); E(W, 'cv-nuevo-ok').click();
  await dormir(60);
  const rc = servidor.filas.maestros_dicose.find(r => r.nombre === 'Productor Nuevo SA');
  chequear(`${etiqueta}: la contraparte nueva se sube con su tipo y DICOSE y aparece elegida con su DICOSE`,
    !!rc && rc.tipo === 'contraparte' && rc.tipo_contraparte === 'Productor' && rc.dicose === 'FF0999999' && E(W, 'cv-origen').value === 'Productor Nuevo SA' && /FF0999999/.test(E(W, 'cv-origen-dicose').textContent));
  poner(W, 'cv-comprador', '__nuevo__', 'change'); poner(W, 'cv-nuevo-nombre', 'pedro'); E(W, 'cv-nuevo-ok').click();
  chequear(`${etiqueta}: un nombre repetido (sin importar mayúsculas) se rechaza`, /ya está en la lista/.test(ultimoToast(W)) && E(W, 'cv-nuevo').style.display === 'block', ultimoToast(W));
  E(W, 'cv-nuevo-cancelar').click();
  chequear(`${etiqueta}: cancelar el alta deja la lista como estaba`, E(W, 'cv-nuevo').style.display === 'none' && E(W, 'cv-comprador').value === '');
  E(W2, 'btn-guias').click();
  await dormir(100);
  chequear(`${etiqueta}: otra PC ve los catálogos nuevos al abrir Movimientos DICOSE`, W2.maestroExiste('comisionista', 'Caio Nuevo') && W2.maestroExiste('contraparte', 'Productor Nuevo SA'));
  // sin señal: el alta queda en la cola y se sube al volver
  W.navigator.onLine = false;
  abrirCV(W, 'Compra'); poner(W, 'cv-comprador', '__nuevo__', 'change'); poner(W, 'cv-nuevo-nombre', 'Comprador Offline'); E(W, 'cv-nuevo-ok').click();
  chequear(`${etiqueta}: sin señal el comprador nuevo se usa igual y queda en cola`, W.maestroExiste('comprador', 'Comprador Offline') && (W.__est().colaMaestros || []).length === 1 && !servidor.filas.maestros_dicose.some(r => r.nombre === 'Comprador Offline'));
  W.navigator.onLine = true;
  await W.sincronizar();
  chequear(`${etiqueta}: al volver la señal se sube y la cola queda vacía`, servidor.filas.maestros_dicose.some(r => r.nombre === 'Comprador Offline') && (W.__est().colaMaestros || []).length === 0);
  // tabla todavía no creada: la app sigue andando con lo que tiene
  servidor.tablaCaida = true;
  const antesCat = W.maestrosDe('comprador').length;
  E(W, 'btn-guias').click();
  await dormir(100);
  chequear(`${etiqueta}: si la tabla de catálogos no existe todavía, no rompe ni borra la lista local`, W.maestrosDe('comprador').length === antesCat && pc.errores.length === 0);
  servidor.tablaCaida = false;
  chequear(`${etiqueta}: la app solo hace con la clave pública lo que permiten las políticas (nunca toca movimientos_dicose, no actualiza ni borra catálogos)`, servidor.violaciones.length === 0, servidor.violaciones.join(', '));

  // ---- 9) edición precargada con todo el detalle ----
  W.confirm = () => true;
  const hEd = W.__est().potreros[potrero].historial.find(h => h.tipo === 'compra' && h.extra && h.extra.guia === 'K100001');
  W.editarHistorial(hEd.id);
  chequear(`${etiqueta}: editar la compra completa abre el formulario con kilos, destare, precio, comisión, flete, pago y km`,
    E(W, 'modal-guias').style.display === 'flex' && E(W, 'cv-origen').value === 'Walter Lanfranco' && E(W, 'cv-comprador').value === 'Pedro' && E(W, 'cv-kbrutos').value === '4000'
    && E(W, 'cv-destare').value === '5' && E(W, 'cv-pcompra').value === '2.5' && E(W, 'cv-comisionista').value === 'Fabian Braga' && E(W, 'cv-pcom').value === '2'
    && E(W, 'cv-flete').value === '100' && E(W, 'cv-pago').value === 'Pendiente' && E(W, 'cv-km').value === '120' && E(W, 'cv-guia').value === 'K100001',
    ['cv-origen', 'cv-comprador', 'cv-kbrutos', 'cv-destare', 'cv-pcompra', 'cv-comisionista', 'cv-pcom', 'cv-flete', 'cv-pago', 'cv-km', 'cv-guia'].map(i => E(W, i).value).join('|'));
  E(W, 'cv-guardar').click();
  await dormir(60);
  chequear(`${etiqueta}: guardar sin cambios deja el mismo stock y el mismo importe`, aW[kA('Vacas')] === vacas0 + 3 && W.__est().potreros[potrero].historial.find(h => h.tipo === 'compra' && !h.eliminado && h.extra && h.extra.guia === 'K100001').extra.fin.importe === 9500);

  // ---- 10) carga rápida desde el celular -> "Completar datos" en la PC ----
  if(mv){
    const M = mv.win;
    chequear(`${etiqueta}: la móvil NO tiene el formulario completo (sigue el rápido)`, !E(M, 'cv-pc') && !E(M, 'cv-variante'));
    const pM = M.__potrerosGeo()[0].nombre, kM = M.claveAnimal('Terneros', dueno);
    E(M, 'btn-guias').click();
    poner(M, 'cv-tipo', 'Compra', 'change'); poner(M, 'cv-potrero', pM, 'change'); poner(M, 'cv-cat', 'Terneros', 'change'); poner(M, 'cv-dueno', dueno, 'change');
    poner(M, 'cv-cant', 12); poner(M, 'cv-fecha', M.fechaISOHoy(), 'change'); poner(M, 'cv-precio', 300); poner(M, 'cv-contraparte', 'Nebio Domingez'); poner(M, 'cv-guia', 'r400004');
    const stM0 = M.__est().potreros[pM].animales[kM] || 0;
    E(M, 'cv-guardar').click();
    await dormir(60);
    const evM = servidor.filas.eventos_sync.filter(r => r.tipo === 'compra').pop();
    chequear(`${etiqueta}: la carga rápida del celular sigue siendo la de siempre (sin detalle completo)`, evM.detalle.guia === 'R400004' && cerca(evM.detalle.precio, 300) && evM.detalle.fin === undefined && (M.__est().potreros[pM].animales[kM] || 0) === stM0 + 12);
    await W.sincronizar();
    const fila = W.movimientosConGuia().find(r => r.guia === 'R400004');
    chequear(`${etiqueta}: en la PC esa compra figura "faltan datos" y tiene el botón ✍`, !!fila && fila.faltanDatos === true);
    await M.sincronizar();                                    // el celular ya trae todo lo anterior (p. ej. los 3 terneros de la Pieza)
    const stM1 = M.__est().potreros[pM].animales[kM] || 0;
    E(W, 'btn-guias').click();
    const btnCompletar = E(W, 'mg-lista').querySelector(`[data-mg-id="${fila.id}"] [data-mg-completar]`);
    chequear(`${etiqueta}: la lista de la PC muestra "⚠ faltan datos" y ✍`, !!btnCompletar && /faltan datos/.test(E(W, 'mg-lista').textContent));
    E(W, 'mg-filtro-faltan').checked = true; E(W, 'mg-filtro-faltan').dispatchEvent(new W.Event('change', { bubbles: true }));
    chequear(`${etiqueta}: el filtro "solo las que faltan completar" funciona`, E(W, 'mg-lista').querySelectorAll('[data-mg-id]').length >= 1 && !/K100001/.test(E(W, 'mg-lista').textContent));
    E(W, 'mg-filtro-faltan').checked = false; E(W, 'mg-filtro-faltan').dispatchEvent(new W.Event('change', { bubbles: true }));
    E(W, 'mg-lista').querySelector(`[data-mg-id="${fila.id}"] [data-mg-completar]`).click();     // (la lista se volvió a dibujar al filtrar: se busca de nuevo el botón)
    chequear(`${etiqueta}: ✍ abre el formulario con los datos de la carga rápida (precio por cabeza pasa a "por pieza") y bloquea cantidad/categoría`,
      E(W, 'modal-guias').style.display === 'flex' && E(W, 'cv-cant').value === '12' && E(W, 'cv-cant').disabled && E(W, 'cv-origen').value === 'Nebio Domingez'
      && E(W, 'cv-tprecio').value === 'Pieza' && E(W, 'cv-pcompra').value === '300' && E(W, 'cv-guardar').textContent === 'Guardar datos completos',
      ['cv-cant','cv-origen','cv-tprecio','cv-pcompra','cv-rapido'].map(i => i + '=' + (i === 'cv-rapido' ? E(W, i).checked : E(W, i).value) + (E(W, i).disabled ? '(dis)' : '')).join(' ') + ' | ' + E(W, 'cv-guardar').textContent + ' | modal=' + E(W, 'modal-guias').style.display);
    chequear(`${etiqueta}: ✍ avisa qué hacer y lleva la vista al formulario (que está arriba de la lista)`, /Guardar datos completos/.test(ultimoToast(W)) && E(W, 'modal-guias').querySelector('.modal-box').scrollTop === 0, ultimoToast(W));
    const stP0 = W.__est().potreros[pM].animales[kM] || 0, evC = servidor.filas.eventos_sync.length;
    poner(W, 'cv-tprecio', 'Kg', 'change'); poner(W, 'cv-kbrutos', 2400); poner(W, 'cv-destare', 4); poner(W, 'cv-pcompra', 1.6); poner(W, 'cv-comprador', 'Pedro', 'change'); poner(W, 'cv-flete', 50);
    E(W, 'cv-guardar').click();
    await dormir(60);
    const evCorr = servidor.filas.eventos_sync.slice(evC).find(r => r.tipo === 'correccion');
    chequear(`${etiqueta}: completar emite una corrección 'completar_datos' (no una compra nueva) con el detalle`,
      servidor.filas.eventos_sync.slice(evC).filter(r => r.tipo === 'compra').length === 0 && !!evCorr && evCorr.detalle.accion === 'completar_datos' && evCorr.detalle.tipoOriginal === 'compra'
      && evCorr.detalle.fin.catExcel === 'TERNERO' && cerca(evCorr.detalle.fin.kilosNeto, 2304) && cerca(evCorr.detalle.fin.importe, 3686.4, 0.01) && cerca(evCorr.detalle.precio, 3686.4 / 12, 0.001), JSON.stringify(evCorr && evCorr.detalle));
    chequear(`${etiqueta}: …y NO toca el stock`, (W.__est().potreros[pM].animales[kM] || 0) === stP0);
    chequear(`${etiqueta}: la lista ya no marca esa compra como "faltan datos"`, !W.movimientosConGuia().find(r => r.guia === 'R400004').faltanDatos);
    chequear(`${etiqueta}: la transacción de la PC se actualizó con el importe real`, cerca((W.__est().transacciones || []).find(t => t.guia === 'R400004').total, 3686.4, 0.01));
    chequear(`${etiqueta}: el formulario vuelve al modo normal`, !E(W, 'cv-cant').disabled && E(W, 'cv-guardar').textContent === 'Registrar');
    await M.sincronizar();
    const hM = M.__est().potreros[pM].historial.find(h => h.tipo === 'compra' && h.extra && h.extra.guia === 'R400004');
    chequear(`${etiqueta}: el celular recibe el detalle completo (su propio renglón se completa) sin cambiar el stock`,
      !!hM.extra.fin && cerca(hM.extra.fin.importe, 3686.4, 0.01) && (M.__est().potreros[pM].animales[kM] || 0) === stM1 && /2\.304/.test(hM.detalle), hM.detalle + " | stock " + (M.__est().potreros[pM].animales[kM] || 0) + " vs " + stM1);
    chequear(`${etiqueta}: …y su transacción también`, cerca((M.__est().transacciones || []).find(t => t.guia === 'R400004').total, 3686.4, 0.01));
    await W2.sincronizar();
    const h2 = W2.__est().potreros[pM].historial.find(h => h.tipo === 'compra' && h.origDatos && h.origDatos.guia === 'R400004');
    chequear(`${etiqueta}: otra PC también queda con el detalle completo`, !!h2 && !!h2.origDatos.fin && cerca(h2.origDatos.fin.importe, 3686.4, 0.01));
  }

  // ---- 11) retrocompatibilidad y datos hostiles ----
  const pX = potrero, kX = W2.claveAnimal('Toros', dueno), antesX = W2.__est().potreros[pX].animales[kX] || 0;
  W2.aplicarEventoRemoto({event_id: 'e-viejo', creado_en: '2026-10-09T13:00:00Z', tipo: 'compra', potrero: pX, dispositivo: 'viejo',
    detalle: {categoria: 'Toros', dueno, cantidad: 2, precio: 800, contraparte: 'Fulano', guia: 'S500005', obs: null}, fecha_cliente: '09/10/2026'}, new Set());
  chequear(`${etiqueta}: un evento viejo (sin fin) se aplica igual y figura "faltan datos"`, (W2.__est().potreros[pX].animales[kX] || 0) === antesX + 2 && W2.movimientosConGuia().find(r => r.guia === 'S500005').faltanDatos === true);
  W2.aplicarEventoRemoto({event_id: 'e-malo', creado_en: '2026-10-09T13:01:00Z', tipo: 'compra', potrero: pX, dispositivo: 'otro',
    detalle: {categoria: 'Toros', dueno, cantidad: 2, precio: 800, contraparte: 'X', guia: 'S500006', fin: {op: 'compra', importe: 'mucho', kilosNeto: 1e99}}, fecha_cliente: '09/10/2026'}, new Set());
  chequear(`${etiqueta}: un evento con números inválidos dentro de fin se descarta entero`, (W2.__est().potreros[pX].animales[kX] || 0) === antesX + 2 && !W2.__est().potreros[pX].historial.some(h => h.origDatos && h.origDatos.guia === 'S500006'));
  W2.aplicarEventoRemoto({event_id: 'e-xss', creado_en: '2026-10-09T13:02:00Z', tipo: 'compra', potrero: pX, dispositivo: 'otro',
    detalle: {categoria: 'Toros', dueno, cantidad: 1, precio: 100, contraparte: '<img src=x onerror=alert(1)>', guia: 'S500007', fin: {op: 'compra', origen: '<script>x</script>', importe: 100, comprador: 'Pedro'}}, fecha_cliente: '09/10/2026'}, new Set());
  const hx = W2.__est().potreros[pX].historial.find(h => h.origDatos && h.origDatos.guia === 'S500007');
  chequear(`${etiqueta}: el texto hostil dentro de fin llega sin < ni >`, !!hx && !/[<>]/.test(JSON.stringify(hx.origDatos)) && !/[<>]/.test(hx.detalle), hx && hx.detalle);
}

async function probarMLySinFormulario(archivo){
  console.log(`\n=== ${archivo} ===`);
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  chequear(`${archivo}: carga sin errores`, errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const esPC = archivo.includes('-pc');
  const bg = win.document.getElementById('btn-guias');
  if(bg && bg.style.display !== 'none'){
    bg.click();
    chequear(`${archivo}: ${esPC ? 'María Laura PC tiene el formulario completo' : 'la móvil tiene el formulario rápido'}`, esPC ? !!win.document.getElementById('cv-pc') : !win.document.getElementById('cv-pc') && !!win.document.getElementById('cv-precio'));
  }
  // el receptor y los cálculos existen en todas las versiones completas (la lista los usa)
  if(win.document.getElementById('mg-lista')) chequear(`${archivo}: la lista de guías conoce "faltan datos"`, typeof win.finCompleto === 'function' && win.finCompleto({importe: 5}) === true && win.finCompleto(null) === false);
}

(async () => {
  const archivos = process.argv.slice(2);
  const pcLV = archivos.find(a => a.includes('la-vuelta-pc'));
  const mvLV = archivos.find(a => a.includes('la-vuelta-movil') && !a.includes('campo'));
  if(pcLV) await probarPC(pcLV, mvLV);
  for(const a of archivos.filter(a => a !== pcLV && a !== mvLV && !a.includes('campo') && !a.includes('pone-chico'))) await probarMLySinFormulario(a);
  console.log(`\n${fallas === 0 ? 'TODO OK' : 'HAY FALLAS: ' + fallas}`);
  process.exit(fallas === 0 ? 0 : 1);
})();
