/**
 * src/services/aiMailboxService.js
 * Outils de LECTURE SEULE donnés à l'assistant : rechercher des e-mails et en lire le contenu.
 * - Les messages lus ne sont PAS marqués comme lus.
 * - Les résultats sont des données non fiables : ils sont renvoyés à l'IA dans un bloc JSON balisé.
 * - Plafonds stricts (nombre de lectures, taille des textes) pour limiter coût et fuite de contenu.
 */
const imapService = require('./imap');

const FOLDERS = ['INBOX', 'Sent', 'Drafts', 'Junk', 'Trash'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_IN_TEXT = /[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}/g;

const MAX_READS = 6;
const MAX_TEXT = 2500;
const MAX_RESULTS = 10;

const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const emailsIn = (s) => (String(s || '').match(EMAIL_IN_TEXT) || []).map(e => e.toLowerCase());

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

/** État d'une requête : ce qui a été lu et les adresses d'en-tête rencontrées. */
function newState() {
  return { reads: 0, known: new Map(), addresses: new Set() };
}

async function searchMail(creds, args, state) {
  const folder = args.folder === 'ALL' ? 'ALL' : (FOLDERS.includes(args.folder) ? args.folder : 'INBOX');
  const criteria = {
    from: clip(args.from, 120), subject: clip(args.subject, 120),
    since: DATE_RE.test(args.since || '') ? args.since : '', before: DATE_RE.test(args.before || '') ? args.before : '',
    unread: bool(args.unread), starred: bool(args.starred), hasAttachment: bool(args.hasAttachment),
  };
  const limit = Math.min(MAX_RESULTS, Math.max(1, parseInt(args.limit, 10) || 8));
  const folders = folder === 'ALL' ? FOLDERS : [folder];

  let all = [];
  for (const f of folders) {
    const found = await imapService.searchEmails(creds, f, criteria);
    all = all.concat(found.map(e => ({ ...e, _folder: f })));
  }
  all.sort((a, b) => new Date(b.headers?.date || 0) - new Date(a.headers?.date || 0));
  const total = all.length;

  const items = all.slice(0, limit).map(e => {
    const h = e.headers || {};
    state.known.set(`${e._folder}:${e.uid}`, { folder: e._folder, uid: e.uid, from: h.from || '', subject: h.subject || '' });
    emailsIn(h.from).forEach(a => state.addresses.add(a));
    return {
      folder: e._folder, uid: e.uid, from: clip(h.from, 160), subject: clip(h.subject, 200),
      date: h.date ? new Date(h.date).toISOString() : '', unread: !(e.flags || []).includes('\\Seen'), hasAttachment: !!e.hasAttachment,
    };
  });
  return { total, shown: items.length, messages: items };
}

async function readMail(creds, args, state) {
  if (state.reads >= MAX_READS) return { error: `Limite de ${MAX_READS} lectures atteinte pour cette demande.` };
  const folder = FOLDERS.includes(args.folder) ? args.folder : 'INBOX';
  const uid = parseInt(args.uid, 10);
  if (!Number.isInteger(uid) || uid < 1) return { error: 'uid invalide' };
  state.reads++;

  const m = await imapService.fetchEmailBody(creds, uid, folder, { markSeen: false });
  [m.from, m.to, m.cc].forEach(h => emailsIn(h).forEach(a => state.addresses.add(a)));      // en-têtes seulement, jamais le corps
  state.known.set(`${folder}:${uid}`, {
    folder, uid, from: m.from || '', subject: m.subject || '', messageId: m.messageId || '', references: m.references || '',
  });
  const text = clip(m.text && m.text.trim() ? m.text : htmlToText(m.html), MAX_TEXT);
  return {
    folder, uid, from: clip(m.from, 160), to: clip(m.to, 300), cc: clip(m.cc, 300), subject: clip(m.subject, 200),
    date: m.date ? new Date(m.date).toISOString() : '', text,
    attachments: (m.attachments || []).slice(0, 10).map(a => ({ filename: clip(a.filename, 80), size: a.size || 0 })),
  };
}

/** Exécute un outil de messagerie. Ne lève jamais : renvoie { error } en cas d'échec. */
async function run(name, args, creds, state) {
  try {
    if (name === 'search_mail') return await searchMail(creds, args || {}, state);
    if (name === 'read_mail')   return await readMail(creds, args || {}, state);
    return { error: 'Outil inconnu' };
  } catch (e) {
    console.warn('[AI] outil messagerie :', name, e.message);
    return { error: "Impossible d'accéder à la messagerie pour le moment." };
  }
}

module.exports = { run, newState, htmlToText, emailsIn, MAX_READS };
