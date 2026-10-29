/*
 * Instructivo de Campo (29/10/2026, a pedido de Pedro): instructivo-campo/index.html es una página escrita a mano
 * (no generada) con TODAS las funciones de la app Campo. Esta prueba hace fallar el CI cuando la página se
 * queda atrás de la app:
 *   1. cada botón de Campo (los `id="btn-..."` y los `data-accion` de la ficha y del cartel de "trabados",
 *      más los botones de las ventanas Desaparecidos y Vecinos) tiene que figurar, con su emoji, en la página;
 *   2. las versiones anotadas en "Actualizado para" coinciden con `versionMovilSimple` de los 3 configs;
 *   3. cada `href="#x"` de la página tiene su `id="x"` (y no hay ids repetidos);
 *   4. el botón "📖 Instructivo" está en las 3 Campo y NO en la PC ni en la móvil completa, y el sw.js de las
 *      3 Campo precarga '../instructivo-campo/'.
 * Y que la página siga siendo liviana y sin red: sin scripts, sin enlaces externos, con modo oscuro y viewport.
 * Los textos con una parte que cambia ("☀ Modo sol: NO", "🛰 Satelital: ON") se comparan por su parte fija.
 * Uso: node tests/probar_instructivo_campo.js   (sin argumentos; lee las carpetas del repo)
 */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
let fallas = 0;
const chequear = (n, c, d) => { console.log((c ? '  OK  ' : '  MAL ') + n + (c ? '' : ' — ' + (d || ''))); if (!c) fallas++; };
const leer = r => fs.readFileSync(path.join(raiz, r), 'utf8');

const CAMPOS = [
  { id: 'la-vuelta',   dir: 'la-vuelta-movil-campo',   otras: ['la-vuelta-pc', 'la-vuelta-movil'] },
  { id: 'maria-laura', dir: 'maria-laura-movil-campo', otras: ['maria-laura-pc', 'maria-laura-movil'] },
  { id: 'pone-chico',  dir: 'pone-chico-movil-campo',  otras: ['pone-chico-pc', 'pone-chico-movil'] },
];

/* Botones que NO tienen por qué figurar en la página, con el motivo. Mantener corta: un botón nuevo de Campo
   se documenta en el instructivo, no se agrega acá. */
const EXCEPCIONES = {
  'btn-puntos': 'Está en la lista de Herramientas con display:none y ningún código lo muestra en la móvil ni en Campo (solo la PC lo ve).',
  'btn-resync-puntos': 'Igual que btn-puntos: oculto con display:none en la móvil y en Campo, solo lo ve la PC.',
};
/* Oculto en el HTML pero que el código muestra según el config: se exige solo donde está habilitado. */
const OCULTO_POR_CONFIG = { 'btn-caravana': 'caravanasHabilitado' };

const normalizar = t => t.replace(/️/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const sinTags = t => t.replace(/<[^>]*>/g, '');
/* Parte fija de un texto con estado: "☀ Modo sol: NO" -> "☀ Modo sol". */
const parteFija = t => normalizar(t.split(':')[0]);

const pagina = leer('instructivo-campo/index.html');
const textoPagina = normalizar(sinTags(pagina.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<head>[\s\S]*?<\/head>/, '')));

/* Botones de un index.html de Campo: [{id|clave, texto, oculto}] */
function botonesDe(html) {
  const salida = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], crudo = m[2];
    if (crudo.includes('${')) continue;           // texto armado por el código (Guardar / Registrar...): no es una función con nombre fijo
    const texto = normalizar(sinTags(crudo));
    if (!texto) continue;
    const id = (attrs.match(/\bid="(btn-[^"]+)"/) || [])[1];
    const accion = (attrs.match(/\bdata-accion="([^"]+)"/) || [])[1];
    const ventana = (attrs.match(/\b(data-(?:encontrado|perdido|muerte-desap|vecino-desap|vec-accion|vec-agregar-fila))=/) || [])[1];
    if (!id && !accion && !ventana) continue;
    const oculto = /display\s*:\s*none/.test(attrs);
    salida.push({ clave: id || (accion ? 'data-accion=' + accion : ventana), id, texto, oculto });
  }
  return salida;
}

// ---- 1. Todas las funciones de Campo figuran en la página ----
console.log('\n[1] cada botón de Campo figura (con su emoji) en la página');
const requeridos = new Map();   // texto fijo -> quién lo pide
for (const c of CAMPOS) {
  const cfg = require(path.join(raiz, 'template', 'configs', c.id + '.js'));
  const html = leer(c.dir + '/index.html');
  const botones = botonesDe(html);
  chequear(`${c.dir}: se leyeron botones (esperado más de 20)`, botones.length > 20, 'leídos: ' + botones.length);
  for (const b of botones) {
    if (b.id && EXCEPCIONES[b.id]) continue;
    if (b.oculto) {
      const flag = OCULTO_POR_CONFIG[b.id];
      if (!flag) { chequear(`${c.dir}: ${b.clave} está oculto en el HTML y no figura en EXCEPCIONES ni en OCULTO_POR_CONFIG`, false, `"${b.texto}": decidí si se documenta o va a EXCEPCIONES con su motivo`); continue; }
      if (!cfg[flag]) continue;
    }
    const fijo = parteFija(b.texto);
    if (!requeridos.has(fijo)) requeridos.set(fijo, []);
    requeridos.get(fijo).push(`${c.id}:${b.clave}`);
  }
}
/* Con borde de palabra al final: "❓ Desaparecido" (la acción de la ficha) no se da por nombrado por "❓ Desaparecidos" (la ventana). */
const nombra = fijo => new RegExp(normalizar(fijo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u').test(textoPagina);
for (const [fijo, quienes] of requeridos) {
  chequear(`la página nombra "${fijo}"`, nombra(fijo), 'lo piden ' + quienes.join(', '));
}
// las excepciones tienen que seguir existiendo (si no, sobran) y llevar un motivo
for (const id of Object.keys(EXCEPCIONES)) {
  const existe = CAMPOS.every(c => leer(c.dir + '/index.html').includes(`id="${id}"`));
  chequear(`la excepción ${id} sigue existiendo en las 3 Campo (si ya no existe, sacala de EXCEPCIONES)`, existe);
  chequear(`la excepción ${id} tiene motivo`, EXCEPCIONES[id].length > 20);
}

// Las diferencias por campo que la página afirma ("Según tu campo") salen de estos config.
console.log('\n[1b] las diferencias por campo de la página coinciden con los config');
const cfgs = Object.fromEntries(CAMPOS.map(c => [c.id, require(path.join(raiz, 'template', 'configs', c.id + '.js'))]));
const esperado = {
  'la-vuelta':   { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Firma' },
  'maria-laura': { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Dueño' },
  'pone-chico':  { claveCampo: false, caravanasHabilitado: false, duenoLabel: 'Dueño' },
};
for (const id of Object.keys(esperado)) for (const k of Object.keys(esperado[id])) {
  chequear(`config ${id}.${k} = ${esperado[id][k]} (la tabla "Según tu campo" lo da por hecho)`, cfgs[id][k] === esperado[id][k], `hoy: ${cfgs[id][k]}; si cambió, actualizá la tabla y esta prueba`);
}

// ---- 2. Versiones ----
console.log('\n[2] versiones anotadas en "Actualizado para"');
const versionesPagina = {};
for (const m of pagina.matchAll(/data-version="([^"]+)"[^>]*>([^<]*)</g)) versionesPagina[m[1]] = m[2].trim();
chequear('la página anota las versiones de los 3 campos (y no más)', Object.keys(versionesPagina).sort().join() === CAMPOS.map(c => c.id).sort().join(), JSON.stringify(versionesPagina));
for (const c of CAMPOS) {
  const real = cfgs[c.id].versionMovilSimple;
  chequear(`${c.id}: la página dice ${versionesPagina[c.id]} y versionMovilSimple es ${real}`, versionesPagina[c.id] === real,
    `actualizá "Actualizado para" y "Novedades de esta versión" en instructivo-campo/index.html`);
  const html = leer(c.dir + '/index.html');
  chequear(`${c.dir}: el encabezado de la app muestra v${real}`, html.includes(`<div class="sub">v${real}</div>`), 'regenerá con node template/generar.js');
}
chequear('hay una sección "Novedades de esta versión" con al menos un renglón', /id="novedades"[\s\S]*?<li>/.test(pagina));

// ---- 3. Enlaces internos ----
console.log('\n[3] enlaces internos');
const ids = [...pagina.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const repetidos = ids.filter((x, i) => ids.indexOf(x) !== i);
chequear('no hay ids repetidos', repetidos.length === 0, repetidos.join(', '));
const enlaces = [...pagina.matchAll(/\bhref="#([^"]*)"/g)].map(m => m[1]);
chequear('hay enlaces internos (índice)', enlaces.length > 20, 'encontrados: ' + enlaces.length);
const rotos = [...new Set(enlaces.filter(h => !ids.includes(h)))];
chequear('todo href="#x" tiene su id="x"', rotos.length === 0, 'sin destino: ' + rotos.join(', '));

// ---- 4. El botón y el service worker ----
console.log('\n[4] botón 📖 Instructivo y precarga');
for (const c of CAMPOS) {
  const html = leer(c.dir + '/index.html');
  chequear(`${c.dir}: tiene el botón btn-instructivo con su texto`, /<button[^>]*id="btn-instructivo"[^>]*>📖 Instructivo<\/button>/.test(html));
  chequear(`${c.dir}: el botón abre ../instructivo-campo/ en otra pestaña`, html.includes("const url = '../instructivo-campo/'") && html.includes("window.open(url, '_blank')"));
  const sw = leer(c.dir + '/sw.js');
  const lista = (sw.match(/const PRECACHE_URLS = (\[.*?\]);/) || [])[1];
  let urls = [];
  try { urls = JSON.parse(lista); } catch (e) { /* queda vacío y falla abajo */ }
  chequear(`${c.dir}/sw.js: PRECACHE_URLS incluye '../instructivo-campo/'`, urls.includes('../instructivo-campo/'), 'lista: ' + lista);
  chequear(`${c.dir}/sw.js: la instalación precarga de a una (un recurso que falla no la rompe)`, /PRECACHE_URLS\.map\(u => cache\.add\(u\)\.catch\(/.test(sw));
  for (const o of c.otras) {
    chequear(`${o}: NO tiene btn-instructivo (es solo de Campo)`, !leer(o + '/index.html').includes('btn-instructivo'));
    chequear(`${o}/sw.js: no precarga el instructivo`, !leer(o + '/sw.js').includes('instructivo-campo'));
  }
}

// ---- Página liviana, sin red, legible en el celular ----
console.log('\n[5] la página es liviana y no usa red');
chequear('tiene <meta name="viewport">', /<meta name="viewport"[^>]*width=device-width/.test(pagina));
chequear('letra base de 17 px', /body\{[^}]*font:\s*17px/.test(pagina));
chequear('tiene modo oscuro (prefers-color-scheme: dark)', /prefers-color-scheme:\s*dark/.test(pagina));
chequear('sin <script>', !/<script\b/i.test(pagina));
chequear('sin <link> ni librerías externas', !/<link\b/i.test(pagina));
chequear('sin direcciones http(s):// (nada de red)', !/https?:\/\//i.test(pagina), (pagina.match(/https?:\/\/\S+/) || [''])[0]);
chequear('pesa menos de 80 KB', Buffer.byteLength(pagina) < 80 * 1024, Buffer.byteLength(pagina) + ' bytes');

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
