/**
 * src/workers/backgroundJobs.js
 * Tâches de fond démarrées par server.js après initDB :
 *   - rappels d'agenda par e-mail (reminderWorker, toutes les minutes, avec rattrapage après redémarrage) ;
 *   - envois programmés persistants (toutes les 30 s, reprise des envois interrompus au démarrage) ;
 *   - maintenance quotidienne : purge des journaux IA, des envois terminés et des conversations IA
 *     arrivées au bout de leur durée de conservation.
 * Chaque tâche est protégée contre le chevauchement et ne peut jamais faire tomber le serveur.
 */
const reminderWorker = require('./reminderWorker');
const scheduled = require('../services/scheduledEmailService');
const aiUsage = require('../services/aiUsage');
const aiChatService = require('../services/aiChatService');
const { RETENTIONS } = require('../services/aiPreferencesService');

const SEND_EVERY_MS = 30 * 1000;
const DAILY_MS = 24 * 3600 * 1000;
let timers = [];

/** Exécute `fn` sans jamais laisser deux exécutions se chevaucher ni une erreur remonter. */
function guarded(name, fn) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try { await fn(); } catch (e) { console.error(`[Tâche ${name}]`, e.message); } finally { running = false; }
  };
}

async function dailyMaintenance() {
  await aiUsage.purgeOld();
  await scheduled.purgeOld();
  const envDays = parseInt(process.env.AI_DEFAULT_RETENTION_DAYS, 10);
  const removed = await aiChatService.purgeExpired(RETENTIONS.includes(envDays) ? envDays : 0);
  if (removed) console.log(`[Maintenance IA] ${removed} conversation(s) supprimée(s) (durée de conservation atteinte)`);
}

function start() {
  stop();
  reminderWorker.start();

  scheduled.recoverStuck().then(n => { if (n) console.warn(`[Programmation] ${n} envoi(s) interrompu(s) repris`); }).catch(e => console.error('[Programmation]', e.message));
  const send = guarded('envois programmés', () => scheduled.runDue());
  timers.push(setInterval(send, SEND_EVERY_MS));
  setTimeout(send, 5000);

  const daily = guarded('maintenance IA', dailyMaintenance);
  timers.push(setInterval(daily, DAILY_MS));
  setTimeout(daily, 60 * 1000);
  console.log('[Tâches de fond] rappels, envois programmés et maintenance IA démarrés');
}

function stop() { timers.forEach(clearInterval); timers = []; }

module.exports = { start, stop, dailyMaintenance, guarded };
