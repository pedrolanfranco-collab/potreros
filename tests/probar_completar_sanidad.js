/*
 * Completar sanidad del bastón (18/10/2026): toma un export de Datamars sin PRODUCTO/DOSIS/POTRERO, lo completa y devuelve
 * el mismo archivo. Verifica: formato intacto (separador, saltos \r, celdas no tocadas idénticas), solo las categorías
 * elegidas, filas que ya traían producto sin tocar, producto con el nombre exacto del catálogo, validaciones, columnas que
 * faltan se agregan, windows-1252 de ida y vuelta, que la lista de potreros sea la de la config y que nunca escriba (solo GET).
 * Uso: node tests/probar_completar_sanidad.js completar-sanidad/index.html
 */
const fs = require('fs');
const path = require('path');
const { TextDecoder, TextEncoder } = require('util');
const { JSDOM, VirtualConsole } = require('jsdom');
let fallas = 0;
const chequear = (n, c, d) => { console.log((c ? '  OK  ' : '  MAL ') + n + (c ? '' : ' — ' + (d || ''))); if(!c) fallas++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));

const archivo = process.argv[2] || 'completar-sanidad/index.html';
const html = fs.readFileSync(archivo, 'utf8');

async function abrir(catalogo){
  const llamadas = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { console.log('  MAL error en la página — ' + e.message); fallas++; });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.github.io/potreros/completar-sanidad/', virtualConsole: vc,
    beforeParse(win){
      win.TextDecoder = TextDecoder; win.TextEncoder = TextEncoder;
      win.fetch = async (url, opt) => {
        llamadas.push({ url, metodo: (opt && opt.method) || 'GET' });
        if(catalogo === 'caido') throw new Error('sin red');
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(catalogo)) };
      };
    } });
  await dormir(30);
  return { win: dom.window, doc: dom.window.document, llamadas };
}
async function elegirArchivo(p, nombre, bytes){
  const f = new p.win.File([bytes], nombre, { type: 'text/csv' });
  if(!f.arrayBuffer) f.arrayBuffer = async () => Uint8Array.from(bytes).buffer;
  const inp = p.doc.getElementById('archivo');
  Object.defineProperty(inp, 'files', { configurable: true, value: [f] });
  inp.dispatchEvent(new p.win.Event('change'));
  await dormir(30);
}
function llenar(p, campos){
  for(const [id, v] of Object.entries(campos)) p.doc.getElementById(id).value = v;
  p.doc.getElementById('completar').click();
}
const texto = p => p.doc.getElementById('msg-sanidad').textContent;
const filasDe = t => t.split(/\r\n|\r|\n/);

// Mismo formato que el export real de la app de Datamars (sesión 1154): coma, \r sin \n, columnas vacías
const ENC = 'EID,VID,Date,Time,PESO,RODEO,GEN,PRODUCTO,DOSIS,CATEGORIA,PROPIETARIO,PRODUCTO2,POTRERO,DOSIS 2,ORIGEN,NOTA';
const FILAS = [
  '858000061110956,,15/10/2026,09:13:38,,H5,5,,,TERNERA,PEDRO,,,,PROPIO,',
  '858000061110936,,15/10/2026,09:13:38,,H5,5,,,TERNERA,PEDRO,,,,PROPIO,',
  '858000064237631,,15/10/2026,09:13:39,,H5,5,,,TERNERA,PEDRO,,,,PROPIO,"nota, con coma"',
  '858000064237632,,15/10/2026,09:14:01,,H5,4,,,VACA,SILVIA,,,,PROPIO,',
  '858000064237633,,15/10/2026,09:14:05,,H5,5,Aftosa,2,TERNERA,PEDRO,,7,,PROPIO,'      // ya traía producto
];
const ORIGINAL = ENC + '\r' + FILAS.join('\r') + '\r';
const CAT = ['Aftosa', 'Clostrisan 9+T', 'Ivermectina R', 'Terramicina Solución'].map(producto => ({ producto }));

(async () => {
  // ---------- potreros = config ----------
  const cfg = require(path.resolve('template/configs/la-vuelta.js'));
  const deConfig = cfg.potrerosGeo.map(p => p.nombre);
  const m = html.match(/const POTREROS = (\[[\s\S]*?\]);/);
  const enPagina = m ? JSON.parse(m[1]) : [];
  chequear('la lista de potreros es la de template/configs/la-vuelta.js', JSON.stringify(enPagina.slice().sort()) === JSON.stringify(deConfig.slice().sort()),
    'página: ' + enPagina.length + ', config: ' + deConfig.length);

  // ---------- caso normal ----------
  let p = await abrir(CAT);
  chequear('lee el catálogo de productos_catalogo', p.llamadas.some(l => /productos_catalogo/.test(l.url)));
  chequear('catálogo al día en la lista', p.doc.querySelectorAll('#catalogo option').length === 4 && /al día/.test(p.doc.getElementById('nota-catalogo').textContent));
  chequear('el potrero arranca sin elegir', p.doc.getElementById('pot').value === '');
  await elegirArchivo(p, 'XRS2_3946_Sesion1154_2026-10-15.csv', Buffer.from(ORIGINAL, 'utf8'));
  const resumen = p.doc.getElementById('resumen').textContent;
  chequear('resumen: 5 animales y la fecha', /5 animales/.test(resumen) && /15\/10\/2026/.test(resumen), resumen);
  chequear('avisa que una fila ya trae producto', /1 fila\(s\) ya traen producto/.test(resumen));
  const cajas = [...p.doc.querySelectorAll('#cats input')];
  chequear('una casilla por categoría, todas marcadas', cajas.length === 2 && cajas.every(c => c.checked), cajas.map(c => c.value).join());

  // validaciones
  llenar(p, { p1: '', d1: '', pot: '' });
  chequear('sin datos: pide producto, dosis y potrero', /Falta el producto/.test(texto(p)) && /Falta la dosis/.test(texto(p)) && /Elegí el potrero/.test(texto(p)), texto(p));
  llenar(p, { p1: 'Aftoza', d1: '2', pot: '12' });
  chequear('producto fuera del catálogo: no deja', /no está en el catálogo/.test(texto(p)) && !p.win.estadoCompletar().salida);
  llenar(p, { p1: 'aftosa', d1: '0', pot: '12' });
  chequear('dosis 0: no deja', /Falta la dosis/.test(texto(p)));
  llenar(p, { p1: 'aftosa', d1: '2', p2: '', d2: '3', pot: '12' });
  chequear('dosis 2 sin producto 2: no deja', /dosis 2 sin producto 2/.test(texto(p)));
  llenar(p, { p1: 'aftosa', d1: '2', p2: 'clostrisan 9+t', d2: '', pot: '12' });
  chequear('producto 2 sin dosis: no deja', /dosis del producto 2/.test(texto(p)));

  // solo Terneras, con dos productos
  cajas.find(c => c.value === 'VACA').checked = false;
  llenar(p, { p1: 'aftosa', d1: '2,5', p2: 'CLOSTRISAN 9+T', d2: '5', pot: '12' });
  let s = p.win.estadoCompletar().salida;
  chequear('genera la salida', !!s, texto(p));
  const out = filasDe(s.texto);
  chequear('mismo nombre de archivo', s.nombre === 'XRS2_3946_Sesion1154_2026-10-15.csv');
  chequear('mismos saltos \\r, sin \\n agregados', s.texto.indexOf('\n') < 0 && s.texto.endsWith('\r'));
  chequear('encabezado idéntico (no agrega columnas que ya estaban)', out[0] === ENC, out[0]);
  chequear('misma cantidad de filas', out.length === FILAS.length + 2 && out[out.length - 1] === '');
  chequear('1ª ternera: producto exacto del catálogo, dosis con punto, potrero', out[1] === '858000061110956,,15/10/2026,09:13:38,,H5,5,Aftosa,2.5,TERNERA,PEDRO,Clostrisan 9+T,12,5,PROPIO,', out[1]);
  chequear('nota con coma: sigue entre comillas', out[3].endsWith(',PROPIO,"nota, con coma"') && /,Aftosa,2\.5,/.test(out[3]), out[3]);
  chequear('la vaca (desmarcada) queda idéntica', out[4] === FILAS[3]);
  chequear('la fila que ya traía producto queda idéntica', out[5] === FILAS[4]);
  chequear('cuenta lo que hizo', s.cambiadas === 3 && s.yaTenian === 1 && s.fuera === 1 && /3 animal/.test(p.doc.getElementById('msg-salida').textContent));
  chequear('muestra descargar', !p.doc.getElementById('paso-salida').hidden);
  // descargar: arma el blob y un <a download> con el mismo nombre
  let descargado = null;
  p.win.URL.createObjectURL = b => { descargado = b; return 'blob:x'; };
  p.win.URL.revokeObjectURL = () => {};
  const clicks = []; p.win.HTMLAnchorElement.prototype.click = function(){ clicks.push(this.download); };
  p.doc.getElementById('descargar').click();
  chequear('descarga con el mismo nombre', descargado && clicks[0] === 'XRS2_3946_Sesion1154_2026-10-15.csv');
  chequear('nunca escribe (solo GET)', p.llamadas.every(l => l.metodo === 'GET'));
  // completar otra vez no acumula: se parte siempre del archivo leído
  llenar(p, { p1: 'Ivermectina R', d1: '1', p2: '', d2: '', pot: '7' });
  s = p.win.estadoCompletar().salida;
  chequear('rehacer parte del original (no del ya completado)', filasDe(s.texto)[1] === '858000061110956,,15/10/2026,09:13:38,,H5,5,Ivermectina R,1,TERNERA,PEDRO,,7,,PROPIO,', filasDe(s.texto)[1]);

  // ---------- export sin las columnas de sanidad, \r\n, ; y windows-1252 ----------
  p = await abrir('caido');
  chequear('sin señal: usa la copia guardada del catálogo', p.doc.querySelectorAll('#catalogo option').length === 50 && /copia guardada/.test(p.doc.getElementById('nota-catalogo').textContent));
  const corto = 'EID;Date;CATEGORIA;NOTA\r\n858000000000001;15/10/2026;Ternera;Peña\r\n858000000000002;15/10/2026;Ternera;\r\n';
  await elegirArchivo(p, 'corto.csv', Buffer.from(corto, 'latin1'));
  llenar(p, { p1: 'Terramicina Solución', d1: '10', pot: 'OMBU' });
  s = p.win.estadoCompletar().salida;
  const o2 = filasDe(s.texto);
  chequear('agrega PRODUCTO / DOSIS / POTRERO al final si faltan', o2[0] === 'EID;Date;CATEGORIA;NOTA;PRODUCTO;DOSIS;POTRERO', o2[0]);
  chequear('respeta ; y \\r\\n', o2[1] === '858000000000001;15/10/2026;Ternera;Peña;Terramicina Solución;10;OMBU' && o2[2] === '858000000000002;15/10/2026;Ternera;;Terramicina Solución;10;OMBU' && /\r\n/.test(s.texto), o2[1]);
  const bytes = Buffer.from(p.win.bytesSalida());
  chequear('si vino en windows-1252 sale en windows-1252 (ñ = 0xF1, ó = 0xF3)', s.codificacion === 'windows-1252' && bytes.includes(0xF1) && bytes.includes(0xF3) && !bytes.includes(0xC3), s.codificacion);

  // ---------- no es un export del bastón ----------
  p = await abrir(CAT);
  await elegirArchivo(p, 'lista.csv', Buffer.from('fecha,categoria,potrero,cantidad,producto1,dosis1\n2026-10-15,Terneras,12,93,Aftosa,2\n'));
  chequear('una lista de tratamientos se rechaza y deriva a cargar_sanidad_csv.py', /cargar_sanidad_csv/.test(p.doc.getElementById('msg-archivo').textContent) && p.doc.getElementById('paso-sanidad').hidden);
  await elegirArchivo(p, 'x.csv', Buffer.from('EID,Date\r'));
  chequear('export sin animales: avisa', /no tiene animales/.test(p.doc.getElementById('msg-archivo').textContent));

  // ---------- escape ----------
  p = await abrir(CAT);
  await elegirArchivo(p, 'x.csv', Buffer.from('EID,CATEGORIA,PROPIETARIO\n1,<img src=x onerror=window.pwn=1>,<b>yo</b>\n'));
  chequear('categoría/propietario con HTML se muestran como texto', !p.win.pwn && !p.doc.querySelector('#resumen b + b, #cats img, #resumen img'));

  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
