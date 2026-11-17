/**
 * meeting-features.js
 * Minuteur de parole, tableau blanc, enregistrement, push notifications,
 * et listeners socket pour ces fonctionnalités.
 */

// ── Minuteur de parole ───────────────────────────────────────────────────────
function startSpeechTimer(id) {
  if (MeetState.speechTimers[id]?.interval) return;
  if (!MeetState.speechTimers[id]) MeetState.speechTimers[id] = { seconds: 0 };
  MeetState.speechTimers[id].interval = setInterval(() => {
    MeetState.speechTimers[id].seconds++;
    updateSpeechTimerUI(id);
  }, 1000);
  document.getElementById('tile-' + id)?.classList.add('speaking');
  const el = document.getElementById('speech-' + id);
  if (el) { el.style.display = 'block'; el.style.opacity = '1'; }
}

function stopSpeechTimer(id) {
  if (!MeetState.speechTimers[id]) return;
  clearInterval(MeetState.speechTimers[id].interval);
  delete MeetState.speechTimers[id];
  const el = document.getElementById('speech-' + id);
  if (el) el.style.opacity = '0.5';
}

function updateSpeechTimerUI(id) {
  const data = MeetState.speechTimers[id];
  if (!data) return;
  const tile = document.getElementById('tile-' + id);
  if (!tile) return;
  let el = document.getElementById('speech-' + id);
  if (!el) { el = document.createElement('div'); el.id = 'speech-' + id; el.className = 'speech-timer'; tile.appendChild(el); }
  el.style.display = 'block';
  const m = Math.floor(data.seconds / 60);
  const s = data.seconds % 60;
  el.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${m}:${s.toString().padStart(2,'0')}`;
  if (MeetState.speechLimit > 0 && data.seconds > MeetState.speechLimit) {
    el.className = 'speech-timer exceeded';
    if (data.seconds === MeetState.speechLimit + 1) {
      const name = tile.querySelector('.peer-name')?.textContent || 'Un participant';
      notify(`⏰ ${name} a dépassé la limite de parole !`);
      if (id === 'local' && navigator.vibrate) navigator.vibrate([300,100,300]);
    }
  } else if (MeetState.speechLimit > 0 && data.seconds > MeetState.speechLimit * 0.75) {
    el.className = 'speech-timer warning';
  } else { el.className = 'speech-timer'; }

  if (MeetState.speechLimit > 0) {
    let bar = document.getElementById('spbar-' + id);
    if (!bar) { bar = document.createElement('div'); bar.id = 'spbar-' + id; bar.className = 'speak-limit-bar'; tile.appendChild(bar); }
    const pct = Math.min(100, Math.round(data.seconds / MeetState.speechLimit * 100));
    bar.style.width = pct + '%';
    bar.style.background = pct < 75 ? '#22c55e' : pct < 100 ? '#f59e0b' : '#ef4444';
  }
}

let _stCtx = null, _stInterval = null, _stSpeaking = false;
function initSpeechTimers() {
  if (!MeetState.localStream?.getAudioTracks().length) return;
  try {
    _stCtx = new AudioContext();
    const analyser = _stCtx.createAnalyser();
    analyser.fftSize = 512;
    _stCtx.createMediaStreamSource(MeetState.localStream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    _stInterval = setInterval(() => {
      analyser.getByteFrequencyData(buf);
      const rms = buf.reduce((a,b) => a+b, 0) / buf.length;
      const isSpeaking = rms > 15;
      if (isSpeaking && !_stSpeaking) {
        _stSpeaking = true;
        startSpeechTimer('local');
        MeetState.socket?.emit('speech_start', { meetingId: MeetState.MEETING_ID });
      } else if (!isSpeaking && _stSpeaking) {
        _stSpeaking = false;
        stopSpeechTimer('local');
        MeetState.socket?.emit('speech_stop', { meetingId: MeetState.MEETING_ID });
      }
    }, 200);
  } catch(e) {}
}

function setSpeechLimit(minutes) {
  MeetState.speechLimit = minutes * 60;
  MeetState.socket?.emit('speech_limit', { meetingId: MeetState.MEETING_ID, limit: MeetState.speechLimit });
  const btn = document.getElementById('btn-speak-limit');
  if (minutes > 0) {
    notify(`Limite de parole : ${minutes} minute${minutes>1?'s':''} par personne`);
    if (btn) { btn.classList.add('active'); btn.style.background = 'rgba(245,158,11,0.15)'; btn.style.color = '#f59e0b'; }
  } else {
    notify('Limite de parole désactivée');
    if (btn) { btn.classList.remove('active'); btn.style.background = ''; btn.style.color = ''; }
    document.querySelectorAll('.speak-limit-bar').forEach(b => b.remove());
  }
}

function openSpeakLimit() {
  const cur = MeetState.speechLimit > 0 ? Math.floor(MeetState.speechLimit/60) : '';
  const ov  = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;';
  ov.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;width:320px;padding:28px;box-shadow:0 32px 80px rgba(0,0,0,.6);">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <div style="width:40px;height:40px;border-radius:11px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.2);display:flex;align-items:center;justify-content:center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div><div style="font-size:15px;font-weight:800;color:var(--text1);">Limite de parole</div><div style="font-size:11px;color:var(--muted);">Par participant</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      ${[1,2,3,5].map(m => `<button onclick="document.getElementById('sl-inp').value=${m}" style="flex:1;padding:8px 4px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${m} min</button>`).join('')}
    </div>
    <input id="sl-inp" type="number" min="0" max="60" value="${cur}" placeholder="Minutes (0 = off)"
      style="width:100%;padding:11px;border-radius:10px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:18px;font-weight:700;text-align:center;outline:none;font-family:'Sora',sans-serif;box-sizing:border-box;"/>
    <div style="font-size:10px;color:var(--muted);text-align:center;margin-top:6px;">0 pour désactiver</div>
    <div style="display:flex;gap:10px;margin-top:18px;">
      <button onclick="this.closest('[style]').remove()" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">Annuler</button>
      <button id="sl-ok" style="flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Appliquer</button>
    </div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) ov.remove(); });
  document.getElementById('sl-inp')?.focus();
  document.getElementById('sl-ok').onclick = () => {
    const v = parseInt(document.getElementById('sl-inp').value) || 0;
    ov.remove(); setSpeechLimit(v);
  };
}
