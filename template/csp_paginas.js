/*
 * csp_paginas.js — Content-Security-Policy de las páginas hechas a mano (24/11/2026, punto 9 del informe de auditoría).
 *
 * Las 10 apps generadas la reciben de template/generar.js (politicaCsp()). Estas páginas no pasan por el generador,
 * así que la política se calcula acá a partir del HTML de cada una: el hash sha256 de cada <script> en línea, los
 * servidores de sus <script src> y <link rel="stylesheet">, la capa del mapa (L.tileLayer) y el Supabase que usa.
 *
 *   node template/csp_paginas.js           reescribe el <meta> CSP de cada página (lo agrega si no tiene)
 *   node template/csp_paginas.js --check   no escribe; sale con código 1 si alguna página quedó desfasada
 *                                           (primer aviso del CI cuando se edita a mano el <script> de una página)
 *
 * tablero-campos/index.html no está en la lista: lo escribe tablero-campos/generar.js, que usa politica() de acá.
 * Efecto: un <script> o un onclick="..." que se cuele por innerHTML no corre, y nada puede mandar datos a otro
 * servidor con fetch. Un onXXX="..." escrito en el HTML de estas páginas no está permitido: usar addEventListener.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const PAGINAS = [
  'tablero-sanidad/index.html',
  'completar-sanidad/index.html',
  'instructivo-campo/index.html',
  'instructivo-movil/index.html',
  'instructivo-pc/index.html',
];
const META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*">\n/;

function sha256(texto) {
  return 'sha256-' + crypto.createHash('sha256').update(texto, 'utf8').digest('base64');
}
const origen = u => { const x = new URL(u.replace(/&amp;/g, '&').replace(/\{[a-z]\}/g, '0')); return x.protocol + '//' + x.host; };
const unicos = lista => [...new Set(lista)];

function politica(html) {
  const sinMeta = html.replace(META_RE, '');
  const enLinea = [...sinMeta.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'${sha256(m[1])}'`);
  const scriptsAfuera = unicos([...sinMeta.matchAll(/<script src="(https:[^"]+)"/g)].map(m => origen(m[1])));
  const estilosAfuera = unicos([...sinMeta.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)]
    .map(m => (m[0].match(/href="(https:[^"]+)"/) || [])[1]).filter(Boolean).map(origen));
  const capas = unicos([...sinMeta.matchAll(/L\.tileLayer\('(https:[^']+)'/g)].map(m => origen(m[1])));
  const supa = unicos([...sinMeta.matchAll(/https:\/\/[a-z0-9]+\.supabase\.co/g)].map(m => m[0]));
  const usaLeaflet = /<script src="https:[^"]*leaflet/.test(sinMeta);   // los íconos de Leaflet vienen de cdnjs
  const scriptSrc = enLinea.length || scriptsAfuera.length ? ["'self'", ...scriptsAfuera, ...enLinea] : ["'none'"];
  return [
    "default-src 'self'",
    'script-src ' + scriptSrc.join(' '),
    ['style-src', "'self'", "'unsafe-inline'", ...estilosAfuera].join(' '),
    ['img-src', "'self'", 'data:', 'blob:', ...capas, ...(usaLeaflet ? ['https://cdnjs.cloudflare.com'] : []), ...supa].join(' '),
    ['connect-src', "'self'", ...supa].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

// Pone (o reemplaza) el <meta> CSP justo después de <meta charset="UTF-8">.
function conCsp(html) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${politica(html)}">\n`;
  if (META_RE.test(html)) return html.replace(META_RE, meta);
  const charset = html.match(/<meta charset="UTF-8">\n/i);
  if (!charset) throw new Error('no encuentro <meta charset="UTF-8"> para poner la CSP después');
  return html.replace(charset[0], charset[0] + meta);
}

module.exports = { politica, conCsp, sha256 };

if (require.main === module) {
  const check = process.argv.includes('--check');
  let desfasadas = 0;
  for (const rel of PAGINAS) {
    const ruta = path.join(RAIZ, rel);
    const actual = fs.readFileSync(ruta, 'utf8');
    const nuevo = conCsp(actual);
    if (nuevo === actual) { console.log('OK:       ' + rel); continue; }
    desfasadas++;
    if (check) console.error('DISTINTO: ' + rel + ' (la CSP no corresponde a la página: correr node template/csp_paginas.js)');
    else { fs.writeFileSync(ruta, nuevo, 'utf8'); console.log('escrito:  ' + rel); }
  }
  if (check && desfasadas) process.exit(1);
}
