const crypto = require('crypto');
const { pool } = require('../services/db');
const logger = require('../services/logger');

function getEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

function newSetId() {
  return 'qs_' + crypto.randomBytes(8).toString('hex');
}

function normalizeQuestion(raw, idx) {
  const question = String(raw.question || '').trim();
  const options = Array.isArray(raw.options) ? raw.options.map(o => String(o || '').trim()).filter(Boolean) : [];
  const correctIdx = Number.isInteger(raw.correctIdx) ? raw.correctIdx : parseInt(raw.correctIdx, 10);
  const points = Number.isFinite(raw.points) ? raw.points : (parseInt(raw.points, 10) || 1);
  const duration = Number.isFinite(raw.duration) ? raw.duration : (parseInt(raw.duration, 10) || 30);
  const isBingo = !!raw.isBingo;
  const speedBonus = !!raw.speedBonus;

  if (!question) throw new Error(`Question #${idx + 1} : le texte de la question est vide`);
  if (options.length < 2) throw new Error(`Question #${idx + 1} ("${question}") : il faut au moins 2 options`);
  if (options.length > 4) throw new Error(`Question #${idx + 1} ("${question}") : 4 options maximum`);
  if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= options.length) {
    throw new Error(`Question #${idx + 1} ("${question}") : la bonne réponse est invalide`);
  }

  return { question, options, correctIdx, points, duration, isBingo, speedBonus };
}

// ── CRUD sets ────────────────────────────────────────────────────────────

async function listQuizSets(req, res) {
  try {
    const owner = getEmail(req);
    const [rows] = await pool.execute(
      `SELECT qs.id, qs.title, qs.created_at, qs.updated_at, COUNT(qq.id) AS question_count
       FROM quiz_sets qs
       LEFT JOIN quiz_set_questions qq ON qq.quiz_set_id = qs.id
       WHERE qs.owner_email = ?
       GROUP BY qs.id
       ORDER BY qs.updated_at DESC`,
      [owner]
    );
    return res.json({ ok: true, sets: rows });
  } catch (err) {
    logger.auth('quiz-sets', 'ERROR', 'Échec listing quiz sets', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

async function getQuizSet(req, res) {
  try {
    const owner = getEmail(req);
    const { id } = req.params;

    const [setRows] = await pool.execute(
      `SELECT id, title FROM quiz_sets WHERE id = ? AND owner_email = ? LIMIT 1`,
      [id, owner]
    );
    if (!setRows.length) return res.status(404).json({ ok: false, error: 'Quiz introuvable' });

    const [qRows] = await pool.execute(
      `SELECT question, options, correct_idx, points, duration, is_bingo, speed_bonus
       FROM quiz_set_questions WHERE quiz_set_id = ? ORDER BY position ASC`,
      [id]
    );

    const questions = qRows.map(r => ({
      question: r.question,
      options: typeof r.options === 'string' ? JSON.parse(r.options) : r.options,
      correctIdx: r.correct_idx,
      points: r.points,
      duration: r.duration,
      isBingo: !!r.is_bingo,
      speedBonus: !!r.speed_bonus
    }));

    return res.json({ ok: true, id: setRows[0].id, title: setRows[0].title, questions });
  } catch (err) {
    logger.auth('quiz-sets', 'ERROR', 'Échec lecture quiz set', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

async function saveQuizSet(req, res) {
  let conn;
  try {
    const owner = getEmail(req);
    const { id, title, questions } = req.body || {};

    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ ok: false, error: 'Le quiz doit contenir au moins une question' });
    }

    const normalized = questions.map((q, i) => normalizeQuestion(q, i));
    const setId = id || newSetId();
    const setTitle = String(title || 'Quiz sans titre').trim().slice(0, 255) || 'Quiz sans titre';

    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (id) {
      const [owned] = await conn.execute(
        `SELECT 1 FROM quiz_sets WHERE id = ? AND owner_email = ? LIMIT 1`,
        [id, owner]
      );
      if (!owned.length) {
        await conn.rollback(); conn.release();
        return res.status(404).json({ ok: false, error: 'Quiz introuvable' });
      }
      await conn.execute(`UPDATE quiz_sets SET title = ? WHERE id = ?`, [setTitle, setId]);
      await conn.execute(`DELETE FROM quiz_set_questions WHERE quiz_set_id = ?`, [setId]);
    } else {
      await conn.execute(
        `INSERT INTO quiz_sets (id, owner_email, title) VALUES (?, ?, ?)`,
        [setId, owner, setTitle]
      );
    }

    let position = 0;
    for (const q of normalized) {
      await conn.execute(
        `INSERT INTO quiz_set_questions
         (quiz_set_id, position, question, options, correct_idx, points, duration, is_bingo, speed_bonus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [setId, position++, q.question, JSON.stringify(q.options), q.correctIdx, q.points, q.duration, q.isBingo ? 1 : 0, q.speedBonus ? 1 : 0]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;

    return res.json({ ok: true, id: setId });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
      conn.release();
    }
    logger.auth('quiz-sets', 'ERROR', 'Échec sauvegarde quiz set', { message: err.message });
    return res.status(400).json({ ok: false, error: err.message || 'Erreur lors de la sauvegarde' });
  }
}

async function deleteQuizSet(req, res) {
  try {
    const owner = getEmail(req);
    const { id } = req.params;
    const [result] = await pool.execute(
      `DELETE FROM quiz_sets WHERE id = ? AND owner_email = ?`,
      [id, owner]
    );
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'Quiz introuvable' });
    // quiz_set_questions n'a pas de FK cascade déclarée -> nettoyage manuel
    await pool.execute(`DELETE FROM quiz_set_questions WHERE quiz_set_id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    logger.auth('quiz-sets', 'ERROR', 'Échec suppression quiz set', { message: err.message });
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
}

// ── Import depuis fichier (.txt simple ou .qzx enrichi) ─────────────────────
//
// Format .txt (simple, une bonne réponse marquée par *) :
//   Q: Quelle est la capitale de la France ?
//   A: Paris *
//   B: Lyon
//   C: Marseille
//   POINTS: 5
//   DURATION: 30
//   ---
//   Q: question suivante...
//
// Format .qzx (JSON enrichi maison, supporte bingo + bonus rapidité) :
//   { "format": "netiify-quiz-v1", "title": "...", "questions": [ {...} ] }

function parseTxtQuizFile(content) {
  const blocks = content.split(/^-{3,}\s*$/m).map(b => b.trim()).filter(Boolean);
  return blocks.map((block, idx) => {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let question = '';
    const options = [];
    let correctIdx = -1;
    let points = 1;
    let duration = 30;

    for (const line of lines) {
      const qMatch = line.match(/^Q:\s*(.+)$/i);
      const optMatch = line.match(/^[A-D]:\s*(.+)$/i);
      const ptsMatch = line.match(/^POINTS:\s*(\d+)/i);
      const durMatch = line.match(/^DURATION:\s*(\d+)/i);

      if (qMatch) { question = qMatch[1].trim(); continue; }
      if (ptsMatch) { points = parseInt(ptsMatch[1], 10); continue; }
      if (durMatch) { duration = parseInt(durMatch[1], 10); continue; }
      if (optMatch) {
        let text = optMatch[1].trim();
        const isCorrect = /\*\s*$/.test(text);
        if (isCorrect) {
          text = text.replace(/\*\s*$/, '').trim();
          correctIdx = options.length;
        }
        options.push(text);
      }
    }

    return normalizeQuestion({ question, options, correctIdx, points, duration, isBingo: false, speedBonus: false }, idx);
  });
}

function parseQzxQuizFile(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new Error('Fichier .qzx invalide (JSON illisible)');
  }
  if (!data || data.format !== 'netiify-quiz-v1' || !Array.isArray(data.questions)) {
    throw new Error('Fichier .qzx invalide (format inattendu)');
  }
  return {
    title: data.title || 'Quiz importé',
    questions: data.questions.map((q, i) => normalizeQuestion(q, i))
  };
}

async function importQuizFile(req, res) {
  try {
    const { filename, content } = req.body || {};
    if (!filename || typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'Fichier manquant' });
    }

    const lower = filename.toLowerCase();
    let title = filename.replace(/\.[^.]+$/, '');
    let questions;

    if (lower.endsWith('.qzx')) {
      const parsed = parseQzxQuizFile(content);
      title = parsed.title;
      questions = parsed.questions;
    } else if (lower.endsWith('.txt')) {
      questions = parseTxtQuizFile(content);
    } else {
      return res.status(400).json({ ok: false, error: 'Extension non supportée (utilisez .txt ou .qzx)' });
    }

    if (!questions.length) {
      return res.status(400).json({ ok: false, error: 'Aucune question trouvée dans le fichier' });
    }

    return res.json({ ok: true, title, questions });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Fichier illisible' });
  }
}

// ── Modèles téléchargeables ──────────────────────────────────────────────

function downloadTxtTemplate(req, res) {
  const template = [
    'Q: Quelle est la capitale de la France ?',
    'A: Paris *',
    'B: Lyon',
    'C: Marseille',
    'D: Nice',
    'POINTS: 5',
    'DURATION: 30',
    '---',
    'Q: 2 + 2 = ?',
    'A: 3',
    'B: 4 *',
    'C: 5',
    'POINTS: 1',
    'DURATION: 15',
    ''
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modele-quiz.txt"');
  res.send(template);
}

function downloadQzxTemplate(req, res) {
  const template = {
    format: 'netiify-quiz-v1',
    title: 'Mon quiz',
    questions: [
      {
        question: 'Quelle est la capitale de la France ?',
        options: ['Paris', 'Lyon', 'Marseille', 'Nice'],
        correctIdx: 0,
        points: 5,
        duration: 30,
        isBingo: false,
        speedBonus: true
      },
      {
        question: 'Question bonus (bingo, 20 points)',
        options: ['Vrai', 'Faux'],
        correctIdx: 0,
        points: 20,
        duration: 20,
        isBingo: true,
        speedBonus: false
      }
    ]
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modele-quiz.qzx"');
  res.send(JSON.stringify(template, null, 2));
}

module.exports = {
  listQuizSets,
  getQuizSet,
  saveQuizSet,
  deleteQuizSet,
  importQuizFile,
  downloadTxtTemplate,
  downloadQzxTemplate
};
