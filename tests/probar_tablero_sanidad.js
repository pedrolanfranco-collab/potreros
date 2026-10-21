/*
 * Tablero de Sanidad (16/10/2026): lee sanidad_proximos / sanidad_ultimos con un fetch falso y verifica
 * agrupación por urgencia, retiro, escape de HTML, cambio de establecimiento, copia sin señal y que
 * nunca escriba (solo GET).
 * Uso: node tests/probar_tablero_sanidad.js tablero-sanidad/index.html
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
let fallas = 0;
const chequear = (n, c, d) => { console.log((c ? '  OK  ' : '  MAL ') + n + (c ? '' : ' — ' + (d || ''))); if(!c) fallas++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));
const iso = dias => { const d = new Date(); d.setDate(d.getDate() + dias); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };

const archivo = process.argv[2] || 'tablero-sanidad/index.html';
const html = fs.readFileSync(archivo, 'utf8');

const CLAVE_LV = 'clavelavuelta1', CLAVE_ML = 'clavemarialaura1';
// Por defecto el equipo ya tiene la clave de La Vuelta y la de María Laura (la cargó la app: mismo origen, mismas claves de localStorage)
const CLAVES = { clave_campo_la_vuelta: CLAVE_LV, clave_campo_maria_laura: CLAVE_ML };
async function abrir(respuestas, ls, sinClaves){
  ls = Object.assign({}, sinClaves ? {} : CLAVES, ls || {});
  const llamadas = [];
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.github.io/potreros/tablero-sanidad/', virtualConsole: vc,
    beforeParse(win){
      for(const k in ls) win.localStorage.setItem(k, ls[k]);
      win.fetch = async (url, opt) => {
        llamadas.push({ url, metodo: (opt && opt.method) || 'GET', headers: (opt && opt.headers) || {}, body: opt && opt.body });
        const r = respuestas(url, opt);
        if(r === 'caido') throw new Error('sin red');
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(r)) };   // copia: como un JSON recién leído
      };
    } });
  await dormir(50);
  return { win: dom.window, doc: dom.window.document, llamadas };
}

const PROX = [
  { establecimiento: 'la_vuelta', categoria: 'Terneros', sanidad: 'Clostridiales', animales: 80, ultimo_producto: 'Bravoxin', ultimo_tratamiento: iso(-200), fecha_prevista: iso(-5), estado: 'Vencido', actualizado: new Date().toISOString() },
  { establecimiento: 'la_vuelta', categoria: 'Vacas', sanidad: 'Aftosa', gen: 4, animales: 120, fecha_prevista: iso(10), estado: 'Próximo', actualizado: new Date().toISOString() },
  { establecimiento: 'la_vuelta', categoria: 'Novillos', sanidad: 'Garrapata', animales: 40, fecha_prevista: iso(60), actualizado: new Date().toISOString() }
];
const ULT = [
  { establecimiento: 'la_vuelta', fecha: iso(-3), categoria: 'Vacas', potrero: '12', cantidad: 50, productos: '<img src=x onerror=window.pwn=1>', dosis: '5 ml', apto_desde: iso(20), costo_animal: 1.234, actualizado: new Date().toISOString() },
  { establecimiento: 'la_vuelta', fecha: iso(-40), categoria: 'Novillos', potrero: '3', cantidad: 30, productos: 'Ivermectina', apto_desde: iso(-10), actualizado: new Date().toISOString() }
];
const STOCK = [
  { potrero: '12', categoria: 'Vacas', dueno: 'Pedro Lanfranco', cantidad: 50, ug: 50, especie: 'Vacunos', actualizado_en: new Date().toISOString() },
  { potrero: '12', categoria: 'Terneros', dueno: '', cantidad: 30, ug: 0, especie: 'Vacunos', actualizado_en: new Date().toISOString() },
  { potrero: '3', categoria: 'Ovejas', dueno: 'Silvia Dutra', cantidad: 100, ug: 15, especie: 'Ovinos', actualizado_en: new Date().toISOString() },
  { potrero: '7', categoria: 'Novillos', dueno: '', cantidad: 0, ug: 0, especie: 'Vacunos', actualizado_en: new Date().toISOString() }
];
// gen es el último dígito del año de nacimiento; año de referencia = el actual
const ANIO = new Date().getFullYear();
const dig = a => String(a % 10);
const CARAV = [
  { potrero: '12', gen: dig(ANIO - 2), categoria: 'Vaca', estado_vida: 'ACTIVO' }, { potrero: '12', gen: dig(ANIO - 2), categoria: 'Vaca', estado_vida: 'ACTIVO' },
  { potrero: '12 ', gen: dig(ANIO - 1), categoria: 'Vaca', estado_vida: null },
  { potrero: '12', gen: dig(ANIO - 1), categoria: 'Vaca', estado_vida: 'VENDIDO' },          // no cuenta
  { potrero: 'FORCER', gen: dig(ANIO - 3), categoria: 'Novillo 2-3', estado_vida: 'ACTIVO' }         // potrero que no está en el stock
];
// cargas (sanidad_carga): la primera coincide con la 1ª fila de Últimos; la 3ª es de otro potrero y no debe cruzar
const CARGAS = [
  { fecha: iso(-3), categoria: 'vacas', potrero: ' 12', cantidad: 50, gen: 5 },
  { fecha: iso(-3), categoria: 'Vacas', potrero: '12', cantidad: 50, gen: 3 },
  { fecha: iso(-3), categoria: 'Vacas', potrero: '99', cantidad: 50, gen: 8 }
];
const resp = (url, opt) => {
  if(url.includes('rpc/verificar_clave')){            // la clave buena de cada campo
    const b = JSON.parse((opt && opt.body) || '{}');
    return b.clave === (b.est === 'la_vuelta' ? CLAVE_LV : CLAVE_ML);
  }
  const vacio = url.includes('maria_laura');
  if(url.includes('sanidad_proximos')) return vacio ? [] : PROX;
  if(url.includes('sanidad_ultimos')) return vacio ? [] : ULT;
  if(url.includes('sanidad_carga')) return vacio ? [] : CARGAS;
  if(url.includes('stock_potreros')) return vacio ? [] : STOCK;
  if(url.includes('animales_caravana')) return vacio ? [] : CARAV;
  return [];
};

(async () => {
  console.log('Ícono propio (no el de una app)');
  const crypto = require('crypto'), path = require('path');
  const carpeta = path.dirname(archivo);
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const manifest = JSON.parse(fs.readFileSync(path.join(carpeta, 'manifest.json'), 'utf8'));
  chequear('el manifest declara íconos y todos existen', manifest.icons.length >= 6 && manifest.icons.every(i => fs.existsSync(path.join(carpeta, i.src))));
  const ajenas = fs.readdirSync(path.join(carpeta, '..')).filter(d => /^(la-vuelta|maria-laura|pone-chico)/.test(d));
  const repetidos = [];
  for(const n of [48, 72, 96, 144, 192, 512]){
    const mio = sha(path.join(carpeta, 'icon-' + n + 'x' + n + '.png'));
    for(const d of ajenas){ const f = path.join(carpeta, '..', d, 'icon-' + n + 'x' + n + '.png'); if(fs.existsSync(f) && sha(f) === mio) repetidos.push(d + '/' + n); }
  }
  chequear('ningún ícono es igual al de una app', repetidos.length === 0, repetidos.join(', '));
  chequear('ícono para iPhone declarado', /rel="apple-touch-icon"/.test(html));

  console.log('Próximos y últimos');
  const a = await abrir(resp);
  const prox = a.doc.getElementById('vista-prox').innerHTML;
  chequear('pide las dos tablas del establecimiento', a.llamadas.some(l => l.url.includes('sanidad_proximos') && l.url.includes('establecimiento=eq.la_vuelta')) && a.llamadas.some(l => l.url.includes('sanidad_ultimos')));
  chequear('solo GET (salvo la pregunta verificar_clave, que no escribe)', a.llamadas.every(l => l.metodo === 'GET' || (l.metodo === 'POST' && l.url.includes('/rpc/verificar_clave'))));
  chequear('un vencido, uno en 15 días, uno más adelante', /<b>1<\/b><span>vencidos/.test(prox) && /<b>1<\/b><span>en 15 días/.test(prox) && /<b>1<\/b><span>más adelante/.test(prox), prox.slice(0, 300));
  chequear('el vencido sale primero', prox.indexOf('Terneros') < prox.indexOf('Vacas') && prox.indexOf('Vacas') < prox.indexOf('Novillos'));
  chequear('"hace 5 días" en el vencido', prox.includes('hace 5 días'));
  const ult = a.doc.getElementById('vista-ult').innerHTML;
  chequear('el HTML de un producto se escapa', a.win.pwn === undefined && !ult.includes('<img') && ult.includes('&lt;img'));
  chequear('en retiro hasta (apto en el futuro)', ult.includes('En retiro hasta'));
  chequear('apto desde (apto en el pasado)', ult.includes('Apto desde'));
  chequear('costo con 2 decimales', ult.includes('US$ 1.23'));
  chequear('el estado dice "Leído"', /Leído/.test(a.doc.getElementById('estado').textContent));

  console.log('Generación en Últimos y Próximos');
  chequear('pide la carga de La Vuelta (sanidad_carga) solo con gen', a.llamadas.some(l => /sanidad_carga\?/.test(l.url) && l.url.includes('gen=not.is.null') && l.url.includes('establecimiento=eq.la_vuelta')));
  const anioDe = d => { let y = ANIO; while(y % 10 !== d) y--; return y; };
  chequear('Últimos cruza la carga por fecha, categoría, potrero y cantidad', ult.includes('Generación') && ult.includes(anioDe(5) + ' (gen 5)') && ult.includes(anioDe(3) + ' (gen 3)'), ult.slice(0, 300));
  chequear('no cruza con una carga de otro potrero', !ult.includes('(gen 8)'));
  chequear('una fila sin carga no muestra generación', (ult.match(/Generación/g) || []).length === 1);
  chequear('Próximos muestra el gen si la fila lo trae', prox.includes(anioDe(4) + ' (gen 4)') && (prox.match(/Generación/g) || []).length === 1);

  console.log('Próximos: generaciones de la caravana por categoría');
  const nGC = (prox.match(/Generaciones con caravana/g) || []).length;
  const tarjeta = cat => { const i = prox.indexOf('<strong>' + cat); return prox.slice(i, prox.indexOf('</div></div>', prox.indexOf('class="gen"', i)) + 12); };
  chequear('pide la categoría al padrón', a.llamadas.some(l => l.url.includes('animales_caravana') && l.url.includes('categoria')));
  chequear('Vacas muestra las generaciones de la caravana "Vaca" (sin la vendida)', tarjeta('Vacas').includes(anioDe((ANIO - 2) % 10) + ' (gen ' + ((ANIO - 2) % 10) + ') · <b>2</b>') && tarjeta('Vacas').includes(anioDe((ANIO - 1) % 10) + ' (gen ' + ((ANIO - 1) % 10) + ') · <b>1</b>'), tarjeta('Vacas').slice(-300));
  chequear('Novillos coincide con "Novillo 2-3"', tarjeta('Novillos').includes(anioDe((ANIO - 3) % 10) + ' (gen ' + ((ANIO - 3) % 10) + ') · <b>1</b>'));
  chequear('Terneros (sin caravanas) no muestra el bloque', nGC === 2, 'bloques: ' + nGC);
  chequear('catBase une singular, plural y edades', a.win.catBase('Novillo 2-3') === a.win.catBase('Novillos') && a.win.catBase('Vacas') === a.win.catBase('Vaca') && a.win.catBase('Vaquillona 1-2') === a.win.catBase('Vaquillonas') && a.win.catBase('Vacas') !== a.win.catBase('Novillos'));

  console.log('Si falla la lectura de la carga, Últimos igual se ve');
  const e0 = await abrir((url, opt) => url.includes('sanidad_carga') ? 'caido' : resp(url, opt));
  const u0 = e0.doc.getElementById('vista-ult');
  chequear('Últimos sin generación pero con los datos', u0.textContent.includes('Ivermectina') && u0.textContent.includes('Vacas') && !u0.textContent.includes('Generación'), u0.textContent.slice(0, 200));

  console.log('Stock por potrero y generación');
  const st = a.doc.getElementById('vista-stock').innerHTML;
  const txt = a.doc.getElementById('vista-stock').textContent;
  chequear('pide stock_potreros y animales_caravana con límite y offset', a.llamadas.some(l => l.url.includes('stock_potreros') && l.url.includes('offset=0')) && a.llamadas.some(l => l.url.includes('animales_caravana')));
  chequear('total de animales = 180 (ignora cantidad 0)', /<b>180<\/b><span>animales/.test(st), st.slice(0, 200));
  chequear('total UG = 65', /<b>65<\/b><span>UG/.test(st));
  chequear('3 potreros... con hacienda son 2 (el de cantidad 0 no cuenta)', /<b>2<\/b><span>potreros con hacienda/.test(st));
  chequear('totales por especie', txt.includes('Vacunos 80') && txt.includes('Ovinos 100'));
  const gl = n => (ANIO - n) + ' \\(gen ' + ((ANIO - n) % 10) + '\\) · ';
  chequear('generación total con año y dígito: ' + (ANIO-2) + ' (gen ' + ((ANIO-2)%10) + ') · 2, ' + (ANIO-1) + ' · 1, ' + (ANIO-3) + ' · 1 (sin el vendido)',
    new RegExp(gl(2) + '2').test(txt) && new RegExp(gl(1) + '1').test(txt) && new RegExp(gl(3) + '1').test(txt) && !/ · 5/.test(txt.slice(txt.indexOf('Generación'))), txt.slice(txt.indexOf('Generación'), txt.indexOf('Generación') + 160));
  chequear('generación del potrero 12 se une pese al espacio en el nombre', /Potrero 12[\s\S]*?Generación \(con caravana\)/.test(st));
  chequear('el potrero que no figura en el stock queda aparte', st.includes('sin potrero del stock') && st.indexOf('FORCER') === -1 && st.includes(String(ANIO-3)));
  chequear('nota de cobertura (3 de 180)', txt.includes('4 de 180') || txt.includes('3 de 180'), txt.slice(txt.indexOf('Cuenta')));
  chequear('potrero 3 antes que 12 (orden numérico)', st.indexOf('Potrero 3') < st.indexOf('Potrero 12'));
  chequear('desglose por dueño/firma', st.includes('Pedro Lanfranco') && st.includes('sin asignar'));
  const buscar = a.doc.getElementById('buscar'); buscar.value = '12'; buscar.dispatchEvent(new a.win.Event('input'));
  const st2 = a.doc.getElementById('vista-stock').innerHTML;
  chequear('el buscador filtra los potreros', st2.includes('Potrero 12') && !st2.includes('Potrero 3<'));
  chequear('la pestaña elegida se recuerda', (a.win.document.getElementById('tab-stock').click(), a.win.localStorage.getItem('tablero_sanidad_v1_tab') === 'stock'));

  console.log('Si el padrón de caravanas falla, el stock igual se ve');
  const d = await abrir((url, opt) => url.includes('animales_caravana') ? 'caido' : resp(url, opt));
  chequear('stock sin generación y con aviso', d.doc.getElementById('vista-stock').textContent.includes('180') && d.doc.getElementById('vista-stock').textContent.includes('No se pudo leer la generación'));

  console.log('Pestañas y cambio de establecimiento');
  a.doc.getElementById('tab-ult').click();
  chequear('pestaña Últimos', !a.doc.getElementById('vista-ult').hidden && a.doc.getElementById('vista-prox').hidden);
  a.doc.getElementById('estab').value = 'maria_laura';
  a.doc.getElementById('estab').dispatchEvent(new a.win.Event('change'));
  await dormir(50);
  chequear('María Laura vacía muestra aviso', a.doc.getElementById('vista-prox').innerHTML.includes('No hay tratamientos'));
  chequear('pidió María Laura', a.llamadas.some(l => l.url.includes('establecimiento=eq.maria_laura')));

  console.log('Sin señal usa la copia guardada');
  const copia = { prox: PROX, ult: ULT, leido: new Date(Date.now() - 3600e3).toISOString() };
  const b = await abrir(() => 'caido', { tablero_sanidad_v1_la_vuelta: JSON.stringify(copia) });
  chequear('muestra la copia', b.doc.getElementById('vista-prox').innerHTML.includes('Clostridiales'));
  chequear('avisa que no hay conexión', /sin conexión/.test(b.doc.getElementById('estado').textContent));

  console.log('Publicación vieja de la PC');
  const vieja = ULT.map(f => ({ ...f, actualizado: new Date(Date.now() - 30 * 3600e3).toISOString() }));
  const c = await abrir(url => url.includes('proximos') ? PROX.map(f => ({ ...f, actualizado: new Date(Date.now() - 30 * 3600e3).toISOString() })) : vieja);
  chequear('advierte que la PC no publica', /la PC no publica/.test(c.doc.getElementById('estado').textContent) && c.doc.getElementById('estado').className === 'mal');

  console.log('Clave del campo (Fase 4)');
  const tablas = ls => ls.filter(l => /\/rest\/v1\/(sanidad_|stock_|animales_)/.test(l.url));
  const deLV = l => l.url.includes('la_vuelta') || /sanidad_carga\?/.test(l.url);
  chequear('La Vuelta: todas las lecturas mandan x-clave-campo con la clave guardada por la app', tablas(a.llamadas).length >= 5 &&
    tablas(a.llamadas).filter(deLV).every(l => l.headers['x-clave-campo'] === CLAVE_LV), JSON.stringify(tablas(a.llamadas).map(l => l.headers)));
  chequear('y la apikey es la publicable, nunca otra', tablas(a.llamadas).every(l => /^sb_publishable_/.test(l.headers.apikey)));
  chequear('comprueba la clave una vez (verificar_clave) y con el campo correcto', (() => {
    const v = a.llamadas.filter(l => l.url.includes('rpc/verificar_clave')).map(l => JSON.parse(l.body)).filter(b => b.est === 'la_vuelta');
    return v.length === 1 && v[0].clave === CLAVE_LV;       // una sola vez por apertura, no en cada lectura
  })());
  chequear('con la clave bien no hay aviso ni ventana', a.doc.getElementById('aviso-clave').hidden && a.doc.getElementById('modal-clave').hidden);
  chequear('el botón 🔑 está visible en La Vuelta', !a.doc.getElementById('btn-clave').hidden);

  const mm = await abrir(resp, { clave_campo_la_vuelta: '  ClaveLaVuelta1 ' });
  chequear('una clave guardada con mayúsculas y espacios se manda normalizada', tablas(mm.llamadas).length > 0 && tablas(mm.llamadas).filter(deLV).every(l => l.headers['x-clave-campo'] === 'clavelavuelta1'));

  const pc = await abrir(resp, { tablero_sanidad_v1_estab: 'pone_chico' });
  chequear('Pone Chico no usa clave: sin encabezado, sin verificar, sin aviso, sin botón', tablas(pc.llamadas).length >= 5 &&
    tablas(pc.llamadas).every(l => !('x-clave-campo' in l.headers)) && !pc.llamadas.some(l => l.url.includes('rpc/')) &&
    pc.doc.getElementById('aviso-clave').hidden && pc.doc.getElementById('btn-clave').hidden && pc.doc.getElementById('modal-clave').hidden);

  console.log('Sin clave guardada: no lee, no pisa la copia, ofrece cargarla');
  const copiaLV = { prox: PROX, ult: ULT, stock: STOCK, gens: null, leido: new Date(Date.now() - 3600e3).toISOString() };
  const copiaTxt = JSON.stringify(copiaLV);
  const s0 = await abrir(resp, { tablero_sanidad_v1_la_vuelta: copiaTxt }, true);
  chequear('no hace ninguna lectura de tablas ni pregunta a la base', tablas(s0.llamadas).length === 0 && s0.llamadas.every(l => !l.url.includes('rpc/')), JSON.stringify(s0.llamadas.map(l => l.url)));
  chequear('sigue mostrando la última copia', s0.doc.getElementById('vista-prox').innerHTML.includes('Clostridiales'));
  chequear('la copia guardada queda intacta (no se pisa con vacío)', s0.win.localStorage.getItem('tablero_sanidad_v1_la_vuelta') === copiaTxt);
  chequear('aviso "Falta la clave de La Vuelta"', !s0.doc.getElementById('aviso-clave').hidden && /Falta la clave de La Vuelta/.test(s0.doc.getElementById('aviso-clave').textContent));
  chequear('la ventana se abre sola', !s0.doc.getElementById('modal-clave').hidden && /La Vuelta/.test(s0.doc.getElementById('mc-texto').textContent));
  s0.doc.getElementById('mc-mas-tarde').click();
  s0.doc.getElementById('refrescar').click(); await dormir(50);
  chequear('"Más tarde" la cierra y no vuelve sola al refrescar', s0.doc.getElementById('modal-clave').hidden);
  s0.doc.getElementById('aviso-clave').click();
  chequear('el aviso sigue ahí y la abre a mano', !s0.doc.getElementById('modal-clave').hidden);

  console.log('Cargar la clave desde la ventana');
  const input = s0.doc.getElementById('mc-input'), guardar = s0.doc.getElementById('mc-guardar'), err = s0.doc.getElementById('mc-error');
  const antes = s0.llamadas.length;
  input.value = 'corta'; guardar.click(); await dormir(30);
  chequear('una clave con formato inválido se rechaza sin preguntar al servidor', !err.hidden && s0.llamadas.length === antes && s0.win.localStorage.getItem('clave_campo_la_vuelta') === null);
  input.value = 'claveequivocada1'; guardar.click(); await dormir(60);
  chequear('una clave mala se rechaza, no se guarda y lo dice', !err.hidden && /no es la clave de La Vuelta/.test(err.textContent) && s0.win.localStorage.getItem('clave_campo_la_vuelta') === null);
  chequear('y no hizo lecturas de tablas', tablas(s0.llamadas).length === 0);
  input.value = '  CLAVELAVUELTA1 '; guardar.click(); await dormir(150);
  chequear('la clave buena (con mayúsculas y espacios) se guarda normalizada', s0.win.localStorage.getItem('clave_campo_la_vuelta') === CLAVE_LV);
  chequear('cierra la ventana y saca el aviso', s0.doc.getElementById('modal-clave').hidden && s0.doc.getElementById('aviso-clave').hidden);
  chequear('lee con el encabezado de la clave nueva', tablas(s0.llamadas).length >= 5 && tablas(s0.llamadas).filter(deLV).every(l => l.headers['x-clave-campo'] === CLAVE_LV));
  chequear('la copia ahora sí se actualiza con los datos reales', s0.win.localStorage.getItem('tablero_sanidad_v1_la_vuelta') !== copiaTxt && s0.doc.getElementById('vista-prox').innerHTML.includes('Vacas'));

  console.log('Sin señal al guardar la clave: no se guarda y no se confunde con clave mala');
  const sn = await abrir((url, opt) => url.includes('rpc/') ? 'caido' : resp(url, opt), {}, true);
  sn.doc.getElementById('aviso-clave').click();
  sn.doc.getElementById('mc-input').value = CLAVE_LV; sn.doc.getElementById('mc-guardar').click(); await dormir(60);
  chequear('avisa que no pudo comprobar y no guarda', /No se pudo comprobar/.test(sn.doc.getElementById('mc-error').textContent) && sn.win.localStorage.getItem('clave_campo_la_vuelta') === null);

  console.log('Clave guardada que el servidor rechaza');
  const ma = await abrir(resp, { clave_campo_la_vuelta: 'clavevieja12345', tablero_sanidad_v1_la_vuelta: copiaTxt });
  chequear('no lee las tablas y deja la copia', tablas(ma.llamadas).length === 0 && ma.win.localStorage.getItem('tablero_sanidad_v1_la_vuelta') === copiaTxt && ma.doc.getElementById('vista-prox').innerHTML.includes('Clostridiales'));
  chequear('aviso rojo "ya no sirve" y ventana con el mismo mensaje', ma.doc.getElementById('aviso-clave').className === 'invalida' && /ya no sirve/.test(ma.doc.getElementById('aviso-clave').textContent) && !ma.doc.getElementById('modal-clave').hidden && /ya no sirve/.test(ma.doc.getElementById('mc-cargada').textContent));

  console.log('Si no se puede comprobar la clave guardada, igual se intenta leer (no es "clave mala")');
  const nr = await abrir((url, opt) => url.includes('rpc/') ? 'caido' : resp(url, opt));
  chequear('lee con la clave y muestra datos, sin aviso', tablas(nr.llamadas).length >= 5 && nr.doc.getElementById('vista-prox').innerHTML.includes('Vacas') && nr.doc.getElementById('aviso-clave').hidden);
  const nv = await abrir((url, opt) => url.includes('rpc/') ? 'caido' : [], { tablero_sanidad_v1_la_vuelta: copiaTxt });
  chequear('pero si no se pudo comprobar y todo viene vacío, no pisa una copia con datos', nv.win.localStorage.getItem('tablero_sanidad_v1_la_vuelta') === copiaTxt && /no se pudo comprobar la clave/.test(nv.doc.getElementById('estado').textContent), nv.doc.getElementById('estado').textContent);

  console.log('Cada campo tiene su clave');
  const cc = await abrir(resp);
  cc.doc.getElementById('estab').value = 'maria_laura';
  cc.doc.getElementById('estab').dispatchEvent(new cc.win.Event('change'));
  await dormir(80);
  const deML = l => l.url.includes('establecimiento=eq.maria_laura') || /sanidad_carga_maria_laura/.test(l.url);
  chequear('María Laura manda SU clave, no la de La Vuelta', tablas(cc.llamadas).filter(deML).length >= 5 && tablas(cc.llamadas).filter(deML).every(l => l.headers['x-clave-campo'] === CLAVE_ML));
  const sm = await abrir(resp, { tablero_sanidad_v1_estab: 'maria_laura', clave_campo_la_vuelta: CLAVE_LV }, true);
  chequear('María Laura sin su clave (aunque La Vuelta sí la tenga) pide la suya y no lee', tablas(sm.llamadas).length === 0 && !sm.doc.getElementById('aviso-clave').hidden && /Falta la clave de María Laura/.test(sm.doc.getElementById('aviso-clave').textContent));

  console.log('La clave nunca se escribe en la página ni se manda a otro lado');
  chequear('no aparece en el HTML pintado', !a.doc.documentElement.innerHTML.includes(CLAVE_LV));
  chequear('todas las llamadas van al proyecto de Supabase', a.llamadas.concat(s0.llamadas, ma.llamadas, cc.llamadas).every(l => l.url.startsWith('https://skkknfjpwcstefcroqjt.supabase.co/')));

  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})();
