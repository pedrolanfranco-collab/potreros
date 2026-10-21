/*
 * Tablero de Sanidad (16/10/2026): lee sanidad_proximos / sanidad_ultimos con un fetch falso y verifica
 * agrupación por urgencia, retiro, escape de HTML, cambio de establecimiento, copia sin señal, que al
 * abrir solo lea (GET) y el botón "Ya se hizo" (21/10/2026: única escritura, en sanidad_proximos_hechos).
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
        const metodo = (opt && opt.method) || 'GET';
        llamadas.push({ url, metodo, body: opt && opt.body, headers: (opt && opt.headers) || {} });
        const r = respuestas(url, metodo, opt);
        if(r === 'caido') throw new Error('sin red');
        if(r && r.status){ return { ok: r.status < 300, status: r.status, json: async () => JSON.parse(JSON.stringify(r.body == null ? [] : r.body)) }; }
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(r)) };   // copia: como un JSON recién leído
      };
    } });
  await dormir(50);
  return { win: dom.window, doc: dom.window.document, llamadas };
}

const PROX = [
  { establecimiento: 'la_vuelta', categoria: 'Terneros', sanidad: 'Clostridiales', animales: 80, ultimo_producto: 'Bravoxin', ultimo_tratamiento: iso(-200), fecha_prevista: iso(-5) + 'T00:00:00+00:00', estado: 'Vencido', actualizado: new Date().toISOString() },
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
  if(url.includes('sanidad_proximos_hechos')) return [];
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

  console.log('"Ya se hizo" en un vencido (sanidad_proximos_hechos)');
  chequear('al abrir lee la tabla de hechos del establecimiento', a.llamadas.some(l => l.url.includes('sanidad_proximos_hechos') && l.url.includes('establecimiento=eq.la_vuelta') && l.metodo === 'GET'));
  const p0 = (await abrir(resp)).doc.getElementById('vista-prox');
  chequear('el botón sale solo en el vencido', p0.querySelectorAll('[data-hecho]').length === 1 && p0.querySelector('.card.rojo [data-hecho]'));
  /* marcar: confirmación en la página, POST, se oculta */
  let hechosSrv = [];
  const conHechos = (url, metodo, opt) => {
    if(url.includes('sanidad_proximos_hechos')){
      if(metodo === 'POST'){ const f = JSON.parse(opt.body); const h = { id: 7, marcado_en: new Date().toISOString(), ...f }; hechosSrv.push(h); return { status: 201, body: [h] }; }
      if(metodo === 'DELETE'){ const id = /id=eq\.(\d+)/.exec(url)[1]; const antes = hechosSrv.length; hechosSrv = hechosSrv.filter(h => String(h.id) !== id); return { status: 200, body: antes > hechosSrv.length ? [{ id: +id }] : [] }; }
      return hechosSrv;
    }
    return resp(url);
  };
  const m = await abrir(conHechos);
  const vp = () => m.doc.getElementById('vista-prox');
  vp().querySelector('[data-hecho]').click();
  chequear('pide confirmar en la página (sin confirm())', /¿Ya se hizo\?/.test(vp().textContent) && vp().querySelector('[data-hecho-si]') && !m.llamadas.some(l => l.metodo !== 'GET'));
  vp().querySelector('[data-hecho-no]').click();
  chequear('Cancelar no escribe nada', !vp().querySelector('[data-hecho-si]') && !m.llamadas.some(l => l.metodo !== 'GET'));
  vp().querySelector('[data-hecho]').click(); vp().querySelector('[data-hecho-si]').click();
  await dormir(50);
  const post = m.llamadas.find(l => l.metodo === 'POST');
  const cuerpo = post ? JSON.parse(post.body) : {};
  chequear('POST a sanidad_proximos_hechos con el vencimiento', post && post.url.includes('sanidad_proximos_hechos') && cuerpo.categoria === 'Terneros' && cuerpo.sanidad === 'Clostridiales' && cuerpo.fecha_prevista === iso(-5) && cuerpo.establecimiento === 'la_vuelta', JSON.stringify(cuerpo));
  chequear('si ya estaba marcado no falla (ignore-duplicates)', post && /resolution=ignore-duplicates/.test(post.headers.Prefer) && post.url.includes('on_conflict='));
  chequear('el vencido desaparece y el contador baja a 0', /<b>0<\/b><span>vencidos/.test(vp().innerHTML) && !vp().querySelector('.card.rojo'));
  chequear('queda en "Marcados como hechos (1)" con Deshacer', /Marcados como hechos \(1\)/.test(vp().textContent) && vp().querySelector('[data-deshacer="7"]'));
  chequear('solo escribió una vez y solo en esa tabla', m.llamadas.filter(l => l.metodo !== 'GET').length === 1);
  /* otro equipo: lo ve oculto */
  const otro = await abrir(conHechos);
  chequear('otro equipo lo ve oculto', !otro.doc.querySelector('#vista-prox .card.rojo') && /Marcados como hechos \(1\)/.test(otro.doc.getElementById('vista-prox').textContent));
  /* deshacer */
  vp().querySelector('[data-deshacer]').click();
  await dormir(50);
  const del = m.llamadas.find(l => l.metodo === 'DELETE');
  chequear('Deshacer borra por id', del && del.url.includes('sanidad_proximos_hechos?id=eq.7'));
  chequear('el vencido vuelve', vp().querySelector('.card.rojo [data-hecho]') && /<b>1<\/b><span>vencidos/.test(vp().innerHTML));
  /* un tratamiento nuevo cambia la fecha prevista: lo marcado ya no lo oculta */
  hechosSrv = [{ id: 9, establecimiento: 'la_vuelta', categoria: 'terneros ', sanidad: 'Clostridiales', fecha_prevista: iso(-40), marcado_en: new Date().toISOString() }];
  const n = await abrir(conHechos);
  chequear('un hecho de otra fecha prevista no oculta el vencimiento nuevo', n.doc.querySelector('#vista-prox .card.rojo') && !/Marcados como hechos/.test(n.doc.getElementById('vista-prox').textContent));
  hechosSrv = [{ id: 10, establecimiento: 'la_vuelta', categoria: 'terneros ', sanidad: 'clostridiales', fecha_prevista: iso(-5), marcado_en: new Date().toISOString() }];
  const n2 = await abrir(conHechos);
  chequear('compara categoría y sanidad sin mayúsculas ni espacios', !n2.doc.querySelector('#vista-prox .card.rojo'));
  /* error al guardar */
  const e1 = await abrir((url, metodo) => url.includes('sanidad_proximos_hechos') ? (metodo === 'POST' ? { status: 401, body: { message: 'permission denied' } } : []) : resp(url));
  const ve = () => e1.doc.getElementById('vista-prox');
  ve().querySelector('[data-hecho]').click(); ve().querySelector('[data-hecho-si]').click();
  await dormir(50);
  chequear('si no se puede guardar avisa y el vencido sigue', /No se pudo guardar \(HTTP 401\)/.test(ve().textContent) && ve().querySelector('.card.rojo'));
  /* sin la tabla (SQL no corrido): todo como antes */
  const s = await abrir((url) => url.includes('sanidad_proximos_hechos') ? { status: 404, body: { message: 'no existe' } } : resp(url));
  chequear('sin la tabla no hay botón y se ven todos', !s.doc.querySelector('[data-hecho]') && /<b>1<\/b><span>vencidos/.test(s.doc.getElementById('vista-prox').innerHTML));

  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})();
