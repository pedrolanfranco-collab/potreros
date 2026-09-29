/*
 * Prueba ad-hoc: reglas de cálculo de Sanidad confirmadas por Pedro
 * (18/9/2026), que reemplazan el cálculo que hacía el Excel -- código
 * COMPARTIDO por las 3 apps (La Vuelta, María Laura, Pone Chico), no
 * depende de si el establecimiento tiene puente a Excel o no.
 *
 * Regla 1 (Apto desde): fecha + T espera (dias_retiro) del producto usado,
 * aplica a TODOS los productos. Si el tratamiento tiene producto1 Y
 * producto2, toma el MÁXIMO de los dos (igual que la fórmula real del
 * Excel, que hace MAX(VLOOKUP(producto1), VLOOKUP(producto2))).
 *
 * Regla 2 (Próximo tratamiento): fecha + T_Residual (dias_residual),
 * SOLO si el producto es categoría "Garrapata" -- ningún otro producto
 * genera este aviso. Igual que la regla 1, toma el máximo si hay dos
 * garrapaticidas en el mismo tratamiento.
 *
 * Costo: suma de cada producto por separado (valor_dosis_ml x dosis x
 * cantidad), no el máximo -- así lo hacía ya el Excel (Valor dosis 1 +
 * Valor dosis 2 = TOTAL).
 *
 * "No aptos" en el panel Sanidad recorre una ventana ancha (260 días), no
 * solo "los últimos 20" -- un tratamiento con T espera largo (ej. Carbazol,
 * 213 días) puede seguir "No apto" mucho después de salir de los últimos
 * registros.
 *
 * 29/9/2026, pedido de Pedro: las 3 secciones (Últimos/No aptos/Próximos)
 * quedan detrás de un <details> colapsable, cerrado por defecto, con la
 * cantidad en el resumen. "Últimos tratamientos" sigue topeado a 20 (los
 * de carga más reciente). "Próximos tratamientos" DEJA de ser un tope de
 * 20 -- pasa a filtrar por antelación real: solo entran los que todavía
 * tienen MÁS de 20 días para cumplir (`-diasDesde(proximo) > 20`), sin
 * límite de cantidad (ver probarProximosPorAntelacion).
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

function crearServidor(catalogo, cargas, opts){
  const filas = { productos_catalogo: catalogo.slice(), sanidad_carga: [], sanidad_carga_maria_laura: [], sanidad_carga_pone_chico: [] };
  Object.keys(cargas||{}).forEach(tabla=>{ filas[tabla] = cargas[tabla].slice(); });
  // 18/9/2026: simula productos_catalogo ANTES de correr el ALTER TABLE --
  // pedir "dias_residual" tiene que dar el mismo error real de Postgres
  // (42703, "column does not exist"), para probar que la app reintenta sin
  // esa columna en vez de perder todo el catálogo.
  const sinDiasResidual = !!(opts && opts.sinDiasResidual);
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _cols: '',
          insert(obj){ (filas[tabla]=filas[tabla]||[]).push(Object.assign({},obj)); return Promise.resolve({error:null}); },
          select(cols){ q._cols = cols||''; return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
          gte(col,val){ q._filtros.push(r=>r[col]>=val); return q; },
          order(){ return q; }, limit(){ return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          then(res){
            if(tabla==='productos_catalogo' && sinDiasResidual && q._cols.includes('dias_residual')){
              return Promise.resolve(res({data:null, error:{code:'42703', message:'column productos_catalogo.dias_residual does not exist'}}));
            }
            const data=(filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r)));
            return Promise.resolve(res({data,error:null}));
          }
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
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try{
    win.eval(codigo +
      '\n;window.__tablaSanidad = (typeof TABLA_SANIDAD!=="undefined") ? TABLA_SANIDAD : "sanidad_carga";' +
      '\n;window.__calcularAptoDesde = calcularAptoDesde;' +
      '\n;window.__calcularCostoTratamiento = calcularCostoTratamiento;' +
      '\n;window.__calcularProximoTratamiento = calcularProximoTratamiento;' +
      '\n;window.__cargarCatalogoProductos = cargarCatalogoProductos;' +
      '\n;window.__cargarSanidad = cargarSanidad;' +
      '\n;window.__fechaISOHoy = fechaISOHoy;' +
      '\n;window.__sumarDiasISO = sumarDiasISO;' +
      '\n;window.__est = function(){ return estado; };');
  }catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

// Catálogo compartido de prueba: un garrapaticida (Altis, T espera 30, T
// residual 45) y un antiparasitario sin poder residual (Ricoverm, T espera
// 14, sin dias_residual -- no genera "próximo tratamiento" nunca).
const CATALOGO = [
  {producto:'Altis', categoria:'Garrapata', dias_retiro:30, dias_residual:45, valor_dosis_ml:0.10},
  {producto:'Aspersin', categoria:'Garrapata', dias_retiro:70, dias_residual:60, valor_dosis_ml:0.0356},
  {producto:'Ricoverm', categoria:'Parásitos internos', dias_retiro:14, dias_residual:null, valor_dosis_ml:0.05},
  // Categoría real en producción para EON, Cydectin, MEXIVER, Ivermectina R:
  // "Garrapata / Parásitos" (doble acción), NO "Garrapata" a secas -- la
  // regla tiene que reconocerlos igual como garrapaticidas.
  {producto:'EON', categoria:'Garrapata / Parásitos', dias_retiro:122, dias_residual:45, valor_dosis_ml:0.074},
];

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor(CATALOGO);
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  await win.__cargarCatalogoProductos();
  const hoy = win.__fechaISOHoy();
  const hace10 = win.__sumarDiasISO(hoy, -10);
  const hace100 = win.__sumarDiasISO(hoy, -100);

  // --- Regla 1: Apto desde toma el MÁXIMO entre producto1 y producto2 ---
  chequear('un solo producto (Ricoverm, T espera 14): apto desde = fecha+14',
    win.__calcularAptoDesde(hace10, 'Ricoverm', null) === win.__sumarDiasISO(hace10, 14));
  chequear('dos productos (Ricoverm 14 + Altis 30): apto desde toma el MÁXIMO (30), no el primero',
    win.__calcularAptoDesde(hace10, 'Ricoverm', 'Altis') === win.__sumarDiasISO(hace10, 30));
  chequear('producto sin catálogo (texto libre): apto desde da null (degrada, no rompe)',
    win.__calcularAptoDesde(hace10, 'Producto inventado', null) === null);

  // --- Costo: SUMA de los dos productos, no el máximo ---
  const costoEsperado = 0.05*2*10 + 0.10*1*10; // Ricoverm 2ml + Altis 1ml, 10 animales
  chequear('costo con dos productos es la SUMA (Ricoverm+Altis), no el máximo',
    Math.abs(win.__calcularCostoTratamiento('Ricoverm', 2, 'Altis', 1, 10) - costoEsperado) < 0.001,
    win.__calcularCostoTratamiento('Ricoverm', 2, 'Altis', 1, 10));

  // --- Regla 2: Próximo tratamiento SOLO para garrapaticidas ---
  chequear('Ricoverm solo (sin T_Residual): NO genera próximo tratamiento',
    win.__calcularProximoTratamiento(hace10, 'Ricoverm', null) === null);
  chequear('Altis (Garrapata, T_Residual 45): SÍ genera próximo tratamiento = fecha+45',
    win.__calcularProximoTratamiento(hace10, 'Altis', null) === win.__sumarDiasISO(hace10, 45));
  chequear('Ricoverm + Altis juntos: el próximo tratamiento sale del garrapaticida (Altis), ignora Ricoverm',
    win.__calcularProximoTratamiento(hace10, 'Ricoverm', 'Altis') === win.__sumarDiasISO(hace10, 45));
  chequear('Altis + Aspersin (dos garrapaticidas, T_Residual 45 y 60): toma el MÁXIMO (60)',
    win.__calcularProximoTratamiento(hace10, 'Altis', 'Aspersin') === win.__sumarDiasISO(hace10, 60));
  chequear('EON (categoría real "Garrapata / Parásitos", no "Garrapata" a secas): SÍ genera próximo tratamiento',
    win.__calcularProximoTratamiento(hace10, 'EON', null) === win.__sumarDiasISO(hace10, 45));

  // --- Panel: "No aptos" y "Próximos tratamientos", ventana ancha (no solo
  // los últimos 20) ---
  const tablaSanidad = win.__tablaSanidad;
  const registroPotrero = (tablaSanidad === 'sanidad_carga') ? {potrero:'21'} : {potrero:'21', dueno:null};
  servidor.filas[tablaSanidad] = [
    // Cargado hace 10 días con Altis (T espera 30): sigue NO apto hoy, y
    // tiene "próximo tratamiento" pendiente (garrapaticida).
    Object.assign({id:'t1', fecha:hace10, categoria:'Vacas', cantidad:5, producto1:'Altis', dosis1:1}, registroPotrero),
    // Cargado hace 100 días con Ricoverm (T espera 14): ya está Apto hace
    // rato, y no genera próximo tratamiento (no es garrapaticida).
    Object.assign({id:'t2', fecha:hace100, categoria:'Toros', cantidad:3, producto1:'Ricoverm', dosis1:2}, registroPotrero),
  ];
  await win.__cargarSanidad();
  const listaHtml = doc.getElementById('sanidad-lista').innerHTML;

  chequear('"No aptos" incluye el tratamiento con Altis (todavía dentro del T espera)',
    (()=>{ const seccion = listaHtml.split('No aptos')[1].split('Próximos')[0]; return seccion.includes('Altis'); })(),
    listaHtml);
  chequear('"No aptos" NO incluye el tratamiento con Ricoverm (T espera ya pasó hace 86 días)',
    (()=>{ const seccion = listaHtml.split('No aptos')[1].split('Próximos')[0]; return !seccion.includes('Ricoverm'); })(),
    listaHtml);
  chequear('"Próximos tratamientos" incluye el de Altis (garrapaticida)',
    (()=>{ const seccion = listaHtml.split('Próximos tratamientos')[1]||''; return seccion.includes('Altis'); })(),
    listaHtml);
  chequear('"Próximos tratamientos" NO incluye el de Ricoverm (no es garrapaticida)',
    (()=>{ const seccion = listaHtml.split('Próximos tratamientos')[1]||''; return !seccion.includes('Ricoverm'); })(),
    listaHtml);
  chequear('el tratamiento de hace 100 días sigue apareciendo (ventana de 260 días, no "los últimos 20")',
    listaHtml.includes('Ricoverm'), listaHtml);

  // --- 29/9/2026, pedido de Pedro: las 3 secciones detrás de un <details>
  // cerrado por defecto, con la cantidad en el resumen ---
  chequear('"No aptos" vive dentro de un <details> (botón para verlo, no siempre visible)',
    /<details[^>]*><summary[^>]*>🚫 No aptos \(\d+\)<\/summary>/.test(listaHtml), listaHtml);
  chequear('"No aptos" arranca cerrado (sin el atributo open)',
    !/<details[^>]*\bopen\b[^>]*>🚫 No aptos/.test(listaHtml), listaHtml);
  chequear('el resumen de "No aptos" muestra la cantidad real (1: solo Altis sigue no apto)',
    listaHtml.includes('🚫 No aptos (1)'), listaHtml);
  chequear('"Últimos tratamientos" también vive dentro de un <details>, cerrado',
    /<details[^>]*><summary[^>]*>Últimos tratamientos \(\d+\)<\/summary>/.test(listaHtml) &&
    !/<details[^>]*\bopen\b[^>]*><summary[^>]*>Últimos tratamientos/.test(listaHtml), listaHtml);
  chequear('el resumen de "Últimos tratamientos" muestra 2 (t1 + t2)',
    listaHtml.includes('Últimos tratamientos (2)'), listaHtml);
  chequear('"Próximos tratamientos" también vive dentro de un <details>, cerrado',
    /<details[^>]*><summary[^>]*>🔁 Próximos tratamientos \(garrapaticidas\) \(\d+\)<\/summary>/.test(listaHtml) &&
    !/<details[^>]*\bopen\b[^>]*><summary[^>]*>🔁 Próximos/.test(listaHtml), listaHtml);
}

/* 29/9/2026, pedido de Pedro: "Últimos tratamientos" sigue topeado a 20
   (los de carga más reciente); "Próximos tratamientos" DEJA de tener tope
   de cantidad -- pasa a filtrar por antelación real, solo entran los que
   todavía tienen MÁS de 20 días para cumplir (`-diasDesde(proximo) > 20`).
   Con Altis (T_Residual 45): próximo = fecha + 45, así que "días que
   faltan" = 45 - (días desde que se cargó). Se arma el caso límite exacto
   -- una carga de hace 25 días da "faltan 20" (NO entra, no es "más de
   20"), una de hace 24 días da "faltan 21" (SÍ entra) -- para confirmar
   que el corte es estrictamente ">20", no ">=20". */
async function probarUltimosTope20(archivo){
  console.log('\n=== ' + archivo + ' (Últimos tratamientos: tope de 20) ===');
  const servidor = crearServidor(CATALOGO);
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  await win.__cargarCatalogoProductos();
  const doc = win.document;
  const hoy = win.__fechaISOHoy();
  const tablaSanidad = win.__tablaSanidad;
  const registroPotrero = (tablaSanidad === 'sanidad_carga') ? {potrero:'21'} : {potrero:'21', dueno:null};

  const fechas = [];
  const filas = [];
  for(let i=1; i<=25; i++){
    const f = win.__sumarDiasISO(hoy, -i);
    fechas.push(f);
    // Ricoverm (sin T_Residual) -- no interfiere con "Próximos", solo se
    // usa acá para probar el tope de "Últimos tratamientos".
    filas.push(Object.assign({id:'v'+i, fecha:f, categoria:'Vacas', cantidad:1, producto1:'Ricoverm', dosis1:1}, registroPotrero));
  }
  servidor.filas[tablaSanidad] = filas;
  await win.__cargarSanidad();
  const listaHtml = doc.getElementById('sanidad-lista').innerHTML;
  const seccionUltimos = listaHtml.split('Últimos tratamientos')[1].split('No aptos')[0];
  const contarTarjetas = (html)=> (html.match(/class="potrero-card"/g)||[]).length;

  chequear('Últimos tratamientos: exactamente 20 tarjetas (de 25 cargadas)',
    contarTarjetas(seccionUltimos) === 20, contarTarjetas(seccionUltimos));
  chequear('el resumen dice "Últimos tratamientos (20)"', listaHtml.includes('Últimos tratamientos (20)'), listaHtml);
  chequear('Últimos tratamientos: incluye el más reciente (hace1)', seccionUltimos.includes(fechas[0]));
  chequear('Últimos tratamientos: incluye el 20° (hace20)', seccionUltimos.includes(fechas[19]));
  chequear('Últimos tratamientos: NO incluye el 21° (hace21, quedó afuera del tope)', !seccionUltimos.includes(fechas[20]));
  chequear('Últimos tratamientos: NO incluye el más viejo (hace25)', !seccionUltimos.includes(fechas[24]));
}

async function probarProximosPorAntelacion(archivo){
  console.log('\n=== ' + archivo + ' (Próximos tratamientos: más de 20 días de antelación) ===');
  const servidor = crearServidor(CATALOGO);
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  await win.__cargarCatalogoProductos();
  const doc = win.document;
  const hoy = win.__fechaISOHoy();
  const tablaSanidad = win.__tablaSanidad;
  const registroPotrero = (tablaSanidad === 'sanidad_carga') ? {potrero:'21'} : {potrero:'21', dueno:null};

  const hace25 = win.__sumarDiasISO(hoy, -25); // próximo = hoy+20 (faltan 20, límite exacto -- NO entra)
  const hace24 = win.__sumarDiasISO(hoy, -24); // próximo = hoy+21 (faltan 21 -- SÍ entra)
  const hace1 = win.__sumarDiasISO(hoy, -1);   // próximo = hoy+44 (faltan 44 -- SÍ entra, bien lejos)
  servidor.filas[tablaSanidad] = [
    Object.assign({id:'limite20', fecha:hace25, categoria:'Vacas', cantidad:1, producto1:'Altis', dosis1:1}, registroPotrero),
    Object.assign({id:'limite21', fecha:hace24, categoria:'Vacas', cantidad:1, producto1:'Altis', dosis1:1}, registroPotrero),
    Object.assign({id:'lejos44', fecha:hace1, categoria:'Vacas', cantidad:1, producto1:'Altis', dosis1:1}, registroPotrero),
  ];
  await win.__cargarSanidad();
  const listaHtml = doc.getElementById('sanidad-lista').innerHTML;
  const seccionProximos = listaHtml.split('🔁 Próximos tratamientos')[1] || '';
  const contarTarjetas = (html)=> (html.match(/class="potrero-card"/g)||[]).length;

  chequear('Próximos tratamientos: exactamente 2 (limite20 queda afuera, faltan justo 20 días, no "más de 20")',
    contarTarjetas(seccionProximos) === 2, contarTarjetas(seccionProximos));
  chequear('el resumen dice "(2)"', listaHtml.includes('Próximos tratamientos (garrapaticidas) (2)'), listaHtml);
  chequear('Próximos tratamientos: NO incluye el de exactamente 20 días de antelación',
    !seccionProximos.includes(hace25), seccionProximos);
  chequear('Próximos tratamientos: SÍ incluye el de 21 días de antelación',
    seccionProximos.includes(hace24), seccionProximos);
  chequear('Próximos tratamientos: SÍ incluye el de 44 días de antelación',
    seccionProximos.includes(hace1), seccionProximos);
  chequear('Próximos tratamientos: ordenados por vencimiento más cercano primero (21 días antes que 44 días)',
    seccionProximos.indexOf(hace24) < seccionProximos.indexOf(hace1), seccionProximos);
}

/* 29/9/2026, pedido de Pedro: botón "✓ Hecho, ya se trató" en cada tarjeta
   de "Próximos tratamientos" -- marca ese tratamiento como efectuado (por
   `id`, sin tocar sanidad_carga/eventos de stock) y lo saca de la lista.
   Sincronizado por eventos_sync (tipo proximo_confirmado), mismo criterio
   "sin potrero real" que aborto/señalada -- otro dispositivo lo tiene que
   aplicar igual al sincronizar, sin tener el tratamiento cargado a mano. */
async function probarConfirmarProximo(archivo){
  console.log('\n=== ' + archivo + ' (Próximos tratamientos: botón "✓ Hecho") ===');
  const servidor = crearServidor(CATALOGO);
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  await win.__cargarCatalogoProductos();
  const doc = win.document;
  const hoy = win.__fechaISOHoy();
  const tablaSanidad = win.__tablaSanidad;
  const registroPotrero = (tablaSanidad === 'sanidad_carga') ? {potrero:'21'} : {potrero:'21', dueno:null};
  const hace30 = win.__sumarDiasISO(hoy, -30); // próximo = hoy+15 -> NO entra (no tiene >20 días)
  const hace10 = win.__sumarDiasISO(hoy, -10); // próximo = hoy+35 -> SÍ entra

  servidor.filas[tablaSanidad] = [
    Object.assign({id:'confirmar1', fecha:hace10, categoria:'Vacas', cantidad:1, producto1:'Altis', dosis1:1}, registroPotrero),
    Object.assign({id:'cancelar1', fecha:hace10, categoria:'Toros', cantidad:1, producto1:'Altis', dosis1:1}, registroPotrero),
  ];
  await win.__cargarSanidad();
  chequear('estado.proximosConfirmados arranca vacío', Array.isArray(win.__est().proximosConfirmados) && win.__est().proximosConfirmados.length===0);

  let listaHtml = doc.getElementById('sanidad-lista').innerHTML;
  chequear('el botón "✓ Hecho" aparece con el id del tratamiento',
    !!doc.querySelector('[data-proximo-confirmar="confirmar1"]'), listaHtml);
  chequear('antes de confirmar, el resumen de Próximos dice "(2)"',
    listaHtml.includes('Próximos tratamientos (garrapaticidas) (2)'), listaHtml);

  // --- 29/9/2026, pedido de Pedro: pide confirmación antes de marcar (un
  // toque accidental no puede sacarlo de la lista sin querer) -- si el
  // usuario cancela el confirm(), no pasa nada ---
  win.confirm = () => false;
  doc.querySelector('[data-proximo-confirmar="cancelar1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('cancelar la confirmación NO agrega el id', !win.__est().proximosConfirmados.includes('cancelar1'), win.__est().proximosConfirmados);
  listaHtml = doc.getElementById('sanidad-lista').innerHTML;
  chequear('cancelar la confirmación NO lo saca de la lista (sigue el botón)',
    !!doc.querySelector('[data-proximo-confirmar="cancelar1"]'), listaHtml);
  await new Promise(r=>setTimeout(r, 30));
  chequear('cancelar la confirmación NO manda ningún evento a Supabase',
    !(servidor.filas.eventos_sync||[]).some(f=>f.tipo==='proximo_confirmado' && f.detalle && f.detalle.id==='cancelar1'));

  win.confirm = () => true;
  doc.querySelector('[data-proximo-confirmar="confirmar1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('confirmar agrega el id a estado.proximosConfirmados', win.__est().proximosConfirmados.includes('confirmar1'), win.__est().proximosConfirmados);

  listaHtml = doc.getElementById('sanidad-lista').innerHTML;
  chequear('tras confirmar, "Próximos tratamientos" queda con 1 (cancelar1 sigue, confirmar1 salió)',
    listaHtml.includes('Próximos tratamientos (garrapaticidas) (1)'), listaHtml);
  chequear('tras confirmar, ya no queda el botón de ese id', !doc.querySelector('[data-proximo-confirmar="confirmar1"]'), listaHtml);
  chequear('el otro (cancelado) sigue con su botón intacto', !!doc.querySelector('[data-proximo-confirmar="cancelar1"]'), listaHtml);

  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó el evento proximo_confirmado a Supabase',
    servidor.filas.eventos_sync && servidor.filas.eventos_sync.some(f=>f.tipo==='proximo_confirmado' && f.detalle && f.detalle.id==='confirmar1'));

  // --- otro dispositivo, sin el tratamiento cargado a mano, tiene que
  // aplicar la confirmación igual al sincronizar ---
  win.__est().proximosConfirmados.length = 0;
  win.aplicarEventoRemoto({ tipo:'proximo_confirmado', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle: { id:'remoto1' } });
  chequear('un evento remoto de proximo_confirmado se aplica sin requerir un potrero válido ni el tratamiento cargado',
    win.__est().proximosConfirmados.includes('remoto1'));

  // --- no duplica si llega el mismo id de nuevo ---
  const antesDeRepetir = win.__est().proximosConfirmados.length;
  win.aplicarEventoRemoto({ tipo:'proximo_confirmado', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle: { id:'remoto1' } });
  chequear('no duplica un evento de proximo_confirmado con el mismo id', win.__est().proximosConfirmados.length === antesDeRepetir);

  // --- un tratamiento con MENOS de 20 días de antelación nunca aparece en
  // Próximos, así que no necesita botón "✓ Hecho" ---
  servidor.filas[tablaSanidad] = [
    Object.assign({id:'noaplica', fecha:hace30, categoria:'Vacas', cantidad:1, producto1:'Altis', dosis1:1}, registroPotrero),
  ];
  await win.__cargarSanidad();
  chequear('un tratamiento sin más de 20 días de antelación no aparece (ni con botón) en Próximos',
    !doc.querySelector('[data-proximo-confirmar="noaplica"]'));
}

/* 18/9/2026: antes de que Pedro corra el ALTER TABLE en Supabase, pedir
   "dias_residual" en el select() de productos_catalogo da un error real de
   Postgres (42703, columna inexistente). Sin el reintento, ESO tumbaba todo
   el catálogo -- ni "Apto desde" ni costo calculaban, no solo "Próximo
   tratamiento". Este test prueba justo esa reconstrucción del incidente. */
async function probarFallbackColumnaFaltante(archivo){
  console.log('\n=== ' + archivo + ' (sin dias_residual todavía en Supabase) ===');
  const servidor = crearServidor(CATALOGO.map(p=>{ const {dias_residual, ...resto} = p; return resto; }), null, {sinDiasResidual:true});
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  await win.__cargarCatalogoProductos();
  const hoy = win.__fechaISOHoy();
  chequear('el catálogo carga igual reintentando sin dias_residual (no queda vacío)',
    win.__calcularAptoDesde(hoy, 'Ricoverm', null) === win.__sumarDiasISO(hoy, 14));
  chequear('"Próximo tratamiento" degrada a null sin romper (la columna todavía no existe)',
    win.__calcularProximoTratamiento(hoy, 'Altis', null) === null);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  for(const a of archivos) await probarFallbackColumnaFaltante(a);
  for(const a of archivos) await probarUltimosTope20(a);
  for(const a of archivos) await probarProximosPorAntelacion(a);
  for(const a of archivos) await probarConfirmarProximo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
