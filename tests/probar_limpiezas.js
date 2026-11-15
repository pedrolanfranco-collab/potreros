/*
 * Prueba: registro de limpieza de bebederos y tanques (15/11/2026).
 * Verifica: solo se ofrecen bebederos y tanques; "quién limpió" viene con el usuario del equipo y es
 * obligatorio; la limpieza queda en estado.limpiezas y viaja como 'limpieza_punto' con `quien` (que
 * el móvil no pisa al poner `usuario`); el remoto es idempotente y no toca stock; "Toca limpiar"
 * marca rojo/amarillo; en PC/móvil con Tareas cumple la tarea pendiente del punto y deja el
 * recordatorio a 6 meses con event_id deterministas en formato UUID; resincronizar no repite nada;
 * corregir y borrar solo en PC; Campo registra sin Tareas.
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
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; }; window.__cfg = CONFIG;'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const espera = ms => new Promise(r => setTimeout(r, ms));
const dos = n => String(n).padStart(2, '0');
const fmt = d => `${dos(d.getDate())}/${dos(d.getMonth()+1)}/${d.getFullYear()}`;
function haceMeses(meses, masDias){ const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - meses); const ultimo = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(new Date().getDate(), ultimo)); d.setDate(d.getDate() + (masDias||0)); return fmt(d); }
function click(win, el){ el.dispatchEvent(new win.Event('click', { bubbles: true })); }

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  win.localStorage.setItem('potreros_nombre_usuario', 'Pedro');
  const est = () => win.__est();
  const esPC = !!doc.getElementById('lp-cancelar-edicion');
  const esCampo = !doc.getElementById('btn-tareas');
  const conTareas = !esCampo && win.__cfg.manejo === true;

  chequear('estado.limpiezas arranca vacío', Array.isArray(est().limpiezas) && est().limpiezas.length === 0);
  chequear('botón 🧽 Limpiezas presente', !!doc.getElementById('btn-limpiezas'));

  // --- puntos de prueba: un bebedero, un tanque y una llave (la llave no se limpia) ---
  est().puntos.push(
    { id:'pB', tipo:'agua', subtipo:'Bebedero', nombre:'B 12', lat:-31.98, lon:-56.34, fotos:[] },
    { id:'pT', tipo:'agua', subtipo:'Tanque', nombre:'Tanque Cerro', lat:-31.97, lon:-56.33, fotos:[] },
    { id:'pL', tipo:'agua', subtipo:'Llave de agua', nombre:'L 1', lat:-31.96, lon:-56.32, fotos:[] }
  );

  click(win, doc.getElementById('btn-limpiezas'));
  chequear('el modal se abre', doc.getElementById('modal-limpiezas').style.display === 'flex');
  const opciones = Array.from(doc.getElementById('lp-punto').options).map(o => o.value);
  chequear('solo ofrece bebederos y tanques', opciones.length === 2 && opciones.includes('pB') && opciones.includes('pT'), JSON.stringify(opciones));
  chequear('"quién limpió" viene con el usuario del equipo', doc.getElementById('lp-quien').value === 'Pedro');
  const tocaInicial = doc.querySelectorAll('#limpiezas-toca [data-limpieza-toca]');
  chequear('"Toca limpiar": los dos sin limpieza salen en rojo', tocaInicial.length === 2 && Array.from(tocaInicial).every(x => x.dataset.color === 'rojo'));

  // --- validaciones ---
  doc.getElementById('lp-punto').value = 'pB';
  doc.getElementById('lp-quien').value = '   ';
  click(win, doc.getElementById('lp-guardar'));
  chequear('sin "quién limpió" no guarda', est().limpiezas.length === 0);
  doc.getElementById('lp-quien').value = 'Juan';
  const manana = new Date(); manana.setDate(manana.getDate() + 1);
  doc.getElementById('lp-fecha').value = `${manana.getFullYear()}-${dos(manana.getMonth()+1)}-${dos(manana.getDate())}`;
  click(win, doc.getElementById('lp-guardar'));
  chequear('con fecha futura no guarda', est().limpiezas.length === 0);

  // --- guardar una limpieza ---
  doc.getElementById('lp-fecha').value = win.fechaISOHoy();
  doc.getElementById('lp-obs').value = 'tenía barro';
  click(win, doc.getElementById('lp-guardar'));
  const l1 = est().limpiezas[0];
  chequear('la limpieza queda en estado.limpiezas', est().limpiezas.length === 1 && l1.puntoId === 'pB' && l1.quien === 'Juan' && l1.puntoNombre === 'B 12' && l1.puntoSubtipo === 'Bebedero', JSON.stringify(est().limpiezas));
  chequear('el id de la limpieza es un UUID', UUID.test(l1.id), l1.id);
  chequear('la lista muestra quién limpió', /Limpió: Juan/.test(doc.getElementById('limpiezas-lista').innerHTML));
  await espera(40);
  const fila = servidor.filas.find(f => f.tipo === 'limpieza_punto');
  chequear('se mandó limpieza_punto a Supabase', !!fila);
  chequear('el evento lleva quien = Juan y usuario = Pedro (quién lo anotó)', fila && fila.detalle.quien === 'Juan' && fila.detalle.usuario === 'Pedro', fila && JSON.stringify(fila.detalle));
  chequear('el evento lleva fecha y punto', fila && fila.detalle.fecha === win.fechaISOaDisplay(win.fechaISOHoy()) && fila.detalle.puntoId === 'pB');
  const tocaDespues = Array.from(doc.querySelectorAll('#limpiezas-toca [data-limpieza-toca]')).map(x => x.dataset.limpiezaToca);
  chequear('"Toca limpiar": el recién limpiado ya no sale', !tocaDespues.includes('pB') && tocaDespues.includes('pT'), JSON.stringify(tocaDespues));

  // --- 6 meses calendario ---
  chequear('15/11/2026 + 6 meses = 15/05/2027', win.sumarMesesLimpieza('15/11/2026', 6) === '15/05/2027');
  chequear('31/08/2026 + 6 meses = 28/02/2027', win.sumarMesesLimpieza('31/08/2026', 6) === '28/02/2027');
  chequear('31/08/2027 + 6 meses = 29/02/2028 (bisiesto)', win.sumarMesesLimpieza('31/08/2027', 6) === '29/02/2028');

  // --- remoto: idempotente, sin potrero, sin tocar stock ---
  const stockAntes = JSON.stringify(Object.keys(est().potreros).map(p => win.totalPotrero(p)));
  const idRemoto = '11111111-2222-4333-8444-555555555550';
  const remota = { tipo:'limpieza_punto', potrero:'no-es-un-potrero', dispositivo:'otro', fecha_cliente:'10/11/2026', creado_en:'2026-11-10T12:00:00.000Z', event_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1',
    detalle: { id:idRemoto, puntoId:'pT', puntoNombre:'Tanque Cerro', puntoSubtipo:'Tanque', fecha:'10/11/2026', quien:'Ana', obs:null, usuario:'Ana' } };
  win.aplicarEventoRemoto(JSON.parse(JSON.stringify(remota)));
  win.aplicarEventoRemoto(JSON.parse(JSON.stringify(remota)));
  chequear('una limpieza remota se aplica una sola vez', est().limpiezas.filter(l => l.id === idRemoto).length === 1);
  chequear('una limpieza remota no toca el stock', JSON.stringify(Object.keys(est().potreros).map(p => win.totalPotrero(p))) === stockAntes);
  const antesSinQuien = est().limpiezas.length;
  win.aplicarEventoRemoto({ tipo:'limpieza_punto', potrero:'x', dispositivo:'otro', fecha_cliente:'10/11/2026', detalle:{ id:'22222222-2222-4333-8444-555555555550', puntoId:'pT', fecha:'10/11/2026' } });
  chequear('una limpieza remota sin "quién" se descarta', est().limpiezas.length === antesSinQuien);

  // --- remoto: corrección y borrado (cualquier variante los aplica) ---
  win.aplicarEventoRemoto({ tipo:'limpieza_punto_editada', potrero:'x', dispositivo:'otro', fecha_cliente:'10/11/2026', detalle:{ ...remota.detalle, quien:'Ana María', obs:'con cloro' } });
  const editada = est().limpiezas.find(l => l.id === idRemoto);
  chequear('la corrección remota cambia quién y obs', editada && editada.quien === 'Ana María' && editada.obs === 'con cloro');

  // --- "Toca limpiar": amarillo a 10 días, rojo vencido ---
  est().limpiezas = est().limpiezas.filter(l => l.puntoId !== 'pT');
  est().limpiezas.push({ id:'33333333-2222-4333-8444-555555555550', puntoId:'pT', puntoNombre:'Tanque Cerro', puntoSubtipo:'Tanque', fecha: haceMeses(6, 10), quien:'Ana', obs:null });
  win.renderLimpiezasToca();
  const amarillo = doc.querySelector('#limpiezas-toca [data-limpieza-toca="pT"]');
  chequear('"Toca limpiar": vence en 10 días → amarillo', amarillo && amarillo.dataset.color === 'amarillo', amarillo ? amarillo.dataset.color : 'no aparece');
  est().limpiezas.find(l => l.puntoId === 'pT').fecha = haceMeses(7, 0);
  win.renderLimpiezasToca();
  const rojo = doc.querySelector('#limpiezas-toca [data-limpieza-toca="pT"]');
  chequear('"Toca limpiar": hace 7 meses → rojo', rojo && rojo.dataset.color === 'rojo');

  // --- Tareas: recordatorio a 6 meses y cumplir la pendiente (solo PC/móvil con Tareas) ---
  if(conTareas){
    const idRec = win.uuidDerivadoLimpieza(l1.id, 2), idCie = win.uuidDerivadoLimpieza(l1.id, 1);
    chequear('los event_id derivados son UUID, distintos y repetibles', UUID.test(idRec) && UUID.test(idCie) && idRec !== idCie && idRec !== l1.id && win.uuidDerivadoLimpieza(l1.id, 2) === idRec);
    const rec = est().tareas.find(t => t.id === 'limp-' + l1.id);
    chequear('la limpieza dejó el recordatorio a 6 meses', rec && !rec.hecha && rec.puntoId === 'pB' && rec.tipo === 'Limpieza de bebedero' && rec.fechaPrevista === win.sumarMesesLimpieza(l1.fecha, 6), JSON.stringify(rec));
    await espera(40);
    chequear('el recordatorio viajó con el event_id derivado', servidor.filas.some(f => f.tipo === 'tarea_creada' && f.event_id === idRec));

    // tarea manual pendiente del tanque, que se repite cada 30 días
    win.emitirEventoTarea('tarea_creada', { id:'t-manual', ts:new Date().toISOString(), temaGrupo:'Mantenimiento', tipo:'Limpieza de tanque', tema:'Limpieza de tanque', fechaPrevista:'01/12/2026', potrero:null, puntoId:'pT', puntoNombre:'Tanque Cerro', cadaDias:30, obs:null, usuario:'Pedro' }, '01/12/2026');
    const idOtra = '44444444-2222-4333-8444-555555555550';
    win.aplicarEventoRemoto({ tipo:'limpieza_punto', potrero:'x', dispositivo:'otro', fecha_cliente:'10/11/2026', detalle:{ id:idOtra, puntoId:'pT', puntoNombre:'Tanque Cerro', puntoSubtipo:'Tanque', fecha:'10/11/2026', quien:'Ana', obs:null } });
    win.procesarLimpiezas();
    const manual = est().tareas.find(t => t.id === 't-manual');
    chequear('la limpieza cumplió la tarea pendiente del punto, con su fecha y quién', manual && manual.hecha && manual.fechaHecha === '10/11/2026' && manual._hechaOrdenId === win.uuidDerivadoLimpieza(idOtra, 1), JSON.stringify(manual));
    const sig = est().tareas.find(t => t.id === 't-manual#1');
    chequear('la serie programó la siguiente (10/11 + 30 días)', sig && !sig.hecha && sig.fechaPrevista === '10/12/2026', JSON.stringify(sig));
    chequear('con la siguiente de la serie pendiente, no crea otro recordatorio', !est().tareas.some(t => t.id === 'limp-' + idOtra));

    await espera(40);
    const filasAntes = servidor.filas.length, tareasAntes = est().tareas.length;
    win.procesarLimpiezas();
    est().limpiezasProcesadas = [];
    win.procesarLimpiezas();
    await espera(40);
    chequear('procesar de nuevo (y resincronizar) no manda nada ni duplica tareas', servidor.filas.length === filasAntes && est().tareas.length === tareasAntes, `${filasAntes}→${servidor.filas.length}, ${tareasAntes}→${est().tareas.length}`);

    // una limpieza más vieja del mismo punto que llega tarde no toca las tareas
    const pendienteAntes = est().tareas.filter(t => !t.hecha && !t.eliminada && t.puntoId === 'pT').map(t => t.id + ':' + t.fechaPrevista).join('|');
    const tareasAntesTarde = est().tareas.length;
    win.aplicarEventoRemoto({ tipo:'limpieza_punto', potrero:'x', dispositivo:'otro', fecha_cliente:'01/10/2026', detalle:{ id:'55555555-2222-4333-8444-555555555550', puntoId:'pT', puntoNombre:'Tanque Cerro', puntoSubtipo:'Tanque', fecha:'01/10/2026', quien:'Luis', obs:null } });
    win.procesarLimpiezas();
    chequear('una limpieza vieja que llega tarde queda anotada pero no toca las tareas',
      est().limpiezas.some(l => l.quien === 'Luis') && est().tareas.length === tareasAntesTarde &&
      est().tareas.filter(t => !t.hecha && !t.eliminada && t.puntoId === 'pT').map(t => t.id + ':' + t.fechaPrevista).join('|') === pendienteAntes);

    // el bloque del punto muestra quién limpió
    const bloque = win.bloqueLimpiezaPunto(est().puntos.find(p => p.id === 'pB'));
    chequear('el bloque del punto muestra la última limpieza y quién', /Última limpieza/.test(bloque) && /limpió Juan/.test(bloque), bloque);
  } else if(!esCampo){
    chequear('sin Tareas (manejo apagado) no crea tareas', !(est().tareas||[]).length);
  }

  // --- botón en la lista de puntos (app completa) ---
  if(!esCampo){
    win.renderListaPuntos();
    const html = doc.getElementById('lista-puntos').innerHTML;
    chequear('la lista de puntos ofrece "Anotar limpieza" en bebedero y tanque, no en la llave',
      /data-limpiar-punto="pB"/.test(html) && /data-limpiar-punto="pT"/.test(html) && !/data-limpiar-punto="pL"/.test(html));
  }

  // --- corregir y borrar: solo PC ---
  win.abrirLimpiezas();
  if(esPC){
    chequear('PC: la lista tiene ✏️ y 🗑', !!doc.querySelector('#limpiezas-lista [data-limpieza-editar]') && !!doc.querySelector('#limpiezas-lista [data-limpieza-borrar]'));
    win.editarLimpieza(l1.id);
    doc.getElementById('lp-quien').value = 'Juan Pérez';
    click(win, doc.getElementById('lp-guardar'));
    chequear('PC: corregir cambia quién', est().limpiezas.find(l => l.id === l1.id).quien === 'Juan Pérez');
    win.borrarLimpieza(l1.id);
    chequear('PC: borrar la saca', !est().limpiezas.some(l => l.id === l1.id));
    await espera(40);
    chequear('PC: corrección y borrado viajaron', servidor.filas.some(f => f.tipo === 'limpieza_punto_editada' && f.detalle.quien === 'Juan Pérez') && servidor.filas.some(f => f.tipo === 'limpieza_punto_eliminada' && f.detalle.id === l1.id));
  } else {
    chequear('fuera de la PC no hay ✏️ ni 🗑', !doc.querySelector('#limpiezas-lista [data-limpieza-editar]') && typeof win.editarLimpieza === 'undefined');
    win.aplicarEventoRemoto({ tipo:'limpieza_punto_eliminada', potrero:'x', dispositivo:'otro', detalle:{ id:l1.id } });
    chequear('un borrado remoto se aplica igual', !est().limpiezas.some(l => l.id === l1.id));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
