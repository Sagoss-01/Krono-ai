/**
 * public/js/meeting-sidebar.js — TechSphere Meet
 * Fixes: inputs thème, date MySQL, code manuel/auto, invités anonymes, historique
 */
const MeetSidebar = (() => {
  let open = false;
  let _currentMeetingLink = '';
  let _currentMeetingId   = '';

  const INP = 'width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-1);font-size:13px;font-family:\'Sora\',sans-serif;outline:none;transition:border-color .2s;';
  const INP_SM   = INP.replace('font-size:13px','font-size:12px');
  const INP_CODE = INP + 'font-size:22px;font-weight:800;letter-spacing:.2em;text-align:center;';
  const LABEL    = 'display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:7px;';
  const BTN_SEC  = 'flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text-2);font-size:13px;font-weight:600;cursor:pointer;font-family:\'Sora\',sans-serif;';

  function toMysqlDatetime(v) {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
  }

  function genCode6() { return String(Math.floor(100000 + Math.random() * 900000)); }

  function toggle() {
    open = !open;
    document.getElementById('sb-meet-body').style.display = open ? 'block' : 'none';
    const c = document.getElementById('meet-chevron');
    if (c) c.style.transform = open ? 'rotate(180deg)' : '';
    if (open) loadMyMeetings();
  }

  async function loadMyMeetings() {
    const el = document.getElementById('sb-my-meetings');
    if (!el) return;
    try {
      const res = await App.apiGet('/api/meetings');
      if (!res.ok || !res.meetings.length) { el.innerHTML = ''; return; }
      el.innerHTML = res.meetings.map(m => {
        const dt = m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Maintenant';
        const badge = m.status === 'live' ? '<span class="meet-live-badge">EN DIRECT</span>' : '';
        return `<div class="folder-item" onclick="MeetSidebar.openMeeting('${m.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          <div style="min-width:0;flex:1;"><div class="meet-item-title">${esc(m.title)}${badge}</div><div class="meet-item-date sb-label">${dt}</div></div>
        </div>`;
      }).join('');
    } catch(e) { el.innerHTML = ''; }
  }

  function openMeeting(id) { window.open('/meeting/' + id, '_blank'); }
  function instant()       { showModal('instant'); }
  function openSchedule()  { showModal('schedule'); }
  function openJoin()      { showModal('join'); }
  function openHistory()   { showModal('history'); }

  function showModal(type) {
    removeModal();
    const overlay = document.createElement('div');
    overlay.id = 'meet-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    const minDt = new Date(Date.now() + 5*60000).toISOString().slice(0,16);

    const codeField = `
      <div id="code-field" style="display:none;margin-bottom:14px;">
        <label style="${LABEL}">Code d'accès</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="meet-code" type="text" maxlength="10" placeholder="Ex: 482916" style="${INP}"/>
          <button onclick="document.getElementById('meet-code').value=MeetSidebar.genCode()"
            style="padding:9px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-2);font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'Sora',sans-serif;">
            Générer
          </button>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Laissez vide pour générer automatiquement</div>
      </div>`;

    const emailsField = `
      <div id="emails-field" style="display:none;margin-bottom:14px;">
        <label style="${LABEL}">Emails autorisés (un par ligne)</label>
        <textarea id="meet-emails" rows="3" placeholder="alice@example.com" style="${INP_SM}resize:none;"></textarea>
      </div>`;

    const guestsField = `
      <div style="margin-bottom:14px;">
        <label style="${LABEL}">Autoriser les invités anonymes</label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);">
          <input type="checkbox" id="meet-allow-guests" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;flex-shrink:0;"/>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-1);">Personnes sans compte</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">Elles pourront rejoindre via le lien, sans se connecter</div>
          </div>
        </label>
      </div>`;

    const meetResult = (color='34,197,94', accentColor='#22c55e', label='✓ Réunion créée !') => `
      <div id="meet-result" style="display:none;margin-bottom:16px;padding:14px;border-radius:12px;background:rgba(${color},0.07);border:1px solid rgba(${color},0.18);">
        <div style="font-size:12px;font-weight:700;color:${accentColor};margin-bottom:8px;">${label}</div>
        <div style="font-size:12px;color:var(--text-2);word-break:break-all;" id="meet-link-display"></div>
        <div id="meet-code-display" style="display:none;margin-top:8px;">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">Code d'accès</div>
          <div style="font-size:22px;font-weight:800;color:var(--text-1);letter-spacing:.2em;" id="meet-code-val"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button onclick="MeetSidebar.copyLink()" style="flex:1;padding:8px;border-radius:8px;border:none;background:rgba(3,92,128,0.15);color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Copier le lien</button>
          <button id="btn-go-meeting" onclick="MeetSidebar.goToMeeting()" style="display:none;flex:1;padding:8px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Rejoindre</button>
        </div>
      </div>`;

    const accessSelect = `
      <div style="margin-bottom:14px;">
        <label style="${LABEL}">Qui peut rejoindre ?</label>
        <select id="meet-access" onchange="MeetSidebar.onAccessChange()" style="${INP}">
          <option value="link">Toute personne avec le lien</option>
          <option value="code">Avec un code d'accès</option>
          <option value="emails">Adresses email autorisées</option>
        </select>
      </div>`;

    const header = (icon, color, title, sub) => `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;">
        <div style="width:42px;height:42px;border-radius:12px;background:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon}</div>
        <div><div style="font-size:16px;font-weight:800;color:var(--text-1);">${title}</div><div style="font-size:12px;color:var(--text-muted);">${sub}</div></div>
      </div>`;

    const btns = (cancelLabel, confirmLabel, confirmStyle) => `
      <div style="display:flex;gap:10px;" id="meet-btns">
        <button onclick="MeetSidebar.removeModal()" style="${BTN_SEC}">${cancelLabel}</button>
        <button onclick="MeetSidebar.createMeeting(${confirmLabel==='Démarrer'})" style="${confirmStyle}">${confirmLabel}</button>
      </div>`;

    const cards = {
      instant: `<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:18px;width:100%;max-width:400px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.45);max-height:90vh;overflow-y:auto;">
        ${header('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>','rgba(3,92,128,0.12)','Démarrer maintenant','Réunion instantanée')}
        <div style="margin-bottom:14px;"><label style="${LABEL}">Nom de la réunion</label><input id="meet-title" type="text" placeholder="Ma réunion…" value="Réunion du ${new Date().toLocaleDateString('fr-FR')}" style="${INP}"/></div>
        ${accessSelect}${codeField}${emailsField}${guestsField}
        ${meetResult('34,197,94','#22c55e','✓ Réunion créée !')}
        ${btns('Annuler','Démarrer','flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--accent),#024a6a);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:\'Sora\',sans-serif;')}
      </div>`,

      schedule: `<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:18px;width:100%;max-width:420px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.45);max-height:90vh;overflow-y:auto;">
        ${header('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>','rgba(139,92,246,0.12)','Programmer une réunion','Planifiez à l\'avance')}
        <div style="margin-bottom:14px;"><label style="${LABEL}">Titre</label><input id="meet-title" type="text" placeholder="Réunion d'équipe…" style="${INP}"/></div>
        <div style="margin-bottom:14px;"><label style="${LABEL}">Date et heure</label><input id="meet-dt" type="datetime-local" min="${minDt}" style="${INP}"/></div>
        ${accessSelect}${codeField}${emailsField}${guestsField}
        ${meetResult('139,92,246','#a78bfa','✓ Réunion programmée !')}
        ${btns('Annuler','Programmer','flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:\'Sora\',sans-serif;')}
      </div>`,

      join: `<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:18px;width:100%;max-width:380px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.45);">
        ${header('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>','rgba(34,197,94,0.1)','Rejoindre une réunion','Via lien ou code')}
        <div style="margin-bottom:10px;"><label style="${LABEL}">Lien ou ID de réunion</label><input id="join-link" type="text" placeholder="https://… ou xk7m-pq3n-wr5t" style="${INP}"/></div>
        <div style="text-align:center;font-size:11px;color:var(--text-muted);margin:10px 0;">— ou —</div>
        <div style="margin-bottom:20px;"><label style="${LABEL}">Code d'accès</label><input id="join-code" type="text" maxlength="10" placeholder="482916" style="${INP_CODE}"/></div>
        <div id="join-err" style="display:none;font-size:12px;color:#f87171;margin-bottom:10px;text-align:center;padding:8px;border-radius:8px;background:rgba(248,113,113,0.08);"></div>
        <div style="display:flex;gap:10px;">
          <button onclick="MeetSidebar.removeModal()" style="${BTN_SEC}">Annuler</button>
          <button onclick="MeetSidebar.joinMeeting()" style="flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Rejoindre</button>
        </div>
      </div>`,

      history: `<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:18px;width:100%;max-width:460px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.45);max-height:85vh;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:42px;height:42px;border-radius:12px;background:rgba(3,92,128,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <div style="font-size:16px;font-weight:800;color:var(--text-1);">Historique des réunions</div>
          </div>
          <button onclick="MeetSidebar.removeModal()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;border-radius:6px;display:flex;align-items:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div id="history-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;max-height:60vh;padding-right:2px;"><div style="text-align:center;color:var(--text-muted);font-size:13px;padding:24px;">Chargement…</div></div>
      </div>`,
    };

    overlay.innerHTML = cards[type] || '';
    overlay.addEventListener('click', e => { if (e.target === overlay) removeModal(); });
    overlay._kd = e => { if (e.key === 'Escape') removeModal(); };
    document.addEventListener('keydown', overlay._kd);
    document.body.appendChild(overlay);

    if (type === 'history') loadHistory();
    setTimeout(() => {
      document.getElementById('meet-title')?.focus() ||
      document.getElementById('join-link')?.focus();
    }, 50);
  }

  async function loadHistory() {
    const el = document.getElementById('history-list');
    if (!el) return;
    try {
      const res = await App.apiGet('/api/meetings/history');
      if (!res.ok || !res.meetings.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:24px;">Aucune réunion dans l\'historique</div>';
        return;
      }

      // Séparer actives (live/scheduled) et terminées
      const active  = res.meetings.filter(m => m.status !== 'ended');
      const ended   = res.meetings.filter(m => m.status === 'ended');

      const renderCard = m => {
        const start = m.started_at ? new Date(m.started_at).toLocaleString('fr-FR') : null;
        const end   = m.ended_at   ? new Date(m.ended_at).toLocaleString('fr-FR')   : null;
        const sched = m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('fr-FR') : null;
        const sc = {live:'#22c55e', scheduled:'#f59e0b', ended:'#64748b'}[m.status] || '#64748b';
        const sl = {live:'En direct', scheduled:'Programmée', ended:'Terminée'}[m.status] || m.status;

        let timeInfo = '';
        if (m.status === 'scheduled' && sched) timeInfo = `Prévu : ${sched}`;
        else if (m.status === 'live'  && start) timeInfo = `Démarrée : ${start}`;
        else if (m.status === 'ended') {
          if (start) timeInfo = `Début : ${start}`;
          if (end)   timeInfo += (timeInfo ? ' · ' : '') + `Fin : ${end}`;
        }

        const accessIcon = {link:'🔗', code:'🔑', emails:'📧'}[m.access] || '🔗';

        return `<div style="padding:14px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);${m.status==='live'?'border-color:rgba(34,197,94,0.3);':m.status==='ended'?'opacity:.75;':''}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;gap:8px;">
            <div style="font-size:13px;font-weight:700;color:var(--text-1);flex:1;">${esc(m.title)}</div>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${sc}22;color:${sc};white-space:nowrap;flex-shrink:0;">${sl}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;display:flex;align-items:center;gap:8px;">
            <span>${accessIcon} ${accessLabel(m.access)}</span>
            ${timeInfo ? `<span>· ${timeInfo}</span>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${m.status!=='ended' ? `<button onclick="MeetSidebar.openMeeting('${m.id}')" style="padding:6px 14px;border-radius:8px;border:none;background:${m.status==='live'?'rgba(34,197,94,0.15)':'rgba(3,92,128,0.12)'};color:${m.status==='live'?'#22c55e':'var(--accent)'};font-size:12px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">Rejoindre</button>` : ''}
            <button onclick="MeetSidebar.copyMeetingLink('${m.id}')" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:'Sora',sans-serif;">Copier lien</button>
            <button onclick="MeetSidebar.deleteMeeting('${m.id}')" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;font-size:11px;cursor:pointer;font-family:'Sora',sans-serif;display:flex;align-items:center;gap:4px;"><svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/></svg>Supprimer</button>
          </div>
        </div>`;
      };

      let html = '';
      if (active.length) {
        html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding:4px 0 8px;">En cours / Programmées (${active.length})</div>`;
        html += active.map(renderCard).join('');
      }
      if (ended.length) {
        html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding:${active.length?'16px 0 8px':'4px 0 8px'};">Terminées (${ended.length})</div>`;
        html += ended.map(renderCard).join('');
      }
      el.innerHTML = html;
    } catch(e) {
      el.innerHTML = '<div style="text-align:center;color:#f87171;font-size:13px;padding:24px;">Erreur de chargement</div>';
    }
  }

  function onAccessChange() {
    const val = document.getElementById('meet-access')?.value;
    const ef  = document.getElementById('emails-field');
    const cf  = document.getElementById('code-field');
    if (ef) ef.style.display = val === 'emails' ? 'block' : 'none';
    if (cf) cf.style.display = val === 'code'   ? 'block' : 'none';
  }

  function genCode() { return genCode6(); }

  async function createMeeting(instant) {
    const title     = (document.getElementById('meet-title')?.value||'').trim()||'Réunion';
    const access    = document.getElementById('meet-access')?.value||'link';
    const emails    = document.getElementById('meet-emails')?.value||'';

    const dtVal     = document.getElementById('meet-dt')?.value;
    const codeVal   = (document.getElementById('meet-code')?.value||'').trim();
    const schedAt   = (!instant && dtVal) ? toMysqlDatetime(dtVal) : null;
    const lastBtn   = document.querySelector('#meet-btns button:last-child');

    if (lastBtn) { lastBtn.disabled = true; lastBtn.textContent = '…'; }

    try {
      const allowGuests = document.getElementById('meet-allow-guests')?.checked ? '1' : '';
      const res = await App.apiPost('/api/meetings', {
        title, access,
        allowedEmails: emails,
        scheduledAt:   schedAt,
        customCode:    codeVal,
        allowGuests,
        instant:       instant ? '1' : '',
      });

      if (!res.ok) {
        if (lastBtn) { lastBtn.disabled = false; lastBtn.textContent = instant ? 'Démarrer' : 'Programmer'; }
        App.toast(res.error||'Erreur création', 'error');
        return;
      }

      _currentMeetingLink = res.link;
      _currentMeetingId   = res.id;

      const resultEl = document.getElementById('meet-result');
      if (resultEl) {
        resultEl.style.display = '';
        document.getElementById('meet-link-display').textContent = res.link;
        if (res.code) {
          document.getElementById('meet-code-display').style.display = '';
          document.getElementById('meet-code-val').textContent = res.code;
        }
        if (instant) {
          const goBtn = document.getElementById('btn-go-meeting');
          if (goBtn) goBtn.style.display = 'flex';
        }
      }
      if (lastBtn) lastBtn.style.display = 'none';
      const cancelBtn = document.querySelector('#meet-btns button:first-child');
      if (cancelBtn) cancelBtn.textContent = 'Fermer';

      loadMyMeetings();
      App.toast(instant ? 'Réunion créée !' : 'Réunion programmée !', 'success');
    } catch(e) {
      App.toast('Erreur réseau', 'error');
      if (lastBtn) { lastBtn.disabled = false; lastBtn.textContent = instant ? 'Démarrer' : 'Programmer'; }
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(_currentMeetingLink).then(() => App.toast('Lien copié !','success'));
  }
  function goToMeeting() { removeModal(); window.open('/meeting/'+_currentMeetingId,'_blank'); }

  async function joinMeeting() {
    const linkVal = (document.getElementById('join-link')?.value||'').trim();
    const codeVal = (document.getElementById('join-code')?.value||'').trim();
    const errEl   = document.getElementById('join-err');
    const showErr = m => { if(errEl){errEl.textContent=m;errEl.style.display='';} };

    if (errEl) errEl.style.display = 'none';

    if (linkVal) {
      const match = linkVal.match(/meeting\/([a-z0-9-]+)/i);
      removeModal();
      window.open('/meeting/'+(match?match[1]:linkVal),'_blank');
      return;
    }
    if (codeVal) {
      try {
        const res = await App.apiPost('/api/meetings/join-by-code',{code:codeVal});
        if (!res.ok) { showErr(res.error||'Code invalide ou réunion terminée'); return; }
        removeModal();
        window.open('/meeting/'+res.id,'_blank');
      } catch(e) { showErr('Erreur réseau'); }
      return;
    }
    showErr('Entrez un lien ou un code d\'accès');
  }

  function removeModal() {
    const o = document.getElementById('meet-modal-overlay');
    if (!o) return;
    if (o._kd) document.removeEventListener('keydown', o._kd);
    o.remove();
  }

  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function accessLabel(access) {
    return {link:'🔗 Lien libre', code:'🔑 Code requis', emails:'📧 Emails autorisés'}[access] || access;
  }

  function copyMeetingLink(id) {
    const link = window.location.origin + '/meeting/' + id;
    navigator.clipboard.writeText(link).then(() => App.toast('Lien copié !', 'success'));
  }

  async function deleteMeeting(id) {
    // Modale confirmation
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;width:320px;padding:24px;box-shadow:0 24px 64px rgba(0,0,0,.5);">
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </div>
        <div style="text-align:center;margin-bottom:18px;">
          <div style="font-size:15px;font-weight:800;color:var(--text-1);margin-bottom:6px;">Supprimer la réunion ?</div>
          <div style="font-size:12px;color:var(--text-muted);">Cette action est irréversible. La réunion sera supprimée de l'historique.</div>
        </div>
        <div style="display:flex;gap:10px;">
          <button id="del-cancel" style="flex:1;padding:10px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text-2);font-size:13px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">Annuler</button>
          <button id="del-confirm" style="flex:1;padding:10px;border-radius:9px;border:none;background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Supprimer</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#del-cancel').onclick  = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#del-confirm').onclick = async () => {
      overlay.remove();
      try {
        const res = await App.apiDelete('/api/meetings/' + id);
        if (res.ok) {
          App.toast('Réunion supprimée', 'success');
          loadHistory();
          loadMyMeetings();
        } else {
          App.toast(res.error || 'Erreur suppression', 'error');
        }
      } catch(e) { App.toast('Erreur réseau', 'error'); }
    };
  }

  return { toggle, instant, openSchedule, openJoin, openHistory, createMeeting, copyLink, copyMeetingLink, goToMeeting, joinMeeting, removeModal, onAccessChange, openMeeting, genCode, loadMyMeetings, deleteMeeting };
})();
