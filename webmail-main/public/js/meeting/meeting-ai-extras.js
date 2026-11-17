/**
 * meeting-ai-extras.js
 * Extras IA de la réunion :
 *   - sous le résumé : « Actions à suivre → agenda » et « Envoyer le compte-rendu »
 *   - quiz généré depuis le chat / les notes, enregistré dans la Banque
 *   - sous-titres traduits (à la demande, par participant)
 * À charger APRÈS meeting-chat.js et meeting-captions.js.
 */
(function (g) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Porto-Novo'; } catch (_) { return 'Africa/Porto-Novo'; } };
  const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

  async function post(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify(body),
      });
      return await r.json();
    } catch (_) { return { ok: false, error: 'Erreur réseau' }; }
  }

  const BTN = 'padding:10px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';
  const BTN_GHOST = `${BTN}border:1px solid var(--border);background:transparent;color:var(--accent);`;
  const BTN_MAIN = `${BTN}border:none;background:var(--accent);color:#fff;`;
  const INPUT = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-family:inherit;font-size:12.5px;outline:none;';

  // ═══ Sous le résumé ═══════════════════════════════════════════════════════
  function enhanceSummary(overlay, summary, duration) {
    const card = overlay.firstElementChild;
    if (!card) return;
    const row = document.createElement('div');
    row.style.cssText = 'margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;';
    row.innerHTML = `<button type="button" data-a="actions" style="${BTN_GHOST}flex:1;min-width:150px;">Actions à suivre → agenda</button>
                     <button type="button" data-a="minutes" style="${BTN_GHOST}flex:1;min-width:150px;">Envoyer le compte-rendu</button>`;
    const out = document.createElement('div');
    out.style.cssText = 'margin-top:14px;';
    card.appendChild(row); card.appendChild(out);
    row.querySelector('[data-a=actions]').addEventListener('click', (e) => runActions(e.currentTarget, out, summary));
    row.querySelector('[data-a=minutes]').addEventListener('click', (e) => runMinutes(e.currentTarget, out, summary, duration));
  }

  const spinner = (out, text) => { out.innerHTML = `<div style="font-size:12.5px;color:var(--muted);">${esc(text)}</div>`; };
  const errorBox = (out, msg) => { out.innerHTML = `<div style="font-size:12.5px;color:#f87171;">${esc(msg)}</div>`; };

  async function runActions(btn, out, summary) {
    btn.disabled = true; spinner(out, 'Recherche des actions à suivre…');
    const res = await post(`/api/ai/meetings/${MeetState.MEETING_ID}/actions`, { summary, timeZone: tz() });
    btn.disabled = false;
    if (!res.ok) return errorBox(out, res.error || 'Analyse impossible.');
    if (!res.actions.length) { out.innerHTML = '<div style="font-size:12.5px;color:var(--muted);">Aucune action à suivre repérée dans ce compte-rendu.</div>'; return; }

    out.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:8px;">Actions repérées — choisissez celles à planifier</div>
      ${res.actions.map((a, i) => `
        <div data-i="${i}" style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);">
          <input type="checkbox" ${a.due ? 'checked' : ''} style="margin-top:9px;accent-color:var(--accent);">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;">
            <input type="text" data-f="title" value="${esc(a.title)}" style="${INPUT}">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input type="datetime-local" data-f="when" value="${a.due ? esc(a.due) + 'T09:00' : ''}" style="${INPUT}width:auto;">
              ${a.owner ? `<span style="font-size:11.5px;color:var(--muted);">Responsable : ${esc(a.owner)}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
      <div style="font-size:11.5px;color:var(--muted);margin:8px 0;">Renseignez une date pour chaque action cochée : les actions sans échéance dans le texte n'en ont pas reçu.</div>
      <button type="button" data-a="add" style="${BTN_MAIN}width:100%;">Ajouter à mon agenda</button>
      <div data-role="res" style="font-size:12px;margin-top:8px;"></div>`;

    out.querySelector('[data-a=add]').addEventListener('click', async (e) => {
      const add = e.currentTarget, resBox = out.querySelector('[data-role=res]');
      const rows = [...out.querySelectorAll('[data-i]')].filter(r => r.querySelector('input[type=checkbox]').checked);
      if (!rows.length) { resBox.style.color = '#f87171'; resBox.textContent = 'Cochez au moins une action.'; return; }
      for (const r of rows) {
        if (!r.querySelector('[data-f=title]').value.trim() || !r.querySelector('[data-f=when]').value) {
          resBox.style.color = '#f87171'; resBox.textContent = 'Chaque action cochée doit avoir un titre et une date.'; return;
        }
      }
      add.disabled = true; let ok = 0;
      for (const r of rows) {
        const a = res.actions[Number(r.dataset.i)];
        const start = new Date(r.querySelector('[data-f=when]').value);
        const r2 = await post('/api/calendar/events', {
          title: r.querySelector('[data-f=title]').value.trim(),
          description: (a.owner ? `Responsable : ${a.owner}\n` : '') + 'Action issue de la réunion.',
          location: '', startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString(),
          allDay: false, reminderMinutes: 60, attendees: '', isMeeting: false,
        });
        if (r2.ok) ok++;
      }
      add.disabled = false;
      resBox.style.color = ok === rows.length ? '#4ade80' : '#f87171';
      resBox.textContent = `${ok} événement(s) ajouté(s) à votre agenda` + (ok < rows.length ? ` — ${rows.length - ok} en échec.` : '.');
    });
  }

  async function runMinutes(btn, out, summary, duration) {
    btn.disabled = true; spinner(out, "Rédaction de l'e-mail…");
    const res = await post(`/api/ai/meetings/${MeetState.MEETING_ID}/minutes`, { summary, duration });
    btn.disabled = false;
    if (!res.ok) return errorBox(out, res.error || 'Rédaction impossible.');

    out.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:8px;">E-mail de compte-rendu — modifiable</div>
      <input type="text" data-f="to" placeholder="destinataires, séparés par une virgule" value="${esc(res.recipients.join(', '))}" style="${INPUT}margin-bottom:6px;">
      ${res.isHost ? '' : '<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">La liste des participants est réservée à l\'organisateur : saisissez les destinataires.</div>'}
      <input type="text" data-f="subject" value="${esc(res.subject)}" style="${INPUT}margin-bottom:6px;">
      <textarea data-f="body" rows="9" style="${INPUT}resize:vertical;line-height:1.55;">${esc(res.body)}</textarea>
      <button type="button" data-a="send" style="${BTN_MAIN}width:100%;margin-top:8px;">Envoyer le compte-rendu</button>
      <div data-role="res" style="font-size:12px;margin-top:8px;"></div>`;
    out.querySelector('[data-a=send]').addEventListener('click', async (e) => {
      const b = e.currentTarget, box = out.querySelector('[data-role=res]');
      const to = out.querySelector('[data-f=to]').value.split(/[,;\s]+/).filter(Boolean);
      const subject = out.querySelector('[data-f=subject]').value.trim();
      const body = out.querySelector('[data-f=body]').value.trim();
      const fail = (m) => { box.style.color = '#f87171'; box.textContent = m; };
      if (!to.length) return fail('Indiquez au moins un destinataire.');
      const bad = to.find(x => !EMAIL_RE.test(x)); if (bad) return fail('Adresse invalide : ' + bad);
      if (!subject || !body) return fail("L'objet et le message sont obligatoires.");
      b.disabled = true; box.style.color = 'var(--muted)'; box.textContent = 'Envoi…';
      const r = await post('/api/send', { to: to.join(', '), subject, body });
      b.disabled = false;
      if (r.ok) { box.style.color = '#4ade80'; box.textContent = 'Compte-rendu envoyé à ' + to.length + ' destinataire(s).'; b.disabled = true; }
      else fail(r.error || "L'envoi a échoué.");
    });
  }

  // ═══ Quiz → Banque ════════════════════════════════════════════════════════
  function openQuizModal() {
    $('mai-quiz')?.remove();
    const ov = document.createElement('div');
    ov.id = 'mai-quiz';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:440px;padding:24px;">
      <div style="font-size:16px;font-weight:800;color:var(--text1);margin-bottom:4px;">Générer un quiz</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:16px;">L'IA crée des questions à partir du chat et des notes de cette réunion. Le quiz est enregistré dans votre Banque, où vous pouvez le relire et le modifier avant de le lancer.</div>
      <label style="font-size:11.5px;font-weight:700;color:var(--muted);">Nombre de questions</label>
      <select id="mai-count" style="${INPUT}margin:5px 0 12px;"><option>3</option><option selected>5</option><option>8</option><option>10</option></select>
      <label style="font-size:11.5px;font-weight:700;color:var(--muted);">Thème (facultatif)</label>
      <input id="mai-topic" type="text" maxlength="120" placeholder="Ex : sécurité des mots de passe" style="${INPUT}margin:5px 0 14px;">
      <div id="mai-res" style="font-size:12.5px;min-height:18px;margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;"><button type="button" data-a="close" style="${BTN_GHOST}flex:1;">Fermer</button>
        <button type="button" data-a="go" style="${BTN_MAIN}flex:1;">Générer</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelector('[data-a=close]').addEventListener('click', () => ov.remove());
    ov.querySelector('[data-a=go]').addEventListener('click', async (e) => {
      const go = e.currentTarget, box = $('mai-res');
      go.disabled = true; box.style.color = 'var(--muted)'; box.textContent = 'Création du quiz…';
      const chatMessages = Array.from(document.querySelectorAll('.chat-msg')).slice(-60).map(el => ({
        displayName: el.querySelector('.chat-msg-who')?.textContent || '', text: el.querySelector('.chat-msg-text')?.textContent || '',
      })).filter(m => m.text);
      const notes = $('notes-editor')?.value || '';
      const res = await post(`/api/ai/meetings/${MeetState.MEETING_ID}/quiz`, {
        chatMessages, notes, count: $('mai-count').value, topic: $('mai-topic').value.trim(),
      });
      go.disabled = false;
      if (!res.ok) { box.style.color = '#f87171'; box.textContent = res.error || 'Création impossible.'; return; }
      box.style.color = '#4ade80';
      box.innerHTML = `Quiz « ${esc(res.title)} » enregistré dans votre Banque (${res.count} question${res.count > 1 ? 's' : ''}). <a href="/quiz-sets" target="_blank" style="color:var(--accent);font-weight:700;">Ouvrir la Banque</a>`;
    });
  }

  // ═══ Sous-titres traduits ═════════════════════════════════════════════════
  let captionLang = '';
  let capTimer = null, capSeq = 0;
  const capPending = new Map();

  function bindCaptionSocket() {
    if (bindCaptionSocket.done || !MeetState.socket) return;
    MeetState.socket.on('caption_translated', ({ requestId, ok, text }) => {
      const ctx = capPending.get(requestId); capPending.delete(requestId);
      if (!ctx || !ok || !text || !captionLang) return;
      const bar = $('captions-bar'); if (!bar) return;
      bar.style.display = 'block';
      if (!bar.querySelector('strong')) bar.innerHTML = `<strong style="color:#7dd3fc;">${esc(ctx.name)} :</strong> ${esc(ctx.text)}`;
      bar.querySelector('.cap-tr')?.remove();
      bar.insertAdjacentHTML('beforeend', `<div class="cap-tr" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.18);color:#fde68a;font-size:13px;">${esc(text)}</div>`);
      clearTimeout(_captionsHideTimer);
      _captionsHideTimer = setTimeout(() => { if (!_captionsEnabled) bar.style.display = 'none'; else bar.innerHTML = ''; }, 6000);
    });
    bindCaptionSocket.done = true;
  }

  function setCaptionLang(code) {
    captionLang = code || '';
    if (captionLang) bindCaptionSocket();
  }

  // Appelé à chaque sous-titre reçu : on attend que la phrase se stabilise avant de traduire
  function onCaption(name, text) {
    if (!captionLang || !MeetState.socket) return;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => {
      const requestId = 'cap_' + (++capSeq);
      capPending.set(requestId, { name, text });
      MeetState.socket.emit('caption_translate', { meetingId: MeetState.MEETING_ID, text, target: captionLang, requestId });
    }, 1200);
  }

  // ═══ Transcription IA / compte-rendu automatique (activé par l'hôte) ═══════
  let summaryBound = false;

  function renderPill(on) {
    let pill = $('mai-pill');
    if (!on) { pill?.remove(); return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'mai-pill';
      pill.style.cssText = 'position:fixed;top:12px;left:12px;z-index:900;display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:rgba(8,145,178,.92);color:#fff;font-size:11.5px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;';
      pill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#fff;animation:maiPulse 1.4s infinite;"></span>Compte-rendu IA actif';
      document.body.appendChild(pill);
    }
  }

  function bindSummarySocket() {
    if (summaryBound || !MeetState.socket) return summaryBound;
    MeetState.socket.on('ai_summary_state', ({ on, by, silent }) => {
      renderPill(on);
      const box = $('mai-toggle-box'); if (box) box.checked = !!on;
      if (silent) return;
      notify(on
        ? `${by || "L'hôte"} a activé le compte-rendu IA : le chat et les sous-titres sont conservés jusqu'à la fin de la réunion. Activez vos sous-titres pour que votre voix soit incluse.`
        : 'Compte-rendu IA désactivé : la transcription a été effacée.');
    });
    MeetState.socket.emit('ai_summary_get', { meetingId: MeetState.MEETING_ID });
    summaryBound = true;
    return true;
  }

  function toggleSummary(on) {
    if (!MeetState.socket) return;
    MeetState.socket.emit('ai_summary_toggle', { meetingId: MeetState.MEETING_ID, on: !!on });
  }

  if (MeetState.IS_HOST) { const w = $('mai-toggle'); if (w) w.style.display = 'inline-flex'; }
  const summaryPoll = setInterval(() => { if (bindSummarySocket()) clearInterval(summaryPoll); }, 1000);
  setTimeout(() => clearInterval(summaryPoll), 10 * 60 * 1000);

  g.MeetAIExtras = { enhanceSummary, openQuizModal, setCaptionLang, onCaption, toggleSummary };
})(window);
