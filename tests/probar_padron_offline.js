/*
 * Prueba: padrón de caravanas sin señal (31/10/2026, a pedido de Pedro; CONFIG.padronOffline, solo La Vuelta móvil y Campo).
 * Copia de animales_caravana en IndexedDB (en jsdom: el respaldo en memoria). Se verifica: primera vez entera y paginada por
 * id8 con select explícito y la clave del campo; la ficha desde la copia es idéntica a la de con señal (no falta columna);
 * sin señal / con el pedido fallando / colgado usa la copia y dice "datos al"; con señal sigue como antes; diferencias
 * con gte ultima_lectura; 30 min de espera; la completa saca las que ya no están; una completa vacía (RLS) o fallida no
 * pisa; aviso de copia vieja; nada en localStorage ni en `estado` (Backup); otro ID de dispositivo y "Restablecer" la
 * invalidan; sin clave no baja; sin el flag (PC, María Laura, Pone Chico) no baja nada y la búsqueda es la de siempre.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
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
const esperar = ms => new Promise(r => setTimeout(r, ms));
const p2 = x => String(x).padStart(2, '0');
function masDias(n){ const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
function hoyDMY(){ const d = new Date(); return `${p2(d.getDate())}/${p2(d.getMonth()+1)}/${d.getFullYear()}`; }

function fila(id8, extra){
  return Object.assign({ establecimiento:'la_vuelta', id8, ide:'858000' + id8, sexo:'HEMBRA', categoria:'Vaquillona', gen:'4',
    propietario:'PEDRO', potrero:'12', estado_carencia:'APTO', fecha_apto:null, dias_restantes:null, producto_carencia:null,
    proximo_tratamiento:null, ultimo_peso:null, peso_fecha:null, ultima_lectura:'2026-01-01', actualizado:'2026-10-07T08:54:12+00:00',
    estado_vida:'ACTIVO', baja_motivo:null, baja_fecha:null, baja_guia:null, pesadas:null, ganancia_diaria:null, pesadas_totales:0,
    rodeo:null, rodeo_fecha:null, nota:null, nota_fecha:null, faltantes:null }, extra || {});
}
// Todas las columnas que muestra la ficha, llenas: si la copia se baja sin alguna, la ficha sale distinta.
const REALES = [
  fila('37620042', { sexo:'MACHO', categoria:'Novillito 1-2', propietario:'SILVIA', potrero:'21', estado_carencia:'NO APTO',
    fecha_apto: masDias(40), dias_restantes: 98, producto_carencia:'EON', proximo_tratamiento:'2026-11-02', ultimo_peso:340,
    peso_fecha:'2026-05-10', ultima_lectura:'2026-10-20', rodeo:'COLA', rodeo_fecha:'2026-10-13', nota:'MARCA_PADRON_9Z',
    nota_fecha:'2026-10-01', ganancia_diaria:0.58, pesadas_totales:2,
    pesadas:[{f:'2026-03-02',p:300,g:null,s:false,o:'13',c:'Novillito 1-2',a:'1043_X'},{f:'2026-05-10',p:340,g:0.58,s:false,o:'21',c:'Novillito 1-2',a:'1051_X'}],
    faltantes:[{a:'1155',f:'2026-10-16',p:'EON',falta:'categoria'}] }),
  fila('50319677', { estado_vida:'BAJA', baja_motivo:'se fue', baja_fecha:'2025-07-31', baja_guia:'D373808', ultima_lectura:'2025-07-31' }),
  fila('44444444', { estado_carencia:'CARENCIA DESCONOCIDA', producto_carencia:'G0', ultima_lectura:'2026-10-22' }),
];
const MAX_LECTURA = '2026-10-22';
const N_LV = 1100 + REALES.length; // 1103: dos páginas de 1000

function crearServidor(){
  const s = { filas: [], consultas: [], headers: {}, modo: {} };
  for(let i = 0; i < 1100; i++) s.filas.push(fila(String(10000000 + i)));
  REALES.forEach(a => s.filas.push(JSON.parse(JSON.stringify(a))));
  REALES.forEach(a => s.filas.push(Object.assign(JSON.parse(JSON.stringify(a)), { establecimiento:'maria_laura' })));
  s.createClient = (url, key, opciones) => {
    s.headers = (opciones && opciones.global && opciones.global.headers) || {};
    return { from(tabla){
      const q = { cols:'*', filtros:[], nombres:[], orden:[], rango:null,
        select(c){ q.cols = c || '*'; return q; },
        eq(c, v){ q.filtros.push(r => r[c] === v); q.nombres.push('eq:' + c + '=' + v); return q; },
        gte(c, v){ q.filtros.push(r => r[c] != null && String(r[c]) >= String(v)); q.nombres.push('gte:' + c + '=' + v); return q; },
        gt(c, v){ q.filtros.push(r => String(r[c]) > String(v)); return q; },
        in(c, vs){ q.filtros.push(r => vs.includes(r[c])); return q; },
        order(c){ q.orden.push(c); return q; },
        range(d, h){ q.rango = [d, h]; return q; },
        limit(){ return q; }, not(){ return q; }, is(){ return q; }, delete(){ return q; },
        insert(){ return Promise.resolve({ error:null, status:201 }); },
        upsert(){ return Promise.resolve({ error:null, status:201 }); },
        then(res, rej){
          if(tabla !== 'animales_caravana') return Promise.resolve({ data:[], error:null, status:200 }).then(res, rej);
          const busqueda = q.nombres.some(n => n.startsWith('eq:id8='));
          s.consultas.push({ busqueda, cols:q.cols, nombres:q.nombres.slice(), orden:q.orden.slice(), rango:q.rango });
          if(busqueda && s.modo.colgarBusqueda) return new Promise(() => {});
          if((busqueda && s.modo.fallarBusqueda) || (!busqueda && s.modo.fallarCopia))
            return Promise.resolve({ data:null, error:{ message:'Failed to fetch' }, status:0 }).then(res, rej);
          let datos = (!busqueda && s.modo.vacio) ? [] : s.filas.filter(r => q.filtros.every(f => f(r)));
          if(q.orden.length){ const c = q.orden[0]; datos = datos.slice().sort((a, b) => String(a[c]).localeCompare(String(b[c]))); }
          if(q.rango) datos = datos.slice(q.rango[0], Math.min(q.rango[1], q.rango[0] + 999) + 1);
          if(q.cols !== '*'){ const cs = q.cols.split(',').map(x => x.trim()); datos = datos.map(r => { const o = {}; cs.forEach(c => { if(c in r) o[c] = r[c]; }); return o; }); }
          return Promise.resolve({ data: JSON.parse(JSON.stringify(datos)), error:null, status:200 }).then(res, rej);
        }
      };
      return q;
    } };
  };
  return s;
}

async function levantar(archivo, servidor, opciones){
  const op = opciones || {};
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if(!/Not implemented: navigation/.test(e.message || '')) errores.push('jsdomError: ' + (e.stack || e.message)); });
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  let enLinea = !!op.enLinea;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable:true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const est = JSON.parse(html.match(/const CONFIG = (\{.*?\});\n/)[1]).establecimiento;
  if(op.clave !== false) win.localStorage.setItem('clave_campo_' + est, 'clavedeprueba123');
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try{
    win.eval(codigo + `
      ;window.__sincronizar = sincronizar;
      window.__padronOffline = PADRON_OFFLINE;
      window.__padronLocal = padronLocal;
      window.__actualizarPadron = actualizarPadronLocal;
      window.__padronEnCurso = function(){ return _actualizandoPadron || Promise.resolve(null); };
      window.__ficha = fichaCaravanaHTML;
      window.__limpiar = limpiarTextoRemoto;
      window.__dispKey = DISPOSITIVO_KEY;
      window.__est = function(){ return estado; };
    `);
  }catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await esperar(60);
  return { win, errores, est, setEnLinea(v){ enLinea = v; } };
}

async function buscar(win, numero, ms){
  const doc = win.document;
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles:true }));
  doc.getElementById('cv-numero').value = numero;
  doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', { bubbles:true }));
  await esperar(ms || 80);
  return doc.getElementById('cv-resultado').textContent;
}
const bajadas = s => s.consultas.filter(c => !c.busqueda);
// corre el reloj de la copia hacia atrás: 'actualizadoEn' (pasaron los 30 min) o 'completaEn' (pasó el día)
async function envejecer(win, campo, ms){
  const c = await win.__padronLocal.leer();
  await win.__padronLocal.guardar(Object.assign({}, c, { [campo]: new Date(Date.now() - ms).toISOString() }));
}
const MEDIA_HORA_Y_UN_POCO = 31 * 60 * 1000, UN_DIA_Y_UN_POCO = 25 * 3600 * 1000;
function todoLocalStorage(win){ let t = ''; for(let i = 0; i < win.localStorage.length; i++){ const k = win.localStorage.key(i); t += k + '=' + win.localStorage.getItem(k) + '\n'; } return t; }

async function probarConFlag(archivo){
  const s = crearServidor();
  const app = await levantar(archivo, s, { enLinea:false });
  const { win } = app; const doc = win.document;
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  chequear('PADRON_OFFLINE prendido', win.__padronOffline === true);

  // 1. sin copia y sin señal: como siempre
  let t = await buscar(win, '37620042');
  chequear('sin copia y sin señal: avisa como antes', /No se pudo consultar/.test(t) && !/Novillito/.test(t), t);
  chequear('sin señal no consulta Supabase', s.consultas.length === 0);

  // 2. primera sincronización: copia entera
  app.setEnLinea(true);
  await win.__sincronizar(false);
  await win.__padronEnCurso();
  const b = bajadas(s);
  chequear('la primera vez baja el padrón entero (sin filtro de fecha)', b.length > 0 && b.every(c => !c.nombres.some(n => n.startsWith('gte:'))), JSON.stringify(b));
  chequear('pagina de a 1000 con range() y desempate por id8 (la tabla no tiene id)', b.length === 2 && b.every(c => c.rango && c.orden[0] === 'id8'), JSON.stringify(b));
  chequear('select explícito, sin faltantes', b.every(c => c.cols !== '*' && !/faltantes/.test(c.cols)), b[0] && b[0].cols);
  chequear('filtra por el establecimiento', b.every(c => c.nombres.includes('eq:establecimiento=' + app.est)));
  chequear('manda la clave del campo', s.headers['x-clave-campo'] === 'clavedeprueba123', JSON.stringify(s.headers));
  let copia = await win.__padronLocal.leer();
  chequear('la copia tiene las caravanas de este campo (y ninguna del otro)', copia && copia.n === N_LV && Object.keys(copia.animales).length === N_LV, copia && copia.n);
  chequear('guarda la fecha de la última actualización', copia && !isNaN(Date.parse(copia.actualizadoEn)) && !isNaN(Date.parse(copia.completaEn)));
  chequear('recuerda la última lectura más nueva', copia && copia.maxLectura === MAX_LECTURA, copia && copia.maxLectura);
  chequear('la sincronización termina sin esperar al padrón', !win.document.getElementById('estado-sync') || !/Sincronizando/i.test(win.document.getElementById('estado-sync').textContent));
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles:true }));
  await esperar(60);
  chequear('al abrir el buscador dice cuántas caravanas tiene la copia', new RegExp(N_LV + ' caravanas').test(doc.getElementById('cv-copia').textContent), doc.getElementById('cv-copia').textContent);

  // 3. la ficha desde la copia es la misma que con señal
  const completa = a => win.__limpiar(JSON.parse(JSON.stringify(a)));
  for(const a of REALES){
    chequear(`ficha de ${a.id8} desde la copia = ficha con señal (no falta ninguna columna)`, win.__ficha(copia.animales[a.id8]) === win.__ficha(completa(a)));
  }

  // 4. sin señal usa la copia
  app.setEnLinea(false);
  let antes = s.consultas.length;
  t = await buscar(win, '37620042');
  chequear('sin señal: muestra la ficha desde la copia', /NO APTO/.test(t) && /Novillito 1-2/.test(t) && /COLA/.test(t), t);
  chequear('dice "datos del padrón al" con la fecha de hoy', /Sin señal: datos del padrón al/.test(t) && t.includes(hoyDMY()), t);
  chequear('copia nueva: sin aviso de copia vieja', !/la copia tiene/i.test(t));
  chequear('los días que faltan se cuentan con la fecha de hoy', /faltan 40 días/.test(t), t);
  chequear('sin señal no consulta Supabase', s.consultas.length === antes);
  t = await buscar(win, '99999999');
  chequear('caravana que no está en la copia: lo dice y no inventa', /no está en la copia del padrón/.test(t) && !/Novillito/.test(t), t);
  const scc = doc.getElementById('sc-caravana'); scc.disabled = false; scc.value = '37620042';
  scc.dispatchEvent(new win.Event('change', { bubbles:true })); await esperar(80);
  const quien = doc.getElementById('sc-caravana-quien').textContent;
  chequear('Sanidad sin señal: "quién es" usa la copia y lo dice', /Novillito 1-2/.test(quien) && /padrón del/.test(quien), quien);

  // 5. con señal: como hoy
  app.setEnLinea(true);
  t = await buscar(win, '37620042');
  const ult = s.consultas[s.consultas.length - 1];
  chequear('con señal consulta Supabase como antes (select *, por id8)', ult && ult.busqueda && ult.cols === '*' && ult.nombres.includes('eq:id8=37620042'), JSON.stringify(ult));
  chequear('con señal no muestra el aviso de la copia', !/Sin señal/.test(t) && /NO APTO/.test(t), t);

  // 6. con señal pero el pedido falla / no contesta
  s.modo.fallarBusqueda = true;
  t = await buscar(win, '44444444');
  chequear('si el pedido falla, usa la copia y lo dice', /SIN CONFIRMAR/.test(t) && /Sin señal: datos del padrón al/.test(t), t);
  s.modo.fallarBusqueda = false;
  if(/la-vuelta-movil[\\/]/.test(archivo)){
    s.modo.colgarBusqueda = true;
    t = await buscar(win, '37620042', 6600);
    chequear('si Supabase no contesta en 6 s, usa la copia', /Sin señal: datos del padrón al/.test(t) && /NO APTO/.test(t), t);
    s.modo.colgarBusqueda = false;
  }

  // 7. diferencias
  const completaAntes = copia.completaEn;
  s.filas.push(fila('90000001', { categoria:'Ternera', ultima_lectura:'2026-10-25' }));
  const v = s.filas.find(r => r.establecimiento === app.est && r.id8 === '44444444'); v.estado_carencia = 'APTO'; v.producto_carencia = null;
  antes = s.consultas.length;
  await envejecer(win, 'actualizadoEn', MEDIA_HORA_Y_UN_POCO);
  await win.__actualizarPadron();
  const dif = s.consultas.slice(antes).filter(c => !c.busqueda);
  chequear('diferencias: pide solo desde la última lectura guardada (gte)', dif.length === 1 && dif[0].nombres.includes('gte:ultima_lectura=' + MAX_LECTURA), JSON.stringify(dif));
  copia = await win.__padronLocal.leer();
  chequear('entra la caravana nueva', !!copia.animales['90000001'] && copia.n === N_LV + 1, copia.n);
  chequear('se actualiza la del mismo día (>=)', copia.animales['44444444'].estado_carencia === 'APTO');
  chequear('no cambia la fecha de la carga completa', copia.completaEn === completaAntes);
  chequear('mueve la última lectura', copia.maxLectura === '2026-10-25', copia.maxLectura);

  // 8. no más de una vez cada 30 min
  antes = s.consultas.length;
  await win.__sincronizar(false); await win.__padronEnCurso();
  chequear('una sincronización enseguida no vuelve a bajar el padrón', s.consultas.length === antes);

  // 8b. una copia sin ninguna fecha de lectura no tiene desde dónde pedir diferencias: baja entera
  copia = await win.__padronLocal.leer();
  await win.__padronLocal.guardar(Object.assign({}, copia, { maxLectura: null }));
  antes = s.consultas.length;
  await win.__actualizarPadron();
  const sinFecha = s.consultas.slice(antes).filter(c => !c.busqueda);
  chequear('copia sin fecha de lectura: baja el padrón entero', sinFecha.length >= 1 && sinFecha.every(c => !c.nombres.some(n => n.startsWith('gte:'))), JSON.stringify(sinFecha));

  // 9. la completa saca lo que ya no está
  s.filas = s.filas.filter(r => !(r.establecimiento === app.est && r.id8 === '50319677'));
  await envejecer(win, 'completaEn', UN_DIA_Y_UN_POCO);
  await win.__actualizarPadron();
  copia = await win.__padronLocal.leer();
  chequear('la carga completa saca las caravanas que ya no están en el padrón', !copia.animales['50319677'] && copia.n === N_LV, copia.n);

  // 10-11. vacío (RLS) y falla no pisan
  await envejecer(win, 'completaEn', UN_DIA_Y_UN_POCO);
  s.modo.vacio = true; await win.__actualizarPadron(); s.modo.vacio = false;
  copia = await win.__padronLocal.leer();
  chequear('una respuesta vacía (clave mala / RLS) no borra la copia', copia && copia.n === N_LV);
  s.modo.fallarCopia = true; await win.__actualizarPadron(); s.modo.fallarCopia = false;
  copia = await win.__padronLocal.leer();
  chequear('si falla la bajada queda la copia anterior', copia && copia.n === N_LV);

  // 12. copia vieja
  await win.__padronLocal.guardar(Object.assign({}, copia, { actualizadoEn: new Date(Date.now() - 10 * 86400000).toISOString() }));
  app.setEnLinea(false);
  t = await buscar(win, '37620042');
  chequear('copia de 10 días: avisa que es vieja', /la copia tiene 10 días/i.test(t), t);

  // 13. nada en localStorage ni en estado (Backup JSON)
  chequear('la copia no va a localStorage ni a estado (Backup JSON)', !todoLocalStorage(win).includes('MARCA_PADRON_9Z') && !JSON.stringify(win.__est()).includes('MARCA_PADRON_9Z'));

  // 14. otro ID de dispositivo
  win.localStorage.removeItem(win.__dispKey);
  chequear('con otro ID de dispositivo la copia no vale', (await win.__padronLocal.leer()) === null);

  // 15. Restablecer datos de fábrica (solo la móvil completa lo tiene)
  const br = doc.getElementById('btn-restablecer');
  if(br){
    app.setEnLinea(true);
    await win.__actualizarPadron();
    const id = win.localStorage.getItem(win.__dispKey);
    chequear('hay copia antes de restablecer', !!(await win.__padronLocal.leer()));
    br.dispatchEvent(new win.Event('click', { bubbles:true }));
    await esperar(80);
    win.localStorage.setItem(win.__dispKey, id); // mismo ID: si sigue la copia, es que no se borró
    chequear('Restablecer datos de fábrica borra la copia', (await win.__padronLocal.leer()) === null);
  }
}

async function probarSinClave(archivo){
  console.log('  -- sin la clave del campo');
  const s = crearServidor();
  const app = await levantar(archivo, s, { enLinea:false, clave:false });
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.setEnLinea(true);
  await app.win.__sincronizar(false); await app.win.__padronEnCurso(); await esperar(30);
  chequear('sin la clave del campo no baja el padrón (vendría vacío)', bajadas(s).length === 0);
}

async function probarSinFlag(archivo, cfg){
  const s = crearServidor();
  const app = await levantar(archivo, s, { enLinea:false });
  const { win } = app;
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  chequear('PADRON_OFFLINE apagado', win.__padronOffline === false);
  app.setEnLinea(true);
  await win.__sincronizar(false); await win.__padronEnCurso();
  const r = await win.__actualizarPadron();
  await esperar(30);
  chequear('no baja el padrón', bajadas(s).length === 0 && r === null, JSON.stringify(bajadas(s)));
  chequear('no hay copia', (await win.__padronLocal.leer()) === null);
  if(cfg.caravanasHabilitado){
    s.modo.fallarBusqueda = true;
    const t = await buscar(win, '37620042');
    chequear('sin señal avisa como siempre', /No se pudo consultar/.test(t) && !/Sin señal: datos/.test(t), t);
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('uso: node probar_padron_offline.js <archivo.html>...'); process.exit(2); }
  let conFlag = 0;
  for(const a of archivos){
    console.log('\n=== ' + a + ' ===');
    const cfg = JSON.parse(fs.readFileSync(a, 'utf-8').match(/const CONFIG = (\{.*?\});\n/)[1]);
    const esPc = /-pc[\\/]/.test(a);
    if(cfg.padronOffline && cfg.caravanasHabilitado && !esPc){ conFlag++; await probarConFlag(a); await probarSinClave(a); }
    else await probarSinFlag(a, cfg);
  }
  if(!conFlag){ console.log('\nNingún archivo con el padrón sin señal'); fallas++; }
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
