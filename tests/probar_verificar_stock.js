/*
 * Fase 3 de la auditoría (12/10/2026), paso 5: "🔍 Verificar stock" en la PC (Herramientas › Consultar).
 * Lee TODO el registro (eventos_sync) del establecimiento, rearma el stock en memoria como lo haría un equipo
 * recién instalado (POTREROS_GEO original + estadoInicial + todos los eventos, más lo que esta PC todavía no
 * subió) y lo compara con el stock local. Solo compara: no cambia nada en la PC ni en Supabase.
 *
 * Se prueba con un servidor falso (copia del de probar_paginacion.js) en las 3 PC:
 * (a) estado local armado aplicando los mismos eventos que devuelve el servidor -> "Todo coincide";
 * (b) se altera a mano el estado local (+3 Vacas en un potrero, una categoría sin firma en negativo en otro) ->
 *     aparecen exactamente esas filas con su diferencia;
 * (c) después de verificar: estado, localStorage, POTREROS_GEO y el mapa quedan idénticos (ninguna llamada a
 *     Leaflet, aunque el registro traiga potreros, límites, puntos y reportes);
 * (d) un movimiento de esta PC que está en la cola sin subir NO figura como diferencia (ni se cuenta dos veces si
 *     ya llegó al registro pero sigue en la cola);
 * (e) un potrero que existe solo en esta PC (o solo en el registro) se lista como tal;
 * (f) sin señal: avisa y no lee nada; una lectura que falla: avisa y no compara;
 * (g) el CSV descargado trae las filas de la diferencia.
 *
 * Uso: node probar_verificar_stock.js la-vuelta-pc/index.html maria-laura-pc/index.html pone-chico-pc/index.html
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function esperarHasta(cond, ms){
  const hasta = Date.now() + (ms || 3000);
  while(Date.now() < hasta){ if(cond()) return true; await esperar(15); }
  return cond();
}

function limites(){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; },
    isValid(){ return true; }, pad(){ return b; }, getNorth(){ return -31.9; },
    getSouth(){ return -32.0; }, getEast(){ return -56.3; }, getWest(){ return -56.4; },
    contains(){ return true; } };
  return b;
}
/* Leaflet falso que ANOTA cada llamada (win.__llamadas): la prueba (c) exige que verificar no dibuje, mueva ni
   quite ninguna capa del mapa. */
function stubLeaflet(win){
  win.__llamadas = [];
  const anotar = (nombre, f) => (...a) => { win.__llamadas.push(nombre); return f(...a); };
  const conocidos = {
    getBounds: () => limites(), getLatLng: () => ({ lat: -31.98, lng: -56.34 }),
    getElement: () => win.document.createElement('div'),
    getTooltip: () => ({ setContent(){}, getElement(){ return win.document.createElement('div'); } }),
    getPopup: () => ({ setContent(){}, isOpen(){ return false; } }), isPopupOpen: () => false
  };
  const capa = (origen) => {
    const o = new Proxy({ __capa: true }, {
      get(t, prop){
        if(prop in t) return t[prop];
        if(typeof prop !== 'string') return undefined;
        if(conocidos[prop]) return conocidos[prop];
        return (...a) => { win.__llamadas.push(origen + '.' + prop); return o; };
      }, has(){ return true; } });
    return o;
  };
  const mapa = { setView(){ win.__llamadas.push('map.setView'); return mapa; }, fitBounds(){ win.__llamadas.push('map.fitBounds'); return mapa; },
    on(){ return mapa; }, addLayer(){ win.__llamadas.push('map.addLayer'); return mapa; },
    removeLayer(){ win.__llamadas.push('map.removeLayer'); return mapa; }, hasLayer(){ return true; },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ win.__llamadas.push('map.setMaxBounds'); return mapa; },
    doubleClickZoom: { disable(){}, enable(){} } };
  win.L = { map(){ return mapa; }, tileLayer(){ return capa('tile'); },
    polygon: anotar('L.polygon', () => capa('polygon')), marker: anotar('L.marker', () => capa('marker')),
    circleMarker: anotar('L.circleMarker', () => capa('circleMarker')), circle: anotar('L.circle', () => capa('circle')),
    divIcon: anotar('L.divIcon', () => ({})), latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

/* PostgREST falso (como el de probar_paginacion.js): eq/in/gt/gte, orden por varias columnas, .range() y tope de
   1000 filas por respuesta. Cuenta las consultas a eventos_sync. */
function servidorFalso(filas){
  const s = { filas, consultas: [], fallarLectura: false };
  s.createClient = () => ({ from(tabla){
    const q = { _f: [], _orden: [], _rango: null,
      select(){ return q; },
      eq(c, v){ q._f.push(r => r[c] === v); return q; },
      in(c, vs){ q._f.push(r => vs.includes(r[c])); return q; },
      gt(c, v){ q._f.push(r => String(r[c]) > String(v)); return q; },
      gte(c, v){ q._f.push(r => String(r[c]) >= String(v)); return q; },
      order(c, o){ q._orden.push({ c, asc: !o || o.ascending !== false }); return q; },
      range(d, h){ q._rango = [d, h]; return q; },
      limit(){ return q; }, not(){ return q; }, is(){ return q; },
      insert(){ return Promise.resolve({ error: null, status: 201 }); },
      upsert(){ return Promise.resolve({ error: null, status: 201 }); },
      delete(){ return q; },
      then(res, rej){
        if(tabla === 'eventos_sync') s.consultas.push({ tabla, rango: q._rango });
        if(tabla === 'eventos_sync' && s.fallarLectura)
          return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' }, status: 0 }).then(res, rej);
        let datos = tabla === 'eventos_sync' ? s.filas.filter(r => q._f.every(f => f(r))) : [];
        datos = datos.slice().sort((a, b) => {
          for(const o of q._orden){
            const x = a[o.c], y = b[o.c];
            if(x === y) continue;
            return (String(x) < String(y) ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
        const desde = q._rango ? q._rango[0] : 0;
        const hasta = q._rango ? Math.min(q._rango[1], desde + 999) : 999;
        return Promise.resolve({ data: datos.slice(desde, hasta + 1), error: null, status: 200 }).then(res, rej);
      }
    };
    return q;
  } });
  return s;
}

function configDe(archivo){
  return JSON.parse(fs.readFileSync(archivo, 'utf-8').match(/const CONFIG = (\{.*?\});\n/)[1]);
}

async function levantar(archivo, servidor, opciones){
  opciones = opciones || {};
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  // sin señal al arrancar: la sincronización la dispara la prueba
  let enLinea = false;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const descargas = [];
  win.URL.createObjectURL = (blob) => { descargas.push({ blob }); return 'blob:x'; };
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function(){ if(descargas.length) descargas[descargas.length - 1].nombre = this.download; };
  win.HTMLElement.prototype.scrollIntoView = function(){};
  if(opciones.antes) opciones.antes(win);
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__geo = function(){ return POTREROS_GEO; };
      window.__poligonos = poligonos; window.__puntosLayers = puntosLayers; window.__reportesLayers = reportesLayers;
      window.__sincronizar = sincronizar;
      window.__miId = idDispositivo;
      window.__guardar = guardarEstado;
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await esperar(60);
  return { win, errores, descargas, setEnLinea(v){ enLinea = v; } };
}

const p2 = n => String(n).padStart(2, '0');
function creadoEn(i){ return new Date(Date.UTC(2026, 7, 1) + i * 60000).toISOString().replace('Z', '000+00:00'); }
function uuid(i){ return '00000000-0000-4000-8000-' + String(i).padStart(12, '0'); }

const Z1 = 'ZETA1', Z2 = 'ZETA2', Z3 = 'ZETA3';
const TRI = [[-32.00, -56.00], [-32.00, -56.01], [-32.01, -56.01]];
const TRI2 = [[-32.00, -56.00], [-32.00, -56.02], [-32.02, -56.02]];

/* El registro del establecimiento: dos potreros nuevos, movimientos, y los eventos "peligrosos" para una
   reconstrucción en memoria (límite, puntos, reportes, un potrero que se crea y se elimina) más un tipo que esta
   versión no conoce. Stock esperado en el registro: ZETA1 = Vacas 5 + Novillos 5; ZETA2 = Vacas 4 + Terneros 3. */
function registro(est, D){
  const filas = [];
  const e = (tipo, potrero, detalle, extra) => {
    const i = filas.length;
    filas.push(Object.assign({ id: 'id-' + String(i).padStart(6, '0'), event_id: uuid(i), establecimiento: est, dispositivo: 'otro-equipo',
      tipo, potrero, detalle, fecha_cliente: '15/09/2026', creado_en: creadoEn(i) }, extra || {}));
  };
  e('potrero_creado', Z1, { coords: TRI, area: 10 });
  e('potrero_creado', Z2, { coords: TRI, area: 10 });
  e('potrero_creado', Z3, { coords: TRI, area: 10 });
  e('ingreso', Z1, { categoria: 'Vacas', dueno: D, cantidad: 10 });
  e('ingreso', Z1, { categoria: 'Novillos 2-3 años', dueno: D, cantidad: 5 });
  e('movimiento', Z1, { destino: Z2, categoria: 'Vacas', dueno: D, cantidad: 4 });
  e('nacimiento', Z2, { categoria: 'Terneros', dueno: D, cantidad: 3 });
  e('muerte', Z1, { categoria: 'Vacas', dueno: D, cantidad: 1 });
  e('lluvia', est, { id: 'll_1', mm: 5 });
  e('potrero_limite_actualizado', Z1, { coords: TRI2, area: 11 });
  e('punto_creado', est, { id: 'pt_1', tipo: 'agua', subtipo: 'Bebedero', nombre: 'B1', lat: -32.0, lon: -56.0 });
  e('punto_creado', est, { id: 'pt_2', tipo: 'agua', subtipo: 'Bebedero', nombre: 'B2', lat: -32.0, lon: -56.0 });
  e('punto_eliminado', est, { id: 'pt_2' });
  e('reporte_creado', est, { id: 'rp_1', categoria: 'infraestructura', subtipo: 'Caño roto', lat: -32.0, lon: -56.0, fecha: '2026-09-15' });
  e('reporte_resuelto', est, { id: 'rp_1', fecha: '2026-09-16' });
  e('reporte_creado', est, { id: 'rp_2', categoria: 'infraestructura', subtipo: 'Caño roto', lat: -32.0, lon: -56.0, fecha: '2026-09-15' });
  e('reporte_eliminado', est, { id: 'rp_2' });
  e('potrero_eliminado', Z3, {});
  e('tipo_de_evento_del_futuro', Z1, { x: 1 });
  // ruido de otro establecimiento: no tiene que entrar
  for(let k = 0; k < 5; k++) filas.push({ id: 'otro-' + k, event_id: uuid(900 + k), establecimiento: 'otro_campo', dispositivo: 'otro-equipo',
    tipo: 'ingreso', potrero: Z1, detalle: { categoria: 'Vacas', dueno: D, cantidad: 100 }, fecha_cliente: '15/09/2026', creado_en: creadoEn(500 + k) });
  return filas;
}

const textoDe = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const num = (t) => Number(String(t).replace('−', '-').replace('+', '').trim());
function filasTabla(doc){
  const out = [];
  let pot = null;
  doc.querySelectorAll('#vs-tabla tbody tr').forEach(tr => {
    if(tr.classList.contains('vs-pot')){
      const th = tr.querySelector('th');
      const tag = th.querySelector('.vs-tag');
      pot = { nombre: textoDe(th).replace(textoDe(tag), '').trim(), tag: textoDe(tag) };
    } else {
      const td = tr.querySelectorAll('td');
      out.push({ potrero: pot && pot.nombre, tag: pot && pot.tag, cat: textoDe(td[0]), pc: num(textoDe(td[1])), reg: num(textoDe(td[2])), dif: num(textoDe(td[3])),
        negPc: td[1].classList.contains('vs-neg'), negDif: td[3].classList.contains('vs-neg'), textoDif: textoDe(td[3]) });
    }
  });
  return out;
}
function grupos(doc){ return Array.from(doc.querySelectorAll('#vs-tabla tr.vs-pot th')).map(th => textoDe(th)); }
const totalLocal = (est) => Object.values(est.potreros).reduce((s, p) => s + Object.values(p.animales).reduce((a, n) => a + Number(n || 0), 0), 0);

async function sincronizado(archivo, opciones){
  opciones = opciones || {};
  const cfg = configDe(archivo);
  const D = cfg.duenos[0];
  const s = servidorFalso(registro(cfg.establecimiento, D));
  const app = await levantar(archivo, s, opciones);
  app.cfg = cfg; app.D = D; app.servidor = s;
  if(app.errores.length) return app;
  app.setEnLinea(true);
  await app.win.__sincronizar(false);
  return app;
}
async function abrirVerificar(app){
  const doc = app.win.document;
  doc.getElementById('btn-herramientas').dispatchEvent(new app.win.Event('click', { bubbles: true }));
  doc.getElementById('btn-verificar-stock').dispatchEvent(new app.win.Event('click', { bubbles: true }));
  await esperarHasta(() => doc.getElementById('vs-cuerpo').style.display !== 'none' || /Necesita|No se pudo|Hubo cambios|Sincronizando/.test(textoDe(doc.getElementById('vs-mensaje'))), 4000);
  await esperar(20);
}
const cerrarVerificar = (app) => app.win.document.getElementById('vs-cerrar').dispatchEvent(new app.win.Event('click', { bubbles: true }));
const tarjetas = (doc) => ({
  pc: num(textoDe(doc.querySelector('#vs-card-pc .vs-num'))),
  reg: num(textoDe(doc.querySelector('#vs-card-reg .vs-num'))),
  dif: textoDe(doc.querySelector('#vs-card-dif .vs-num')),
  difSub: textoDe(doc.querySelector('#vs-card-dif .vs-sub')),
  difOk: doc.getElementById('vs-card-dif').classList.contains('vs-ok')
});

function fotoLocal(app){
  const win = app.win;
  const ls = {};
  for(let i = 0; i < win.localStorage.length; i++){ const k = win.localStorage.key(i); ls[k] = win.localStorage.getItem(k); }
  return {
    estado: win.__est(), estadoJson: JSON.stringify(win.__est()), ls: JSON.stringify(ls),
    geo: win.__geo(), geoJson: JSON.stringify(win.__geo()), geoElems: win.__geo().slice(),
    llamadas: win.__llamadas.length,
    poligonos: Object.keys(win.__poligonos).sort().join(','), puntos: Object.keys(win.__puntosLayers).sort().join(','),
    reportes: Object.keys(win.__reportesLayers).sort().join(',')
  };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win: w0, errores: e0 } = await levantar(archivo, servidorFalso([]));
  if(e0.length){ chequear('carga sin errores', false, e0[0]); return; }
  if(!w0.document.getElementById('btn-verificar-stock')){ chequear('existe el botón "🔍 Verificar stock" en Herramientas', false); return; }
  const cfg = configDe(archivo);
  chequear('el botón está en el grupo "Consultar"', !!w0.document.querySelector('#hmenu-grupos .hg:first-child #btn-verificar-stock'));

  console.log('\n--- (a) estado local armado con los mismos eventos: todo coincide; (c) y no cambia nada');
  {
    const app = await sincronizado(archivo);
    if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
    const doc = app.win.document;
    const est = app.win.__est();
    chequear('la sincronización previa dejó el stock esperado (ZETA1 y ZETA2 creados)',
      est.potreros[Z1] && est.potreros[Z2] && est.potreros[Z1].animales['Vacas||' + app.D] === 5 && est.potreros[Z2].animales['Terneros||' + app.D] === 3,
      JSON.stringify(est.potreros[Z1] && est.potreros[Z1].animales));
    // marcadores que esta PC tiene en el mapa y que el registro borra o resuelve (p. ej. quedaron de antes de un borrado):
    // la reconstrucción los vuelve a "borrar" en SU copia, pero no puede tocar los del mapa de verdad
    app.win.__puntosLayers.pt_2 = app.win.L.marker();
    app.win.__reportesLayers.rp_1 = app.win.L.marker();
    app.win.__reportesLayers.rp_2 = app.win.L.marker();
    app.win.__poligonos[Z3] = { layer: app.win.L.polygon(), label: app.win.L.marker(), area: 1 }; // el registro elimina ZETA3
    // y claves de localStorage que una reconstrucción SIN guardas reescribiría (potrero_creado de ZETA1, el eliminado ZETA3 y el límite)
    const ls = app.win.localStorage;
    ls.setItem(cfg.establecimiento + '_potreros_nuevos', JSON.stringify(JSON.parse(ls.getItem(cfg.establecimiento + '_potreros_nuevos') || '[]')
      .filter(x => x.nombre !== Z1).concat([{ nombre: Z3, coords: TRI, area: 1 }])));
    ls.setItem(cfg.establecimiento + '_limites_potreros', '{}');
    const antes = fotoLocal(app);
    const consultasAntes = app.servidor.consultas.length;
    await abrirVerificar(app);
    chequear('la ventana se abre y muestra el resultado', doc.getElementById('modal-verificar-stock').style.display === 'flex' && doc.getElementById('vs-cuerpo').style.display !== 'none',
      textoDe(doc.getElementById('vs-mensaje')));
    const nReg = app.servidor.filas.filter(f => f.establecimiento === app.cfg.establecimiento).length;
    chequear('el subtítulo dice el establecimiento y de cuántos eventos se rearmó', textoDe(doc.getElementById('vs-subtitulo')).includes(cfg.nombre)
      && textoDe(doc.getElementById('vs-subtitulo')).includes('rearmado desde ' + nReg + ' eventos'), textoDe(doc.getElementById('vs-subtitulo')));
    const t = tarjetas(doc);
    chequear('"Esta PC" y "Registro" suman lo mismo', t.pc === totalLocal(app.win.__est()) && t.reg === t.pc, JSON.stringify(t));
    chequear('"Potreros distintos": 0 de Y en verde, "Todo coincide"', /^0 de \d+$/.test(t.dif) && t.difOk && /Todo coincide/.test(t.difSub), JSON.stringify(t));
    chequear('la tabla no tiene filas', filasTabla(doc).length === 0, JSON.stringify(filasTabla(doc)));
    chequear('lee el registro paginado (con .range()) y sin cursor', app.servidor.consultas.length > consultasAntes
      && app.servidor.consultas.slice(consultasAntes).every(c => c.rango), JSON.stringify(app.servidor.consultas.slice(consultasAntes)));
    const notas = textoDe(doc.getElementById('vs-notas'));
    chequear('la nota "Solo compara: no cambia nada…" está', /Solo compara/.test(notas), notas);
    chequear('avisa del evento de un tipo que esta versión no conoce', /desconoc|no conoce/i.test(notas), notas);
    chequear('los botones de CSV y Cerrar están', !!doc.getElementById('vs-csv') && !!doc.getElementById('vs-cerrar'));

    const despues = fotoLocal(app);
    chequear('(c) el estado es el mismo objeto y el mismo contenido', despues.estado === antes.estado && despues.estadoJson === antes.estadoJson);
    chequear('(c) localStorage idéntico (todas las claves)', despues.ls === antes.ls);
    chequear('(c) POTREROS_GEO: misma referencia, mismo contenido, mismos elementos', despues.geo === antes.geo && despues.geoJson === antes.geoJson
      && despues.geoElems.length === antes.geoElems.length && despues.geoElems.every((p, i) => p === antes.geoElems[i]));
    chequear('(c) ninguna llamada a Leaflet ni al mapa (no se crearon ni quitaron capas)', despues.llamadas === antes.llamadas,
      win_llamadas(app, antes.llamadas));
    chequear('(c) polígonos, puntos y reportes del mapa igual que antes', despues.poligonos === antes.poligonos && despues.puntos === antes.puntos && despues.reportes === antes.reportes);
    chequear('(c) el potrero eliminado (ZETA3) sigue sin existir y los que sí, siguen', !app.win.__est().potreros[Z3] && !!app.win.__poligonos[Z1] && !!app.win.__poligonos[Z2]);
    cerrarVerificar(app);
    chequear('"Cerrar" cierra la ventana', doc.getElementById('modal-verificar-stock').style.display === 'none');
    chequear('sin errores en la consola de la página', app.errores.length === 0, app.errores[0]);
  }

  console.log('\n--- (b) estado local alterado a mano: aparecen exactamente esas filas; (g) CSV');
  {
    const app = await sincronizado(archivo);
    const doc = app.win.document;
    const est = app.win.__est();
    const totalAntes = totalLocal(est);
    est.potreros[Z1].animales['Vacas||' + app.D] += 3;
    est.potreros[Z2].animales['Caballos||'] = -2;
    await abrirVerificar(app);
    const filas = filasTabla(doc);
    const f1 = filas.find(f => f.potrero === Z1);
    const f2 = filas.find(f => f.potrero === Z2);
    chequear('solo 2 filas', filas.length === 2, JSON.stringify(filas));
    chequear('ZETA1: Vacas (firma) 8 contra 5, diferencia +3', f1 && f1.cat === `Vacas (${app.D})` && f1.pc === 8 && f1.reg === 5 && f1.dif === 3 && f1.textoDif === '+3', JSON.stringify(f1));
    chequear('ZETA2: Caballos sin firma, −2 contra 0, diferencia −2, en rojo', f2 && f2.cat === `Caballos ${cfg.textoSinAsignar.charAt(0) === '(' ? cfg.textoSinAsignar : '(' + cfg.textoSinAsignar + ')'}` && f2.pc === -2 && f2.reg === 0 && f2.dif === -2
      && f2.textoDif === '−2' && f2.negPc && f2.negDif, JSON.stringify(f2));
    chequear('los potreros van ordenados y con su encabezado', JSON.stringify(grupos(doc)) === JSON.stringify([Z1, Z2]), JSON.stringify(grupos(doc)));
    const t = tarjetas(doc);
    chequear('"Esta PC" refleja lo alterado y "Registro" lo original', t.pc === totalAntes + 3 - 2 && t.reg === totalAntes, JSON.stringify(t) + ' antes ' + totalAntes);
    const y = Object.keys(app.win.__est().potreros).length;
    chequear('"Potreros distintos": 2 de Y, en aviso (no verde)', t.dif === `2 de ${y}` && !t.difOk, JSON.stringify(t));
    const notasB = textoDe(doc.getElementById('vs-notas'));
    chequear(y > 2 ? 'dice cuántos potreros coinciden' : 'no hay otros potreros: no dice nada de los que coinciden',
      y > 2 ? new RegExp('Los otros ' + (y - 2) + ' potreros coinciden').test(notasB) : !/coinciden/.test(notasB), notasB);
    // CSV
    doc.getElementById('vs-csv').dispatchEvent(new app.win.Event('click', { bubbles: true }));
    await esperar(20);
    const d = app.descargas[app.descargas.length - 1];
    chequear('el CSV se llama <ESTABLECIMIENTO>_verificar_stock_<fecha_hora>.csv', d && new RegExp('^' + app.cfg.establecimiento.toUpperCase() + '_verificar_stock_\\d{4}-\\d\\d-\\d\\d_\\d{4}\\.csv$', 'i').test(d.nombre || ''), d && d.nombre);
    const csv = d ? (await d.blob.text()).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean) : [];
    chequear('CSV: encabezado potrero;categoria;firma;esta_pc;registro;diferencia', csv[0] === 'potrero;categoria;firma;esta_pc;registro;diferencia', csv[0]);
    chequear('CSV: tiene las dos filas de la diferencia y nada más', csv.length === 3 && csv.includes(`${Z1};Vacas;${app.D};8;5;3`) && csv.includes(`${Z2};Caballos;${cfg.textoSinAsignar};-2;0;-2`), JSON.stringify(csv));
  }

  console.log('\n--- (d) movimientos de esta PC sin subir no son diferencia (ni se cuentan dos veces)');
  {
    const app = await sincronizado(archivo);
    const doc = app.win.document;
    const est = app.win.__est();
    // una carga local: se aplicó en esta PC y está en la cola esperando subir
    est.potreros[Z1].animales['Vacas||' + app.D] += 2;
    est.colaSync.push({ event_id: uuid(7001), tipo: 'ingreso', potrero: Z1, detalle: { categoria: 'Vacas', dueno: app.D, cantidad: 2, v: 'pc-x' }, fecha_cliente: '20/09/2026' });
    // un evento de otro campo (traslado espejo) en la cola: no es de este establecimiento
    est.colaSync.push({ event_id: uuid(7002), tipo: 'traslado_entrada', potrero: Z1, establecimiento: 'otro_campo', detalle: { items: [{ categoria: 'Vacas', dueno: app.D, cantidad: 50 }] }, fecha_cliente: '20/09/2026' });
    // uno que se estaba mandando y YA llegó al registro (sigue en la cola hasta la confirmación): no se cuenta dos veces
    const yaLlego = app.servidor.filas.find(f => f.tipo === 'ingreso' && f.detalle.categoria === 'Novillos 2-3 años');
    est.colaSync.push({ event_id: yaLlego.event_id, tipo: yaLlego.tipo, potrero: yaLlego.potrero, detalle: yaLlego.detalle, fecha_cliente: yaLlego.fecha_cliente });
    // un evento propio que ya subió: está en el registro con el id de esta PC y la PC ya lo aplicó al cargarlo
    est.potreros[Z2].animales['Caballos||' + app.D] = 2;
    app.servidor.filas.push({ id: 'id-propio', event_id: uuid(7003), establecimiento: app.cfg.establecimiento, dispositivo: app.win.__miId(),
      tipo: 'ingreso', potrero: Z2, detalle: { categoria: 'Caballos', dueno: app.D, cantidad: 2 }, fecha_cliente: '21/09/2026', creado_en: creadoEn(800) });
    await abrirVerificar(app);
    const t = tarjetas(doc);
    chequear('todo coincide', filasTabla(doc).length === 0 && /^0 de/.test(t.dif) && t.difOk, JSON.stringify({ t, filas: filasTabla(doc) }));
    chequear('"Esta PC" y "Registro" iguales', t.pc === t.reg && t.pc === totalLocal(app.win.__est()), JSON.stringify(t));
    const notas = textoDe(doc.getElementById('vs-notas'));
    chequear('la nota dice cuántos movimientos sin subir se tuvieron en cuenta (1: el propio de este campo)', /Se tuvieron en cuenta 1 movimiento de esta PC sin subir/.test(notas), notas);
    chequear('la cola de la PC quedó como estaba (3 eventos) y no se mandó nada', app.win.__est().colaSync.length === 3);
  }

  console.log('\n--- (e) un potrero solo en esta PC y otro solo en el registro');
  {
    const antes = (win) => win.localStorage.setItem(cfg.establecimiento + '_potreros_nuevos', JSON.stringify([{ nombre: 'SOLOPC', coords: TRI, area: 5 }]));
    const app = await sincronizado(archivo, { antes });
    const doc = app.win.document;
    const est = app.win.__est();
    chequear('SOLOPC existe en el estado local (overlay)', !!est.potreros.SOLOPC);
    est.potreros.SOLOPC.animales['Vacas||' + app.D] = 7;
    delete est.potreros[Z2]; // la PC "no conoce" ZETA2, que sí está en el registro
    await abrirVerificar(app);
    const filas = filasTabla(doc);
    const solo = filas.filter(f => f.potrero === 'SOLOPC');
    chequear('SOLOPC se lista "solo en esta PC" con sus 7 Vacas', solo.length === 1 && /solo en esta PC/i.test(solo[0].tag) && solo[0].pc === 7 && solo[0].reg === 0 && solo[0].dif === 7, JSON.stringify(solo));
    const z2 = filas.filter(f => f.potrero === Z2);
    chequear('ZETA2 se lista "solo en el registro" con lo que tiene el registro', z2.length === 2 && z2.every(f => /solo en el registro/i.test(f.tag) && f.pc === 0)
      && z2.find(f => f.cat.startsWith('Vacas')).reg === 4 && z2.find(f => f.cat.startsWith('Terneros')).reg === 3, JSON.stringify(z2));
    chequear('los dos cuentan como potreros distintos', /^2 de \d+$/.test(tarjetas(doc).dif), tarjetas(doc).dif);
  }

  console.log('\n--- (f) sin señal y lectura que falla');
  {
    const app = await sincronizado(archivo);
    const doc = app.win.document;
    app.setEnLinea(false);
    const antes = app.servidor.consultas.length;
    await abrirVerificar(app);
    chequear('sin señal: "Necesita conexión para leer el registro."', /Necesita conexión para leer el registro\./.test(textoDe(doc.getElementById('vs-mensaje'))), textoDe(doc.getElementById('vs-mensaje')));
    chequear('sin señal: no consulta nada y no muestra tabla', app.servidor.consultas.length === antes && doc.getElementById('vs-cuerpo').style.display === 'none');
    cerrarVerificar(app);
    app.setEnLinea(true);
    app.servidor.fallarLectura = true;
    await abrirVerificar(app);
    chequear('lectura que falla: avisa y no compara', /No se pudo leer el registro/.test(textoDe(doc.getElementById('vs-mensaje'))) && doc.getElementById('vs-cuerpo').style.display === 'none', textoDe(doc.getElementById('vs-mensaje')));
    cerrarVerificar(app);
    app.servidor.fallarLectura = false;
    await abrirVerificar(app);
    chequear('al reintentar con señal vuelve a andar (y borra el aviso anterior)', doc.getElementById('vs-cuerpo').style.display !== 'none' && textoDe(doc.getElementById('vs-mensaje')) === '', textoDe(doc.getElementById('vs-mensaje')));
  }
}
function win_llamadas(app, desde){ return app.win.__llamadas.slice(desde).join(', '); }

(async () => {
  for(const a of process.argv.slice(2)) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
