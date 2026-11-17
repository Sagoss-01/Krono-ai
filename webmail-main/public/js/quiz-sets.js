/**
 * public/js/quiz-sets.js
 * Interface dédiée pour créer / importer / gérer des bancs de quiz à l'avance.
 */
const QuizSets = (() => {
  const COLORS = ['#f87171', '#22c55e', '#4db8d8', '#a78bfa'];
  let currentSet = null; // { id, title, questions: [...] }

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  async function apiGet(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    return res.json();
  }
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(body)
    });
    return res.json();
  }
  async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE', headers: { 'X-CSRF-Token': getCsrfToken() } });
    return res.json();
  }

  function escHtml(v = '') {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function refreshList() {
    const listEl = document.getElementById('sets-list');
    const res = await apiGet('/api/quiz-sets');
    if (!res.ok || !res.sets.length) {
      listEl.innerHTML = '<div class="empty">Aucun quiz enregistré pour l\'instant.</div>';
      return;
    }
    listEl.innerHTML = res.sets.map(s => `
      <div class="set-item" onclick="QuizSets.openSet('${s.id}')">
        <div>
          <div class="name">${escHtml(s.title)}</div>
          <div class="meta">${s.question_count} question${s.question_count > 1 ? 's' : ''}</div>
        </div>
        <button onclick="event.stopPropagation();QuizSets.deleteSet('${s.id}')" title="Supprimer">🗑</button>
      </div>`).join('');
  }

  async function openSet(id) {
    const res = await apiGet('/api/quiz-sets/' + id);
    if (!res.ok) { alert(res.error || 'Erreur'); return; }
    currentSet = { id: res.id, title: res.title, questions: res.questions };
    renderEditor();
  }

  function newSet() {
    currentSet = { id: null, title: 'Nouveau quiz', questions: [] };
    renderEditor();
  }

  function renderEditor() {
    document.getElementById('editor-title').textContent = currentSet.id ? 'Modifier le quiz' : 'Nouveau quiz';
    const body = document.getElementById('editor-body');

    body.innerHTML = `
      <label class="lab">Titre du quiz</label>
      <input class="inp" id="set-title" value="${escHtml(currentSet.title)}" style="margin-bottom:16px;">
      <div id="questions-container"></div>
      <button class="btn ghost" style="width:100%;margin-bottom:14px;" onclick="QuizSets.addQuestion()">+ Ajouter une question</button>
      <div class="row">
        <button class="btn" style="flex:1;" onclick="QuizSets.saveCurrentSet()">💾 Enregistrer</button>
      </div>
      <div id="editor-msg" class="msg"></div>
    `;
    renderQuestions();
  }

  function renderQuestions() {
    const container = document.getElementById('questions-container');
    if (!currentSet.questions.length) {
      container.innerHTML = '<div class="empty">Aucune question. Cliquez sur "+ Ajouter une question".</div>';
      return;
    }
    container.innerHTML = currentSet.questions.map((q, qi) => `
      <div class="q-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:800;color:#64748b;">Question ${qi + 1}</span>
          <button onclick="QuizSets.removeQuestion(${qi})" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:12px;">Supprimer</button>
        </div>
        <textarea class="inp" rows="2" placeholder="Texte de la question" oninput="QuizSets.updateQuestion(${qi},'question',this.value)" style="margin-bottom:8px;">${escHtml(q.question)}</textarea>
        ${[0, 1, 2, 3].map(oi => `
          <div class="opt-row">
            <div class="opt-badge" style="background:${q.correctIdx === oi ? '#22c55e' : COLORS[oi]};" onclick="QuizSets.setCorrect(${qi},${oi})" title="Marquer comme bonne réponse">${q.correctIdx === oi ? '✓' : 'ABCD'[oi]}</div>
            <input class="inp" placeholder="Option ${oi + 1}${oi < 2 ? ' (obligatoire)' : ' (optionnel)'}" value="${escHtml(q.options[oi] || '')}" oninput="QuizSets.updateOption(${qi},${oi},this.value)">
          </div>`).join('')}
        <div class="row" style="margin-top:8px;">
          <div style="flex:1;">
            <label class="lab">Points</label>
            <input class="inp" type="number" min="1" value="${q.points}" oninput="QuizSets.updateQuestion(${qi},'points',parseInt(this.value)||1)">
          </div>
          <div style="flex:1;">
            <label class="lab">Durée (s)</label>
            <input class="inp" type="number" min="5" value="${q.duration}" oninput="QuizSets.updateQuestion(${qi},'duration',parseInt(this.value)||30)">
          </div>
        </div>
        <div class="toggle-row">
          <label><input type="checkbox" ${q.isBingo ? 'checked' : ''} onchange="QuizSets.updateQuestion(${qi},'isBingo',this.checked)"> 🎯 Bingo (20 pts)</label>
          <label><input type="checkbox" ${q.speedBonus ? 'checked' : ''} onchange="QuizSets.updateQuestion(${qi},'speedBonus',this.checked)"> ⚡ Bonus rapidité</label>
        </div>
      </div>`).join('');
  }

  function addQuestion() {
    currentSet.questions.push({ question: '', options: ['', '', '', ''], correctIdx: -1, points: 1, duration: 30, isBingo: false, speedBonus: false });
    renderQuestions();
  }
  function removeQuestion(qi) {
    currentSet.questions.splice(qi, 1);
    renderQuestions();
  }
  function updateQuestion(qi, field, value) {
    currentSet.questions[qi][field] = value;
  }
  function updateOption(qi, oi, value) {
    currentSet.questions[qi].options[oi] = value;
  }
  function setCorrect(qi, oi) {
    currentSet.questions[qi].correctIdx = oi;
    renderQuestions();
  }

  async function saveCurrentSet() {
    const msg = document.getElementById('editor-msg');
    currentSet.title = document.getElementById('set-title').value.trim() || 'Quiz sans titre';

    // Nettoyage : options vides retirées avant envoi
    const payloadQuestions = currentSet.questions.map(q => ({
      ...q,
      options: q.options.filter(o => o && o.trim())
    }));

    const res = await apiPost('/api/quiz-sets', { id: currentSet.id, title: currentSet.title, questions: payloadQuestions });
    if (res.ok) {
      currentSet.id = res.id;
      msg.className = 'msg ok';
      msg.textContent = '✅ Quiz enregistré.';
      refreshList();
    } else {
      msg.className = 'msg err';
      msg.textContent = res.error || 'Erreur lors de la sauvegarde';
    }
  }

  async function deleteSet(id) {
    if (!confirm('Supprimer ce quiz définitivement ?')) return;
    const res = await apiDelete('/api/quiz-sets/' + id);
    if (res.ok) {
      if (currentSet && currentSet.id === id) {
        currentSet = null;
        document.getElementById('editor-title').textContent = 'Sélectionnez ou créez un quiz';
        document.getElementById('editor-body').innerHTML = '<div class="empty">Choisissez un quiz à gauche, ou créez-en un nouveau.</div>';
      }
      refreshList();
    }
  }

  async function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const content = await file.text();

    const res = await apiPost('/api/quiz-sets/import', { filename: file.name, content });
    if (!res.ok) {
      alert(res.error || "Impossible de lire ce fichier");
      event.target.value = '';
      return;
    }

    currentSet = { id: null, title: res.title || file.name, questions: res.questions };
    renderEditor();
    event.target.value = '';
  }

  document.addEventListener('DOMContentLoaded', refreshList);

  return {
    newSet, openSet, deleteSet, addQuestion, removeQuestion,
    updateQuestion, updateOption, setCorrect, saveCurrentSet, handleFileImport
  };
})();
