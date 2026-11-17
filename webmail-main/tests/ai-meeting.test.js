const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, fresh, fakePool } = require('./helpers');

function loadMeetingAI({ chatJson, chat } = {}) {
  const fp = fakePool();
  const restores = [
    stub('src/services/db.js', fp),
    stub('src/services/aiService.js', { extractJson: require('../src/services/aiService').extractJson, chatJson: chatJson || (async () => ({})), chat: chat || (async () => 'ok') }),
  ];
  const svc = fresh('src/services/aiMeetingService.js');
  return { svc, calls: fp.calls, restore: () => restores.reverse().forEach(r => r()) };
}

test('sanitizeQuestion : exige question, 2 à 4 options et une bonne réponse valide', () => {
  const { svc, restore } = loadMeetingAI();
  try {
    assert.ok(svc.sanitizeQuestion({ question: 'Q ?', options: ['a', 'b', 'c', 'd', 'e'], correctIdx: 3 }));
    assert.equal(svc.sanitizeQuestion({ question: '', options: ['a', 'b'], correctIdx: 0 }), null);
    assert.equal(svc.sanitizeQuestion({ question: 'Q', options: ['a'], correctIdx: 0 }), null);
    assert.equal(svc.sanitizeQuestion({ question: 'Q', options: ['a', 'b'], correctIdx: 5 }), null);
    assert.ok(svc.sanitizeQuestion({ question: 'Q', options: ['a', 'b', 'c'], correctIdx: '1' }));
  } finally { restore(); }
});

test('generateQuiz : enregistre en transaction dans la Banque, transcription incluse dans le contenu', async () => {
  let seen = '';
  const { svc, calls, restore } = loadMeetingAI({
    chatJson: async (m) => { seen = m[1].content; return { title: 'Quiz test', questions: [{ question: 'Q1', options: ['a', 'b'], correctIdx: 1 }, { question: '', options: [] }] }; },
  });
  try {
    const out = await svc.generateQuiz({ owner: 'a@b.c', meetingTitle: 'Sync', transcript: '[10:00] Paul : nous parlons du mot de passe et de la double authentification', count: 5 });
    assert.equal(out.count, 1);
    assert.match(out.setId, /^qs_[0-9a-f]{16}$/);
    assert.match(seen, /Transcription/);
    assert.deepEqual(calls.map(c => c.sql.split(' ')[0]), ['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
    await assert.rejects(() => svc.generateQuiz({ owner: 'a', meetingTitle: '', count: 5 }), /Pas assez de contenu/);
  } finally { restore(); }
});

test('summarize : refuse de rédiger sans contenu (aucun compte-rendu inventé)', async () => {
  let called = false;
  const { svc, restore } = loadMeetingAI({ chat: async () => { called = true; return 'x'; } });
  try {
    await assert.rejects(() => svc.summarize({ title: 'Sync', participants: ['Paul'], chat: [], notes: '' }), /Pas assez de contenu/);
    assert.equal(called, false);
    const text = await svc.summarize({ title: 'Sync', transcript: '[10:00] Paul : '.padEnd(120, 'a'), chat: [] });
    assert.equal(text, 'x');
  } finally { restore(); }
});

test('headTail : garde l\'ouverture et la conclusion d\'un long texte', () => {
  const { svc, restore } = loadMeetingAI();
  try {
    const long = 'DEBUT' + 'x'.repeat(5000) + 'FIN';
    const out = svc.headTail(long, 1000);
    assert.ok(out.startsWith('DEBUT') && out.endsWith('FIN') && out.length <= 1030);
    assert.equal(svc.headTail('court', 1000), 'court');
  } finally { restore(); }
});

test('extractActions : échéance gardée seulement si date valide', async () => {
  const { svc, restore } = loadMeetingAI({ chatJson: async () => ({ actions: [{ title: 'Envoyer le devis', owner: 'Paul', due: '2026-10-16' }, { title: 'Relire', due: 'demain' }, { title: '' }] }) });
  try {
    const out = await svc.extractActions({ summary: 'x'.repeat(40) });
    assert.deepEqual(out.map(a => [a.title, a.due]), [['Envoyer le devis', '2026-10-16'], ['Relire', null]]);
  } finally { restore(); }
});

// ── Transcription et compte-rendu automatique ─────────────────────────────────
function loadSummary({ meeting, summarize, sendMail }) {
  const fp = fakePool();
  const restores = [
    stub('src/services/db.js', fp),
    stub('src/services/messageCrypto.js', { encryptContent: (v) => 'enc:' + v, decryptContent: (v) => String(v).replace(/^enc:/, '') }),
    stub('src/services/meeting.js', { getMeeting: async () => meeting, getAttendance: async () => [{ email: 'paul@x.com' }] }),
    stub('src/services/aiMeetingService.js', { summarize }),
    stub('src/services/systemMailer.js', { sendSystemMail: sendMail }),
  ];
  const svc = fresh('src/services/meetingAiSummaryService.js');
  return { svc, calls: fp.calls, restore: () => restores.reverse().forEach(r => r()) };
}

test('transcription : inactive par défaut, doublons ignorés, lignes datées', () => {
  const { svc, restore } = loadSummary({ meeting: null, summarize: async () => '', sendMail: async () => {} });
  try {
    assert.equal(svc.addCaption('m1', 'Paul', 'bonjour'), false);                      // pas activée par l'hôte
    svc.enable('m1', 'host@x.com');
    assert.equal(svc.addCaption('m1', 'Paul', 'bonjour à tous'), true);
    assert.equal(svc.addCaption('m1', 'Paul', 'bonjour à tous'), false);                // doublon consécutif
    assert.equal(svc.addCaption('m1', 'Paul', ' '), false);
    assert.match(svc.getTranscript('m1'), /^\[\d{2}:\d{2}\] Paul : bonjour à tous$/);
    svc.disable('m1');
    assert.equal(svc.getTranscript('m1'), '');
  } finally { restore(); }
});

test('transcription : plafonnée en nombre de lignes', () => {
  const { svc, restore } = loadSummary({ meeting: null, summarize: async () => '', sendMail: async () => {} });
  try {
    svc.enable('m2', 'h@x.com');
    for (let i = 0; i < 1700; i++) svc.addCaption('m2', 'Paul', 'phrase numéro ' + i);
    const lines = svc.getTranscript('m2').split('\n');
    assert.ok(lines.length <= 1500);
    assert.match(lines[lines.length - 1], /phrase numéro 1699$/);                       // on garde les plus récentes
  } finally { restore(); }
});

test('finalize : résumé envoyé à l\'hôte, enregistré chiffré, transcription effacée', async () => {
  const mails = [];
  let summarizeArgs;
  const { svc, calls, restore } = loadSummary({
    meeting: { id: 'm3', title: 'Point <b>hebdo</b>', host: 'Host@X.com' },
    summarize: async (a) => { summarizeArgs = a; return '**Résumé exécutif** : ok\n- point <script>'; },
    sendMail: async (m) => { mails.push(m); },
  });
  try {
    svc.enable('m3', 'host@x.com');
    svc.addCaption('m3', 'Paul', 'nous validons le budget');
    await svc.finalize({ meetingId: 'm3', chat: [{ displayName: 'Paul', text: 'ok' }], participants: ['Paul'], duration: '30 min' });
    assert.match(summarizeArgs.transcript, /nous validons le budget/);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'host@x.com');
    assert.ok(!mails[0].html.includes('<script>') && !mails[0].html.includes('<b>'));    // HTML échappé
    const insert = calls.find(c => c.sql.startsWith('INSERT INTO meeting_ai_summaries'));
    assert.match(insert.params[2], /^enc:/);
    assert.equal(svc.isEnabled('m3'), false);                                            // état effacé
  } finally { restore(); }
});

test('finalize : sans contenu, aucun e-mail n\'est envoyé', async () => {
  const mails = [];
  const { svc, restore } = loadSummary({
    meeting: { id: 'm4', title: 'Vide', host: 'h@x.com' },
    summarize: async () => { throw new Error('Pas assez de contenu'); },
    sendMail: async (m) => mails.push(m),
  });
  try {
    svc.enable('m4', 'h@x.com');
    await svc.finalize({ meetingId: 'm4' });
    assert.equal(mails.length, 0);
    assert.equal(svc.isEnabled('m4'), false);
    await svc.finalize({ meetingId: 'jamais-active' });                                  // sans activation : rien ne se passe
  } finally { restore(); }
});

test('canAccess : hôte et participants seulement', async () => {
  const { svc, restore } = loadSummary({ meeting: null, summarize: async () => '', sendMail: async () => {} });
  try {
    const meeting = { id: 'm5', host: 'host@x.com' };
    assert.equal(await svc.canAccess(meeting, 'HOST@x.com'), true);
    assert.equal(await svc.canAccess(meeting, 'paul@x.com'), true);
    assert.equal(await svc.canAccess(meeting, 'intrus@x.com'), false);
    assert.equal(await svc.canAccess(meeting, ''), false);
  } finally { restore(); }
});

test('légende traduite : langue inconnue refusée', async () => {
  const { svc, restore } = loadMeetingAI({ chat: async () => 'Hello\nautre ligne' });
  try {
    assert.equal(await svc.translateCaption('Bonjour', 'en'), 'Hello');
    await assert.rejects(() => svc.translateCaption('Bonjour', 'xx'), /non prise en charge/);
  } finally { restore(); }
});
