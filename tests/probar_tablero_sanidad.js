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

async function abrir(respuestas, ls){
  const llamadas = [];
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.github.io/potreros/tablero-sanidad/', virtualConsole: vc,
    beforeParse(win){
      for(const k in (ls || {})) win.localStorage.setItem(k, ls[k]);
      win.fetch = async (url, opt) => {
        llamadas.push({ url, metodo: (opt && opt.method) || 'GET' });
        const r = respuestas(url);
        if(r === 'caido') throw new Error('sin red');
        return { ok: true, status: 200, json: async () => r };
      };
    } });
  await dormir(50);
  return { win: dom.window, doc: dom.window.document, llamadas };
}

const PROX = [
  { establecimiento: 'la_vuelta', categoria: 'Terneros', sanidad: 'Clostridiales', animales: 80, ultimo_producto: 'Bravoxin', ultimo_tratamiento: iso(-200), fecha_prevista: iso(-5), estado: 'Vencido', actualizado: new Date().toISOString() },
  { establecimiento: 'la_vuelta', categoria: 'Vacas', sanidad: 'Aftosa', animales: 120, fecha_prevista: iso(10), estado: 'Próximo', actualizado: new Date().toISOString() },
  { establecimiento: 'la_vuelta', categoria: 'Novillos', sanidad: 'Garrapata', animales: 40, fecha_prevista: iso(60), actualizado: new Date().toISOString() }
];
const ULT = [
  { establecimiento: 'la_vuelta', fecha: iso(-3), categoria: 'Vacas', potrero: '12', cantidad: 50, productos: '<img src=x onerror=window.pwn=1>', dosis: '5 ml', apto_desde: iso(20), costo_animal: 1.234, actualizado: new Date().toISOString() },
  { establecimiento: 'la_vuelta', fecha: iso(-40), categoria: 'Novillos', potrero: '3', cantidad: 30, productos: 'Ivermectina', apto_desde: iso(-10), actualizado: new Date().toISOString() }
];
const resp = url => url.includes('sanidad_proximos') ? (url.includes('maria_laura') ? [] : PROX) : (url.includes('maria_laura') ? [] : ULT);

(async () => {
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

  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})();
