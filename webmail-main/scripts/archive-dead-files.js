/**
 * scripts/archive-dead-files.js
 * Range dans _archive_dead_files/ les scripts navigateur que `npm run check:dead-scripts` signale comme
 * jamais chargés (vérifiés : aucune vue, aucun script ni module serveur ne les référence).
 * RIEN n'est supprimé : tout est déplacé, et restaurable.
 *
 *   node scripts/archive-dead-files.js            → simulation (affiche seulement)
 *   node scripts/archive-dead-files.js --apply    → déplace les fichiers
 *   node scripts/archive-dead-files.js --restore  → remet les fichiers à leur place
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARCHIVE = path.join(ROOT, '_archive_dead_files');

const DEAD = [
  'public/js/chat.js',                                      // ancien module Chat, remplacé par chat-ui.js (seul sidebar-nav.js l'appelait)
  'public/js/sidebar-nav.js',                               // jamais chargé
  'public/js/meeting/socket.js',                            // remplacé par meeting-socket.js
  'public/js/meeting/meeting-features-core.js',             // copies morcelées de meeting-features.js (le seul fichier chargé)
  'public/js/meeting/meeting-features-engagement.js',
  'public/js/meeting/meeting-features-engagement (copy).js',
  'public/js/meeting/meeting-features-realtime.js',
  'public/js/meeting/meeting-features-recording.js',
  'public/js/meeting/meeting-features-speech.js',
  'public/js/meeting/meeting-features-studio.js',
  'public/js/meeting/meeting-features-whiteboard.js',
];

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--restore') ? 'restore' : 'dry';
let moved = 0, skipped = 0;

for (const rel of DEAD) {
  const from = mode === 'restore' ? path.join(ARCHIVE, rel) : path.join(ROOT, rel);
  const to   = mode === 'restore' ? path.join(ROOT, rel) : path.join(ARCHIVE, rel);
  if (!fs.existsSync(from)) { skipped++; continue; }
  console.log(`${mode === 'dry' ? '[simulation] ' : ''}${rel}  →  ${path.relative(ROOT, to)}`);
  if (mode !== 'dry') {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  moved++;
}

console.log(`\n${moved} fichier(s) ${mode === 'dry' ? 'à déplacer (relancez avec --apply)' : mode === 'apply' ? 'archivé(s)' : 'restauré(s)'}, ${skipped} déjà absent(s).`);
if (mode === 'apply') console.log('Vérifiez le site, puis lancez « npm run check:dead-scripts » : la liste doit être vide.');
