/*
 * Pantalla "🛁 Baño" (4/11/2026): control del baño de aspersión de La Vuelta y María Laura (CONFIG.bano).
 * Con un Supabase simulado (bano_config, bano_ciclos y bano_lecturas con uid único y la FK ciclo → lecturas, RPC
 * bano_estado_app / bano_avisos_app / bano_config_guardar, productos_catalogo y las tablas de Sanidad):
 *  - Pone Chico no muestra el botón ni consulta nada del baño;
 *  - abrir un ciclo de Aspersin con 900 L sugiere 750 ml; CreBio 7 sin dosis dice "falta la dosis" y no sugiere;
 *  - tandas con y sin conteo; "No" bastón exige la cantidad y encola el tratamiento en Sanidad (producto del ciclo, dosis 0)
 *    guardando su id en sanidad_id; "Sí" bastón no crea nada en Sanidad;
 *  - la reposición sugiere agua (capacidad − regla) y producto (300 L → 500 ml);
 *  - el caso de Pedro: 900 L + 750 ml; tanda 30; tanda sin conteo; reposición 600 +300 L +500 ml; tanda 80; fin del día 500;
 *    reposición 500 +400 L +667 ml; tanda 60; cierre 650 → tramos 300 L sin conteo, 400 L/80 = 5,0 ok, 0 L sin conteo,
 *    250 L/60 = 4,17 ok; producto total 1.917 ml; y estados alto / bajo;
 *  - "Toca reponer" con el gasto estimado (4 L por animal) y con el real;
 *  - sin señal todo queda en cola y al volver se manda en orden (el ciclo primero) una sola vez; un reintento con 23505 no
 *    duplica; un rechazo de la base queda marcado con "Quitar" y no frena a los demás;
 *  - otro equipo ve el mismo ciclo al abrir (y no duplica lecturas);
 *  - "⚙ Productos": lista con "falta la dosis", producto nuevo por la RPC, sin señal no deja;
 *  - aviso de posible doble carga en Sanidad;
 *  - fecha y hora automáticas (no hay campos de fecha).
 * Uso: node tests/probar_bano.js <index.html> [<index.html> ...]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function esperarHasta(fn, ms){
  const fin = Date.now() + (ms || 1500);
  while(Date.now() < fin){ if(fn()) return true; await esperar(15); }
  return !!fn();
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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copia = x => JSON.parse(JSON.stringify(x));

/* Supabase falso. bano_ciclos / bano_lecturas: uid único (23505), lecturas con FK (ciclo_uid, establecimiento) → ciclos
   (23503) y los checks por tipo (23514). modo: 'ok' | 'caido' (sin respuesta) | 'respuesta_perdida' (llega pero se pierde la
   respuesta); s.rechazar(row) → true = la base la rechaza siempre (22P02). */
function servidorFalso(){
  const s = {
    config: [
      { producto: 'Aspersin', ml_100l_carga: 83.333, ml_100l_reposicion: 166.667, l_animal_min: 3, l_animal_max: 5, vida_horas: 168, capacidad_l: 900, umbral_reponer_l: 300 },
      { producto: 'CreBio 7', ml_100l_carga: null, ml_100l_reposicion: null, l_animal_min: 3, l_animal_max: 5, vida_horas: 72, capacidad_l: 900, umbral_reponer_l: 300 }
    ],
    catalogo: [
      { producto: 'Aspersin', tipo: 'Baño', valor_dosis_ml: 0.02 },
      { producto: 'CreBio 7', tipo: 'Baño', valor_dosis_ml: 0.03 },
      { producto: 'Ivermectina 1%', tipo: 'Antiparasitario', valor_dosis_ml: 0.5 }
    ],
    ciclos: [], lecturas: [], sanidad: {}, avisos: [], intentos: [], rpcNombres: [], rpcArgs: [], tablasBano: 0,
    modo: 'ok', modoRpc: 'ok', nextId: 1, caidas: 0
  };
  s.insertar = (tabla, row) => {
    if(tabla === 'bano_ciclos' || tabla === 'bano_lecturas'){
      s.tablasBano++;
      s.intentos.push({ tabla, row: copia(row) });
      const lista = tabla === 'bano_ciclos' ? s.ciclos : s.lecturas;
      if(s.modo === 'caido') return Promise.resolve({ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
      if(s.caidas > 0){ s.caidas--; return Promise.resolve({ error: { message: 'Service Unavailable', code: '' }, status: 503 }); }
      if(s.rechazar && s.rechazar(row)) return Promise.resolve({ error: { message: 'invalid input syntax', code: '22P02' }, status: 400 });
      if(!row.uid) return Promise.resolve({ error: { message: 'null value in column "uid"', code: '23502' }, status: 400 });
      const ya = lista.some(f => f.uid === row.uid);
      if(tabla === 'bano_lecturas' && !ya){
        if(!s.ciclos.some(c => c.uid === row.ciclo_uid && c.establecimiento === row.establecimiento))
          return Promise.resolve({ error: { message: 'insert or update violates foreign key constraint', code: '23503' }, status: 409 });
        const mal = (row.tipo === 'tanda' && (!row.categoria || !row.potrero))
          || (row.tipo === 'reposicion' && (row.nivel_l == null || row.agua_agregada_l == null || row.producto_ml == null))
          || ((row.tipo === 'fin_dia' || row.tipo === 'cierre') && row.nivel_l == null);
        if(mal) return Promise.resolve({ error: { message: 'violates check constraint', code: '23514' }, status: 400 });
      }
      if(s.modo === 'respuesta_perdida'){
        if(!ya) lista.push(Object.assign(copia(row), { id: s.nextId++ }));
        return Promise.resolve({ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
      }
      if(ya) return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' }, status: 409 });
      lista.push(Object.assign(copia(row), { id: s.nextId++ }));
      return Promise.resolve({ error: null, status: 201 });
    }
    if(/^sanidad_carga/.test(tabla)){
      s.sanidad[tabla] = s.sanidad[tabla] || [];
      if(s.sanidad[tabla].some(f => f.id === row.id)) return Promise.resolve({ error: { code: '23505', message: 'dup' }, status: 409 });
      s.sanidad[tabla].push(copia(row));
      return Promise.resolve({ error: null, status: 201 });
    }
    return Promise.resolve({ error: null, status: 201 });
  };
  s.leer = (tabla, filtros) => {
    let datos = [];
    if(tabla === 'bano_config'){ s.tablasBano++; datos = s.config; }
    else if(tabla === 'bano_ciclos'){ s.tablasBano++; datos = s.ciclos; }
    else if(tabla === 'bano_lecturas'){
      s.tablasBano++;
      datos = s.lecturas.slice().sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || a.id - b.id);
    }
    else if(tabla === 'productos_catalogo') datos = s.catalogo;
    else if(/^sanidad_carga/.test(tabla)) datos = s.sanidad[tabla] || [];
    datos = datos.filter(f => filtros.every(([c, v]) => f[c] === v));
    return { data: copia(datos), error: null };
  };
  s.cerrado = uid => s.lecturas.some(l => l.ciclo_uid === uid && l.tipo === 'cierre');
  s.rpc = (nombre, args) => {
    s.rpcNombres.push(nombre); s.rpcArgs.push({ nombre, args: copia(args || null) });
    if(nombre === 'verificar_clave') return { data: true, error: null };
    if(/^bano_/.test(nombre)) s.tablasBano++;
    if(s.modoRpc === 'caido' && /^bano_/.test(nombre)) return { data: null, error: { message: 'Failed to fetch', code: '' } };
    if(nombre === 'bano_estado_app'){
      return { data: s.ciclos.filter(c => !s.cerrado(c.uid)).map(c => ({ ciclo_uid: c.uid, ciclo_id: c.id, establecimiento: c.establecimiento, producto: c.producto, inicio: c.inicio, cerrado: false })), error: null };
    }
    if(nombre === 'bano_avisos_app') return { data: copia(s.avisos), error: null };
    if(nombre === 'bano_config_guardar'){
      if(!s.catalogo.some(f => f.producto === args.p_producto)) return { data: null, error: { code: '22023', message: 'producto no está en productos_catalogo' } };
      const fila = { producto: args.p_producto, ml_100l_carga: args.p_ml_100l_carga, ml_100l_reposicion: args.p_ml_100l_reposicion, l_animal_min: args.p_l_animal_min, l_animal_max: args.p_l_animal_max, vida_horas: args.p_vida_horas, capacidad_l: 900, umbral_reponer_l: 300 };
      const i = s.config.findIndex(f => f.producto === fila.producto);
      if(i >= 0) s.config[i] = fila; else s.config.push(fila);
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'rpc desconocida' } };
  };
  return s;
}

async function levantar(archivo, servidor){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  const cliente = {
    rpc(nombre, args){ return Promise.resolve(servidor.rpc(nombre, args)); },
    from(tabla){
      const filtros = [];
      const q = new Proxy({}, { get(t, prop){
        if(prop === 'insert') return (row) => servidor.insertar(tabla, row);
        if(prop === 'eq') return (c, v) => { filtros.push([c, v]); return q; };
        if(prop === 'then') return (res, rej) => Promise.resolve(servidor.leer(tabla, filtros)).then(res, rej);
        return () => q;
      } });
      return q;
    }
  };
  win.supabase = { createClient(){ return cliente; } };
  let enLinea = true;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.HTMLElement.prototype.scrollIntoView = function(){};
  const est = (/"establecimiento":"([a-z_]+)"/.exec(html) || [])[1];
  win.localStorage.setItem('clave_campo_' + est, 'clavedeprueba1');
  win.localStorage.setItem('potreros_nombre_usuario', 'Tester');
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + '\n;window.__cfg = { bano: !!CONFIG.bano, est: ESTABLECIMIENTO, tablaSanidad: CONFIG.tablaSanidad, excel: !!CONFIG.usaExcelBridge, duenoObligatorio: !!CONFIG.duenoObligatorio, bastonDefecto: !!CONFIG.completarCsvBaston };\nwindow.__ev = (x) => eval(x);');
  await esperar(80);
  const $ = id => win.document.getElementById(id);
  const cfg = win.__cfg;
  const guardado = () => { try{ return JSON.parse(win.localStorage.getItem(cfg.est + '_bano_v1')) || null; }catch(e){ return null; } };
  const setEnLinea = (v) => { enLinea = v; win.dispatchEvent(new win.Event(v ? 'online' : 'offline')); };
  const click = id => $(id).click();
  const llenar = (id, v) => { $(id).value = v; $(id).dispatchEvent(new win.Event('input', { bubbles: true })); $(id).dispatchEvent(new win.Event('change', { bubbles: true })); };
  const sel = q => win.document.querySelector(q);
  const visible = id => { let e = $(id); while(e && e !== win.document.body){ if(e.style && e.style.display === 'none') return false; e = e.parentElement; } return !!$(id); };
  const t = { win, errores, cfg, $, guardado, setEnLinea, click, llenar, sel, visible, cerrarTodo(){ enLinea = false; } };
  t.abrir = async () => { click('btn-bano'); await esperar(30); };
  t.abrirCiclo = async (producto, agua, ml) => {
    sel('#bano-nc-productos [data-bano-producto="' + producto + '"]').click();
    sel('#bano-nc-aguas [data-bano-agua="' + agua + '"]') ? sel('#bano-nc-aguas [data-bano-agua="' + agua + '"]').click() : llenar('bano-nc-agua', String(agua));
    if(ml != null) llenar('bano-nc-ml', String(ml));
    click('bano-abrir'); await esperar(40);
  };
  t.tanda = async ({ cant, baston, cat }) => {
    click('bano-tanda'); await esperar(10);
    const chip = sel('#bano-t-cats [data-bano-cat="' + (cat || 'Vacas') + '"]');
    chip.click();
    const pot = $('bano-t-potrero'); pot.value = pot.options[1].value;
    const due = $('bano-t-dueno'); if(cfg.duenoObligatorio) due.value = due.options[1].value;
    if(baston != null) click(baston ? 'bano-t-baston-si' : 'bano-t-baston-no');
    llenar('bano-t-cant', cant == null ? '' : String(cant));
    click('bano-f-guardar'); await esperar(40);
  };
  t.regla = (n) => { const b = sel('#bano-f-reglas [data-bano-regla="' + n + '"]'); if(b) b.click(); else llenar('bano-f-nivel', String(n)); };
  t.reposicion = async (nivel, agua, ml) => {
    click('bano-reposicion'); await esperar(10);
    t.regla(nivel);
    if(agua != null) llenar('bano-r-agua', String(agua));
    if(ml != null) llenar('bano-r-ml', String(ml));
    click('bano-f-guardar'); await esperar(40);
  };
  t.nivel = async (boton, nivel) => { click(boton); await esperar(10); t.regla(nivel); click('bano-f-guardar'); await esperar(40); };
  return t;
}

async function probarPoneChico(archivo){
  console.log('\n--- Pone Chico: no muestra el Baño ni consulta nada');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  chequear('CONFIG.bano es false', t.cfg.bano === false);
  const b = t.$('btn-bano');
  chequear('el botón 🛁 Baño queda oculto', !b || b.style.display === 'none', b && b.style.display);
  t.setEnLinea(false); t.setEnLinea(true);
  await esperar(300);
  chequear('no se llamó a ninguna RPC del baño', !s.rpcNombres.some(n => /^bano_/.test(n)), s.rpcNombres.join(','));
  chequear('no se tocó ninguna tabla del baño', s.tablasBano === 0 && s.intentos.length === 0, String(s.tablasBano));
  chequear('no quedó nada del baño guardado en el equipo', t.win.localStorage.getItem('pone_chico_bano_v1') === null);
  t.cerrarTodo();
}

async function probarAbrirYSugerencias(archivo){
  console.log('\n--- abrir ciclo: Aspersin 900 L sugiere 750 ml; CreBio 7 sin dosis no sugiere; hora automática');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  const b = t.$('btn-bano');
  chequear('el botón 🛁 Baño se ve en Herramientas', !!b && b.style.display !== 'none' && /🛁 Baño/.test(b.textContent));
  await t.abrir();
  chequear('se abre la ventana', t.$('modal-bano').style.display === 'flex');
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  chequear('consultó bano_config, bano_estado_app y bano_avisos_app', s.rpcNombres.includes('bano_estado_app') && s.rpcNombres.includes('bano_avisos_app'), s.rpcNombres.join(','));
  chequear('sin ciclo abierto muestra "Abrir ciclo nuevo"', t.visible('bano-sin-ciclo') && !t.visible('bano-en-marcha'));
  const chipA = t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]');
  const chipC = t.sel('#bano-nc-productos [data-bano-producto="CreBio 7"]');
  chequear('botones de producto con cuánto dura', !!chipA && /dura 7 días/.test(chipA.textContent) && !!chipC && /dura 3 días \(72 h\)/.test(chipC.textContent), (chipA && chipA.textContent) + ' / ' + (chipC && chipC.textContent));
  const docs = ['modal-bano', 'modal-bano-form', 'modal-bano-productos'].map(id => t.$(id));
  chequear('no hay campos de fecha ni de hora en las ventanas del baño', docs.every(d => !d.querySelector('input[type=date],input[type=time],input[type=datetime-local]')));
  // CreBio 7: falta la dosis
  chipC.click();
  t.sel('#bano-nc-aguas [data-bano-agua="900"]').click();
  chequear('CreBio 7: dice "falta la dosis" y no sugiere ml', /falta la dosis/.test(t.$('bano-nc-sug').textContent) && t.$('bano-nc-ml').value === '' && /bano-falta/.test(t.$('bano-nc-sug').className), t.$('bano-nc-sug').textContent + ' / ' + t.$('bano-nc-ml').value);
  t.click('bano-abrir'); await esperar(30);
  chequear('CreBio 7 sin ml no deja abrir', /Falta la dosis/i.test(t.$('bano-nc-error').textContent) && !t.guardado().ciclo, t.$('bano-nc-error').textContent);
  // Aspersin: 900 L → 750 ml
  t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]').click();
  chequear('el botón de 900 L queda marcado', t.sel('#bano-nc-aguas [data-bano-agua="900"]').getAttribute('aria-pressed') === 'true');
  chequear('Aspersin 900 L: sugiere 750 ml', t.$('bano-nc-ml').value === '750' && /Sugerido: 750 ml/.test(t.$('bano-nc-sug').textContent), t.$('bano-nc-ml').value + ' / ' + t.$('bano-nc-sug').textContent);
  t.sel('#bano-nc-aguas [data-bano-agua="600"]').click();
  chequear('600 L: sugiere 500 ml', t.$('bano-nc-ml').value === '500', t.$('bano-nc-ml').value);
  t.sel('#bano-nc-aguas [data-bano-agua="900"]').click();
  const antes = Date.now();
  t.click('bano-abrir');
  await esperarHasta(() => s.ciclos.length === 1, 1500);
  const c = s.ciclos[0] || {};
  chequear('se mandó el ciclo (uid, campo, producto, 900 L, 750 ml)', UUID.test(c.uid || '') && c.establecimiento === t.cfg.est && c.producto === 'Aspersin' && c.agua_inicial_l === 900 && c.producto_inicial_ml === 750, JSON.stringify(c));
  chequear('con dispositivo, autor ("Quién soy") e inicio con la hora del equipo', !!c.dispositivo && c.autor === 'Tester' && Math.abs(Date.parse(c.inicio) - antes) < 5000, JSON.stringify(c));
  await esperar(40);
  chequear('pasa a "ciclo en marcha"', t.visible('bano-en-marcha') && !t.visible('bano-sin-ciclo'));
  chequear('encabezado: producto y "Día 1 de 7 · vence …"', /Aspersin/.test(t.$('bano-cab').textContent) && /Día 1 de 7 · vence \d\d\/\d\d \d\d:\d\d/.test(t.$('bano-cab').textContent), t.$('bano-cab').textContent);
  chequear('nivel estimado 900 L con la barrita', /Nivel estimado: 900 L de 900 L/.test(t.$('bano-nivel').textContent) && !!t.sel('#bano-nivel .bano-tanque'), t.$('bano-nivel').textContent);
  chequear('los 4 botones grandes', ['bano-tanda', 'bano-reposicion', 'bano-fin-dia', 'bano-cerrar-ciclo'].every(id => t.visible(id)));
  chequear('"Hoy" muestra la carga con su hora', /\d\d:\d\d\s*Carga: 900 L \+ 750 ml/.test(t.$('bano-hoy').textContent), t.$('bano-hoy').textContent);
  chequear('nada en cola', t.guardado().cola.length === 0 && !/en cola/.test(t.$('bano-cola').textContent));
  t.click('bano-cerrar-x');
  chequear('la X cierra la ventana', t.$('modal-bano').style.display === 'none');
  t.cerrarTodo();
}

async function probarCasoCompleto(archivo){
  console.log('\n--- el caso de Pedro: tandas, reposiciones, fin del día y cierre (tramos, Sanidad, producto total)');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  const tabla = t.cfg.tablaSanidad;
  const san = () => s.sanidad[tabla] || [];
  await t.abrir();
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  await t.abrirCiclo('Aspersin', 900);
  await esperarHasta(() => s.ciclos.length === 1, 1000);
  // formulario de tanda: valores por defecto
  t.click('bano-tanda'); await esperar(10);
  chequear('la tanda pide categoría con botones', t.win.document.querySelectorAll('#bano-t-cats [data-bano-cat]').length >= 5 && !!t.sel('#bano-t-cats [data-bano-cat="Vacas"]'));
  chequear('el potrero es una lista con los potreros del campo', t.$('bano-t-potrero').options.length > 1);
  chequear('el dueño/firma se llama como en la app', t.$('bano-t-dueno-label').textContent.indexOf(t.win.__ev('CONFIG.duenoLabel')) === 0, t.$('bano-t-dueno-label').textContent);
  const defSi = t.$('bano-t-baston-si').getAttribute('aria-pressed') === 'true';
  chequear('"¿La vas a pasar por el bastón?" por defecto ' + (t.cfg.bastonDefecto ? 'Sí (La Vuelta)' : 'No (María Laura)'), defSi === t.cfg.bastonDefecto, String(defSi));
  t.click('bano-f-cancelar');
  // tanda 30 por el bastón (no va a Sanidad)
  await t.tanda({ cant: 30, baston: true });
  // los botones −10 / +1 / +10
  t.click('bano-tanda'); await esperar(10);
  t.sel('[data-bano-delta="10"]').click(); t.sel('[data-bano-delta="10"]').click(); t.sel('[data-bano-delta="1"]').click(); t.sel('[data-bano-delta="-10"]').click();
  chequear('+10 +10 +1 −10 = 11', t.$('bano-t-cant').value === '11', t.$('bano-t-cant').value);
  t.click('bano-f-cancelar');
  // sin bastón y sin contar: no deja
  t.click('bano-tanda'); await esperar(10);
  t.sel('#bano-t-cats [data-bano-cat="Vacas"]').click();
  t.$('bano-t-potrero').value = t.$('bano-t-potrero').options[1].value;
  if(t.cfg.duenoObligatorio) t.$('bano-t-dueno').value = t.$('bano-t-dueno').options[1].value;
  t.click('bano-t-baston-no');
  t.llenar('bano-t-cant', '');
  t.click('bano-f-guardar'); await esperar(30);
  chequear('"No" bastón sin cantidad no deja guardar', /cantidad es obligatoria/.test(t.$('bano-f-error').textContent) && t.$('modal-bano-form').style.display === 'flex', t.$('bano-f-error').textContent);
  t.click('bano-f-cancelar');
  // tanda sin conteo (por el bastón)
  await t.tanda({ cant: null, baston: true });
  await esperarHasta(() => s.lecturas.length === 2, 1000);
  chequear('las dos tandas por el bastón no crearon nada en Sanidad', san().length === 0 && s.lecturas.every(l => l.con_baston === true && l.sanidad_id === null), JSON.stringify(san()));
  chequear('la tanda sin contar va con cantidad vacía', s.lecturas[1] && s.lecturas[1].cantidad_animales === null && s.lecturas[0].cantidad_animales === 30, JSON.stringify(s.lecturas.map(l => l.cantidad_animales)));
  chequear('la tanda lleva categoría, potrero y hora automática', s.lecturas.every(l => l.categoria === 'Vacas' && !!l.potrero && Math.abs(Date.parse(l.hora) - Date.now()) < 10000));
  // reposición: regla 600 → sugiere 300 L y 500 ml; tramo que se cierra sin conteo
  t.click('bano-reposicion'); await esperar(10);
  t.regla(600);
  chequear('reposición: sugiere 300 L de agua (900 − 600)', t.$('bano-r-agua').value === '300' && /Sugerido: 300 L/.test(t.$('bano-r-agua-sug').textContent), t.$('bano-r-agua').value);
  chequear('reposición: sugiere 500 ml para 300 L', t.$('bano-r-ml').value === '500' && /Sugerido: 500 ml/.test(t.$('bano-r-ml-sug').textContent), t.$('bano-r-ml').value);
  chequear('"Tramo que se cierra": gastó 300 L, sin conteo', /Tramo que se cierra/.test(t.$('bano-f-preview').textContent) && /Gastó 300 L/.test(t.$('bano-f-preview').textContent) && !!t.sel('#bano-f-preview .bano-tramo[data-estado="sin_conteo"]'), t.$('bano-f-preview').textContent);
  t.click('bano-f-guardar'); await esperar(40);
  // tanda 80 SIN bastón → Sanidad
  await t.tanda({ cant: 80, baston: false });
  await esperarHasta(() => san().length === 1 && s.lecturas.length === 4, 1500);
  const r = san()[0] || {};
  const l80 = s.lecturas.find(l => l.cantidad_animales === 80) || {};
  chequear('la tanda sin bastón creó el tratamiento en ' + tabla, san().length === 1, JSON.stringify(s.sanidad));
  chequear('Sanidad: producto1 = producto del ciclo, dosis1 = 0, cantidad 80, Vacas, potrero', r.producto1 === 'Aspersin' && r.dosis1 === 0 && r.cantidad === 80 && r.categoria === 'Vacas' && r.potrero === l80.potrero, JSON.stringify(r));
  chequear('Sanidad: id de carga de la app (sc_), fecha de hoy y observaciones "Baño de aspersión · tanda hh:mm"', /^sc_/.test(r.id || '') && r.fecha === t.win.__ev('fechaISOHoy()') && /^Baño de aspersión · tanda \d\d:\d\d$/.test(r.observaciones || ''), JSON.stringify(r));
  if(t.cfg.excel) chequear('La Vuelta: lleva establecimiento y no dueño', r.establecimiento === 'la_vuelta' && !('dueno' in r), JSON.stringify(r));
  else chequear('María Laura: lleva el dueño', !!r.dueno && !('establecimiento' in r), JSON.stringify(r));
  chequear('la tanda guardó el id de Sanidad en sanidad_id y con_baston = false', l80.sanidad_id === r.id && l80.con_baston === false, JSON.stringify(l80));
  // fin del día 500
  await t.nivel('bano-fin-dia', 500);
  // reposición 500 + 400 L → 667 ml
  t.click('bano-reposicion'); await esperar(10);
  t.regla(500);
  chequear('reposición: 400 L sugiere 667 ml', t.$('bano-r-agua').value === '400' && t.$('bano-r-ml').value === '667', t.$('bano-r-agua').value + ' / ' + t.$('bano-r-ml').value);
  chequear('el tramo de fin del día a la reposición: 0 L, sin conteo', /Gastó 0 L · sin tandas/.test(t.$('bano-f-preview').textContent), t.$('bano-f-preview').textContent);
  t.click('bano-f-guardar'); await esperar(40);
  await t.tanda({ cant: 60, baston: true });
  await esperarHasta(() => s.lecturas.length === 7, 1500);
  chequear('el último tramo en la pantalla: el de fin del día a la reposición (0 L, sin conteo)', /Último tramo/.test(t.$('bano-tramo').textContent) && /Gastó 0 L · sin tandas/.test(t.$('bano-tramo').textContent) && !!t.sel('#bano-tramo .bano-tramo[data-estado="sin_conteo"]'), t.$('bano-tramo').textContent);
  chequear('"Hoy" lista lo de hoy con hora', (t.$('bano-hoy').textContent.match(/\d\d:\d\d/g) || []).length >= 8, t.$('bano-hoy').textContent);
  // cerrar ciclo: regla 650 → resumen + tramos
  t.click('bano-cerrar-ciclo'); await esperar(10);
  t.regla(650);
  const est = Array.from(t.win.document.querySelectorAll('#bano-f-preview .bano-tramo')).map(e => e.getAttribute('data-estado'));
  const txt = Array.from(t.win.document.querySelectorAll('#bano-f-preview .bano-tramo')).map(e => e.textContent);
  chequear('4 tramos: sin conteo, ok, sin conteo, ok', JSON.stringify(est) === JSON.stringify(['sin_conteo', 'ok', 'sin_conteo', 'ok']), JSON.stringify(est));
  chequear('tramo 1: 300 L con 1 tanda sin contar', /Gastó 300 L · 1 tanda sin contar/.test(txt[0] || ''), txt[0]);
  chequear('tramo 2: 400 L / 80 animales = 5,0 L por animal', /Gastó 400 L · 80 animales · 5,0 L por animal/.test(txt[1] || ''), txt[1]);
  chequear('tramo 3: 0 L sin conteo', /Gastó 0 L/.test(txt[2] || ''), txt[2]);
  chequear('tramo 4: 250 L / 60 = 4,17 L por animal', /Gastó 250 L · 60 animales · 4,17 L por animal/.test(txt[3] || ''), txt[3]);
  const prev = t.$('bano-f-preview').textContent;
  chequear('resumen: producto total 1.917 ml', /Producto total: 1\.917 ml/.test(prev), prev);
  chequear('resumen: 170 animales, 4 tandas (1 sin contar)', /Animales: 170 en 4 tandas \(1 sin contar\)/.test(prev), prev);
  chequear('resumen: agua gastada 950 L', /Agua gastada: 950 L/.test(prev), prev);
  chequear('resumen: costo con el precio del catálogo (1.917 ml × 0,02 = USD 38,34)', /Costo: USD 38,34/.test(prev), prev);
  t.click('bano-f-guardar');
  await esperarHasta(() => s.lecturas.length === 8, 1500);
  await esperar(40);
  chequear('se mandaron las 8 lecturas', s.lecturas.length === 8 && s.lecturas[7].tipo === 'cierre' && s.lecturas[7].nivel_l === 650, s.lecturas.map(l => l.tipo).join(','));
  const repos = s.lecturas.filter(l => l.tipo === 'reposicion');
  chequear('reposiciones con regla, agua y producto', repos.length === 2 && repos[0].nivel_l === 600 && repos[0].agua_agregada_l === 300 && repos[0].producto_ml === 500 && repos[1].producto_ml === 667, JSON.stringify(repos));
  chequear('las lecturas que no son tandas van con con_baston vacío', s.lecturas.filter(l => l.tipo !== 'tanda').every(l => l.con_baston === null));
  chequear('después de cerrar vuelve a "Abrir ciclo nuevo" con el último ciclo', t.visible('bano-sin-ciclo') && /Último ciclo: Aspersin, cerrado el/.test(t.$('bano-ultimo').textContent), t.$('bano-ultimo').textContent);
  chequear('la cola quedó vacía', t.guardado().cola.length === 0);
  // estados alto / bajo con la misma función
  const p = { capacidad: 900, umbral: 300, min: 3, max: 5 };
  const ciclo = { agua_inicial_l: 900, producto_inicial_ml: 750, inicio: new Date().toISOString() };
  const h = i => new Date(Date.now() + i * 1000).toISOString();
  const calc = (ls) => t.win.banoCalcular(ciclo, ls, p);
  const alto = calc([{ tipo: 'tanda', cantidad_animales: 10, hora: h(1) }, { tipo: 'fin_dia', nivel_l: 800, hora: h(2) }]).tramos[0];
  const bajo = calc([{ tipo: 'tanda', cantidad_animales: 100, hora: h(1) }, { tipo: 'fin_dia', nivel_l: 700, hora: h(2) }]).tramos[0];
  chequear('100 L / 10 animales = 10 L: "alto"', alto.estado === 'alto' && alto.lpa === 10, JSON.stringify(alto));
  chequear('200 L / 100 animales = 2 L: "bajo"', bajo.estado === 'bajo' && bajo.lpa === 2, JSON.stringify(bajo));
  t.cerrarTodo();
}

async function probarTocaReponer(archivo){
  console.log('\n--- "Toca reponer": con el gasto estimado (4 L por animal) y con el real');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  await t.abrirCiclo('Aspersin', 900);
  await t.tanda({ cant: 30, baston: true });
  chequear('30 animales (≈120 L) todavía no toca reponer', t.$('bano-reponer').style.display === 'none');
  chequear('el gasto dice "estimado"', /Gastó desde la última carga: 120 L/.test(t.$('bano-nivel').textContent) && /estimado: incluye 30 animales × 4 L/.test(t.$('bano-nivel').textContent), t.$('bano-nivel').textContent);
  await t.tanda({ cant: 50, baston: true });
  const rep = t.$('bano-reponer');
  chequear('80 animales (≈320 L) ≥ 300 L: "Toca reponer: agregá 320 L y unos 533 ml"', rep.style.display !== 'none' && /Toca reponer: agregá 320 L y unos 533 ml de Aspersin/.test(rep.textContent), rep.textContent);
  chequear('nivel estimado 580 L', /Nivel estimado: 580 L/.test(t.$('bano-nivel').textContent), t.$('bano-nivel').textContent);
  // con la regla real (fin del día 550) el gasto es real (350 L) y sigue tocando reponer
  await t.nivel('bano-fin-dia', 550);
  chequear('con la regla en 550 (350 L gastados, real): toca reponer 350 L', /Toca reponer: agregá 350 L/.test(t.$('bano-reponer').textContent) && !/incluye/.test(t.$('bano-nivel').textContent), t.$('bano-reponer').textContent + ' | ' + t.$('bano-nivel').textContent);
  await t.reposicion(550, null, null);
  chequear('después de reponer ya no toca', t.$('bano-reponer').style.display === 'none');
  t.cerrarTodo();
}

async function probarOfflineYCola(archivo){
  console.log('\n--- sin señal todo queda en cola y al volver se manda en orden (ciclo primero) una sola vez');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  t.click('bano-cerrar');
  t.setEnLinea(false);
  await esperar(30);
  const rpcAntes = s.rpcNombres.length;
  await t.abrir();
  chequear('sin señal no consulta', s.rpcNombres.length === rpcAntes);
  chequear('aviso "Sin señal"', /^Sin señal/.test(t.$('bano-aviso').textContent), t.$('bano-aviso').textContent);
  chequear('con la lista de productos guardada se puede abrir un ciclo', !!t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'));
  await t.abrirCiclo('Aspersin', 900);
  await t.tanda({ cant: 40, baston: false });
  await t.reposicion(700, null, null);
  chequear('nada llegó al servidor', s.intentos.length === 0 && s.ciclos.length === 0);
  const g = t.guardado();
  chequear('3 en cola, en orden: ciclo, tanda, reposición', g.cola.length === 3 && g.cola[0].clase === 'ciclo' && g.cola[1].fila.tipo === 'tanda' && g.cola[2].fila.tipo === 'reposicion', JSON.stringify(g.cola.map(x => x.clase + ':' + (x.fila.tipo || ''))));
  chequear('el indicador dice "3 en cola"', /3 en cola/.test(t.$('bano-cola').textContent), t.$('bano-cola').textContent);
  chequear('la pantalla calcula sin señal (gastó 200 L, último tramo 200 L / 40 = 5,0)', /Gastó 200 L · 40 animales · 5,0 L por animal/.test(t.$('bano-tramo').textContent), t.$('bano-tramo').textContent);
  const colaSan = t.win.__ev('estado.colaSanidad || []');
  chequear('la tanda sin bastón quedó en la cola de Sanidad de siempre', colaSan.length === 1 && colaSan[0].producto1 === 'Aspersin' && colaSan[0].dosis1 === 0 && colaSan[0].id === g.cola[1].fila.sanidad_id, JSON.stringify(colaSan));
  t.setEnLinea(true);   // dispara sincronizar(), que vacía la cola del baño (y la de Sanidad)
  await esperarHasta(() => s.lecturas.length === 2, 2500);
  await esperarHasta(() => t.guardado().cola.length === 0, 1500);
  chequear('al volver la señal: 1 ciclo y 2 lecturas en el servidor', s.ciclos.length === 1 && s.lecturas.length === 2, s.ciclos.length + ' / ' + s.lecturas.length);
  chequear('el ciclo salió primero y cada uno una sola vez', s.intentos.length === 3 && s.intentos[0].tabla === 'bano_ciclos' && s.intentos[1].row.tipo === 'tanda' && s.intentos[2].row.tipo === 'reposicion', s.intentos.map(i => i.tabla + ':' + (i.row.tipo || '')).join(','));
  await esperarHasta(() => (s.sanidad[t.cfg.tablaSanidad] || []).length === 1, 1500);
  chequear('Sanidad también salió una vez', (s.sanidad[t.cfg.tablaSanidad] || []).length === 1);
  t.setEnLinea(false); t.setEnLinea(true);
  await esperar(250);
  chequear('otra sincronización no repite nada', s.intentos.length === 3 && s.lecturas.length === 2);
  t.cerrarTodo();
}

async function probarReintentoYRechazo(archivo){
  console.log('\n--- respuesta perdida: el reintento con 23505 no duplica; un rechazo queda marcado y no frena a los demás');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  await t.abrirCiclo('Aspersin', 800);
  await esperarHasta(() => s.ciclos.length === 1, 1000);
  s.modo = 'respuesta_perdida';
  await t.tanda({ cant: 25, baston: true });
  await esperar(40);
  chequear('el servidor la recibió pero la respuesta se perdió: sigue en cola', s.lecturas.length === 1 && t.guardado().cola.length === 1, s.lecturas.length + ' / ' + t.guardado().cola.length);
  const uid = t.guardado().cola[0].uid;
  s.modo = 'ok';
  t.click('bano-actualizar');
  await esperarHasta(() => t.guardado().cola.length === 0, 2000);
  const mandados = s.intentos.filter(i => i.row.uid === uid);
  chequear('el reintento mandó el MISMO uid y el 23505 cuenta como enviado', mandados.length === 2 && t.guardado().cola.length === 0, String(mandados.length));
  chequear('una sola fila en el servidor', s.lecturas.filter(l => l.uid === uid).length === 1);
  chequear('al refrescar no se duplica la tanda en la pantalla', (t.$('bano-hoy').textContent.match(/Tanda: 25/g) || []).length === 1, t.$('bano-hoy').textContent);
  // rechazo permanente (22P02) en la próxima; la siguiente sale igual
  s.rechazar = row => row.cantidad_animales === 12;
  await t.tanda({ cant: 12, baston: true });
  await t.nivel('bano-fin-dia', 700);
  await esperarHasta(() => s.lecturas.some(l => l.tipo === 'fin_dia'), 1500);
  await esperar(40);
  const g = t.guardado();
  chequear('la rechazada queda en cola marcada (permanente) con su error', g.cola.length === 1 && g.cola[0].permanente === true && /invalid input/.test(g.cola[0].error || ''), JSON.stringify(g.cola));
  chequear('la siguiente (fin del día) salió igual', s.lecturas.some(l => l.tipo === 'fin_dia'));
  chequear('la pantalla muestra el error y "Quitar"', /No se pudo mandar: invalid input/.test(t.$('bano-cola').textContent) && !!t.sel('#bano-cola [data-bano-quitar]'), t.$('bano-cola').textContent);
  t.sel('#bano-cola [data-bano-quitar]').click();
  await esperar(20);
  chequear('"Quitar" la saca de la cola', t.guardado().cola.length === 0 && !t.sel('#bano-cola [data-bano-quitar]'));
  // servidor caído: queda en cola sin marcar como permanente y sale después
  s.modo = 'caido';
  await t.tanda({ cant: 7, baston: true });
  await esperar(40);
  chequear('servidor caído: queda en cola como pasajero', t.guardado().cola.length === 1 && !t.guardado().cola[0].permanente);
  s.modo = 'ok';
  t.setEnLinea(false); t.setEnLinea(true);
  await esperarHasta(() => s.lecturas.some(l => l.cantidad_animales === 7), 2000);
  chequear('y sale sola con la sincronización', s.lecturas.filter(l => l.cantidad_animales === 7).length === 1);
  // una falla pasajera (503) frena la vuelta: la de atrás no se adelanta
  t.setEnLinea(false); await esperar(20);
  await t.tanda({ cant: 8, baston: true });
  await t.tanda({ cant: 9, baston: true });
  const n0 = s.intentos.length;
  s.caidas = 1;
  t.setEnLinea(true);
  await esperarHasta(() => s.intentos.length > n0, 1500);
  await esperar(80);
  chequear('con un 503 en la primera, la segunda no se mandó en esa vuelta', s.intentos.length === n0 + 1 && s.intentos[n0].row.cantidad_animales === 8 && t.guardado().cola.length === 2 && !t.guardado().cola[0].permanente, s.intentos.slice(n0).map(i => i.row.cantidad_animales).join(','));
  t.click('bano-actualizar');
  await esperarHasta(() => t.guardado().cola.length === 0, 2000);
  const i8 = s.lecturas.find(l => l.cantidad_animales === 8), i9 = s.lecturas.find(l => l.cantidad_animales === 9);
  chequear('al reintentar llegan en orden (8 antes que 9)', !!i8 && !!i9 && i8.id < i9.id, JSON.stringify([i8 && i8.id, i9 && i9.id]));
  t.cerrarTodo();
}

async function probarCicloRechazado(archivo){
  console.log('\n--- si la base rechaza el ciclo, sus lecturas esperan (no se mandan) y "Quitar" saca el ciclo con sus lecturas');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  s.rechazar = row => row.agua_inicial_l === 700;
  await t.abrirCiclo('Aspersin', 700);
  await t.tanda({ cant: 20, baston: true });
  await t.nivel('bano-fin-dia', 600);
  const g = t.guardado();
  chequear('el ciclo quedó marcado como rechazado', g.cola.length === 3 && g.cola[0].clase === 'ciclo' && g.cola[0].permanente === true, JSON.stringify(g.cola.map(x => x.clase + ':' + !!x.permanente)));
  chequear('sus lecturas no se intentaron mandar', s.intentos.every(i => i.tabla === 'bano_ciclos') && s.lecturas.length === 0, s.intentos.map(i => i.tabla).join(','));
  t.sel('#bano-cola [data-bano-quitar="' + g.cola[0].uid + '"]').click();
  await esperar(20);
  chequear('"Quitar" el ciclo saca también sus lecturas y vuelve a "Abrir ciclo nuevo"', t.guardado().cola.length === 0 && !t.guardado().ciclo && t.visible('bano-sin-ciclo'));
  t.cerrarTodo();
}

async function probarOtroEquipo(archivo){
  console.log('\n--- otro equipo ve el mismo ciclo al abrir');
  const s = servidorFalso();
  const a = await levantar(archivo, s);
  if(a.errores.length){ chequear('carga sin errores (A)', false, a.errores[0]); return; }
  await a.abrir();
  await esperarHasta(() => a.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  await a.abrirCiclo('Aspersin', 900);
  await a.tanda({ cant: 33, baston: true });
  await esperarHasta(() => s.lecturas.length === 1, 1500);
  const b = await levantar(archivo, s);
  if(b.errores.length){ chequear('carga sin errores (B)', false, b.errores[0]); return; }
  chequear('el equipo B arranca sin nada del baño', !b.guardado() || !b.guardado().ciclo);
  await b.abrir();
  await esperarHasta(() => b.visible('bano-en-marcha'), 2000);
  chequear('B ve el ciclo abierto de A', b.visible('bano-en-marcha') && /Aspersin/.test(b.$('bano-cab').textContent));
  chequear('B ve la tanda de A', /Tanda: 33 Vacas/.test(b.$('bano-hoy').textContent), b.$('bano-hoy').textContent);
  await b.tanda({ cant: 44, baston: true });
  await esperarHasta(() => s.lecturas.length === 2, 1500);
  chequear('la tanda de B va al MISMO ciclo', s.lecturas.every(l => l.ciclo_uid === s.ciclos[0].uid) && s.ciclos.length === 1);
  a.click('bano-actualizar');
  await esperarHasta(() => /Tanda: 44/.test(a.$('bano-hoy').textContent), 2000);
  chequear('A ve la tanda de B, sin duplicar la suya', /Tanda: 44/.test(a.$('bano-hoy').textContent) && (a.$('bano-hoy').textContent.match(/Tanda: 33/g) || []).length === 1, a.$('bano-hoy').textContent);
  // B cierra el ciclo: A, al actualizar, vuelve a "Abrir ciclo nuevo"
  await b.nivel('bano-cerrar-ciclo', 700);
  await esperarHasta(() => s.cerrado(s.ciclos[0].uid), 1500);
  a.click('bano-actualizar');
  await esperarHasta(() => a.visible('bano-sin-ciclo'), 2000);
  chequear('cuando B cierra, A vuelve a "Abrir ciclo nuevo"', a.visible('bano-sin-ciclo') && /otro equipo/.test(a.$('bano-ultimo').textContent), a.$('bano-ultimo').textContent);
  a.cerrarTodo(); b.cerrarTodo();
}

async function probarProductos(archivo){
  console.log('\n--- ⚙ Productos: lista con "falta la dosis", producto nuevo por la RPC, sin señal no deja');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.sel('#bano-nc-productos [data-bano-producto="Aspersin"]'), 1500);
  t.click('bano-productos');
  await esperar(40);
  chequear('se abre "Productos del baño"', t.$('modal-bano-productos').style.display === 'flex');
  const item = n => t.sel('#bano-p-lista [data-producto="' + n + '"]');
  chequear('Aspersin con sus dosis y duración', !!item('Aspersin') && /Carga: 83,333 ml · Reposición: 166,667 ml/.test(item('Aspersin').textContent) && /dura 7 días/.test(item('Aspersin').textContent), item('Aspersin') && item('Aspersin').textContent);
  chequear('CreBio 7 dice "falta la dosis" en naranja', !!item('CreBio 7') && !!item('CreBio 7').querySelector('.bano-falta') && /falta la dosis/.test(item('CreBio 7').textContent));
  t.click('bano-p-nuevo'); await esperar(20);
  t.llenar('bano-p-producto', 'Producto Inventado'); t.llenar('bano-p-carga', '50'); t.llenar('bano-p-repos', '100'); t.llenar('bano-p-horas', '96');
  const rpcAntes = s.rpcArgs.filter(x => x.nombre === 'bano_config_guardar').length;
  t.click('bano-p-guardar'); await esperar(40);
  chequear('un producto fuera del catálogo no se manda', /no está en el catálogo/.test(t.$('bano-p-error').textContent) && s.rpcArgs.filter(x => x.nombre === 'bano_config_guardar').length === rpcAntes, t.$('bano-p-error').textContent);
  t.llenar('bano-p-producto', 'ivermectina 1%');
  t.click('bano-p-guardar');
  await esperarHasta(() => !!item('Ivermectina 1%'), 2000);
  const llamada = s.rpcArgs.filter(x => x.nombre === 'bano_config_guardar').pop();
  chequear('llamó a bano_config_guardar con el nombre exacto y las dosis', !!llamada && llamada.args.p_producto === 'Ivermectina 1%' && llamada.args.p_ml_100l_carga === 50 && llamada.args.p_ml_100l_reposicion === 100 && llamada.args.p_vida_horas === 96 && llamada.args.p_l_animal_min === 3 && llamada.args.p_l_animal_max === 5, JSON.stringify(llamada));
  chequear('el producto nuevo aparece en la lista', !!item('Ivermectina 1%') && /dura 4 días/.test(item('Ivermectina 1%').textContent));
  // editar CreBio 7: ponerle dosis
  t.sel('#bano-p-lista [data-bano-editar="CreBio 7"]').click(); await esperar(20);
  chequear('Editar precarga el producto (sin poder cambiarle el nombre)', t.$('bano-p-producto').value === 'CreBio 7' && t.$('bano-p-producto').readOnly && t.$('bano-p-horas').value === '72');
  t.llenar('bano-p-carga', '100'); t.llenar('bano-p-repos', '200');
  t.click('bano-p-guardar');
  await esperarHasta(() => !item('CreBio 7').querySelector('.bano-falta'), 2000);
  chequear('CreBio 7 ya no dice "falta la dosis"', !item('CreBio 7').querySelector('.bano-falta'));
  // sin señal: no deja
  t.setEnLinea(false); await esperar(20);
  t.click('bano-p-nuevo'); await esperar(10);
  t.llenar('bano-p-producto', 'Aspersin'); t.llenar('bano-p-horas', '100');
  const n = s.rpcArgs.length;
  t.click('bano-p-guardar'); await esperar(30);
  chequear('sin señal avisa y no llama a la RPC', /Sin señal/.test(t.$('bano-p-error').textContent) && s.rpcArgs.length === n && /Sin señal/.test(t.$('bano-p-aviso').textContent), t.$('bano-p-error').textContent);
  t.setEnLinea(true); await esperar(60);
  t.click('bano-p-cerrar-x');
  chequear('la X cierra Productos', t.$('modal-bano-productos').style.display === 'none');
  // con la dosis nueva, CreBio 7 sugiere
  t.sel('#bano-nc-productos [data-bano-producto="CreBio 7"]').click();
  t.sel('#bano-nc-aguas [data-bano-agua="900"]').click();
  chequear('con la dosis nueva CreBio 7 sugiere 900 ml para 900 L', t.$('bano-nc-ml').value === '900', t.$('bano-nc-ml').value);
  t.cerrarTodo();
}

async function probarAvisoDuplicado(archivo){
  console.log('\n--- aviso de posible doble carga en Sanidad');
  const s = servidorFalso();
  s.avisos = [
    { tanda_uid: '11111111-1111-4111-8111-111111111111', establecimiento: null, producto: 'Aspersin', fecha: '2026-11-03', categoria: 'Vacas', potrero: '5', cantidad_animales: 30, sanidad_baston_id: 'bq_1', baston_categoria: 'Vacas', baston_potrero: '5', baston_cantidad: 28 },
    { tanda_uid: '22222222-2222-4222-8222-222222222222', establecimiento: 'otro_campo', producto: 'CreBio 7', fecha: '2026-11-02', categoria: 'Toros', potrero: 'X', cantidad_animales: 3 }
  ];
  const t0 = await levantar(archivo, servidorFalso());
  s.avisos[0].establecimiento = t0.cfg.est;
  t0.cerrarTodo();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.$('bano-duplicados').textContent.length > 0, 1500);
  const txt = t.$('bano-duplicados').textContent;
  chequear('muestra el cartel con el texto acordado', txt === 'Posible doble carga en Sanidad: la tanda de Vacas pot. 5 del 03/11 se cargó sin bastón y el bastón también trajo Aspersin ese día. Revisá en Sanidad cuál dejar.', txt);
  chequear('solo los avisos de este campo', t.win.document.querySelectorAll('#bano-duplicados .bano-dup').length === 1);
  t.cerrarTodo();
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('Uso: node tests/probar_bano.js <index.html> ...'); process.exit(1); }
  for(const a of archivos){
    console.log('\n=== ' + a + ' ===');
    const sonda = await levantar(a, servidorFalso());
    if(sonda.errores.length){ chequear('carga sin errores', false, sonda.errores[0]); continue; }
    const { bano } = sonda.cfg;
    sonda.cerrarTodo();
    if(!bano){ await probarPoneChico(a); continue; }
    await probarAbrirYSugerencias(a);
    await probarCasoCompleto(a);
    await probarTocaReponer(a);
    await probarOfflineYCola(a);
    await probarReintentoYRechazo(a);
    await probarCicloRechazado(a);
    await probarOtroEquipo(a);
    await probarProductos(a);
    await probarAvisoDuplicado(a);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
