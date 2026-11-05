/* Avisos visibles: validación, agrupación, muerte, Sanidad y tareas silenciosas en las nueve variantes. */
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
async function probarAvisos(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const html = fs.readFileSync(archivo, 'utf8');
  const base = html.replace(/#(?:toast|aviso-guardado)\s*\{[^}]*\}/g, '');
  const indices = [...base.matchAll(/z-index\s*:\s*(\d+)/gi)].map(m=>Number(m[1]));
  const max = Math.max(...indices);
  const z = id=>Number((html.match(new RegExp('#'+id+'\\s*\\{[^}]*z-index\\s*:\\s*(\\d+)', 'i'))||[])[1]);
  chequear('toast y guardado quedan por encima del resto del CSS y estilos inline', z('toast') > max && z('aviso-guardado') > max && z('aviso-guardado') > z('toast'));
  const servidor = crearServidor();
  const {win:A, errores} = await levantar(archivo, servidor);
  try{
    chequear('carga sin errores', errores.length === 0, errores.join(' | '));
    const doc=A.document, aviso=doc.getElementById('aviso-guardado');
    chequear('cartel presente y oculto al inicio en esta variante', !!aviso && aviso.hidden);
    if(!aviso) return;
    Object.defineProperty(A.navigator, 'onLine', {value:false, configurable:true});
    A.eval('window.__sel = seleccionarPotrero;');
    if(!A.__potrerosGeo().length){
      A.aplicarEventoRemoto({tipo:'potrero_creado', potrero:'Prueba', detalle:{area:1, coords:[[-32,-56],[-32,-56.01],[-32.01,-56]]}, fecha_cliente:A.fechaHoy(), event_id:crypto.randomUUID()}, new Set());
    }
    const nombre=A.__potrerosGeo()[0].nombre, dueno=A.__config().duenos[0];
    const st=A.__est();
    st.potreros[nombre].animales = {[A.claveAnimal('Vacas',dueno)]:10,[A.claveAnimal('Terneros',dueno)]:10};
    st.colaSync=[];
    A.__sel(nombre);
    click(A,doc.querySelector('[data-accion="vecino"]'));
    doc.getElementById('f-vecino').value='Vecino de prueba';
    const fila=doc.querySelector('.vec-fila');
    const llenar=(f,cat)=>{
      f.querySelector('[data-vp="cat"]').value=cat;
      f.querySelector('[data-vp="dueno"]').value=dueno;
      f.querySelector('[data-vp="cant"]').value='1';
    };
    llenar(fila,'Vacas');
    fila.querySelector('[data-vp="caravana"]').value='1234';
    click(A,doc.getElementById('f-confirmar'));
    const error=doc.getElementById('vec-error');
    chequear('caravana corta: error visible dentro del formulario, sin cartel ni evento', !!error && !error.hidden && /8 dígitos/.test(error.textContent) && aviso.hidden && st.colaSync.length===0);
    fila.querySelector('[data-vp="caravana"]').value='';
    click(A,doc.getElementById('vec-agregar-fila'));
    llenar(doc.querySelectorAll('.vec-fila')[1],'Terneros');
    let aperturas=0;
    const observer=new A.MutationObserver(ms=>{aperturas+=ms.filter(m=>m.attributeName==='hidden' && m.oldValue!==null).length;});
    observer.observe(aviso,{attributes:true,attributeOldValue:true});
    click(A,doc.getElementById('f-confirmar'));
    await Promise.resolve();
    chequear('dos categorías: dos eventos y un solo cartel de Evento guardado', st.colaSync.length===2 && !aviso.hidden && /Evento guardado/.test(aviso.textContent) && aperturas===1 && doc.querySelectorAll('#aviso-guardado').length===1);
    chequear('validación correcta limpia el error', error.hidden && error.textContent==='');
    observer.disconnect();
    click(A,aviso);
    chequear('se cierra al tocarlo',aviso.hidden);
    A.__sel(nombre);
    click(A,doc.querySelector('[data-accion="muerte"]'));
    doc.getElementById('f-cat').value='Vacas';
    doc.getElementById('f-dueno').value=dueno;
    doc.getElementById('f-cant').value='1';
    click(A,doc.getElementById('f-confirmar'));
    chequear('Muerte válida también muestra el cartel',!aviso.hidden && st.colaSync.some(e=>e.tipo==='muerte'));
    click(A,aviso);
    await A.enviarEvento('punto_creado',nombre,{id:'silencioso'},undefined,{silencioso:true});
    chequear('envío silencioso no muestra cartel',aviso.hidden);
    await A.guardarSanidadCarga({id:crypto.randomUUID()},{silencioso:true});
    chequear('reintento de Sanidad silencioso no muestra cartel',aviso.hidden);
    await A.guardarSanidadCarga({id:crypto.randomUUID()});
    chequear('tratamiento encolado muestra el cartel',!aviso.hidden);
    click(A,aviso);
    // Aceleramos solo el plazo de ocultación del cartel para comprobar el vencimiento sin esperar 2,5s.
    const setTimeoutReal=A.setTimeout.bind(A);
    let plazo;
    A.setTimeout=(fn,ms)=>{plazo=ms; return setTimeoutReal(fn,0);};
    A.avisarEventoGuardado();
    await new Promise(resolve=>setTimeout(resolve,15));
    chequear('se oculta automáticamente con plazo de 2500 ms',plazo===2500 && aviso.hidden);
    A.setTimeout=setTimeoutReal;
    A.eval("Storage.prototype.setItem = ()=>{ throw new Error('cuota de prueba'); }; guardarEstado();");
    A.avisarEventoGuardado();
    chequear('no confirma guardado si falla el almacenamiento local',aviso.hidden);
  }finally{A.close();}
}
(async()=>{
  const archivos=process.argv.slice(2);
  if(!archivos.length) throw new Error('Indicar los index.html a probar');
  for(const archivo of archivos){try{await probarAvisos(archivo);}catch(e){chequear(archivo,false,e.stack);}}
  console.log(fallas ? fallas+' verificaciones fallaron' : 'Todo OK');
  process.exit(fallas?1:0);
})();
