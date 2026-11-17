/**
 * src/services/imap.js
 * + getQuota() : espace utilisé via IMAP GETQUOTA (RFC 2087)
 */
const Imap             = require('imap');
const { simpleParser } = require('mailparser');
const logger           = require('./logger');

const IMAP_CONFIG = {
  host:        'mail.netiify.cloud',
  port:        993,
  tls:         true,
  tlsOptions:  { rejectUnauthorized: false },
  connTimeout: 20000,
  authTimeout: 15000,
};

function createConn(credentials) {
  return new Imap({ user: credentials.email, password: credentials.password, ...IMAP_CONFIG });
}

// ─── Décodage RFC2047 ────────────────────────────────────────────────────────
function decodeEncodedWord(str) {
  if (!str || !str.includes('=?')) return str;
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      return Buffer.from(data.replace(/_/g, ' '), 'binary').toString('utf8');
    } catch (_) { return match; }
  });
}

// ─── Test connexion ──────────────────────────────────────────────────────────
function testConnection(credentials) {
  return new Promise((resolve, reject) => {
    logger.auth(credentials.email, 'INFO', 'Tentative connexion IMAP');
    const imap = createConn(credentials);
    imap.once('ready', () => { logger.auth(credentials.email, 'INFO', 'Connexion IMAP OK'); imap.end(); resolve(true); });
    imap.once('error', err => { logger.auth(credentials.email, 'ERROR', 'Échec connexion', { message: err.message }); reject(err); });
    imap.connect();
  });
}

// ─── Dossiers ────────────────────────────────────────────────────────────────
function getFolders(credentials) {
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      imap.getBoxes((err, boxes) => {
        if (err) { imap.end(); return reject(err); }
        const folders = [];
        const walk = (obj, prefix) => {
          for (const name in obj) {
            const delim = obj[name].delimiter || '/';
            const full  = prefix ? `${prefix}${delim}${name}` : name;
            folders.push(full);
            if (obj[name].children) walk(obj[name].children, full);
          }
        };
        walk(boxes, '');
        imap.end(); resolve(folders);
      });
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

// ─── Quota disque (IMAP GETQUOTA) ───────────────────────────────────────────
function getQuota(credentials) {
  return new Promise((resolve) => {
    const imap = createConn(credentials);
    let resolved = false;
    let timeoutId = null;

    const done = (result) => {
      if (resolved) return;
      resolved = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      try {
        if (imap.state !== 'disconnected') {
          imap.end();
        }
      } catch (_) {}

      resolve(result);
    };

    imap.once('ready', () => {
      try {
        // Vérifie explicitement si le serveur annonce QUOTA après authentification
        if (typeof imap.serverSupports === 'function' && !imap.serverSupports('QUOTA')) {
          logger.imap(credentials.email, 'WARN', 'QUOTA non annoncé après login');
          return done({
            available: false,
            reason: 'quota_not_supported',
            message: 'Le serveur IMAP n’annonce pas la capacité QUOTA après authentification.'
          });
        }

        imap.getQuotaRoot('INBOX', (err, info) => {
          if (err) {
            logger.imap(credentials.email, 'WARN', `GETQUOTAROOT err: ${err.message}`);
            return done({
              available: false,
              reason: 'getquotaroot_error',
              message: err.message
            });
          }

          // Log brut pour debug
          try {
            logger.imap(
              credentials.email,
              'INFO',
              `GETQUOTAROOT raw: ${JSON.stringify(info)}`
            );
          } catch (_) {}

          try {
            let used = null;
            let limit = null;
            let quotaRoot = null;

            /**
             * node-imap peut renvoyer une structure du genre :
             * {
             *   "User quota": {
             *     storage: { usage: 12345, limit: 1048576 }
             *   }
             * }
             *
             * ou parfois avec d'autres variantes de casse.
             */
            for (const rootName of Object.keys(info || {})) {
              const root = info[rootName];
              if (!root || typeof root !== 'object') continue;

              const storage =
                root.storage ||
                root.STORAGE ||
                (root.resources && (root.resources.storage || root.resources.STORAGE));

              if (
                storage &&
                typeof storage.usage !== 'undefined' &&
                typeof storage.limit !== 'undefined'
              ) {
                used = Number(storage.usage);
                limit = Number(storage.limit);
                quotaRoot = rootName;
                break;
              }
            }

            if (
              Number.isFinite(used) &&
              Number.isFinite(limit) &&
              used >= 0 &&
              limit >= 0
            ) {
              const usedBytes = used * 1024;
              const limitBytes = limit * 1024;
              const percent = limit > 0 ? (used / limit) * 100 : 0;

              return done({
                available: true,
                quotaRoot,
                used,          // en KB
                limit,         // en KB
                usedBytes,
                limitBytes,
                percent,
                raw: info
              });
            }

            logger.imap(
              credentials.email,
              'WARN',
              `GETQUOTAROOT réponse non reconnue: ${JSON.stringify(info)}`
            );

            return done({
              available: false,
              reason: 'quota_response_unparsed',
              message: 'Réponse quota reçue mais structure non reconnue.',
              raw: info
            });
          } catch (parseErr) {
            logger.imap(credentials.email, 'WARN', `GETQUOTAROOT parse err: ${parseErr.message}`);
            return done({
              available: false,
              reason: 'quota_parse_error',
              message: parseErr.message,
              raw: info
            });
          }
        });
      } catch (e) {
        logger.imap(credentials.email, 'WARN', `GETQUOTAROOT exception: ${e.message}`);
        return done({
          available: false,
          reason: 'quota_exception',
          message: e.message
        });
      }
    });

    imap.once('error', (err) => {
      logger.imap(credentials.email, 'WARN', `IMAP error: ${err?.message || 'unknown error'}`);
      done({
        available: false,
        reason: 'imap_error',
        message: err?.message || 'Erreur IMAP inconnue'
      });
    });

    timeoutId = setTimeout(() => {
      logger.imap(credentials.email, 'WARN', 'GETQUOTAROOT timeout');
      done({
        available: false,
        reason: 'timeout',
        message: 'Délai dépassé lors de la récupération du quota'
      });
    }, 8000);

    try {
      imap.connect();
    } catch (e) {
      logger.imap(credentials.email, 'WARN', `IMAP connect exception: ${e.message}`);
      done({
        available: false,
        reason: 'connect_exception',
        message: e.message
      });
    }
  });
}
// ─── Détection pièces jointes ────────────────────────────────────────────────
function hasAttachmentInStruct(struct) {
  if (!struct) return false;
  if (Array.isArray(struct)) return struct.some(s => hasAttachmentInStruct(s));
  if (struct.disposition && struct.disposition.type &&
      struct.disposition.type.toLowerCase() === 'attachment') return true;
  return false;
}

// ─── Décodeurs MIME ───────────────────────────────────────────────────────────

// Quoted-printable → Buffer UTF-8 correct (gère les séquences multi-octets)
function decodeQP(str) {
  // 1. Supprimer les soft line breaks (=\r\n ou =\n)
  const joined = str.replace(/=\r?\n/g, '');
  // 2. Collecter les octets hex consécutifs pour les décoder en UTF-8 via Buffer
  const bytes = [];
  let i = 0;
  while (i < joined.length) {
    if (joined[i] === '=' && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    // Caractère normal — vider le buffer accumulé d'abord
    if (bytes.length) {
      // déjà géré ci-dessous par flush
    }
    bytes.push(joined.charCodeAt(i));
    i++;
  }
  // Décoder en UTF-8 via Buffer (gère é, à, ç, etc.)
  return Buffer.from(bytes).toString('utf-8');
}

// Nettoyer les balises HTML et entités
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|div|li|tr|td|th|h[1-6])[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Extraire le corps texte d'une partie MIME
function extractPartBody(part) {
  const sepCRLF = part.indexOf('\r\n\r\n');
  const sepLF   = part.indexOf('\n\n');
  const sep      = sepCRLF !== -1 ? sepCRLF + 4 : (sepLF !== -1 ? sepLF + 2 : -1);
  if (sep === -1) return '';
  const headers  = part.slice(0, sep).toLowerCase();
  let   body     = part.slice(sep, sep + 2000);

  const isQP     = headers.includes('quoted-printable');
  const isB64    = headers.includes('base64');
  const isHtml   = /content-type:\s*text\/html/.test(headers);

  if (isQP)  body = decodeQP(body);
  if (isB64) { try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8'); } catch(_) {} }
  if (isHtml) body = stripHtml(body);

  return body.replace(/\s+/g, ' ').trim();
}

// ─── Extraction snippet pour aperçu ──────────────────────────────────────────
function extractSnippet(raw) {
  // 1. Détecter si c'est du multipart
  const boundaryMatch = raw.match(/boundary=["']?([^\s"';\r\n]+)["']?/i);

  let text = '';

  if (boundaryMatch) {
    // MIME multipart — trouver la partie text/plain en premier
    const boundary = boundaryMatch[1];
    const parts = raw.split(new RegExp('--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    // Passe 1 : chercher text/plain
    for (const part of parts) {
      if (!/content-type:\s*text\/plain/i.test(part)) continue;
      text = extractPartBody(part);
      if (text.length > 10) break;
    }
    // Passe 2 : fallback sur text/html
    if (text.length < 10) {
      for (const part of parts) {
        if (!/content-type:\s*text\/html/i.test(part)) continue;
        text = extractPartBody(part);
        if (text.length > 10) break;
      }
    }
  } else {
    // Message simple sans multipart
    text = extractPartBody(raw);
    // Si pas de séparateur de corps, essayer directement
    if (!text) {
      text = stripHtml(raw).replace(/\s+/g, ' ').trim();
    }
  }

  return text.slice(0, 200);
}

// ─── Liste emails ─────────────────────────────────────────────────────────────
function fetchEmails(credentials, folder, limit) {
  folder = folder || 'INBOX'; limit = limit || 80;
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    const emails = []; let done = false;
    const finish = (err) => {
      if (done) return; done = true;
      try { imap.end(); } catch(_) {}
      if (err) { reject(err); return; }
      resolve([...emails].reverse());
    };
    imap.once('error', err => finish(err));
    imap.once('ready', () => {
      imap.openBox(folder, true, (openErr, box) => {
        if (openErr) return finish(openErr);
        const total = box.messages.total;
        if (total === 0) return finish(null);
        const start = Math.max(1, total - limit + 1);
        let fetchReq;
        try {
          fetchReq = imap.seq.fetch(`${start}:*`, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE CC MESSAGE-ID IN-REPLY-TO REFERENCES X-SPAM-STATUS DKIM-SIGNATURE)', 'TEXT'],
            struct: true, markSeen: false,
          });
        } catch(e) { return finish(e); }
        fetchReq.on('message', (msg, seqno) => {
          const email = { seqno, uid: null, flags: [], headers: {}, hasAttachment: false, size: 0 };
          msg.on('body', (stream, info) => {
            let buf = '';
            stream.on('data', c => { buf += c.toString('utf8'); });
            stream.on('end', () => {
              if (info.which.startsWith('HEADER')) {
                try {
                  const p = Imap.parseHeader(buf);
                  email.headers = {
                    from:       decodeEncodedWord(p.from    ? p.from[0]    : ''),
                    to:         decodeEncodedWord(p.to      ? p.to[0]      : ''),
                    subject:    decodeEncodedWord(p.subject ? p.subject[0] : '(Sans sujet)'),
                    date:       p.date ? new Date(p.date[0]) : new Date(),
                    cc:         decodeEncodedWord(p.cc      ? p.cc[0]      : ''),
                    messageId:  p['message-id']  ? p['message-id'][0].trim()  : '',
                    inReplyTo:  p['in-reply-to'] ? p['in-reply-to'][0].trim() : '',
                    references: p['references']  ? p['references'][0].trim()  : '',
                    spamStatus: p['x-spam-status'] ? p['x-spam-status'][0] : '',
                    hasDkim:    !!(p['dkim-signature'] && p['dkim-signature'][0]),
                  };
                } catch(_) {}
              } else if (info.which === 'TEXT') {
                // Extraire un snippet lisible du corps MIME
                try {
                  email.snippet = extractSnippet(buf);
                } catch(_) { email.snippet = ''; }
              }
            });
          });
          msg.once('attributes', attrs => {
            email.uid = attrs.uid; email.flags = attrs.flags || [];
            email.size = attrs.size || 0;
            if (attrs.struct) email.hasAttachment = hasAttachmentInStruct(attrs.struct);
          });
          msg.once('end', () => emails.push(email));
        });
        fetchReq.once('error', err => finish(err));
        fetchReq.once('end',   () => finish(null));
      });
    });
    imap.connect();
  });
}

// ─── Corps email complet ─────────────────────────────────────────────────────
function fetchEmailBody(credentials, uid, folder) {
  folder = folder || 'INBOX';
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    let raw = '', done = false;
    const finish = (err, result) => {
      if (done) return; done = true;
      try { imap.end(); } catch(_) {}
      if (err) reject(err); else resolve(result);
    };
    imap.once('error', err => finish(err));
    imap.once('ready', () => {
      imap.openBox(folder, false, (err) => {
        if (err) return finish(err);
        let fetchReq;
        try { fetchReq = imap.fetch([uid], { bodies: '', markSeen: true, struct: true }); }
        catch(e) { return finish(e); }
        fetchReq.on('message', (msg) => { msg.on('body', (stream) => { stream.on('data', c => { raw += c.toString('utf8'); }); }); });
        fetchReq.once('error', err => finish(err));
        fetchReq.once('end', () => {
          if (!raw) return finish(new Error('Corps vide'));
          simpleParser(raw).then(p => {
            finish(null, {
              html: p.html || '', text: p.text || '',
              subject: decodeEncodedWord(p.subject) || '',
              from: p.from ? p.from.text : '', to: p.to ? p.to.text : '',
              cc:   p.cc   ? p.cc.text   : '', date: p.date || new Date(),
              attachments: (p.attachments || []).map(a => ({
                filename: a.filename || 'fichier', contentType: a.contentType || 'application/octet-stream',
                size: a.size || (a.content ? a.content.length : 0), content: a.content,
              })),
            });
          }).catch(err => finish(err));
        });
      });
    });
    imap.connect();
  });
}

// ─── Suppression ─────────────────────────────────────────────────────────────
function deleteEmail(credentials, uid, folder) {
  folder = folder || 'INBOX';
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      imap.openBox(folder, false, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.addFlags([uid], '\\Deleted', (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.expunge((err) => { imap.end(); if (err) return reject(err); resolve(true); });
        });
      });
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

// ─── Status boîte ────────────────────────────────────────────────────────────
function getMailboxStatus(credentials, folder) {
  folder = folder || 'INBOX';
  return new Promise((resolve) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      imap.openBox(folder, true, (err, box) => {
        if (err || !box) { imap.end(); resolve({ unseen: 0, total: 0, uidnext: 0 }); return; }
        const s = { unseen: box.messages.unseen || 0, total: box.messages.total || 0, uidnext: box.uidnext || 0 };
        imap.end(); resolve(s);
      });
    });
    imap.once('error', () => resolve({ unseen: 0, total: 0, uidnext: 0 }));
    imap.connect();
  });
}

function getUnreadCount(credentials, folder) {
  return getMailboxStatus(credentials, folder).then(s => s.unseen);
}

// ─── Set/Unset flag ──────────────────────────────────────────────────────────
function setFlag(credentials, uid, folder, flag, set) {
  folder = folder || 'INBOX';
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      imap.openBox(folder, false, (err) => {
        if (err) { imap.end(); return reject(err); }
        const fn = set ? imap.addFlags.bind(imap) : imap.delFlags.bind(imap);
        fn([uid], flag, (err) => { imap.end(); if (err) return reject(err); resolve(true); });
      });
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

// exports moved to end of file

// ─── Déplacer un email vers un autre dossier ─────────────────────────────────
function moveEmail(credentials, uid, fromFolder, toFolder) {
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      imap.openBox(fromFolder, false, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.move([uid], toFolder, (err) => {
          imap.end();
          if (err) return reject(err);
          resolve(true);
        });
      });
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

// ─── Sauvegarder un brouillon (APPEND dans Drafts) ──────────────────────────
function saveDraft(credentials, { to, cc, bcc, subject, body, messageId }) {
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      const mid   = messageId || `<draft-${Date.now()}@netiify.cloud>`;
      const date  = new Date();
      const raw   = [
        `Message-ID: ${mid}`,
        `Date: ${date.toUTCString()}`,
        `From: ${credentials.email}`,
        `To: ${to || ''}`,
        cc  ? `Cc: ${cc}` : '',
        bcc ? `Bcc: ${bcc}` : '',
        `Subject: ${subject || '(Sans sujet)'}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: 8bit`,
        `X-Draft: 1`,
        '',
        body || '',
      ].filter(l => l !== null).join('\r\n');

      // Essayer Drafts puis INBOX.Drafts
      const tryAppend = (folder) => {
        imap.append(raw, { mailbox: folder, flags: ['\\Draft'], date }, (err) => {
          if (err && folder === 'Drafts') {
            tryAppend('INBOX.Drafts');
          } else if (err) {
            imap.end(); reject(err);
          } else {
            imap.end(); resolve({ ok: true, messageId: mid });
          }
        });
      };
      tryAppend('Drafts');
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

// ─── Recherche avancée IMAP ──────────────────────────────────────────────────
function searchEmails(credentials, folder, criteria) {
  // criteria: { from, subject, since, before, minSize, maxSize, hasAttachment }
  folder = folder || 'INBOX';
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    const results = [];
    let done = false;
    const finish = (err) => {
      if (done) return; done = true;
      try { imap.end(); } catch(_) {}
      if (err) reject(err); else resolve(results.reverse());
    };

    imap.once('ready', () => {
      imap.openBox(folder, true, (err) => {
        if (err) return finish(err);

        // Construire les critères de recherche IMAP
        const search = ['ALL'];
        if (criteria.from)    search.push(['FROM',    criteria.from]);
        if (criteria.subject) search.push(['SUBJECT', criteria.subject]);
        if (criteria.since)   search.push(['SINCE',   new Date(criteria.since)]);
        if (criteria.before)  search.push(['BEFORE',  new Date(criteria.before)]);
        if (criteria.unread)  search.push('UNSEEN');
        if (criteria.starred) search.push('FLAGGED');
        if (criteria.hasAttachment) search.push(['HEADER', 'Content-Type', 'multipart']);

        imap.search(search, (err, uids) => {
          if (err || !uids || uids.length === 0) return finish(err);

          // Limiter à 50 résultats les plus récents
          const limited = uids.slice(-50);
          const fetch = imap.fetch(limited, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE CC MESSAGE-ID IN-REPLY-TO REFERENCES X-SPAM-STATUS DKIM-SIGNATURE)'],
            struct: true, markSeen: false,
          });

          fetch.on('message', (msg) => {
            const email = { uid: null, flags: [], headers: {}, hasAttachment: false, size: 0 };
            msg.on('body', (stream) => {
              let buf = '';
              stream.on('data', c => { buf += c.toString('utf8'); });
              stream.on('end', () => {
                try {
                  const p = Imap.parseHeader(buf);
                  email.headers = {
                    from:    decodeEncodedWord(p.from?.[0] || ''),
                    to:      decodeEncodedWord(p.to?.[0] || ''),
                    subject: decodeEncodedWord(p.subject?.[0] || '(Sans sujet)'),
                    date:    p.date ? new Date(p.date[0]) : new Date(),
                    cc:      decodeEncodedWord(p.cc?.[0] || ''),
                  };
                } catch(_) {}
              });
            });
            msg.once('attributes', attrs => {
              email.uid = attrs.uid; email.flags = attrs.flags || [];
              email.size = attrs.size || 0;
              if (attrs.struct) email.hasAttachment = hasAttachmentInStruct(attrs.struct);
            });
            msg.once('end', () => results.push(email));
          });
          fetch.once('error', err => finish(err));
          fetch.once('end', () => finish(null));
        });
      });
    });
    imap.once('error', err => finish(err));
    imap.connect();
  });
}

// ─── Sauvegarde dans Sent après envoi SMTP ──────────────────────────────────
function saveToSent(credentials, { to, cc, bcc, subject, htmlBody, textBody, attachments, messageId } = {}) {
  return new Promise((resolve, reject) => {
    const imap = createConn(credentials);
    imap.once('ready', () => {
      const mid      = messageId || `<sent-${Date.now()}@netiify.cloud>`;
      const date     = new Date();
      const boundary = `----=_Part_${Date.now().toString(36)}`;
      const hasAtt   = attachments && attachments.length > 0;

      // Corps HTML encodé en base64 (fiable quelle que soit l'implémentation serveur)
      const htmlContent   = htmlBody || textBody || '';
      const htmlB64       = Buffer.from(htmlContent, 'utf-8').toString('base64').match(/.{1,76}/g).join('\r\n');

      // ── Headers communs ────────────────────────────────────────────────────
      const topHeaders = [
        `Message-ID: ${mid}`,
        `Date: ${date.toUTCString()}`,
        `From: ${credentials.email}`,
        `To: ${to || ''}`,
        cc  ? `Cc: ${cc}`  : null,
        bcc ? `Bcc: ${bcc}` : null,
        `Subject: =?UTF-8?B?${Buffer.from(subject || '(Sans sujet)', 'utf-8').toString('base64')}?=`,
        `MIME-Version: 1.0`,
      ].filter(l => l !== null).join('\r\n');

      let raw;
      if (hasAtt) {
        // multipart/mixed : partie HTML + pièces jointes
        const htmlPart = [
          `--${boundary}`,
          `Content-Type: text/html; charset=UTF-8`,
          `Content-Transfer-Encoding: base64`,
          '',
          htmlB64,
        ].join('\r\n');

        const attParts = attachments.map(f => {
          const buf    = f.buffer instanceof Buffer ? f.buffer : Buffer.from(f.buffer);
          const attB64 = buf.toString('base64').match(/.{1,76}/g).join('\r\n');
          return [
            `--${boundary}`,
            `Content-Type: ${f.mimetype || 'application/octet-stream'}; name="${f.originalname}"`,
            `Content-Transfer-Encoding: base64`,
            `Content-Disposition: attachment; filename="${f.originalname}"`,
            '',
            attB64,
          ].join('\r\n');
        });

        raw = Buffer.from(
          topHeaders + '\r\n' +
          `Content-Type: multipart/mixed; boundary="${boundary}"\r\n` +
          '\r\n' +
          htmlPart + '\r\n' +
          attParts.join('\r\n') +
          `\r\n--${boundary}--\r\n`,
          'utf-8'
        );
      } else {
        // Simple HTML
        raw = Buffer.from(
          topHeaders + '\r\n' +
          `Content-Type: text/html; charset=UTF-8\r\n` +
          `Content-Transfer-Encoding: base64\r\n` +
          '\r\n' +
          htmlB64,
          'utf-8'
        );
      }

      // Essayer Sent → INBOX.Sent → Sent Messages
      const folders = ['Sent', 'INBOX.Sent', 'Sent Messages'];
      const tryNext = (idx) => {
        if (idx >= folders.length) { imap.end(); return reject(new Error('Aucun dossier Sent trouvé')); }
        imap.append(raw, { mailbox: folders[idx], flags: ['\\Seen'], date }, (err) => {
          if (err) tryNext(idx + 1);
          else     { imap.end(); resolve({ ok: true, messageId: mid }); }
        });
      };
      tryNext(0);
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

module.exports = { testConnection, getFolders, fetchEmails, fetchEmailBody, deleteEmail, getUnreadCount, getMailboxStatus, getQuota, setFlag, moveEmail, saveDraft, saveToSent, searchEmails };