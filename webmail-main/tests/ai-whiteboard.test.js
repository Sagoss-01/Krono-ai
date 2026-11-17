const test = require('node:test');
const assert = require('node:assert/strict');
const { stub, fresh } = require('./helpers');

const wb = require('../src/services/aiWhiteboardService');
const D = { stroke: '#4db8d8', text: '#ffffff' };

test('sanitizeElement : coordonnées bornées, types inconnus et couleurs invalides rejetés', () => {
  const r = wb.sanitizeElement({ kind: 'rect', x: 0.9, y: 0.5, w: 0.5, h: 0.2, label: 'A', color: 'rouge' }, D);
  assert.ok(r.x + r.w <= 1.0000001);
  assert.equal(r.color, '#4db8d8');
  assert.equal(wb.sanitizeElement({ kind: 'script' }, D), null);
  assert.equal(wb.sanitizeElement({ kind: 'text', text: '' }, D), null);
  assert.equal(wb.sanitizeElement({ kind: 'freehand', points: [[0, 0]] }, D), null);
  assert.deepEqual(wb.sanitizeElement({ kind: 'arrow', x1: -2, y1: 3, x2: 0.5, y2: 'abc' }, D), { kind: 'arrow', x1: 0, y1: 1, x2: 0.5, y2: 0, color: '#4db8d8' });
});

test('sanitizeElement : styles (arrondi, trait, pointillés, opacité) et texte enrichi bornés', () => {
  const r = wb.sanitizeElement({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.1, fill: '#ffffff', radius: 500, strokeSize: 99, noStroke: true, dash: 'dashed', opacity: 3 }, D);
  assert.equal(r.radius, 80); assert.equal(r.strokeSize, 12); assert.equal(r.noStroke, true); assert.equal(r.dash, 'dashed'); assert.equal(r.opacity, 10);
  assert.equal(wb.sanitizeElement({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.1, dash: 'javascript:' }, D).dash, undefined);
  const t = wb.sanitizeElement({ kind: 'text', text: 'Bonjour', x: 0.5, y: 0.5, size: 99, bold: true, italic: 'true', align: 'center' }, D);
  assert.deepEqual([t.size, t.bold, t.italic, t.align], [12, true, true, 'center']);            // « true » en chaîne est toléré pour le style
  assert.equal(wb.sanitizeElement({ kind: 'text', text: 'x', size: 0 }, D).size, 2);
});

test('composants natifs (ui) : liste blanche, propriétés typées et bornées', () => {
  assert.equal(wb.sanitizeElement({ kind: 'ui', sticker: 'virus', x: 0, y: 0, w: 0.1, h: 0.1 }, D), null);
  const hero = wb.sanitizeElement({ kind: 'ui', sticker: 'hero', x: 0.1, y: 0.1, w: 0.5, h: 0.3, props: { title: 'T'.repeat(500), cta: 'Go', bgColor: 'rouge', borderRadius: 999, inconnue: 'x' } }, D);
  assert.equal(hero.props.title.length, 100); assert.equal(hero.props.cta, 'Go'); assert.equal(hero.props.borderRadius, 40);
  assert.equal(hero.props.bgColor, undefined); assert.equal(hero.props.inconnue, undefined);
  const side = wb.sanitizeProps('sidebar', { items: ['Accueil', 'Pro,duits', ...Array(20).fill('x')] });
  assert.equal(side.items.split(',').length, 8);                                                  // virgules internes neutralisées, 8 entrées max
  assert.equal(wb.sanitizeProps('chart', { values: [1, 50, 500, 'x'] }).values, '5,50,100,5');
});

test('images : lien https gardé pour import, source locale acceptée, le reste rejeté', () => {
  const ok = 'https://exemple.com/logo.png';
  assert.equal(wb.sanitizeElement({ kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.2, url: ok }, D).props.src, ok);
  const local = '/wb-media/' + 'a'.repeat(32) + '.png';
  assert.equal(wb.sanitizeElement({ kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.2, src: local }, D).props.src, local);
  for (const bad of ['http://exemple.com/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', '/etc/passwd', '/wb-media/../../x.png', '//evil.com/a.png']) {
    assert.equal(wb.sanitizeElement({ kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.2, url: bad }, D).props.src, undefined, bad);
  }
  assert.deepEqual(wb.urlsInPrompt('Mets https://a.com/x.png, puis https://b.org/y.jpg. Et http://non.com/z.png'), new Set(['https://a.com/x.png', 'https://b.org/y.jpg']));
});

test('sanitizeUpdate : ids et groupes existants uniquement, déplacements relatifs, props validées par composant', () => {
  const ids = new Set(['r1', 't1', 'h1']), groups = new Set(['g1']), stickers = new Map([['h1', 'hero']]);
  assert.deepEqual(wb.sanitizeUpdate({ id: 'r1', fill: '#ff0000', x: 5, color: 'nope' }, ids), { id: 'r1', fill: '#ff0000', x: 1 });
  assert.equal(wb.sanitizeUpdate({ id: 'zzz', color: '#000000' }, ids), null);
  assert.equal(wb.sanitizeUpdate({ id: 'r1' }, ids), null);
  assert.equal(wb.sanitizeUpdate({ id: '../../x', color: '#000000' }, new Set(['../../x'])), null);
  assert.equal(wb.sanitizeUpdate({ id: 't1', size: 99 }, ids).size, 12);
  assert.deepEqual(wb.sanitizeUpdate({ group: 'g1', dx: 5, dy: -0.1 }, ids, groups), { group: 'g1', dx: 1, dy: -0.1 });
  assert.equal(wb.sanitizeUpdate({ group: 'g9', dx: 0.1 }, ids, groups), null);
  assert.deepEqual(wb.sanitizeUpdate({ id: 'h1', props: { title: 'Nouveau', virus: 'x' } }, ids, groups, stickers).props, { title: 'Nouveau' });
  assert.equal(wb.sanitizeUpdate({ id: 'r1', props: { title: 'x' } }, ids, groups, stickers), null);      // pas un composant natif : props ignorées
});

function load(chatJson) {
  const restore = stub('src/services/aiService.js', { chatJson });
  const svc = fresh('src/services/aiWhiteboardService.js');
  return { svc, restore: () => { restore(); fresh('src/services/aiWhiteboardService.js'); } };
}
const CTX = {
  aspect: '1.78:1', bgColor: '#1a2540', canvas: { w: 1600, h: 900 },
  existing: [{ id: 'r1', t: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, { id: 'a1', t: 'arrow', x: 0.3, y: 0.1, w: 0.1, h: 0 }, { id: 'bad id!', t: 'rect' }, { id: 'n1', t: 'rect', g: 'b_g1' }],
  groups: [{ g: 'b_g1', n: 'navbar', x: 0, y: 0, w: 1, h: 0.1, count: 12 }],
};

test('generate : un gabarit devient des dizaines d\'éléments groupés ; thème appliqué', async () => {
  const { svc, restore } = load(async (msgs) => {
    assert.match(msgs[0].content, /ecommerce_home/);
    assert.match(msgs[0].content, /group=b_g1/);                                           // l'IA voit les groupes
    return { message: 'Maquette e-commerce', theme: { primary: '#e11d48' }, elements: [{ kind: 'template', name: 'ecommerce_home', brand: 'Atelier', hero: { title: 'Soldes' } }, { kind: 'template', name: 'inconnu' }] };
  });
  try {
    const out = await svc.generate('fais un site e-commerce', CTX);
    assert.ok(out.elements.length > 50);
    assert.ok(out.elements.every(e => e.g === 'g1' && e.n === 'ecommerce_home'));
    assert.ok(out.elements.some(e => e.kind === 'ui' && e.sticker === 'image'));
    assert.ok(out.elements.some(e => e.color === '#e11d48' || e.fill === '#e11d48'));       // couleur principale du thème
    assert.match(out.message, /Maquette e-commerce/);
  } finally { restore(); }
});

test('generate : images — seul un lien écrit par l\'utilisateur est importé, par le serveur', async () => {
  const imported = [];
  const { svc, restore } = load(async () => ({
    message: 'ok',
    elements: [
      { kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.2, url: 'https://exemple.com/logo.png' },
      { kind: 'image', x: 0.4, y: 0.1, w: 0.2, h: 0.2, url: 'https://pirate.example/espion.png' },     // inventé par l'IA : refusé
      { kind: 'component', name: 'hero', x: 0.1, y: 0.4, w: 0.8, h: 0.4, src: 'https://exemple.com/banniere.jpg' },
    ],
  }));
  try {
    const out = await svc.generate('Mets mon logo https://exemple.com/logo.png en haut', CTX, {
      resolveImage: async (url) => { imported.push(url); return { url: '/wb-media/' + 'b'.repeat(32) + '.png' }; },
    });
    assert.deepEqual(imported, ['https://exemple.com/logo.png']);
    const images = out.elements.filter(e => e.kind === 'ui' && e.sticker === 'image');
    assert.equal(images.length, 3);
    assert.equal(images[0].props.src, '/wb-media/' + 'b'.repeat(32) + '.png');
    assert.ok(images.slice(1).every(e => !e.props.src));                                    // lien refusé → cadre vide, jamais d'URL externe
    assert.ok(!JSON.stringify(out.elements).includes('pirate.example'));
    assert.match(out.message, /ignoré/);
  } finally { restore(); }
});

test('generate : échec d\'import → cadre vide + message, sans planter', async () => {
  const { svc, restore } = load(async () => ({ message: 'ok', elements: [{ kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.2, url: 'https://exemple.com/a.png' }] }));
  try {
    const out = await svc.generate('image https://exemple.com/a.png', CTX, { resolveImage: async () => { throw new Error('Image trop lourde'); } });
    assert.equal(out.elements.length, 1);
    assert.equal(out.elements[0].props.src, undefined);
    assert.match(out.message, /trop lourde/);
  } finally { restore(); }
});

test('generate : modifications, groupes, suppressions, ordre, alignement filtrés par les ids du tableau', async () => {
  const { svc, restore } = load(async () => ({
    message: 'ok', elements: [{ kind: 'rect', x: 0.6, y: 0.3, w: 0.2, h: 0.1, label: 'QA' }, { kind: 'x' }],
    updates: [{ id: 'r1', fill: '#00ff00' }, { id: 'inconnu', color: '#000000' }, { group: 'b_g1', dy: 0.05 }, { group: 'zzz', dy: 1 }],
    deletes: ['a1', 'fantome', 'a1', 'b_g1'], order: { front: ['r1', 'nope'], back: ['b_g1'] },
    align: [{ ids: ['r1', 'a1'], mode: 'left' }, { ids: ['r1'], mode: 'left' }, { ids: ['r1', 'a1'], mode: 'diagonale' }],
    distribute: [{ ids: ['r1', 'a1', 'n1'], axis: 'v' }, { ids: ['r1', 'a1'], axis: 'h' }], clear: 'true',
  }));
  try {
    const out = await svc.generate('réorganise', CTX);
    assert.equal(out.elements.length, 1);
    assert.deepEqual(out.updates, [{ id: 'r1', fill: '#00ff00' }, { group: 'b_g1', dy: 0.05 }]);
    assert.deepEqual(out.deletes, ['a1', 'b_g1']);
    assert.deepEqual(out.order, { front: ['r1'], back: ['b_g1'] });
    assert.deepEqual(out.align, [{ ids: ['r1', 'a1'], mode: 'left' }]);                     // moins de 2 éléments ou mode invalide : ignoré
    assert.deepEqual(out.distribute, [{ ids: ['r1', 'a1', 'n1'], axis: 'v' }]);             // au moins 3 éléments
    assert.equal(out.clear, false);                                                         // « true » en texte n'efface pas le tableau
  } finally { restore(); }
});

test('generate : composant inconnu ou paramètres absurdes ne font pas échouer la demande', async () => {
  const { svc, restore } = load(async () => ({ message: 'ok', elements: [
    { kind: 'component', name: 'rm -rf', x: 0, y: 0, w: 1, h: 1 }, { kind: 'component', name: 'navbar' },       // sans boîte
    { kind: 'component', name: 'navbar', x: 0.1, y: 0.1, w: 0.8, h: 0.08, items: 12345, icons: { a: 1 }, brand: null },
    { kind: 'template', name: 'constructor' },                                                                   // clé héritée d'Object : refusée
  ] }));
  try {
    const out = await svc.generate('barre de navigation', CTX);
    assert.ok(out.elements.length >= 3);                                                   // seule la 3e demande est valide (barre + marque)
    assert.ok(out.elements.every(e => e.n === 'navbar'));
  } finally { restore(); }
});
