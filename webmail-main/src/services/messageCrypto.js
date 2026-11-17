/**
 * src/services/messageCrypto.js
 *
 * Chiffrement au repos (AES-256-GCM) du contenu des messages de discussion
 * (chat_messages, chat_conversations.last_msg, meeting_chat_messages).
 *
 * Pourquoi une clé séparée de SESSION_SECRET :
 *  - SESSION_SECRET sert à signer/chiffrer des données de session, courte
 *    durée de vie. Les messages, eux, sont conservés jusqu'à 6 mois (purge
 *    automatique existante). Si un jour SESSION_SECRET doit être tourné
 *    (ex. suite à une fuite), on ne veut PAS que ça rende tout l'historique
 *    de conversation illisible d'un coup — d'où une clé dédiée.
 *  - Séparation des clés par domaine d'usage = bonne pratique standard
 *    (limite le rayon d'impact si une seule clé est compromise).
 *
 * Format stocké : "v1:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 * Le préfixe de version permet de faire évoluer l'algorithme plus tard sans
 * casser le déchiffrement des anciens messages.
 *
 * Ce chiffrement protège contre : un dump de base volé, une sauvegarde qui
 * fuite, un accès SQL direct non autorisé. Il ne protège PAS contre un
 * serveur applicatif compromis (qui détient la clé en mémoire) — pour ça,
 * il faudrait du chiffrement de bout en bout côté client, un projet à part.
 */
const crypto = require('crypto');

const RAW_KEY = process.env.CHAT_ENCRYPTION_KEY;

if (!RAW_KEY) {
  console.warn(
    '[messageCrypto] ATTENTION: CHAT_ENCRYPTION_KEY absente du .env — ' +
    'les nouveaux messages seront stockés EN CLAIR. Générez-en une avec: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

// Accepte soit une clé hex de 64 caractères (32 bytes) déjà prête, soit une
// chaîne quelconque qu'on dérive proprement en 32 bytes via SHA-256.
const KEY = RAW_KEY
  ? (/^[0-9a-f]{64}$/i.test(RAW_KEY) ? Buffer.from(RAW_KEY, 'hex') : crypto.createHash('sha256').update(RAW_KEY).digest())
  : null;

const PREFIX = 'v1:';

function encryptContent(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (!KEY) return plaintext; // pas de clé configurée -> on ne bloque pas l'appli, mais rien n'est chiffré (voir warning au démarrage)

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decryptContent(stored) {
  if (stored === null || stored === undefined) return stored;
  if (!stored.startsWith(PREFIX)) return stored; // message legacy en clair, ou clé non configurée -> renvoyé tel quel

  if (!KEY) {
    // On a une valeur chiffrée mais plus de clé pour la lire (mauvaise config) :
    // mieux vaut le signaler clairement que planter silencieusement ailleurs.
    return '[Message chiffré — clé de déchiffrement manquante]';
  }

  try {
    const [, ivHex, tagHex, encHex] = stored.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
  } catch (err) {
    console.error('[messageCrypto] Échec déchiffrement (donnée corrompue ou mauvaise clé):', err.message);
    return '[Message illisible]';
  }
}

module.exports = { encryptContent, decryptContent, isConfigured: !!KEY };
