/*
 * Tablero de Sanidad (16/10/2026): lee sanidad_proximos / sanidad_ultimos con un fetch falso y verifica
 * agrupación por urgencia, retiro, escape de HTML, cambio de establecimiento, copia sin señal y que
 * nunca escriba (solo GET), y la clave del campo (Fase 4): la manda en x-clave-campo, la comprueba con
 * verificar_clave (un fallo de red nunca es "clave mala"), no pisa la copia con una lectura vacía sin clave,
 * y Pone Chico no la usa.
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

async function abrir(respuestas, ls){
  const llamadas = [];
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.github.io/potreros/tablero-sanidad/', virtualConsole: vc,
    beforeParse(win){
      for(const k in (ls || {})) win.localStorage.setItem(k, ls[k]);
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
const resp = url => {
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
  chequear('solo GET', a.llamadas.every(l => l.metodo === 'GET'));
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
  const e0 = await abrir(url => url.includes('sanidad_carga') ? 'caido' : resp(url));
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
  const d = await abrir(url => url.includes('animales_caravana') ? 'caido' : resp(url));
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

  console.log('Clave del campo (Fase 4): La Vuelta y María Laura la mandan, Pone Chico no');
  const rpcOk = (url, opt) => url.includes('rpc/verificar_clave') ? true : resp(url);
  const rpcMala = (url) => url.includes('rpc/verificar_clave') ? false : resp(url);
  const hdr = l => l.headers['x-clave-campo'];

  // sin clave guardada: avisa, y (modo suave) igual lee
  const k0 = await abrir(resp);
  chequear('sin clave: aparece el aviso "Falta la clave de La Vuelta"', !k0.doc.getElementById('clave-aviso').hidden && /Falta la clave de La Vuelta/.test(k0.doc.getElementById('clave-msg').textContent), k0.doc.getElementById('clave-msg').textContent);
  chequear('sin clave: no manda el encabezado ni llama a verificar_clave', k0.llamadas.every(l => !hdr(l)) && !k0.llamadas.some(l => l.url.includes('verificar_clave')));
  chequear('sin clave: igual muestra los datos mientras las políticas estén abiertas', k0.doc.getElementById('vista-prox').innerHTML.includes('Clostridiales'));

  // clave guardada por la app (mismo origen): la toma, la manda y la comprueba una vez
  const k1 = await abrir(rpcOk, { clave_campo_la_vuelta: '  ClavePrueba1 ' });
  const gets1 = k1.llamadas.filter(l => l.metodo === 'GET');
  chequear('con clave: todas las lecturas llevan x-clave-campo (normalizada)', gets1.length >= 4 && gets1.every(l => hdr(l) === 'claveprueba1'), JSON.stringify(gets1.map(hdr)));
  const rpc1 = k1.llamadas.filter(l => l.url.includes('rpc/verificar_clave'));
  chequear('con clave: la comprueba UNA vez con POST {est, clave}', rpc1.length === 1 && rpc1[0].metodo === 'POST' && JSON.parse(rpc1[0].body).est === 'la_vuelta' && JSON.parse(rpc1[0].body).clave === 'claveprueba1', JSON.stringify(rpc1.map(l => l.body)));
  chequear('con clave buena: no hay aviso', k1.doc.getElementById('clave-aviso').hidden);
  chequear('el POST es solo la comprobación (nunca escribe tablas)', k1.llamadas.filter(l => l.metodo !== 'GET').every(l => l.url.includes('rpc/verificar_clave')));

  // clave que el servidor rechaza
  const k2 = await abrir(rpcMala, { clave_campo_la_vuelta: 'claveprueba1' });
  chequear('clave que ya no sirve: aviso "ya no sirve"', !k2.doc.getElementById('clave-aviso').hidden && /ya no sirve/.test(k2.doc.getElementById('clave-msg').textContent), k2.doc.getElementById('clave-msg').textContent);

  // la comprobación falla (sin red / función caída): NUNCA se toma como clave mala
  const k3 = await abrir(url => url.includes('rpc/verificar_clave') ? 'caido' : resp(url), { clave_campo_la_vuelta: 'claveprueba1' });
  chequear('si la comprobación falla no acusa clave mala y sigue leyendo', k3.doc.getElementById('clave-aviso').hidden && k3.doc.getElementById('vista-prox').innerHTML.includes('Clostridiales'));

  // después del cierre: sin clave las lecturas dan 200 sin filas -> no se pisa la última copia
  const copiaK = { prox: PROX, ult: ULT, stock: STOCK, gens: null, leido: new Date(Date.now() - 3600e3).toISOString() };
  const k4 = await abrir(() => [], { tablero_sanidad_v1_la_vuelta: JSON.stringify(copiaK) });
  chequear('cerrado y sin clave: conserva la copia, no la reemplaza por vacío', k4.doc.getElementById('vista-prox').innerHTML.includes('Clostridiales') && JSON.parse(k4.win.localStorage.getItem('tablero_sanidad_v1_la_vuelta')).prox.length === 3);
  chequear('cerrado y sin clave: lo dice (y no culpa a la PC)', /sin clave/.test(k4.doc.getElementById('estado').textContent) && k4.doc.getElementById('estado').className !== 'mal' && !k4.doc.getElementById('clave-aviso').hidden, k4.doc.getElementById('estado').textContent);

  // pantalla para cargar la clave
  const k5 = await abrir(rpcOk);
  const entrada = k5.doc.getElementById('clave-input'), boton = k5.doc.getElementById('clave-guardar');
  entrada.value = 'corta'; boton.click(); await dormir(30);
  chequear('formato inválido: avisa y no consulta ni guarda', /al menos 8/.test(k5.doc.getElementById('clave-error').textContent) && !k5.llamadas.some(l => l.url.includes('verificar_clave')) && k5.win.localStorage.getItem('clave_campo_la_vuelta') === null);
  entrada.value = 'claveprueba1'; boton.click(); await dormir(80);
  chequear('clave buena: la guarda donde la usan las apps, oculta el aviso y relee con el encabezado',
    k5.win.localStorage.getItem('clave_campo_la_vuelta') === 'claveprueba1' && k5.doc.getElementById('clave-aviso').hidden && k5.llamadas.some(l => l.metodo === 'GET' && hdr(l) === 'claveprueba1'));
  const k6 = await abrir(rpcMala);
  k6.doc.getElementById('clave-input').value = 'otraclave99'; k6.doc.getElementById('clave-guardar').click(); await dormir(80);
  chequear('clave mala: avisa y no la guarda', /no es la clave de La Vuelta/.test(k6.doc.getElementById('clave-error').textContent) && k6.win.localStorage.getItem('clave_campo_la_vuelta') === null);
  const k7 = await abrir(url => url.includes('rpc/verificar_clave') ? 'caido' : resp(url));
  k7.doc.getElementById('clave-input').value = 'claveprueba1'; k7.doc.getElementById('clave-guardar').click(); await dormir(80);
  chequear('sin conexión al comprobar: avisa y no la guarda', /No se pudo comprobar/.test(k7.doc.getElementById('clave-error').textContent) && k7.win.localStorage.getItem('clave_campo_la_vuelta') === null);

  // María Laura usa su propia clave (clave_campo_maria_laura), no la de La Vuelta
  const k8 = await abrir(rpcOk, { clave_campo_la_vuelta: 'clavevuelta1', clave_campo_maria_laura: 'clavelaura22', tablero_sanidad_v1_estab: 'maria_laura' });
  const gets8 = k8.llamadas.filter(l => l.metodo === 'GET');
  chequear('María Laura manda la clave de María Laura', k8.doc.getElementById('estab').value === 'maria_laura' && gets8.length >= 4 && gets8.every(l => hdr(l) === 'clavelaura22'), JSON.stringify(gets8.map(hdr)));

  // Pone Chico: sin clave, aunque haya una vieja en el equipo
  const k9 = await abrir(rpcOk, { clave_campo_pone_chico: 'claveantigua1', tablero_sanidad_v1_estab: 'pone_chico' });
  chequear('Pone Chico: sin aviso, sin encabezado, sin verificar_clave',
    k9.doc.getElementById('estab').value === 'pone_chico' && k9.doc.getElementById('clave-aviso').hidden && k9.llamadas.length >= 4
    && k9.llamadas.every(l => !hdr(l)) && !k9.llamadas.some(l => l.url.includes('verificar_clave')), JSON.stringify(k9.llamadas.map(l => l.url.slice(-40))));
  // cambiar de campo en el mismo tablero cambia el aviso
  k0.doc.getElementById('estab').value = 'pone_chico'; k0.doc.getElementById('estab').dispatchEvent(new k0.win.Event('change')); await dormir(50);
  chequear('al pasar a Pone Chico el aviso de clave desaparece', k0.doc.getElementById('clave-aviso').hidden);

  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})();
