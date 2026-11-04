// Genera tablero-campos/index.html desde tablero-campos/fuente.html + los polígonos de template/configs/*.js.
// Uso (desde la raíz del repo):  node tablero-campos/generar.js          -> escribe index.html
//                                node tablero-campos/generar.js --check  -> falla si index.html está desfasado
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const CONFIGS = { la_vuelta: 'la-vuelta', maria_laura: 'maria-laura', pone_chico: 'pone-chico' };

function construir() {
  const geo = {};
  for (const [campo, archivo] of Object.entries(CONFIGS)) {
    const c = require(path.join(raiz, 'template', 'configs', archivo + '.js'));
    geo[campo] = (c.potrerosGeo || []).map(p => ({ nombre: p.nombre, area: p.area, coords: p.coords }));
  }
  const fuente = fs.readFileSync(path.join(__dirname, 'fuente.html'), 'utf8');
  if (!fuente.includes('/*__GEO__*/{}')) throw new Error('fuente.html no tiene el marcador /*__GEO__*/{}');
  return fuente.replace('/*__GEO__*/{}', () => JSON.stringify(geo).replace(/</g, '\\u003c'));
}

const salida = path.join(__dirname, 'index.html');
const nuevo = construir();
if (process.argv.includes('--check')) {
  const actual = fs.existsSync(salida) ? fs.readFileSync(salida, 'utf8') : '';
  if (actual !== nuevo) { console.error('tablero-campos/index.html desfasado: correr node tablero-campos/generar.js'); process.exit(1); }
  console.log('tablero-campos/index.html al día');
} else {
  fs.writeFileSync(salida, nuevo);
  console.log('escrito', path.relative(raiz, salida), (nuevo.length / 1024).toFixed(0) + ' KB');
}
