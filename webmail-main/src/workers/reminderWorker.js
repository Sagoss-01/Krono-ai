/**
 * src/workers/reminderWorker.js
 *
 * Vérifie toutes les minutes les événements du calendrier dont le rappel
 * arrive à échéance, et envoie un email à l'organisateur + aux invités.
 * Chaque événement n'est rappelé qu'une seule fois (reminder_sent_at).
 *
 * Démarré par src/workers/backgroundJobs.js (appelé depuis server.js après initDB).
 */
const calendarService = require('../services/calendarService');
const calendarMailService = require('../services/calendarMailService');

const CHECK_INTERVAL_MS = 60 * 1000; // vérifie chaque minute
let intervalHandle = null;

async function tick() {
  try {
    const now = new Date();
    // Fenêtre d'une minute autour de maintenant — le check tourne chaque
    // minute donc ça couvre tout sans repasser deux fois sur le même événement.
    // Rattrapage : on remonte de 15 min pour ne pas perdre les rappels tombés pendant un redémarrage
    // (reminder_sent_at empêche tout doublon).
    const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 30 * 1000);

    const due = await calendarService.findDueReminders(windowStart.toISOString(), windowEnd.toISOString());

    for (const event of due) {
      if (new Date(event.start_at) < now) { await calendarService.markReminderSent(event.id); continue; }   // déjà commencé : rappel inutile
      const meetingLink = event.meeting_id
        ? `${process.env.APP_URL || ''}/meeting/${event.meeting_id}`
        : null;

      const recipients = [event.owner_email, ...(event.attendee_emails || [])];
      const uniqueRecipients = [...new Set(recipients)];

      for (const to of uniqueRecipients) {
        try {
          await calendarMailService.sendReminder({ to, title: event.title, startAt: event.start_at, meetingLink });
        } catch (e) {
          console.error('[ReminderWorker] Échec envoi rappel à', to, ':', e.message);
        }
      }

      await calendarService.markReminderSent(event.id);
      console.log(`[ReminderWorker] Rappel envoyé pour "${event.title}" (event #${event.id}) à ${uniqueRecipients.length} destinataire(s)`);
    }
  } catch (e) {
    console.error('[ReminderWorker] Erreur pendant le check :', e.message);
  }
}

function start() {
  if (intervalHandle) return; // déjà démarré
  console.log('[ReminderWorker] Démarré — vérification toutes les 60s');
  intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
  tick(); // premier check immédiat au démarrage
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { start, stop };
