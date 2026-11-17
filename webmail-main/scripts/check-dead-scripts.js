#!/usr/bin/env node
/**
 * scripts/check-dead-scripts.js
 *
 * Liste tous les fichiers .js sous public/js/ et signale ceux qu'aucune vue
 * .ejs ne charge via <script src="...">. Sert à détecter les fichiers
 * "orphelins" : du code qui existe, compile, semble correct... mais qui ne
 * tourne jamais réellement dans le navigateur, parce que personne ne l'a
 * branché dans une page. C'est exactement le genre de piège qui a causé le
 * bug de la fenêtre de prolongation de réunion (le correctif existait,
 * mais dans un fichier jamais chargé).
 *
 * Usage : npm run check:dead-scripts
 * Sort avec le code 1 si des fichiers orphelins sont trouvés (utile en CI).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_JS = path.join(ROOT, 'public', 'js');
const VIEWS = path.join(ROOT, 'views');

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const allScripts = walk(PUBLIC_JS, ['.js']);
  const allViews = walk(VIEWS, ['.ejs']);

  // Concatène le contenu de toutes les vues une fois, pour chercher dedans efficacement
  const viewsContent = allViews.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const orphans = [];
  const suspicious = [];

  for (const scriptPath of allScripts) {
    const relFromPublic = '/' + path.relative(path.join(ROOT, 'public'), scriptPath).replace(/\\/g, '/');
    const isReferenced = viewsContent.includes(relFromPublic);

    if (!isReferenced) {
      orphans.push(relFromPublic);
    }

    // Signale aussi les noms suspects : copies, backups, fichiers très proches
    // d'un autre nom existant (piège de confusion, même si référencés).
    const base = path.basename(scriptPath);
    if (/\bcopy\b|\.bak\.js$|-old\.js$|-backup\.js$| \(\d+\)\.js$/i.test(base)) {
      suspicious.push(relFromPublic);
    }
  }

  console.log(`\n${allScripts.length} fichier(s) .js trouvé(s) sous public/js/, ${allViews.length} vue(s) .ejs scannée(s).\n`);

  if (orphans.length) {
    console.log(`⚠️  ${orphans.length} fichier(s) JAMAIS chargés par aucune vue (candidats à supprimer ou à brancher) :`);
    orphans.forEach((f) => console.log('   - ' + f));
  } else {
    console.log('✅ Aucun fichier orphelin — tout ce qui existe sous public/js/ est chargé quelque part.');
  }

  if (suspicious.length) {
    console.log(`\n⚠️  ${suspicious.length} fichier(s) au nom suspect (copie/backup — à vérifier même s'ils sont référencés) :`);
    suspicious.forEach((f) => console.log('   - ' + f));
  }

  console.log('');
  process.exit(orphans.length > 0 ? 1 : 0);
}

main();
