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
const SKILL_SCRIPTS_DIR = process.env.POTREROS_SKILL_SCRIPTS_DIR || path.join(
  'C:\\Users\\Pedro\\AppData\\Roaming\\Claude\\local-agent-mode-sessions\\skills-plugin',
  '2654d1f9-e000-473d-98a2-54d083fffe0b', '2300458b-359d-4f5f-b7ad-8ab94b5fdf76',
  'skills', 'apps-potreros', 'scripts'
);

function main() {
  const check = process.argv.includes('--check');

  if (!fs.existsSync(SKILL_SCRIPTS_DIR)) {
    console.error(`No se encontró la carpeta de la skill: ${SKILL_SCRIPTS_DIR}`);
    console.error('Si la skill se reinstaló en otra ruta, pasá POTREROS_SKILL_SCRIPTS_DIR=<ruta> antes del comando.');
    process.exit(1);
  }

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
