/*
 * sync-skill.js — sincroniza tests/probar_*.js con la copia manual que vive
 * en scripts/ de la skill de Claude "apps-potreros" (no hay symlink porque
 * son dos raíces de filesystem distintas para dos herramientas distintas).
 *
 * Antes de esto (12/9/2026, P1 de la auditoría de 3 IAs) mantener las dos
 * copias iguales dependía de acordarse de tocar los dos lados a mano -- ya
 * se desincronizaron una vez. Ahora es un solo comando.
 *
 * Uso:
 *   node tests/sync-skill.js            copia tests/probar_*.js -> skill,
 *                                        solo los que cambiaron
 *   node tests/sync-skill.js --check    no copia nada; sale con código 1 si
 *                                        hay diferencias (para correr en CI
 *                                        o antes de un commit)
 */
const fs = require('fs');
const path = require('path');

const TESTS_DIR = __dirname;

// Dónde vive la skill depende de cómo se instaló Claude y cambia con las actualizaciones: estuvo en Roaming\Claude, el
// 31/10/2026 pasó a Local\Claude-Data\<id>\local-agent-mode-sessions\skills-plugin\<id>\<id>\skills\..., y el
// 24/11/2026 apareció en Local\Claude-Data\<id>\rpm\<id>\<id>\plugin_<id>\skills\.... Por eso ya no se arma una
// ruta fija: se recorren las dos raíces buscando cualquier carpeta skills\apps-potreros\scripts (hasta 10 niveles,
// salteando las carpetas de caché grandes) y se toma la tocada último. POTREROS_SKILL_SCRIPTS_DIR manda sobre la búsqueda.
const SALTEAR = new Set(['node_modules', 'Cache', 'Code Cache', 'GPUCache', 'IndexedDB', 'Service Worker', 'blob_storage',
  'Crashpad', 'logs', '.git']);
function buscarEn(dir, nivel, candidatas) {
  if (nivel > 10) return;
  let entradas;
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const d of entradas) {
    if (!d.isDirectory() || SALTEAR.has(d.name)) continue;
    const sub = path.join(dir, d.name);
    if (d.name === 'apps-potreros' && path.basename(dir) === 'skills') {
      const scripts = path.join(sub, 'scripts');
      try { candidatas.push({ scripts, mtime: fs.statSync(scripts).mtimeMs }); } catch (e) {}
      continue;
    }
    buscarEn(sub, nivel + 1, candidatas);
  }
}
function buscarCarpetaSkill() {
  if (process.env.POTREROS_SKILL_SCRIPTS_DIR) return process.env.POTREROS_SKILL_SCRIPTS_DIR;
  const raices = [];
  if (process.env.APPDATA) raices.push(path.join(process.env.APPDATA, 'Claude'));
  if (process.env.LOCALAPPDATA) raices.push(path.join(process.env.LOCALAPPDATA, 'Claude-Data'));
  const candidatas = [];
  for (const raiz of raices) buscarEn(raiz, 0, candidatas);
  candidatas.sort((a, b) => b.mtime - a.mtime);
  return candidatas.length ? candidatas[0].scripts : null;
}
const SKILL_SCRIPTS_DIR = buscarCarpetaSkill();

function main() {
  const check = process.argv.includes('--check');

  if (!SKILL_SCRIPTS_DIR || !fs.existsSync(SKILL_SCRIPTS_DIR)) {
    console.error(`No se encontró la carpeta de la skill apps-potreros${SKILL_SCRIPTS_DIR ? ': ' + SKILL_SCRIPTS_DIR : ' (se buscó skills\\apps-potreros\\scripts en Roaming\\Claude y Local\\Claude-Data)'}.`);
    console.error('Si la skill está en otra ruta, pasá POTREROS_SKILL_SCRIPTS_DIR=<ruta> antes del comando.');
    process.exit(1);
  }
  console.log(`Skill: ${SKILL_SCRIPTS_DIR}\n`);

  const archivosTests = fs.readdirSync(TESTS_DIR).filter(f => f.startsWith('probar_') && f.endsWith('.js'));
  const archivosSkill = fs.readdirSync(SKILL_SCRIPTS_DIR).filter(f => f.startsWith('probar_') && f.endsWith('.js'));

  let diferencias = 0;

  for (const archivo of archivosTests) {
    const origen = fs.readFileSync(path.join(TESTS_DIR, archivo), 'utf-8');
    const destinoPath = path.join(SKILL_SCRIPTS_DIR, archivo);
    const destino = fs.existsSync(destinoPath) ? fs.readFileSync(destinoPath, 'utf-8') : null;

    if (destino === origen) {
      console.log(`OK:      ${archivo}`);
      continue;
    }
    diferencias++;
    if (check) {
      console.error(`DISTINTO: ${archivo}${destino === null ? ' (no existe en la skill)' : ''}`);
    } else {
      fs.writeFileSync(destinoPath, origen, 'utf-8');
      console.log(`copiado: ${archivo}${destino === null ? ' (nuevo en la skill)' : ''}`);
    }
  }

  const huerfanos = archivosSkill.filter(f => !archivosTests.includes(f));
  if (huerfanos.length) {
    console.log('\nArchivos en la skill que ya no existen en tests/ (revisar a mano, no se borran solos):');
    huerfanos.forEach(f => console.log(`  - ${f}`));
  }

  if (check && diferencias) {
    console.error(`\n${diferencias} archivo(s) desincronizado(s) con la skill. Corré "node tests/sync-skill.js" sin --check para copiarlos.`);
    process.exit(1);
  }
}

main();
