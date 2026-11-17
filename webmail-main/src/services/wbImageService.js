/**
 * src/services/wbImageService.js
 * Images du tableau blanc, sans jamais charger de ressource externe dans le navigateur des participants.
 *
 *  - Envoi depuis l'ordinateur : validation par SIGNATURE (PNG, JPEG, GIF, WebP — pas de SVG), taille et
 *    dimensions bornées, nom aléatoire, stockage hors du dossier public.
 *  - Import par lien : le SERVEUR télécharge l'image (HTTPS uniquement, adresses publiques uniquement,
 *    résolution DNS contrôlée à chaque connexion, 3 redirections max, 4 Mo max, 8 s max), puis la
 *    stocke comme un envoi. Les participants ne chargent donc que des images de notre propre domaine :
 *    pas de pixel espion, pas de fuite d'adresse IP, pas de canvas « contaminé » (export PNG/PDF intact).
 *  - Les fichiers sont servis par /wb-media/:fichier avec des en-têtes stricts, et supprimés après 3 jours.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');

const DIR = process.env.WB_MEDIA_DIR || path.join(__dirname, '..', '..', 'storage', 'wb-media');
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 8000;
const MAX_PIXELS = 40e6;
const TTL_MS = 3 * 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

class ImageError extends Error {}

// ── Lecture des dimensions / détection du vrai format (signature, jamais l'extension) ─────────────
function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  let ext = null, width = 0, height = 0;

  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString('latin1', 12, 16) === 'IHDR') {
    ext = 'png'; width = buf.readUInt32BE(16); height = buf.readUInt32BE(20);
  } else if (buf.toString('latin1', 0, 4) === 'GIF8' && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    ext = 'gif'; width = buf.readUInt16LE(6); height = buf.readUInt16LE(8);
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    ext = 'jpg';
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xd0 && marker <= 0xd9 || marker === 0x01) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); break;
      }
      i += 2 + len;
    }
  } else if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    ext = 'webp';
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8 ' && buf.length >= 30) {
      width = buf.readUInt16LE(26) & 0x3fff; height = buf.readUInt16LE(28) & 0x3fff;
    } else if (kind === 'VP8L' && buf.length >= 25) {
      width = 1 + (((buf[22] & 0x3f) << 8) | buf[21]);
      height = 1 + (((buf[24] & 0x0f) << 10) | (buf[23] << 2) | ((buf[22] & 0xc0) >> 6));
    } else if (kind === 'VP8X' && buf.length >= 30) {
      width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    }
  }
  if (!ext || !width || !height) return null;
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) return null;
  return { ext, mime: MIME[ext], width, height };
}

// ── Stockage ─────────────────────────────────────────────────────────────────────────────────────
let lastCleanup = 0;
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 10 * 60 * 1000) return;
  lastCleanup = now;
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      if (!NAME_RE.test(f)) continue;
      const p = path.join(DIR, f);
      fs.stat(p, (e, st) => { if (!e && now - st.mtimeMs > TTL_MS) fs.unlink(p, () => {}); });
    }
  });
}

/** Valide puis enregistre une image. @returns {{url,width,height,mime}} */
function saveBuffer(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new ImageError('Fichier vide.');
  if (buf.length > MAX_BYTES) throw new ImageError('Image trop lourde (4 Mo maximum).');
  const info = imageInfo(buf);
  if (!info) throw new ImageError('Format non pris en charge. Utilisez une image PNG, JPEG, GIF ou WebP (pas de SVG).');
  fs.mkdirSync(DIR, { recursive: true, mode: 0o750 });
  const name = crypto.randomBytes(16).toString('hex') + '.' + info.ext;
  fs.writeFileSync(path.join(DIR, name), buf, { flag: 'wx', mode: 0o640 });
  cleanup();
  return { url: '/wb-media/' + name, width: info.width, height: info.height, mime: info.mime };
}

/** Chemin absolu d'un fichier stocké (null si le nom n'est pas valide). */
function filePath(name) {
  if (!NAME_RE.test(String(name || ''))) return null;
  const p = path.join(DIR, name);
  return fs.existsSync(p) ? p : null;
}
const mimeFor = (name) => MIME[String(name).split('.').pop()] || 'application/octet-stream';

// ── Import par lien : protections SSRF ───────────────────────────────────────────────────────────
function isPublicIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;       // CGNAT
  if (a === 169 && b === 254) return false;                 // lien-local (métadonnées cloud)
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && p[2] === 0) || (b === 0 && p[2] === 2))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && p[2] === 100))) return false;
  if (a === 203 && b === 0 && p[2] === 113) return false;
  return true;
}

function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPublicIPv4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicIPv4(mapped[1]);
    if (/^::ffff:/.test(s) || /^64:ff9b:/.test(s)) return false;       // IPv4 mappé en hexadécimal / NAT64
    const first = parseInt(s.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false;                      // fc00::/7 (privé)
    if ((first & 0xffc0) === 0xfe80) return false;                      // fe80::/10 (lien-local)
    if ((first & 0xff00) === 0xff00) return false;                      // multicast
    if (s.startsWith('2001:db8') || s.startsWith('2001:0:') || s.startsWith('2002:')) return false;
    return true;
  }
  return false;
}

/** Valide une URL d'image distante AVANT tout accès réseau. @returns {URL} */
function validateRemoteUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_) { throw new ImageError('Lien invalide.'); }
  if (u.protocol !== 'https:') throw new ImageError('Seuls les liens https:// sont acceptés.');
  if (u.username || u.password) throw new ImageError('Lien invalide.');
  if (u.port && u.port !== '443') throw new ImageError('Port non autorisé.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !net.isIP(host)) {
    throw new ImageError('Adresse non autorisée.');
  }
  if (net.isIP(host) && !isPublicIp(host)) throw new ImageError('Adresse non autorisée.');
  if (u.href.length > 2000) throw new ImageError('Lien trop long.');
  return u;
}

/** Résolution DNS contrôlée : refuse toute adresse non publique, à CHAQUE connexion (anti DNS-rebinding). */
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some(a => !isPublicIp(a.address))) return cb(new ImageError('Adresse non autorisée.'));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function download(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = validateRemoteUrl(url); } catch (e) { return reject(e); }
    const req = https.get(u, {
      lookup: safeLookup, timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'TechSphere-Whiteboard/1.0', 'Accept': 'image/png,image/jpeg,image/gif,image/webp,*/*;q=0.1' },
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new ImageError('Trop de redirections.'));
        let next;
        try { next = new URL(res.headers.location, u).href; } catch (_) { return reject(new ImageError('Redirection invalide.')); }
        return resolve(download(next, redirectsLeft - 1));
      }
      if (status !== 200) { res.resume(); return reject(new ImageError(`Le serveur de l'image a répondu ${status}.`)); }
      const declared = parseInt(res.headers['content-length'] || '0', 10);
      if (declared > MAX_BYTES) { res.resume(); return reject(new ImageError('Image trop lourde (4 Mo maximum).')); }
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new ImageError('Image trop lourde (4 Mo maximum).')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new ImageError("Le serveur de l'image met trop de temps à répondre.")));
    req.on('error', (e) => reject(e instanceof ImageError ? e : new ImageError("Impossible de télécharger l'image.")));
  });
}

/** Télécharge une image distante et la stocke chez nous. @returns {{url,width,height,mime}} */
async function importFromUrl(rawUrl) {
  validateRemoteUrl(rawUrl);                                  // échec immédiat, sans réseau
  const buf = await download(rawUrl, MAX_REDIRECTS);
  return saveBuffer(buf);
}

module.exports = { imageInfo, saveBuffer, importFromUrl, validateRemoteUrl, isPublicIp, filePath, mimeFor, ImageError, MAX_BYTES, DIR };
