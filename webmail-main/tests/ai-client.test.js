/**
 * Tests des modules navigateur (exécutés dans un contexte vm avec un DOM minimal).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function whiteboardSandbox(objects, storage = new Map()) {
  const handlers = {}, emitted = [], notices = [];
  const els = {};
  const mkEl = (id) => ({
    id, value: '', disabled: false, style: {}, dataset: {}, className: '', scrollHeight: 0, scrollTop: 0,
    classList: { toggle() {}, add() {}, remove() {} }, toggleAttribute() {}, focus() {}, remove() {}, appendChild() {},
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
  });
  const sb = {
    console, clearTimeout, setInterval: () => 0, clearInterval() {},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },     // les minuteurs du module ne doivent pas retenir le processus de test
    Math, Date, String, Number, Array, Set, Object, JSON,
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    document: { getElementById: (id) => els[id] || (els[id] = mkEl(id)), querySelectorAll: () => [], createElement: () => mkEl('x') },
    notify: (m) => notices.push(m),
    MeetState: { MEETING_ID: 'm1', USER_EMAIL: 'aude@x.com', displayName: 'Aude', wbCanvas: { width: 1600, height: 900 }, socket: { on: (e, f) => { handlers[e] = f; }, emit: (e, p) => emitted.push([e, p]) } },
    wbObjects: objects, wbBgColor_: '#1a2540', wbCanEdit: () => true, wbRedraw() {}, wbSaveHistory() {}, wbSyncAll() {}, wbLocalAuthorMeta: () => ({}),
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('public/js/meeting/meeting-whiteboard-ai.js'), sb);
  return { sb, handlers, emitted, notices, storage, input: () => sb.document.getElementById('wbai-input') };
}

const board = () => ([
  { id: 'r1', type: 'shape', shape: 'rect', x1: 0.1, y1: 0.3, x2: 0.3, y2: 0.45, color: '#4db8d8', fillColor: '#1e3a5f', fillOpacity: 100 },
  { id: 't1', type: 'text', text: 'Dev', x: 0.2, y: 0.36, color: '#ffffff', size: 5, textAlign: 'center' },
  { id: 'a1', type: 'shape', shape: 'arrow', x1: 0.3, y1: 0.375, x2: 0.5, y2: 0.375, color: '#ffffff' },
]);

/** Envoie une demande puis simule la réponse validée du serveur. */
function ask(ctx, text, result) {
  ctx.input().value = text;
  ctx.sb.WbAI.send();
  const [, payload] = ctx.emitted[ctx.emitted.length - 1];
  ctx.handlers.wb_ai_result({ requestId: payload.requestId, ok: true, message: 'ok', elements: [], updates: [], deletes: [], ...result });
  return payload;
}

test('tableau blanc : le contexte envoyé contient ids, couleurs, étiquettes, groupes et taille du canvas', () => {
  const objs = board();
  objs.push({ id: 'n1', type: 'shape', shape: 'rect', x1: 0, y1: 0, x2: 1, y2: 0.1, color: '#fff', fillColor: '#fff', g: 'b_g1', n: 'navbar' },
    { id: 'i1', type: 'sticker', sticker: 'image', x: 0.5, y: 0.5, x2: 0.7, y2: 0.7, color: '#4db8d8', props: { src: '/wb-media/' + 'a'.repeat(32) + '.png' } });
  const ctx = whiteboardSandbox(objs);
  ctx.input().value = 'mets Dev en rouge';
  ctx.sb.WbAI.send();
  const c = ctx.emitted[0][1].context;
  const byId = Object.fromEntries(c.existing.map(e => [e.id, e]));
  assert.equal(byId.t1.labelOf, 'r1');
  assert.equal(byId.r1.fill, '#1e3a5f');
  assert.equal(byId.a1.fill, '');
  assert.equal(byId.i1.st, 'image'); assert.match(byId.i1.src, /^\/wb-media\//);
  const plain = (v) => JSON.parse(JSON.stringify(v));                                // les objets viennent d'un autre contexte vm
  assert.deepEqual(plain(c.groups.map(g => [g.g, g.n, g.count])), [['b_g1', 'navbar', 1]]);
  assert.deepEqual(plain(c.canvas), { w: 1600, h: 900 });
});

test('tableau blanc : modifier, supprimer, ajouter ; chaque réponse crée une version restaurable', () => {
  const ctx = whiteboardSandbox(board());
  const initial = JSON.stringify(ctx.sb.wbObjects);
  ask(ctx, 'recolore et déplace Dev, supprime la flèche, ajoute QA', {
    elements: [{ kind: 'rect', x: 0.6, y: 0.3, w: 0.2, h: 0.15, label: 'QA', color: '#4db8d8' }],
    updates: [{ id: 'r1', fill: '#ff0000', x: 0.2, y: 0.5 }], deletes: ['a1'],
  });
  const { wbObjects } = ctx.sb;
  const r1 = wbObjects.find(o => o.id === 'r1'), t1 = wbObjects.find(o => o.id === 't1');
  assert.equal(r1.fillColor, '#ff0000');
  assert.ok(Math.abs(r1.x1 - 0.2) < 1e-9 && Math.abs(r1.y1 - 0.5) < 1e-9);
  assert.ok(Math.abs(t1.x - 0.3) < 1e-9 && Math.abs(t1.y - 0.56) < 1e-9);          // l'étiquette suit la boîte
  assert.equal(wbObjects.find(o => o.id === 'a1'), undefined);
  assert.equal(wbObjects.length, 4);

  const [v1] = ctx.sb.WbAI.versions();
  assert.equal(v1.ver, 1);
  ctx.sb.WbAI.restoreVersion(v1.beforeId);                                         // « Annuler »
  assert.equal(JSON.stringify(ctx.sb.wbObjects), initial);                          // tout est revenu comme avant, ordre compris
  ctx.sb.WbAI.restoreVersion(v1.afterId);                                           // « Revenir à cette version »
  assert.equal(ctx.sb.wbObjects.length, 4);
  assert.equal(ctx.sb.wbObjects.find(o => o.id === 'r1').fillColor, '#ff0000');
});

test('tableau blanc : revenir à un ancien design après plusieurs réponses', () => {
  const ctx = whiteboardSandbox([]);
  ask(ctx, 'dessine une boîte', { elements: [{ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: '#4db8d8' }] });
  const design1 = JSON.stringify(ctx.sb.wbObjects);
  ask(ctx, 'ajoute un cercle', { elements: [{ kind: 'ellipse', x: 0.5, y: 0.5, w: 0.2, h: 0.2, color: '#ff0000' }] });
  ask(ctx, 'efface tout', { clear: true });
  assert.equal(ctx.sb.wbObjects.length, 0);
  const versions = ctx.sb.WbAI.versions();
  assert.equal(versions.length, 3);
  ctx.sb.WbAI.restoreVersion(versions[0].afterId);                                  // retour au design n°1
  assert.equal(JSON.stringify(ctx.sb.wbObjects), design1);
});

test('tableau blanc : la conversation et les versions survivent au rechargement de la page', () => {
  const storage = new Map();
  const first = whiteboardSandbox([], storage);
  ask(first, 'dessine une boîte', { elements: [{ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: '#4db8d8' }] });
  const saved = JSON.stringify(first.sb.wbObjects);
  assert.ok([...storage.keys()].some(k => k === 'wbai:v1:m1:aude@x.com'));

  // « Rechargement » : nouveau contexte navigateur, même stockage, tableau vide au départ
  const reloaded = whiteboardSandbox([], storage);
  reloaded.sb.WbAI.showTab('ai');
  const versions = reloaded.sb.WbAI.versions();
  assert.equal(versions.length, 1);
  reloaded.sb.WbAI.restoreVersion(versions[0].afterId);
  assert.equal(JSON.stringify(reloaded.sb.wbObjects), saved);

  // un autre participant (autre e-mail) ne voit pas cette conversation
  const other = whiteboardSandbox([], storage);
  other.sb.MeetState.USER_EMAIL = 'paul@x.com';
  other.sb.WbAI.showTab('ai');
  assert.equal(other.sb.WbAI.versions().length, 0);
});

test('tableau blanc : composants natifs, groupes, déplacement de groupe, alignement et ordre', () => {
  const ctx = whiteboardSandbox([]);
  ask(ctx, 'maquette', {
    elements: [
      { kind: 'ui', sticker: 'hero', x: 0.1, y: 0.1, w: 0.5, h: 0.3, color: '#4db8d8', props: { title: 'Bienvenue' }, g: 'g1', n: 'hero' },
      { kind: 'rect', x: 0.1, y: 0.5, w: 0.2, h: 0.1, color: '#fff', fill: '#2563eb', noStroke: true, dash: 'dashed', g: 'g1', n: 'hero' },
      { kind: 'rect', x: 0.5, y: 0.6, w: 0.1, h: 0.1, color: '#fff' },
    ],
  });
  const groupId = ctx.sb.wbObjects[0].g;
  assert.match(groupId, /^[a-z0-9]+_g1$/);
  assert.equal(ctx.sb.wbObjects[0].type, 'sticker'); assert.equal(ctx.sb.wbObjects[0].props.title, 'Bienvenue');
  assert.equal(ctx.sb.wbObjects[1].borderStyle, 'none');                            // « noStroke » prioritaire sur « dash »

  ask(ctx, 'descends le groupe', { updates: [{ group: groupId, dy: 0.2 }] });
  assert.ok(Math.abs(ctx.sb.wbObjects[0].y - 0.3) < 1e-9 && Math.abs(ctx.sb.wbObjects[1].y1 - 0.7) < 1e-9);   // tous les membres bougent

  const lone = ctx.sb.wbObjects[2].id;
  ask(ctx, 'aligne', { align: [{ ids: [groupId, lone], mode: 'left' }] });
  assert.ok(Math.abs(ctx.sb.wbObjects[2].x1 - 0.1) < 1e-9);                         // l'élément isolé rejoint le bord gauche du groupe

  ask(ctx, 'premier plan', { order: { front: [groupId], back: [] } });
  assert.equal(ctx.sb.wbObjects[ctx.sb.wbObjects.length - 1].g, groupId);
});

test('tableau blanc : id inconnu, erreur serveur ou tableau verrouillé → aucune modification', () => {
  const ctx = whiteboardSandbox(board());
  ask(ctx, 'fais quelque chose', { updates: [{ id: 'inconnu', color: '#000000' }] });
  assert.equal(ctx.sb.wbObjects.length, 3);
  assert.equal(ctx.sb.wbObjects.find(o => o.id === 'r1').color, '#4db8d8');
  assert.equal(ctx.sb.WbAI.versions().length, 0);                                    // rien n'a changé : pas de version

  ctx.input().value = 'encore';
  ctx.sb.WbAI.send();
  ctx.handlers.wb_ai_result({ requestId: ctx.emitted[1][1].requestId, ok: false, error: 'Boom' });
  assert.equal(ctx.sb.wbObjects.length, 3);

  const locked = whiteboardSandbox(board());
  locked.sb.wbCanEdit = () => false;
  locked.input().value = 'dessine';
  locked.sb.WbAI.send();
  assert.equal(locked.emitted.length, 0);                                            // aucune requête n'est envoyée
});

test('images du tableau : seules les sources locales sont chargées, jamais un lien externe', () => {
  const loaded = [];
  const sb = {
    console, window: {}, MeetState: {}, wbObjects: [], wbRedraw() {}, notify() {},
    Image: class { set src(v) { loaded.push(v); } },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('public/js/meeting/meeting-whiteboard-images.js'), sb);
  const good = '/wb-media/' + 'c'.repeat(32) + '.png';
  assert.equal(sb.wbGetImage(good), null);                                           // lancé, pas encore chargé
  for (const bad of ['https://pirate.example/espion.png', 'http://x.com/a.png', 'data:image/svg+xml;base64,AAAA', '//evil.com/a.png', '/wb-media/../x.png', '/uploads/a.png', '', null]) assert.equal(sb.wbGetImage(bad), null);
  assert.deepEqual(loaded, [good]);                                                  // une seule requête, vers notre propre domaine
});

test('pièce jointe oubliée : détectée dans le texte propre, ignorée dans la citation', () => {
  const sb = { window: {}, document: {}, console, Intl, Date, Math, String, Array, Set, Object, JSON, Promise };
  vm.createContext(sb);
  vm.runInContext(read('public/js/ai-mail-tools.js') + '\nthis.T = AIMailTools;', sb);
  const m = sb.T.mentionsAttachment;
  assert.equal(m('Bonjour, vous trouverez ci-joint le devis.'), true);
  assert.equal(m('Voir la pièce jointe svp'), true);
  assert.equal(m('Please see attached file'), true);
  assert.equal(m('Rendez-vous demain à 10h'), false);
  assert.equal(m('Merci\n\n────────────────────\nDe : x\nci-joint le fichier'), false);
  assert.equal(m('> ci-joint ancien\nOK'), false);
});
