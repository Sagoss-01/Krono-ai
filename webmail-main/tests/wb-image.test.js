const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.WB_MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wbmedia-'));
const img = require('../src/services/wbImageService');

// Images minimales fabriquées à la main (seul l'en-tête compte pour la validation)
const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = (w, h) => { const b = Buffer.alloc(30); b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
const jpg = (w, h) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255]), Buffer.alloc(20)]);
const webp = (w, h) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1'); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };

test('imageInfo : reconnaît PNG, GIF, JPEG et WebP par leur signature, avec les dimensions', () => {
  assert.deepEqual(img.imageInfo(png(640, 480)), { ext: 'png', mime: 'image/png', width: 640, height: 480 });
  assert.deepEqual(img.imageInfo(gif(100, 50)), { ext: 'gif', mime: 'image/gif', width: 100, height: 50 });
  assert.deepEqual(img.imageInfo(jpg(1200, 800)), { ext: 'jpg', mime: 'image/jpeg', width: 1200, height: 800 });
  assert.deepEqual(img.imageInfo(webp(300, 200)), { ext: 'webp', mime: 'image/webp', width: 300, height: 200 });
});

test('imageInfo : refuse SVG, scripts, fichiers tronqués et dimensions démesurées', () => {
  assert.equal(img.imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(60))), null);
  assert.equal(img.imageInfo(Buffer.from('<html><script>alert(1)</script></html>'.padEnd(60))), null);
  assert.equal(img.imageInfo(Buffer.alloc(10)), null);
  assert.equal(img.imageInfo(png(9000, 100)), null);                 // > 8000 px
  assert.equal(img.imageInfo(png(8000, 8000)), null);                // > 40 millions de pixels
  assert.equal(img.imageInfo(png(0, 10)), null);
});

test('saveBuffer : écrit sous un nom aléatoire, renvoie une URL locale, refuse le reste', () => {
  const out = img.saveBuffer(png(10, 10));
  assert.match(out.url, /^\/wb-media\/[a-f0-9]{32}\.png$/);
  assert.equal(out.width, 10);
  const file = img.filePath(path.basename(out.url));
  assert.ok(file && fs.existsSync(file));
  assert.equal(img.mimeFor('x.webp'), 'image/webp');
  assert.throws(() => img.saveBuffer(Buffer.from('<svg></svg>'.padEnd(40))), /Format non pris en charge/);
  assert.throws(() => img.saveBuffer(Buffer.alloc(0)), /vide/);
  assert.throws(() => img.saveBuffer(Buffer.concat([png(10, 10), Buffer.alloc(img.MAX_BYTES)])), /trop lourde/);
});

test('filePath : noms invalides ou tentatives de traversée refusés', () => {
  for (const bad of ['../../etc/passwd', '..%2f..%2fx.png', 'abc.png', 'a'.repeat(32) + '.svg', '', null, 'a'.repeat(32) + '.png/../x']) assert.equal(img.filePath(bad), null, String(bad));
});

test('validateRemoteUrl : seuls les liens https publics sont acceptés (aucun accès réseau)', () => {
  assert.equal(img.validateRemoteUrl('https://example.com/a.png').hostname, 'example.com');
  for (const bad of [
    'http://example.com/a.png', 'ftp://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd',
    'https://localhost/a.png', 'https://sub.localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://0.0.0.0/a',
    'https://10.0.0.5/a.png', 'https://192.168.1.10/a.png', 'https://172.16.0.1/a.png', 'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/a', 'https://serveur-interne/a.png', 'https://monserveur.local/a.png', 'https://api.internal/a.png',
    'https://user:motdepasse@example.com/a.png', 'https://example.com:8443/a.png', 'https://example.com:22/a.png', 'pas un lien', '',
    'https://' + 'a'.repeat(2100) + '.com/x',
  ]) assert.throws(() => img.validateRemoteUrl(bad), img.ImageError, 'aurait dû être refusé : ' + bad.slice(0, 50));
});

test('isPublicIp : adresses privées, mappées IPv4, multicast et documentation refusées', () => {
  for (const ok of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(img.isPublicIp(ok), true, ok);
  for (const bad of ['0.0.0.0', '127.0.0.1', '10.1.2.3', '172.31.255.255', '192.168.0.1', '169.254.1.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '64:ff9b::7f00:1', 'pas une ip']) assert.equal(img.isPublicIp(bad), false, bad);
});

test('importFromUrl : un lien dangereux échoue immédiatement, sans réseau', async () => {
  for (const bad of ['https://127.0.0.1/a.png', 'http://example.com/a.png', 'https://169.254.169.254/x']) await assert.rejects(() => img.importFromUrl(bad), img.ImageError);
});
