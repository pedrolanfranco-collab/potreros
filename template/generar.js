/*
 * generar.js — genera los 6 archivos (3 establecimientos × PC/móvil) a partir
 * de potreros.template.html + configs/*.js.
 *
 * Uso:
 *   node template/generar.js            escribe los 6 archivos (OneDrive + repo)
 *   node template/generar.js --check    no escribe nada; sale con código 1 si
 *                                        lo que generaría no coincide con lo
 *                                        que ya está en el repo (detecta un
 *                                        index.html tocado a mano en vez del
 *                                        template).
 *
 * Cada establecimiento tiene su config en configs/<nombre>.js. El template usa
 * dos mecanismos:
 *   - Marcadores por comentario (@nombre:start / @nombre:end, HTML o JS) que
 *     este script agrega o quita según la lista de "activos" de cada
 *     generación -- inmune a que el archivo crezca (a diferencia del recorte
 *     por rango de línea que se abandonó antes de este template).
 *   - CONFIG.<campo> en vez de literales -- una sola línea
 *     "const CONFIG = {...};" inyectada al toque, con placeholders __X__ para
 *     lo que no puede vivir dentro del objeto JS (título de la página, meta
 *     theme-color, etc).
 */
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'potreros.template.html');
// Los overrides por variable de entorno son solo para probar el generador
// contra una carpeta descartable antes de tocar los archivos reales.
const ONEDRIVE_DIR = process.env.POTREROS_ONEDRIVE_DIR || 'C:\\Users\\Pedro\\OneDrive\\Proyecto Gestion ganadera';
const REPO_DIR = process.env.POTREROS_REPO_DIR || path.join(__dirname, '..');

const ESTABLECIMIENTOS = [
  {
    nombre: 'la-vuelta',
    config: require('./configs/la-vuelta.js'),
    onedrive: { pc: 'potreros_la_vuelta_pc.html', movil: 'potreros_la_vuelta_movil.html' },
    repoDir: { pc: 'la-vuelta-pc', movil: 'la-vuelta-movil' },
  },
  {
    nombre: 'maria-laura',
    config: require('./configs/maria-laura.js'),
    onedrive: { pc: 'maria_laura_pc.html', movil: 'maria_laura_movil.html' },
    repoDir: { pc: 'maria-laura-pc', movil: 'maria-laura-movil' },
  },
  {
    nombre: 'pone-chico',
    config: require('./configs/pone-chico.js'),
    onedrive: { pc: 'pone_chico_pc.html', movil: 'pone_chico_movil.html' },
    repoDir: { pc: 'pone-chico-pc', movil: 'pone-chico-movil' },
  },
];

const CABECERA_GENERADO = '<!-- ARCHIVO GENERADO por template/generar.js -- no editar a mano. Editar template/potreros.template.html o template/configs/*.js y correr `node template/generar.js`. -->\n';

function stripMarkers(text, activos) {
  const nombres = new Set();
  const re = /(?:<!--|\/\/)\s*@(\w+):start/g;
  let m;
  while ((m = re.exec(text))) nombres.add(m[1]);

  for (const nombre of nombres) {
    const bloqueHtml = new RegExp(`<!-- @${nombre}:start -->\\n[\\s\\S]*?<!-- @${nombre}:end -->\\n`, 'g');
    const bloqueJs = new RegExp(`([ \\t]*)// @${nombre}:start\\n[\\s\\S]*?\\1// @${nombre}:end\\n`, 'g');
    if (activos.includes(nombre)) {
      text = text.replace(new RegExp(`<!-- @${nombre}:start -->\\n`, 'g'), '');
      text = text.replace(new RegExp(`<!-- @${nombre}:end -->\\n`, 'g'), '');
      text = text.replace(new RegExp(`([ \\t]*)// @${nombre}:start\\n`, 'g'), '');
      text = text.replace(new RegExp(`([ \\t]*)// @${nombre}:end\\n`, 'g'), '');
    } else {
      text = text.replace(bloqueHtml, '');
      text = text.replace(bloqueJs, '');
    }
  }
  return text;
}

function generar(templateText, config, variant) {
  const activos = [variant];
  activos.push(config.mapLabels ? 'mapLabels' : 'noMapLabels');
  activos.push(config.usaExcelBridge ? 'sanidadExcel' : 'sanidadNativa');
  activos.push(config.duenoObligatorio ? 'duenoVoz' : 'sinDuenoVoz');

  let texto = stripMarkers(templateText, activos);

  const configJson = JSON.stringify(config);
  texto = texto.replace('<script>\n', `<script>\nconst CONFIG = ${configJson};\n`);

  texto = texto.replace('__TITULO__', config.titulo);
  texto = texto.replace('__THEME_COLOR__', config.themeColor);
  texto = texto.replace('__NOMBRE__', config.nombre);
  texto = texto.replace('__SUBTITULO__', config.subtitulo);
  texto = texto.replace(variant === 'pc' ? '__VERSION_PC__' : '__VERSION_MOVIL__', variant === 'pc' ? config.versionPc : config.versionMovil);

  texto = texto.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${CABECERA_GENERADO}`);

  return texto;
}

function main() {
  const check = process.argv.includes('--check');
  // Los 6 archivos reales usan fin de línea CRLF (Windows). Se normaliza a LF
  // para que los marcadores (que buscan "\n") funcionen sin importar el CRLF,
  // y se vuelve a CRLF recién al escribir -- mismo patrón que el modo texto
  // de Python (universal newlines) usado para armar este template.
  const templateText = fs.readFileSync(TEMPLATE_PATH, 'utf-8').replace(/\r\n/g, '\n');

  let algunoDistinto = false;

  for (const est of ESTABLECIMIENTOS) {
    for (const variant of ['pc', 'movil']) {
      const salida = generar(templateText, est.config, variant).replace(/\n/g, '\r\n');
      const repoPath = path.join(REPO_DIR, est.repoDir[variant], 'index.html');
      const onedrivePath = path.join(ONEDRIVE_DIR, est.onedrive[variant]);

      if (check) {
        const actual = fs.existsSync(repoPath) ? fs.readFileSync(repoPath, 'utf-8') : null;
        if (actual !== salida) {
          algunoDistinto = true;
          console.error(`DISTINTO: ${repoPath} no coincide con lo que generaría el template.`);
        } else {
          console.log(`OK: ${repoPath}`);
        }
      } else {
        fs.writeFileSync(repoPath, salida, 'utf-8');
        console.log(`escrito: ${repoPath} (${salida.length} caracteres)`);
        fs.writeFileSync(onedrivePath, salida, 'utf-8');
        console.log(`escrito: ${onedrivePath} (${salida.length} caracteres)`);
      }
    }
  }

  if (check && algunoDistinto) {
    console.error('\n--check encontró diferencias -- algún index.html se editó a mano en vez de tocar el template, o el template cambió sin regenerar.');
    process.exit(1);
  }
}

main();
