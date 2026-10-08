// Service workers: precarga robusta, apertura offline y caches propias (8/10/2026).
// Uso: node tests/probar_sw_offline.js [carpeta ...]  (sin args: todas las que tienen sw.js)
const fs = require('fs'), vm = require('vm'), path = require('path');
const raiz = path.join(__dirname, '..');
const dirs = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(raiz).filter(d => fs.existsSync(path.join(raiz, d, 'sw.js')));
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.error('FALLA:', m); } };

async function probar(dir) {
  const src = fs.readFileSync(path.join(raiz, dir, 'sw.js'), 'utf8');
  const scope = `https://x.github.io/potreros/${dir}/`;
  const almacen = {}; // nombre cache -> Map(url -> resp)
  // caches de OTRAS apps, para verificar que no se borran
  almacen['otra-app-v1'] = new Map([['a', 1]]);
  const listeners = {};
  let red = true;
  const mk = (u) => ({ url: u });
  const cachesMock = {
    open: async n => { const m = almacen[n] || (almacen[n] = new Map()); return {
      add: async u => {
        if (!red || /fonts\.googleapis\.com$/.test(u)) throw new Error('fallo');
        m.set(new URL(u, scope).href, { status: 200, url: new URL(u, scope).href });
      },
      put: async (r, x) => m.set(typeof r === 'string' ? r : r.url, x) }; },
    keys: async () => Object.keys(almacen),
    delete: async n => delete almacen[n],
    match: async (req) => { const u = typeof req === 'string' ? req : req.url;
      for (const m of Object.values(almacen)) if (m.has(u)) return m.get(u); },
  };
  const ctx = { self: { addEventListener: (t, f) => listeners[t] = f, skipWaiting() {}, clients: { claim() {} }, registration: { scope } },
    caches: cachesMock, fetch: async () => { if (!red) throw new Error('offline'); return { status: 200, clone() { return this; } }; },
    Request: class { constructor(u) { this.url = u; } }, Promise, URL, console };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const CACHE = vm.runInContext('CACHE', ctx);
  almacen[CACHE + '-viejo'] = new Map(); almacen[CACHE.replace(/[0-9.]+$/, '') + '0.1'] = new Map();

  // install: con una URL que falla, igual queda guardado el index.html
  let p; listeners.install({ waitUntil: x => p = x }); await p;
  ok([...almacen[CACHE].keys()].some(u => u.endsWith('index.html')), `${dir}: index.html no quedó precargado`);
  ok(![...vm.runInContext('PRECACHE_URLS', ctx)].includes('https://fonts.googleapis.com'), `${dir}: sigue la URL pelada de fonts`);

  // activate: borra solo las versiones viejas de ESTA app
  listeners.activate({ waitUntil: x => p = x }); await p;
  ok(almacen['otra-app-v1'], `${dir}: borró la caché de otra app`);
  ok(!almacen[CACHE.replace(/[0-9.]+$/, '') + '0.1'], `${dir}: no borró su versión vieja`);
  ok(almacen[CACHE], `${dir}: borró su propia caché`);

  // fetch offline de la apertura de la app (con y sin ?query)
  red = false;
  for (const u of [scope, scope + '?utm=1']) {
    let resp = null;
    listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: u }, respondWith: x => resp = x });
    ok(resp, `${dir}: no interceptó la apertura ${u}`);
    const r = resp && await resp;
    ok(r && r.status === 200, `${dir}: sin red no sirvió el HTML para ${u}`);
  }
  // Supabase no se toca
  let tocado = false;
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://skkknfjpwcstefcroqjt.supabase.co/rest/v1/eventos_sync' }, respondWith: () => tocado = true });
  ok(!tocado, `${dir}: interceptó Supabase`);
}
(async () => { for (const d of dirs) await probar(d); console.log(fallos ? `${fallos} fallas` : `todo bien (${dirs.length} service workers)`); process.exit(fallos ? 1 : 0); })();
