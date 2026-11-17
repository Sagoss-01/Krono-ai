// ── Enregistrement ───────────────────────────────────────────────────────────
function getRecordButton() {
  return document.getElementById('btn-rec') || document.getElementById('btn-record');
}

function setRecordButtonState(isRecording) {
  const btn = getRecordButton();
  const ico = document.getElementById('rec-ico');
  if (!btn) return;
  btn.className = isRecording ? 'ctrl-btn rec-on' : 'ctrl-btn active';
  btn.style.background = isRecording ? 'rgba(248,113,113,.18)' : '';
  btn.style.borderColor = isRecording ? 'rgba(248,113,113,.45)' : '';
  btn.style.color = isRecording ? '#f87171' : '';
  if (ico) ico.style.fill = isRecording ? '#f87171' : '';
}

function showRecordCountdown(seconds = 3) {
  return new Promise((resolve) => {
    document.getElementById('record-countdown-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'record-countdown-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(4,10,20,.42);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="width:min(360px,88vw);padding:28px 26px;border-radius:22px;background:rgba(8,15,26,.92);border:1px solid rgba(248,113,113,.28);box-shadow:0 22px 70px rgba(0,0,0,.55);text-align:center;">
        <div style="display:inline-flex;width:54px;height:54px;border-radius:999px;background:rgba(248,113,113,.14);border:1px solid rgba(248,113,113,.26);align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="#f87171" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>
        </div>
        <div style="font-size:14px;color:var(--text2);font-weight:700;letter-spacing:.02em;">Enregistrement imminent</div>
        <div id="record-countdown-value" style="font-size:72px;line-height:1;font-weight:900;color:#f87171;margin:10px 0 8px;">${seconds}</div>
        <div style="font-size:12px;color:var(--muted);">Préparez-vous, la capture démarre dans quelques secondes.</div>
      </div>`;
    document.body.appendChild(overlay);

    let remaining = seconds;
    MeetState.recordCountdownTimer = setInterval(() => {
      remaining -= 1;
      const value = document.getElementById('record-countdown-value');
      if (remaining <= 0) {
        clearInterval(MeetState.recordCountdownTimer);
        MeetState.recordCountdownTimer = null;
        overlay.remove();
        resolve();
        return;
      }
      if (value) value.textContent = remaining;
    }, 1000);
  });
}

async function toggleRecord() {
  if (MeetState._mediaRecorder?.state === 'recording') {
    MeetState._mediaRecorder.stop();
    setRecordButtonState(false);
    notify('Enregistrement arrêté');
    return;
  }

  notify(MeetState.IS_HOST ? '⏺ L’enregistrement va démarrer dans 3 secondes' : '⏺ Préparation de l’enregistrement…');
  await showRecordCountdown(3);

  const W = 1280, H = 720;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  MeetState._recordCanvas = canvas; MeetState._recordCtx = ctx;

  function drawFrame() {
    ctx.fillStyle = '#060d1a'; ctx.fillRect(0,0,W,H);
    const tiles = Array.from(document.querySelectorAll('.peer-tile video')).filter(v => v.srcObject && v.readyState >= 2);
    const n = tiles.length;
    if (n === 0) { MeetState._recordFrame = requestAnimationFrame(drawFrame); return; }
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const tw = Math.floor(W / cols); const th = Math.floor(H / rows);
    tiles.forEach((v, i) => {
      const col = i % cols; const row = Math.floor(i / cols);
      ctx.drawImage(v, col*tw, row*th, tw, th);
    });
    MeetState._recordFrame = requestAnimationFrame(drawFrame);
  }
  drawFrame();

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const allVids = document.querySelectorAll('.peer-tile video');
  allVids.forEach(v => { if (v.srcObject) { try { audioCtx.createMediaStreamSource(v.srcObject).connect(dest); } catch(_){} } });
  if (MeetState.localStream) { try { audioCtx.createMediaStreamSource(MeetState.localStream).connect(dest); } catch(_){} }
  MeetState._recordAudioCtx = audioCtx;

  const finalStream = new MediaStream([canvas.captureStream(30).getVideoTracks()[0], ...dest.stream.getAudioTracks()]);
  MeetState._recordChunks = [];
  MeetState._mediaRecorder = new MediaRecorder(finalStream, { mimeType: 'video/webm;codecs=vp9,opus' });
  MeetState._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) MeetState._recordChunks.push(e.data); };
  MeetState._mediaRecorder.onstop = () => {
    cancelAnimationFrame(MeetState._recordFrame);
    audioCtx.close();
    const blob = new Blob(MeetState._recordChunks, { type: 'video/webm' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `reunion-${MeetState.MEETING_ID}-${new Date().toISOString().slice(0,19)}.webm`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  MeetState._mediaRecorder.start(1000);
  setRecordButtonState(true);
  notify('Enregistrement démarré');
}
