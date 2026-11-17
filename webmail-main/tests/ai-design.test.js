const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/services/aiDesignLibrary');
const wb = require('../src/services/aiWhiteboardService');

const designer = () => lib.create({ W: 1600, H: 900 });
const BOX = { x: 0.03 * 1600, y: 0.05 * 900, w: 0.94 * 1600, h: 0.9 * 900 };
const D = { stroke: '#4db8d8', text: '#ffffff' };

function checkElements(els, label) {
  assert.ok(els.length > 5, `${label} : trop peu d'éléments`);
  assert.ok(els.length <= 450, `${label} : trop d'éléments (${els.length})`);
  const json = JSON.stringify(els);
  assert.ok(!json.includes('NaN') && !json.includes('null') && !json.includes('undefined'), `${label} : valeur invalide`);
  const valid = els.map(e => wb.sanitizeElement(e, D));
  const rejected = valid.filter(v => v === null).length;
  assert.equal(rejected, 0, `${label} : ${rejected} élément(s) rejeté(s) par le validateur`);
}

test('tous les gabarits produisent des éléments valides, bornés et en nombre raisonnable', () => {
  const d = designer();
  for (const name of lib.TEMPLATE_NAMES) {
    const box = name === 'mobile_app' ? { x: 100, y: 40, w: 380, h: 800 } : BOX;
    checkElements(d.templates[name](box, { brand: 'Maison Lumière' }), name);
  }
});

test('tous les composants fonctionnent avec leurs paramètres par défaut', () => {
  const d = designer();
  for (const name of lib.COMPONENT_NAMES) {
    const box = name === 'icon' ? { x: 50, y: 50, w: 40, h: 40 } : name === 'button' || name === 'badge' ? { x: 50, y: 50, w: 200, h: 44 } : { x: 50, y: 50, w: 900, h: 420 };
    const els = d.components[name](box, name === 'icon' ? { name: 'cart' } : {});
    assert.ok(els.length >= 1, name);
    assert.equal(els.filter(e => wb.sanitizeElement(e, D) === null).length, 0, name + ' : éléments invalides');
  }
});

test('contenu fourni par l\'IA : textes tronqués, listes bornées, types inattendus tolérés', () => {
  const d = designer();
  const els = d.templates.ecommerce_home(BOX, {
    brand: 'X'.repeat(500), menu: 'pas une liste', products: [{ name: 'Y'.repeat(300), price: 42 }, null, 'bizarre'],
    hero: { title: 'T'.repeat(400), cta: { objet: true } },
  });
  checkElements(els, 'ecommerce_home bruité');
  assert.ok(els.every(e => e.kind !== 'text' || e.text.length <= 120));
});

test('thème : surcharge de couleurs valides seulement, mode sombre', () => {
  const t = lib.buildTheme({ mode: 'dark', primary: '#ff0000', accent: 'rouge', dark: '#12' });
  assert.equal(t.primary, '#ff0000');
  assert.equal(t.accent, lib.THEMES.dark.accent);
  assert.equal(t.dark, lib.THEMES.dark.dark);
  assert.equal(t.bg, lib.THEMES.dark.bg);
});

test('icônes : toutes dessinables, nom inconnu remplacé par une étoile', () => {
  const d = designer();
  for (const name of lib.ICON_NAMES) assert.ok(d.components.icon({ x: 10, y: 10, w: 30, h: 30 }, { name }).length >= 1, name);
  assert.ok(d.components.icon({ x: 10, y: 10, w: 30, h: 30 }, { name: 'inconnue' }).length >= 1);
  assert.ok(lib.ICON_NAMES.length >= 20);
});

test('un gabarit tient dans sa boîte (aucun élément hors du cadre demandé)', () => {
  const d = designer();
  const box = { x: 200, y: 100, w: 800, h: 600 };
  const els = d.templates.landing(box, {});
  const x2 = (box.x + box.w) / 1600 + 0.004, y2 = (box.y + box.h) / 900 + 0.004;
  const out = els.filter(e => (e.x !== undefined && (e.x < box.x / 1600 - 0.004 || e.x > x2)) || (e.y !== undefined && (e.y < box.y / 900 - 0.004 || e.y > y2)));
  assert.equal(out.length, 0, 'éléments hors boîte : ' + JSON.stringify(out.slice(0, 2)));
});

test('toutes les couleurs produites sont des #RRGGBB (le tableau refuse #RRGGBBAA : barres et pastilles disparaissaient)', () => {
  const d = designer();
  const six = /^#[0-9a-f]{6}$/i;
  for (const name of lib.TEMPLATE_NAMES) {
    const box = name === 'mobile_app' ? { x: 100, y: 40, w: 380, h: 800 } : BOX;
    for (const e of d.templates[name](box, {})) {
      for (const k of ['color', 'fill']) if (e[k] !== undefined) assert.match(e[k], six, `${name} : ${k}=${e[k]}`);
    }
  }
  const bars = d.components.chart_bars({ x: 50, y: 50, w: 700, h: 400 }, { values: [10, 40, 25] }).filter(e => e.kind === 'rect' && e.fill && e.fill !== lib.THEMES.light.card);
  assert.ok(bars.length >= 3);                                                          // chaque barre a bien une couleur de fond valide
});

test('tableau et bannière : le contenu reste dans sa boîte', () => {
  const d = designer();
  const table = d.components.table_simple({ x: 100, y: 100, w: 400, h: 300 }, { headers: ['A', 'B'], rows: [['1', '2', 'troisième cellule en trop', 'quatrième']] });
  assert.ok(table.every(e => e.kind !== 'text' || e.x <= (100 + 400) / 1600));          // aucune cellule hors de la carte
  const banner = d.components.banner({ x: 50, y: 50, w: 320, h: 110 }, { title: 'Un titre vraiment très long pour un petit écran', cta: 'Acheter' });
  const title = banner.find(e => e.kind === 'text' && e.text.startsWith('Un titre'));
  assert.ok(title.size <= 7, 'le titre doit rétrécir pour tenir dans la bannière');
});
