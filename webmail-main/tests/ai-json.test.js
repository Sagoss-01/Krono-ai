const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('../src/services/aiService');
const { ReplyStreamer, decodePartial } = require('../src/services/aiStream');

test('extractJson : JSON pur, bloc ```json et texte autour', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Voici : {"a":3} merci'), { a: 3 });
  assert.equal(extractJson('pas de json'), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson('{cassé'), null);
});

test('decodePartial : échappements, unicode et chaîne non terminée', () => {
  assert.deepEqual(decodePartial('Bonjour\\n\\"x\\" \\u00e9"suite'), { text: 'Bonjour\n"x" é', closed: true });
  assert.deepEqual(decodePartial('abc\\'), { text: 'abc', closed: false });          // échappement coupé : on attend
  assert.deepEqual(decodePartial('a\\u00'), { text: 'a', closed: false });
});

test('ReplyStreamer : n\'émet que le champ "reply", même coupé en morceaux', () => {
  const full = '{"reply":"Salut **toi**\\n- un","cards":[{"type":"contact","name":"reply"}]}';
  const s = new ReplyStreamer();
  let out = '';
  for (let i = 0; i < full.length; i += 4) out += s.feed(full.slice(i, i + 4));
  assert.equal(out, 'Salut **toi**\n- un');
});

test('ReplyStreamer : texte brut relayé tel quel, étape d\'outils silencieuse', () => {
  const plain = new ReplyStreamer();
  assert.equal(plain.feed('Salut ') + plain.feed('le monde'), 'Salut le monde');
  const tools = new ReplyStreamer();
  assert.equal(tools.feed('{"tools":[{"name":"search_mail","args":{}}]}'), '');
  const fenced = new ReplyStreamer();
  assert.equal(fenced.feed('```json\n{"reply":"ok"}'), 'ok');
});
