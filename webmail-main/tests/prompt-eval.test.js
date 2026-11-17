/**
 * Vérifie le jeu de tests de prompts LUI-MÊME (cas bien formés, vérificateur correct, exécuteur de bout en bout
 * avec un faux modèle). Le vrai modèle est interrogé par `npm run eval:prompts`, pas ici.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { stub } = require('./helpers');

const real = require('../src/services/aiService');
const CASES_FILE = path.join(__dirname, 'prompt-cases.json');

// Faux modèle : répond selon la demande reçue (dernier message utilisateur)
const lastUser = (m) => [...m].reverse().find(x => x.role === 'user')?.content || '';
const FAKE = (prompt) => {
  if (/mail à Jean pour reporter/.test(prompt)) return { reply: 'Voici un brouillon.', cards: [{ type: 'email_draft', to: ['jean@x.com'], subject: 'Report de la réunion', body: 'Bonjour Jean, pouvons-nous reporter à jeudi ?' }] };
  if (/Supprime l'Atelier/.test(prompt)) return { reply: "D'accord.", cards: [] };                                    // volontairement faux : la carte de suppression manque
  if (/poème/.test(prompt)) return { reply: 'Je gère vos e-mails et votre agenda.', cards: [] };
  if (/e-commerce de mode/.test(prompt)) return { message: 'Maquette', elements: [{ kind: 'template', name: 'ecommerce_home', brand: 'Atelier' }] };
  if (/cette image/.test(prompt)) return { message: 'Image ajoutée', elements: [{ kind: 'image', x: 0.1, y: 0.05, w: 0.8, h: 0.2, url: 'https://exemple.com/couverture.jpg' }] };
  return { reply: 'ok', cards: [], message: 'ok', elements: [] };
};
const restore = stub('src/services/aiService.js', {
  extractJson: real.extractJson,
  chatStream: async (m, o, onToken) => { const out = JSON.stringify(FAKE(lastUser(m))); onToken?.(out); return out; },
  chatJson: async (m) => FAKE(lastUser(m)),
});
const ev = require('../scripts/eval-prompts');
test.after(restore);

const KNOWN_EXPECT = new Set(['cards', 'noCards', 'forbidCardTypes', 'replyMatches', 'replyNotMatches', 'forbid', 'toolsUsed', 'wb', 'anyOf']);
const KNOWN_CARD = new Set(['type', 'to', 'toEmpty', 'subjectNotEmpty', 'bodyMatches', 'titleMatches', 'hasSendAt', 'sendDate', 'startDate', 'startTime', 'hasConflicts', 'eventId', 'mode', 'unread', 'emailIs', 'hasReplyThread']);
const KNOWN_WB = new Set(['minElements', 'maxElements', 'hasGroup', 'groupCount', 'hasThemeColors', 'updateIds', 'deletesAny', 'noClear', 'noDeletes', 'imageSrcCount', 'importCalls', 'importedUrls']);

test('cas : bien formés, ids uniques, clés d\'attente connues (une faute de frappe rendrait un cas inopérant)', () => {
  const cases = ev.loadCases(CASES_FILE);
  assert.ok(cases.length >= 20);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  const checkExpect = (e, id) => {
    for (const k of Object.keys(e)) assert.ok(KNOWN_EXPECT.has(k), `${id} : clé inconnue « ${k} »`);
    (e.anyOf || []).forEach(x => checkExpect(x, id));
    for (const c of e.cards || []) for (const k of Object.keys(c)) assert.ok(KNOWN_CARD.has(k), `${id} : critère de carte inconnu « ${k} »`);
    for (const k of Object.keys(e.wb || {})) assert.ok(KNOWN_WB.has(k), `${id} : critère tableau inconnu « ${k} »`);
    for (const re of [e.replyMatches, e.replyNotMatches, ...(e.cards || []).flatMap(c => [c.bodyMatches, c.titleMatches])].filter(Boolean)) assert.doesNotThrow(() => new RegExp(String(re).replace(/^\(\?i\)/, '')), `${id} : expression invalide ${re}`);
    for (const c of e.cards || []) for (const d of [c.sendDate, c.startDate].filter(Boolean)) assert.match(d, /^[+-]\d+d$/, `${id} : date relative invalide`);
  };
  for (const c of cases) {
    assert.ok(c.id && c.prompt && ['assistant', 'whiteboard'].includes(c.feature), `${c.id} : cas incomplet`);
    assert.ok(c.expect && typeof c.expect === 'object', `${c.id} : pas d'attente`);
    checkExpect(c.expect, c.id);
  }
  // le jeu couvre bien les familles de risques
  const ids = cases.map(c => c.id).join(' ');
  for (const needle of ['injection-dans-un-mail', 'injection-dans-la-demande', 'mail-destinataire-inconnu', 'evenement-ne-pas-supprimer-sans-demande', 'wb-ne-pas-tout-effacer', 'wb-image-sans-lien', 'wb-image-avec-lien']) assert.ok(ids.includes(needle), needle);
});

test('vérificateur : cartes, dates relatives, interdits, variantes et tableau blanc', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const out = { reply: 'Voici', cards: [{ type: 'email_draft', to: ['jean@x.com'], subject: 'S', body: 'Rendez-vous jeudi', sendAt: '2026-10-23T08:00' }, { type: 'calendar_event', startAt: '2026-10-23T12:30', title: 'Déjeuner' }] };
  assert.deepEqual(ev.check({ cards: [{ type: 'email_draft', to: ['jean@x.com'], bodyMatches: 'jeudi', sendDate: '+1d' }, { type: 'calendar_event', startDate: '+1d', startTime: '12:30', titleMatches: '(?i)déjeuner' }] }, out, now), []);
  assert.match(ev.check({ cards: [{ type: 'email_draft', to: ['marie@x.com'] }] }, out, now)[0], /destinataires/);
  assert.match(ev.check({ cards: [{ type: 'contact' }] }, out, now)[0], /absente/);
  assert.match(ev.check({ noCards: true }, out, now)[0], /cartes inattendues/);
  assert.match(ev.check({ forbid: ['JEAN@X.COM'] }, out, now)[0], /interdit/);
  assert.match(ev.check({ forbidCardTypes: ['calendar_event'] }, out, now)[0], /interdit/);
  assert.deepEqual(ev.check({ anyOf: [{ noCards: true }, { cards: [{ type: 'email_draft' }] }] }, out, now), []);
  assert.equal(ev.check({ anyOf: [{ noCards: true }, { cards: [{ type: 'contact' }] }] }, out, now).length, 1);
  assert.deepEqual(ev.check({ toolsUsed: ['search_mail'] }, { ...out, toolsUsed: ['search_mail'] }, now), []);
  assert.equal(ev.check({ toolsUsed: ['read_mail'] }, out, now).length, 1);
  const wb = { elements: Array.from({ length: 50 }, (_, i) => ({ kind: 'rect', n: 'landing', g: 'g1', fill: ['#111111', '#222222', '#333333', '#444444'][i % 4], props: i === 0 ? { src: '/wb-media/x.png' } : undefined })), updates: [{ id: 'r1' }], deletes: [], clear: false, importedUrls: ['https://a.com/x.png'] };
  assert.deepEqual(ev.check({ wb: { minElements: 40, hasGroup: 'landing', hasThemeColors: true, updateIds: ['r1'], noClear: true, noDeletes: true, imageSrcCount: 1, importCalls: 1, importedUrls: ['https://a.com/x.png'] } }, wb, now), []);
  assert.ok(ev.check({ wb: { maxElements: 10, hasGroup: 'dashboard', importCalls: 0 } }, wb, now).length >= 3);
});

test('exécuteur : rejoue les cas sur des données fixes, détecte les échecs, ne touche ni base ni réseau', async () => {
  const wanted = new Set(['mail-simple', 'evenement-supprimer', 'hors-sujet', 'wb-ecommerce', 'wb-image-avec-lien']);
  const cases = ev.loadCases(CASES_FILE).filter(c => wanted.has(c.id));
  assert.equal(cases.length, 5);
  const results = await ev.runCases(cases);
  const by = Object.fromEntries(results.map(r => [r.id, r]));
  assert.equal(by['mail-simple'].passRate, 1, JSON.stringify(by['mail-simple'].failures));
  assert.equal(by['hors-sujet'].passRate, 1, JSON.stringify(by['hors-sujet'].failures));
  assert.equal(by['wb-ecommerce'].passRate, 1, JSON.stringify(by['wb-ecommerce'].failures));
  assert.equal(by['wb-image-avec-lien'].passRate, 1, JSON.stringify(by['wb-image-avec-lien'].failures));   // le lien du message est importé par le serveur (fonction simulée)
  assert.equal(by['evenement-supprimer'].passRate, 0);                                                      // le faux modèle « oublie » la carte : l'échec est bien signalé
  assert.match(by['evenement-supprimer'].failures[0], /carte « calendar_event_delete » absente/);
  const twice = await ev.runCases(cases.filter(c => c.id === 'mail-simple'), { runs: 2 });
  assert.deepEqual([twice[0].runs, twice[0].passed], [2, 2]);
});
