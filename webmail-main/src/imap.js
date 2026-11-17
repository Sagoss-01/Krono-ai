/**
 * src/imap.js — Toutes les opérations IMAP
 *
 * BUG CORRIGÉ : race condition entre fetch.once('end') et imap.once('end').
 * La Promise résout maintenant DANS imap.once('end'), après imap.end() propre.
 */
const Imap             = require('imap');
const { simpleParser } = require('mailparser');
const logger           = require('./logger');

function createConnection(credentials) {
  return new Imap({
    user:        credentials.email,
    password:    credentials.password,
    host:        'mail.netiify.cloud',
    port:        993,
    tls:         true,
    tlsOptions:  { rejectUnauthorized: false },
    connTimeout: 20000,
    authTimeout: 15000,
  });
}

// ─── Test connexion (login) ──────────────────────────────────────────────────
function testConnection(credentials) {
  return new Promise((resolve, reject) => {
    logger.auth(credentials.email, 'INFO', 'Tentative connexion IMAP');
    const imap = createConnection(credentials);
    imap.once('ready', () => {
      logger.auth(credentials.email, 'INFO', 'Connexion IMAP OK');
      imap.end();
      resolve(true);
    });
    imap.once('error', err => {
      logger.auth(credentials.email, 'ERROR', 'Échec connexion', { message: err.message });
      reject(err);
    });
    imap.connect();
  });
}

// ─── Dossiers ────────────────────────────────────────────────────────────────
function getFolders(credentials) {
  return new Promise((resolve, reject) => {
    logger.imap(credentials.email, 'INFO', 'Récupération dossiers');
    const imap = createConnection(credentials);
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
        logger.imap(credentials.email, 'INFO', `${folders.length} dossier(s)`, { folders });
        imap.end();
        resolve(folders);
      });
    });
    imap.once('error', err => { logger.imap(credentials.email, 'ERROR', 'getFolders erreur', { message: err.message }); reject(err); });
    imap.connect();
  });
}

// ─── Liste emails (en-têtes) ─────────────────────────────────────────────────
function fetchEmails(credentials, folder, limit) {
  folder = folder || 'INBOX';
  limit  = limit  || 80;

  return new Promise((resolve, reject) => {
    logger.imap(credentials.email, 'INFO', `fetchEmails START — folder="${folder}" limit=${limit}`);

    const imap    = createConnection(credentials);
    const emails  = [];
    let   settled = false;

    const settle = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) {
        logger.imap(credentials.email, 'ERROR', 'fetchEmails FAILED', { message: err.message });
        reject(err);
      } else {
        logger.imap(credentials.email, 'INFO', `fetchEmails OK — ${result.length} email(s) retourné(s)`);
        resolve(result);
      }
    };

    imap.once('ready', () => {
      logger.imap(credentials.email, 'DEBUG', `openBox "${folder}"`);

      imap.openBox(folder, true, (openErr, box) => {
        if (openErr) {
          logger.imap(credentials.email, 'ERROR', `openBox erreur`, { message: openErr.message });
          imap.end();
          // imap.once('end') appellera settle
          return;
        }

        const total = box.messages.total;
        logger.imap(credentials.email, 'INFO', `Boîte ouverte — total=${total} unseen=${box.messages.unseen}`);

        if (total === 0) {
          imap.end();
          return; // settle(null, []) dans imap.once('end')
        }

        const start    = Math.max(1, total - limit + 1);
        const range    = `${start}:*`;
        logger.imap(credentials.email, 'DEBUG', `seq.fetch range=${range}`);

        const fetchReq = imap.seq.fetch(range, {
          bodies:   ['HEADER.FIELDS (FROM TO SUBJECT DATE CC BCC)'],
          struct:   true,
          markSeen: false,
        });

        fetchReq.on('message', (msg, seqno) => {
          const email = { seqno, uid: null, flags: [], headers: {} };
          let   headerBuf = '';
          let   headerDone = false;
          let   attrDone   = false;

          msg.on('body', (stream, info) => {
            stream.on('data',  c  => { headerBuf += c.toString('utf8'); });
            stream.on('end',   () => {
              if (info.which.startsWith('HEADER')) {
                const p = Imap.parseHeader(headerBuf);
                email.headers = {
                  from:    p.from    ? p.from[0]    : '',
                  to:      p.to      ? p.to[0]      : '',
                  subject: p.subject ? p.subject[0] : '(Pas de sujet)',
                  date:    p.date    ? new Date(p.date[0]) : new Date(),
                  cc:      p.cc      ? p.cc[0]      : '',
                };
                headerDone = true;
              }
            });
          });

          msg.once('attributes', attrs => {
            email.uid   = attrs.uid;
            email.flags = attrs.flags || [];
            attrDone = true;
          });

          msg.once('end', () => {
            logger.imap(credentials.email, 'DEBUG',
              `msg end seqno=${seqno} uid=${email.uid} header=${headerDone} attr=${attrDone} subj="${email.headers.subject}"`
            );
            emails.push(email);
          });
        });

        fetchReq.once('error', fetchErr => {
          logger.imap(credentials.email, 'ERROR', 'fetchReq erreur', { message: fetchErr.message });
          imap.end();
        });

        fetchReq.once('end', () => {
          logger.imap(credentials.email, 'DEBUG', `fetchReq END — ${emails.length} collecté(s), fermeture connexion`);
          imap.end(); // déclenche imap.once('end') ci-dessous
        });
      });
    });

    imap.once('error', err => {
      logger.imap(credentials.email, 'ERROR', 'Connexion IMAP erreur globale', { message: err.message });
      settle(err);
    });

    // ✅ Resolve/reject ICI — après fermeture propre
    imap.once('end', () => {
      logger.imap(credentials.email, 'DEBUG', `Connexion IMAP fermée — ${emails.length} email(s) dans le buffer`);
      settle(null, emails.reverse());
    });

    imap.connect();
  });
}

// ─── Corps complet ───────────────────────────────────────────────────────────
function fetchEmailBody(credentials, uid, folder) {
  folder = folder || 'INBOX';
  return new Promise((resolve, reject) => {
    logger.imap(credentials.email, 'INFO', `fetchEmailBody uid=${uid} folder="${folder}"`);
    const imap = createConnection(credentials);
    let   raw  = '';
    let   settled = false;

    const settle = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) { logger.imap(credentials.email, 'ERROR', 'fetchEmailBody erreur', { message: err.message }); reject(err); }
      else     { resolve(result); }
    };

    imap.once('ready', () => {
      imap.openBox(folder, false, (err) => {
        if (err) { imap.end(); return; }
        const fetchReq = imap.fetch(uid, { bodies: '', markSeen: true, struct: true });
        fetchReq.on('message', (msg) => {
          msg.on('body', (stream) => { stream.on('data', c => { raw += c.toString('utf8'); }); });
        });
        fetchReq.once('error', err => { imap.end(); settle(err); });
        fetchReq.once('end',   ()  => {
          logger.imap(credentials.email, 'DEBUG', `Corps brut reçu ${raw.length} bytes`);
          imap.end();
        });
      });
    });

    imap.once('error', err => settle(err));

    imap.once('end', () => {
      if (!raw) return settle(new Error('Corps vide'));
      simpleParser(raw)
        .then(p => {
          logger.imap(credentials.email, 'INFO', `Email parsé sujet="${p.subject}" attachments=${(p.attachments||[]).length}`);
          settle(null, {
            html:        p.html  || '',
            text:        p.text  || '',
            subject:     p.subject || '',
            from:        p.from  ? p.from.text  : '',
            to:          p.to    ? p.to.text    : '',
            cc:          p.cc    ? p.cc.text    : '',
            date:        p.date  || new Date(),
            attachments: (p.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
          });
        })
        .catch(settle);
    });

    imap.connect();
  });
}

// ─── Suppression ─────────────────────────────────────────────────────────────
function deleteEmail(credentials, uid, folder) {
  folder = folder || 'INBOX';
  return new Promise((resolve, reject) => {
    logger.imap(credentials.email, 'INFO', `deleteEmail uid=${uid}`);
    const imap = createConnection(credentials);
    imap.once('ready', () => {
      imap.openBox(folder, false, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.addFlags(uid, '\\Deleted', (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.expunge((err) => {
            if (err) { imap.end(); return reject(err); }
            logger.imap(credentials.email, 'INFO', `uid=${uid} supprimé`);
            imap.end();
            resolve(true);
          });
        });
      });
    });
    imap.once('error', err => reject(err));
    imap.connect();
  });
}

// ─── Nombre de non-lus ───────────────────────────────────────────────────────
function getUnreadCount(credentials, folder) {
  folder = folder || 'INBOX';
  return new Promise((resolve) => {
    const imap = createConnection(credentials);
    imap.once('ready', () => {
      imap.openBox(folder, true, (err, box) => {
        const count = (err || !box) ? 0 : (box.messages.unseen || 0);
        imap.end();
        resolve(count);
      });
    });
    imap.once('error', () => resolve(0));
    imap.connect();
  });
}

module.exports = { testConnection, getFolders, fetchEmails, fetchEmailBody, deleteEmail, getUnreadCount };
