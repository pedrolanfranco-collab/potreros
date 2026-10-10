/*
 * Prueba ad-hoc: las muertes de Terneros se dividen en dos grupos (10/10/2026, a
 * pedido de Pedro): "de temporada" (del nacimiento a la marcación) y "marcados".
 * La app no sabe cuándo se marcó, así que el grupo se elige al cargar la muerte
 * (campo `grupoTernero` del evento 'muerte'; las anteriores quedan "sin clasificar").
 * Cubre:
 *   - el formulario de muerte pide el grupo solo para Terneros y no deja guardar
 *     sin elegirlo; otras categorías no mandan el campo;
 *   - el evento lleva el grupo y otro dispositivo lo recibe (origDatos);
 *   - Stock total: terneros de temporada / marcados / sin clasificar, con la
 *     temporada completa ago-jul (un marcado muerto en enero cuenta);
 *   - editar (PC) cambia el grupo sin duplicar: la muerte vieja se descuenta;
 *   - borrar descuenta del grupo correcto;
 *   - la tabla de muertes por categoría separa las dos filas;
 *   - la carga por voz (móvil) también pide el grupo.
 *
 * Uso: node probar_muerte_terneros_grupo.js la-vuelta-pc/index.html maria-laura-pc/index.html [...]
 *      (por cada "<prefijo>-pc" levanta también "<prefijo>-movil")
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

function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [] };
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _orden: null, _modo: 'select',
          select(){ q._modo='select'; return q; },
          insert(rows){ q._modo='insert'; q._filas = Array.isArray(rows)?rows:[rows]; return q; },
          upsert(rows){ q._modo='upsert'; q._filas = Array.isArray(rows)?rows:[rows]; return q; },
          delete(){ q._modo='delete'; return q; },
          eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
          gte(col,val){ q._filtros.push(r=>r[col]>=val); return q; },
          not(){ return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          order(col,opts){ q._orden = {col, asc: !opts || opts.ascending!==false}; return q; },
          then(res){
            filas[tabla] = filas[tabla] || [];
            if(q._modo==='insert'){
              q._filas.forEach(f=>{
                if(f.event_id && filas[tabla].some(r=>r.event_id===f.event_id)) return;
                filas[tabla].push(Object.assign({creado_en: new Date().toISOString()}, f));
              });
              return Promise.resolve(res({data:q._filas, error:null}));
            }
            if(q._modo==='upsert') return Promise.resolve(res({data:q._filas, error:null}));
            if(q._modo==='delete'){
              filas[tabla] = filas[tabla].filter(r=>!q._filtros.every(f=>f(r)));
              return Promise.resolve(res({data:null, error:null}));
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
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
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
  return { win, errores };
}

/* Un "otro dispositivo" (un celular) que ya subió un evento: se agrega directo a
   la tabla, con la misma forma que deja enviarEvento()/pushEventoRemoto(). */
let seqInyeccion = 0;
async function inyectar(servidor, estab, tipo, potrero, detalle, fecha){
  await dormir(6);
  servidor.filas.eventos_sync.push({
    event_id: 'inj-' + (++seqInyeccion) + '-' + Math.random().toString(36).slice(2, 8),
    establecimiento: estab, dispositivo: 'celular-de-prueba', tipo, potrero, detalle,
    fecha_cliente: fecha, creado_en: new Date().toISOString()
  });
}
const stock = (win, p, key) => (win.__est().potreros[p].animales[key] || 0);
const entradas = (win, p) => win.__est().potreros[p].historial;
const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
// 8/10/2026: en La Vuelta y María Laura la compra/venta se carga desde "📑 Movimientos DICOSE" (ids cv-*); en Pone Chico sigue en el panel del potrero (ids f-*)
const idsCV = (win) => win.__config().guiasHabilitado
  ? { tipo: 'cv-tipo', cat: 'cv-cat', dueno: 'cv-dueno', cant: 'cv-cant', fecha: 'cv-fecha', precio: 'cv-precio', contra: 'cv-contraparte', ok: 'cv-guardar', modal: true }
  : { tipo: 'f-tipo-op', cat: 'f-cat', dueno: 'f-dueno', cant: 'f-cant', fecha: 'f-fecha', precio: 'f-precio', contra: 'f-contraparte', ok: 'f-confirmar', modal: false };
const abrirCompraVenta = (win, p) => {
  if(win.__config().guiasHabilitado){
    win.document.getElementById('btn-guias').click();
    const s = win.document.getElementById('mg-modo'); s.value = 'compraventa'; s.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.getElementById('cv-potrero').value = p;
  } else { win.seleccionarPotrero(p); win.mostrarFormulario(p, 'compraventa'); }
};

function foto(win){
  const o = {};
  Object.keys(win.__est().potreros).sort().forEach(p=>{
    o[p] = Object.entries(win.__est().potreros[p].animales).filter(([,c])=>c!==0).sort((a,b)=>a[0].localeCompare(b[0]));
  });
  return JSON.stringify(o);
}
async function sincronizarTodos(...dispositivos){ for(const d of dispositivos){ await d.win.sincronizar(false); } }

const valorGrupos = (m) => `${m.terneros.temporada}/${m.terneros.marcado}/${m.terneros.sinClasificar}`;

async function probarFormularioYEstadisticas(A, B, F, servidor){
  console.log('  -- formulario, evento y Stock total');
  const estab = A.win.__establecimiento();
  const geo = A.win.__potrerosGeo();
  let p = null, du = '';
  for(const g of geo){
    const animales = A.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] > 0);
    if(k){ p = g.nombre; du = A.win.partesClave(k).dueno; break; }
  }
  if(!p){ console.log('  (sin potreros con stock -- se saltea el formulario)'); return; }
  const hoy = A.win.fechaHoy();
  await inyectar(servidor, estab, 'nacimiento', p, { categoria: 'Terneros', dueno: du, cantidad: 10, obs: 'parto' }, hoy);
  await A.win.sincronizar(false);
  const keyT = A.win.claveAnimal('Terneros', du);
  const t0 = stock(A.win, p, keyT);
  chequear('hay Terneros para probar', t0 >= 10, 'stock ' + t0);

  const base = await A.win.calcularEstadisticasMuertes();
  const anio = base.anioTemporada;
  chequear('la respuesta trae el desglose de terneros', !!base.terneros && typeof base.terneros.temporada === 'number');
  const b0 = valorGrupos(base);

  // --- el formulario
  const doc = A.win.document;
  const abrir = () => { A.win.seleccionarPotrero(p); A.win.mostrarFormulario(p, 'muerte'); };
  const fila = () => doc.getElementById('f-grupo-fila');
  const poner = (id, v) => { const e = doc.getElementById(id); e.value = v; e.dispatchEvent(new A.win.Event('change', { bubbles: true })); };
  abrir();
  chequear('el selector de grupo existe', !!fila());
  poner('f-cat', 'Vacas');
  chequear('con Vacas el grupo no se muestra', fila().style.display === 'none');
  poner('f-cat', 'Terneros');
  chequear('con Terneros el grupo se muestra', fila().style.display !== 'none');
  poner('f-dueno', du);
  doc.getElementById('f-cant').value = '2';
  const eventosAntes = servidor.filas.eventos_sync.length;
  click(A.win, doc.getElementById('f-confirmar'));
  chequear('sin elegir el grupo no guarda nada', stock(A.win, p, keyT) === t0 && servidor.filas.eventos_sync.length === eventosAntes);
  poner('f-grupo', 'temporada');
  click(A.win, doc.getElementById('f-confirmar'));
  await dormir(40);
  const evT = servidor.filas.eventos_sync.filter(r => r.tipo === 'muerte' && r.detalle.grupoTernero === 'temporada');
  chequear('guardó la muerte de temporada (stock -2, evento con grupo)', stock(A.win, p, keyT) === t0 - 2 && evT.length === 1 && evT[0].detalle.cantidad === 2);
  const hT = entradas(A.win, p).find(h => h.tipo === 'muerte' && h.extra && h.extra.grupoTernero === 'temporada');
  chequear('el historial dice "de temporada"', !!hT && /de temporada/.test(hT.detalle), hT && hT.detalle);

  abrir();
  poner('f-cat', 'Terneros'); poner('f-dueno', du); poner('f-grupo', 'marcado');
  doc.getElementById('f-cant').value = '1';
  click(A.win, doc.getElementById('f-confirmar'));
  await dormir(40);
  const evM = servidor.filas.eventos_sync.filter(r => r.tipo === 'muerte' && r.detalle.grupoTernero === 'marcado');
  chequear('guardó la muerte de marcado', evM.length === 1 && stock(A.win, p, keyT) === t0 - 3);

  // otra categoría: no manda el campo
  const keyV = A.win.claveAnimal('Vacas', du);
  A.win.__est().potreros[p].animales[keyV] = (A.win.__est().potreros[p].animales[keyV] || 0) + 1;
  abrir();
  poner('f-cat', 'Vacas'); poner('f-dueno', du);
  doc.getElementById('f-cant').value = '1';
  click(A.win, doc.getElementById('f-confirmar'));
  await dormir(40);
  const evV = servidor.filas.eventos_sync.filter(r => r.tipo === 'muerte' && r.detalle.categoria === 'Vacas' && r.dispositivo !== 'celular-de-prueba').pop();
  chequear('una muerte de Vacas no lleva grupo', !!evV && !('grupoTernero' in evV.detalle));

  // --- otro dispositivo lo recibe
  await B.win.sincronizar(false);
  const hB = entradas(B.win, p).find(h => h.tipo === 'muerte' && h.origDatos && h.origDatos.grupoTernero === 'marcado');
  chequear('otro dispositivo recibe el grupo (origDatos)', !!hB && /marcado/.test(hB.detalle), hB && hB.detalle);

  // --- inyecciones: una vieja sin grupo, un marcado en enero (fuera de ago-dic) y uno de la temporada anterior
  await inyectar(servidor, estab, 'muerte', p, { categoria: 'Terneros', dueno: du, cantidad: 1, obs: 'vieja' }, hoy);
  await inyectar(servidor, estab, 'muerte', p, { categoria: 'Terneros', dueno: du, cantidad: 4, obs: 'enero', grupoTernero: 'marcado' }, `15/01/${anio + 1}`);
  await inyectar(servidor, estab, 'muerte', p, { categoria: 'Terneros', dueno: du, cantidad: 7, obs: 'anterior', grupoTernero: 'marcado' }, `15/03/${anio}`);
  const m1 = await A.win.calcularEstadisticasMuertes();
  const [t0n, mc0, sc0] = b0.split('/').map(Number);
  chequear('de temporada: +2', m1.terneros.temporada === t0n + 2, valorGrupos(m1) + ' vs ' + b0);
  chequear('marcados: +1 de hoy +4 de enero (la temporada anterior no cuenta)', m1.terneros.marcado === mc0 + 5, valorGrupos(m1) + ' vs ' + b0);
  chequear('sin clasificar: +1 (la muerte sin grupo)', m1.terneros.sinClasificar === sc0 + 1, valorGrupos(m1) + ' vs ' + b0);
  const textoStock = A.win.renderMuertesTemporadaHTML(m1);
  chequear('Stock total muestra los grupos', /de temporada/.test(textoStock) && /marcados/.test(textoStock) && /sin clasificar/.test(textoStock));

  // --- borrar descuenta del grupo correcto
  const hMarc = entradas(A.win, p).find(h => h.tipo === 'muerte' && h.extra && h.extra.grupoTernero === 'marcado');
  A.win.borrarHistorial(hMarc.id);
  await dormir(40);
  const m2 = await A.win.calcularEstadisticasMuertes();
  chequear('borrar la muerte de marcado la descuenta de marcados', m2.terneros.marcado === m1.terneros.marcado - 1 && m2.terneros.temporada === m1.terneros.temporada, valorGrupos(m2));
  chequear('y el stock vuelve (+1)', stock(A.win, p, keyT) === t0 - 2);

  // --- editar (PC): pasar la de temporada a marcado, sin duplicar
  const hEd = entradas(A.win, p).find(h => h.tipo === 'muerte' && h.extra && h.extra.grupoTernero === 'temporada' && !h.eliminado);
  A.win.editarHistorial(hEd.id);
  await dormir(40);
  const g = doc.getElementById('f-grupo');
  chequear('editar abre el formulario con el grupo precargado', !!g && g.value === 'temporada', g && g.value);
  poner('f-grupo', 'marcado');
  click(A.win, doc.getElementById('f-confirmar'));
  await dormir(60);
  const m3 = await A.win.calcularEstadisticasMuertes();
  chequear('editar cambia de grupo sin duplicar (temporada -2, marcados +2)',
    m3.terneros.temporada === m2.terneros.temporada - 2 && m3.terneros.marcado === m2.terneros.marcado + 2, valorGrupos(m3) + ' vs ' + valorGrupos(m2));

  // --- tabla de muertes por categoría
  if(typeof A.win.cargarTablaMuertes === 'function' && doc.getElementById('muertes-tabla')){
    await A.win.cargarTablaMuertes('', true);
    await dormir(30);
    const txt = doc.getElementById('muertes-tabla').textContent;
    chequear('la tabla separa "Terneros — marcados"', /Terneros — marcados/.test(txt), txt.slice(0, 200));
  }

  // --- voz (móvil)
  if(typeof F.win.renderInterpretacionVoz === 'function' && F.win.document.getElementById('voz-interpretado')){
    await F.win.sincronizar(false);
    F.win.renderInterpretacionVoz({ accion: 'muerte', categoria: 'Terneros', dueno: du, cantidad: 1, origen: p, destino: '' });
    const fd = F.win.document;
    chequear('voz: con muerte de Terneros se muestra el grupo', fd.getElementById('vz-grupo-fila').style.display !== 'none');
    const antes = servidor.filas.eventos_sync.length;
    click(F.win, fd.getElementById('vz-confirmar'));
    await dormir(30);
    chequear('voz: sin grupo no guarda', servidor.filas.eventos_sync.length === antes);
    fd.getElementById('vz-grupo').value = 'temporada';
    click(F.win, fd.getElementById('vz-confirmar'));
    await dormir(40);
    const ultimo = servidor.filas.eventos_sync[servidor.filas.eventos_sync.length - 1];
    chequear('voz: con grupo guarda el evento con grupoTernero', ultimo && ultimo.tipo === 'muerte' && ultimo.detalle.grupoTernero === 'temporada', JSON.stringify(ultimo && ultimo.detalle));
  }
}

async function probarSoloEstadisticas(A, servidor){
  console.log('  -- Stock total con eventos recibidos (sin potreros)');
  const estab = A.win.__establecimiento();
  const hoy = A.win.fechaHoy();
  const m0 = await A.win.calcularEstadisticasMuertes();
  await inyectar(servidor, estab, 'muerte', 'x', { categoria: 'Terneros', dueno: '', cantidad: 3, grupoTernero: 'temporada' }, hoy);
  await inyectar(servidor, estab, 'muerte', 'x', { categoria: 'Terneros', dueno: '', cantidad: 2, grupoTernero: 'marcado' }, hoy);
  const m1 = await A.win.calcularEstadisticasMuertes();
  chequear('cuenta temporada y marcados', m1.terneros.temporada === m0.terneros.temporada + 3 && m1.terneros.marcado === m0.terneros.marcado + 2, valorGrupos(m1));
}

async function probarEstablecimiento(archivoPc){
  console.log('\n=== ' + archivoPc + ' ===');
  const base = archivoPc.replace(/-pc[\\/]index\.html$/, '');
  const archivoMovil = base + '-movil/index.html';
  if(!fs.existsSync(archivoMovil)){ chequear('existe ' + archivoMovil, false, 'no se encontró'); return; }
  const servidor = crearServidor();
  const A = await levantar(archivoPc, servidor);
  const B = await levantar(archivoPc, servidor);
  const F = await levantar(archivoMovil, servidor);
  const errores = [...A.errores, ...B.errores, ...F.errores];
  chequear('las 3 apps (2 PC, móvil completa) cargan sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  if(A.win.__potrerosGeo().length) await probarFormularioYEstadisticas(A, B, F, servidor);
  else await probarSoloEstadisticas(A, servidor);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarEstablecimiento(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
