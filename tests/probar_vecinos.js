/*
 * Prueba de los VECINOS (29/10/2026, a pedido de Pedro): el potrero virtual "Vecino" = animales nuestros que están en el
 * campo de un vecino. No es un potrero: no sale en el mapa, no cuenta en UG ni en stock_potreros.
 *
 * Qué cubre (en las 9 variantes):
 *   - el modelo y los 5 eventos (vecino_paso, vecino_aparecido, vecino_retorno, vecino_perdida, vecino_muerte) aplicados
 *     por aplicarEventoRemoto: stock del potrero y del vecino, caso de desaparecido resuelto, muertes, idempotencia,
 *     nombres con distinta grafía ("Fulano" / "fulano" = el mismo balde), validaciones;
 *   - la UI con clics: "🏡 Al vecino" en la ficha del potrero, 🏡 Vecinos (volvió, perdido, muerte), "🏡 Apareció en
 *     vecino" en Desaparecidos y el aviso de Stock total donde existe;
 *   - en la PC: borrar cada tipo (stock, caso reabierto, la muerte deja de contar), bloqueo cuando el vecino ya no tiene
 *     lo que hay que devolverle, el caso "Fulano" / "fulano" (borrar un renglón cuya grafía no coincide con el balde);
 *   - un segundo equipo que reproduce los mismos eventos llega al mismo estado; una corrección repetida no revierte dos
 *     veces; Verificar stock sin diferencias;
 *   - en móvil y Campo no aparece ✏️ ni 🗑 en los renglones vecino_*.
 * Las variantes sin potreros (Pone Chico) reciben dos potreros por el evento potrero_creado, así la prueba corre igual.
 *
 * Uso: node tests/probar_vecinos.js la-vuelta-pc/index.html la-vuelta-movil/index.html ...
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
function omitido(nombre){ console.log('  --  omitido: ' + nombre); }
const dormir = ms => new Promise(r => setTimeout(r, ms));
const FECHA = '29/10/2026';
const CREADO = '2026-10-01T10:00:00Z';
const click = (win, el) => { if(!el) throw new Error('elemento no encontrado'); el.dispatchEvent(new win.Event('click', {bubbles: true, cancelable: true})); };
const cambiar = (win, el, v) => { if(!el) throw new Error('select no encontrado'); el.value = v; el.dispatchEvent(new win.Event('change', {bubbles: true})); };

/* Fake de Supabase: insert/upsert/delete y select con eq/gt/gte/in/not/is, order y range (lo que usa traerTodo). */
function crearServidor(){
  const filas = {};
  const tabla = t => (filas[t] = filas[t] || []);
  return {
    filas,
    createClient(){
      return {
        rpc(){ return Promise.resolve({data: null, error: {message: 'sin verificar_clave en la prueba'}}); },
        from(nombre){
          const q = {_filtros: [], _orden: null, _rango: null, _modo: 'select', _filas: []};
          const self = {
            select(){ q._modo = 'select'; return self; },
            insert(rows){ q._modo = 'insert'; q._filas = Array.isArray(rows) ? rows : [rows]; return self; },
            upsert(rows){ q._modo = 'upsert'; q._filas = Array.isArray(rows) ? rows : [rows]; return self; },
            delete(){ q._modo = 'delete'; return self; },
            eq(c, v){ q._filtros.push(r => r[c] === v); return self; },
            gt(c, v){ q._filtros.push(r => r[c] > v); return self; },
            gte(c, v){ q._filtros.push(r => r[c] >= v); return self; },
            in(c, vs){ q._filtros.push(r => vs.includes(r[c])); return self; },
            is(c, v){ q._filtros.push(r => (r[c] == null ? null : r[c]) === v); return self; },
            not(){ return self; },
            order(c, o){ if(!q._orden) q._orden = {c, asc: !o || o.ascending !== false}; return self; },
            range(a, b){ q._rango = [a, b]; return self; },
            then(res){
              const t = tabla(nombre);
              if(q._modo === 'insert' || q._modo === 'upsert'){
                q._filas.forEach(f => {
                  if(f.event_id && t.some(r => r.event_id === f.event_id)) return;
                  t.push(Object.assign({creado_en: new Date().toISOString()}, f));
                });
                return Promise.resolve(res({data: q._filas, error: null}));
              }
              if(q._modo === 'delete'){
                filas[nombre] = t.filter(r => !q._filtros.every(f => f(r)));
                return Promise.resolve(res({data: null, error: null}));
              }
              let data = t.filter(r => q._filtros.every(f => f(r)));
              if(q._orden){
                const {c, asc} = q._orden;
                data = data.slice().sort((a, b) => ((a[c] < b[c]) ? -1 : (a[c] > b[c]) ? 1 : 0) * (asc ? 1 : -1));
              }
              if(q._rango) data = data.slice(q._rango[0], q._rango[1] + 1);
              return Promise.resolve(res({data, error: null}));
            }
          };
          return self;
        }
      };
    }
  };
}

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
      window.__tiposConocidos = function(){ return TIPOS_EVENTO_CONOCIDOS; };
      window.__accionesConocidas = function(){ return ACCIONES_CORRECCION_CONOCIDAS; };
      window.__versionApp = function(){ return VERSION_APP; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}
const mapRow = f => ({event_id: f.event_id, tipo: f.tipo, potrero: f.potrero, detalle: f.detalle, fecha_cliente: f.fecha_cliente, creado_en: f.creado_en, dispositivo: f.dispositivo});
const nz = a => Object.fromEntries(Object.entries(a || {}).filter(([k, v]) => v));

async function probarArchivo(archivo){
  const esPC = /-pc\//.test(archivo);
  console.log(`\n=== ${archivo} (${esPC ? 'PC' : 'móvil o Campo'}) ===`);
  const sA = crearServidor(), sB = crearServidor();
  const DA = await levantar(archivo, sA);
  if(DA.errores.length){ chequear('la app carga sin errores', false, DA.errores.join(' | ')); return; }
  const DB = await levantar(archivo, sB);
  const A = DA.win, B = DB.win, doc = A.document;
  for(const w of [A, B]){ w.confirm = () => true; w.alert = () => {}; }
  A.eval('window.__sel = function(n){ return seleccionarPotrero(n); };');
  const ESTAB = A.__establecimiento();
  const dueno0 = ((A.__config().duenos || [''])[0]) || '';
  const K = cat => A.claveAnimal(cat, dueno0);
  const HOY = A.fechaISOaDisplay(A.fechaISOHoy());
  const tieneMuertes = typeof A.calcularEstadisticasMuertes === 'function';
  const tieneStock = typeof A.cargarStock === 'function';

  // Un evento "del registro": se aplica en A y queda en el servidor de A (lo que vería otro equipo al sincronizar).
  const enRegistro = (tipo, potrero, detalle, extra) => {
    const row = Object.assign({tipo, potrero, event_id: crypto.randomUUID(), fecha_cliente: HOY, creado_en: '2026-10-01T10:00:00Z', dispositivo: 'otro-equipo', detalle}, extra || {});
    A.aplicarEventoRemoto(row, new Set());
    sA.filas.eventos_sync = sA.filas.eventos_sync || [];
    sA.filas.eventos_sync.push(Object.assign({establecimiento: ESTAB}, row));
    return row;
  };

  // Dos potreros: los de la app; si la variante no trae ninguno (Pone Chico) se crean con potrero_creado.
  if(A.__potrerosGeo().length < 2){
    const coords = [[-32.0, -56.0], [-32.0, -56.01], [-32.01, -56.0]];
    ['Potrero Prueba 1', 'Potrero Prueba 2'].forEach(n => enRegistro('potrero_creado', n, {coords, area: 1}));
  }
  const geo = A.__potrerosGeo();
  const P0 = geo[0].nombre, P1 = geo[1].nombre;
  const est = () => A.__est();
  const sv = (p, cat) => est().potreros[p].animales[K(cat)] || 0;
  const vAn = (n, cat) => { const v = A.buscarVecino(n); return (v && v.animales[K(cat)]) || 0; };
  const snap = w => JSON.stringify({
    p: [P0, P1].map(p => nz(w.__est().potreros[p].animales)),
    v: Object.keys(w.__est().vecinos).sort().map(n => [n, nz(w.__est().vecinos[n].animales), w.__est().vecinos[n].historial.filter(h => !h.eliminado).length]),
    c: w.listarCasosDesaparecidos().map(c => [c.casoId, c.pendiente]),
    r: [P0, P1].map(p => w.__est().potreros[p].historial.filter(h => h.tipo.indexOf('vecino_') === 0 && !h.eliminado).length)
  });
  const muertesMarcado = async () => (await A.calcularEstadisticasMuertes()).terneros.marcado;

  // Stock de partida (el mismo para los dos equipos, por el registro)
  enRegistro('ingreso', P0, {categoria: 'Vacas', dueno: dueno0, cantidad: 30});
  enRegistro('ingreso', P0, {categoria: 'Terneros', dueno: dueno0, cantidad: 4});
  enRegistro('ingreso', P1, {categoria: 'Vacas', dueno: dueno0, cantidad: 5});

  // ---------- 1. modelo y nombres ----------
  console.log('  -- modelo y nombres');
  chequear('normalizarVecino: quita < > y cambia comillas dobles por simples', A.normalizarVecino('Ana<b>"x"') === "Anab'x'");
  chequear('normalizarVecino: colapsa espacios y corta en 40', A.normalizarVecino('  Juan   Pérez  ') === 'Juan Pérez' && A.normalizarVecino('x'.repeat(60)).length === 40);
  chequear('normalizarVecino: "__proto__" se rechaza', A.normalizarVecino('__proto__') === '');
  chequear('claveVecino: sin mayúsculas ni tildes, y la ñ se conserva', A.claveVecino(' Fulano ') === 'fulano' && A.claveVecino('Peña') !== A.claveVecino('Pena'));

  // ---------- 2. vecino_paso, validaciones, idempotencia, grafías ----------
  console.log('  -- paso');
  const v0 = sv(P0, 'Vacas');
  enRegistro('vecino_paso', P0, {vecino: 'fulano', categoria: 'Vacas', dueno: dueno0, cantidad: 3});
  chequear('paso: el potrero resta 3', sv(P0, 'Vacas') === v0 - 3, `${sv(P0,'Vacas')} vs ${v0-3}`);
  chequear('paso: el vecino suma 3 (balde "fulano")', vAn('Fulano', 'Vacas') === 3 && A.listarVecinos().length === 1);
  const antesInvalidos = JSON.stringify(est().vecinos);
  enRegistro('vecino_paso', P0, {vecino: '   ', categoria: 'Vacas', dueno: dueno0, cantidad: 1});
  enRegistro('vecino_paso', P0, {vecino: 'Otro', categoria: '', dueno: dueno0, cantidad: 1});
  chequear('paso con vecino vacío o categoría vacía: no hace nada', JSON.stringify(est().vecinos) === antesInvalidos);
  const rowPaso = sA.filas.eventos_sync.find(f => f.tipo === 'vecino_paso' && f.detalle.vecino === 'fulano');
  A.aplicarEventoRemoto(Object.assign({}, rowPaso), new Set());
  chequear('el mismo evento otra vez no cambia nada (idempotente)', vAn('Fulano', 'Vacas') === 3 && sv(P0, 'Vacas') === v0 - 3);
  enRegistro('vecino_paso', P0, {vecino: 'FULANO', categoria: 'Vacas', dueno: dueno0, cantidad: 2});
  chequear('"FULANO" es el mismo balde que "fulano" (un solo vecino, 5 animales)', A.listarVecinos().length === 1 && vAn('Fulano', 'Vacas') === 5, JSON.stringify(A.listarVecinos()));

  // ---------- 3. vecino_aparecido: cierra el caso ----------
  console.log('  -- aparecido');
  enRegistro('desaparecido', P0, {categoria: 'Vacas', dueno: dueno0, cantidad: 4, obs: null, casoId: 'caso-1'});
  const pend = id => (A.listarCasosDesaparecidos().find(c => c.casoId === id) || {}).pendiente || 0;
  chequear('caso abierto con 4 pendientes', pend('caso-1') === 4, String(pend('caso-1')));
  const p0ap = sv(P0, 'Vacas');
  enRegistro('vecino_aparecido', P0, {vecino: 'Otro Vecino', categoria: 'Vacas', dueno: dueno0, cantidad: 3, casoId: 'caso-1'});
  chequear('aparecido parcial: el caso queda con 1 pendiente', pend('caso-1') === 1, String(pend('caso-1')));
  chequear('aparecido: el potrero no cambia y el vecino suma 3', sv(P0, 'Vacas') === p0ap && vAn('Otro Vecino', 'Vacas') === 3);
  enRegistro('vecino_aparecido', P0, {vecino: 'Otro Vecino', categoria: 'Vacas', dueno: dueno0, cantidad: 1, casoId: 'caso-1'});
  chequear('aparecido total: el caso ya no figura pendiente', pend('caso-1') === 0);

  // ---------- 4. vecino_retorno con tope ----------
  console.log('  -- retorno');
  const p1 = sv(P1, 'Vacas');
  enRegistro('vecino_retorno', P1, {vecino: 'fulano', categoria: 'Vacas', dueno: dueno0, cantidad: 2});
  chequear('retorno: el potrero destino suma 2 y el vecino baja 2', sv(P1, 'Vacas') === p1 + 2 && vAn('Fulano', 'Vacas') === 3);
  enRegistro('vecino_retorno', P1, {vecino: 'Fulano', categoria: 'Vacas', dueno: dueno0, cantidad: 100});
  chequear('retorno de más: el vecino queda en 0 y se borra la clave (tope 0)', vAn('Fulano', 'Vacas') === 0 && !A.buscarVecino('Fulano').animales[K('Vacas')]);

  // ---------- 5. vecino_perdida (sin potrero) y vecino_muerte (terneros marcados) ----------
  console.log('  -- perdida y muerte');
  enRegistro('vecino_paso', P0, {vecino: 'Otro Vecino', categoria: 'Vacas', dueno: dueno0, cantidad: 1});
  const p0pe = sv(P0, 'Vacas'), otroAntes = vAn('Otro Vecino', 'Vacas');
  enRegistro('vecino_perdida', ESTAB, {vecino: 'Otro Vecino', categoria: 'Vacas', dueno: dueno0, cantidad: 1});
  chequear('perdida: el vecino baja 1 y ningún potrero cambia', vAn('Otro Vecino', 'Vacas') === otroAntes - 1 && sv(P0, 'Vacas') === p0pe);
  enRegistro('vecino_paso', P0, {vecino: 'Fulano', categoria: 'Terneros', dueno: dueno0, cantidad: 1});
  chequear('paso de un ternero al vecino', vAn('Fulano', 'Terneros') === 1);
  const mu0 = tieneMuertes ? await muertesMarcado() : 0;
  enRegistro('vecino_muerte', ESTAB, {vecino: 'Fulano', categoria: 'Terneros', dueno: dueno0, cantidad: 1, caravana: '12345678', grupoTernero: 'marcado'});
  chequear('muerte: el vecino ya no tiene ese ternero', vAn('Fulano', 'Terneros') === 0);
  if(tieneMuertes) chequear('muerte: cuenta en las muertes de la temporada (terneros marcados +1)', (await muertesMarcado()) === mu0 + 1, `${mu0} -> ${await muertesMarcado()}`);
  else omitido('muertes: esta variante no tiene estadísticas de muertes');

  // ---------- 6. UI con clics ----------
  console.log('  -- la UI con clics');
  const hoyF = A.fechaISOHoy();
  const paso_ui = async (P, nombre, cat, cant) => {
    A.__sel(P); await dormir(10);
    click(A, doc.querySelector('[data-accion="vecino"]'));
    doc.getElementById('f-dueno').value = dueno0;
    doc.getElementById('f-vecino').value = nombre;
    doc.getElementById('f-cat').value = cat;
    doc.getElementById('f-cant').value = String(cant);
    doc.getElementById('f-fecha').value = hoyF;
    click(A, doc.getElementById('f-confirmar'));
    await dormir(40);
  };
  const ventana = () => click(A, doc.getElementById('btn-vecinos'));
  const tarjeta = n => doc.querySelector(`.vec-tarjeta[data-vec-nombre="${n}"]`);
  const accionVec = async (n, accion, cat, cant, extra) => {
    ventana();
    click(A, tarjeta(n).querySelector(`[data-vec-accion="${accion}"]`));
    const f = tarjeta(n).querySelector('.vec-form');
    cambiar(A, f.querySelector('[data-vf="clave"]'), K(cat));
    f.querySelector('[data-vf="cant"]').value = String(cant);
    if(extra && extra.potrero) cambiar(A, f.querySelector('[data-vf="potrero"]'), extra.potrero);
    if(extra && extra.grupo) cambiar(A, f.querySelector('[data-vf="grupo"]'), extra.grupo);
    if(extra && extra.caravana) f.querySelector('[data-vf="caravana"]').value = extra.caravana;
    click(A, f.querySelector(`[data-vec-confirmar="${accion}"]`));
    await dormir(40);
  };
  // 🗑 de un renglón del potrero (PC): el que tenga el texto indicado
  const btnHist = (P, tipo, texto) => { A.__sel(P); const el = [...doc.querySelectorAll(`#historial .hist-item.${tipo}`)].find(x => x.textContent.includes(texto)); return el ? el.querySelector('[data-hist-borrar]') : null; };
  const borrarHist = async (P, tipo, texto) => {
    const b = btnHist(P, tipo, texto);
    if(!b){ chequear(`hay 🗑 en ${tipo} "${texto}" de ${P}`, false); return; }
    click(A, b); await dormir(40);
  };
  // 🗑 de un renglón de la ventana Vecinos (PC): el de la tarjeta del vecino con ese tipo y texto
  const borrarVec = async (n, tipo) => {
    ventana();
    // en la tarjeta del vecino el renglón describe el potrero, no el vecino: se toma por tipo dentro de su tarjeta
    const el = [...(tarjeta(n) ? tarjeta(n).querySelectorAll(`.hist-item.${tipo}`) : [])][0];
    const b = el && el.querySelector('[data-vec-borrar]');
    if(!b){ chequear(`hay 🗑 en ${tipo} de ${n}`, false); return; }
    click(A, b); await dormir(40);
  };

  // (a) "Al vecino" + bug "Fulano"/"fulano": borrar un renglón cuya grafía no coincide con el balde no bloquea
  enRegistro('desaparecido', P0, {categoria: 'Vacas', dueno: dueno0, cantidad: 2, obs: null, casoId: 'caso-ui'});
  const ui0 = vAn('Vecino UI', 'Vacas'), p0ui = sv(P0, 'Vacas');
  await paso_ui(P0, 'Vecino UI', 'Vacas', 2);
  chequear('UI "Al vecino": el potrero resta 2 y el vecino suma 2', vAn('Vecino UI', 'Vacas') === ui0 + 2 && sv(P0, 'Vacas') === p0ui - 2, `${sv(P0,'Vacas')} vs ${p0ui-2}`);
  A.__sel(P0); await dormir(10);
  const txtLocal = ([...doc.querySelectorAll('#historial .hist-item.vecino_paso')].find(x => x.textContent.includes('Vecino UI')) || {}).textContent || '';
  chequear('UI: el renglón local no dice "(sincronizado)"', !!txtLocal && !/sincronizado/.test(txtLocal), txtLocal);
  await paso_ui(P0, 'vecino ui', 'Vacas', 1);
  chequear('"vecino ui" se suma al balde "Vecino UI" (un solo vecino)', A.listarVecinos().filter(n => /vecino ui/i.test(n)).length === 1);
  if(esPC){
    const antesBorrar = vAn('Vecino UI', 'Vacas');
    await borrarHist(P0, 'vecino_paso', 'vecino ui');
    chequear('bug "Fulano": borrar el renglón "vecino ui" (balde "Vecino UI") no bloquea y devuelve 1', vAn('Vecino UI', 'Vacas') === antesBorrar - 1 && !/No se puede borrar/.test(doc.getElementById('toast').textContent), `${vAn('Vecino UI','Vacas')} vs ${antesBorrar-1}; ${doc.getElementById('toast').textContent}`);
  }

  // (b) bloqueo: volvió el vecino, ya no hay de dónde devolver el paso
  if(esPC){
    await accionVec('Vecino UI', 'volvio', 'Vacas', vAn('Vecino UI', 'Vacas'), {potrero: P1});
    const antes = snap(A);
    await borrarHist(P0, 'vecino_paso', 'Vecino UI');
    chequear('bloqueo: borrar un paso cuyo vecino ya volvió no cambia nada y avisa', snap(A) === antes && /No se puede borrar/.test(doc.getElementById('toast').textContent), doc.getElementById('toast').textContent);
    await borrarHist(P1, 'vecino_retorno', 'Vecino UI');
    await borrarHist(P0, 'vecino_paso', 'Vecino UI');
    chequear('borrar retorno y después paso: el vecino vuelve a 0 y P0 vuelve a su stock', vAn('Vecino UI', 'Vacas') === 0 && sv(P0, 'Vacas') === p0ui, `${vAn('Vecino UI','Vacas')}; ${sv(P0,'Vacas')} vs ${p0ui}`);
  } else {
    await accionVec('Vecino UI', 'volvio', 'Vacas', vAn('Vecino UI', 'Vacas'), {potrero: P1});
    chequear('retorno en UI: el vecino queda en 0', vAn('Vecino UI', 'Vacas') === 0);
  }

  // (c) aparecido en vecino desde Desaparecidos, luego borrado desde la ventana (PC)
  click(A, doc.getElementById('btn-desaparecidos')); await dormir(10);
  click(A, doc.querySelector('[data-vecino-desap="caso-ui"]'));
  doc.getElementById('fv-vecino').value = 'Vecino UI';
  doc.getElementById('fv-cant').value = '2';
  click(A, doc.getElementById('fv-confirmar')); await dormir(40);
  chequear('UI "Apareció en vecino": el caso se cierra y el vecino suma 2', pend('caso-ui') === 0 && vAn('Vecino UI', 'Vacas') === 2);
  if(esPC){
    await borrarVec('Vecino UI', 'vecino_aparecido');
    chequear('borrar aparecido desde Vecinos: el caso vuelve a pendiente 2 y el vecino vuelve a 0', pend('caso-ui') === 2 && vAn('Vecino UI', 'Vacas') === 0, `${pend('caso-ui')}; ${vAn('Vecino UI','Vacas')}`);
  } else {
    chequear('móvil: el aparecido queda (el caso sigue cerrado)', pend('caso-ui') === 0);
  }

  // (d) perdida desde Vecinos; (e) muerte de un ternero con grupo, contada en muertes; ambas se borran en PC
  await paso_ui(P0, 'Vecino UI', 'Vacas', 1);
  await accionVec('Vecino UI', 'perdida', 'Vacas', 1);
  chequear('UI "Dar por perdido": el vecino baja 1', vAn('Vecino UI', 'Vacas') === 0);
  if(esPC){
    await borrarVec('Vecino UI', 'vecino_perdida');
    chequear('borrar la pérdida: el vecino vuelve a 1', vAn('Vecino UI', 'Vacas') === 1);
    await accionVec('Vecino UI', 'volvio', 'Vacas', 1, {potrero: P1});
  }
  await paso_ui(P0, 'Vecino UI', 'Terneros', 1);
  const mu1 = tieneMuertes ? await muertesMarcado() : 0;
  await accionVec('Vecino UI', 'muerte', 'Terneros', 1, {grupo: 'marcado', caravana: '12345678'});
  chequear('UI "Muerte": el ternero sale del vecino', vAn('Vecino UI', 'Terneros') === 0);
  if(tieneMuertes) chequear('UI "Muerte": cuenta como muerte (terneros marcados +1)', (await muertesMarcado()) === mu1 + 1);
  if(esPC){
    await borrarVec('Vecino UI', 'vecino_muerte');
    chequear('borrar la muerte: el ternero vuelve al vecino', vAn('Vecino UI', 'Terneros') === 1);
    if(tieneMuertes) chequear('borrar la muerte: deja de contar como muerte', (await muertesMarcado()) === mu1, `${mu1} -> ${await muertesMarcado()}`);
  }

  // (f) Stock total: aviso que abre Vecinos (donde la variante tiene Stock total)
  if(tieneStock){
    await A.cargarStock();
    const aviso = doc.getElementById('stock-vecinos-aviso');
    chequear('Stock total: aviso "En campos vecinos" con los animales de los vecinos', !!aviso && /En campos vecinos/.test(aviso.innerHTML));
    if(aviso && aviso.querySelector('div')) click(A, aviso.querySelector('div'));
    chequear('Stock total: el aviso abre la ventana Vecinos', doc.getElementById('modal-vecinos').style.display === 'flex');
    click(A, doc.getElementById('vecinos-cerrar'));
  } else omitido('Stock total: esta variante no tiene esa ventana');

  // (g) lo que se ve en el historial: PC con ✏️ no y 🗑 sí; móvil y Campo sin ✏️ ni 🗑 en vecino_*
  A.__sel(P0); await dormir(10);
  const renglonesV = [...doc.querySelectorAll('#historial [class*="vecino_"]')];
  if(esPC){
    chequear('PC: los renglones vecino_* no tienen ✏️', renglonesV.length > 0 && !renglonesV.some(el => el.querySelector('[data-hist-editar]')));
    chequear('PC: los renglones vecino_* vivos tienen 🗑', renglonesV.some(el => el.querySelector('[data-hist-borrar]')));
  } else {
    chequear('móvil/Campo: ningún renglón vecino_* tiene ✏️ ni 🗑', !renglonesV.some(el => el.querySelector('[data-hist-editar],[data-hist-borrar]')));
    ventana();
    chequear('móvil/Campo: la ventana Vecinos no tiene 🗑', !doc.querySelector('#vecinos-lista [data-vec-borrar]'));
    click(A, doc.getElementById('vecinos-cerrar'));
  }

  // ---------- 7. réplica en un segundo equipo y corrección repetida ----------
  console.log('  -- réplica en otro equipo');
  const rowsA = sA.filas.eventos_sync.slice();
  rowsA.forEach(f => B.aplicarEventoRemoto(mapRow(f), new Set()));
  rowsA.forEach(f => sB.filas.eventos_sync.push(Object.assign({}, f)));  // lo que vería el segundo equipo en el registro
  require('fs').writeFileSync('/tmp/claude-0/-home-user/ff2ed965-bed8-5373-9579-22792fc8ca2e/scratchpad/p4/snapA.json', JSON.stringify(JSON.parse(snap(A)), null, 1));
  require('fs').writeFileSync('/tmp/claude-0/-home-user/ff2ed965-bed8-5373-9579-22792fc8ca2e/scratchpad/p4/snapB.json', JSON.stringify(JSON.parse(snap(B)), null, 1));
  chequear('réplica: el segundo equipo llega al mismo estado (stock, vecinos, casos)', snap(A) === snap(B), 'ver snapA.json / snapB.json');
  const antesRep = snap(B);
  rowsA.filter(f => f.tipo === 'correccion').forEach(f => B.aplicarEventoRemoto(mapRow(f), new Set()));
  chequear('corrección repetida: no revierte otra vez el stock', snap(B) === antesRep);
  if(tieneMuertes){
    const mB = (await B.calcularEstadisticasMuertes()).terneros.marcado;
    chequear('réplica: las muertes coinciden entre equipos', mB === (await muertesMarcado()), `${mB} vs ${await muertesMarcado()}`);
  }

  // ---------- 8. Verificar stock (PC) ----------
  if(esPC){
    console.log('  -- Verificar stock');
    const rec = A.reconstruirStockDesdeRegistro(sA.filas.eventos_sync);
    const cmp = A.compararStock(A.fotoStock(est()), rec.foto);
    chequear('Verificar stock: sin diferencias de potreros ni de vecinos', cmp.potreros.length === 0 && cmp.vecinos.lista.length === 0, JSON.stringify(cmp.potreros));
    est().vecinos[Object.keys(est().vecinos)[0]].animales[K('Vacas')] = 99;
    const cmp2 = A.compararStock(A.fotoStock(est()), rec.foto);
    chequear('Verificar stock: una diferencia en un vecino aparece en la sección Vecinos', cmp2.vecinos.lista.length === 1);
    est().vecinos[Object.keys(est().vecinos)[0]].animales[K('Vacas')] = 0;
    delete est().vecinos[Object.keys(est().vecinos)[0]].animales[K('Vacas')];
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos){
    try { await probarArchivo(a); }
    catch(e){ chequear('la prueba corre sin excepciones en ' + a, false, e.stack.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
