// ── Enregistrement ───────────────────────────────────────────────────────────
async function toggleRecord() {
  const btn = document.getElementById('btn-rec') || document.getElementById('btn-record');
  const recIco = document.getElementById('rec-ico');
  const isMobileFallback = meetingIsMobileDevice() || !navigator.mediaDevices?.getDisplayMedia;

  if (MeetState._mediaRecorder?.state === 'recording') {
    try { MeetState._mediaRecorder.stop(); } catch (_) {}
    try { MeetState._recordDisplayStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { MeetState._recordCameraStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    MeetState.socket?.emit('recording_status', { meetingId: MeetState.MEETING_ID, active: false, mode: isMobileFallback ? 'mobile-camera' : 'screen' });
    if (btn) btn.className = 'ctrl-btn active';
    if (recIco) recIco.style.fill = '';
    notify('Enregistrement arrêté');
    return;
  }

  try { await showRecordingCountdown(3); } catch (_) {}

  let captureStream;
  let mode = 'screen';
  if (!isMobileFallback) {
    try {
      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, displaySurface: 'browser' },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'include'
      });
    } catch (_) {}
  }

  if (!captureStream) {
    mode = 'mobile-camera';
    try {
      captureStream = MeetState.localStream || await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      notify("Enregistrement refusé ou indisponible sur cet appareil");
      return;
    }
  }

  const mixedTracks = [];
  const videoTrack = captureStream.getVideoTracks()[0];
  if (!videoTrack) {
    notify("Impossible de récupérer la vidéo pour l'enregistrement");
    try { captureStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    return;
  }
  mixedTracks.push(videoTrack);

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let dest = null;
  try {
    audioCtx = new AudioCtx();
    dest = audioCtx.createMediaStreamDestination();

    if (captureStream.getAudioTracks().length) {
      try { audioCtx.createMediaStreamSource(new MediaStream(captureStream.getAudioTracks())).connect(dest); } catch (_) {}
    }
    if (mode === 'screen' && MeetState.localStream?.getAudioTracks()?.length) {
      try { audioCtx.createMediaStreamSource(new MediaStream(MeetState.localStream.getAudioTracks())).connect(dest); } catch (_) {}
    }
    dest.stream.getAudioTracks().forEach(t => mixedTracks.push(t));
  } catch (_) {}

  const finalStream = new MediaStream(mixedTracks);
  if (mode === 'screen') MeetState._recordDisplayStream = captureStream;
  else MeetState._recordCameraStream = captureStream;
  MeetState._recordAudioCtx = audioCtx;
  MeetState._recordChunks = [];

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm');
  MeetState._mediaRecorder = new MediaRecorder(finalStream, { mimeType });
  MeetState._mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) MeetState._recordChunks.push(e.data); };
  MeetState._mediaRecorder.onstop = () => {
    try { MeetState._recordDisplayStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { MeetState._recordCameraStream?.getTracks().forEach(t => { if (t.readyState === 'live' && t !== (MeetState.localStream?.getTracks() || []).find(x => x.id === t.id)) t.stop(); }); } catch (_) {}
    try { MeetState._recordAudioCtx?.close(); } catch (_) {}
    const blob = new Blob(MeetState._recordChunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${mode === 'screen' ? 'reunion' : 'camera'}-${MeetState.MEETING_ID}-${new Date().toISOString().slice(0,19)}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  videoTrack.addEventListener('ended', () => {
    if (MeetState._mediaRecorder?.state === 'recording') {
      try { MeetState._mediaRecorder.stop(); } catch (_) {}
      MeetState.socket?.emit('recording_status', { meetingId: MeetState.MEETING_ID, active: false, mode });
      if (btn) btn.className = 'ctrl-btn active';
      if (recIco) recIco.style.fill = '';
    }
  }, { once: true });

  MeetState._mediaRecorder.start(1000);
  MeetState.socket?.emit('recording_status', { meetingId: MeetState.MEETING_ID, active: true, mode });
  if (btn) btn.className = 'ctrl-btn rec-on';
  if (recIco) recIco.style.fill = '#f87171';
  notify(mode === 'screen' ? "Enregistrement d'écran démarré" : 'Enregistrement caméra + micro démarré');
}

// ── Contrôles taille W×H ─────────────────────────────────────────────────────
function wbSetW(v){
  v=Math.max(10,parseInt(v)||10); wbW_=v;
  if(wbSelectedObj){
    const obj=wbObjects.find(o=>o.id===wbSelectedObj); if(!obj) return;
    const bb=wbGetBBox(obj); if(!bb) return;
    const nw=v/MeetState.wbCanvas.width;
    if(obj.type==='sticker'){obj.x2=obj.x+nw;}
    else if(obj.type==='shape'){obj.x2=obj.x1+nw;}
    wbRedraw(); wbSaveHistory(); wbSyncAll();
  }
}
function wbSetH(v){
  v=Math.max(10,parseInt(v)||10); wbH_=v;
  if(wbSelectedObj){
    const obj=wbObjects.find(o=>o.id===wbSelectedObj); if(!obj) return;
    const bb=wbGetBBox(obj); if(!bb) return;
    const nh=v/MeetState.wbCanvas.height;
    if(obj.type==='sticker'){obj.y2=obj.y+nh;}
    else if(obj.type==='shape'){obj.y2=obj.y1+nh;}
    wbRedraw(); wbSaveHistory(); wbSyncAll();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODE POPCORN 🍿
// ════════════════════════════════════════════════════════════════════════════
let _popcornTimer = null;

function openPopcornLauncher() {
  if (!meetingHasControlPower()) return;
  const existing = document.getElementById('popcorn-launcher');
  if (existing) { existing.remove(); return; }

  // Construire la liste des participants ciblables (hors hôte / Catalyst)
  const participants = Array.from(document.querySelectorAll('.peer-tile'))
    .map(t => ({ id: t.id.replace('tile-',''), name: t.querySelector('.peer-name')?.textContent?.replace(' (vous)','').replace(/\s*·\s*Catalyst$/,'').trim() || '?', meta: MeetState.peerMeta[t.id.replace('tile-','')] || {} }))
    .filter(p => p.id !== 'local')
    .filter(p => !p.meta?.isCatalyst)
    .filter(p => (p.meta?.email || '').toLowerCase() !== (window.MEET_CONFIG.USER_EMAIL || '').toLowerCase());

  const div = document.createElement('div');
  div.id = 'popcorn-launcher';
  div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;';
  div.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;width:420px;max-width:95vw;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.6);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
        <div style="font-size:28px;">🍿</div>
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text1);">Mode Popcorn</div>
          <div style="font-size:12px;color:var(--muted);">Désignez un participant pour répondre</div>
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Participant</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="popcorn-target" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;">
            <option value="random">🎲 Aléatoire</option>
            ${participants.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Question</label>
        <textarea id="popcorn-question" placeholder="Ex: Quelle est la principale conclusion ?" rows="3"
          style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;resize:none;box-sizing:border-box;"></textarea>
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Durée de réponse</label>
        <div style="display:flex;gap:8px;">
          ${[15,30,45,60].map(s=>`<button onclick="document.getElementById('popcorn-duration').value=${s};this.parentElement.querySelectorAll('button').forEach(b=>b.style.background='');this.style.background='rgba(3,92,128,.3)'" style="flex:1;padding:7px;border-radius:7px;border:1px solid var(--border);background:${s===30?'rgba(3,92,128,.3)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${s}s</button>`).join('')}
          <input type="hidden" id="popcorn-duration" value="30">
        </div>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="document.getElementById('popcorn-launcher').remove()" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:13px;cursor:pointer;font-family:'Sora',sans-serif;">Annuler</button>
        <button onclick="launchPopcorn()" style="flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">🍿 Lancer !</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  div.addEventListener('click', e => { if(e.target===div) div.remove(); });
}

function launchPopcorn() {
  const sel      = document.getElementById('popcorn-target');
  const question = document.getElementById('popcorn-question').value.trim();
  const duration = parseInt(document.getElementById('popcorn-duration').value) || 30;

  if (!question) { notify('Écris une question !'); return; }

  let targetSocketId = sel.value;
  let targetName     = sel.options[sel.selectedIndex]?.text || '?';

  if (targetSocketId === 'random') {
    // Choisir un pair aléatoire
    const candidateIds = Object.keys(MeetState.peers).filter(k => !(MeetState.peerMeta[k]?.isCatalyst));
    if (!candidateIds.length) { notify('Aucun participant à désigner'); return; }
    const targetIdPicked = candidateIds[Math.floor(Math.random() * candidateIds.length)];
    const picked = MeetState.peers[targetIdPicked];
    targetSocketId = targetIdPicked;
    targetName     = (picked?.name || MeetState.peerMeta[targetIdPicked]?.name || 'Quelqu\'un').replace(/\s*·\s*Catalyst$/,'').trim();
  }

  document.getElementById('popcorn-launcher')?.remove();
  MeetState.socket?.emit('popcorn_launch', {
    meetingId: MeetState.MEETING_ID,
    targetSocketId,
    targetName,
    question,
    duration,
  });

  // L'hôte voit aussi la question
  notify(`🍿 Question posée à ${targetName}`);
}

function showPopcornModal(targetName, targetSocketId, question, duration) {
  closePopcornModal();
  const isTarget = targetSocketId === 'all' || MeetState.socket?.id === targetSocketId;
  const div = document.createElement('div');
  div.id = 'popcorn-modal';
  div.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;';

  div.innerHTML = `
    <div style="background:var(--bg2);border:2px solid ${isTarget?'#f59e0b':'var(--border)'};border-radius:20px;width:460px;max-width:95vw;padding:32px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.7);">
      <div style="font-size:48px;margin-bottom:12px;">🍿</div>
      <div style="font-size:${isTarget?'20':'15'}px;font-weight:800;color:var(--text1);margin-bottom:8px;">
        ${isTarget ? 'C\'est à vous !' : `${escHtml(targetName)} est désigné(e)`}
      </div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:20px;line-height:1.6;">${escHtml(question)}</div>
      <!-- Compte à rebours -->
      <div id="popcorn-countdown" style="font-size:48px;font-weight:900;color:${isTarget?'#f59e0b':'var(--accent)'};margin-bottom:${isTarget?'20':'0'}px;font-variant-numeric:tabular-nums;">${duration}</div>
      ${isTarget ? `
        <textarea id="popcorn-answer-inp" placeholder="Votre réponse…" rows="3"
          style="width:100%;padding:10px 12px;border-radius:10px;border:2px solid #f59e0b;background:var(--bg3);color:var(--text1);font-size:13px;font-family:'Sora',sans-serif;outline:none;resize:none;box-sizing:border-box;margin-bottom:14px;"></textarea>
        <button onclick="submitPopcornAnswer()" style="width:100%;padding:13px;border-radius:12px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:14px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">
          Répondre ✓
        </button>
      ` : ''}
    </div>`;
  document.body.appendChild(div);

  // Compte à rebours
  let remaining = duration;
  _popcornTimer = setInterval(() => {
    remaining--;
    const cd = document.getElementById('popcorn-countdown');
    if (cd) {
      cd.textContent = remaining;
      if (remaining <= 5) cd.style.color = '#f87171';
    }
    if (remaining <= 0) {
      clearInterval(_popcornTimer); _popcornTimer = null;
      if (isTarget) {
        MeetState.socket?.emit('popcorn_timeout', { meetingId: MeetState.MEETING_ID, targetName });
        closePopcornModal();
      }
    }
  }, 1000);
}

function submitPopcornAnswer() {
  const answer = document.getElementById('popcorn-answer-inp')?.value.trim();
  if (!answer) return;
  clearInterval(_popcornTimer); _popcornTimer = null;
  MeetState.socket?.emit('popcorn_answer', { meetingId: MeetState.MEETING_ID, answer });
  closePopcornModal();
}

function closePopcornModal() {
  clearInterval(_popcornTimer); _popcornTimer = null;
  document.getElementById('popcorn-modal')?.remove();
}

function showPopcornAnswer(name, answer) {
  document.getElementById('popcorn-answer-display')?.remove();
  const div = document.createElement('div');
  div.id = 'popcorn-answer-display';
  div.style.cssText = 'position:fixed;inset:0;z-index:9997;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  div.innerHTML = `
    <div style="background:rgba(0,0,0,.85);border:2px solid #f59e0b;border-radius:24px;padding:40px 56px;text-align:center;max-width:600px;width:90%;animation:popcornAnswerIn .3s ease;box-shadow:0 32px 80px rgba(0,0,0,.8);">
      <div style="font-size:14px;font-weight:700;color:#f59e0b;margin-bottom:10px;text-transform:uppercase;letter-spacing:.08em;">🎤 ${escHtml(name)} répond</div>
      <div style="font-size:clamp(22px,4vw,36px);font-weight:900;color:white;line-height:1.3;">${escHtml(answer)}</div>
    </div>
    <style>@keyframes popcornAnswerIn{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}</style>`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 6000);
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE QUIZ ⚡
// ════════════════════════════════════════════════════════════════════════════
let _quizTimer    = null;
let _quizVoted    = false;
let _quizScores   = {};

function openQuizCreator() {
  if (!meetingHasControlPower()) return;
  const existing = document.getElementById('quiz-creator');
  if (existing) { existing.remove(); return; }

  const div = document.createElement('div');
  div.id = 'quiz-creator';
  div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;';
  div.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;width:500px;max-width:96vw;max-height:92vh;box-shadow:0 24px 64px rgba(0,0,0,.7);display:flex;flex-direction:column;overflow:hidden;">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px 0;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:24px;">⚡</span>
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text1);">Live Quiz</div>
            <div style="font-size:11px;color:var(--muted);">Créer · Classement · Historique</div>
          </div>
        </div>
        <button onclick="document.getElementById('quiz-creator').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;">×</button>
      </div>

      <!-- Onglets -->
      <div style="display:flex;gap:0;padding:12px 22px 0;flex-shrink:0;">
        <button id="qtab-create"  onclick="quizCreatorTab('create')"  style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">✏️ Créer</button>
        <button id="qtab-scores"  onclick="quizCreatorTab('scores')"  style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">🏆 Classement</button>
        <button id="qtab-history" onclick="quizCreatorTab('history')" style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">📋 Historique</button>
      </div>
      <div style="height:1px;background:var(--border);flex-shrink:0;"></div>

      <!-- Contenu scrollable -->
      <div id="qtab-body" style="flex:1;overflow-y:auto;padding:18px 22px;"></div>

    </div>`;
  document.body.appendChild(div);
  div.addEventListener('click', e => { if(e.target===div) div.remove(); });
  quizCreatorTab('create');
}

function quizCreatorTab(tab) {
  ['create','scores','history'].forEach(t => {
    const btn = document.getElementById('qtab-'+t);
    if (!btn) return;
    const active = t === tab;
    btn.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent';
    btn.style.color        = active ? 'var(--accent)' : 'var(--muted)';
    btn.style.fontWeight   = active ? '800' : '600';
  });
  const body = document.getElementById('qtab-body');
  if (!body) return;
  if (tab === 'create')  renderQuizCreateTab(body);
  if (tab === 'scores')  renderQuizScoresTab(body);
  if (tab === 'history') renderQuizHistoryTab(body);
}

function renderQuizCreateTab(body) {
  body.innerHTML = `
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Question</label>
      <textarea id="quiz-question" placeholder="Ex: Quel est le principal avantage ?" rows="2"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;resize:none;box-sizing:border-box;"></textarea>
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Options (2 à 4)</label>
      ${[0,1,2,3].map(i=>`
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <div style="width:22px;height:22px;border-radius:6px;background:${['#f87171','#22c55e','#4db8d8','#a78bfa'][i]};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:white;flex-shrink:0;">${'ABCD'[i]}</div>
          <input id="quiz-opt-${i}" type="text" placeholder="${i<2?'Option '+(i+1)+' (obligatoire)':'Option '+(i+1)+' (optionnel)'}"
            style="flex:1;padding:7px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;">
        </div>`).join('')}
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Bonne réponse</label>
      <div style="display:flex;gap:8px;">
        ${['A','B','C','D'].map((l,i)=>`<button id="quiz-correct-${i}" onclick="_quizCorrectIdx=${i};document.querySelectorAll('[id^=quiz-correct-]').forEach((b,j)=>{b.style.background=j===${i}?'rgba(34,197,94,.2)':'transparent';b.style.borderColor=j===${i}?'#22c55e':'var(--border)'})" style="flex:1;padding:7px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${l}</button>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Points pour bonne réponse</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        ${[1,2,3,5,10].map(p=>`<button onclick="_quizPoints=${p};_quizIsBingo=false;document.querySelectorAll('.qpt-btn').forEach(b=>{b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--text1)'});this.style.background='rgba(3,92,128,.3)';this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" class="qpt-btn" style="flex:1;min-width:40px;padding:7px;border-radius:7px;border:1px solid ${p===1?'var(--accent)':'var(--border)'};background:${p===1?'rgba(3,92,128,.3)':'transparent'};color:${p===1?'var(--accent)':'var(--text1)'};font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${p}pt</button>`).join('')}
        <button onclick="_quizPoints=20;_quizIsBingo=true;document.querySelectorAll('.qpt-btn').forEach(b=>{b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--text1)'});this.style.background='rgba(245,158,11,.25)';this.style.borderColor='#f59e0b';this.style.color='#f59e0b'" class="qpt-btn" style="flex:1;min-width:58px;padding:7px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;line-height:1.3;" title="Bingo — 20 pts">🎯 Bingo<br><small style="font-weight:600;font-size:9px;">20pts</small></button>
      </div>
      <!-- Bonus rapidité -->
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.02);">
        <input type="checkbox" id="quiz-speed-bonus" onchange="_quizSpeedBonus=this.checked" style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer;">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--text1);">⚡ Bonus rapidité</div>
          <div style="font-size:10px;color:var(--muted);">+1pt supplémentaire pour les 3 premiers à répondre correctement (3ème=+1, 2ème=+2, 1er=+3)</div>
        </div>
      </label>
    </div>
    <div style="margin-bottom:20px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Durée</label>
      <div style="display:flex;gap:8px;">
        ${[15,20,30,45].map(s=>`<button onclick="document.getElementById('quiz-duration').value=${s};this.parentElement.querySelectorAll('button').forEach(b=>{b.style.cssText='flex:1;padding:7px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:Sora,sans-serif;'});this.style.background='rgba(3,92,128,.3)';this.style.borderColor='var(--accent)'" style="flex:1;padding:7px;border-radius:7px;border:1px solid ${s===30?'var(--accent)':'var(--border)'};background:${s===30?'rgba(3,92,128,.3)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${s}s</button>`).join('')}
        <input type="hidden" id="quiz-duration" value="30">
      </div>
    </div>
    <button onclick="launchQuiz()" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#a78bfa,#6d28d9);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">⚡ Lancer le quiz</button>
  `;
}

function renderQuizScoresTab(body) {
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  if (!_quizLiveLeaderboard || !_quizLiveLeaderboard.length) {
    body.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:13px;">Aucun score encore.<br>Lance un quiz pour commencer !</div>';
    return;
  }
  // Barre d'actions (export + nettoyer) — hôte uniquement
  const actionsBar = meetingHasControlPower() ? `
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <button onclick="quizExportScores('txt')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">↓ TXT</button>
      <button onclick="quizExportScores('pdf')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">↓ PDF</button>
      <button onclick="quizClearScores()" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(248,113,113,.3);background:transparent;color:#f87171;font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">🗑 Nettoyer</button>
    </div>` : '';
  const max = _quizLiveLeaderboard[0]?.total || 1;
  body.innerHTML = actionsBar + `
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Cumulatif depuis le début de la réunion</div>
    ${_quizLiveLeaderboard.slice(0,15).map((s,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:${i===0?'rgba(245,158,11,.08)':'rgba(255,255,255,.02)'};margin-bottom:6px;border:1px solid ${i===0?'rgba(245,158,11,.2)':'var(--border)'};">
        <span style="font-size:${i<3?'20':'14'}px;width:24px;text-align:center;flex-shrink:0;">${medals[i]||i+1}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escHtml(s.name)}
            ${s.name===MeetState.displayName?'<span style="font-size:9px;font-weight:700;color:var(--accent);background:rgba(3,92,128,.15);padding:1px 5px;border-radius:10px;margin-left:4px;">Vous</span>':''}
          </div>
          <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.1);margin-top:4px;overflow:hidden;">
            <div style="height:100%;border-radius:2px;background:${i===0?'#f59e0b':'var(--accent)'};width:${Math.round(s.total/max*100)}%;transition:width .5s;"></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span style="font-size:14px;font-weight:900;color:${i===0?'#f59e0b':'var(--accent)'};">${s.total}pts</span>
          <button onclick="quizApplaud('${escHtml(s.name).replace(/'/g,"\'")}')" style="padding:4px 8px;border-radius:16px;border:none;background:rgba(245,158,11,.15);color:#f59e0b;font-size:13px;cursor:pointer;" title="Applaudir">👏</button>
        </div>
      </div>`).join('')}`;
}

function renderQuizHistoryTab(body) {
  if (!_quizHistory || !_quizHistory.length) {
    body.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:13px;">Aucune question posée encore.</div>';
    return;
  }
  const actionsBar = meetingHasControlPower() ? `
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <button onclick="quizExportHistory('txt')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">↓ TXT</button>
      <button onclick="quizExportHistory('pdf')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">↓ PDF</button>
      <button onclick="quizClearHistory()" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(248,113,113,.3);background:transparent;color:#f87171;font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">🗑 Nettoyer</button>
    </div>` : '';
  const colors = ['#f87171','#22c55e','#4db8d8','#a78bfa'];
  body.innerHTML = actionsBar;
  body.innerHTML += _quizHistory.slice().reverse().map((q, ri) => {
    const i = _quizHistory.length - 1 - ri;
    const total = q.votes.reduce((a,b)=>a+b,0) || 1;
    return `
      <div style="margin-bottom:14px;padding:14px;border-radius:12px;background:rgba(255,255,255,.02);border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:10px;font-weight:700;color:var(--muted);">Q${i+1} · ${q.ts||''} · ${q.isBingo?'🎯 Bingo':'⚡ '+q.points+'pt'}</span>
          <span style="font-size:10px;color:var(--muted);">${total} vote${total>1?'s':''}</span>
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--text1);margin-bottom:10px;line-height:1.5;">${escHtml(q.question)}</div>
        ${q.options.map((opt, oi) => {
          const pct   = Math.round(q.votes[oi]/total*100);
          const ok    = oi === q.correctIdx;
          const names = (q.voterNames[oi]||[]);
          return `
            <div style="margin-bottom:7px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${ok?'#22c55e':'var(--text2)'};font-weight:${ok?'800':'500'};">
                  <span style="width:18px;height:18px;border-radius:4px;background:${colors[oi]};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:white;flex-shrink:0;">${'ABCD'[oi]}</span>
                  ${escHtml(opt)} ${ok?'<span style="font-size:10px;">✓</span>':''}
                </div>
                <span style="font-size:11px;font-weight:700;color:${ok?'#22c55e':'var(--muted)'};">${q.votes[oi]}v · ${pct}%</span>
              </div>
              <div style="height:5px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden;">
                <div style="height:100%;background:${ok?'#22c55e':colors[oi]};width:${pct}%;transition:width .5s;"></div>
              </div>
              ${names.length?`<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px;">${names.map(n=>`<span style="background:${ok?'rgba(34,197,94,.12)':'rgba(255,255,255,.05)'};border:1px solid ${ok?'rgba(34,197,94,.25)':'var(--border)'};padding:1px 6px;border-radius:20px;font-size:9px;color:${ok?'#22c55e':'var(--text2)'};">${escHtml(n)}</span>`).join('')}</div>`:''}
            </div>`;
        }).join('')}
      </div>`;
  }).join('');
}


function launchQuiz() {
  const question = document.getElementById('quiz-question')?.value.trim();
  if (!question) { notify('Écris une question !'); return; }

  const allOpts = [0,1,2,3].map(i => document.getElementById('quiz-opt-'+i)?.value.trim());
  const options = allOpts.filter(Boolean);
  if (options.length < 2) { notify('Ajoute au moins 2 options'); return; }

  const points   = (typeof _quizPoints !== 'undefined') ? _quizPoints : 1;
  const correctIdx = (typeof _quizCorrectIdx !== 'undefined') ? _quizCorrectIdx : -1;
  const duration   = parseInt(document.getElementById('quiz-duration')?.value) || 30;

  // Validation : la bonne réponse doit correspondre à une option remplie
  if (correctIdx < 0) { notify('⚠️ Sélectionne la bonne réponse (A/B/C/D)'); return; }
  if (!allOpts[correctIdx] || allOpts[correctIdx].trim() === '') {
    const letter = 'ABCD'[correctIdx];
    notify('⚠️ La bonne réponse (' + letter + ') ne correspond à aucune option remplie !');
    // Mettre en évidence le problème
    const btn = document.getElementById('quiz-correct-' + correctIdx);
    if (btn) { btn.style.border = '2px solid #f87171'; btn.style.background = 'rgba(248,113,113,.2)'; }
    return;
  }

  document.getElementById('quiz-creator')?.remove();
  _quizVoted = false; _quizCorrectIdx = -1;
  const isBingo    = (typeof _quizIsBingo    !== 'undefined') ? _quizIsBingo    : false;
  const speedBonus = (typeof _quizSpeedBonus !== 'undefined') ? _quizSpeedBonus : false;
  MeetState.socket?.emit('quiz_launch', {
    meetingId: MeetState.MEETING_ID,
    question, options, correctIdx, duration, points, isBingo, speedBonus,
  });
  _quizIsBingo = false; _quizSpeedBonus = false;
}

function showQuizVote(q) {
  closeQuizModal();
  _quizVoted = false;
  const isControl = meetingHasControlPower();
  const colors  = ['#f87171','#22c55e','#4db8d8','#a78bfa'];
  const isBingo = q.isBingo === true;

  // Son et alerte Bingo
  if (isBingo) {
    playBingoSound();
    showBingoAlert();
  }

  const div = document.createElement('div');
  div.id = 'quiz-modal';
  div.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9000;background:var(--bg2);border:2px solid ${isBingo?'#f59e0b':'var(--border)'};border-radius:18px;width:500px;max-width:95vw;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,.6);`;

  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:20px;">${isBingo?'🎯':'⚡'}</span>
        <span style="font-size:13px;font-weight:800;color:${isBingo?'#f59e0b':'var(--text1)'};">
          ${isBingo?'BINGO — 20 points !':'Quiz en direct'}
        </span>
        ${isBingo?`<span style="background:#f59e0b;color:white;font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;animation:bingoPulse 1s ease infinite alternate;">🎯 20pts</span>`:`<span style="background:var(--bg3);color:var(--muted);font-size:10px;padding:2px 8px;border-radius:20px;">${q.points||1}pt${(q.points||1)>1?'s':''}</span>`}
      </div>
      <div id="quiz-cd" style="font-size:22px;font-weight:900;color:${isBingo?'#f59e0b':'#a78bfa'};min-width:32px;text-align:right;">${q.duration}</div>
    </div>
    <div style="font-size:14px;font-weight:700;color:var(--text1);margin-bottom:14px;line-height:1.5;">${escHtml(q.question)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;" id="quiz-opts">
      ${q.options.map((opt,i)=>`
        <button id="qopt-${i}" onclick="submitQuizVote(${i},'${q.id}')" ${isControl?'disabled':''} style="padding:12px;border-radius:10px;border:2px solid ${colors[i]}33;background:${colors[i]}11;color:var(--text1);font-size:12px;font-weight:700;cursor:${isControl?'default':'pointer'};font-family:'Sora',sans-serif;text-align:left;transition:all .15s;display:flex;align-items:center;gap:8px;">
          <span style="width:22px;height:22px;border-radius:6px;background:${colors[i]};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:white;flex-shrink:0;">${'ABCD'[i]}</span>
          <span>${escHtml(opt)}</span>
        </button>`).join('')}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
      <div id="quiz-vote-count" style="font-size:11px;color:var(--muted);">${isControl ? 'Les animateurs voient le quiz mais ne répondent pas.' : '0 vote'}</div>
      ${meetingHasControlPower()?`<button onclick="openQuizLeaderboard()" style="padding:4px 10px;border-radius:20px;border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.1);color:#f59e0b;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">🏆 Classement</button>`:''}
    </div>
    <style>@keyframes bingoPulse{from{opacity:.7;transform:scale(.95)}to{opacity:1;transform:scale(1.05)}}</style>`;
  document.body.appendChild(div);

  let rem = q.duration;
  _quizTimer = setInterval(() => {
    rem--;
    const cd = document.getElementById('quiz-cd');
    if (cd) { cd.textContent = rem; if(rem<=5) cd.style.color='#f87171'; }
    if (rem <= 0) { clearInterval(_quizTimer); _quizTimer = null; }
  }, 1000);
}

function playBingoSound() {
  try {
    const ctx = new AudioContext();
    // Fanfare courte : do-mi-sol-do
    [[523,.0],[659,.15],[784,.3],[1047,.45]].forEach(([freq,t])=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='triangle'; o.connect(g); g.connect(ctx.destination);
      o.frequency.value=freq;
      g.gain.setValueAtTime(.25,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+t+.35);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+.4);
    });
  } catch(_){}
}

function showBingoAlert() {
  document.getElementById('bingo-alert')?.remove();
  const d = document.createElement('div');
  d.id = 'bingo-alert';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10001;pointer-events:none;text-align:center;animation:bingoIn .4s cubic-bezier(.34,1.56,.64,1);';
  d.innerHTML = `<div style="font-size:72px;line-height:1;">🎯</div><div style="font-size:32px;font-weight:900;color:#f59e0b;text-shadow:0 0 20px rgba(245,158,11,.8);">BINGO !</div><div style="font-size:18px;font-weight:700;color:white;text-shadow:0 2px 8px rgba(0,0,0,.8);">20 points en jeu !</div><style>@keyframes bingoIn{from{opacity:0;transform:translate(-50%,-50%) scale(.3)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}</style>`;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(), 2500);
}

function submitQuizVote(idx, quizId) {
  if (_quizVoted) return;
  _quizVoted = true;
  // Highlight le choix
  document.querySelectorAll('[id^=qopt-]').forEach((b,i)=>{
    b.style.opacity = i===idx?'1':'0.4';
    b.disabled = true;
  });
  MeetState.socket?.emit('quiz_vote', {
    meetingId: MeetState.MEETING_ID,
    optionIdx: idx,
    displayName: MeetState.displayName,
  });
}

function showQuizResults(r) {
  closeQuizModal();
  const colors = ['#f87171','#22c55e','#4db8d8','#a78bfa'];
  const total  = r.votes.reduce((a,b)=>a+b,0)||1;
  const vn     = r.voterNames || {};

  const div = document.createElement('div');
  div.id = 'quiz-results-modal';
  div.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9000;background:var(--bg2);border:1px solid var(--border);border-radius:18px;width:520px;max-width:95vw;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,.6);max-height:80vh;overflow-y:auto;';

  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:20px;">⚡</span>
        <span style="font-size:14px;font-weight:800;color:var(--text1);">Résultats — ${total} vote${total>1?'s':''}</span>
      </div>
      <button onclick="document.getElementById('quiz-results-modal').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:20px;line-height:1;">×</button>
    </div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px;font-weight:600;">${escHtml(r.question)}</div>
    ${r.options.map((opt,i)=>{
      const pct        = Math.round(r.votes[i]/total*100);
      const isCorrect  = i===r.correctIdx;
      const voters     = vn[i] || [];
      const voterHtml  = voters.length
        ? voters.map(n=>`<span style="background:${isCorrect?'rgba(34,197,94,.15)':'rgba(255,255,255,.06)'};border:1px solid ${isCorrect?'rgba(34,197,94,.3)':'var(--border)'};padding:2px 7px;border-radius:20px;font-size:10px;color:${isCorrect?'#22c55e':'var(--text2)'};">${escHtml(n)}</span>`).join(' ')
        : '';
      return `
        <div style="margin-bottom:12px;padding:10px 12px;border-radius:10px;background:${isCorrect?'rgba(34,197,94,.06)':'rgba(255,255,255,.02)'};border:1px solid ${isCorrect?'rgba(34,197,94,.2)':'var(--border)'};">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text1);font-weight:${isCorrect?'800':'500'};">
              <span style="width:22px;height:22px;border-radius:6px;background:${colors[i]};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:white;flex-shrink:0;">${'ABCD'[i]}</span>
              ${escHtml(opt)}
              ${isCorrect?'<span style="font-size:11px;color:#22c55e;font-weight:800;">✓ Bonne réponse</span>':''}
            </div>
            <span style="font-size:12px;font-weight:800;color:${isCorrect?'#22c55e':'var(--muted)'};">${r.votes[i]}v · ${pct}%</span>
          </div>
          <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;margin-bottom:${voterHtml?'8':'0'}px;">
            <div style="height:100%;border-radius:3px;background:${isCorrect?'#22c55e':colors[i]};width:${pct}%;transition:width .6s ease;"></div>
          </div>
          ${voterHtml?`<div style="display:flex;flex-wrap:wrap;gap:4px;">${voterHtml}</div>`:''}
        </div>`;
    }).join('')}
    ${(r.scores&&r.scores.length)||(r.leaderboard&&r.leaderboard.length)?`
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
        ${r.scores&&r.scores.length?`
          <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">⚡ Cette question</div>
          ${r.scores.slice(0,5).map((s,i)=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;font-size:12px;color:var(--text1);">
              <div style="display:flex;align-items:center;gap:7px;"><span>${['🥇','🥈','🥉','4️⃣','5️⃣'][i]}</span>${escHtml(s.name)}${s.name===MeetState.displayName?'<span style="font-size:9px;font-weight:700;color:var(--accent);background:rgba(3,92,128,.15);padding:1px 5px;border-radius:10px;">Vous</span>':''}</div>
              <span style="font-weight:800;color:var(--accent);">+${s.score}pt${s.score>1?'s':''}</span>
            </div>`).join('')}`:``}
        ${r.leaderboard&&r.leaderboard.length?`
          <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:10px;margin-bottom:6px;">🏆 Classement général</div>
          ${r.leaderboard.slice(0,8).map((s,i)=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-radius:8px;background:${i===0?'rgba(245,158,11,.1)':'transparent'};">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text1);">
                <span style="font-size:${i<3?'16':'12'}px;">${['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'][i]}</span>
                ${escHtml(s.name)}
                ${s.name===MeetState.displayName?'<span style="font-size:9px;font-weight:700;color:var(--accent);background:rgba(3,92,128,.15);padding:1px 5px;border-radius:10px;margin-left:2px;">Vous</span>':''}
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:13px;font-weight:900;color:${i===0?'#f59e0b':'var(--accent)'};">${s.total}pts</span>
                ${meetingHasControlPower()?`<button onclick="quizApplaud('${escHtml(s.name)}')" style="padding:3px 8px;border-radius:20px;border:none;background:rgba(245,158,11,.15);color:#f59e0b;font-size:12px;cursor:pointer;" title="Applaudir">👏</button>`:''}
              </div>
            </div>`).join('')}`:``}
      </div>`:``}
  `;
  document.body.appendChild(div);
}

function closeQuizModal() {
  clearInterval(_quizTimer); _quizTimer = null;
  document.getElementById('quiz-modal')?.remove();
}

// Panel classement temps réel pour l'hôte
let _lbInterval = null;
function openQuizLeaderboard() {
  const existing = document.getElementById('quiz-lb-panel');
  if (existing) { existing.remove(); clearInterval(_lbInterval); return; }

  const panel = document.createElement('div');
  panel.id = 'quiz-lb-panel';
  panel.style.cssText = 'position:fixed;top:50%;right:16px;transform:translateY(-50%);z-index:9100;background:var(--bg2);border:1px solid rgba(245,158,11,.35);border-radius:18px;width:300px;max-height:85vh;box-shadow:0 20px 60px rgba(0,0,0,.7);overflow:hidden;display:flex;flex-direction:column;';
  panel.innerHTML = `
    <div style="padding:12px 14px;background:rgba(245,158,11,.08);border-bottom:1px solid rgba(245,158,11,.2);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">⚡</span>
        <span style="font-size:13px;font-weight:800;color:#f59e0b;">Live Quiz</span>
        <span style="font-size:9px;font-weight:700;color:var(--muted);background:rgba(245,158,11,.15);padding:1px 6px;border-radius:10px;text-transform:uppercase;animation:liveDot 1.5s ease infinite alternate;">● LIVE</span>
      </div>
      <button onclick="openQuizLeaderboard()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;line-height:1;">×</button>
    </div>
    <!-- Onglets -->
    <div style="display:flex;border-bottom:1px solid var(--border);flex-shrink:0;">
      <button id="qlt-scores" onclick="quizLbTab('scores')" style="flex:1;padding:9px 4px;border:none;background:rgba(245,158,11,.1);color:#f59e0b;font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;border-bottom:2px solid #f59e0b;">🏆 Scores</button>
      <button id="qlt-history" onclick="quizLbTab('history')" style="flex:1;padding:9px 4px;border:none;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;border-bottom:2px solid transparent;">📋 Historique</button>
    </div>
    <!-- Contenu -->
    <div id="quiz-lb-body" style="flex:1;overflow-y:auto;min-height:0;"></div>
    <style>@keyframes liveDot{from{opacity:.4}to{opacity:1}}</style>`;
  document.body.appendChild(panel);
  quizLbTab('scores');
  _lbInterval = setInterval(() => { if (document.getElementById('quiz-lb-panel')) renderQuizLeaderboard(); else clearInterval(_lbInterval); }, 2000);
}

function quizLbTab(tab) {
  ['scores','history'].forEach(t => {
    const btn = document.getElementById('qlt-'+t);
    if (!btn) return;
    btn.style.background   = t===tab ? 'rgba(245,158,11,.1)' : 'transparent';
    btn.style.color        = t===tab ? '#f59e0b' : 'var(--muted)';
    btn.style.fontWeight   = t===tab ? '800' : '600';
    btn.style.borderBottom = t===tab ? '2px solid #f59e0b' : '2px solid transparent';
  });
  const body = document.getElementById('quiz-lb-body');
  if (!body) return;
  if (tab === 'scores') renderQuizLeaderboard();
  else renderQuizHistory();
}

function renderQuizLeaderboard() {
  const list = document.getElementById('quiz-lb-body') || document.getElementById('quiz-lb-list');
  if (!list) { clearInterval(_lbInterval); return; }
  if (!_quizLiveLeaderboard || !_quizLiveLeaderboard.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:var(--muted);">Aucun score pour l\'instant</div>';
    return;
  }
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const max = _quizLiveLeaderboard[0]?.total || 1;
  list.innerHTML = _quizLiveLeaderboard.slice(0,10).map((s,i)=>`
    <div style="padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);background:${i===0?'rgba(245,158,11,.06)':'transparent'};">
      <span style="font-size:${i<3?'18':'13'}px;flex-shrink:0;width:20px;text-align:center;">${medals[i]||String(i+1)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(s.name)}${s.name===MeetState.displayName?' <span style="font-size:9px;font-weight:700;color:var(--accent);background:rgba(3,92,128,.15);padding:1px 5px;border-radius:10px;">Vous</span>':''}</div>
        <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.1);margin-top:3px;overflow:hidden;">
          <div style="height:100%;border-radius:2px;background:${i===0?'#f59e0b':'var(--accent)'};width:${Math.round(s.total/max*100)}%;transition:width .4s;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <span style="font-size:13px;font-weight:900;color:${i===0?'#f59e0b':'var(--accent)'};">${s.total}pt</span>
        <button onclick="quizApplaud('${escHtml(s.name)}')" style="padding:3px 6px;border-radius:16px;border:none;background:rgba(245,158,11,.15);color:#f59e0b;font-size:11px;cursor:pointer;font-family:'Sora',sans-serif;" title="Applaudir">👏</button>
      </div>
    </div>`).join('');
}

function renderQuizHistory() {
  const body = document.getElementById('quiz-lb-body');
  if (!body) return;
  if (!_quizHistory.length) {
    body.innerHTML = '<div style="padding:20px;text-align:center;font-size:12px;color:var(--muted);">Aucune question pour l\'instant</div>';
    return;
  }
  const colors = ['#f87171','#22c55e','#4db8d8','#a78bfa'];
  body.innerHTML = _quizHistory.slice().reverse().map((q,ri)=>{
    const i = _quizHistory.length - 1 - ri;
    const total = q.votes.reduce((a,b)=>a+b,0)||1;
    return `<div style="padding:12px;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:10px;font-weight:700;color:var(--muted);">Q${i+1} · ${q.ts||''} · ${q.isBingo?'🎯 Bingo':'⚡ '+q.points+'pt'}</span>
        <span style="font-size:10px;color:var(--muted);">${total} vote${total>1?'s':''}</span>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:8px;line-height:1.4;">${escHtml(q.question)}</div>
      ${q.options.map((opt,oi)=>{
        const pct = Math.round(q.votes[oi]/total*100);
        const ok  = oi===q.correctIdx;
        const vnames = (q.voterNames[oi]||[]).slice(0,3).map(n=>escHtml(n)).join(', ');
        return `<div style="margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
            <span style="color:${ok?'#22c55e':'var(--text2)'}; font-weight:${ok?'800':'500'};">
              <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${colors[oi]};color:white;font-size:8px;font-weight:800;text-align:center;line-height:14px;margin-right:3px;">${'ABCD'[oi]}</span>
              ${escHtml(opt)} ${ok?'✓':''}
            </span>
            <span style="color:var(--muted);">${q.votes[oi]}v</span>
          </div>
          <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;">
            <div style="height:100%;background:${ok?'#22c55e':colors[oi]};width:${pct}%;"></div>
          </div>
          ${vnames?`<div style="font-size:9px;color:var(--muted);margin-top:1px;">${vnames}${(q.voterNames[oi]||[]).length>3?' +'+((q.voterNames[oi]||[]).length-3):''}</div>`:''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

let _quizLiveLeaderboard = [];
let _quizHistory         = []; // { question, options, correctIdx, votes, voterNames, scores }

// ── Persistance localStorage ──────────────────────────────────────────────────
function quizSaveToStorage() {
  try {
    const key = 'quiz_' + MeetState.MEETING_ID;
    localStorage.setItem(key, JSON.stringify({
      leaderboard: _quizLiveLeaderboard,
      history:     _quizHistory,
      savedAt:     Date.now(),
    }));
  } catch(_) {}
}

function quizLoadFromStorage() {
  try {
    const key  = 'quiz_' + MeetState.MEETING_ID;
    const raw  = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);
    // Expire après 4h
    if (Date.now() - (data.savedAt||0) > 4*3600*1000) { localStorage.removeItem(key); return; }
    if (data.leaderboard?.length) _quizLiveLeaderboard = data.leaderboard;
    if (data.history?.length)     _quizHistory         = data.history;
    console.log('[Quiz] État restauré depuis localStorage:', _quizHistory.length, 'questions');
  } catch(_) {}
}

// ── Export & Nettoyage Quiz ───────────────────────────────────────────────────

function quizExportScores(format) {
  if (!_quizLiveLeaderboard.length) { notify('Aucun score à exporter'); return; }
  const medals = ['🥇','🥈','🥉','4.','5.','6.','7.','8.','9.','10.'];
  const lines  = [
    '=== CLASSEMENT QUIZ — ' + new Date().toLocaleString('fr-FR') + ' ===',
    '',
    ..._quizLiveLeaderboard.map((s,i) => medals[i] + ' ' + s.name + ' — ' + s.total + ' pts'),
    '',
    'Réunion : ' + (MeetState.MEETING_ID || ''),
  ];
  if (format === 'txt') {
    _quizDownload('classement_quiz.txt', lines.join('\n'), 'text/plain');
  } else {
    _quizPrintHTML(
      'Classement Quiz',
      `<h2 style="color:#6d28d9;">🏆 Classement</h2>
       <table style="width:100%;border-collapse:collapse;">
         <tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Rang</th><th style="padding:8px;text-align:left;">Joueur</th><th style="padding:8px;text-align:right;">Points</th></tr>
         ${_quizLiveLeaderboard.map((s,i)=>`<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px;">${medals[i]}</td><td style="padding:8px;font-weight:600;">${escHtml(s.name)}</td><td style="padding:8px;text-align:right;font-weight:700;color:#6d28d9;">${s.total} pts</td></tr>`).join('')}
       </table>`
    );
  }
}

function quizExportHistory(format) {
  if (!_quizHistory.length) { notify('Aucun historique à exporter'); return; }
  if (format === 'txt') {
    const lines = ['=== HISTORIQUE QUIZ — ' + new Date().toLocaleString('fr-FR') + ' ===', ''];
    _quizHistory.forEach((q, i) => {
      const total = q.votes.reduce((a,b)=>a+b,0)||1;
      lines.push('Q' + (i+1) + ' [' + (q.ts||'') + '] ' + (q.isBingo?'BINGO':'') + ' (' + q.points + 'pt) — ' + q.question);
      q.options.forEach((opt, oi) => {
        const pct = Math.round(q.votes[oi]/total*100);
        const ok  = oi === q.correctIdx;
        lines.push('  ' + 'ABCD'[oi] + '. ' + opt + ' — ' + q.votes[oi] + ' vote(s) (' + pct + '%)' + (ok?' ✓':''));
        if (q.voterNames[oi]?.length) lines.push('     → ' + q.voterNames[oi].join(', '));
      });
      lines.push('');
    });
    _quizDownload('historique_quiz.txt', lines.join('\n'), 'text/plain');
  } else {
    const rows = _quizHistory.map((q,i) => {
      const total = q.votes.reduce((a,b)=>a+b,0)||1;
      const opts  = q.options.map((opt,oi) => {
        const pct = Math.round(q.votes[oi]/total*100);
        const ok  = oi===q.correctIdx;
        return `<li style="color:${ok?'#16a34a':'#374151'};font-weight:${ok?'700':'400'};">${'ABCD'[oi]}. ${escHtml(opt)} — ${q.votes[oi]}v (${pct}%) ${ok?'✓':''}</li>`;
      }).join('');
      return `<div style="margin-bottom:18px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Q${i+1} · ${q.ts||''} · ${q.isBingo?'🎯 Bingo':q.points+'pt'}</div>
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px;">${escHtml(q.question)}</div>
        <ul style="margin:0;padding-left:18px;">${opts}</ul>
      </div>`;
    }).join('');
    _quizPrintHTML('Historique Quiz', `<h2 style="color:#6d28d9;">📋 Historique des questions</h2>${rows}`);
  }
}

function quizClearScores() {
  if (!confirm('Supprimer tout le classement ?')) return;
  _quizLiveLeaderboard = [];
  quizSaveToStorage();
  quizCreatorTab('scores');
  notify('🗑 Classement effacé');
}

function quizClearHistory() {
  if (!confirm('Supprimer tout l\'historique ?')) return;
  _quizHistory = [];
  quizSaveToStorage();
  quizCreatorTab('history');
  notify('🗑 Historique effacé');
}

function _quizDownload(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

function _quizPrintHTML(title, bodyHtml) {
  const win = window.open('', '_blank');
  if (!win) { notify('Autorisez les pop-ups pour exporter en PDF'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; max-width: 720px; margin: 40px auto; color: #111827; }
      h2   { border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
      @media print { body { margin: 20px; } }
    </style>
  </head><body>
    <p style="font-size:12px;color:#6b7280;">${title} · ${new Date().toLocaleString('fr-FR')} · Réunion : ${MeetState.MEETING_ID||''}</p>
    ${bodyHtml}
    <script>window.onload=()=>{window.print();}<\/scr'+'ipt>
  </body></html>`);
  win.document.close();
}

function quizApplaud(targetName) {
  MeetState.socket?.emit('quiz_applaud', { meetingId: MeetState.MEETING_ID, targetName });
  showApplauseEffect(targetName, true);
}

function showApplauseEffect(targetName, isLocal) {
  document.getElementById('applause-overlay')?.remove();
  const div = document.createElement('div');
  div.id = 'applause-overlay';
  div.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  div.innerHTML = `
    <div style="text-align:center;animation:applauseIn .4s cubic-bezier(.34,1.56,.64,1);">
      <div style="font-size:clamp(60px,12vw,100px);animation:applauseBounce 0.5s ease infinite alternate;line-height:1;">👏</div>
      <div style="font-size:clamp(18px,3vw,28px);font-weight:900;color:white;margin-top:12px;text-shadow:0 2px 20px rgba(0,0,0,.8);">${escHtml(targetName)}</div>
      <div style="font-size:14px;color:rgba(255,255,255,.8);margin-top:6px;font-weight:600;">${isLocal ? 'Bravo !' : "L\'hote vous applaudit !"}</div>
    </div>
    <style>
      @keyframes applauseIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
      @keyframes applauseBounce{from{transform:scale(1) rotate(-8deg)}to{transform:scale(1.15) rotate(8deg)}}
    </style>`;
  document.body.appendChild(div);
  // Son d'applaudissements (bruit blanc filtré en rafale)
  try {
    const ctx = new AudioContext();
    for (let i=0; i<6; i++) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
      const d   = buf.getChannelData(0);
      for (let j=0;j<d.length;j++) d[j] = (Math.random()*2-1) * Math.pow(1-j/d.length,2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 0.5;
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.4, ctx.currentTime + i*0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.18 + 0.16);
      src.start(ctx.currentTime + i*0.18);
    }
  } catch(_){}
  setTimeout(() => div.remove(), 3000);
}
