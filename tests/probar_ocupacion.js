/*
 * Prueba ad-hoc: "días de ocupación" (14/9/2026).
 * Bug real encontrado en producción (María Laura, potreros Casco/Manantial):
 * registrarCambioOcupacion() siempre grababa la fecha de HOY al detectar una
 * transición 0->animales o animales->0, sin importar la fecha real del
 * movimiento que la causó -- un evento remoto atrasado, o un movimiento local
 * con fecha retroactiva, quedaban marcados como "Ocupado hace 0 días" aunque
 * el movimiento real fuera de hace semanas.
 *
 * Verifica: un evento remoto con fecha_cliente vieja usa esa fecha, no hoy;
 * un nacimiento local con fecha retroactiva en un potrero vacío usa esa
 * fecha, no hoy; un comando de voz (sin selector de fecha) sigue usando hoy,
 * como corresponde porque siempre es una acción del momento; una reversión
 * de corrección sincronizada usa la fecha del evento de corrección.
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

function crearServidor(){
  const filas = [];
  let n = 0;
  return {
    filas,
    createClient(){
      return { from(){
        const q = {
          _filtros: [],
          insert(obj){
            n++;
            filas.push(Object.assign({}, obj, { id: 'row'+n, creado_en: new Date(Date.UTC(2026,0,1,12,0,n)).toISOString() }));
            return Promise.resolve({ error: null });
          },
          select(){ return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; }, order(){ return q; },
          then(res){ const data = filas.filter(r=>q._filtros.every(f=>f(r))); return Promise.resolve(res({data, error:null})); }
        };
        return q;
      } };
    }
  };
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
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__vaciar = function(n){ estado.potreros[n].animales = {}; estado.potreros[n].fechaIngreso = null; estado.potreros[n].fechaSalida = null; guardarEstado(); };' +
      '\n;window.__ocup = function(n){ return estadoOcupacion(n); };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const potreros = Object.keys(win.__est().potreros);
  if(!potreros.length){ console.log('  · sin potreros cargados, se salta.'); return; }
  const p1 = potreros[0];

  // --- evento remoto atrasado: no debe fechar "hoy" ---
  win.__vaciar(p1);
  win.aplicarEventoRemoto({ tipo:'ingreso', potrero: p1, dispositivo:'otro',
    fecha_cliente: '10/09/2026', detalle: { categoria:'Vacas', dueno:null, cantidad: 3 } });
  const ocupRemoto = win.__ocup(p1);
  chequear('evento remoto atrasado usa la fecha del evento, no hoy',
    ocupRemoto.tipo==='ocupado' && win.__est().potreros[p1].fechaIngreso === '2026-09-10',
    JSON.stringify(ocupRemoto) + ' fechaIngreso=' + win.__est().potreros[p1].fechaIngreso);
  chequear('el texto no dice "hace 0 días" para un evento de hace días',
    !/hace 0 días/.test(ocupRemoto.texto), ocupRemoto.texto);

  // --- movimiento local con fecha retroactiva en potrero vacío ---
  win.__vaciar(p1);
  win.seleccionarPotrero(p1);
  win.mostrarFormulario(p1, 'nacimiento');
  doc.getElementById('f-cant').value = '2';
  doc.getElementById('f-fecha').value = '2026-09-01';
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  const ocupLocal = win.__ocup(p1);
  chequear('nacimiento local con fecha retroactiva usa esa fecha, no hoy',
    win.__est().potreros[p1].fechaIngreso === '2026-09-01',
    'fechaIngreso=' + win.__est().potreros[p1].fechaIngreso);
  chequear('el texto no dice "hace 0 días" para una carga retroactiva',
    !/hace 0 días/.test(ocupLocal.texto), ocupLocal.texto);

  // --- sin fecha explícita (como hace la carga por voz, que siempre es "ahora"):
  // registrarCambioOcupacion sigue cayendo en hoy, tal como antes del fix ---
  win.__vaciar(p1);
  const hoyISO = win.fechaISOHoy();
  win.__est().potreros[p1].animales['Vacas'] = 3; // pasa de 0 a >0 "afuera", como si ya se hubiera cargado
  win.registrarCambioOcupacion(p1, 0);
  chequear('sin fecha explícita, sigue fechando hoy (no rompió el caso normal)',
    win.__est().potreros[p1].fechaIngreso === hoyISO,
    'fechaIngreso=' + win.__est().potreros[p1].fechaIngreso + ' hoy=' + hoyISO);

  // --- reversión de una corrección sincronizada: usa la fecha del evento de corrección ---
  win.__vaciar(p1);
  win.aplicarEventoRemoto({ tipo:'ingreso', potrero: p1, dispositivo:'otro',
    fecha_cliente: '05/09/2026', detalle: { categoria:'Vacas', dueno:null, cantidad: 5 } });
  win.aplicarEventoRemoto({ tipo:'correccion', potrero: p1, dispositivo:'otro',
    fecha_cliente: '12/09/2026',
    detalle: { accion:'eliminar', tipoOriginal:'ingreso',
      reversar: { tipo:'restar', potrero: p1, categoria:'Vacas', dueno:null, cantidad: 5 } } });
  chequear('una reversión sincronizada que vuelve a 0 usa la fecha de la corrección, no hoy',
    win.__est().potreros[p1].fechaSalida === '2026-09-12',
    'fechaSalida=' + win.__est().potreros[p1].fechaSalida);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
