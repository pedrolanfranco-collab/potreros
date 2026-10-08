// La app no se recarga sola por una actualización mientras hay un formulario/ventana abierta (8/10/2026).
// Uso: node tests/probar_recarga_segura.js index1.html index2.html ...
const fs = require('fs'), vm = require('vm');
let fallos = 0; const ok = (c, m) => { if (!c) { fallos++; console.error('FALLA:', m); } };
const archivos = process.argv.slice(2);
if (!archivos.length) { console.error('falta lista de archivos'); process.exit(1); }

function escenario(src, conControlador, estadoUI) {
  let recargas = 0, cc = null, timers = [], vis = [];
  const ui = { form: false, input: false, modal: false, ...estadoUI };
  const doc = {
    visibilityState: 'visible',
    querySelector: s => (ui.form && s.includes('form-accion')) ? {} : null,
    querySelectorAll: () => ui.modal ? [{ shown: true }] : [{ shown: false }],
    get activeElement() { return ui.input ? { tagName: 'INPUT' } : { tagName: 'BODY' }; },
    addEventListener: (t, f) => { if (t === 'visibilitychange') vis.push(f); },
  };
  const ctx = {
    navigator: { storage: null, serviceWorker: { controller: conControlador ? {} : null, register: () => new Promise(() => {}),
      addEventListener: (t, f) => { if (t === 'controllerchange') cc = f; } } },
    document: doc, window: { addEventListener() {} },
    getComputedStyle: m => ({ display: m.shown ? 'flex' : 'none' }),
    location: { reload: () => recargas++ },
    setInterval: f => timers.push(f), console,
  };
  ctx.window.document = doc; vm.createContext(ctx); vm.runInContext(src, ctx);
  return { disparar: () => cc && cc(), tick: () => timers.forEach(f => f()), ui, doc, vis, recargas: () => recargas };
}

for (const f of archivos) {
  const html = fs.readFileSync(f, 'utf8');
  const bloque = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(t => t.includes("addEventListener('controllerchange'")).pop();
  ok(bloque, `${f}: no encontré el bloque del service worker`); if (!bloque) continue;

  let e = escenario(bloque, true, {});
  e.disparar(); ok(e.recargas() === 1, `${f}: actualización con pantalla libre debería recargar`);

  e = escenario(bloque, true, { form: true });
  e.disparar(); e.tick(); ok(e.recargas() === 0, `${f}: recargó con un formulario abierto`);
  e.ui.form = false; e.tick(); ok(e.recargas() === 1, `${f}: no recargó al cerrarse el formulario`);

  e = escenario(bloque, true, { modal: true });
  e.disparar(); e.tick(); ok(e.recargas() === 0, `${f}: recargó con una ventana abierta`);

  e = escenario(bloque, true, { input: true });
  e.disparar(); e.tick(); ok(e.recargas() === 0, `${f}: recargó escribiendo en un campo`);
  e.doc.visibilityState = 'hidden'; e.vis.forEach(v => v()); ok(e.recargas() === 1, `${f}: no recargó al pasar a segundo plano`);

  e = escenario(bloque, false, {});
  e.disparar(); e.tick(); ok(e.recargas() === 0, `${f}: recargó en la primera instalación`);
}
console.log(fallos ? `${fallos} fallas` : `todo bien (${archivos.length} archivos)`); process.exit(fallos ? 1 : 0);
