/*
 * Prueba: "✏️ Renombrar" un punto (16/11/2026).
 * Verifica: el botón está en la lista de puntos de PC y móvil completa y no en Campo; cambia solo el nombre y conserva el
 * id; nombre vacío no cambia nada; un nombre que ya usa otro punto pregunta; las limpiezas y tareas del punto muestran el
 * nombre nuevo (también el tema del recordatorio); viaja como punto_renombrado {id, nombre} y cualquier variante lo aplica;
 * un id que no existe o un nombre vacío desde otro equipo no hacen nada.
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

const espera = ms => new Promise(r => setTimeout(r, ms));
function click(win, el){ el.dispatchEvent(new win.Event('click', { bubbles: true })); }

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  win.localStorage.setItem('potreros_nombre_usuario', 'Pedro');
  const est = () => win.__est();
  const esCampo = !doc.getElementById('btn-tareas');

  est().puntos.push(
    { id:'pB', tipo:'agua', subtipo:'Bebedero', nombre:'B 5', lat:-31.98, lon:-56.34, fotos:[] },
    { id:'pT', tipo:'agua', subtipo:'Tanque', nombre:'Tanque Cerro', lat:-31.97, lon:-56.33, fotos:[] }
  );
  est().limpiezas.push({ id:'11111111-2222-4333-8444-555555555550', puntoId:'pB', puntoNombre:'B 5', puntoSubtipo:'Bebedero', fecha:'10/11/2026', quien:'Juan', obs:null });
  est().tareas = est().tareas || [];
  est().tareas.push({ id:'t1', temaGrupo:'Mantenimiento', tipo:'Limpieza de bebedero', tema:'Limpieza de bebedero · B 5', puntoId:'pB', puntoNombre:'B 5', fechaPrevista:'10/05/2027', hecha:false, eliminada:false, _ts:'', _ordenId:'' });
  win.renderListaPuntos();
  const lista = () => doc.getElementById('lista-puntos').innerHTML;

  if(esCampo){
    chequear('Campo: no tiene el botón ✏️ Renombrar', !/data-renombrar-punto/.test(lista()) && !doc.getElementById('modal-renombrar-punto'));
  } else {
    chequear('la lista de puntos tiene ✏️ Renombrar en cada punto', (lista().match(/data-renombrar-punto=/g) || []).length === 2);
    if(!doc.querySelector('[data-renombrar-punto="pB"]')) return;

    // abrir, nombre vacío, mismo nombre
    click(win, doc.querySelector('[data-renombrar-punto="pB"]'));
    const modal = doc.getElementById('modal-renombrar-punto');
    chequear('abre la ventana con el nombre actual', modal.style.display === 'flex' && doc.getElementById('rn-nombre').value === 'B 5' && /B 5/.test(doc.getElementById('rn-actual').textContent));
    doc.getElementById('rn-nombre').value = '   ';
    click(win, doc.getElementById('rn-guardar'));
    chequear('con el nombre vacío no cambia nada', est().puntos.find(p => p.id === 'pB').nombre === 'B 5' && modal.style.display === 'flex');

    // repetido: si se cancela el aviso, no cambia
    win.confirm = () => false;
    doc.getElementById('rn-nombre').value = 'tanque cerro';
    click(win, doc.getElementById('rn-guardar'));
    chequear('con un nombre que ya usa otro punto pregunta, y si decís que no, no cambia', est().puntos.find(p => p.id === 'pB').nombre === 'B 5');
    win.confirm = () => true;

    // renombrar
    doc.getElementById('rn-nombre').value = 'B 12';
    click(win, doc.getElementById('rn-guardar'));
    const pB = est().puntos.find(p => p.id === 'pB');
    chequear('cambia el nombre y conserva el id', !!pB && pB.nombre === 'B 12' && est().puntos.filter(p => p.id === 'pB').length === 1);
    chequear('cierra la ventana', modal.style.display === 'none');
    chequear('la limpieza del punto muestra el nombre nuevo', est().limpiezas.find(l => l.puntoId === 'pB').puntoNombre === 'B 12');
    const t1 = est().tareas.find(t => t.id === 't1');
    chequear('la tarea del punto muestra el nombre nuevo (también en el tema del recordatorio)', t1.puntoNombre === 'B 12' && t1.tema === 'Limpieza de bebedero · B 12', JSON.stringify([t1.puntoNombre, t1.tema]));
    chequear('la lista se redibuja con el nombre nuevo', /B 12/.test(lista()) && !/>B 5 </.test(lista()));
    await espera(40);
    const fila = servidor.filas.find(f => f.tipo === 'punto_renombrado');
    chequear('viaja como punto_renombrado con {id, nombre}', !!fila && fila.detalle.id === 'pB' && fila.detalle.nombre === 'B 12', fila && JSON.stringify(fila.detalle));

    // cancelar no cambia
    click(win, doc.querySelector('[data-renombrar-punto="pT"]'));
    doc.getElementById('rn-nombre').value = 'Otro';
    click(win, doc.getElementById('rn-cancelar'));
    chequear('Cancelar no cambia nada', est().puntos.find(p => p.id === 'pT').nombre === 'Tanque Cerro' && modal.style.display === 'none');
  }

  // desde otro equipo (cualquier variante, Campo incluido)
  win.aplicarEventoRemoto({ tipo:'punto_renombrado', potrero:'x', dispositivo:'otro', fecha_cliente:'16/11/2026', detalle:{ id:'pT', nombre:'TQ1' } });
  chequear('un cambio de nombre de otro equipo se aplica', est().puntos.find(p => p.id === 'pT').nombre === 'TQ1');
  const antes = JSON.stringify(est().puntos);
  win.aplicarEventoRemoto({ tipo:'punto_renombrado', potrero:'x', dispositivo:'otro', detalle:{ id:'no-existe', nombre:'Nada' } });
  win.aplicarEventoRemoto({ tipo:'punto_renombrado', potrero:'x', dispositivo:'otro', detalle:{ id:'pT', nombre:'  ' } });
  chequear('con un id que no existe o un nombre vacío no hace nada', JSON.stringify(est().puntos) === antes);
  chequear('no lo guarda como evento desconocido', !(est().eventosDesconocidos || []).some(e => e.tipo === 'punto_renombrado'));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
