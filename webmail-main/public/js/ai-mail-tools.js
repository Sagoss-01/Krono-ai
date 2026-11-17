/**
 * public/js/ai-mail-tools.js
 * Outils IA dans la messagerie :
 *   - lecture d'un message : résumer, proposer une réponse (ton au choix), traduire, repérer les dates → agenda
 *   - rédaction : générer l'objet, corriger / reformuler / traduire le message, avertissement « pièce jointe oubliée »
 *   - liste : recherche en langage naturel
 * Chaque appel passe par POST /api/ai/tools (voir aiController).
 */
const AIMailTools = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Porto-Novo'; } catch (_) { return 'Africa/Porto-Novo'; } };
  const SVG = (inner, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const I = {
    sum:   SVG('<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>'),
    reply: SVG('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
    lang:  SVG('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    cal:   SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    spark: SVG('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>', 13),
  };

  // ── Appel serveur ─────────────────────────────────────────────────────────
  async function tool(payload) {
    return App.apiPost('/api/ai/tools', { timeZone: tz(), ...payload });
  }

  // ── Pièce jointe oubliée (détection locale, sans IA) ──────────────────────
  function mentionsAttachment(text) {
    const head = String(text || '').split(/\n\s*[─—-]{6,}/)[0];              // ignore la partie citée (réponse / transfert)
    const own = head.split('\n').filter(l => !l.trim().startsWith('>')).join('\n').toLowerCase();
    return /pi[èe]ces?\s+jointes?|ci[-\s]?joint(?:e|es|s)?\b|\bjoint(?:e|es)?\s+(?:à|a)\s+ce\s+(?:mail|message|courriel)|\battach(?:ed|ment|ments|ing)\b|\benclosed\b|\badjunto\b|\banexo\b/.test(own);
  }

  // ═══ Lecture d'un message ═════════════════════════════════════════════════
  let readerMenu = null;
  let lastReply = '';

  function closeMenu() { readerMenu?.remove(); readerMenu = null; document.removeEventListener('click', closeMenu); }

  function toggleReaderMenu(ev) {
    ev.stopPropagation();
    if (readerMenu) return closeMenu();
    const btn = ev.currentTarget, r = btn.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'ai-menu';
    m.innerHTML = `
      <button type="button" data-a="summarize">${I.sum} Résumer ce message</button>
      <button type="button" data-a="dates">${I.cal} Repérer les dates et rendez-vous</button>
      <div class="sep"></div><div class="grp">Proposer une réponse</div>
      ${[['formel', 'Formelle'], ['amical', 'Amicale'], ['concis', 'Concise'], ['chaleureux', 'Chaleureuse'], ['ferme', 'Ferme']].map(([k, l]) => `<button type="button" data-a="reply" data-v="${k}">${I.reply} ${l}</button>`).join('')}
      <div class="sep"></div><div class="grp">Traduire</div>
      ${[['fr', 'En français'], ['en', 'En anglais'], ['es', 'En espagnol'], ['pt', 'En portugais'], ['de', 'En allemand'], ['ar', 'En arabe']].map(([k, l]) => `<button type="button" data-a="translate" data-v="${k}">${I.lang} ${l}</button>`).join('')}`;
    document.body.appendChild(m);
    const w = 240;
    m.style.top = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 10) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    m.style.maxHeight = (window.innerHeight - 20) + 'px'; m.style.overflowY = 'auto';
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      closeMenu(); runReader(b.dataset.a, b.dataset.v);
    });
    readerMenu = m;
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function currentMessage() {
    const e = (typeof Mail !== 'undefined' && Mail.getCurrentEmail) ? Mail.getCurrentEmail() : null;
    if (!e) return null;
    let body = String(e.text || '').trim();
    if (body.length < 20) body = ($('v-body')?.innerText || '').trim();
    return { subject: e.subject || '', from: e.from || '', date: e.date ? new Date(e.date).toLocaleString('fr-FR') : '', body };
  }

  function panel() {
    let p = $('ai-mail-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'ai-mail-panel';
      p.className = 'ai-mail-panel';
      const body = $('v-body');
      body.parentNode.insertBefore(p, body);
      // le panneau disparaît quand on ouvre un autre message
      const subj = $('v-subject');
      if (subj && !panel._obs) {
        panel._obs = new MutationObserver(() => { $('ai-mail-panel')?.remove(); });
        panel._obs.observe(subj, { childList: true, characterData: true, subtree: true });
      }
    }
    return p;
  }

  function setPanel(title, bodyHtml, footHtml = '') {
    const p = panel();
    p.innerHTML = `<div class="ai-mail-panel-head"><span class="t">${I.spark} ${esc(title)}</span>
        <button type="button" class="icon-btn" data-a="close" title="Fermer" aria-label="Fermer" style="width:26px;height:26px;">${SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 12)}</button></div>
      <div class="ai-mail-panel-body">${bodyHtml}</div>${footHtml ? `<div class="ai-mail-panel-foot">${footHtml}</div>` : ''}`;
    p.querySelector('[data-a=close]').addEventListener('click', () => p.remove());
    return p;
  }

  const loading = (t) => setPanel(t, '<div class="ai-typing"><span></span><span></span><span></span></div>');
  const failPanel = (title, msg) => setPanel(title, `<span style="color:var(--ai-err,#ef4444)">${esc(msg)}</span>`);

  const TONE_LABEL = { formel: 'formelle', amical: 'amicale', concis: 'concise', chaleureux: 'chaleureuse', ferme: 'ferme' };
  const LANG_LABEL = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', ar: 'arabe' };

  async function runReader(action, value) {
    const msg = currentMessage();
    if (!msg || !msg.body) { App.toast("Ouvrez d'abord un message.", 'info'); return; }

    if (action === 'summarize') {
      loading('Résumé du message');
      const res = await tool({ tool: 'summarize', ...msg });
      if (!res.ok) return failPanel('Résumé du message', res.error || 'Résumé impossible.');
      const html = (window.AIAssistant ? AIAssistant.md(res.text) : `<pre>${esc(res.text)}</pre>`);
      setPanel('Résumé du message', html, `<button type="button" class="aic-btn" data-a="copy">Copier</button>`)
        .querySelector('[data-a=copy]').addEventListener('click', () => navigator.clipboard.writeText(res.text).then(() => App.toast('Copié', 'success')));
    }

    if (action === 'reply') {
      loading(`Réponse ${TONE_LABEL[value]}`);
      const res = await tool({ tool: 'reply', ...msg, tone: value });
      if (!res.ok) return failPanel('Réponse proposée', res.error || 'Rédaction impossible.');
      lastReply = res.text;
      const p = setPanel(`Réponse ${TONE_LABEL[value]} proposée`,
        `<textarea id="ai-reply-ta" style="width:100%;box-sizing:border-box;min-height:150px;resize:vertical;background:var(--bg-main);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text-1);font-family:inherit;font-size:13.5px;line-height:1.6;outline:none;">${esc(res.text)}</textarea>`,
        `<button type="button" class="aic-btn primary" data-a="use">${I.reply} Utiliser comme réponse</button>
         <button type="button" class="aic-btn" data-a="again">Régénérer</button>
         <button type="button" class="aic-btn" data-a="copy">Copier</button>`);
      p.querySelector('[data-a=use]').addEventListener('click', () => useAsReply($('ai-reply-ta').value));
      p.querySelector('[data-a=again]').addEventListener('click', () => runReader('reply', value));
      p.querySelector('[data-a=copy]').addEventListener('click', () => navigator.clipboard.writeText($('ai-reply-ta').value).then(() => App.toast('Copié', 'success')));
    }

    if (action === 'translate') {
      loading(`Traduction en ${LANG_LABEL[value]}`);
      const res = await tool({ tool: 'translate', text: msg.body, target: value });
      if (!res.ok) return failPanel('Traduction', res.error || 'Traduction impossible.');
      setPanel(`Traduction en ${LANG_LABEL[value]}`, `<pre>${esc(res.text)}</pre>`, `<button type="button" class="aic-btn" data-a="copy">Copier</button>`)
        .querySelector('[data-a=copy]').addEventListener('click', () => navigator.clipboard.writeText(res.text).then(() => App.toast('Copié', 'success')));
    }

    if (action === 'dates') {
      loading('Dates et rendez-vous');
      const res = await tool({ tool: 'extract_dates', subject: msg.subject, body: msg.body });
      if (!res.ok) return failPanel('Dates et rendez-vous', res.error || 'Analyse impossible.');
      if (!res.events.length) return setPanel('Dates et rendez-vous', 'Aucune date ni aucun rendez-vous explicite repéré dans ce message.');
      const p = setPanel('Dates et rendez-vous repérés', res.events.map((ev, i) => `
        <div class="ai-ev" data-i="${i}"><div style="flex:1;min-width:0"><div class="ai-ev-t">${esc(ev.title)}</div>
          <div class="ai-ev-d">${esc(new Date(ev.startAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}${ev.location ? ' · ' + esc(ev.location) : ''}</div></div>
          <button type="button" class="aic-btn primary" data-a="add" style="padding:7px 14px;font-size:12px;">Ajouter à l'agenda</button></div>`).join(''));
      p.querySelectorAll('[data-a=add]').forEach(btn => btn.addEventListener('click', async () => {
        const ev = res.events[Number(btn.closest('.ai-ev').dataset.i)];
        btn.disabled = true;
        const r = await App.apiPost('/api/calendar/events', {
          title: ev.title, description: ev.description, location: ev.location,
          startAt: new Date(ev.startAt).toISOString(), endAt: new Date(ev.endAt).toISOString(),
          allDay: false, reminderMinutes: 15, attendees: '', isMeeting: false,
        });
        if (r.ok) { btn.textContent = 'Ajouté'; App.toast('Événement ajouté à votre agenda', 'success'); }
        else { btn.disabled = false; App.toast(r.error || 'Ajout impossible', 'error'); }
      }));
    }
  }

  function useAsReply(text) {
    if (typeof Mail === 'undefined') return;
    Mail.reply();
    setTimeout(() => {
      const b = $('c-body'); if (!b) return;
      b.value = text.trim() + b.value;                 // la citation du message d'origine reste en dessous
      b.focus(); b.setSelectionRange(0, 0);
    }, 80);
  }

  // ═══ Rédaction ════════════════════════════════════════════════════════════
  let previousBody = null;

  function splitQuote(text) {                           // sépare ce que l'utilisateur a écrit de la partie citée
    const m = /\n\s*[─—-]{6,}/.exec(text);
    return m ? [text.slice(0, m.index), text.slice(m.index)] : [text, ''];
  }

  function lockBar(on) { document.querySelectorAll('#c-ai-bar button, #c-ai-subject').forEach(b => { b.disabled = on; }); }

  async function generateSubject() {
    const [own] = splitQuote($('c-body').value);
    if (own.trim().length < 10) { App.toast("Écrivez d'abord votre message pour générer un objet.", 'info'); return; }
    lockBar(true);
    const res = await tool({ tool: 'subject', body: own });
    lockBar(false);
    if (res.ok && res.text) { $('c-subject').value = res.text; $('c-subject').focus(); }
    else App.toast(res.error || "Impossible de générer l'objet.", 'error');
  }

  async function transformBody(payload) {
    const ta = $('c-body');
    const [own, quoted] = splitQuote(ta.value);
    if (own.trim().length < 3) { App.toast("Écrivez d'abord votre message.", 'info'); return; }
    lockBar(true);
    const res = await tool({ ...payload, text: own });
    lockBar(false);
    if (!res.ok || !res.text) { App.toast(res.error || 'Modification impossible.', 'error'); return; }
    previousBody = ta.value;
    ta.value = res.text.trim() + quoted;
    $('c-ai-undo').style.display = '';
  }

  const rewriteBody = (mode) => transformBody({ tool: 'rewrite', mode });
  const translateBody = (target) => transformBody({ tool: 'translate', target });
  function undoBody() {
    if (previousBody === null) return;
    $('c-body').value = previousBody; previousBody = null;
    $('c-ai-undo').style.display = 'none';
  }

  // ═══ Recherche en langage naturel ═════════════════════════════════════════
  let searchPanel = null;

  function toggleSearchPanel() {
    if (searchPanel) { searchPanel.remove(); searchPanel = null; return; }
    searchPanel = document.createElement('div');
    searchPanel.className = 'ai-search-panel';
    searchPanel.innerHTML = `<div class="row"><input type="text" class="search-inp" id="ai-search-q" maxlength="300" autocomplete="off" placeholder="Ex : factures reçues de Marie le mois dernier">
        <button type="button" class="quick-filter active" id="ai-search-go">${I.spark} Chercher</button></div>
      <div class="hint">Décrivez les e-mails à retrouver : expéditeur, sujet, période, non lus, pièces jointes…</div>`;
    document.querySelector('#mode-mail .list-header')?.insertAdjacentElement('afterend', searchPanel);
    const q = $('ai-search-q'), go = $('ai-search-go');
    q.focus();
    const run = async () => {
      const query = q.value.trim();
      if (query.length < 3) return;
      go.disabled = true; go.textContent = 'Analyse…';
      const res = await tool({ tool: 'nl_search', query });
      if (!res.ok || !res.criteria) { go.disabled = false; go.innerHTML = `${I.spark} Chercher`; App.toast(res.error || "Je n'ai pas compris la recherche.", 'error'); return; }
      go.textContent = 'Recherche…';
      try {
        const results = await runSearch(res.criteria);
        Mail.showSearchResults(results, 'Recherche IA : ' + query.slice(0, 40), res.criteria.folder);
        App.toast(results.length + ' résultat(s)', 'info');
        searchPanel?.remove(); searchPanel = null;
      } catch (e) { go.disabled = false; go.innerHTML = `${I.spark} Chercher`; App.toast(e.message || 'Recherche impossible', 'error'); }
    };
    go.addEventListener('click', run);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); if (e.key === 'Escape') toggleSearchPanel(); });
  }

  async function runSearch(c) {
    const folders = c.folder === 'ALL' ? ['INBOX', 'Sent', 'Drafts', 'Junk', 'Trash'] : [c.folder || 'INBOX'];
    let all = [];
    for (const folder of folders) {
      const params = new URLSearchParams({
        folder, from: c.from || '', subject: c.subject || '', since: c.since || '', before: c.before || '',
        unread: c.unread ? '1' : '', starred: c.starred ? '1' : '', hasAttachment: c.hasAttachment ? '1' : '',
      });
      const res = await App.apiGet('/api/search?' + params.toString());
      if (!res.ok) throw new Error(res.error || 'Recherche impossible');
      all = all.concat((res.emails || []).map(e => { e._folder = folder; return e; }));
    }
    return all;
  }

  function openResults(results, card) {
    if (typeof Mail !== 'undefined') Mail.showSearchResults(results, 'Résultats de recherche', card.folder);
  }

  return {
    mentionsAttachment, toggleReaderMenu,
    generateSubject, rewriteBody, translateBody, undoBody,
    toggleSearchPanel, runSearch, openResults,
  };
})();
