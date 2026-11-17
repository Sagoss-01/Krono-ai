/**
 * public/js/meeting/meeting-breakout.js
 * Salles de sous-groupes : panneau hôte (créer/répartir/ouvrir/fermer),
 * redirection automatique des participants assignés, bannière "retour à la
 * salle principale" visible dans chaque sous-salle, retour minuté ou manuel.
 */
let _breakoutRoomCount    = 3;
let _breakoutDuration     = 0; // minutes, 0 = retour manuel uniquement
let _breakoutParticipants = [];
let _breakoutAssignments  = {}; // socketId -> index de salle

function escHtmlBreakout(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Panneau hôte ─────────────────────────────────────────────────────────
function openBreakoutPanel() {
  if (!MeetState.IS_HOST) return;
  document.getElementById('breakout-panel')?.remove();

  _breakoutParticipants = (typeof popcornGetParticipants === 'function') ? popcornGetParticipants() : [];
  _breakoutRoomCount = 3;
  _breakoutDuration = 0;
  _breakoutAssignments = {};

  const div = document.createElement('div');
  div.id = 'breakout-panel';
  div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;';
  div.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;width:480px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 22px;flex-shrink:0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text1);">Salles de sous-groupes</div>
            <div style="font-size:11px;color:var(--muted);">${_breakoutParticipants.length} participant(s) connecté(s)</div>
          </div>
        </div>
        <button onclick="document.getElementById('breakout-panel').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;">×</button>
      </div>

      <div style="padding:20px 22px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:16px;">
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Nombre de salles</label>
          <div style="display:flex;gap:8px;">
            ${[2,3,4,5,6].map(n=>`<button type="button" onclick="breakoutSetRoomCount(${n})" id="brk-count-${n}" style="flex:1;padding:8px;border-radius:8px;border:1px solid ${n===3?'var(--accent)':'var(--border)'};background:${n===3?'rgba(3,92,128,.3)':'transparent'};color:var(--text1);font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${n}</button>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <button type="button" onclick="breakoutAutoDistribute()" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">🔀 Répartir automatiquement</button>
        </div>

        <div id="breakout-assign-list" style="margin-bottom:16px;"></div>

        <div style="margin-bottom:8px;">
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Retour automatique</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" onclick="breakoutSetDuration(0)"  id="brk-dur-0"  style="flex:1;min-width:70px;padding:7px;border-radius:7px;border:1px solid var(--accent);background:rgba(3,92,128,.3);color:var(--text1);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Manuel</button>
            ${[5,10,15,30].map(m=>`<button type="button" onclick="breakoutSetDuration(${m})" id="brk-dur-${m}" style="flex:1;min-width:50px;padding:7px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${m} min</button>`).join('')}
          </div>
        </div>
      </div>

      <div style="padding:16px 22px;border-top:1px solid var(--border);flex-shrink:0;">
        <button onclick="breakoutOpen()" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:white;font-size:14px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">Ouvrir les salles</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  div.addEventListener('click', e => { if (e.target === div) div.remove(); });

  breakoutRenderAssignList();
}

function breakoutSetRoomCount(n) {
  _breakoutRoomCount = n;
  [2,3,4,5,6].forEach(i => {
    const btn = document.getElementById('brk-count-'+i);
    if (!btn) return;
    btn.style.borderColor = i===n ? 'var(--accent)' : 'var(--border)';
    btn.style.background  = i===n ? 'rgba(3,92,128,.3)' : 'transparent';
  });
  Object.keys(_breakoutAssignments).forEach(id => {
    if (_breakoutAssignments[id] >= n) delete _breakoutAssignments[id];
  });
  breakoutRenderAssignList();
}

function breakoutSetDuration(m) {
  _breakoutDuration = m;
  [0,5,10,15,30].forEach(i => {
    const btn = document.getElementById('brk-dur-'+i);
    if (!btn) return;
    btn.style.borderColor = i===m ? 'var(--accent)' : 'var(--border)';
    btn.style.background  = i===m ? 'rgba(3,92,128,.3)' : 'transparent';
  });
}

function breakoutAutoDistribute() {
  _breakoutParticipants.forEach((p, i) => { _breakoutAssignments[p.id] = i % _breakoutRoomCount; });
  breakoutRenderAssignList();
}

function breakoutSetAssignment(participantId, value) {
  if (value === '') delete _breakoutAssignments[participantId];
  else _breakoutAssignments[participantId] = parseInt(value);
}

function breakoutRenderAssignList() {
  const el = document.getElementById('breakout-assign-list');
  if (!el) return;
  if (!_breakoutParticipants.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">Aucun participant à répartir pour l\'instant.</div>';
    return;
  }
  el.innerHTML = `
    <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Assignation</label>
    ${_breakoutParticipants.map(p => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.02);border:1px solid var(--border);margin-bottom:6px;">
        <div style="flex:1;font-size:12px;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtmlBreakout(p.name)}</div>
        <select onchange="breakoutSetAssignment('${p.id}', this.value)" style="padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:11px;font-family:'Sora',sans-serif;">
          <option value="">— Non assigné —</option>
          ${Array.from({length:_breakoutRoomCount}, (_,i)=>`<option value="${i}" ${_breakoutAssignments[p.id]===i?'selected':''}>Salle ${i+1}</option>`).join('')}
        </select>
      </div>`).join('')}
  `;
}

function breakoutOpen() {
  const assignments = { ..._breakoutAssignments };
  if (!Object.keys(assignments).length) {
    notify('⚠️ Assigne au moins un participant à une salle (ou clique "Répartir automatiquement")');
    return;
  }
  const rooms = Array.from({ length: _breakoutRoomCount }, (_, i) => ({ label: 'Salle ' + (i + 1) }));

  MeetState.socket?.emit('breakout_open', {
    meetingId: MeetState.MEETING_ID,
    rooms,
    assignments,
    durationMinutes: _breakoutDuration || null,
  });

  document.getElementById('breakout-panel')?.remove();
  _breakoutSessionActive = true;
  breakoutRenderHostWidget();
}

function breakoutCloseAll() {
  MeetState.socket?.emit('breakout_close', { meetingId: MeetState.MEETING_ID });
  _breakoutSessionActive = false;
  breakoutRenderHostWidget();
}

// ── Widget hôte (persiste tant que des salles sont ouvertes) ───────────────
let _breakoutSessionActive = false;

function breakoutRenderHostWidget() {
  let el = document.getElementById('breakout-host-widget');
  if (!_breakoutSessionActive) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'breakout-host-widget';
    el.style.cssText = 'position:fixed;left:16px;bottom:90px;z-index:9500;background:var(--bg2,#1a1a2e);border:1px solid rgba(139,92,246,.5);border-radius:12px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;font-family:\'Sora\',sans-serif;';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div style="font-size:12px;font-weight:800;color:#8b5cf6;white-space:nowrap;">🧩 Salles ouvertes</div>
    <button onclick="breakoutCloseAll()" style="padding:6px 11px;border-radius:8px;border:1px solid rgba(248,113,113,.4);background:transparent;color:#f87171;font-size:11px;font-weight:700;cursor:pointer;">Fermer toutes les salles</button>
  `;
}

// ── Côté participant assigné : redirection ─────────────────────────────────
function breakoutShowMoveOverlay(roomLabel, link) {
  const div = document.createElement('div');
  div.id = 'breakout-move-overlay';
  div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,10,20,.95);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';
  div.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
    <div style="color:#fff;font-size:18px;font-weight:800;">Direction : ${escHtmlBreakout(roomLabel)}</div>
    <div style="color:#94a3b8;font-size:13px;">Redirection en cours…</div>
  `;
  document.body.appendChild(div);
  setTimeout(() => { window.location.href = link; }, 1800);
}

// ── Retour à la salle principale (minuté ou manuel) ─────────────────────────
function breakoutReturnToParent() {
  if (!MeetState.PARENT_MEETING_ID) return;
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,10,20,.95);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';
  div.innerHTML = `
    <div style="color:#fff;font-size:18px;font-weight:800;">Retour à la salle principale…</div>
  `;
  document.body.appendChild(div);
  setTimeout(() => {
    window.location.href = `${window.location.origin}/meeting/${MeetState.PARENT_MEETING_ID}`;
  }, 1200);
}

// ── Bannière persistante quand on est DANS une sous-salle ──────────────────
function breakoutRenderInRoomBanner() {
  if (!MeetState.PARENT_MEETING_ID) return;
  const el = document.createElement('div');
  el.id = 'breakout-in-room-banner';
  el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9500;background:rgba(139,92,246,.95);color:#fff;padding:9px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:12px;font-family:\'Sora\',sans-serif;font-size:12px;font-weight:700;';
  el.innerHTML = `
    <span>🧩 ${escHtmlBreakout(MeetState.BREAKOUT_LABEL || 'Salle de sous-groupe')}</span>
    <button onclick="breakoutReturnToParent()" style="padding:5px 10px;border-radius:7px;border:none;background:rgba(255,255,255,.2);color:#fff;font-size:11px;font-weight:800;cursor:pointer;">← Salle principale</button>
  `;
  document.body.appendChild(el);
}

document.addEventListener('DOMContentLoaded', breakoutRenderInRoomBanner);
