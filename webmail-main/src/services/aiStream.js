/**
 * src/services/aiStream.js
 * Extrait au fil de l'eau le champ "reply" d'une réponse JSON en cours de génération,
 * pour l'afficher en direct. Si le modèle répond en texte brut, le texte est relayé tel quel.
 */

/** Décode le début d'une chaîne JSON (sans le guillemet ouvrant). { text, closed } */
function decodePartial(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') return { text: out, closed: true };
    if (c !== '\\') { out += c; continue; }
    const n = src[i + 1];
    if (n === undefined) break;                              // échappement coupé : on attend la suite
    if (n === 'u') {
      const hex = src.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue;
    }
    out += ({ n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' })[n] ?? n;
    i++;
  }
  return { text: out, closed: false };
}

class ReplyStreamer {
  constructor() { this.buf = ''; this.mode = null; this.sent = 0; this.done = false; }

  /** @returns {string} le texte à ajouter à l'affichage (peut être vide) */
  feed(chunk) {
    this.buf += chunk;
    if (this.done) return '';

    if (!this.mode) {
      const head = this.buf.replace(/^\s*```(?:json)?\s*/i, '').trimStart();
      if (!head) return '';
      this.mode = head[0] === '{' ? 'json' : 'plain';
    }
    if (this.mode === 'plain') {
      const text = this.buf.replace(/^\s*```(?:json)?\s*/i, '');
      const delta = text.slice(this.sent);
      this.sent = text.length;
      return delta;
    }
    const m = /"reply"\s*:\s*"/.exec(this.buf);
    if (!m) return '';
    const { text, closed } = decodePartial(this.buf.slice(m.index + m[0].length));
    const delta = text.slice(this.sent);
    this.sent = text.length;
    if (closed) this.done = true;
    return delta;
  }
}

module.exports = { ReplyStreamer, decodePartial };
