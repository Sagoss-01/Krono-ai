const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stub, fresh } = require('./helpers');

process.env.SCHEDULED_MAIL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));

/** Mini base en mémoire : interprète uniquement les requêtes de scheduledEmailService. */
function fakeDb() {
  const rows = []; let seq = 0;
  const run = async (sql, p = []) => {
    sql = sql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT COUNT(*) AS n FROM scheduled_emails')) return [[{ n: rows.filter(r => r.owner_email === p[0] && ['pending', 'sending'].includes(r.status)).length }]];
    if (sql.startsWith('INSERT INTO scheduled_emails')) { const r = { id: ++seq, owner_email: p[0], send_at: p[1], status: 'pending', attempts: 0, creds_enc: p[2], payload_enc: p[3], last_error: null }; rows.push(r); return [{ insertId: r.id }]; }
    if (sql.startsWith('DELETE FROM scheduled_emails WHERE id')) { const i = rows.findIndex(r => r.id === p[0]); if (i >= 0) rows.splice(i, 1); return [{}]; }
    if (sql.startsWith("UPDATE scheduled_emails SET status = 'cancelled'")) { const r = rows.find(x => x.id === p[1] && x.owner_email === p[2] && x.status === 'pending'); if (!r) return [{ affectedRows: 0 }]; r.status = 'cancelled'; return [{ affectedRows: 1 }]; }
    if (sql.startsWith("UPDATE scheduled_emails SET creds_enc = ''")) { const r = rows.find(x => x.id === p[0]); r.creds_enc = ''; r.payload_enc = ''; return [{}]; }
    if (sql.startsWith("SELECT id FROM scheduled_emails WHERE status = 'pending' AND send_at <=")) return [rows.filter(r => r.status === 'pending' && r.send_at <= p[0]).sort((a, b) => (a.send_at < b.send_at ? -1 : 1)).map(r => ({ id: r.id }))];
    if (sql.startsWith("UPDATE scheduled_emails SET status = 'sending'")) { const r = rows.find(x => x.id === p[1] && x.status === 'pending'); if (!r) return [{ affectedRows: 0 }]; r.status = 'sending'; r.attempts++; r.claimed_at = p[0]; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('SELECT id, owner_email, attempts, creds_enc, payload_enc')) return [[rows.find(r => r.id === p[0])]];
    if (sql.startsWith("UPDATE scheduled_emails SET status = 'sent'")) { const r = rows.find(x => x.id === p[1]); r.status = 'sent'; return [{}]; }
    if (sql.startsWith("UPDATE scheduled_emails SET status = 'pending', send_at")) { const r = rows.find(x => x.id === p[2]); Object.assign(r, { status: 'pending', send_at: p[0], last_error: p[1] }); return [{}]; }
    if (sql.startsWith("UPDATE scheduled_emails SET status = 'failed'")) { const r = rows.find(x => x.id === p[2]); Object.assign(r, { status: 'failed', last_error: p[1] }); return [{}]; }
    if (sql.startsWith("UPDATE scheduled_emails SET status = 'pending' WHERE status = 'sending'")) { let n = 0; rows.forEach(r => { if (r.status === 'sending' && r.claimed_at < p[0]) { r.status = 'pending'; n++; } }); return [{ affectedRows: n }]; }
    if (sql.startsWith('SELECT id FROM scheduled_emails WHERE owner_email')) return [rows.filter(r => r.owner_email === p[0]).map(r => ({ id: r.id }))];
    if (sql.startsWith('DELETE FROM scheduled_emails WHERE owner_email')) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].owner_email === p[0]) rows.splice(i, 1); return [{}]; }
    throw new Error('requête non gérée par la base factice : ' + sql.slice(0, 80));
  };
  return { rows, pool: { execute: run, query: run } };
}

function load({ configured = true } = {}) {
  const db = fakeDb(); const mails = [];
  const restores = [
    stub('src/services/db.js', { pool: db.pool }),
    stub('src/services/messageCrypto.js', { isConfigured: configured, encryptContent: (v) => 'enc:' + Buffer.from(String(v)).toString('base64'), decryptContent: (v) => Buffer.from(String(v).replace(/^enc:/, ''), 'base64').toString() }),
    stub('src/services/systemMailer.js', { sendSystemMail: async (m) => mails.push(m) }),
  ];
  const svc = fresh('src/services/scheduledEmailService.js');
  return { svc, db, mails, restore: () => { restores.reverse().forEach(r => r()); } };
}
const creds = { email: 'aude@x.com', password: 'secret-smtp' };
const mail = (extra = {}) => ({ to: 'jean@x.com', subject: 'Rapport', body: 'Bonjour', ...extra });
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();

test('programmation : identifiants et contenu sont CHIFFRÉS en base (jamais en clair)', async () => {
  const t = load();
  try {
    const id = await t.svc.create({ owner: creds.email, creds, mail: mail(), sendAt: inFuture(3600000) });
    const row = t.db.rows.find(r => r.id === id);
    assert.ok(row.creds_enc.startsWith('enc:') && !row.creds_enc.includes('secret-smtp'));        // passé par le chiffrement, mot de passe jamais lisible tel quel
    assert.ok(row.payload_enc.startsWith('enc:') && !row.payload_enc.includes('Rapport'));
    assert.equal(row.status, 'pending');
  } finally { t.restore(); }
});

test('programmation : refusée sans clé de chiffrement (on ne stocke jamais un mot de passe en clair)', async () => {
  const t = load({ configured: false });
  try { await assert.rejects(() => t.svc.create({ owner: creds.email, creds, mail: mail(), sendAt: inFuture(3600000) }), /clé de chiffrement/); assert.equal(t.db.rows.length, 0); }
  finally { t.restore(); }
});

test('programmation : dates invalides, au-delà de 30 jours et plafond de 20 envois refusés', async () => {
  const t = load();
  try {
    await assert.rejects(() => t.svc.create({ owner: 'a', creds, mail: mail(), sendAt: inFuture(-1000) }), /futur/);
    await assert.rejects(() => t.svc.create({ owner: 'a', creds, mail: mail(), sendAt: 'n importe quoi' }), /futur/);
    await assert.rejects(() => t.svc.create({ owner: 'a', creds, mail: mail(), sendAt: inFuture(31 * 86400000) }), /30 jours/);
    for (let i = 0; i < t.svc.MAX_PENDING; i++) await t.svc.create({ owner: 'a', creds, mail: mail(), sendAt: inFuture(3600000) });
    await assert.rejects(() => t.svc.create({ owner: 'a', creds, mail: mail(), sendAt: inFuture(3600000) }), /déjà 20/);
    await t.svc.create({ owner: 'b', creds, mail: mail(), sendAt: inFuture(3600000) });                       // un autre compte n'est pas concerné
  } finally { t.restore(); }
});

test('envoi : ce qui est dû part (pièces jointes déchiffrées), le reste attend ; secrets effacés ensuite', async () => {
  const t = load();
  try {
    const due = await t.svc.create({ owner: creds.email, creds, mail: mail({ subject: 'Maintenant' }), sendAt: inFuture(31000), files: [{ originalname: 'devis.pdf', mimetype: 'application/pdf', buffer: Buffer.from('CONTENU-PDF') }] });
    const later = await t.svc.create({ owner: creds.email, creds, mail: mail({ subject: 'Plus tard' }), sendAt: inFuture(3600000) });
    t.db.rows.find(r => r.id === due).send_at = new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' ');   // devenu dû
    const sent = [];
    const n = await t.svc.runDue(async (c, m) => { sent.push({ c, m }); });
    assert.equal(n, 1);
    assert.equal(sent[0].c.password, 'secret-smtp'); assert.equal(sent[0].m.subject, 'Maintenant');
    assert.equal(sent[0].m.attachments[0].buffer.toString(), 'CONTENU-PDF');
    const row = t.db.rows.find(r => r.id === due);
    assert.deepEqual([row.status, row.creds_enc, row.payload_enc], ['sent', '', '']);                       // mot de passe et contenu effacés
    assert.ok(!fs.existsSync(path.join(process.env.SCHEDULED_MAIL_DIR, String(due))));                       // fichiers supprimés
    assert.equal(t.db.rows.find(r => r.id === later).status, 'pending');
    assert.equal(await t.svc.runDue(async () => { throw new Error('ne doit pas être appelé'); }), 0);       // rien de dû, rien d'envoyé deux fois
  } finally { t.restore(); }
});

test('envoi : jamais en double, même si deux exécutions se chevauchent', async () => {
  const t = load();
  try {
    const id = await t.svc.create({ owner: creds.email, creds, mail: mail(), sendAt: inFuture(31000) });
    t.db.rows[0].send_at = '2000-01-01 00:00:00';
    let count = 0;
    const send = async () => { count++; await new Promise(r => setTimeout(r, 20)); };
    await Promise.all([t.svc.runDue(send), t.svc.runDue(send)]);
    assert.equal(count, 1);
    assert.equal(t.db.rows.find(r => r.id === id).status, 'sent');
  } finally { t.restore(); }
});

test('échec : 3 tentatives espacées, puis abandon, effacement des secrets et prévenance de l\'utilisateur', async () => {
  const t = load();
  try {
    const id = await t.svc.create({ owner: creds.email, creds, mail: mail({ subject: 'Important' }), sendAt: inFuture(31000) });
    const row = () => t.db.rows.find(r => r.id === id);
    const fail = async () => { throw new Error('535 mot de passe refusé'); };
    for (let attempt = 1; attempt <= 3; attempt++) {
      row().send_at = '2000-01-01 00:00:00';
      await t.svc.runDue(fail);
      if (attempt < 3) { assert.equal(row().status, 'pending'); assert.ok(row().send_at > new Date().toISOString().slice(0, 19).replace('T', ' ')); assert.match(row().last_error, /535/); }
    }
    assert.equal(row().status, 'failed');
    assert.deepEqual([row().creds_enc, row().payload_enc], ['', '']);
    assert.equal(t.mails.length, 1);
    assert.equal(t.mails[0].to, creds.email); assert.match(t.mails[0].subject, /Important/);
    assert.equal(await t.svc.runDue(fail), 0);                                                               // plus jamais retenté
  } finally { t.restore(); }
});

test('annulation : réservée au propriétaire, efface le contenu ; reprise des envois bloqués', async () => {
  const t = load();
  try {
    const id = await t.svc.create({ owner: creds.email, creds, mail: mail(), sendAt: inFuture(3600000) });
    assert.equal(await t.svc.cancel('intrus@x.com', id), false);
    assert.equal(t.db.rows[0].status, 'pending');
    assert.equal(await t.svc.cancel(creds.email, id), true);
    assert.deepEqual([t.db.rows[0].status, t.db.rows[0].creds_enc], ['cancelled', '']);
    assert.equal(await t.svc.cancel(creds.email, id), false);

    const stuck = await t.svc.create({ owner: creds.email, creds, mail: mail(), sendAt: inFuture(3600000) });
    Object.assign(t.db.rows.find(r => r.id === stuck), { status: 'sending', claimed_at: '2000-01-01 00:00:00' });
    assert.equal(await t.svc.recoverStuck(), 1);
    assert.equal(t.db.rows.find(r => r.id === stuck).status, 'pending');
  } finally { t.restore(); }
});

test('RGPD : deleteAllFor supprime les lignes et les fichiers du compte', async () => {
  const t = load();
  try {
    const id = await t.svc.create({ owner: creds.email, creds, mail: mail(), sendAt: inFuture(3600000), files: [{ originalname: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from('x') }] });
    assert.ok(fs.existsSync(path.join(process.env.SCHEDULED_MAIL_DIR, String(id))));
    await t.svc.deleteAllFor(creds.email);
    assert.equal(t.db.rows.length, 0);
    assert.ok(!fs.existsSync(path.join(process.env.SCHEDULED_MAIL_DIR, String(id))));
  } finally { t.restore(); }
});
