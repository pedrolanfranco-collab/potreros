/*
 * Prueba: "📂 Completar lectura del bastón (CSV)" dentro de Sanidad, SOLO en la PC de La Vuelta.
 *
 * 20/10/2026, a pedido de Pedro. Cuando en la manga se usa el bastón pero no se carga la sanidad, el CSV de Datamars
 * llega a Entrada\ sin PRODUCTO / DOSIS / POTRERO y el Lector no registra la carencia. Antes se arreglaba con la
 * página suelta completar-sanidad/; ahora se hace desde la app de PC: se abre el CSV, se eligen producto, dosis y
 * potrero, y se guarda el MISMO archivo (mismo nombre) en Entrada\ para que el Lector lo procese.
 *
 * Lo que se verifica, y por que importa:
 *  - El boton existe solo en la PC de La Vuelta (CONFIG.completarCsvBaston): nunca en Maria Laura, Pone Chico,
 *    movil ni Campo, donde el puente a Sanidad no existe o no corresponde.
 *  - El archivo sale identico salvo las columnas completadas (separador, saltos \r, celdas intactas, codificacion).
 *    Si cambia algo mas, el Lector puede leerlo distinto.
 *  - Solo se completan las categorias elegidas y las filas que NO traian producto.
 *  - El producto sale con el nombre EXACTO del catalogo y solo se puede elegir del catalogo (un nombre mal escrito
 *    traba el tratamiento en el Lector).
 *  - Guardar usa el selector de archivos del navegador con el nombre original (para pisar la sesion vacia que ya
 *    entro); sin esa API baja el archivo con el mismo nombre.
 *  - La app NO escribe nada en Supabase: toda la escritura la hace el Lector.
 *  - Texto que viene del CSV se muestra escapado.
 * Uso: node tests/probar_csv_baston_pc.js la-vuelta-pc/index.html la-vuelta-movil/index.html ...
 */
const fs = require('fs');
const { TextDecoder, TextEncoder } = require('util');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
const chequear = (n, c, d) => { console.log((c ? '  OK  ' : '  MAL ') + n + (c ? '' : ' — ' + (d || ''))); if(!c) fallas++; };
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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

const CATALOGO = ['Aftosa', 'Clostrisan 9+T', 'Ivermectina R', 'Terramicina Solución'];

function crearServidor(opciones){
  const colgado = !!(opciones && opciones.colgado);
  const escrituras = [];
  const filas = { productos_catalogo: CATALOGO.map(producto => ({ producto, categoria: 'Vacunas', dias_retiro: 0, dias_residual: null, valor_dosis_ml: 1 })),
    sanidad_carga: [], eventos_sync: [], animales_caravana: [], stock_potreros: [] };
  return {
    escrituras,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          insert(obj){ escrituras.push({ tabla, metodo: 'insert', obj }); return Promise.resolve({ error: null }); },
          upsert(obj){ escrituras.push({ tabla, metodo: 'upsert', obj }); return Promise.resolve({ error: null }); },
          update(obj){ escrituras.push({ tabla, metodo: 'update', obj }); return q; },
          delete(){ escrituras.push({ tabla, metodo: 'delete' }); return q; },
          select(){ return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          gt(){ return q; }, gte(){ return q; }, lt(){ return q; }, lte(){ return q; }, is(){ return q; },
          order(){ return q; }, limit(){ return q; }, range(){ return q; }, in(){ return q; },
          then(res){
            if(colgado && tabla === 'productos_catalogo') return new Promise(() => {});   // Supabase que nunca contesta
            const data = (filas[tabla] || []).filter(r => q._filtros.every(f => f(r)));
            return Promise.resolve(res({ data, error: null }));
          }
        };
        return q;
      }, rpc(){ return Promise.resolve({ data: null, error: null }); } };
    }
  };
}

async function levantar(archivo, servidor, conPicker, catalogoGuardado){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.TextDecoder = TextDecoder; win.TextEncoder = TextEncoder;
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  if(catalogoGuardado) win.localStorage.setItem('productos_catalogo_cache', JSON.stringify(catalogoGuardado));
  win.__descargas = [];
  win.HTMLAnchorElement.prototype.click = function(){ win.__descargas.push(this.download); };
  win.__picker = { llamadas: [], escrito: null, cerrado: false };
  if(conPicker){
    win.showSaveFilePicker = async (opt) => {
      win.__picker.llamadas.push(opt);
      return { name: opt.suggestedName, createWritable: async () => ({
        write: async (b) => { win.__picker.escrito = Buffer.from(b); },
        close: async () => { win.__picker.cerrado = true; } }) };
    };
  }
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    // Las variables de la funcion se leen desde adentro del mismo eval (son `let` del script de la app).
    // Si la variante no tiene la funcion, esto solo falla al llamarlo, no al cargar.
    win.eval(codigo + '\n;window.__cfg = CONFIG;' +
      '\n;window.__cbEstado = function(){ return { datos: cbDatos, nombre: cbNombre, codificacion: cbCodificacion, salida: cbSalida }; };' +
      '\n;window.__cbBytes = function(){ return cbBytesSalida(); };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(80);
  return { win, errores };
}

async function elegirArchivo(win, nombre, bytes){
  const f = new win.File([bytes], nombre, { type: 'text/csv' });
  if(!f.arrayBuffer) f.arrayBuffer = async () => Uint8Array.from(bytes).buffer;
  const inp = win.document.getElementById('input-csv-baston');
  Object.defineProperty(inp, 'files', { configurable: true, value: [f] });
  inp.dispatchEvent(new win.Event('change'));
  await dormir(40);
}
const click = (win, id) => win.document.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
function llenar(win, campos){
  for(const [id, v] of Object.entries(campos)) win.document.getElementById(id).value = v;
  click(win, 'cb-completar');
}
const texto = (win, id) => win.document.getElementById(id).textContent;
const filasDe = t => t.split(/\r\n|\r|\n/);

// Mismo formato que el export real de la app de Datamars (sesion 1154): coma, \r sin \n, columnas vacias
const ENC = 'EID,VID,Date,Time,PESO,RODEO,GEN,PRODUCTO,DOSIS,CATEGORIA,PROPIETARIO,PRODUCTO2,POTRERO,DOSIS 2,ORIGEN,NOTA';
const FILAS = [
  '858000061110956,,15/10/2026,09:13:38,,H5,5,,,TERNERA,PEDRO,,,,PROPIO,',
  '858000061110936,,15/10/2026,09:13:38,,H5,5,,,TERNERA,PEDRO,,,,PROPIO,',
  '858000064237631,,15/10/2026,09:13:39,,H5,5,,,TERNERA,PEDRO,,,,PROPIO,"nota, con coma"',
  '858000064237632,,15/10/2026,09:14:01,,H5,4,,,VACA,SILVIA,,,,PROPIO,',
  '858000064237633,,15/10/2026,09:14:05,,H5,5,Aftosa,2,TERNERA,PEDRO,,7,,PROPIO,'      // ya traia producto
];
const ORIGINAL = ENC + '\r' + FILAS.join('\r') + '\r';
const NOMBRE = 'XRS2_3946_Sesion1154_2026-10-15.csv';

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor, true);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const esLaVueltaPc = /la-vuelta-pc[\\/]/.test(archivo);
  const boton = doc.getElementById('btn-csv-baston');

  // ---------- donde esta y donde NO esta ----------
  if(!esLaVueltaPc){
    chequear('fuera de la PC de La Vuelta el boton no existe o queda oculto',
      !boton || boton.style.display === 'none');
    chequear('y no hay entrada de archivo ni formulario visibles',
      !doc.getElementById('form-csv-baston') || doc.getElementById('form-csv-baston').style.display === 'none');
    return;
  }
  chequear('el flag completarCsvBaston esta prendido en La Vuelta', win.__cfg.completarCsvBaston === true);
  chequear('el boton esta en el modal de Sanidad y se ve', !!boton && boton.style.display !== 'none' && doc.getElementById('modal-sanidad').contains(boton));
  chequear('los dos botones de siempre siguen ahi', !!doc.getElementById('btn-cargar-sanidad') && !!doc.getElementById('btn-cargar-sanidad-individual'));

  click(win, 'btn-sanidad');
  await dormir(60);
  click(win, 'btn-csv-baston');
  await dormir(80);
  chequear('abre el formulario', doc.getElementById('form-csv-baston').style.display !== 'none');
  chequear('el catalogo trae los productos de productos_catalogo y NO ofrece "Otro"',
    [...doc.getElementById('cb-p1').options].map(o => o.value).filter(Boolean).join('|') === CATALOGO.join('|'),
    [...doc.getElementById('cb-p1').options].map(o => o.value).join('|'));
  chequear('el potrero se elige de los 31 de La Vuelta', doc.getElementById('cb-pot').options.length === 32, doc.getElementById('cb-pot').options.length);
  chequear('el potrero arranca sin elegir', doc.getElementById('cb-pot').value === '');

  // ---------- leer el archivo ----------
  await elegirArchivo(win, NOMBRE, Buffer.from(ORIGINAL, 'utf8'));
  const resumen = texto(win, 'cb-resumen');
  chequear('resumen: 5 animales y la fecha', /5 animales/.test(resumen) && /15\/10\/2026/.test(resumen), resumen);
  chequear('avisa que una fila ya trae producto', /1 fila\(s\) ya traen producto/.test(resumen), resumen);
  const cajas = [...doc.querySelectorAll('#cb-cats input')];
  chequear('una casilla por categoria, todas marcadas', cajas.length === 2 && cajas.every(c => c.checked), cajas.map(c => c.value).join());

  // ---------- validaciones ----------
  llenar(win, { 'cb-p1': '', 'cb-d1': '', 'cb-pot': '' });
  chequear('sin datos: pide producto, dosis y potrero', /Falta el producto/.test(texto(win, 'cb-msg')) && /Falta la dosis/.test(texto(win, 'cb-msg')) && /Elegí el potrero/.test(texto(win, 'cb-msg')), texto(win, 'cb-msg'));
  llenar(win, { 'cb-p1': 'Aftosa', 'cb-d1': '0', 'cb-pot': '12' });
  chequear('dosis 0: no deja', /Falta la dosis/.test(texto(win, 'cb-msg')));
  llenar(win, { 'cb-p1': 'Aftosa', 'cb-d1': '2 ml', 'cb-pot': '12' });
  chequear('"2 ml" no es una dosis', /Falta la dosis/.test(texto(win, 'cb-msg')));
  llenar(win, { 'cb-p1': 'Aftosa', 'cb-d1': '2', 'cb-p2': '', 'cb-d2': '3', 'cb-pot': '12' });
  chequear('dosis 2 sin producto 2: no deja', /dosis 2 sin producto 2/.test(texto(win, 'cb-msg')));
  llenar(win, { 'cb-p1': 'Aftosa', 'cb-d1': '2', 'cb-p2': 'Clostrisan 9+T', 'cb-d2': '', 'cb-pot': '12' });
  chequear('producto 2 sin dosis: no deja', /dosis del producto 2/.test(texto(win, 'cb-msg')));
  chequear('mientras haya errores no hay nada para guardar', doc.getElementById('cb-guardar').disabled === true || doc.getElementById('cb-salida').hidden === true);

  // ---------- completar: solo Terneras, con dos productos ----------
  cajas.find(c => c.value === 'VACA').checked = false;
  llenar(win, { 'cb-p1': 'Aftosa', 'cb-d1': '2,5', 'cb-p2': 'Clostrisan 9+T', 'cb-d2': '5', 'cb-pot': '12' });
  const est = win.__cbEstado();
  chequear('genera la salida', !!est.salida, texto(win, 'cb-msg'));
  const out = filasDe(est.salida.texto);
  chequear('mismo nombre de archivo', est.salida.nombre === NOMBRE);
  chequear('mismos saltos \\r, sin \\n agregados', est.salida.texto.indexOf('\n') < 0 && est.salida.texto.endsWith('\r'));
  chequear('encabezado identico (no agrega columnas que ya estaban)', out[0] === ENC, out[0]);
  chequear('misma cantidad de filas', out.length === FILAS.length + 2 && out[out.length - 1] === '');
  chequear('1ª ternera: producto exacto del catalogo, dosis con punto, potrero',
    out[1] === '858000061110956,,15/10/2026,09:13:38,,H5,5,Aftosa,2.5,TERNERA,PEDRO,Clostrisan 9+T,12,5,PROPIO,', out[1]);
  chequear('nota con coma: sigue entre comillas', out[3].endsWith(',PROPIO,"nota, con coma"') && /,Aftosa,2\.5,/.test(out[3]), out[3]);
  chequear('la vaca (desmarcada) queda identica', out[4] === FILAS[3]);
  chequear('la fila que ya traia producto queda identica', out[5] === FILAS[4]);
  chequear('cuenta lo que hizo', est.salida.cambiadas === 3 && est.salida.yaTenian === 1 && est.salida.fuera === 1 && /3 animal/.test(texto(win, 'cb-resultado')), texto(win, 'cb-resultado'));
  chequear('ahora se puede guardar', doc.getElementById('cb-salida').hidden === false);

  // ---------- guardar en Entrada ----------
  click(win, 'cb-guardar');
  await dormir(60);
  chequear('abre el selector de archivos con el nombre original', win.__picker.llamadas.length === 1 && win.__picker.llamadas[0].suggestedName === NOMBRE, JSON.stringify(win.__picker.llamadas));
  chequear('con un id fijo, para que recuerde la carpeta Entrada', !!win.__picker.llamadas[0].id);
  chequear('escribe exactamente los bytes del archivo completado', win.__picker.escrito && win.__picker.escrito.toString('utf8') === est.salida.texto && win.__picker.cerrado);
  chequear('avisa que lo guardo y que el Lector lo toma solo', /Guardado/.test(texto(win, 'cb-resultado')) && /Lector/.test(texto(win, 'cb-resultado')), texto(win, 'cb-resultado'));
  chequear('NO baja el archivo ademas del selector', win.__descargas.length === 0);

  // completar otra vez no acumula: se parte siempre del archivo leido
  llenar(win, { 'cb-p1': 'Ivermectina R', 'cb-d1': '1', 'cb-p2': '', 'cb-d2': '', 'cb-pot': '7' });
  chequear('rehacer parte del original (no del ya completado)',
    filasDe(win.__cbEstado().salida.texto)[1] === '858000061110956,,15/10/2026,09:13:38,,H5,5,Ivermectina R,1,TERNERA,PEDRO,,7,,PROPIO,', filasDe(win.__cbEstado().salida.texto)[1]);

  // el usuario cancela el selector: no es un error ni se baja nada
  win.showSaveFilePicker = async () => { const e = new Error('cancelado'); e.name = 'AbortError'; throw e; };
  click(win, 'cb-guardar');
  await dormir(60);
  chequear('cancelar el selector no rompe ni baja el archivo', win.__descargas.length === 0 && !/Error/.test(texto(win, 'cb-resultado')));

  // ---------- nunca escribe en Supabase ----------
  // Al abrirse, la app republica stock_potreros (siempre lo hizo); eso no es de esta funcion. Lo que importa es que
  // completar y guardar el CSV no escriba tratamientos, eventos, catalogo ni padron: de eso se encarga el Lector.
  const PROHIBIDAS = ['sanidad_carga', 'sanidad_carga_maria_laura', 'sanidad_carga_pone_chico', 'eventos_sync', 'productos_catalogo', 'animales_caravana'];
  const malas = servidor.escrituras.filter(e => PROHIBIDAS.includes(e.tabla));
  chequear('la app no escribio sanidad, eventos, catalogo ni padron en Supabase', malas.length === 0, JSON.stringify(malas));

  // ---------- sin selector de archivos: baja el archivo con el mismo nombre ----------
  const s2 = crearServidor();
  const b = await levantar(archivo, s2, false);
  click(b.win, 'btn-sanidad'); await dormir(60); click(b.win, 'btn-csv-baston'); await dormir(80);
  const corto = 'EID;Date;CATEGORIA;NOTA\r\n858000000000001;15/10/2026;Ternera;Peña\r\n858000000000002;15/10/2026;Ternera;\r\n';
  await elegirArchivo(b.win, 'corto.csv', Buffer.from(corto, 'latin1'));
  llenar(b.win, { 'cb-p1': 'Terramicina Solución', 'cb-d1': '10', 'cb-pot': 'OMBU' });
  const e2 = b.win.__cbEstado();
  const o2 = filasDe(e2.salida.texto);
  chequear('agrega PRODUCTO / DOSIS / POTRERO al final si faltan', o2[0] === 'EID;Date;CATEGORIA;NOTA;PRODUCTO;DOSIS;POTRERO', o2[0]);
  chequear('respeta ; y \\r\\n', o2[1] === '858000000000001;15/10/2026;Ternera;Peña;Terramicina Solución;10;OMBU' && /\r\n/.test(e2.salida.texto));
  const bytes = Buffer.from(b.win.__cbBytes());
  chequear('si vino en windows-1252 sale en windows-1252 (ñ = 0xF1, ó = 0xF3)', e2.salida.codificacion === 'windows-1252' && bytes.includes(0xF1) && bytes.includes(0xF3) && !bytes.includes(0xC3), e2.salida.codificacion);
  click(b.win, 'cb-guardar'); await dormir(60);
  chequear('sin selector: baja el archivo con el mismo nombre', b.win.__descargas.length === 1 && b.win.__descargas[0] === 'corto.csv', JSON.stringify(b.win.__descargas));
  chequear('y le dice a Pedro donde ponerlo', /Entrada/.test(texto(b.win, 'cb-resultado')), texto(b.win, 'cb-resultado'));

  // ---------- Supabase lento o caido: el formulario se ve igual ----------
  const d = await levantar(archivo, crearServidor({ colgado: true }), true, CATALOGO);
  click(d.win, 'btn-sanidad'); await dormir(60); click(d.win, 'btn-csv-baston'); await dormir(100);
  chequear('con el catalogo colgado, el formulario se muestra igual con el catalogo guardado y los potreros',
    d.win.document.getElementById('form-csv-baston').style.display !== 'none'
      && d.win.document.getElementById('cb-p1').options.length === CATALOGO.length + 1
      && d.win.document.getElementById('cb-pot').options.length === 32,
    d.win.document.getElementById('cb-p1').options.length + ' / ' + d.win.document.getElementById('cb-pot').options.length);
  chequear('y avisa que esta actualizando el catalogo', /Actualizando el catálogo/.test(texto(d.win, 'cb-msg-catalogo')), texto(d.win, 'cb-msg-catalogo'));

  // ---------- no es un export del bastón ----------
  const c = await levantar(archivo, crearServidor(), true);
  click(c.win, 'btn-sanidad'); await dormir(60); click(c.win, 'btn-csv-baston'); await dormir(80);
  await elegirArchivo(c.win, 'lista.csv', Buffer.from('fecha,categoria,potrero,cantidad,producto1,dosis1\n2026-10-15,Terneras,12,93,Aftosa,2\n'));
  chequear('una lista de tratamientos se rechaza y deriva a cargar_sanidad_csv.py', /cargar_sanidad_csv/.test(texto(c.win, 'cb-msg-archivo')), texto(c.win, 'cb-msg-archivo'));
  await elegirArchivo(c.win, 'x.csv', Buffer.from('EID,Date\r'));
  chequear('export sin animales: avisa', /no tiene animales/.test(texto(c.win, 'cb-msg-archivo')), texto(c.win, 'cb-msg-archivo'));

  // ---------- escape ----------
  await elegirArchivo(c.win, 'x.csv', Buffer.from('EID,CATEGORIA,PROPIETARIO\n1,<img src=x onerror=window.pwn=1>,<b>yo</b>\n'));
  chequear('categoria/propietario con HTML se muestran como texto, sin ejecutar nada',
    !c.win.pwn && !c.win.document.querySelector('#cb-cats img, #cb-resumen img')
      && texto(c.win, 'cb-resumen').includes('<b>yo</b>') && texto(c.win, 'cb-cats').includes('<img src=x onerror=window.pwn=1>'),
    texto(c.win, 'cb-resumen') + ' | ' + texto(c.win, 'cb-cats'));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('uso: node probar_csv_baston_pc.js <archivo.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
