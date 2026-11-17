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

// ── Tableau blanc ────────────────────────────────────────────────────────────
// Modèle objet : wbObjects[] — coords normalisées 0..1 pour compatibilité multi-écrans

let wbTool_    = 'pen';
let wbColor_   = '#4db8d8';
let wbSize_    = 4;
let wbBgColor_ = '#1a2540';
let wbW_       = 160;   // largeur par défaut nouveaux stickers (px)
let wbH_       = 80;    // hauteur par défaut
let wbObjects  = [];
let wbHistory_ = [];
let wbRedo_    = [];
let wbHistoryTimeline_ = [];
let wbDrawing_ = false;
let wbStart_   = null;
let wbSelectedObj  = null;
let wbDragging_    = false;
let wbDragOffset_  = null;
let wbResizing_    = false;
let wbResizeHandle_= null;
let wbCurrentStroke_ = null;
let wbHoverObjId_ = null;
let wbLockMode_ = 'shared';
let wbCursorScale_ = 'md';
let wbClipboard_ = null;
let wbSelectedIds_ = [];
let wbGuideState_ = { active:false, lines:[], measures:[], sizeBadge:null, spacingBadges:[], snapX:null, snapY:null, equalHints:[] };
let wbGuideRafPending_ = false;
let wbGuideLastArgs_ = null;
const WB_GUIDE_THRESHOLD = 8;
const WB_GUIDE_VIEWPORT_PADDING = 180;
const WB_MAX_HISTORY = 30;
const WB_HANDLE_NAMES = ['tl','tc','tr','ml','mr','bl','bc','br'];
const WB_PERF = window.WBPerf || {
  rafThrottle(fn){ let raf=0,lastArgs=null,lastThis=null; return function(...args){ lastArgs=args; lastThis=this; if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; fn.apply(lastThis,lastArgs||[]); }); }; },
  debounce(fn, wait=120){ let t=0; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args), wait); }; },
  shouldKeepPoint(last,next,minPx=1.5){ if(!last||!next) return true; const dx=(next.x-last.x),dy=(next.y-last.y); return (dx*dx+dy*dy) >= (minPx*minPx); },
  createThrottle(fn, wait=50){ let last=0,t=0,pending=null,lastThis=null; return function(...args){ const now=Date.now(); pending=args; lastThis=this; const invoke=()=>{ last=Date.now(); t=0; const a=pending; pending=null; fn.apply(lastThis,a||[]); }; if(now-last>=wait){ invoke(); } else if(!t){ t=setTimeout(invoke, wait-(now-last)); } }; }
};
let wbRenderScheduled_ = false;
let wbCursorEmit_ = null;
let wbSyncAllImmediate_ = null;
let wbSyncAllBuffered_ = null;
let wbPointerMoveQueued_ = null;
let wbHandlePointerMoveRaf_ = 0;


// ── Stickers draw functions ────────────────────────────────────────────────
// draw(ctx, x, y, w, h, color, props)
const WB_STICKERS = {
  btn:       (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=c+'22';ctx.beginPath();ctx.roundRect(x,y,w,h,6);ctx.fill();ctx.stroke();ctx.fillStyle=c;ctx.font=`bold ${Math.min(h*.45,14)}px Sora,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.label||'Button',x+w/2,y+h/2); },
  input:     (ctx,x,y,w,h,c,p={}) => {
    const r = Number(p.borderRadius ?? 10);
    ctx.fillStyle = p.bgColor || '#ffffff';
    ctx.strokeStyle = c; ctx.lineWidth = Number(p.borderWidth ?? 1.5);
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fill(); ctx.stroke();
    if (p.label) { ctx.fillStyle = c; ctx.font='bold 10px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='bottom'; ctx.fillText(p.label, x+2, y-4); }
    ctx.fillStyle = p.hasValue ? (p.valueColor || c) : (p.placeholderColor || c+'99');
    ctx.font=`${Math.min(h*.42,12)}px Sora,sans-serif`; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(p.hasValue ? (p.value || 'Valeur') : (p.placeholder || 'Placeholder…'), x+10, y+h/2);
  },
  card:      (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=c+'0d';ctx.beginPath();ctx.roundRect(x,y,w,h,8);ctx.fill();ctx.stroke();ctx.strokeRect(x+8,y+8,w-16,h*.4);ctx.fillStyle=c;ctx.font='bold 13px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.title||'Titre',x+w/2,y+h*.65);ctx.font='11px Sora,sans-serif';ctx.fillStyle=c+'99';ctx.fillText(p.subtitle||'Sous-titre',x+w/2,y+h*.8); },
  avatar:    (ctx,x,y,w,h,c,p={}) => { const cx=x+w/2,cy=y+h/2,r=Math.min(w,h)*.22;ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy-h*.1,r,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(cx,cy+h*.5,r*1.4,Math.PI,0);ctx.stroke(); },
  image:     (ctx,x,y,w,h,c,p={}) => {
    // Image réelle (source locale validée uniquement) ; cadre filaire tant qu'elle n'est pas chargée
    const img = (typeof wbGetImage === 'function') ? wbGetImage(p.src) : null;
    if (img) {
      const r = Math.max(0, Math.min(Number(p.radius) || 0, w / 2, h / 2));
      ctx.save();
      ctx.beginPath();
      if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
      ctx.clip();
      const contain = p.fit === 'contain' || p.contain === true || p.contain === 'true';
      const ir = img.naturalWidth / img.naturalHeight, br = w / h;
      let dw, dh;
      if ((ir > br) === contain) { dw = w; dh = w / ir; } else { dh = h; dw = h * ir; }
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
      return;
    }
    ctx.strokeStyle=c;ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x+w*.3,y+h*.6);ctx.lineTo(x+w*.55,y+h*.75);ctx.lineTo(x+w*.75,y+h*.45);ctx.lineTo(x+w,y+h);ctx.stroke();ctx.beginPath();ctx.arc(x+w*.75,y+h*.28,Math.min(w,h)*.1,0,Math.PI*2);ctx.stroke();
  },
  nav:       (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=c+'11';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.fillStyle=c;ctx.font='bold 12px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(p.brand||'Brand',x+10,y+h/2);['Accueil','À propos','Contact'].forEach((t,i)=>{ctx.font='11px Sora,sans-serif';ctx.textAlign='right';ctx.fillText(t,x+w-10-i*65,y+h/2);}); },
  table:     (ctx,x,y,w,h,c,p={}) => { const rows=p.rows||4,cols=p.cols||3,cw=w/cols,rh=h/rows;ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.fillStyle=c+'22';ctx.fillRect(x,y,w,rh);ctx.strokeRect(x,y,w,h);for(let r=1;r<=rows;r++){ctx.beginPath();ctx.moveTo(x,y+r*rh);ctx.lineTo(x+w,y+r*rh);ctx.stroke();}for(let cl=1;cl<cols;cl++){ctx.beginPath();ctx.moveTo(x+cl*cw,y);ctx.lineTo(x+cl*cw,y+h);ctx.stroke();} },
  modal:     (ctx,x,y,w,h,c,p={}) => { ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(x-8,y-8,w+16,h+16);ctx.fillStyle=c+'ee';ctx.beginPath();ctx.roundRect(x,y,w,h,10);ctx.fill();ctx.strokeStyle=c;ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=c;ctx.font='bold 13px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.title||'Modal',x+w/2,y+h*.18);ctx.fillStyle=c+'44';ctx.fillRect(x+8,y+h*.33,w-16,h*.35);const bw=Math.min(80,w*.35);[x+w/2-bw-4,x+w/2+4].forEach((bx,i)=>{ctx.fillStyle=i===0?c+'22':c;ctx.beginPath();ctx.roundRect(bx,y+h*.78,bw,h*.14,4);ctx.fill();ctx.stroke();}); },
  chart:     (ctx,x,y,w,h,c,p={}) => {
    ctx.strokeStyle=c; ctx.lineWidth=2; ctx.fillStyle=(p.bgColor || c+'10');
    ctx.beginPath(); ctx.roundRect(x,y,w,h,12); ctx.fill(); ctx.stroke();
    const vals = String(p.values || '60,40,75,50,65,45').split(',').map(v => Math.max(5, Math.min(100, parseFloat(v)||0)));
    const innerX=x+14, innerY=y+28, innerW=w-28, innerH=h-42;
    const type = p.chartType || 'bar';
    ctx.fillStyle=c; ctx.font='bold 11px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(p.title || 'Graphique', x+12, y+14);
    if (type === 'line') {
      ctx.strokeStyle = c; ctx.lineWidth = Number(p.lineWidth || 3); ctx.beginPath();
      vals.forEach((v,i)=>{ const px=innerX+(innerW*(vals.length===1?0:i/(vals.length-1))); const py=innerY+innerH-(innerH*v/100); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
      ctx.stroke();
      vals.forEach((v,i)=>{ const px=innerX+(innerW*(vals.length===1?0:i/(vals.length-1))); const py=innerY+innerH-(innerH*v/100); ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2); ctx.fill(); });
    } else if (type === 'pie') {
      const total = vals.reduce((a,b)=>a+b,0) || 1; let start=-Math.PI/2;
      const cx=x+w/2, cy=y+h/2+4, r=Math.min(innerW,innerH)*0.38;
      vals.forEach((v,i)=>{ const a=(v/total)*Math.PI*2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.fillStyle=`hsla(${(i*57)%360} 70% 60% / .9)`; ctx.arc(cx,cy,r,start,start+a); ctx.closePath(); ctx.fill(); start+=a; });
    } else {
      const bw=(innerW)/(Math.max(vals.length*1.4,1));
      vals.forEach((v,i)=>{ const bh=innerH*v/100, bx=innerX+i*bw*1.4, by=innerY+innerH-bh; ctx.fillStyle=i%2===0?c:c+'99'; ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,6); ctx.fill(); });
    }
  },
  toggle:    (ctx,x,y,w,h,c,p={}) => { const on=p.on!==false;ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=on?c:'transparent';ctx.beginPath();ctx.roundRect(x,y,w,h,h/2);ctx.fill();ctx.stroke();ctx.fillStyle='white';const r=h/2-3;ctx.beginPath();ctx.arc(on?x+w-r-3:x+r+3,y+h/2,r,0,Math.PI*2);ctx.fill(); },
  badge:     (ctx,x,y,w,h,c,p={}) => { ctx.fillStyle=c;ctx.beginPath();ctx.roundRect(x,y,w,h,h/2);ctx.fill();ctx.fillStyle='white';ctx.font=`bold ${Math.min(h*.6,12)}px Sora,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.label||'Badge',x+w/2,y+h/2); },
  desktop:   (ctx,x,y,w,h,c,p={}) => { const sh=h*.72,sw=w;ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,y,sw,sh,4);ctx.stroke();ctx.fillStyle=c+'11';ctx.fillRect(x+2,y+2,sw-4,sh-4);ctx.fillStyle=c+'33';ctx.fillRect(x,y+sh-12,sw,12);ctx.fillStyle=c+'33';ctx.beginPath();ctx.moveTo(x+sw*.38,y+sh);ctx.lineTo(x+sw*.62,y+sh);ctx.lineTo(x+sw*.65,y+h);ctx.lineTo(x+sw*.35,y+h);ctx.closePath();ctx.fill();ctx.fillStyle=c;ctx.font='10px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.res||'1920×1080',x+sw/2,y+sh/2); },
  laptop:    (ctx,x,y,w,h,c,p={}) => { const sh=h*.7;ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x+4,y,w-8,sh,3);ctx.stroke();ctx.fillStyle=c+'11';ctx.fillRect(x+6,y+2,w-12,sh-4);ctx.fillStyle=c+'22';ctx.beginPath();ctx.moveTo(x,y+sh);ctx.lineTo(x+w,y+sh);ctx.lineTo(x+w+6,y+h);ctx.lineTo(x-6,y+h);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=c;ctx.font='10px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.res||'1440×900',x+w/2,y+sh/2); },
  mobile:    (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,y,w,h,w*.2);ctx.stroke();ctx.fillStyle=c+'11';ctx.fillRect(x+2,y+2,w-4,h-4);ctx.fillStyle=c+'44';ctx.fillRect(x,y,w,20);ctx.fillStyle=c+'aa';ctx.beginPath();ctx.roundRect(x+w/2-12,y+4,24,9,4);ctx.fill();ctx.strokeStyle=c;ctx.beginPath();ctx.arc(x+w/2,y+h-14,7,0,Math.PI*2);ctx.stroke();ctx.fillStyle=c;ctx.font='9px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.res||'390×844',x+w/2,y+h/2); },
  tablet:    (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,y,w,h,8);ctx.stroke();ctx.fillStyle=c+'11';ctx.fillRect(x+2,y+2,w-4,h-4);ctx.beginPath();ctx.arc(x+w/2,y+h-14,7,0,Math.PI*2);ctx.stroke();ctx.fillStyle=c;ctx.font='9px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.res||'768×1024',x+w/2,y+h/2); },
  browser:   (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.stroke();ctx.fillStyle=c+'18';ctx.fillRect(x,y,w,26);ctx.strokeRect(x,y,w,26);['#f87171','#f59e0b','#22c55e'].forEach((col,i)=>{ctx.fillStyle=col;ctx.beginPath();ctx.arc(x+12+i*14,y+13,5,0,Math.PI*2);ctx.fill();});ctx.strokeStyle=c+'77';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x+56,y+7,w-80,14,4);ctx.stroke();ctx.fillStyle=c+'99';ctx.font='9px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const url=p.url||'https://example.com';ctx.fillText(url.length>28?url.slice(0,28)+'…':url,x+56+(w-80)/2,y+14);[.42,.55,.67,.8].forEach(yp=>{ctx.beginPath();ctx.moveTo(x+10,y+h*yp);ctx.lineTo(x+w-10,y+h*yp);ctx.strokeStyle=c+'33';ctx.stroke();}); },
  container: (ctx,x,y,w,h,c,p={}) => {
    const r=p.borderRadius||0,sw=p.strokeW||2;
    if(p.shadow){ctx.save();ctx.shadowColor='rgba(0,0,0,.25)';ctx.shadowBlur=12;ctx.shadowOffsetY=4;}
    ctx.fillStyle=p.bgColor||c+'0a';ctx.strokeStyle=c;ctx.lineWidth=sw;
    if(p.dashed)ctx.setLineDash([8,4]);
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.stroke();ctx.setLineDash([]);
    if(p.shadow)ctx.restore();
    if(p.showHeader!==false){
      ctx.fillStyle=p.headerColor||c+'22';ctx.beginPath();
      ctx.roundRect(x,y,w,Math.min(24,h*.15),{upperLeft:r,upperRight:r,lowerLeft:0,lowerRight:0});ctx.fill();
    }
    if(p.padding){ctx.strokeStyle=c+'33';ctx.lineWidth=1;ctx.setLineDash([3,2]);ctx.strokeRect(x+p.padding,y+(p.showHeader!==false?24:0)+4,w-p.padding*2,h-(p.showHeader!==false?28:8)-4);ctx.setLineDash([]);}
    ctx.fillStyle=c;ctx.font='bold 10px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(p.label||'Container',x+8,y+12);
  },
  section:   (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c+'88';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);ctx.fillStyle=c+'aa';ctx.font='10px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(p.label||'Section',x+4,y+4); },
  grid2:     (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.strokeRect(x,y,w,h);ctx.beginPath();ctx.moveTo(x+w/2,y);ctx.lineTo(x+w/2,y+h);ctx.stroke();ctx.fillStyle=c+'66';ctx.font='11px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Col 1',x+w/4,y+h/2);ctx.fillText('Col 2',x+3*w/4,y+h/2); },
  grid3:     (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.strokeRect(x,y,w,h);[1,2].forEach(i=>{ctx.beginPath();ctx.moveTo(x+i*w/3,y);ctx.lineTo(x+i*w/3,y+h);ctx.stroke();});ctx.fillStyle=c+'66';ctx.font='10px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';[1,2,3].forEach(i=>ctx.fillText('Col '+i,x+(i-.5)*w/3,y+h/2)); },
  flexrow:   (ctx,x,y,w,h,c,p={}) => { const n=p.items||4,iw=(w-8*(n+1))/n;ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.strokeRect(x,y,w,h);for(let i=0;i<n;i++){ctx.strokeRect(x+8+i*(iw+8),y+6,iw,h-12);}ctx.fillStyle=c+'66';ctx.font='10px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';for(let i=0;i<n;i++)ctx.fillText('Item '+(i+1),x+8+i*(iw+8)+iw/2,y+h/2); },
  hero:      (ctx,x,y,w,h,c,p={}) => { WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.label||'Hero',bgColor:p.bgColor||c+'10',headerColor:p.headerColor||c+'22',borderRadius:p.borderRadius||18,shadow:true,showHeader:true,padding:16}); ctx.fillStyle=c;ctx.font='bold 18px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(p.title||'Titre principal',x+18,y+42);ctx.fillStyle=c+'aa';ctx.font='12px Sora,sans-serif';ctx.fillText(p.subtitle||'Sous-titre ou accroche',x+18,y+72); WB_STICKERS.btn(ctx,x+18,y+h-54,120,34,c,{label:p.cta||'Call to action'}); },
  sidebar:   (ctx,x,y,w,h,c,p={}) => { WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.label||'Sidebar',bgColor:p.bgColor||c+'0a',borderRadius:p.borderRadius||14,showHeader:true,padding:12}); ctx.strokeStyle=c+'55'; ctx.lineWidth=1; [56,96,136,176].forEach((yy,i)=>{ctx.beginPath();ctx.moveTo(x+16,y+yy);ctx.lineTo(x+w-16,y+yy);ctx.stroke(); ctx.fillStyle=c+'88';ctx.font='11px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText((p.items&&p.items.split(',')[i])||('Menu '+(i+1)),x+16,y+yy-10);}); },
  tabs:      (ctx,x,y,w,h,c,p={}) => { WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.label||'Tabs',bgColor:p.bgColor||c+'08',borderRadius:p.borderRadius||14,showHeader:false,padding:12}); const tabs=(p.items||'Overview,Details,Settings').split(',').slice(0,4); const tw=(w-24)/tabs.length; tabs.forEach((t,i)=>{ctx.fillStyle=i===0?c:c+'22';ctx.beginPath();ctx.roundRect(x+12+i*tw,y+12,tw-8,28,10);ctx.fill();ctx.strokeStyle=c;ctx.stroke();ctx.fillStyle=i===0?'white':c;ctx.font='11px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t.trim(),x+12+i*tw+(tw-8)/2,y+26);}); ctx.strokeStyle=c+'33';ctx.strokeRect(x+12,y+54,w-24,h-66); },
  checkbox:  (ctx,x,y,w,h,c,p={}) => { const items=(p.items||'Option 1,Option 2,Option 3').split(',').slice(0,5); ctx.strokeStyle=c;ctx.lineWidth=1.5; items.forEach((t,i)=>{const yy=y+12+i*28;ctx.strokeRect(x+8,yy,16,16); if(i===0){ctx.beginPath();ctx.moveTo(x+11,yy+8);ctx.lineTo(x+15,yy+13);ctx.lineTo(x+22,yy+4);ctx.stroke();} ctx.fillStyle=c;ctx.font='11px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(t.trim(),x+34,yy+8);}); },
  list:      (ctx,x,y,w,h,c,p={}) => { WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.label||'List',bgColor:p.bgColor||c+'08',borderRadius:p.borderRadius||12,showHeader:true,padding:10}); [0,1,2,3].forEach((i)=>{const yy=y+42+i*30;ctx.fillStyle=c+'22';ctx.beginPath();ctx.roundRect(x+12,yy,w-24,22,8);ctx.fill();ctx.fillStyle=c;ctx.font='11px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(((p.items&&p.items.split(',')[i])||('Élément '+(i+1))).trim(),x+20,yy+11);}); },
  note:      (ctx,x,y,w,h,c,p={}) => { ctx.fillStyle=p.bgColor||'#fff8b8'; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.beginPath(); ctx.roundRect(x,y,w,h,14); ctx.fill(); ctx.stroke(); ctx.fillStyle=c; ctx.font='bold 13px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(p.label||'Note',x+14,y+12); ctx.font='11px Sora,sans-serif'; (String(p.body||'Idée principale').split(',').join('\n')).split('\n').slice(0,6).forEach((line,i)=>ctx.fillText(line.trim(),x+14,y+38+i*16)); },
  sticky:    (ctx,x,y,w,h,c,p={}) => { ctx.fillStyle=p.bgColor||'#fde68a'; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.beginPath(); ctx.roundRect(x,y,w,h,10); ctx.fill(); ctx.stroke(); ctx.fillStyle='rgba(255,255,255,.45)'; ctx.fillRect(x+w-34,y,34,26); ctx.fillStyle=c; ctx.font='bold 12px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(p.label||'Post-it',x+10,y+10); ctx.font='11px Sora,sans-serif'; (String(p.body||'Point clé').split(',').join('\n')).split('\n').slice(0,5).forEach((line,i)=>ctx.fillText(line.trim(),x+10,y+34+i*15)); },
  timeline:  (ctx,x,y,w,h,c,p={}) => { WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.title||'Timeline',bgColor:p.bgColor||c+'08',borderRadius:16,showHeader:true,padding:16}); const items=(p.items||'Étape 1,Étape 2,Étape 3').split(',').map(s=>s.trim()).filter(Boolean).slice(0,5); const sy=y+h/2; ctx.strokeStyle=c; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(x+28,sy); ctx.lineTo(x+w-28,sy); ctx.stroke(); items.forEach((it,i)=>{const cx=x+28+(items.length===1?0:(i*(w-56)/(items.length-1))); ctx.fillStyle=c; ctx.beginPath(); ctx.arc(cx,sy,8,0,Math.PI*2); ctx.fill(); ctx.fillStyle=c; ctx.font='10px Sora,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText(it,cx,sy-14);}); },
  swimlane:  (ctx,x,y,w,h,c,p={}) => { const lanes=(p.lanes||'Équipe A,Équipe B,Équipe C').split(',').map(s=>s.trim()).filter(Boolean).slice(0,5); WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.title||'Swimlane',bgColor:p.bgColor||c+'06',borderRadius:14,showHeader:true,padding:12}); const rowH=(h-36)/Math.max(1,lanes.length); lanes.forEach((lane,i)=>{const yy=y+30+i*rowH; ctx.strokeStyle=c+'66'; ctx.lineWidth=1; if(i>0){ctx.beginPath();ctx.moveTo(x+8,yy);ctx.lineTo(x+w-8,yy);ctx.stroke();} ctx.fillStyle=c; ctx.font='11px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(lane,x+14,yy+rowH/2); ctx.strokeStyle=c+'33'; ctx.strokeRect(x+w*.28,yy+8,w*.62,rowH-16);}); },
  rubric:    (ctx,x,y,w,h,c,p={}) => { const items=(p.criteria||'Critère 1,Critère 2,Critère 3').split(',').map(s=>s.trim()).filter(Boolean).slice(0,4); WB_STICKERS.table(ctx,x,y,w,h,c,{rows:items.length+1,cols:3,headers:'Critère,Niveau,Note'}); ctx.fillStyle=c; ctx.font='10px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle'; items.forEach((it,i)=>ctx.fillText(it,x+10,y+32+(i+1)*((h-28)/(items.length+1)))); },
  lesson:    (ctx,x,y,w,h,c,p={}) => { const items=(p.items||'Objectif,Activité,Évaluation').split(',').map(s=>s.trim()).filter(Boolean).slice(0,5); WB_STICKERS.container(ctx,x,y,w,h,c,{label:p.title||'Plan de cours',bgColor:p.bgColor||c+'08',borderRadius:16,showHeader:true,padding:12}); items.forEach((it,i)=>{const yy=y+36+i*28; ctx.fillStyle=c+'22'; ctx.beginPath(); ctx.roundRect(x+12,yy,w-24,20,8); ctx.fill(); ctx.fillStyle=c; ctx.font='11px Sora,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(it,x+20,yy+10);}); },
  mindmap:   (ctx,x,y,w,h,c,p={}) => { const title=p.title||'Sujet'; const branches=(p.branches||'Idée 1,Idée 2,Idée 3,Idée 4').split(',').map(s=>s.trim()).filter(Boolean).slice(0,6); const cx=x+w/2, cy=y+h/2; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.fillStyle=c+'18'; ctx.beginPath(); ctx.roundRect(cx-56,cy-20,112,40,18); ctx.fill(); ctx.stroke(); ctx.fillStyle=c; ctx.font='bold 12px Sora,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(title,cx,cy); branches.forEach((b,i)=>{const ang=(Math.PI*2/branches.length)*i-Math.PI/2; const tx=cx+Math.cos(ang)*(w*.33); const ty=cy+Math.sin(ang)*(h*.33); ctx.strokeStyle=c+'88'; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(tx,ty); ctx.stroke(); ctx.fillStyle=c+'12'; ctx.beginPath(); ctx.roundRect(tx-44,ty-14,88,28,12); ctx.fill(); ctx.strokeStyle=c; ctx.stroke(); ctx.fillStyle=c; ctx.fillText(b,tx,ty);}); },
};


const WB_STICKER_PROPS = {
  btn:{label:'Button'}, input:{placeholder:'Saisir…',label:'',borderRadius:10,borderWidth:1.5,hasValue:false,value:'',bgColor:'#ffffff'}, card:{title:'Titre',subtitle:'Sous-titre'},
  avatar:{}, image:{}, nav:{brand:'Brand'}, table:{rows:4,cols:3}, modal:{title:'Modal'},
  chart:{title:'Graphique',chartType:'bar',bars:6,values:'60,40,75,50,65,45'}, toggle:{on:true}, badge:{label:'Badge'},
  desktop:{res:'1920×1080'}, laptop:{res:'1440×900'}, mobile:{res:'390×844'},
  tablet:{res:'768×1024'}, browser:{url:'https://example.com'},
  container:{label:'Container'}, section:{label:'Section'},
  grid2:{}, grid3:{}, flexrow:{items:4},
  hero:{label:'Hero',title:'Titre principal',subtitle:'Sous-titre ou accroche',cta:'Call to action'},
  sidebar:{label:'Sidebar',items:'Dashboard,Projects,Settings,Help'},
  tabs:{label:'Tabs',items:'Overview,Details,Settings'},
  checkbox:{items:'Option 1,Option 2,Option 3'},
  list:{label:'List',items:'Élément 1,Élément 2,Élément 3,Élément 4'},
  note:{label:'Note',body:'Idée principale'},
  sticky:{label:'Post-it',body:'Point clé'},
  timeline:{title:'Timeline',items:'Étape 1,Étape 2,Étape 3'},
  swimlane:{title:'Swimlane',lanes:'Équipe A,Équipe B,Équipe C'},
  rubric:{title:'Grille',criteria:'Critère 1,Critère 2,Critère 3'},
  lesson:{title:'Plan de cours',items:'Objectif,Activité,Évaluation'},
  mindmap:{title:'Sujet',branches:'Idée 1,Idée 2,Idée 3,Idée 4'},
};

// Coord helpers
function toNorm(px,py){ return {x:px/MeetState.wbCanvas.width, y:py/MeetState.wbCanvas.height}; }
function fromNorm(nx,ny){ return {x:nx*MeetState.wbCanvas.width, y:ny*MeetState.wbCanvas.height}; }

function wbLocalAuthorMeta() {
  const seed = (MeetState.USER_EMAIL || MeetState.displayName || 'local').toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return {
    authorName: MeetState.displayName || MeetState.USER_EMAIL || 'Vous',
    authorEmail: MeetState.USER_EMAIL || '',
    authorSocketId: 'local',
    authorColor: `hsl(${hue} 78% 62%)`,
  };
}

function wbEnsureCursorLayer() {
  const modal = document.getElementById('whiteboard-modal');
  if (!modal) return null;
  let layer = document.getElementById('wb-cursor-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'wb-cursor-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;--wb-cursor-scale:1;';
    modal.appendChild(layer);
  }
  return layer;
}


function wbCanAdmin() {
  return !!(MeetState.IS_HOST || MeetState.IS_CATALYST);
}

function wbSetSelection(ids = []) {
  wbSelectedIds_ = Array.from(new Set((ids || []).filter(Boolean)));
  wbSelectedObj = wbSelectedIds_[0] || null;
}

function wbGetSelectedObjects() {
  const ids = wbSelectedIds_?.length ? wbSelectedIds_ : (wbSelectedObj ? [wbSelectedObj] : []);
  return wbObjects.filter((o) => ids.includes(o.id));
}

function wbDeleteSelection() {
  if (!wbCanEdit()) return notify(wbLockMode_==='readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte");
  const ids = (wbSelectedIds_ && wbSelectedIds_.length ? wbSelectedIds_ : (wbSelectedObj ? [wbSelectedObj] : [])).filter(Boolean);
  if (!ids.length) return;
  wbObjects = wbObjects.filter((o) => !ids.includes(o.id));
  wbSetSelection([]);
  hideWbProperties();
  wbRedraw();
  wbSaveHistory('delete');
  wbSyncAll('delete');
}

function wbPushTimeline(action = 'update', meta = {}) {
  const entry = {
    id: 'tl_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    at: Date.now(),
    action,
    author: meta.author || MeetState.displayName || MeetState.USER_EMAIL || 'Participant',
    target: meta.target || '',
    detail: meta.detail || '',
  };
  wbHistoryTimeline_.unshift(entry);
  wbHistoryTimeline_ = wbHistoryTimeline_.slice(0, 80);
}

function wbCenterSelection(loopZoom = false) {
  const selected = wbGetSelectedObjects();
  if (!selected.length) return;
  const boxes = selected.map(wbGetBBox).filter(Boolean);
  if (!boxes.length) return;
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const maxX = Math.max(...boxes.map(b => b.x + b.w));
  const maxY = Math.max(...boxes.map(b => b.y + b.h));
  const scroll = document.getElementById('wb-canvas-scroll');
  if (!scroll) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  scroll.scrollTo({ left: Math.max(0, cx * wbZoom_ - scroll.clientWidth / 2), top: Math.max(0, cy * wbZoom_ - scroll.clientHeight / 2), behavior: 'smooth' });
  if (loopZoom) {
    wbSetZoom(Math.min(2.4, Math.max(0.8, Math.min(scroll.clientWidth / Math.max(180, maxX - minX), scroll.clientHeight / Math.max(140, maxY - minY)))));
  }
}

function wbUpdateAccessUI() {

  const btn = document.getElementById('wb-lock-btn');
  const pill = document.getElementById('wb-lock-status');
  const mode = wbLockMode_ || 'shared';
  const map = {
    shared: { label: 'Partagé', button: 'Partage', help: 'Tout le monde peut écrire' },
    host_only: { label: 'Hôte seul', button: 'Hôte seul', help: "Seul l'hôte peut écrire" },
    readonly: { label: 'Lecture seule', button: 'Lecture seule', help: 'Personne ne peut modifier' },
  };
  const meta = map[mode] || map.shared;
  if (btn) {
    btn.textContent = meta.button;
    btn.classList.toggle('active', mode !== 'shared');
    btn.style.opacity = wbCanAdmin() ? '1' : '.72';
    btn.title = wbCanAdmin() ? 'Choisir le mode d’accès du tableau' : meta.help;
  }
  if (pill) {
    pill.textContent = meta.label;
    pill.dataset.mode = mode;
    pill.title = MeetState.wbLockOwner || meta.help;
  }
}

function wbSetLockState(locked, owner='', mode='shared') {
  MeetState.wbLocked = !!locked;
  MeetState.wbLockOwner = owner || '';
  wbLockMode_ = mode || (locked ? 'readonly' : 'shared');
  if (wbLockMode_ === 'shared' && MeetState.wbLocked) wbLockMode_ = 'readonly';
  MeetState.wbLocked = wbLockMode_ !== 'shared';
  wbUpdateAccessUI();
}

function wbSetAccessMode(mode) {
  if (!wbCanAdmin()) {
    notify("Seuls l'hôte et les Catalyst peuvent changer le mode d'accès du tableau");
    return;
  }
  const nextMode = ['shared', 'host_only', 'readonly'].includes(mode) ? mode : 'shared';
  wbSetLockState(nextMode !== 'shared', MeetState.displayName || MeetState.USER_EMAIL || 'Hôte', nextMode);
  document.getElementById('wb-access-menu')?.remove();
  MeetState.socket?.emit('wb_lock', { meetingId: MeetState.MEETING_ID, locked: nextMode !== 'shared', mode: nextMode });
  wbSyncAll();
}

function wbOpenAccessMenu() {
  if (!wbCanAdmin()) {
    notify(
      wbLockMode_ === 'shared'
        ? "Le tableau est en écriture partagée"
        : wbLockMode_ === 'host_only'
          ? "Le tableau est réservé à l'hôte"
          : 'Le tableau est en lecture seule'
    );
    return;
  }
  document.getElementById('wb-access-menu')?.remove();
  const anchor = document.getElementById('wb-lock-btn');
  if (!anchor) return;
  const menu = document.createElement('div');
  menu.id = 'wb-access-menu';
  menu.className = 'wb-access-menu';
  menu.innerHTML = `
    <button class="wb-access-item ${wbLockMode_==='shared'?'active':''}" onclick="MeetApp.wbSetAccessMode('shared')"><strong>Écriture partagée</strong><span>Tout le monde peut dessiner et modifier.</span></button>
    <button class="wb-access-item ${wbLockMode_==='host_only'?'active':''}" onclick="MeetApp.wbSetAccessMode('host_only')"><strong>Écriture hôte seul</strong><span>Seul l’hôte peut travailler, mais l’hôte et les Catalyst peuvent gérer le mode du tableau.</span></button>
    <button class="wb-access-item ${wbLockMode_==='readonly'?'active':''}" onclick="MeetApp.wbSetAccessMode('readonly')"><strong>Lecture seule</strong><span>Personne ne peut modifier tant que ce mode est actif.</span></button>`;
  anchor.parentElement.appendChild(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor) {
        menu.remove();
        document.removeEventListener('pointerdown', closer, true);
      }
    };
    document.addEventListener('pointerdown', closer, true);
  }, 0);
}

function wbCanEdit() {
  if (wbLockMode_ === 'shared') return true;
  if (wbLockMode_ === 'host_only') return !!MeetState.IS_HOST;
  return false;
}

function wbRenderRemoteCursor(payload = {}) {
  const layer = wbEnsureCursorLayer();
  const canvas = MeetState.wbCanvas;
  if (!layer || !canvas || !payload.authorSocketId) return;
  const id = 'wb-cursor-' + payload.authorSocketId.replace(/[^a-z0-9_-]/gi, '');
  let el = document.getElementById(id);
  if (!payload.visible) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:absolute;transform:translate(-2px,-2px) scale(var(--wb-cursor-scale,1));transform-origin:top left;transition:left .05s linear, top .05s linear;';
    layer.appendChild(el);
  }
  const x = (payload.x || 0) * canvas.width;
  const y = (payload.y || 0) * canvas.height;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = `<div style="display:flex;align-items:center;gap:6px;">
    <div style="width:0;height:0;border-left:0 solid transparent;border-right:10px solid transparent;border-top:14px solid ${payload.authorColor || '#4db8d8'};transform:rotate(-20deg);"></div>
    <div style="padding:3px 7px;border-radius:999px;background:${payload.authorColor || '#4db8d8'};color:white;font-size:10px;font-weight:800;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.22);">${escHtml((payload.authorName || 'Participant').slice(0,24))}</div>
  </div>`;
}

// Redessiner tout

function wbCursorScaleValue() {
  return ({ sm: 0.85, md: 1, lg: 1.18, xl: 1.36, xxl: 1.58 })[wbCursorScale_] || 1;
}

function wbCloneDeep(v) { return JSON.parse(JSON.stringify(v)); }

function wbSelectionNudge(stepX, stepY) {
  if (!wbSelectedObj || !MeetState.wbCanvas || !wbCanEdit()) return;
  const obj = wbObjects.find((o) => o.id === wbSelectedObj);
  if (!obj) return;
  const dx = stepX / MeetState.wbCanvas.width;
  const dy = stepY / MeetState.wbCanvas.height;
  if (obj.type === 'sticker') { obj.x += dx; obj.y += dy; obj.x2 += dx; obj.y2 += dy; }
  else if (obj.type === 'shape') { obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy; }
  else if (obj.type === 'text') { obj.x += dx; obj.y += dy; }
  obj.updatedBy = MeetState.displayName || MeetState.USER_EMAIL || obj.updatedBy || obj.authorName || 'Participant';
  obj.updatedAt = Date.now();
  wbRedraw(); wbSyncAll(); wbRefreshSelectionSummary(obj);
}

function wbSetSelectedDimensions(widthPx, heightPx) {
  if (!wbSelectedObj || !MeetState.wbCanvas || !wbCanEdit()) return false;
  const obj = wbObjects.find((o) => o.id === wbSelectedObj);
  if (!obj || obj.type === 'stroke') return false;
  const bb = wbGetBBox(obj);
  if (!bb) return false;
  const nextW = Math.max(4, Math.min(MeetState.wbCanvas.width, Number(widthPx) || bb.w));
  const nextH = Math.max(4, Math.min(MeetState.wbCanvas.height, Number(heightPx) || bb.h));
  if (obj.type === 'text') {
    obj.boxWidth = nextW;
    obj.boxHeight = nextH;
  } else if (obj.type === 'sticker') {
    obj.x2 = obj.x + (nextW / MeetState.wbCanvas.width);
    obj.y2 = obj.y + (nextH / MeetState.wbCanvas.height);
  } else if (obj.type === 'shape') {
    obj.x2 = obj.x1 + (nextW / MeetState.wbCanvas.width);
    obj.y2 = obj.y1 + (nextH / MeetState.wbCanvas.height);
  }
  obj.updatedBy = MeetState.displayName || MeetState.USER_EMAIL || obj.updatedBy || obj.authorName || 'Participant';
  obj.updatedAt = Date.now();
  wbRedraw(); wbRefreshSelectionSummary(obj); wbSyncAll();
  return true;
}

function wbGetClipboardClone() {
  if (!wbSelectedObj) return null;
  const obj = wbObjects.find((o) => o.id === wbSelectedObj);
  return obj ? wbCloneDeep(obj) : null;
}

function wbCopySelection(cut = false) {
  const copy = wbGetClipboardClone();
  if (!copy) return;
  wbClipboard_ = copy;
  if (cut && wbCanEdit()) wbDeleteObj(copy.id);
}

function wbPasteClipboard() {
  if (!wbClipboard_ || !wbCanEdit()) return;
  const copy = wbCloneDeep(wbClipboard_);
  copy.id = 'obj_' + Date.now();
  copy.authorName = MeetState.displayName || MeetState.USER_EMAIL || copy.authorName || 'Vous';
  copy.authorEmail = MeetState.USER_EMAIL || copy.authorEmail || '';
  copy.authorSocketId = 'local';
  copy.authorColor = wbLocalAuthorMeta().authorColor;
  copy.updatedBy = copy.authorName;
  copy.updatedAt = Date.now();
  const off = 22;
  const dx = off / (MeetState.wbCanvas?.width || 1);
  const dy = off / (MeetState.wbCanvas?.height || 1);
  if (copy.type === 'sticker') { copy.x += dx; copy.y += dy; copy.x2 += dx; copy.y2 += dy; }
  else if (copy.type === 'shape') { copy.x1 += dx; copy.y1 += dy; copy.x2 += dx; copy.y2 += dy; }
  else if (copy.type === 'text') { copy.x += dx; copy.y += dy; }
  wbObjects.push(copy); wbSelectedObj = copy.id; wbRedraw(); wbSaveHistory(); wbSyncAll(); showWbProperties(copy);
}

function wbGetViewportSize() {
  const viewport = document.getElementById('wb-canvas-scroll');
  const frame = document.querySelector('.wb-canvas-frame');
  const baseW = Math.max(2200, viewport?.clientWidth || frame?.clientWidth || 1600);
  const baseH = Math.max(1400, viewport?.clientHeight || frame?.clientHeight || 900);
  return { width: baseW, height: baseH };
}

function wbUpdateCanvasWorkspace(center = false) {
  if (!MeetState.wbCanvas) return;
  const { width, height } = wbGetViewportSize();
  if (MeetState.wbCanvas.width !== width) MeetState.wbCanvas.width = width;
  if (MeetState.wbCanvas.height !== height) MeetState.wbCanvas.height = height;
  const layer = document.getElementById('wb-cursor-layer');
  if (layer) {
    layer.style.width = width + 'px';
    layer.style.height = height + 'px';
  }
  if (center) {
    const viewport = document.getElementById('wb-canvas-scroll');
    if (viewport) {
      viewport.scrollLeft = Math.max(0, Math.round((width - viewport.clientWidth) / 2));
      viewport.scrollTop = Math.max(0, Math.round((height - viewport.clientHeight) / 2));
    }
  }
}

function wbRefreshSelectionSummary(obj = null) {
  const target = obj || (wbSelectedObj ? wbObjects.find((o) => o.id === wbSelectedObj) : null);
  const panel = document.getElementById('wb-props-panel');
  if (!target || !panel) return;
  const bb = wbGetBBox(target);
  const wEl = panel.querySelector('[data-wb-selected-width]');
  const hEl = panel.querySelector('[data-wb-selected-height]');
  if (wEl && bb) wEl.textContent = Math.round(bb.w) + ' px';
  if (hEl && bb) hEl.textContent = Math.round(bb.h) + ' px';
}

function wbPushTimeline(action = 'modification') {
  const who = MeetState.displayName || MeetState.USER_EMAIL || 'Participant';
  const last = wbHistoryTimeline_[0];
  if (last && last.author === who && last.action === action && (Date.now() - last.at) < 1500) return;
  wbHistoryTimeline_.unshift({ author: who, action, at: Date.now() });
  wbHistoryTimeline_ = wbHistoryTimeline_.slice(0, 80);
}


function wbClearGuides() {
  wbGuideState_ = { active:false, lines:[], measures:[], sizeBadge:null, spacingBadges:[], snapX:null, snapY:null, equalHints:[] };
}

function wbGetSelectionBBox(ids = null) {
  const targets = (ids && ids.length ? wbObjects.filter((o)=>ids.includes(o.id)) : wbGetSelectedObjects()).map(wbGetBBox).filter(Boolean);
  if (!targets.length) return null;
  const minX = Math.min(...targets.map(b => b.x));
  const minY = Math.min(...targets.map(b => b.y));
  const maxX = Math.max(...targets.map(b => b.x + b.w));
  const maxY = Math.max(...targets.map(b => b.y + b.h));
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY, cx:(minX+maxX)/2, cy:(minY+maxY)/2, right:maxX, bottom:maxY };
}

function wbNormalizeBBox(bb) {
  if (!bb) return null;
  return { ...bb, cx: bb.cx ?? (bb.x + bb.w / 2), cy: bb.cy ?? (bb.y + bb.h / 2), right: bb.right ?? (bb.x + bb.w), bottom: bb.bottom ?? (bb.y + bb.h) };
}

function wbGetVisibleBounds() {
  const scroll = document.getElementById('wb-canvas-scroll');
  if (!scroll) return { x:0, y:0, right:MeetState.wbCanvas?.width||0, bottom:MeetState.wbCanvas?.height||0 };
  return {
    x: Math.max(0, scroll.scrollLeft / Math.max(wbZoom_, 0.01) - WB_GUIDE_VIEWPORT_PADDING),
    y: Math.max(0, scroll.scrollTop / Math.max(wbZoom_, 0.01) - WB_GUIDE_VIEWPORT_PADDING),
    right: Math.min(MeetState.wbCanvas?.width || 0, (scroll.scrollLeft + scroll.clientWidth) / Math.max(wbZoom_, 0.01) + WB_GUIDE_VIEWPORT_PADDING),
    bottom: Math.min(MeetState.wbCanvas?.height || 0, (scroll.scrollTop + scroll.clientHeight) / Math.max(wbZoom_, 0.01) + WB_GUIDE_VIEWPORT_PADDING),
  };
}

function wbBBoxIntersects(a, view) {
  return !!a && !(a.right < view.x || a.x > view.right || a.bottom < view.y || a.y > view.bottom);
}

function wbGetNearbyBoxes(excludeIds = []) {
  const view = wbGetVisibleBounds();
  const exclude = new Set(excludeIds || []);
  return wbObjects
    .filter((o) => !exclude.has(o.id))
    .map((o) => ({ obj:o, bb: wbNormalizeBBox(wbGetBBox(o)) }))
    .filter((x) => x.bb && wbBBoxIntersects(x.bb, view));
}

function wbDrawGuides(ctx) {
  const g = wbGuideState_;
  if (!g?.active) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  (g.lines || []).forEach((line) => {
    ctx.strokeStyle = line.color || 'rgba(56,189,248,.95)';
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  const drawBadge = (x, y, text, fill='rgba(15,23,42,.96)', stroke='rgba(56,189,248,.45)') => {
    ctx.font = '700 10px Sora,sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 14;
    const h = 20;
    const bx = Math.max(8, Math.min(x - w / 2, (MeetState.wbCanvas?.width || 0) - w - 8));
    const by = Math.max(8, y - h / 2);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + h / 2 + .5);
  };
  (g.measures || []).forEach((m) => {
    ctx.strokeStyle = m.color || 'rgba(250,204,21,.96)';
    ctx.beginPath();
    ctx.moveTo(m.x1, m.y1);
    ctx.lineTo(m.x2, m.y2);
    ctx.stroke();
    drawBadge((m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2, m.label, 'rgba(15,23,42,.96)', 'rgba(250,204,21,.45)');
  });
  (g.equalHints || []).forEach((m) => drawBadge(m.x, m.y, m.label, 'rgba(15,23,42,.96)', 'rgba(34,197,94,.45)'));
  if (g.sizeBadge) drawBadge(g.sizeBadge.x, g.sizeBadge.y, g.sizeBadge.label, 'rgba(3,92,128,.96)', 'rgba(77,184,216,.45)');
  ctx.restore();
}

function wbMeasureBetweenBoxes(moving, target, axis) {
  moving = wbNormalizeBBox(moving); target = wbNormalizeBBox(target);
  if (!moving || !target) return null;
  if (axis === 'x') {
    const overlapsY = !(moving.bottom < target.y || moving.y > target.bottom);
    if (!overlapsY) return null;
    let x1, x2;
    if (moving.right <= target.x) { x1 = moving.right; x2 = target.x; }
    else if (target.right <= moving.x) { x1 = target.right; x2 = moving.x; }
    else return null;
    return { x1, y1:(Math.max(moving.y,target.y)+Math.min(moving.bottom,target.bottom))/2, x2, y2:(Math.max(moving.y,target.y)+Math.min(moving.bottom,target.bottom))/2, label:`${Math.round(Math.abs(x2-x1))} px` };
  }
  const overlapsX = !(moving.right < target.x || moving.x > target.right);
  if (!overlapsX) return null;
  let y1, y2;
  if (moving.bottom <= target.y) { y1 = moving.bottom; y2 = target.y; }
  else if (target.bottom <= moving.y) { y1 = target.bottom; y2 = moving.y; }
  else return null;
  return { x1:(Math.max(moving.x,target.x)+Math.min(moving.right,target.right))/2, y1, x2:(Math.max(moving.x,target.x)+Math.min(moving.right,target.right))/2, y2, label:`${Math.round(Math.abs(y2-y1))} px` };
}

function wbComputeSpacingHints(movingBox, nearby) {
  const hints = [];
  const xMeasures = nearby.map((item) => wbMeasureBetweenBoxes(movingBox, item.bb, 'x')).filter(Boolean).sort((a,b)=>Math.abs((a.x2-a.x1)) - Math.abs((b.x2-b.x1)));
  const yMeasures = nearby.map((item) => wbMeasureBetweenBoxes(movingBox, item.bb, 'y')).filter(Boolean).sort((a,b)=>Math.abs((a.y2-a.y1)) - Math.abs((b.y2-b.y1)));
  const pick = [];
  if (xMeasures[0]) pick.push(xMeasures[0]);
  if (yMeasures[0]) pick.push(yMeasures[0]);
  pick.forEach((m) => hints.push(m));
  if (xMeasures.length > 1) {
    const d1 = Math.abs(xMeasures[0].x2 - xMeasures[0].x1), d2 = Math.abs(xMeasures[1].x2 - xMeasures[1].x1);
    if (Math.abs(d1 - d2) <= WB_GUIDE_THRESHOLD) hints.push({ x:(xMeasures[0].x1 + xMeasures[0].x2)/2, y:xMeasures[0].y1 - 18, label:`Même espacement · ${Math.round(d1)} px` });
  }
  if (yMeasures.length > 1) {
    const d1 = Math.abs(yMeasures[0].y2 - yMeasures[0].y1), d2 = Math.abs(yMeasures[1].y2 - yMeasures[1].y1);
    if (Math.abs(d1 - d2) <= WB_GUIDE_THRESHOLD) hints.push({ x:yMeasures[0].x1 + 48, y:(yMeasures[0].y1 + yMeasures[0].y2)/2, label:`Même espacement · ${Math.round(d1)} px` });
  }
  return { measures: pick.slice(0, 2), equalHints: hints.filter((h)=>h.label?.startsWith('Même')) };
}

function wbBuildGuideState(movingBox, excludeIds = [], opts = {}) {
  const box = wbNormalizeBBox(movingBox);
  if (!box) return wbClearGuides();
  const nearby = wbGetNearbyBoxes(excludeIds).filter((item) => {
    const dx = Math.min(Math.abs(item.bb.x - box.x), Math.abs(item.bb.right - box.right), Math.abs(item.bb.cx - box.cx));
    const dy = Math.min(Math.abs(item.bb.y - box.y), Math.abs(item.bb.bottom - box.bottom), Math.abs(item.bb.cy - box.cy));
    return dx <= 240 || dy <= 240;
  });
  const candX = [
    { key:'left', value:box.x, apply:(v)=>({dx:v-box.x}) },
    { key:'center', value:box.cx, apply:(v)=>({dx:v-box.cx}) },
    { key:'right', value:box.right, apply:(v)=>({dx:v-box.right}) },
  ];
  const candY = [
    { key:'top', value:box.y, apply:(v)=>({dy:v-box.y}) },
    { key:'middle', value:box.cy, apply:(v)=>({dy:v-box.cy}) },
    { key:'bottom', value:box.bottom, apply:(v)=>({dy:v-box.bottom}) },
  ];
  const lines = []; const measures = []; const equalHints = [];
  let snapDX = 0, snapDY = 0, bestX = null, bestY = null;
  nearby.forEach((item) => {
    [['left',item.bb.x],['center',item.bb.cx],['right',item.bb.right]].forEach(([key,target]) => {
      candX.forEach((c) => {
        if (c.key !== key) return;
        const diff = target - c.value;
        if (Math.abs(diff) <= WB_GUIDE_THRESHOLD && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
          bestX = { diff, target, source:c.key, item };
          snapDX = diff;
        }
      });
    });
    [['top',item.bb.y],['middle',item.bb.cy],['bottom',item.bb.bottom]].forEach(([key,target]) => {
      candY.forEach((c) => {
        if (c.key !== key) return;
        const diff = target - c.value;
        if (Math.abs(diff) <= WB_GUIDE_THRESHOLD && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
          bestY = { diff, target, source:c.key, item };
          snapDY = diff;
        }
      });
    });
  });
  const snapped = wbNormalizeBBox({ ...box, x:box.x + snapDX, y:box.y + snapDY, right:box.right + snapDX, bottom:box.bottom + snapDY, cx:box.cx + snapDX, cy:box.cy + snapDY });
  if (bestX) lines.push({ x1:bestX.target, y1:Math.min(snapped.y, bestX.item.bb.y) - 28, x2:bestX.target, y2:Math.max(snapped.bottom, bestX.item.bb.bottom) + 28, color:'rgba(56,189,248,.95)' });
  if (bestY) lines.push({ x1:Math.min(snapped.x, bestY.item.bb.x) - 28, y1:bestY.target, x2:Math.max(snapped.right, bestY.item.bb.right) + 28, y2:bestY.target, color:'rgba(56,189,248,.95)' });
  nearby.forEach((item) => {
    const xM = wbMeasureBetweenBoxes(snapped, item.bb, 'x'); if (xM && (!measures[0] || Math.abs((xM.x2-xM.x1)) < Math.abs((measures[0].x2-measures[0].x1)))) measures[0] = xM;
    const yM = wbMeasureBetweenBoxes(snapped, item.bb, 'y'); if (yM && (!measures[1] || Math.abs((yM.y2-yM.y1)) < Math.abs((measures[1].y2-measures[1].y1)))) measures[1] = yM;
    if (Math.abs(snapped.w - item.bb.w) <= WB_GUIDE_THRESHOLD) equalHints.push({ x:snapped.cx, y:Math.min(snapped.y, item.bb.y) - 26, label:`W = ${Math.round(item.bb.w)}` });
    if (Math.abs(snapped.h - item.bb.h) <= WB_GUIDE_THRESHOLD) equalHints.push({ x:snapped.right + 44, y:snapped.cy, label:`H = ${Math.round(item.bb.h)}` });
  });
  const spacing = wbComputeSpacingHints(snapped, nearby);
  wbGuideState_ = { active: !!(lines.length || measures.filter(Boolean).length || equalHints.length || (opts.sizeBadge)), lines, measures: measures.filter(Boolean).concat(spacing.measures || []).slice(0,2), sizeBadge: opts.sizeBadge || null, spacingBadges: [], snapX:snapDX, snapY:snapDY, equalHints: [...equalHints, ...(spacing.equalHints || [])].slice(0,3) };
}

function wbScheduleGuides(movingBox, excludeIds = [], opts = {}) {
  wbGuideLastArgs_ = [movingBox, excludeIds, opts];
  if (wbGuideRafPending_) return;
  wbGuideRafPending_ = true;
  requestAnimationFrame(() => {
    wbGuideRafPending_ = false;
    if (!wbGuideLastArgs_) return;
    wbBuildGuideState(...wbGuideLastArgs_);
    wbRedraw();
  });
}

function wbRenderNow() {
  if (!MeetState.wbCtx) return;
  wbRenderScheduled_ = false;
  wbEnsureCursorLayer();
  const ctx = MeetState.wbCtx;
  const view = wbGetVisibleBounds();
  ctx.clearRect(0,0,MeetState.wbCanvas.width,MeetState.wbCanvas.height);
  ctx.fillStyle = wbBgColor_;
  ctx.fillRect(0,0,MeetState.wbCanvas.width,MeetState.wbCanvas.height);
  const mustDraw = new Set([...(wbSelectedIds_||[]), wbSelectedObj, wbHoverObjId_].filter(Boolean));
  const visibleObjects = [];
  for (const o of wbObjects) {
    if (mustDraw.has(o.id)) { visibleObjects.push(o); continue; }
    const bb = wbNormalizeBBox(wbGetBBox(o));
    if (!bb || wbBBoxIntersects(bb, view)) visibleObjects.push(o);
  }
  visibleObjects.forEach((o) => wbDrawObject(ctx,o));
  const selected = wbGetSelectedObjects();
  if (selected.length === 1) wbDrawSelection(ctx, selected[0]);
  else if (selected.length > 1) {
    const group = wbGetSelectionBBox();
    if (group) {
      ctx.save();
      ctx.strokeStyle = 'rgba(77,184,216,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([5,3]);
      ctx.strokeRect(group.x-4, group.y-4, group.w+8, group.h+8);
      ctx.setLineDash([]);
      ctx.fillStyle='rgba(3,92,128,0.9)'; ctx.beginPath(); ctx.roundRect(group.x + Math.max(8, group.w/2 - 46), group.y - 22, 92, 18, 8); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='700 9px Sora,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`${selected.length} éléments`, group.x + group.w/2, group.y - 13);
      ctx.restore();
    }
  }
  wbDrawGuides(ctx);
  const hoverTarget = wbObjects.find(o => o.id === (wbSelectedObj || wbHoverObjId_));
  if (hoverTarget) wbDrawObjectMeta(ctx, hoverTarget);
}
function wbRedraw(forceNow = false) {
  if (forceNow) return wbRenderNow();
  if (wbRenderScheduled_) return;
  wbRenderScheduled_ = true;
  requestAnimationFrame(() => wbRenderNow());
}

function wbDrawObject(ctx,obj) {
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, (obj.opacity ?? 100) / 100));
  if (obj.type==='stroke') {
    ctx.strokeStyle=obj.color; ctx.lineWidth=obj.size; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath();
    obj.points.forEach((p,i)=>{ const r=fromNorm(p.x,p.y); i===0?ctx.moveTo(r.x,r.y):ctx.lineTo(r.x,r.y); });
    ctx.stroke();
  } else if (obj.type==='shape') {
    const a=fromNorm(obj.x1,obj.y1),b=fromNorm(obj.x2,obj.y2);
    const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y), w=Math.abs(b.x-a.x), h=Math.abs(b.y-a.y);
    const fillOpacity = Math.max(0, Math.min(1, ((obj.fillOpacity ?? 100) / 100)));
    const fillColor = obj.fillColor || obj.color || '#4db8d8';
    ctx.strokeStyle=obj.color || '#4db8d8'; ctx.lineWidth=obj.size||2; ctx.lineCap='round';
    const dashMap = { dashed:[10,6], dotted:[2,6], none:[] };
    if (obj.borderStyle === 'none') ctx.strokeStyle = 'transparent';
    else if (dashMap[obj.borderStyle]) ctx.setLineDash(dashMap[obj.borderStyle]);
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = Math.max(0.05, Math.min(1, (obj.opacity ?? 100) / 100));
    ctx.beginPath();
    if(obj.shape==='line'){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    else if(obj.shape==='rect'){ctx.roundRect(x,y,w,h,obj.radius||0); if(fillOpacity>0){ctx.save();ctx.globalAlpha*=fillOpacity;ctx.fill();ctx.restore();} ctx.stroke();}
    else if(obj.shape==='circle'){ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2); if(fillOpacity>0){ctx.save();ctx.globalAlpha*=fillOpacity;ctx.fill();ctx.restore();} ctx.stroke();}
    else if(obj.shape==='triangle'){ctx.moveTo(x+w/2,y);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.closePath(); if(fillOpacity>0){ctx.save();ctx.globalAlpha*=fillOpacity;ctx.fill();ctx.restore();} ctx.stroke();}
    else if(obj.shape==='arrow'){const ang=Math.atan2(b.y-a.y,b.x-a.x),l=Math.max(10, Number(obj.arrowSize)||Math.max(14,(obj.size||2)*5)),s=.45;ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-l*Math.cos(ang-s),b.y-l*Math.sin(ang-s));ctx.lineTo(b.x-l*Math.cos(ang+s),b.y-l*Math.sin(ang+s));ctx.closePath();ctx.fillStyle=obj.color||'#4db8d8';ctx.fill();}
    ctx.setLineDash([]);
  } else if (obj.type==='text') {
    const p=fromNorm(obj.x,obj.y);
    const fontSize=Math.max(10,(obj.size||4)*5);
    const fontFamily=obj.fontFamily||'Sora, sans-serif';
    const weight=obj.bold?'700':'400';
    const style=obj.italic?'italic ':'';
    ctx.font=`${style}${weight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline='top';
    ctx.textAlign=obj.textAlign||'left';
    const lines=String(obj.text||'').split('\n');
    const lineHeight=Math.round(fontSize*1.25);
    const widths=lines.map((line)=>ctx.measureText(line||' ').width);
    const measuredW=Math.max(...widths, 0);
    const boxW=Math.max(measuredW, Number(obj.boxWidth)||0);
    const boxH=Math.max(lineHeight, Number(obj.boxHeight)||lines.length*lineHeight);
    const drawX=p.x;
    if(obj.bgText){
      const pad=8;
      const bgX=(obj.textAlign==='center') ? p.x-boxW/2-pad : (obj.textAlign==='right' ? p.x-boxW-pad : p.x-pad);
      ctx.fillStyle=obj.bgTextColor||'rgba(15,23,42,.55)';
      ctx.beginPath(); ctx.roundRect(bgX,p.y-pad,boxW+pad*2,boxH+pad*2,10); ctx.fill();
    }
    ctx.fillStyle=obj.color||'#fff';
    lines.forEach((line,i)=>ctx.fillText(line,drawX,p.y+i*lineHeight));
  } else if (obj.type==='sticker') {
    const a=fromNorm(obj.x,obj.y),b=fromNorm(obj.x2,obj.y2);
    const fn=WB_STICKERS[obj.sticker]; if(fn) fn(ctx,a.x,a.y,b.x-a.x,b.y-a.y,obj.color,obj.props||{});
  }
  ctx.restore();
}

function wbDrawObjectMeta(ctx, obj) {
  const bb = wbGetBBox(obj);
  if (!bb) return;
  const created = obj.authorName || obj.createdBy || 'Participant';
  const updated = obj.updatedBy && obj.updatedBy !== created ? ` · édité par ${obj.updatedBy}` : '';
  const text = `${created}${updated}`;
  ctx.save();
  ctx.font = '700 10px Sora,sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 14;
  const x = Math.max(10, Math.min(bb.x + 6, (MeetState.wbCanvas?.width || 0) - w - 10));
  const y = Math.max(18, bb.y - 12);
  ctx.fillStyle = 'rgba(15,23,42,.92)';
  ctx.beginPath(); ctx.roundRect(x, y - 16, w, 18, 9); ctx.fill();
  ctx.fillStyle = obj.authorColor || '#4db8d8';
  ctx.beginPath(); ctx.arc(x + 8, y - 7, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 15, y - 7);
  ctx.restore();
}

function wbDrawSelection(ctx,obj) {
  const bb=wbGetBBox(obj); if(!bb) return;
  // Contour sélection
  ctx.strokeStyle='rgba(77,184,216,0.9)';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);
  ctx.strokeRect(bb.x-4,bb.y-4,bb.w+8,bb.h+8);ctx.setLineDash([]);
  // Badge dimensions
  const dimW=Math.round(bb.w),dimH=Math.round(bb.h);
  const badgeW=dimW>99?72:60;
  ctx.fillStyle='rgba(3,92,128,0.9)';ctx.beginPath();ctx.roundRect(bb.x+(bb.w-badgeW)/2,bb.y-20,badgeW,15,3);ctx.fill();
  ctx.fillStyle='white';ctx.font='bold 8px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(`${dimW}×${dimH}`,bb.x+bb.w/2,bb.y-13);
  // 8 poignées
  const hp=wbGetHandlePositions(obj);
  if(!hp) return;
  Object.entries(hp).forEach(([h,{x,y}])=>{
    ctx.fillStyle='white';ctx.beginPath();ctx.roundRect(x-5,y-5,10,10,2);ctx.fill();
    ctx.strokeStyle='#4db8d8';ctx.lineWidth=1.5;ctx.stroke();
  });
}

// ── Resize helpers ────────────────────────────────────────────────────────────
function wbGetBBox(obj) {
  if(!MeetState.wbCanvas) return null;
  if(obj.type==='stroke'){
    const cacheKey = `${obj.points?.length||0}:${obj.size||0}`;
    if(obj.__bboxCache && obj.__bboxCache.key===cacheKey) return obj.__bboxCache.box;
    const pts = Array.isArray(obj.points) ? obj.points : [];
    if(!pts.length) return null;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of pts) {
      const rp = fromNorm(p.x,p.y);
      if (rp.x < minX) minX = rp.x;
      if (rp.y < minY) minY = rp.y;
      if (rp.x > maxX) maxX = rp.x;
      if (rp.y > maxY) maxY = rp.y;
    }
    const pad = Math.max(6, Number(obj.size||2) * 1.5);
    const box = { x:minX-pad, y:minY-pad, w:(maxX-minX)+pad*2, h:(maxY-minY)+pad*2 };
    obj.__bboxCache = { key:cacheKey, box };
    return box;
  }
  if(obj.type==='sticker'){
    const a=fromNorm(obj.x,obj.y),b=fromNorm(obj.x2,obj.y2);
    return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};
  }
  if(obj.type==='shape'){
    const a=fromNorm(obj.x1,obj.y1),b=fromNorm(obj.x2,obj.y2);
    return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};
  }
  if(obj.type==='text'){
    const p=fromNorm(obj.x,obj.y);
    const ctx=MeetState.wbCtx; if(!ctx) return null;
    const fontSize=Math.max(10,(obj.size||4)*5);
    ctx.font=`${obj.italic?'italic ':''}${obj.bold?'700 ':'400 '}${fontSize}px ${obj.fontFamily||'Sora, sans-serif'}`;
    const lines=String(obj.text||'').split('\n');
    const lineHeight=Math.round(fontSize*1.25);
    const measuredW=Math.max(...lines.map(line=>ctx.measureText(line||' ').width), 60);
    const boxW=Math.max(measuredW, Number(obj.boxWidth)||0);
    const boxH=Math.max(lineHeight, Number(obj.boxHeight)||lines.length*lineHeight);
    const left = obj.textAlign==='center' ? p.x - boxW/2 : (obj.textAlign==='right' ? p.x - boxW : p.x);
    return{x:left,y:p.y,w:boxW,h:boxH};
  }
  return null;
}

function wbGetHandlePositions(obj) {
  const bb=wbGetBBox(obj); if(!bb) return null;
  return{
    tl:{x:bb.x,      y:bb.y},       tc:{x:bb.x+bb.w/2,y:bb.y},       tr:{x:bb.x+bb.w,y:bb.y},
    ml:{x:bb.x,      y:bb.y+bb.h/2},                                   mr:{x:bb.x+bb.w,y:bb.y+bb.h/2},
    bl:{x:bb.x,      y:bb.y+bb.h},  bc:{x:bb.x+bb.w/2,y:bb.y+bb.h},  br:{x:bb.x+bb.w,y:bb.y+bb.h},
  };
}

function wbHitHandle(obj,px,py) {
  const hp=wbGetHandlePositions(obj); if(!hp) return null;
  for(const [h,{x,y}] of Object.entries(hp)){if(px>=x-8&&px<=x+8&&py>=y-8&&py<=y+8)return h;}
  return null;
}

const WB_RESIZE_CURSORS = {tl:'nwse-resize',tr:'nesw-resize',bl:'nesw-resize',br:'nwse-resize',tc:'ns-resize',bc:'ns-resize',ml:'ew-resize',mr:'ew-resize'};

function wbApplyResize(obj,handle,px,py) {
  const cx=px/MeetState.wbCanvas.width, cy=py/MeetState.wbCanvas.height;
  const isSticker = obj.type==='sticker';
  const K1X=isSticker?'x':'x1', K1Y=isSticker?'y':'y1';
  if(handle==='tl'){obj[K1X]=cx;obj[K1Y]=cy;}
  else if(handle==='tr'){obj.x2=cx;obj[K1Y]=cy;}
  else if(handle==='bl'){obj[K1X]=cx;obj.y2=cy;}
  else if(handle==='br'){obj.x2=cx;obj.y2=cy;}
  else if(handle==='tc'){obj[K1Y]=cy;}
  else if(handle==='bc'){obj.y2=cy;}
  else if(handle==='ml'){obj[K1X]=cx;}
  else if(handle==='mr'){obj.x2=cx;}
}

function wbHitTest(px,py) {
  const view = wbGetVisibleBounds();
  for(let i=wbObjects.length-1;i>=0;i--){
    const o=wbObjects[i];
    const bb = wbNormalizeBBox(wbGetBBox(o));
    if (bb && !wbBBoxIntersects(bb, view) && o.id !== wbSelectedObj && !(wbSelectedIds_||[]).includes(o.id)) continue;
    if(o.type==='stroke'){
      const bb = wbGetBBox(o);
      if (bb && px>=bb.x&&px<=bb.x+bb.w&&py>=bb.y&&py<=bb.y+bb.h) return o;
    } else if(o.type==='sticker'||o.type==='shape'){
      const ax=o.type==='sticker'?o.x:o.x1,ay=o.type==='sticker'?o.y:o.y1,bx=o.x2,by=o.y2;
      const a=fromNorm(ax,ay),b=fromNorm(bx,by);
      if(px>=Math.min(a.x,b.x)-8&&px<=Math.max(a.x,b.x)+8&&py>=Math.min(a.y,b.y)-8&&py<=Math.max(a.y,b.y)+8) return o;
    } else if(o.type==='text'){
      const bb = wbGetBBox(o);
      if(bb && px>=bb.x-8&&px<=bb.x+bb.w+8&&py>=bb.y-8&&py<=bb.y+bb.h+8) return o;
    }
  }
  return null;
}

// Panneau propriétés
function showWbProperties(obj) {
  const bb=wbGetBBox(obj);
  const wi=document.getElementById('wb-w-input'), hi=document.getElementById('wb-h-input');
  if(wi&&bb) wi.value=Math.round(bb.w);
  if(hi&&bb) hi.value=Math.round(bb.h);
  const panel=document.getElementById('wb-props-panel');
  if(!panel) return;
  const fields=getPropsFields(obj);
  panel.innerHTML=`
    <div style="padding:14px 14px 90px;overflow:auto;min-height:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;">
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--text1);">${obj.type==='sticker' ? 'Composant' : obj.type==='shape' ? 'Forme' : obj.type==='text' ? 'Texte' : 'Élément'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px;">${obj.sticker ? obj.sticker : (obj.shape || obj.type)} • ${obj.authorName || 'sans auteur'}</div>
        </div>
        <button onclick="MeetApp.hideWbProperties()" class="wb-icon-btn" style="width:34px;height:34px;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="padding:10px 12px;border-radius:12px;background:var(--bg3);border:1px solid var(--border);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:800;">Largeur</div>
          <div style="font-size:15px;font-weight:800;color:var(--text1);margin-top:4px;" data-wb-selected-width>${bb ? Math.round(bb.w) : '-'} px</div>
        </div>
        <div style="padding:10px 12px;border-radius:12px;background:var(--bg3);border:1px solid var(--border);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:800;">Hauteur</div>
          <div style="font-size:15px;font-weight:800;color:var(--text1);margin-top:4px;" data-wb-selected-height>${bb ? Math.round(bb.h) : '-'} px</div>
        </div>
      </div>
      ${fields.map(f=>`<div style="margin-bottom:12px;"><label style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px;">${f.label}</label>${renderPropField(f,obj)}</div>`).join('')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
        <button onclick="MeetApp.wbDuplicateObj('${obj.id}')" class="wb-action-btn" style="width:100%;">⎘ Dupliquer</button>
        <button onclick="MeetApp.wbDeleteObj('${obj.id}')" class="wb-action-btn" style="width:100%;color:var(--red);border-color:rgba(248,113,113,.22);">🗑 Supprimer</button>
        <button onclick="MeetApp.wbBringFront('${obj.id}')" class="wb-action-btn" style="width:100%;">⬆ Avant-plan</button>
        <button onclick="MeetApp.wbSendBack('${obj.id}')" class="wb-action-btn" style="width:100%;">⬇ Arrière-plan</button>
      </div>
    </div>`;
  document.getElementById('wb-right-rail')?.classList.add('open');
}

function renderPropField(f,obj) {
  const val=f.path.split('.').reduce((o,k)=>o?.[k],obj)??f.default??'';
  const safeVal = String(val ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const s='width:100%;padding:9px 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:Sora,sans-serif;outline:none;box-sizing:border-box;';
  const common = `onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()" onkeyup="event.stopPropagation()" onmousedown="event.stopPropagation()"`;
  if(f.type==='color') return `<input type="color" value="${safeVal||'#4db8d8'}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value)" ${common} style="width:100%;height:38px;border-radius:10px;border:1px solid var(--border);cursor:pointer;padding:4px;background:var(--bg3);">`;
  if(f.type==='number') {
    const v=parseFloat(val)||0;
    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 74px;gap:8px;align-items:center;" ${common}><input type="range" min="${f.min||0}" max="${f.max||100}" step="${f.step||1}" value="${v}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',parseFloat(this.value),false);this.nextElementSibling.value=this.value" style="width:100%;accent-color:#4db8d8;cursor:pointer;"><input type="number" min="${f.min||0}" max="${f.max||100}" step="${f.step||1}" value="${v}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',parseFloat(this.value),false);this.previousElementSibling.value=this.value" style="${s} text-align:right;"></div>`;
  }
  if(f.type==='checkbox') return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0;" ${common}><input type="checkbox" ${val?'checked':''} onchange="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.checked,false)" style="width:15px;height:15px;accent-color:#4db8d8;cursor:pointer;"><span style="font-size:11px;color:var(--text2);">${val?'Oui':'Non'}</span></label>`;
  if(f.type==='select') return `<select oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value,false)" ${common} style="${s}">${(f.opts||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}</select>`;
  if(f.type==='textarea') return `<textarea ${common} oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value,false)" style="${s} min-height:92px;resize:vertical;line-height:1.45;" placeholder="${f.placeholder||''}" spellcheck="false" autocapitalize="off" autocomplete="off">${safeVal}</textarea>`;
  if(f.type==='dimensions') {
    const bb = wbGetBBox(obj) || { w: 0, h: 0 };
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;" ${common}><input type="number" min="4" max="6000" value="${Math.round(bb.w||0)}" oninput="MeetApp.wbSetSelectedDimensions(this.value, this.parentElement.querySelector('[data-dim=h]').value)" style="${s}" placeholder="Largeur"><input data-dim="h" type="number" min="4" max="6000" value="${Math.round(bb.h||0)}" oninput="MeetApp.wbSetSelectedDimensions(this.parentElement.querySelector('input').value, this.value)" style="${s}" placeholder="Hauteur"></div>`;
  }
  return `<input type="text" value="${safeVal}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value,false)" ${common} style="${s}" placeholder="${f.placeholder||''}" spellcheck="false" autocapitalize="off" autocomplete="off">`;
}

function getPropsFields(obj) {
  // Dimensions actuelles (lecture seule en header du panel, modifiables via toolbar W/H)
  const bb = wbGetBBox(obj);
  const base=[
    {label:'Couleur accent', path:'color',   type:'color'},
    {label:'Dimensions (px)',path:'__dimensions__', type:'dimensions'},
    {label:'Épaisseur trait',path:'size',    type:'number', min:0, max:40, step:1},
    {label:'Opacité %',      path:'opacity', type:'number', min:10, max:100, step:5},
  ];
  const byS={
    image:[
      {label:"Lien de l'image (https)", path:'props.link',    type:'text'},
      {label:'Image entière (sans rogner)', path:'props.contain', type:'checkbox'},
      {label:'Rayon des coins',        path:'props.radius',  type:'number', min:0, max:60},
    ],
    btn:[
      {label:'Texte du bouton',   path:'props.label',   type:'text'},
      {label:'Rempli (filled)',   path:'props.filled',  type:'checkbox'},
      {label:'Rayon des coins',   path:'props.radius',  type:'number', min:0, max:40},
    ],
    input:[
      {label:'Placeholder',       path:'props.placeholder', type:'text'},
      {label:'Label au-dessus',   path:'props.label',       type:'text'},
      {label:'A une valeur',      path:'props.hasValue',    type:'checkbox'},
      {label:'Valeur affichée',   path:'props.value',       type:'text'},
      {label:'Coins arrondis',    path:'props.borderRadius', type:'number', min:0, max:40},
      {label:'Épaisseur bordure', path:'props.borderWidth',  type:'number', min:0, max:8},
      {label:'Fond du champ',     path:'props.bgColor',      type:'color'},
    ],
    card:[
      {label:'Titre',        path:'props.title',    type:'text'},
      {label:'Sous-titre',   path:'props.subtitle', type:'text'},
      {label:'Texte bouton', path:'props.btnLabel', type:'text'},
      {label:'Rayon',        path:'props.radius',   type:'number', min:0, max:30},
    ],
    nav:[
      {label:'Marque / Logo',    path:'props.brand', type:'text'},
      {label:'Liens (virgule)',   path:'props.items', type:'textarea'},
      {label:'Bouton CTA',       path:'props.cta',   type:'text'},
    ],
    table:[
      {label:'Lignes',           path:'props.rows',    type:'number', min:1, max:20},
      {label:'Colonnes',         path:'props.cols',    type:'number', min:1, max:10},
      {label:'En-têtes (virgule)',path:'props.headers', type:'textarea'},
      {label:'Lignes alternées', path:'props.altRow',  type:'checkbox'},
    ],
    modal:[
      {label:'Titre',         path:'props.title',       type:'text'},
      {label:'Contenu',       path:'props.bodyText',    type:'textarea'},
      {label:'Bouton annuler',path:'props.cancelLabel', type:'text'},
      {label:'Bouton valider',path:'props.okLabel',     type:'text'},
      {label:'Rayon',         path:'props.radius',      type:'number', min:0, max:30},
    ],
    chart:[
      {label:'Titre du graphique',path:'props.title',     type:'text'},
      {label:'Type',              path:'props.chartType', type:'select', opts:['bar','line','pie']},
      {label:'Nb de valeurs',     path:'props.bars',      type:'number', min:2, max:7},
      {label:'Valeurs (virgule)', path:'props.values',     type:'textarea'},
      {label:'Épaisseur ligne',   path:'props.lineWidth',  type:'number', min:1, max:10},
    ],
    toggle:[
      {label:'Label',  path:'props.label', type:'text'},
      {label:'Activé', path:'props.on',    type:'checkbox'},
    ],
    badge:[
      {label:'Texte',    path:'props.label',   type:'text'},
      {label:'Variante', path:'props.variant', type:'select', opts:['primary','success','warning','error','info','neutral']},
      {label:'Contour',  path:'props.outline', type:'checkbox'},
      {label:'Point •',  path:'props.dot',     type:'checkbox'},
    ],
    browser:[
      {label:'URL',         path:'props.url',         type:'text', placeholder:'https://…'},
      {label:'Mode sombre', path:'props.darkMode',    type:'checkbox'},
      {label:'Sidebar',     path:'props.showSidebar', type:'checkbox'},
    ],
    desktop:[{label:'Résolution',path:'props.res',type:'text'},{label:'Contenu mock',path:'props.showContent',type:'checkbox'}],
    laptop: [{label:'Résolution',path:'props.res',type:'text'}],
    mobile: [{label:'Résolution',path:'props.res',type:'text'},{label:'Barre statut',path:'props.showStatusBar',type:'checkbox'}],
    tablet: [{label:'Résolution',path:'props.res',type:'text'}],
    container:[
      {label:'Label',              path:'props.label',        type:'text'},
      {label:'Pointillés',         path:'props.dashed',       type:'checkbox'},
      {label:'Fond coloré',        path:'props.bgColor',      type:'color'},
      {label:'Bordure arrondie',   path:'props.borderRadius', type:'number', min:0, max:50},
      {label:'Épaisseur bordure',  path:'props.strokeW',      type:'number', min:0, max:8},
      {label:'Padding interne',    path:'props.padding',      type:'number', min:0, max:60},
      {label:'Ombre portée',       path:'props.shadow',       type:'checkbox'},
      {label:'Couleur fond',       path:'props.bgColor',      type:'color'},
      {label:'En-tête visible',    path:'props.showHeader',   type:'checkbox'},
      {label:'Couleur en-tête',    path:'props.headerColor',  type:'color'},
    ],
    section:[
      {label:'Label',              path:'props.label',        type:'text'},
      {label:'Sous-label',         path:'props.sublabel',     type:'text'},
      {label:'Pointillés',         path:'props.dashed',       type:'checkbox'},
      {label:'Gras label',         path:'props.bold',         type:'checkbox'},
      {label:'Couleur bordure',    path:'props.borderColor',  type:'color'},
    ],
    flexrow:[
      {label:'Nb items', path:'props.items', type:'number', min:1, max:8},
      {label:'Espacement',path:'props.gap',  type:'number', min:0, max:20},
      {label:'Labels (virgule)',path:'props.labels',type:'textarea'},
    ],
    grid2:[{label:'Label col 1',path:'props.col1',type:'text'},{label:'Label col 2',path:'props.col2',type:'text'}],
    grid3:[],avatar:[],image:[{label:'Légende',path:'props.caption',type:'text'}],
    note:[{label:'Titre',path:'props.label',type:'text'},{label:'Contenu',path:'props.body',type:'textarea'}],
    sticky:[{label:'Titre',path:'props.label',type:'text'},{label:'Contenu',path:'props.body',type:'textarea'}],
    timeline:[{label:'Titre',path:'props.title',type:'text'},{label:'Étapes (virgule)',path:'props.items',type:'textarea'}],
    swimlane:[{label:'Titre',path:'props.title',type:'text'},{label:'Couloirs (virgule)',path:'props.lanes',type:'textarea'}],
    rubric:[{label:'Titre',path:'props.title',type:'text'},{label:'Critères (virgule)',path:'props.criteria',type:'textarea'}],
    lesson:[{label:'Titre',path:'props.title',type:'text'},{label:'Blocs (virgule)',path:'props.items',type:'textarea'}],
    mindmap:[{label:'Titre central',path:'props.title',type:'text'},{label:'Branches (virgule)',path:'props.branches',type:'textarea'}],
  };
  // Champs spéciaux selon type objet
  if(obj.type==='shape') return [
    ...base,
    {label:'Couleur remplissage',   path:'fillColor',     type:'color'},
    {label:'Opacité remplissage %', path:'fillOpacity',   type:'number', min:0, max:100, step:5},
    ...(obj.shape==='rect'?[
      {label:'Rayon coins (px)',   path:'radius',          type:'number', min:0, max:100},
      {label:'Style bordure',      path:'borderStyle',     type:'select', opts:['solid','dashed','dotted','none']},
    ]:[]),
    ...(obj.shape==='arrow'?[
      {label:'Taille flèche',      path:'arrowSize',       type:'number', min:5, max:40},
    ]:[]),
  ];
  if(obj.type==='text') return [
    ...base,
    {label:'Texte',                 path:'text',        type:'textarea'},
    {label:'Gras',                  path:'bold',        type:'checkbox'},
    {label:'Italique',              path:'italic',      type:'checkbox'},
    {label:'Taille (×5 = px)',      path:'size',        type:'number', min:1, max:20},
    {label:'Famille de police',     path:'fontFamily',  type:'select', opts:['Sora','Inter','monospace','Georgia','Arial']},
    {label:'Alignement',            path:'textAlign',   type:'select', opts:['left','center','right']},
    {label:'Fond texte',            path:'bgText',      type:'checkbox'},
    {label:'Couleur fond',          path:'bgTextColor', type:'color'},
  ];
  if(obj.type==='sticker') return [...base,...(byS[obj.sticker]||[])];
  return base;
}


let wbPropCommitTimer_ = null;
function wbUpdateProp(id,path,value,commitNow = false) {
  const obj=wbObjects.find(o=>o.id===id); if(!obj) return;
  if (path === '__width' || path === '__height') {
    const bb = wbGetBBox(obj);
    wbSetSelectedDimensions(path === '__width' ? value : Math.round(bb?.w||0), path === '__height' ? value : Math.round(bb?.h||0));
    return;
  }
  const field = getPropsFields(obj).find((f) => f.path === path);
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && !['text','textarea','select','color'].includes(field?.type || '')) value = Number(value);
  const keys=path.split('.');let t=obj;
  for(let i=0;i<keys.length-1;i++){if(!t[keys[i]])t[keys[i]]={};t=t[keys[i]];}
  t[keys[keys.length-1]]=value;
  if (obj.sticker === 'chart' && path === 'props.bars') {
    const count = Math.max(2, Math.min(7, Number(value)||6));
    const current = String(obj.props?.values || '').split(',').map(v => parseFloat(v)||50);
    while (current.length < count) current.push(50);
    obj.props.values = current.slice(0, count).join(',');
  }
  obj.updatedBy = MeetState.displayName || MeetState.USER_EMAIL || obj.updatedBy || obj.authorName || 'Participant';
  obj.updatedAt = Date.now();
  wbRedraw(); wbSyncAll(); wbRefreshSelectionSummary(obj);
  clearTimeout(wbPropCommitTimer_);
  wbPropCommitTimer_ = setTimeout(() => wbSaveHistory('property'), commitNow ? 0 : 180);
}

function wbDeleteObj(id) {
  wbSetSelection([id]);
  wbDeleteSelection();
}

function wbDuplicateObj(id) {
  const obj=wbObjects.find(o=>o.id===id); if(!obj) return;
  const copy=JSON.parse(JSON.stringify(obj)); copy.id='obj_'+Date.now();
  const off=0.03;
  if(copy.x!==undefined){copy.x+=off;copy.y+=off;}
  if(copy.x1!==undefined){copy.x1+=off;copy.y1+=off;copy.x2+=off;copy.y2+=off;}
  else if(copy.x2!==undefined){copy.x2+=off;}
  wbObjects.push(copy); wbSetSelection([copy.id]);
  wbRedraw(); wbSaveHistory('duplicate'); wbSyncAll('duplicate');
}

function wbBringFront(id) {
  const i=wbObjects.findIndex(o=>o.id===id); if(i<wbObjects.length-1){wbObjects.push(wbObjects.splice(i,1)[0]);wbRedraw();wbSyncAll();}
}

function wbSendBack(id) {
  const i=wbObjects.findIndex(o=>o.id===id); if(i>0){wbObjects.unshift(wbObjects.splice(i,1)[0]);wbRedraw();wbSyncAll();}
}

function hideWbProperties() {
  const panel = document.getElementById('wb-props-panel');
  if (panel) panel.innerHTML = '<div class="wb-props-empty">Aucun élément sélectionné pour le moment. Cliquez sur un objet ou déposez-en un sur le tableau pour voir ses réglages.</div>';
  wbSetSelection([]); wbRedraw();
}

function toggleWhiteboard() {
  const modal=document.getElementById('whiteboard-modal');
  const btn=document.getElementById('btn-whiteboard'); if(!modal) return;
  if(modal.classList.contains('open')){
    modal.classList.remove('open'); if(btn) btn.className='ctrl-btn active';
    document.getElementById('wb-access-menu')?.remove();
    document.getElementById('wb-left-rail')?.classList.remove('open');
    document.getElementById('wb-right-rail')?.classList.remove('open');
    document.removeEventListener('keydown',wbKeyHandler);
  } else {
    modal.classList.add('open'); if(btn) btn.className='ctrl-btn wb-on';
    initWhiteboard(); document.addEventListener('keydown',wbKeyHandler);
  }
}

function toggleWbLeftRail() { document.getElementById('wb-left-rail')?.classList.toggle('open'); }
function toggleWbRightRail() { document.getElementById('wb-right-rail')?.classList.toggle('open'); }
function wbApplyToolSearch(term='') {
  const q = String(term || '').trim().toLowerCase();
  document.querySelectorAll('#wb-left-rail .wb-tool-btn[data-tool]').forEach((btn) => {
    const hay = `${btn.dataset.search || ''} ${btn.textContent || ''}`.toLowerCase();
    btn.style.display = !q || hay.includes(q) ? '' : 'none';
  });
  document.querySelectorAll('#wb-left-rail .wb-group').forEach((group) => {
    const visible = Array.from(group.querySelectorAll('.wb-tool-btn[data-tool]')).some((btn) => btn.style.display !== 'none');
    group.style.display = visible ? '' : 'none';
  });
}

function wbKeyHandler(e) {
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  const editing = ['input','textarea','select'].includes(tag) || document.activeElement?.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if(mod && e.key.toLowerCase()==='z'){e.preventDefault();wbUndo();return;}
  if(mod && e.key.toLowerCase()==='y'){e.preventDefault();wbRedo();return;}
  if(mod && e.key.toLowerCase()==='c' && wbSelectedObj){e.preventDefault();wbCopySelection(false);return;}
  if(mod && e.key.toLowerCase()==='x' && wbSelectedObj){e.preventDefault();wbCopySelection(true);return;}
  if(mod && e.key.toLowerCase()==='v'){e.preventDefault();wbPasteClipboard();return;}
  if(mod && e.key.toLowerCase()==='d' && wbSelectedObj){e.preventDefault();wbDuplicateObj(wbSelectedObj);return;}
  if(mod && e.key.toLowerCase()==='a'){
    const inWhiteboard = !!(document.getElementById('whiteboard-modal')?.classList.contains('open'));
    if(!inWhiteboard) return;
    e.preventDefault();
    if (wbObjects.length) {
      wbSetSelection(wbObjects.map(o=>o.id));
      wbRedraw();
      const panel = document.getElementById('wb-props-panel');
      if (panel) panel.innerHTML = `<div class="wb-props-empty">${wbObjects.length} éléments sélectionnés. Utilise Delete pour supprimer, les flèches pour déplacer le groupe, et les guides intelligents pour aligner.</div>`;
      document.getElementById('wb-right-rail')?.classList.add('open');
    }
    return;
  }
  if(e.key==='Escape'){ wbDragging_=false; wbResizing_=false; wbResizeHandle_=null; wbClearGuides(); hideWbProperties(); return; }
  if(editing) return;
  if((e.key==='Delete'||e.key==='Backspace')&&(wbSelectedObj || (wbSelectedIds_&&wbSelectedIds_.length))){ e.preventDefault(); wbDeleteSelection(); return; }
  const fast = e.shiftKey ? 24 : 6;
  if (e.key === 'ArrowLeft') { e.preventDefault(); wbSelectionNudge(-fast,0); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); wbSelectionNudge(fast,0); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); wbSelectionNudge(0,-fast); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); wbSelectionNudge(0,fast); return; }
}

function initWhiteboard() {
  if(MeetState.wbCanvas){wbRedraw(true); wbSetLockState(!!MeetState.wbLocked, MeetState.wbLockOwner || ''); return;}
  MeetState.wbCanvas=document.getElementById('wb-canvas');
  MeetState.wbCtx=MeetState.wbCanvas.getContext('2d',{willReadFrequently:true});
  const resize=()=>{ wbUpdateCanvasWorkspace(false); wbRedraw(); };
  wbUpdateCanvasWorkspace(true); wbRedraw(true); window.addEventListener('resize',resize); wbEnsureCursorLayer(); wbSetCursorScale(wbCursorScale_); wbSetLockState(!!MeetState.wbLocked, MeetState.wbLockOwner || '', wbLockMode_ || 'shared'); wbApplyToolSearch(document.getElementById('wb-tool-search')?.value || ''); wbSaveHistory();
  if (!wbCursorEmit_) wbCursorEmit_ = WB_PERF.createThrottle((payload) => MeetState.socket?.emit('wb_cursor', payload), 50);
  if (!wbSyncAllImmediate_) wbSyncAllImmediate_ = () => MeetState.socket?.emit('wb_sync',{meetingId:MeetState.MEETING_ID,objects:wbObjects,bgColor:wbBgColor_,locked:wbLockMode_!=='shared',lockMode:wbLockMode_,historyTimeline:wbHistoryTimeline_.slice(0,24)});
  if (!wbSyncAllBuffered_) wbSyncAllBuffered_ = WB_PERF.debounce(() => wbSyncAllImmediate_(), 100);
  document.getElementById('wb-canvas-scroll')?.addEventListener('scroll', () => wbRedraw(), { passive:true });
  document.getElementById('wb-canvas-scroll')?.addEventListener('wheel', () => wbRedraw(), { passive:true });

  const getPos=e=>{ const r=MeetState.wbCanvas.getBoundingClientRect(),t=e.touches?.[0]||e; return {x:t.clientX-r.left,y:t.clientY-r.top}; };

  MeetState.wbCanvas.addEventListener('pointerdown',e=>{
    if(!wbCanEdit()){ notify(wbLockMode_==='readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte"); return; }
    e.preventDefault(); MeetState.wbCanvas.setPointerCapture(e.pointerId);
    const pos=getPos(e); wbStart_=pos;
    if(wbTool_==='select'){
      // Priorité 1 : poignée de resize sur objet déjà sélectionné
      if(wbSelectedObj){
        const curObj=wbObjects.find(o=>o.id===wbSelectedObj);
        const h=curObj?wbHitHandle(curObj,pos.x,pos.y):null;
        if(h){ wbResizing_=true; wbResizeHandle_=h; return; }
      }
      // Priorité 2 : hit test objet
      const found=wbHitTest(pos.x,pos.y);
      if(found){
        if (e.shiftKey) {
          const next = new Set(wbSelectedIds_ && wbSelectedIds_.length ? wbSelectedIds_ : (wbSelectedObj ? [wbSelectedObj] : []));
          if (next.has(found.id)) next.delete(found.id); else next.add(found.id);
          wbSetSelection(Array.from(next));
        } else if (!(wbSelectedIds_||[]).includes(found.id)) {
          wbSetSelection([found.id]);
        }
        wbDragging_=true;
        const primary = wbObjects.find(o => o.id === wbSelectedObj) || found;
        showWbProperties(primary);
        const groupBox = wbGetSelectionBBox();
        wbDragOffset_={dx:pos.x-(groupBox?.x||0),dy:pos.y-(groupBox?.y||0), ids:[...(wbSelectedIds_||[])], startBoxes:(wbSelectedIds_||[]).map((id)=>({id, bb:wbGetBBox(wbObjects.find(o=>o.id===id))})).filter(x=>x.bb)};
      } else { wbSetSelection([]); wbDragging_=false; hideWbProperties(); wbClearGuides(); }
      wbRedraw(); return;
    }
    wbDrawing_=true;
    if(['pen','highlighter','eraser'].includes(wbTool_)){
      const id='obj_'+Date.now();
      const color=wbTool_==='eraser'?wbBgColor_:wbTool_==='highlighter'?wbColor_+'55':wbColor_;
      wbCurrentStroke_={id,type:'stroke',color,size:wbTool_==='eraser'?wbSize_*4:wbTool_==='highlighter'?wbSize_*4:wbSize_,points:[toNorm(pos.x,pos.y)],...wbLocalAuthorMeta()};
      wbObjects.push(wbCurrentStroke_);
    }
  });

  function wbHandlePointerMove(e){
    const pos=getPos(e);
    if (MeetState.socket && MeetState.wbCanvas && wbCursorEmit_) wbCursorEmit_({ meetingId: MeetState.MEETING_ID, x: pos.x / MeetState.wbCanvas.width, y: pos.y / MeetState.wbCanvas.height, visible: true });
    wbHoverObjId_ = null;
    const hoveredObj = wbHitTest(pos.x,pos.y);
    if (hoveredObj) wbHoverObjId_ = hoveredObj.id;
    // Curseur adaptatif en mode select (même sans drag)
    if(wbTool_==='select'&&!wbDrawing_&&!wbDragging_&&!wbResizing_){
      if(wbSelectedObj){
        const selObj=wbObjects.find(o=>o.id===wbSelectedObj);
        const h=selObj?wbHitHandle(selObj,pos.x,pos.y):null;
        MeetState.wbCanvas.style.cursor=h?WB_RESIZE_CURSORS[h]:(hoveredObj?'move':'default');
      } else {
        MeetState.wbCanvas.style.cursor=hoveredObj?'move':'default';
      }
      wbRedraw();
    }
    if(!wbDrawing_&&!wbDragging_&&!wbResizing_) { if (wbTool_!=='select' && hoveredObj?.id !== wbSelectedObj) wbRedraw(); return; }
    e.preventDefault();
    // Resize actif
    if(wbResizing_&&wbSelectedObj){
      const obj=wbObjects.find(o=>o.id===wbSelectedObj); if(!obj) return;
      wbApplyResize(obj,wbResizeHandle_,pos.x,pos.y);
      const bb=wbNormalizeBBox(wbGetBBox(obj));
      if(bb){
        const wi=document.getElementById('wb-w-input'), hi=document.getElementById('wb-h-input');
        if(wi) wi.value=Math.round(bb.w);
        if(hi) hi.value=Math.round(bb.h);
        wbScheduleGuides(bb,[obj.id],{ sizeBadge:{ x:bb.x + bb.w/2, y:bb.y - 36, label:`${Math.round(bb.w)} × ${Math.round(bb.h)} px` } });
      }
      wbRedraw(); return;
    }
    if(wbDragging_&&wbSelectedObj){
      const selectedIds = wbDragOffset_?.ids?.length ? wbDragOffset_.ids : [wbSelectedObj];
      const groupBox = wbGetSelectionBBox(selectedIds); if(!groupBox) return;
      const nx=pos.x-wbDragOffset_.dx, ny=pos.y-wbDragOffset_.dy;
      let pxDx = nx - groupBox.x, pxDy = ny - groupBox.y;
      const projected = wbNormalizeBBox({ x:groupBox.x + pxDx, y:groupBox.y + pxDy, w:groupBox.w, h:groupBox.h });
      wbBuildGuideState(projected, selectedIds);
      pxDx += wbGuideState_.snapX || 0;
      pxDy += wbGuideState_.snapY || 0;
      const dx=pxDx/MeetState.wbCanvas.width, dy=pxDy/MeetState.wbCanvas.height;
      wbObjects.forEach((obj) => {
        if (!selectedIds.includes(obj.id)) return;
        if(obj.type==='sticker'){obj.x+=dx;obj.y+=dy;obj.x2+=dx;obj.y2+=dy;}
        else if(obj.type==='shape'){obj.x1+=dx;obj.y1+=dy;obj.x2+=dx;obj.y2+=dy;}
        else if(obj.type==='text'){obj.x+=dx;obj.y+=dy;}
      });
      wbRedraw(); return;
    }
    if(['pen','highlighter','eraser'].includes(wbTool_)){
      const nextNorm = toNorm(pos.x,pos.y);
      const prevNorm = wbCurrentStroke_?.points?.[wbCurrentStroke_.points.length - 1];
      const minStrokeDist = wbTool_==='highlighter' ? 2.8 : (wbTool_==='eraser' ? 3.2 : 1.6);
      const prevPx = prevNorm ? fromNorm(prevNorm.x, prevNorm.y) : null;
      if(wbCurrentStroke_ && WB_PERF.shouldKeepPoint(prevPx, pos, minStrokeDist)){
        wbCurrentStroke_.points.push(nextNorm);
        delete wbCurrentStroke_.__bboxCache;
        wbRedraw();
        MeetState.socket?.emit('wb_draw',{meetingId:MeetState.MEETING_ID,tool:wbTool_,color:wbCurrentStroke_?.color,size:wbCurrentStroke_?.size,x1:toNorm(wbStart_.x,wbStart_.y).x,y1:toNorm(wbStart_.x,wbStart_.y).y,x2:nextNorm.x,y2:nextNorm.y});
        wbStart_=pos;
      }
      return;
    }
    // Preview en temps réel pour formes & stickers
    wbRenderNow();
    const ctx=MeetState.wbCtx,a=wbStart_,b=pos;
    ctx.strokeStyle=wbColor_;ctx.fillStyle=wbColor_+'33';ctx.lineWidth=wbSize_;ctx.lineCap='round';ctx.beginPath();
    if(wbTool_==='line'){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    else if(wbTool_==='rect'){ctx.roundRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y),4);ctx.fill();ctx.stroke();}
    else if(wbTool_==='circle'){const rx=(b.x-a.x)/2,ry=(b.y-a.y)/2;ctx.ellipse(a.x+rx,a.y+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    else if(wbTool_==='triangle'){ctx.moveTo((a.x+b.x)/2,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(a.x,b.y);ctx.closePath();ctx.fill();ctx.stroke();}
    else if(wbTool_==='arrow'){const ang=Math.atan2(b.y-a.y,b.x-a.x),l=20,s=.4;ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-l*Math.cos(ang-s),b.y-l*Math.sin(ang-s));ctx.lineTo(b.x-l*Math.cos(ang+s),b.y-l*Math.sin(ang+s));ctx.closePath();ctx.fillStyle=wbColor_;ctx.fill();}
    else if(wbTool_.startsWith('sticker_')){
      const sid=wbTool_.replace('sticker_',''),fn=WB_STICKERS[sid];
      if(fn) fn(ctx,Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x)||140,Math.abs(b.y-a.y)||80,wbColor_,WB_STICKER_PROPS[sid]||{});
    }
  }
  MeetState.wbCanvas.addEventListener('pointermove',e=>{
    wbPointerMoveQueued_ = e;
    if (wbHandlePointerMoveRaf_) return;
    wbHandlePointerMoveRaf_ = requestAnimationFrame(() => {
      wbHandlePointerMoveRaf_ = 0;
      const ev = wbPointerMoveQueued_;
      wbPointerMoveQueued_ = null;
      if (ev) wbHandlePointerMove(ev);
    });
  });

  MeetState.wbCanvas.addEventListener('pointerup',e=>{
    const pos=getPos(e);
    if (wbCursorEmit_) wbCursorEmit_({ meetingId: MeetState.MEETING_ID, visible: false });
    if(wbResizing_){wbResizing_=false;wbResizeHandle_=null;wbClearGuides();wbSaveHistory();wbSyncAll('immediate');
      // Refresh panel propriétés avec nouvelles dimensions
      if(wbSelectedObj){const o=wbObjects.find(x=>x.id===wbSelectedObj);if(o)showWbProperties(o);}
      return;
    }
    if(wbDragging_){wbDragging_=false;wbClearGuides();wbSaveHistory();wbSyncAll('immediate');return;}
    if(!wbDrawing_) return; wbDrawing_=false; wbCurrentStroke_=null;
    if(wbTool_==='text'){
      showWbTextInput(pos.x,pos.y,'',(text)=>{
        if(!text) return;
        const id='obj_'+Date.now();
        const obj={id,type:'text',x:toNorm(pos.x,pos.y).x,y:toNorm(pos.x,pos.y).y,text,color:wbColor_,size:wbSize_,bold:false,opacity:100,...wbLocalAuthorMeta()};
        wbObjects.push(obj); wbSelectedObj=obj.id; wbTool('select'); wbRedraw(); wbSaveHistory(); showWbProperties(obj);
        if (window.innerWidth <= 1100) document.getElementById('wb-left-rail')?.classList.remove('open');
        MeetState.socket?.emit('wb_text',{meetingId:MeetState.MEETING_ID,...obj});
      }); return;
    }
    if(!['pen','eraser','highlighter'].includes(wbTool_)&&!wbTool_.startsWith('sticker_')){
      const id='obj_'+Date.now(),n1=toNorm(wbStart_.x,wbStart_.y),n2=toNorm(pos.x,pos.y);
      const obj={id,type:'shape',shape:wbTool_,x1:n1.x,y1:n1.y,x2:n2.x,y2:n2.y,color:wbColor_,size:wbSize_,fillColor:wbColor_+'33',radius:0,opacity:100,...wbLocalAuthorMeta()};
      wbObjects.push(obj); wbSelectedObj=obj.id; wbTool('select'); wbRedraw(); showWbProperties(obj);
      if (window.innerWidth <= 1100) document.getElementById('wb-left-rail')?.classList.remove('open');
      MeetState.socket?.emit('wb_shape',{meetingId:MeetState.MEETING_ID,...obj});
    }
    if(wbTool_.startsWith('sticker_')){
      const sid=wbTool_.replace('sticker_',''),id='obj_'+Date.now();
      let w2=Math.abs(pos.x-wbStart_.x),h2=Math.abs(pos.y-wbStart_.y);
      if(w2<20) w2=wbW_; if(h2<20) h2=wbH_;
      const n1=toNorm(Math.min(wbStart_.x,pos.x),Math.min(wbStart_.y,pos.y));
      const n2=toNorm(Math.min(wbStart_.x,pos.x)+w2,Math.min(wbStart_.y,pos.y)+h2);
      const props={...(WB_STICKER_PROPS[sid]||{})};
      const obj={id,type:'sticker',sticker:sid,x:n1.x,y:n1.y,x2:n2.x,y2:n2.y,color:wbColor_,props,opacity:100,...wbLocalAuthorMeta()};
      wbObjects.push(obj); wbSelectedObj=obj.id; wbTool('select'); wbRedraw(); wbSaveHistory(); showWbProperties(obj);
      if (window.innerWidth <= 1100) document.getElementById('wb-left-rail')?.classList.remove('open');
      MeetState.socket?.emit('wb_sticker',{meetingId:MeetState.MEETING_ID,...obj});
    }
    wbSaveHistory();
    wbSyncAll('immediate'); // ← Synchroniser l'état complet après chaque action
  });

  MeetState.wbCanvas.addEventListener('dblclick',e=>{
    const pos=getPos(e),found=wbHitTest(pos.x,pos.y);
    if(found&&found.type==='text'){wbSetSelection([found.id]);wbCenterSelection(true);showWbTextInput(fromNorm(found.x,found.y).x,fromNorm(found.x,found.y).y,found.text,(t)=>{if(t===null)return;found.text=t;wbRedraw();wbSaveHistory('text edit');wbSyncAll('text');});}
    else if(found){wbSetSelection([found.id]);wbCenterSelection(true);showWbProperties(found);}
  });
}

function showWbTextInput(x,y,def,cb) {
  document.getElementById('wb-text-inp')?.remove();
  const rect=MeetState.wbCanvas?.getBoundingClientRect(); if(!rect){cb(prompt('Texte:',def)||'');return;}
  const inp=document.createElement('input'); inp.id='wb-text-inp'; inp.type='text'; inp.value=def||'';
  inp.style.cssText=`position:fixed;left:${rect.left+x-60}px;top:${rect.top+y-14}px;width:220px;padding:6px 10px;border-radius:8px;border:2px solid var(--accent);background:var(--bg2);color:var(--text1);font-size:14px;font-family:Sora,sans-serif;z-index:99999;outline:none;box-shadow:0 4px 20px rgba(0,0,0,.5);`;
  document.body.appendChild(inp); inp.focus(); inp.select();
  const confirm=()=>{const v=inp.value;inp.remove();cb(v);};
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')confirm();if(e.key==='Escape'){inp.remove();cb(null);}});
  inp.addEventListener('blur',confirm);
}

function wbSyncAll(mode = 'buffered') {
  if (!MeetState.socket) return;
  if (mode === 'immediate') return wbSyncAllImmediate_ ? wbSyncAllImmediate_() : MeetState.socket.emit('wb_sync',{meetingId:MeetState.MEETING_ID,objects:wbObjects,bgColor:wbBgColor_,locked:wbLockMode_!=='shared',lockMode:wbLockMode_,historyTimeline:wbHistoryTimeline_.slice(0,24)});
  if (wbSyncAllBuffered_) return wbSyncAllBuffered_();
  MeetState.socket.emit('wb_sync',{meetingId:MeetState.MEETING_ID,objects:wbObjects,bgColor:wbBgColor_,locked:wbLockMode_!=='shared',lockMode:wbLockMode_,historyTimeline:wbHistoryTimeline_.slice(0,24)});
}

function wbSaveHistory(action = 'modification') {
  const snapshot = JSON.parse(JSON.stringify(wbObjects));
  const prev = wbHistory_[wbHistory_.length - 1];
  if (prev && JSON.stringify(prev) === JSON.stringify(snapshot)) return;
  wbHistory_.push(snapshot);
  if(wbHistory_.length>WB_MAX_HISTORY) wbHistory_.shift();
  wbRedo_=[];
  wbPushTimeline(action);
}

function wbUndo() {
  if(!wbCanEdit()) return notify(wbLockMode_==='readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte");
  if(wbHistory_.length<2) return;
  wbRedo_.push(wbHistory_.pop());
  wbObjects=JSON.parse(JSON.stringify(wbHistory_[wbHistory_.length-1]));
  wbRedraw(); wbSyncAll('immediate');
}

function wbRedo() {
  if(!wbCanEdit()) return notify(wbLockMode_==='readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte");
  if(!wbRedo_.length) return;
  const n=wbRedo_.pop(); wbHistory_.push(n);
  wbObjects=JSON.parse(JSON.stringify(n));
  wbRedraw(); wbSyncAll('immediate');
}

function wbTool(t) {
  wbTool_=t;
  document.querySelectorAll('.wb-tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  if(MeetState.wbCanvas) MeetState.wbCanvas.style.cursor=t==='select'?'default':t==='eraser'?'cell':'crosshair';
}

function wbColor(c) {
  wbColor_=c;
  document.querySelectorAll('.wb-color-btn').forEach(b=>b.classList.toggle('active',b.dataset.color===c));
}

function wbBgColor(c) { wbBgColor_=c; wbRedraw(); wbSaveHistory(); wbSyncAll(); }

function wbSize(s) {
  wbSize_=parseInt(s);
  document.querySelectorAll('.wb-size-btn').forEach(b=>{
    const a=b.dataset.size===String(s);
    b.classList.toggle('active',a);
    b.style.border=a?'1px solid var(--accent)':'1px solid var(--border)';
    b.style.color=a?'var(--accent)':'var(--text2)';
    b.style.background=a?'rgba(3,92,128,0.15)':'transparent';
  });
}

function wbConfirmClear(cb) {
  document.getElementById('wb-confirm-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'wb-confirm-overlay';
  overlay.className = 'wb-confirm-overlay';
  overlay.innerHTML = `<div class="wb-confirm-card"><h3>Effacer le tableau ?</h3><p>Cette action supprimera tout le contenu du tableau pour tous les participants. Elle est immédiate et visible en temps réel.</p><div class="wb-confirm-actions"><button class="wb-confirm-cancel">Annuler</button><button class="wb-confirm-danger">Oui, effacer</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.wb-confirm-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('.wb-confirm-danger')?.addEventListener('click', () => { overlay.remove(); cb?.(); });
}


function wbClear() {
  if (!wbCanEdit()) return notify(wbLockMode_==='readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte");
  const isAdmin = wbCanAdmin();
  wbConfirmClear(() => {
    if (wbLockMode_ === 'shared' && !isAdmin) {
      MeetState.socket?.emit('wb_clear_request',{ meetingId: MeetState.MEETING_ID, requester: MeetState.displayName || MeetState.USER_EMAIL || 'Participant' });
      notify("Demande d'effacement envoyée à l'hôte.");
      return;
    }
    wbObjects=[]; wbSetSelection([]); wbHoverObjId_=null; hideWbProperties();
    wbRedraw(); wbSaveHistory('clear'); wbSyncAll('immediate');
    MeetState.socket?.emit('wb_clear',{meetingId:MeetState.MEETING_ID});
  });
}

function wbApplyBoardTheme(theme = 'dark') {
  const map = { dark: '#1a2540', current: wbBgColor_ || '#1a2540', white: '#ffffff', gray: '#e5e7eb', custom: wbBgColor_ || '#1a2540' };
  wbBgColor(map[theme] || theme || '#1a2540');
}

function wbSetCursorScale(size = 'md') {
  wbCursorScale_ = ['sm','md','lg','xl','xxl'].includes(size) ? size : 'md';
  document.querySelectorAll('[data-wb-cursor-size]').forEach((el) => el.classList.toggle('active', el.dataset.wbCursorSize === wbCursorScale_));
  const layer = document.getElementById('wb-cursor-layer');
  if (layer) layer.style.setProperty('--wb-cursor-scale', String(wbCursorScaleValue()));
}


function wbOpenSettings() {
  document.getElementById('wb-settings-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'wb-settings-overlay';
  ov.className = 'wb-settings-overlay';
  const historyHtml = (wbHistoryTimeline_||[]).slice(0,8).map((it)=>`<div style="padding:10px 12px;border-radius:12px;background:var(--bg3);border:1px solid var(--border);font-size:11px;color:var(--text2);display:flex;justify-content:space-between;gap:8px;"><span><strong style="color:var(--text1);">${it.author||'Participant'}</strong> · ${it.action}</span><span>${new Date(it.at).toLocaleTimeString()}</span></div>`).join('');
  ov.innerHTML = `<div class="wb-settings-card">
    <div class="wb-settings-head"><div><h2>Paramètres du tableau</h2><p>Fond, curseur, raccourcis, modèles prêts à l’emploi, zoom et actions globales.</p></div><button class="wb-icon-btn" onclick="document.getElementById('wb-settings-overlay').remove()">✕</button></div>
    <div class="wb-settings-grid">
      <section class="wb-settings-section"><h3>Fond du tableau</h3><div class="wb-chip-row"><button class="wb-mode-btn" onclick="MeetApp.wbApplyBoardTheme('current')">Couleur actuelle</button><button class="wb-mode-btn" onclick="MeetApp.wbBgColor('#ffffff')">Blanc</button><button class="wb-mode-btn" onclick="MeetApp.wbBgColor('#e5e7eb')">Gris</button><input type="color" value="${wbBgColor_}" onchange="MeetApp.wbBgColor(this.value)" style="width:42px;height:42px;border-radius:12px;border:1px solid var(--border);background:none;padding:0;"></div></section>
      <section class="wb-settings-section"><h3>Taille du curseur</h3><div class="wb-chip-row">${[['sm','SM'],['md','MD'],['lg','LG'],['xl','XL'],['xxl','XXL']].map(([k,l])=>`<button class="wb-mode-btn ${wbCursorScale_===k?'active':''}" data-wb-cursor-size="${k}" onclick="MeetApp.wbSetCursorScale('${k}')">${l}</button>`).join('')}</div></section>
      <section class="wb-settings-section"><h3>Raccourcis clavier</h3><div class="wb-shortcut-list"><div><kbd>Ctrl/Cmd + C</kbd><span>Copier</span></div><div><kbd>Ctrl/Cmd + V</kbd><span>Coller</span></div><div><kbd>Ctrl/Cmd + X</kbd><span>Couper</span></div><div><kbd>Ctrl/Cmd + D</kbd><span>Dupliquer</span></div><div><kbd>Ctrl/Cmd + A</kbd><span>Tout sélectionner</span></div><div><kbd>Ctrl/Cmd + Z</kbd><span>Annuler</span></div><div><kbd>Delete</kbd><span>Supprimer</span></div><div><kbd>Esc</kbd><span>Relâcher la sélection</span></div><div><kbd>←↑→↓</kbd><span>Déplacement précis</span></div><div><kbd>Shift + ←↑→↓</kbd><span>Déplacement rapide</span></div></div></section>
      <section class="wb-settings-section"><h3>Actions globales</h3><div class="wb-chip-row"><button class="wb-action-btn" onclick="MeetApp.wbExport(document.getElementById('wb-export-format')?.value || 'png')">Exporter</button><button class="wb-action-btn" onclick="MeetApp.wbCenterSelection(true)">Zoom sélection</button><button class="wb-action-btn" onclick="MeetApp.wbClear()" style="color:#f87171;border-color:rgba(248,113,113,.25);">Supprimer le tableau</button></div><p class="wb-settings-help">En mode partagé, un participant envoie une demande visible à l’hôte avant suppression globale.</p></section>
      <section class="wb-settings-section"><h3>Templates enseignants</h3><div class="wb-chip-row"><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('lesson')">Plan de cours</button><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('exercise')">Tableau d’exercice</button><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('brainstorm')">Brainstorming</button><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('mindmap')">Carte mentale</button></div></section>
      <section class="wb-settings-section"><h3>Templates entreprise</h3><div class="wb-chip-row"><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('kanban')">Kanban</button><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('roadmap')">Roadmap</button><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('userflow')">User flow</button><button class="wb-action-btn" onclick="MeetApp.wbInsertTemplate('wireframe')">Wireframe</button></div></section>
      <section class="wb-settings-section"><h3>Timeline rapide</h3><div style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto;">${historyHtml || '<div class="wb-settings-help">Aucune action enregistrée pour le moment.</div>'}</div></section>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

let wbZoom_ = 1;
function wbSetZoom(next = 1) {
  wbZoom_ = Math.max(0.4, Math.min(2.8, Number(next) || 1));
  const inner = document.getElementById('wb-canvas-inner');
  const pct = document.getElementById('wb-zoom-pct');
  if (inner) {
    inner.style.transformOrigin = '0 0';
    inner.style.transform = `scale(${wbZoom_})`;
    inner.style.width = `${2200 * wbZoom_}px`;
    inner.style.height = `${1400 * wbZoom_}px`;
  }
  if (pct) pct.textContent = `${Math.round(wbZoom_ * 100)}%`;
}
function wbZoomIn(){ wbSetZoom(wbZoom_ + 0.2); }
function wbZoomOut(){ wbSetZoom(wbZoom_ - 0.2); }
function wbZoomReset(){ wbSetZoom(1); }

function wbInsertTemplate(kind='brainstorm') {
  if (!wbCanEdit()) return notify(wbLockMode_==='readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte");
  const templates = {
    lesson: [{ sticker:'lesson', x:0.06,y:0.08,x2:0.38,y2:0.32, props:{title:'Plan de cours',items:'Objectifs, Introduction, Activité, Synthèse'} }, { sticker:'rubric', x:0.42,y:0.08,x2:0.78,y2:0.32, props:{title:'Critères',criteria:'Compréhension, Participation, Clarté'} }],
    exercise: [{ sticker:'table', x:0.08,y:0.08,x2:0.48,y2:0.38, props:{rows:5,cols:4} }, { sticker:'note', x:0.56,y:0.08,x2:0.82,y2:0.28, props:{label:'Consigne',body:'Décrivez votre raisonnement.'} }],
    brainstorm: [{ sticker:'mindmap', x:0.28,y:0.16,x2:0.68,y2:0.46, props:{title:'Idée centrale',branches:'Idée 1,Idée 2,Idée 3,Idée 4'} }, { sticker:'sticky', x:0.12,y:0.56,x2:0.28,y2:0.72, props:{label:'Post-it',body:'Idée'} }, { sticker:'sticky', x:0.34,y:0.56,x2:0.50,y2:0.72, props:{label:'Post-it',body:'Idée'} }],
    mindmap: [{ sticker:'mindmap', x:0.18,y:0.14,x2:0.78,y2:0.54, props:{title:'Sujet',branches:'Branche A,Branche B,Branche C,Branche D'} }],
    kanban: [{ sticker:'grid3', x:0.08,y:0.08,x2:0.92,y2:0.78, props:{col1:'À faire',col2:'En cours'} }, { sticker:'sticky', x:0.13,y:0.18,x2:0.24,y2:0.32, props:{label:'Tâche',body:'Backlog'} }],
    roadmap: [{ sticker:'timeline', x:0.08,y:0.12,x2:0.9,y2:0.34, props:{title:'Roadmap',items:'Q1,Q2,Q3,Q4'} }, { sticker:'swimlane', x:0.08,y:0.42,x2:0.9,y2:0.78, props:{title:'Chantiers',lanes:'Produit,Tech,Marketing'} }],
    userflow: [{ sticker:'container', x:0.08,y:0.1,x2:0.28,y2:0.22, props:{label:'Entrée'} }, { sticker:'container', x:0.4,y:0.1,x2:0.6,y2:0.22, props:{label:'Étape'} }, { sticker:'container', x:0.72,y:0.1,x2:0.92,y2:0.22, props:{label:'Sortie'} }],
    wireframe: [{ sticker:'browser', x:0.08,y:0.08,x2:0.9,y2:0.76, props:{url:'https://app.example'} }, { sticker:'hero', x:0.12,y:0.18,x2:0.82,y2:0.34, props:{title:'Hero'} }]
  };
  (templates[kind] || templates.brainstorm).forEach((tpl, idx) => {
    wbObjects.push({ id:'obj_'+Date.now()+'_'+idx, type:'sticker', color:wbColor_, opacity:100, ...tpl, ...wbLocalAuthorMeta(), props:{...(WB_STICKER_PROPS[tpl.sticker]||{}), ...(tpl.props||{})} });
  });
  wbSetSelection(wbObjects.length ? [wbObjects[wbObjects.length-1].id] : []);
  wbRedraw(); wbSaveHistory('template:'+kind); wbSyncAll('immediate');
  document.getElementById('wb-settings-overlay')?.remove();
}

function wbExport(format='png') {

  if(!MeetState.wbCanvas) return;
  const fmt = String(format || 'png').toLowerCase();
  const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp' };
  if (fmt === 'pdf') {
    try {
      const jspdf = window.jspdf;
      if (!jspdf?.jsPDF) throw new Error('jsPDF absent');
      const pdf = new jspdf.jsPDF(MeetState.wbCanvas.width >= MeetState.wbCanvas.height ? 'landscape' : 'portrait', 'pt', [MeetState.wbCanvas.width, MeetState.wbCanvas.height]);
      const img = MeetState.wbCanvas.toDataURL('image/png');
      pdf.addImage(img, 'PNG', 0, 0, MeetState.wbCanvas.width, MeetState.wbCanvas.height);
      pdf.save('tableau-'+MeetState.MEETING_ID+'.pdf');
    } catch (e) {
      notify("Export PDF indisponible pour l'instant.");
    }
    return;
  }
  const mime = mimeMap[fmt] || 'image/png';
  const quality = mime === 'image/png' ? undefined : 0.95;
  const a=document.createElement('a'); a.download='tableau-'+MeetState.MEETING_ID+'.'+fmt; a.href=MeetState.wbCanvas.toDataURL(mime, quality); a.click();
}

function wbImportImage() {
  if(!wbCanEdit()){ notify("Tableau verrouillé par l'hôte"); return; }
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{const img=new Image();img.onload=()=>{const W=MeetState.wbCanvas.width,H=MeetState.wbCanvas.height,sc=Math.min(W*.6/img.width,H*.6/img.height,1);const w=img.width*sc,h=img.height*sc;MeetState.wbCtx.drawImage(img,(W-w)/2,(H-h)/2,w,h);wbSaveHistory();wbSyncAll('immediate');};img.src=ev.target.result;};
    r.readAsDataURL(f);
  };
  inp.click();
}

function applyWbDraw({tool,color,size,x1,y1,x2,y2}) {
  if(!MeetState.wbCtx) return;
  const ctx=MeetState.wbCtx,a=fromNorm(x1,y1),b=fromNorm(x2,y2);
  ctx.strokeStyle=color; ctx.lineWidth=size; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
}

function applyWbShape(obj) { if(!obj.id) obj.id='r_'+Date.now(); wbObjects.push(obj); wbRedraw(); }
function applyWbSticker(obj) { if(!obj.id) obj.id='r_'+Date.now(); wbObjects.push(obj); wbRedraw(); }

// ── Push Notifications ───────────────────────────────────────────────────────
async function registerPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const vapidKey = document.querySelector('meta[name="vapid-public-key"]')?.content;
    if (!vapidKey) return;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' }, body: JSON.stringify(sub) });
  } catch(e) { console.log('Push non disponible:', e.message); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// ── Socket listeners pour ces fonctionnalités ────────────────────────────────
function setupNewFeaturesSocket() {
  const socket = MeetState.socket;

  // ── Salles de sous-groupes ────────────────────────────────────────────────
  socket.on('breakout_move', ({ roomLabel, link }) => breakoutShowMoveOverlay(roomLabel, link));
  socket.on('breakout_time_up', () => breakoutReturnToParent());
  socket.on('breakout_closed', () => {
    if (!MeetState.PARENT_MEETING_ID) notify('🧩 Salles de sous-groupes fermées');
    // Corrigé : le widget hôte ne se mettait à jour QUE sur un clic manuel
    // ("Fermer toutes les salles"), jamais quand la minuterie de retour
    // automatique expirait — il restait donc affiché pour rien.
    if (typeof breakoutRenderHostWidget === 'function' && typeof _breakoutSessionActive !== 'undefined') {
      _breakoutSessionActive = false;
      breakoutRenderHostWidget();
    }
  });
  socket.on('breakout_opened', ({ count, durationMinutes }) => {
    if (MeetState.IS_HOST) notify(`🧩 ${count} salle(s) ouverte(s)${durationMinutes ? ' · retour auto dans ' + durationMinutes + ' min' : ''}`);
  });

  socket.on('speech_start', ({ socketId }) => startSpeechTimer(socketId));
  socket.on('speech_stop',  ({ socketId }) => stopSpeechTimer(socketId));
  socket.on('speech_limit', ({ limit }) => {
    MeetState.speechLimit = limit;
    notify(`Limite de parole : ${Math.round(limit/60)} min`);
  });
  socket.on('participation_stats', ({ stats }) => {
    renderParticipationStats?.(stats || []);
    renderParticipationPanel?.();
  });
  socket.on('poll_launched', (poll) => { MeetState.currentPoll = poll; showPollVote(poll); });
  socket.on('poll_update',   (poll) => { if (MeetState.IS_HOST) showPollResults(poll); });
  socket.on('poll_results',  (poll) => showPollResults(poll));
  socket.on('wb_draw',  (data) => applyWbDraw(data));
  socket.on('wb_cursor', (data) => wbRenderRemoteCursor(data));
  socket.on('wb_lock',   ({ locked, lockOwner, lockMode }) => wbSetLockState(locked, lockOwner || '', lockMode || (locked ? 'readonly' : 'shared')));
  socket.on('wb_shape', (data) => applyWbShape(data));
  socket.on('wb_clear', () => {
    wbObjects = []; wbSetSelection([]); wbHoverObjId_ = null; hideWbProperties();
    if (!MeetState.wbCtx) return;
    MeetState.wbCtx.fillStyle = wbBgColor_; MeetState.wbCtx.fillRect(0, 0, MeetState.wbCanvas?.width||800, MeetState.wbCanvas?.height||600);
  });
  socket.on('wb_state', (payload) => {
    if (!payload) return;
    if (payload.objects && Array.isArray(payload.objects)) {
      // Nouveau format : liste d'objets normalisés
      wbObjects = payload.objects;
      if (payload.bgColor) wbBgColor_ = payload.bgColor;
      if (typeof payload.locked === 'boolean' || payload.lockMode) wbSetLockState(!!payload.locked, payload.lockOwner || '', payload.lockMode || (payload.locked ? 'readonly' : 'shared'));
      if (Array.isArray(payload.historyTimeline)) wbHistoryTimeline_ = payload.historyTimeline;
      if (MeetState.wbCanvas) wbRedraw();
      return;
    }
    if (payload.dataUrl && MeetState.wbCtx && MeetState.wbCanvas) {
      const img = new Image();
      img.onload = () => MeetState.wbCtx.drawImage(img, 0, 0);
      img.src = payload.dataUrl;
    }
  });
  socket.on('wb_sync', (payload) => {
    if (!payload) return;
    if (payload.objects && Array.isArray(payload.objects)) {
      wbObjects = payload.objects;
      if (payload.bgColor) wbBgColor_ = payload.bgColor;
      if (typeof payload.locked === 'boolean' || payload.lockMode) wbSetLockState(!!payload.locked, payload.lockOwner || '', payload.lockMode || (payload.locked ? 'readonly' : 'shared'));
      if (Array.isArray(payload.historyTimeline)) wbHistoryTimeline_ = payload.historyTimeline;
      if (MeetState.wbCanvas) wbRedraw();
    } else if (payload.dataUrl && MeetState.wbCtx && MeetState.wbCanvas) {
      const img = new Image();
      img.onload = () => MeetState.wbCtx.drawImage(img, 0, 0);
      img.src = payload.dataUrl;
    }
  });
  socket.on('wb_sticker', (data) => applyWbSticker(data));
  socket.on('wb_clear_request', (payload) => {
    const requester = payload?.requester || 'Un participant';
    if (!MeetState.IS_HOST) return;
    notify(`Demande d'effacement du tableau par ${requester}`);
    wbConfirmClear(() => MeetState.socket?.emit('wb_clear_approve', { meetingId: MeetState.MEETING_ID, requesterSocketId: payload?.requesterSocketId || '' }));
  });
  socket.on('wb_text',    (data) => { if(data.id&&!wbObjects.find(o=>o.id===data.id)){wbObjects.push(data);wbRedraw();} });

  // ── Popcorn ──────────────────────────────────────────────────────────────
  socket.on('popcorn_start', ({ targetName, targetSocketId, question, duration }) => {
    _popcornLastQuestion = question;
    showPopcornModal(targetName, targetSocketId, question, duration);
  });
  socket.on('popcorn_answer', ({ answer, targetName }) => {
    closePopcornModal();
    showPopcornAnswer(targetName, answer);
    appendChat('Popcorn 🍿', `${targetName} : ${answer}`, new Date().toISOString(), false);
    _popcornHistory.push({ name: targetName, question: _popcornLastQuestion, answer, timedOut: false, ts: new Date().toLocaleString('fr-FR') });
    popcornRoundOnResult();
  });
  socket.on('popcorn_timeout', ({ targetName }) => {
    closePopcornModal();
    notify(`⏰ ${targetName} n\'a pas répondu à temps`);
    _popcornHistory.push({ name: targetName, question: _popcornLastQuestion, answer: null, timedOut: true, ts: new Date().toLocaleString('fr-FR') });
    popcornRoundOnResult();
  });
  // Message d'erreur générique (droits insuffisants, cible invalide, etc.) — jusqu'ici silencieux côté client.
  socket.on('meeting_role_error', ({ error }) => { if (error) notify('⚠️ ' + error); });

  // ── Quiz ─────────────────────────────────────────────────────────────────
  socket.on('quiz_question', (q) => showQuizVote(q));
  socket.on('quiz_results',  (r) => {
    if (r.leaderboard) _quizLiveLeaderboard = r.leaderboard;
    _quizHistory.push({
      question:   r.question,
      options:    r.options,
      correctIdx: r.correctIdx,
      votes:      r.votes,
      voterNames: r.voterNames || {},
      scores:     r.scores || [],
      points:     r.points || 1,
      isBingo:    r.isBingo || false,
      ts:         new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}),
    });
    quizSaveToStorage();
    showQuizResults(r);
    quizBankOnResults(); // enchaîne sur la question suivante de la banque si une séquence est en cours
    // Rafraîchir la modal si elle est ouverte
    if (document.getElementById('qtab-body')) {
      const active = document.querySelector('[id^=qtab-][style*="var(--accent)"]');
      if (active) quizCreatorTab(active.id.replace('qtab-',''));
    }
  });
  socket.on('quiz_end',      ()  => closeQuizModal());
  socket.on('quiz_vote_count', ({ total }) => {
    const el = document.getElementById('quiz-vote-count');
    if (el) el.textContent = `${total} vote${total>1?'s':''}`;
  });
  // Recevoir le classement restauré par l'hôte
  socket.on('quiz_leaderboard_sync', ({ leaderboard }) => {
    if (leaderboard?.length) {
      _quizLiveLeaderboard = leaderboard;
      quizSaveToStorage();
    }
  });
  socket.on('quiz_applaud', ({ targetName, fromName }) => {
    const isTarget = targetName === MeetState.displayName;
    showApplauseEffect(isTarget ? MeetState.displayName : targetName, false);
    if (!isTarget) notify(`👏 ${fromName} applaudit ${targetName}`);
  });

  // Restaurer l'état quiz depuis localStorage (si reconnexion)
  quizLoadFromStorage();
  if (_quizLiveLeaderboard.length) {
    // Remonter le leaderboard au serveur pour que les autres le reçoivent
    socket.emit('quiz_restore_leaderboard', {
      meetingId:   MeetState.MEETING_ID,
      leaderboard: _quizLiveLeaderboard,
    });
    // Notifier uniquement l'hôte — silencieux pour les autres
    if (MeetState.IS_HOST) {
      notify('🏆 Classement restauré — ' + _quizLiveLeaderboard.length + ' joueur(s)');
    }
  }

  // Demander l'état du tableau blanc — tous les handlers sont prêts maintenant
  socket.emit('wb_request_state', { meetingId: MeetState.MEETING_ID });
}

// ── Enregistrement ───────────────────────────────────────────────────────────
function ensureRecordingUnloadProtection() {
  if (!MeetState._recordingBeforeUnloadHandler) {
    MeetState._recordingBeforeUnloadHandler = (e) => {
      if (MeetState._mediaRecorder?.state === 'recording') {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', MeetState._recordingBeforeUnloadHandler);
  }
  if (!MeetState._recordingKeydownHandler) {
    MeetState._recordingKeydownHandler = (e) => {
      if (!(MeetState._mediaRecorder?.state === 'recording')) return;
      const wantsReload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
      if (!wantsReload) return;
      e.preventDefault();
      const saveNow = confirm('Un enregistrement est en cours. Voulez-vous arrêter et enregistrer la vidéo avant de recharger ?');
      if (saveNow) {
        try { MeetState._mediaRecorder.stop(); } catch (_) {}
      }
    };
    window.addEventListener('keydown', MeetState._recordingKeydownHandler);
  }
}

function teardownRecordingUnloadProtection() {
  // Corrigé : sans remettre ces variables à null, ensureRecordingUnloadProtection()
  // croit à tort que la protection est toujours active au 2e enregistrement de
  // la même réunion (elle vient pourtant d'être retirée juste au-dessus) et ne
  // la réinstalle jamais — on pouvait alors fermer l'onglet sans avertissement
  // et perdre un enregistrement en cours, silencieusement.
  if (MeetState._recordingBeforeUnloadHandler) {
    window.removeEventListener('beforeunload', MeetState._recordingBeforeUnloadHandler);
    MeetState._recordingBeforeUnloadHandler = null;
  }
  if (MeetState._recordingKeydownHandler) {
    window.removeEventListener('keydown', MeetState._recordingKeydownHandler);
    MeetState._recordingKeydownHandler = null;
  }
}

function showRecordCountdown() {
  return new Promise((resolve) => {
    const old = document.getElementById('record-countdown-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'record-countdown-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;background:rgba(4,10,20,.42);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    overlay.innerHTML = '<div id="record-countdown-number" style="font-size:96px;font-weight:900;color:white;text-shadow:0 10px 40px rgba(0,0,0,.45);">3</div>';
    document.body.appendChild(overlay);
    let n = 3;
    const tick = () => {
      const el = document.getElementById('record-countdown-number');
      if (el) el.textContent = String(n);
      if (n === 0) { overlay.remove(); resolve(); return; }
      n -= 1; setTimeout(tick, 700);
    };
    tick();
  });
}

// Formats testés du plus préféré au moins préféré. Firefox/Chrome savent
// produire du vrai WebM ; Safari ne le supporte pas du tout et a besoin de
// MP4 — sans ce dernier choix, MediaRecorder échouait silencieusement ou
// produisait un fichier dont le contenu réel ne correspondait pas à
// l'extension ".webm" codée en dur (d'où des fichiers illisibles/mal
// nommés selon le navigateur).
const RECORDING_MIME_CANDIDATES = [
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM — VP9 (meilleure qualité)' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM — VP8 (standard, plus compatible)' },
  { mime: 'video/webm',                 ext: 'webm', label: 'WebM (générique)' },
  { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4',  label: 'MP4 (le plus compatible partout, requis sur Safari)' },
  { mime: 'video/mp4',                  ext: 'mp4',  label: 'MP4 (générique)' },
];

function getSupportedRecordingFormats() {
  return RECORDING_MIME_CANDIDATES.filter(c => MediaRecorder.isTypeSupported(c.mime));
}

function pickSupportedRecordingFormat() {
  return getSupportedRecordingFormats()[0] || null;
}

// Laisse la personne choisir son format d'export — mais UNIQUEMENT parmi
// ceux que CE navigateur sait réellement produire (MediaRecorder.isTypeSupported),
// pour ne jamais proposer un choix condamné à échouer ou à produire un
// fichier incohérent avec son extension.
function askRecordingFormat() {
  return new Promise((resolve) => {
    const formats = getSupportedRecordingFormats();

    // Aucun format connu supporté (navigateur exotique) : on ne bloque pas
    // l'enregistrement pour autant, MediaRecorder choisira lui-même.
    if (formats.length === 0) { resolve(null); return; }
    // Un seul format possible : pas la peine d'afficher un choix inutile.
    if (formats.length === 1) { resolve(formats[0]); return; }

    const old = document.getElementById('record-format-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'record-format-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;background:rgba(4,10,20,.55);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    overlay.innerHTML = `
      <div style="background:var(--bg2,#0f172a);border:1px solid var(--border,rgba(3,92,128,.25));border-radius:16px;padding:22px;max-width:360px;width:90%;">
        <div style="font-size:14px;font-weight:800;color:var(--text1,#fff);margin-bottom:4px;">Format de l'enregistrement</div>
        <div style="font-size:12px;color:var(--muted,#94a3b8);margin-bottom:14px;line-height:1.5;">Choisis le format du fichier vidéo qui sera téléchargé à la fin.</div>
        <div id="record-format-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>`;
    document.body.appendChild(overlay);

    const list = overlay.querySelector('#record-format-list');
    formats.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.textContent = f.label;
      btn.style.cssText = 'text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.1));background:' + (i === 0 ? 'rgba(3,92,128,.16)' : 'transparent') + ';color:var(--text1,#fff);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';
      btn.onclick = () => { overlay.remove(); resolve(f); };
      list.appendChild(btn);
    });
  });
}

// Construit un mix audio fiable (notre micro + tous les participants) via
// Web Audio — indépendant de la case "Partager l'audio de l'onglet" du
// sélecteur natif de getDisplayMedia, qui ne capte PAS toujours le son
// (dépend du navigateur, et l'utilisateur oublie souvent de la cocher).
// C'est ce mix qu'on utilise TOUJOURS pour l'enregistrement, qu'on ait pu
// capter l'audio de l'onglet ou pas — pour ne plus jamais se retrouver avec
// un enregistrement totalement muet.
function buildMeetingRecordingAudioMix() {
  const audioCtx = getSharedAudioCtx ? getSharedAudioCtx() : new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  let sourcesConnected = 0;

  document.querySelectorAll('.peer-tile video').forEach((v) => {
    if (!v.srcObject) return;
    const audioTracks = v.srcObject.getAudioTracks?.() || [];
    if (!audioTracks.length) return;
    try { audioCtx.createMediaStreamSource(v.srcObject).connect(dest); sourcesConnected++; }
    catch (_) { /* un flux déjà connecté ailleurs peut lever une erreur bénigne */ }
  });

  if (MeetState.localStream?.getAudioTracks().length) {
    try { audioCtx.createMediaStreamSource(MeetState.localStream).connect(dest); sourcesConnected++; }
    catch (_) {}
  }

  MeetState._recordAudioCtx = audioCtx;
  return { track: dest.stream.getAudioTracks()[0] || null, sourcesConnected };
}

async function buildFallbackMeetingRecordingStream() {
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
    const tw = Math.floor(W / cols), th = Math.floor(H / rows);
    tiles.forEach((v, i) => { const col = i % cols, row = Math.floor(i / cols); try { ctx.drawImage(v, col*tw, row*th, tw, th); } catch(_) {} });
    MeetState._recordFrame = requestAnimationFrame(drawFrame);
  }
  drawFrame();
  const { track: mixedAudioTrack } = buildMeetingRecordingAudioMix();
  const tracks = [canvas.captureStream(24).getVideoTracks()[0]];
  if (mixedAudioTrack) tracks.push(mixedAudioTrack);
  return new MediaStream(tracks);
}

async function buildMeetingRecordingStream() {
  if (meetingIsIOSLike()) return buildFallbackMeetingRecordingStream();
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24, cursor: 'always', displaySurface: 'browser' },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    });

    // On garde la piste vidéo de l'écran partagé, mais on IGNORE son audio
    // (peu fiable — dépend d'une case à cocher native que l'utilisateur
    // oublie souvent) au profit de notre propre mix micro + participants,
    // pour ne plus jamais se retrouver avec un enregistrement muet.
    displayStream.getAudioTracks().forEach(t => t.stop());
    const { track: mixedAudioTrack, sourcesConnected } = buildMeetingRecordingAudioMix();
    if (!sourcesConnected) notify?.('Aucune source audio détectée — l’enregistrement sera peut-être muet.');

    const tracks = [displayStream.getVideoTracks()[0]];
    if (mixedAudioTrack) tracks.push(mixedAudioTrack);
    MeetState._recordDisplayStream = displayStream; // gardé pour pouvoir arrêter proprement la capture d'écran à la fin
    return new MediaStream(tracks);
  } catch (e) {
    console.warn('[REC] fallback composite recording:', e);
    return buildFallbackMeetingRecordingStream();
  }
}

async function toggleRecord() {
  const btn = document.getElementById('btn-rec') || document.getElementById('btn-record');
  if (MeetState._mediaRecorder?.state === 'recording') {
    MeetState._mediaRecorder.stop();
    if (btn) { btn.className = 'ctrl-btn active'; document.getElementById('rec-ico').style.fill = ''; }
    notify('Enregistrement arrêté');
    return;
  }
  MeetState._recordFormatChoice = await askRecordingFormat();
  await showRecordCountdown();
  ensureRecordingUnloadProtection();
  const finalStream = await buildMeetingRecordingStream();
  MeetState._recordChunks = [];

  // Choisit un format réellement supporté par CE navigateur, choisi par la
  // personne elle-même (avec repli MP4 pour Safari) plutôt qu'imposé.
  const format = MeetState._recordFormatChoice || pickSupportedRecordingFormat();
  MeetState._mediaRecorder = format
    ? new MediaRecorder(finalStream, { mimeType: format.mime })
    : new MediaRecorder(finalStream); // aucun format connu supporté : on laisse le navigateur choisir

  // On se fie à mediaRecorder.mimeType (ce que le navigateur utilise VRAIMENT,
  // qui peut différer de ce qu'on a demandé) pour le type du Blob ET
  // l'extension du fichier — plus jamais d'incohérence entre le contenu réel
  // et le nom du fichier téléchargé.
  const actualMime = MeetState._mediaRecorder.mimeType || format?.mime || 'video/webm';
  const actualExt  = actualMime.includes('mp4') ? 'mp4' : 'webm';

  MeetState._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) MeetState._recordChunks.push(e.data); };
  MeetState._mediaRecorder.onstop = () => {
    cancelAnimationFrame(MeetState._recordFrame);
    MeetState._recordFrame = null;
    try { MeetState._recordAudioCtx?.close?.(); } catch (_) {}
    MeetState._recordAudioCtx = null;
    try { finalStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { MeetState._recordDisplayStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    MeetState._recordDisplayStream = null;
    teardownRecordingUnloadProtection();
    const blob = new Blob(MeetState._recordChunks, { type: actualMime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `reunion-${MeetState.MEETING_ID}-${new Date().toISOString().slice(0,19)}.${actualExt}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  MeetState._mediaRecorder.start(1000);
  if (btn) { btn.className = 'ctrl-btn rec-on'; document.getElementById('rec-ico').style.fill = '#f87171'; }
  notify('Enregistrement démarré');
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
let _popcornTimer        = null;
let _popcornAskedPool    = [];  // tirage au sort ponctuel : ids déjà désignés depuis le dernier tour complet
let _popcornLastQuestion = '';  // dernière question envoyée (pour rattacher la réponse dans l'historique)
let _popcornHistory      = [];  // { name, question, answer, timedOut, ts }

const POPCORN_ROUND_REVIEW_DELAY = 4000; // pause entre 2 personnes pour laisser voir la réponse
let _popcornRound = {
  active: false, paused: false, mode: 'single', // 'single' = même question pour tout le monde ; 'bank' = questions différentes de la banque
  question: '', duration: 30,
  queue: [],       // mode 'single' : file des participants restant à interroger
  bankQueue: [],   // mode 'bank'   : file des questions de la banque restantes
  calledCount: 0, total: 0,
  inFlight: false, advanceTimer: null, watchdogTimer: null,
};

function popcornGetParticipants() {
  return Array.from(document.querySelectorAll('.peer-tile'))
    .map(t => ({ id: t.id.replace('tile-',''), name: t.querySelector('.peer-name')?.textContent?.replace(' (vous)','').trim() || '?' }))
    .filter(p => p.id !== 'local');
}

// Tirage au sort équitable : ne redésigne pas quelqu'un déjà tiré tant que tout
// le monde n'est pas passé une fois (le pool se réinitialise ensuite).
function popcornFairRandomPick(participants) {
  if (!participants.length) return null;
  let pool = participants.filter(p => !_popcornAskedPool.includes(p.id));
  if (!pool.length) { _popcornAskedPool = []; pool = participants; }
  const picked = pool[Math.floor(Math.random() * pool.length)];
  _popcornAskedPool.push(picked.id);
  return picked;
}

function openPopcornLauncher() {
  if (!MeetState.IS_HOST) return;
  const existing = document.getElementById('popcorn-launcher');
  if (existing) { existing.remove(); return; }

  const div = document.createElement('div');
  div.id = 'popcorn-launcher';
  div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;';
  div.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;width:440px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 22px 0;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="font-size:28px;">🍿</div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--text1);">Mode Popcorn</div>
            <div style="font-size:11px;color:var(--muted);">Lancer · Banque · Historique</div>
          </div>
        </div>
        <button onclick="document.getElementById('popcorn-launcher').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;">×</button>
      </div>
      <div style="display:flex;gap:0;padding:12px 22px 0;flex-shrink:0;">
        <button id="ptab-launch"  onclick="popcornTab('launch')"  style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid #f59e0b;background:transparent;color:#f59e0b;font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">🍿 Lancer</button>
        <button id="ptab-bank"    onclick="popcornTab('bank')"    style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">📚 Banque</button>
        <button id="ptab-history" onclick="popcornTab('history')" style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">📋 Historique</button>
      </div>
      <div id="ptab-body" style="padding:18px 22px 22px;overflow-y:auto;flex:1;"></div>
    </div>`;
  document.body.appendChild(div);
  div.addEventListener('click', e => { if (e.target === div) div.remove(); });
  popcornTab('launch');
}

function popcornTab(tab) {
  ['launch','bank','history'].forEach(t => {
    const btn = document.getElementById('ptab-'+t);
    if (!btn) return;
    const active = t === tab;
    btn.style.borderBottom = active ? '2px solid #f59e0b' : '2px solid transparent';
    btn.style.color        = active ? '#f59e0b' : 'var(--muted)';
    btn.style.fontWeight   = active ? '800' : '600';
  });
  const body = document.getElementById('ptab-body');
  if (!body) return;
  if (tab === 'launch')  renderPopcornLaunchTab(body);
  if (tab === 'bank')    { loadPopcornBank(); renderPopcornBankTab(body); }
  if (tab === 'history') renderPopcornHistoryTab(body);
}

function renderPopcornLaunchTab(body) {
  const participants = popcornGetParticipants();
  body.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(245,158,11,.06);margin-bottom:14px;">
      <input type="checkbox" id="popcorn-round-mode" style="width:15px;height:15px;accent-color:#f59e0b;cursor:pointer;"
        onchange="document.getElementById('popcorn-target-wrap').style.display=this.checked?'none':'';document.getElementById('popcorn-launch-btn').textContent=this.checked?'🔁 Démarrer la ronde':'🍿 Lancer !'">
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--text1);">🔁 Ronde automatique</div>
        <div style="font-size:10px;color:var(--muted);">Interroge tout le monde à tour de rôle, un par un, avec cette question</div>
      </div>
    </label>
    <div id="popcorn-target-wrap" style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Participant</label>
      <select id="popcorn-target" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;">
        <option value="random">🎲 Aléatoire (équitable)</option>
        ${participants.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Question</label>
      <textarea id="popcorn-question" placeholder="Ex: Quelle est la principale conclusion ?" rows="3"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;resize:none;box-sizing:border-box;"></textarea>
    </div>
    <div style="margin-bottom:20px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Durée de réponse</label>
      <div style="display:flex;gap:8px;">
        ${[15,30,45,60].map(s=>`<button type="button" onclick="document.getElementById('popcorn-duration').value=${s};this.parentElement.querySelectorAll('button').forEach(b=>b.style.background='');this.style.background='rgba(245,158,11,.25)'" style="flex:1;padding:7px;border-radius:7px;border:1px solid var(--border);background:${s===30?'rgba(245,158,11,.25)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${s}s</button>`).join('')}
        <input type="hidden" id="popcorn-duration" value="30">
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="document.getElementById('popcorn-launcher').remove()" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:13px;cursor:pointer;font-family:'Sora',sans-serif;">Annuler</button>
      <button id="popcorn-launch-btn" onclick="launchPopcorn()" style="flex:1;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">🍿 Lancer !</button>
    </div>`;
}

function launchPopcorn() {
  const question  = document.getElementById('popcorn-question')?.value.trim();
  const duration  = parseInt(document.getElementById('popcorn-duration')?.value) || 30;
  const roundMode = document.getElementById('popcorn-round-mode')?.checked;
  if (!question) { notify('Écris une question !'); return; }

  if (roundMode) { popcornStartRound(question, duration); return; }

  const sel = document.getElementById('popcorn-target');
  let targetSocketId = sel.value;
  let targetName     = sel.options[sel.selectedIndex]?.text || '?';

  if (targetSocketId === 'random') {
    const picked = popcornFairRandomPick(popcornGetParticipants());
    if (!picked) { notify('Aucun participant à désigner'); return; }
    targetSocketId = picked.id;
    targetName     = picked.name;
  }

  document.getElementById('popcorn-launcher')?.remove();
  _popcornLastQuestion = question;
  MeetState.socket?.emit('popcorn_launch', { meetingId: MeetState.MEETING_ID, targetSocketId, targetName, question, duration });
  notify(`🍿 Question posée à ${targetName}`);
}

// ── Ronde automatique (mode 'single' : même question pour tout le monde) ───
function popcornStartRound(question, duration) {
  if (!MeetState.IS_HOST) return;
  const participants = popcornGetParticipants();
  if (!participants.length) { notify('⚠️ Aucun participant à interroger'); return; }
  const queue = [...participants];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  clearTimeout(_popcornRound.advanceTimer); clearTimeout(_popcornRound.watchdogTimer);
  _popcornRound = { active:true, paused:false, mode:'single', question, duration, queue, bankQueue:[], calledCount:0, total:queue.length, inFlight:false, advanceTimer:null, watchdogTimer:null };
  document.getElementById('popcorn-launcher')?.remove();
  popcornRoundLaunchNext();
}

// ── Ronde automatique (mode 'bank' : une question différente à chaque fois) ─
function popcornStartBankRound() {
  if (!MeetState.IS_HOST) return;
  if (!_popcornBank.length) { notify("⚠️ La banque Popcorn est vide — ajoute ou importe des questions d'abord"); return; }
  clearTimeout(_popcornRound.advanceTimer); clearTimeout(_popcornRound.watchdogTimer);
  _popcornRound = { active:true, paused:false, mode:'bank', question:'', duration:30, queue:[], bankQueue:[..._popcornBank], calledCount:0, total:_popcornBank.length, inFlight:false, advanceTimer:null, watchdogTimer:null };
  document.getElementById('popcorn-launcher')?.remove();
  popcornRoundLaunchNext();
}

function popcornRoundLaunchNext() {
  const r = _popcornRound;
  if (!r.active || r.paused) return;

  let target, question, duration;
  if (r.mode === 'bank') {
    if (!r.bankQueue.length) { notify('🏁 Toutes les questions de la banque Popcorn ont été posées'); popcornStopRound(true); return; }
    const item = r.bankQueue.shift();
    question = item.question; duration = item.duration;
    target = popcornFairRandomPick(popcornGetParticipants());
    if (!target) { notify('⚠️ Aucun participant à interroger'); popcornStopRound(true); return; }
  } else {
    if (!r.queue.length) { notify('🏁 Tour de table terminé — tout le monde est passé'); popcornStopRound(true); return; }
    target = r.queue.shift();
    question = r.question; duration = r.duration;
  }

  r.calledCount++;
  r.inFlight = true;
  _popcornLastQuestion = question;
  MeetState.socket?.emit('popcorn_launch', {
    meetingId: MeetState.MEETING_ID,
    targetSocketId: target.id, targetName: target.name,
    question, duration,
  });

  // Filet de sécurité : si aucune réponse ni timeout ne revient (ex. cible
  // rejetée côté serveur, déconnexion), on n'attend pas indéfiniment.
  clearTimeout(r.watchdogTimer);
  r.watchdogTimer = setTimeout(() => {
    if (_popcornRound.active && _popcornRound.inFlight) {
      notify('⚠️ Pas de réponse détectée pour ' + target.name + ' — passage au suivant');
      popcornRoundOnResult();
    }
  }, (duration + 8) * 1000);

  popcornRoundRefresh();
}

// Appelé quand une réponse OU un timeout arrive (voir socket.on('popcorn_answer'/'popcorn_timeout'))
function popcornRoundOnResult() {
  const r = _popcornRound;
  if (!r.active) return;
  r.inFlight = false;
  clearTimeout(r.watchdogTimer);
  if (r.paused) { popcornRoundRefresh(); return; }
  clearTimeout(r.advanceTimer);
  r.advanceTimer = setTimeout(() => popcornRoundLaunchNext(), POPCORN_ROUND_REVIEW_DELAY);
  popcornRoundRefresh();
}

function popcornPauseRound() {
  if (!_popcornRound.active) return;
  _popcornRound.paused = true;
  clearTimeout(_popcornRound.advanceTimer);
  notify('⏸ Popcorn en pause — la question en cours continue, la suivante attendra');
  popcornRoundRefresh();
}

function popcornResumeRound() {
  if (!_popcornRound.active) return;
  _popcornRound.paused = false;
  notify('▶ Popcorn repris');
  if (!_popcornRound.inFlight) popcornRoundLaunchNext();
  else popcornRoundRefresh();
}

function popcornStopRound(silent) {
  clearTimeout(_popcornRound.advanceTimer); clearTimeout(_popcornRound.watchdogTimer);
  _popcornRound = { active:false, paused:false, mode:'single', question:'', duration:30, queue:[], bankQueue:[], calledCount:0, total:0, inFlight:false, advanceTimer:null, watchdogTimer:null };
  if (!silent) notify('⏹ Popcorn arrêté');
  popcornRoundRefresh();
}

function popcornRoundRefresh() {
  popcornRoundRenderWidget();
  const activeBtn = document.getElementById('ptab-bank');
  if (activeBtn && activeBtn.style.color === '#f59e0b') {
    const body = document.getElementById('ptab-body');
    if (body) renderPopcornBankTab(body);
  }
}

// Widget flottant : reste visible même quand la modale se ferme (elle se
// ferme à chaque lancement pour laisser voir la réponse en direct).
function popcornRoundRenderWidget() {
  const r = _popcornRound;
  let el = document.getElementById('popcorn-round-widget');
  if (!MeetState.IS_HOST || !r.active) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'popcorn-round-widget';
    el.style.cssText = 'position:fixed;right:16px;z-index:9500;background:var(--bg2,#1a1a2e);border:1px solid rgba(245,158,11,.5);border-radius:12px;padding:9px 12px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:8px;font-family:\'Sora\',sans-serif;';
    document.body.appendChild(el);
  }
  // Décaler sous le widget du quiz s'il est aussi affiché, pour ne pas les superposer.
  el.style.top = document.getElementById('quiz-bank-widget') ? '72px' : '16px';
  const icon = r.mode === 'bank' ? '📚' : '🔁';
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;line-height:1.3;">
      <div style="font-size:11px;font-weight:800;color:#f59e0b;white-space:nowrap;">${icon} Popcorn ${r.calledCount}/${r.total}</div>
      <div style="font-size:9px;color:var(--muted,#9ca3af);white-space:nowrap;">${r.paused?'⏸ En pause':(r.inFlight?'● En cours':'⏳ Suivant bientôt')}</div>
    </div>
    ${r.paused
      ? `<button onclick="popcornResumeRound()" title="Continuer" style="padding:7px 11px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#15803d);color:white;font-size:12px;font-weight:800;cursor:pointer;">▶</button>`
      : `<button onclick="popcornPauseRound()" title="Pause" style="padding:7px 11px;border-radius:8px;border:none;background:rgba(59,130,246,.9);color:white;font-size:12px;font-weight:800;cursor:pointer;">⏸</button>`}
    <button onclick="popcornStopRound()" title="Arrêter" style="padding:7px 9px;border-radius:8px;border:1px solid rgba(248,113,113,.4);background:transparent;color:#f87171;font-size:11px;font-weight:700;cursor:pointer;">⏹</button>
  `;
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

// ── Historique / export ─────────────────────────────────────────────────────
function renderPopcornHistoryTab(body) {
  if (!_popcornHistory.length) {
    body.innerHTML = '<div style="padding:30px 10px;text-align:center;color:var(--muted);font-size:12px;">Aucune réponse enregistrée pour l\'instant.</div>';
    return;
  }
  body.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <button onclick="popcornExportHistory('txt')" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">⬇ Export .txt</button>
      <button onclick="popcornExportHistory('pdf')" style="flex:1;padding:8px;border-radius:8px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">⬇ Export .pdf</button>
    </div>
    <div>
      ${_popcornHistory.slice().reverse().map(h => `
        <div style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid var(--border);margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
            <div style="font-size:11px;font-weight:800;color:#f59e0b;">🎤 ${escHtml(h.name)}</div>
            <div style="font-size:9px;color:var(--muted);white-space:nowrap;">${h.ts}</div>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${escHtml(h.question)}</div>
          <div style="font-size:12px;color:var(--text1);font-weight:600;">${h.timedOut ? '⏰ Pas de réponse (temps écoulé)' : escHtml(h.answer)}</div>
        </div>`).join('')}
    </div>`;
}

function popcornExportHistory(format) {
  if (!_popcornHistory.length) { notify('Aucune réponse à exporter'); return; }
  if (format === 'txt') {
    const lines = ['=== HISTORIQUE POPCORN — ' + new Date().toLocaleString('fr-FR') + ' ===', ''];
    _popcornHistory.forEach((h, i) => {
      lines.push((i+1) + '. [' + h.ts + '] ' + h.name);
      lines.push('   Q: ' + h.question);
      lines.push('   R: ' + (h.timedOut ? '(pas de réponse — temps écoulé)' : h.answer));
      lines.push('');
    });
    _triggerFileDownload(lines.join('\n'), 'historique_popcorn.txt', 'text/plain');
  } else {
    const sections = _popcornHistory.map((h, i) => ({
      heading: (i+1) + '. ' + h.name + '  [' + h.ts + ']',
      lines: ['Q: ' + h.question, 'R: ' + (h.timedOut ? '(pas de réponse — temps écoulé)' : h.answer)],
    }));
    _quizDownloadPDF('historique_popcorn.pdf', '🍿 Historique Popcorn', sections);
  }
}

// ── Banque de questions Popcorn ─────────────────────────────────────────────
const POPCORN_BANK_KEY = 'ts_popcorn_bank_v1';
let _popcornBank       = [];
let _popcornBankEditId = null;

function loadPopcornBank() {
  try { const raw = localStorage.getItem(POPCORN_BANK_KEY); _popcornBank = raw ? JSON.parse(raw) : []; }
  catch (_) { _popcornBank = []; }
}
function savePopcornBank() {
  try { localStorage.setItem(POPCORN_BANK_KEY, JSON.stringify(_popcornBank)); } catch (_) {}
}

function renderPopcornBankTab(body) {
  const r = _popcornRound;
  const bankRoundActive = r.active && r.mode === 'bank';
  body.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
      <button onclick="popcornBankNewQuestion()" ${r.active?'disabled':''} style="flex:1;min-width:120px;padding:8px;border-radius:8px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:11px;font-weight:700;cursor:${r.active?'not-allowed':'pointer'};opacity:${r.active?'.5':'1'};font-family:'Sora',sans-serif;">+ Question</button>
      <button onclick="popcornBankTriggerImport()" ${r.active?'disabled':''} style="flex:1;min-width:120px;padding:8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:11px;font-weight:700;cursor:${r.active?'not-allowed':'pointer'};opacity:${r.active?'.5':'1'};font-family:'Sora',sans-serif;">📂 Importer</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <button onclick="downloadPopcornBankTemplate('txt')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">⬇ Modèle .txt</button>
      <button onclick="downloadPopcornBankTemplate('tsq')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">⬇ Modèle .tsq</button>
      <input type="file" id="popcorn-bank-file-input" accept=".txt,.tsq" style="display:none" onchange="handlePopcornBankFileImport(event)">
    </div>
    ${_popcornBank.length ? `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);">
      ${!bankRoundActive ? `
        <button onclick="popcornStartBankRound()" ${(r.active && r.mode!=='bank')?'disabled':''} style="padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:12px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;opacity:${(r.active && r.mode!=='bank')?'.5':'1'};">▶ Démarrer la banque</button>
        <div style="font-size:10px;color:var(--muted);">Interroge ${_popcornBank.length} personne(s) différente(s), une question chacune</div>
      ` : `
        ${r.paused
          ? `<button onclick="popcornResumeRound()" style="padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#15803d);color:white;font-size:12px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">▶ Continuer</button>`
          : `<button onclick="popcornPauseRound()" style="padding:8px 14px;border-radius:8px;border:none;background:rgba(59,130,246,.9);color:white;font-size:12px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">⏸ Pause</button>`}
        <button onclick="popcornStopRound()" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(248,113,113,.4);background:transparent;color:#f87171;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">⏹ Arrêter</button>
        <div style="font-size:11px;font-weight:700;color:var(--text1);">${r.calledCount}/${r.total} ${r.paused?'· en pause':(r.inFlight?'· en cours':'· suivante bientôt')}</div>
      `}
    </div>` : ''}
    <div>
      ${!_popcornBank.length ? '<div style="padding:30px 10px;text-align:center;color:var(--muted);font-size:12px;">Banque vide. Ajoute une question ou importe un fichier .txt / .tsq.</div>' : _popcornBank.map((q) => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid var(--border);margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(q.question)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${q.duration}s · destinataire tiré au sort</div>
          </div>
          <button ${r.active?'disabled':`onclick="launchPopcornFromBank('${q.id}')"`} title="Lancer maintenant" style="padding:6px 10px;border-radius:8px;border:none;background:rgba(245,158,11,.18);color:#f59e0b;font-size:12px;font-weight:800;cursor:${r.active?'not-allowed':'pointer'};opacity:${r.active?'.4':'1'};font-family:'Sora',sans-serif;">▶</button>
          <button ${r.active?'disabled':`onclick="popcornBankEditQuestion('${q.id}')"`} title="Éditer" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;cursor:${r.active?'not-allowed':'pointer'};opacity:${r.active?'.4':'1'};">✎</button>
          <button ${r.active?'disabled':`onclick="popcornBankDeleteQuestion('${q.id}')"`} title="Supprimer" style="padding:6px 8px;border-radius:8px;border:1px solid rgba(248,113,113,.3);background:transparent;color:#f87171;font-size:11px;cursor:${r.active?'not-allowed':'pointer'};opacity:${r.active?'.4':'1'};">🗑</button>
        </div>`).join('')}
    </div>`;
}

function popcornBankNewQuestion() {
  _popcornBankEditId = null;
  renderPopcornBankForm(document.getElementById('ptab-body'), null);
}
function popcornBankEditQuestion(id) {
  const q = _popcornBank.find(x => x.id === id);
  if (!q) return;
  _popcornBankEditId = id;
  renderPopcornBankForm(document.getElementById('ptab-body'), q);
}
function popcornBankDeleteQuestion(id) {
  _popcornBank = _popcornBank.filter(x => x.id !== id);
  savePopcornBank();
  renderPopcornBankTab(document.getElementById('ptab-body'));
}
function popcornBankCancelForm() {
  renderPopcornBankTab(document.getElementById('ptab-body'));
}

function renderPopcornBankForm(body, existing) {
  const q = existing || { question: '', duration: 30 };
  body.innerHTML = `
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Question</label>
      <textarea id="pb-question" rows="3" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;resize:none;box-sizing:border-box;">${escHtml(q.question)}</textarea>
    </div>
    <div style="margin-bottom:20px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Durée de réponse</label>
      <div style="display:flex;gap:8px;">
        ${[15,30,45,60].map(s=>`<button type="button" onclick="document.getElementById('pb-duration').value=${s};this.parentElement.querySelectorAll('button').forEach(b=>{b.style.cssText='flex:1;padding:7px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:Sora,sans-serif;'});this.style.background='rgba(245,158,11,.25)';this.style.borderColor='#f59e0b'" style="flex:1;padding:7px;border-radius:7px;border:1px solid ${q.duration===s?'#f59e0b':'var(--border)'};background:${q.duration===s?'rgba(245,158,11,.25)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${s}s</button>`).join('')}
        <input type="hidden" id="pb-duration" value="${q.duration}">
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="popcornBankCancelForm()" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Annuler</button>
      <button onclick="popcornBankSaveQuestion()" style="flex:2;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#f97316);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">💾 Enregistrer dans la banque</button>
    </div>`;
}

function popcornBankSaveQuestion() {
  const question = document.getElementById('pb-question')?.value.trim();
  if (!question) { notify('Écris une question !'); return; }
  const duration = parseInt(document.getElementById('pb-duration')?.value) || 30;

  const item = { id: _popcornBankEditId || ('pb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7)), question, duration };
  if (_popcornBankEditId) {
    const idx = _popcornBank.findIndex(x => x.id === _popcornBankEditId);
    if (idx >= 0) _popcornBank[idx] = item;
  } else {
    _popcornBank.push(item);
  }
  savePopcornBank();
  _popcornBankEditId = null;
  notify('✅ Question enregistrée dans la banque');
  renderPopcornBankTab(document.getElementById('ptab-body'));
}

// Lance une question de la banque immédiatement, à une personne tirée au sort équitablement.
function launchPopcornFromBank(id) {
  if (!MeetState.IS_HOST) return;
  const q = _popcornBank.find(x => x.id === id);
  if (!q) return;
  const target = popcornFairRandomPick(popcornGetParticipants());
  if (!target) { notify('⚠️ Aucun participant à interroger'); return; }
  document.getElementById('popcorn-launcher')?.remove();
  _popcornLastQuestion = q.question;
  MeetState.socket?.emit('popcorn_launch', {
    meetingId: MeetState.MEETING_ID,
    targetSocketId: target.id, targetName: target.name,
    question: q.question, duration: q.duration,
  });
  notify(`🍿 Question posée à ${target.name}`);
}

function popcornBankTriggerImport() {
  document.getElementById('popcorn-bank-file-input')?.click();
}

function handlePopcornBankFileImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const nameLC = file.name.toLowerCase();
  const isTsq  = nameLC.endsWith('.tsq');
  const isTxt  = nameLC.endsWith('.txt');
  if (!isTsq && !isTxt) { notify('⚠️ Fichier non reconnu — utilise un .txt ou un .tsq'); event.target.value = ''; return; }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = isTsq ? parsePopcornTsqFile(reader.result) : parsePopcornTxtFile(reader.result);
      if (!imported.length) { notify('⚠️ Aucune question valide trouvée dans ce fichier'); return; }
      imported.forEach(q => {
        q.id = 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        _popcornBank.push(q);
      });
      savePopcornBank();
      notify(`✅ ${imported.length} question(s) importée(s) dans la banque Popcorn`);
      renderPopcornBankTab(document.getElementById('ptab-body'));
    } catch (err) {
      notify('⚠️ Erreur de lecture du fichier : ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
  event.target.value = '';
}

// ── Format .txt (simple) ── Blocs séparés par "---". Clés : Q / DUREE
function parsePopcornTxtFile(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/^-{3,}\s*$/m).map(b => b.trim()).filter(Boolean);
  const out = [];
  blocks.forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let question = '', duration = 30;
    lines.forEach(line => {
      const m = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
      if (!m) return;
      const key = m[1].toUpperCase();
      const val = m[2].trim();
      if (key === 'Q') question = val;
      else if (key === 'DUREE' || key === 'DURATION') duration = parseInt(val) || 30;
    });
    if (question) out.push({ question, duration });
  });
  return out;
}

// ── Format .tsq (TechSphere Quiz — JSON) — type "popcorn" ───────────────────
function parsePopcornTsqFile(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.questions)) throw new Error('champ "questions" manquant dans le fichier .tsq');
  const out = [];
  data.questions.forEach(q => {
    if (q.question) out.push({ question: String(q.question), duration: Number.isFinite(q.duration) ? q.duration : 30 });
  });
  return out;
}

function downloadPopcornBankTemplate(type) {
  let content, filename, mime;
  if (type === 'tsq') {
    const template = {
      tsqVersion: 1, type: 'popcorn',
      title: 'Ma banque Popcorn',
      author: MeetState.displayName || 'Hôte',
      questions: [
        { question: 'Quelle est ta plus grande réussite ce trimestre ?', duration: 45 },
        { question: 'Cite un outil que tu utilises tous les jours.', duration: 20 },
      ],
    };
    content = JSON.stringify(template, null, 2);
    filename = 'modele-banque-popcorn.tsq';
    mime = 'application/json';
  } else {
    content = [
      'Q: Quelle est ta plus grande réussite ce trimestre ?',
      'DUREE: 45',
      '---',
      'Q: Cite un outil que tu utilises tous les jours.',
      'DUREE: 20',
    ].join('\n');
    filename = 'modele-banque-popcorn.txt';
    mime = 'text/plain';
  }
  _triggerFileDownload(content, filename, mime);
}


// ════════════════════════════════════════════════════════════════════════════
// LIVE QUIZ ⚡
// ════════════════════════════════════════════════════════════════════════════
let _quizTimer    = null;
let _quizVoted    = false;
let _quizScores   = {};

function openQuizCreator() {
  if (!MeetState.IS_HOST) return;
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
            <div style="font-size:11px;color:var(--muted);">Créer · Banque · Classement · Historique</div>
          </div>
        </div>
        <button onclick="document.getElementById('quiz-creator').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;">×</button>
      </div>

      <!-- Onglets -->
      <div style="display:flex;gap:0;padding:12px 22px 0;flex-shrink:0;">
        <button id="qtab-create"  onclick="quizCreatorTab('create')"  style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">✏️ Créer</button>
        <button id="qtab-bank"    onclick="quizCreatorTab('bank')"    style="flex:1;padding:8px 4px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">📚 Banque</button>
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
  ['create','bank','scores','history'].forEach(t => {
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
  if (tab === 'bank')    { loadQuizBank(); renderQuizBankTab(body); }
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
  const actionsBar = MeetState.IS_HOST ? `
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
  const actionsBar = MeetState.IS_HOST ? `
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


// BANQUE DE QUIZ (préprogrammation) 📚
// L'hôte prépare ses questions à l'avance (interface ou fichier .txt / .tsq)
// puis les lance en 1 clic pendant la réunion, sans retaper la question en live.
// ════════════════════════════════════════════════════════════════════════════
const QUIZ_BANK_KEY    = 'ts_quiz_bank_v1';
const QUIZ_BANK_COLORS = ['#f87171','#22c55e','#4db8d8','#a78bfa'];
let _quizBank       = [];
let _quizBankEditId = null; // null = nouvelle question, sinon id de la question éditée

function loadQuizBank() {
  try {
    const raw = localStorage.getItem(QUIZ_BANK_KEY);
    _quizBank = raw ? JSON.parse(raw) : [];
  } catch (_) { _quizBank = []; }
}

function saveQuizBank() {
  try { localStorage.setItem(QUIZ_BANK_KEY, JSON.stringify(_quizBank)); } catch (_) {}
}

// ── Lecture automatique de la banque (enchaînement des questions) ──────────
const QUIZ_BANK_REVIEW_DELAY = 5000; // pause entre la fin d'une question et le lancement de la suivante
let _quizBankAuto = {
  active:   false, // une séquence est en cours (lancée ou en pause)
  paused:   false, // enchaînement suspendu — ne lance pas la question suivante
  index:    0,     // index de la prochaine question à lancer
  inFlight: false, // une question est actuellement en train de tourner
  advanceTimer: null,
};

function quizBankRefreshIfOpen() {
  const activeBtn = document.getElementById('qtab-bank');
  if (activeBtn && activeBtn.style.color === 'var(--accent)') {
    const body = document.getElementById('qtab-body');
    if (body) renderQuizBankTab(body);
  }
  quizBankRenderWidget();
}

// Widget flottant : reste visible même quand la modale Live Quiz se ferme
// (elle se ferme à chaque lancement de question, comme pour un lancement manuel,
// pour laisser voir le vote en direct) — donc Pause/Continuer/Arrêter doivent
// rester accessibles ailleurs à l'écran pendant toute la séquence.
function quizBankRenderWidget() {
  const auto = _quizBankAuto;
  let el = document.getElementById('quiz-bank-widget');
  if (!MeetState.IS_HOST || !auto.active) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'quiz-bank-widget';
    el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9500;background:var(--bg2,#1a1a2e);border:1px solid rgba(167,139,250,.45);border-radius:12px;padding:9px 12px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;align-items:center;gap:8px;font-family:\'Sora\',sans-serif;';
    document.body.appendChild(el);
  }
  const playingNum = auto.inFlight ? auto.index : Math.min(auto.index + 1, _quizBank.length);
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;line-height:1.3;">
      <div style="font-size:11px;font-weight:800;color:#a78bfa;white-space:nowrap;">📚 Question ${playingNum}/${_quizBank.length}</div>
      <div style="font-size:9px;color:var(--muted,#9ca3af);white-space:nowrap;">${auto.paused?'⏸ En pause':(auto.inFlight?'● En cours':'⏳ Suivante bientôt')}</div>
    </div>
    ${auto.paused
      ? `<button onclick="quizBankResumeAutoPlay()" title="Continuer" style="padding:7px 11px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#15803d);color:white;font-size:12px;font-weight:800;cursor:pointer;">▶</button>`
      : `<button onclick="quizBankPauseAutoPlay()" title="Pause" style="padding:7px 11px;border-radius:8px;border:none;background:rgba(245,158,11,.9);color:white;font-size:12px;font-weight:800;cursor:pointer;">⏸</button>`}
    <button onclick="quizBankStopAutoPlay()" title="Arrêter" style="padding:7px 9px;border-radius:8px;border:1px solid rgba(248,113,113,.4);background:transparent;color:#f87171;font-size:11px;font-weight:700;cursor:pointer;">⏹</button>
  `;
}

function quizBankStartAutoPlay() {
  if (!MeetState.IS_HOST) return;
  if (!_quizBank.length) { notify("⚠️ La banque est vide — ajoute ou importe des questions d'abord"); return; }
  clearTimeout(_quizBankAuto.advanceTimer);
  _quizBankAuto = { active: true, paused: false, index: 0, inFlight: false, advanceTimer: null };
  quizBankLaunchNext();
}

function quizBankPauseAutoPlay() {
  if (!_quizBankAuto.active) return;
  _quizBankAuto.paused = true;
  clearTimeout(_quizBankAuto.advanceTimer);
  notify('⏸ Enchaînement en pause — la question en cours continue, la suivante attendra');
  quizBankRefreshIfOpen();
}

function quizBankResumeAutoPlay() {
  if (!_quizBankAuto.active) return;
  _quizBankAuto.paused = false;
  notify('▶ Enchaînement repris');
  if (!_quizBankAuto.inFlight) quizBankLaunchNext();
  else quizBankRefreshIfOpen();
}

function quizBankStopAutoPlay(silent) {
  clearTimeout(_quizBankAuto.advanceTimer);
  _quizBankAuto = { active: false, paused: false, index: 0, inFlight: false, advanceTimer: null };
  if (!silent) notify('⏹ Séquence de quiz arrêtée');
  quizBankRefreshIfOpen();
}

function quizBankLaunchNext() {
  if (!_quizBankAuto.active || _quizBankAuto.paused) return;
  if (_quizBankAuto.index >= _quizBank.length) {
    notify('🏁 Toutes les questions de la banque ont été posées');
    quizBankStopAutoPlay(true);
    return;
  }
  const q = _quizBank[_quizBankAuto.index];
  _quizBankAuto.index++;
  _quizBankAuto.inFlight = true;
  document.getElementById('quiz-creator')?.remove();
  _quizVoted = false;
  MeetState.socket?.emit('quiz_launch', {
    meetingId: MeetState.MEETING_ID,
    question: q.question, options: q.options, correctIdx: q.correctIdx,
    duration: q.duration, points: q.points, isBingo: q.isBingo, speedBonus: q.speedBonus,
  });
  quizBankRefreshIfOpen();
}

// Appelé quand les résultats d'une question arrivent (voir socket.on('quiz_results', ...))
// pour enchaîner automatiquement sur la question suivante de la banque.
function quizBankOnResults() {
  if (!_quizBankAuto.active) return;
  _quizBankAuto.inFlight = false;
  if (_quizBankAuto.paused) { quizBankRefreshIfOpen(); return; }
  clearTimeout(_quizBankAuto.advanceTimer);
  _quizBankAuto.advanceTimer = setTimeout(() => quizBankLaunchNext(), QUIZ_BANK_REVIEW_DELAY);
  quizBankRefreshIfOpen();
}

function renderQuizBankTab(body) {
  const auto = _quizBankAuto;
  const playingNum = auto.inFlight ? auto.index : Math.min(auto.index + 1, _quizBank.length);
  body.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
      <button onclick="quizBankNewQuestion()" ${auto.active?'disabled':''} style="flex:1;min-width:120px;padding:8px;border-radius:8px;border:none;background:linear-gradient(135deg,#a78bfa,#6d28d9);color:white;font-size:11px;font-weight:700;cursor:${auto.active?'not-allowed':'pointer'};opacity:${auto.active?'.5':'1'};font-family:'Sora',sans-serif;">+ Question</button>
      <button onclick="quizBankTriggerImport()" ${auto.active?'disabled':''} style="flex:1;min-width:120px;padding:8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:11px;font-weight:700;cursor:${auto.active?'not-allowed':'pointer'};opacity:${auto.active?'.5':'1'};font-family:'Sora',sans-serif;">📂 Importer un fichier</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <button onclick="downloadQuizBankTemplate('txt')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">⬇ Modèle .txt</button>
      <button onclick="downloadQuizBankTemplate('tsq')" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">⬇ Modèle .tsq</button>
      <input type="file" id="quiz-bank-file-input" accept=".txt,.tsq" style="display:none" onchange="handleQuizBankFileImport(event)">
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
      <b>.txt</b> : format simple à remplir à la main (Notepad).
      <b>.tsq</b> : format TechSphere Quiz (JSON), gère aussi le mode Bingo et le bonus de vitesse par question.
    </div>
    ${_quizBank.length ? `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;border-radius:10px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.25);">
      ${!auto.active ? `
        <button onclick="quizBankStartAutoPlay()" style="padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#a78bfa,#6d28d9);color:white;font-size:12px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">▶ Démarrer la séquence</button>
        <div style="font-size:10px;color:var(--muted);">Enchaîne les ${_quizBank.length} question(s) automatiquement</div>
      ` : `
        ${auto.paused
          ? `<button onclick="quizBankResumeAutoPlay()" style="padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#15803d);color:white;font-size:12px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">▶ Continuer</button>`
          : `<button onclick="quizBankPauseAutoPlay()" style="padding:8px 14px;border-radius:8px;border:none;background:rgba(245,158,11,.9);color:white;font-size:12px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">⏸ Pause</button>`}
        <button onclick="quizBankStopAutoPlay()" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(248,113,113,.4);background:transparent;color:#f87171;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">⏹ Arrêter</button>
        <div style="font-size:11px;font-weight:700;color:var(--text1);">Question ${playingNum}/${_quizBank.length} ${auto.paused?'· en pause':(auto.inFlight?'· en cours':'· suivante bientôt')}</div>
      `}
    </div>` : ''}
    <div id="quiz-bank-list">
      ${!_quizBank.length ? '<div style="padding:30px 10px;text-align:center;color:var(--muted);font-size:12px;">Banque vide. Ajoute une question ou importe un fichier .txt / .tsq.</div>' : _quizBank.map((q) => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid var(--border);margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(q.question)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${q.options.length} options · ${q.isBingo?'🎯 Bingo 20pts':q.points+'pt'} · ${q.duration}s${q.speedBonus?' · ⚡':''}</div>
          </div>
          <button ${auto.active?'disabled':`onclick="launchQuizFromBank('${q.id}')"`} title="Lancer maintenant" style="padding:6px 10px;border-radius:8px;border:none;background:rgba(34,197,94,.15);color:#22c55e;font-size:12px;font-weight:800;cursor:${auto.active?'not-allowed':'pointer'};opacity:${auto.active?'.4':'1'};font-family:'Sora',sans-serif;">▶</button>
          <button ${auto.active?'disabled':`onclick="quizBankEditQuestion('${q.id}')"`} title="Éditer" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;cursor:${auto.active?'not-allowed':'pointer'};opacity:${auto.active?'.4':'1'};">✎</button>
          <button ${auto.active?'disabled':`onclick="quizBankDeleteQuestion('${q.id}')"`} title="Supprimer" style="padding:6px 8px;border-radius:8px;border:1px solid rgba(248,113,113,.3);background:transparent;color:#f87171;font-size:11px;cursor:${auto.active?'not-allowed':'pointer'};opacity:${auto.active?'.4':'1'};">🗑</button>
        </div>`).join('')}
    </div>`;
}

function quizBankNewQuestion() {
  _quizBankEditId = null;
  renderQuizBankForm(document.getElementById('qtab-body'), null);
}

function quizBankEditQuestion(id) {
  const q = _quizBank.find(x => x.id === id);
  if (!q) return;
  _quizBankEditId = id;
  renderQuizBankForm(document.getElementById('qtab-body'), q);
}

function quizBankDeleteQuestion(id) {
  _quizBank = _quizBank.filter(x => x.id !== id);
  saveQuizBank();
  renderQuizBankTab(document.getElementById('qtab-body'));
}

function quizBankCancelForm() {
  renderQuizBankTab(document.getElementById('qtab-body'));
}

function renderQuizBankForm(body, existing) {
  const q = existing || { question:'', options:['','','',''], correctIdx:-1, points:1, duration:30, isBingo:false, speedBonus:false };
  body.innerHTML = `
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Question</label>
      <textarea id="qb-question" rows="2" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;resize:none;box-sizing:border-box;">${escHtml(q.question)}</textarea>
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Options (2 à 4)</label>
      ${[0,1,2,3].map(i=>`
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <div style="width:22px;height:22px;border-radius:6px;background:${QUIZ_BANK_COLORS[i]};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:white;flex-shrink:0;">${'ABCD'[i]}</div>
          <input id="qb-opt-${i}" type="text" value="${escHtml(q.options[i]||'')}" placeholder="${i<2?'Option '+(i+1)+' (obligatoire)':'Option '+(i+1)+' (optionnel)'}"
            style="flex:1;padding:7px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-size:12px;font-family:'Sora',sans-serif;outline:none;">
        </div>`).join('')}
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Bonne réponse</label>
      <div style="display:flex;gap:8px;">
        ${['A','B','C','D'].map((l,i)=>`<button type="button" id="qb-correct-${i}" onclick="_qbCorrectIdx=${i};document.querySelectorAll('[id^=qb-correct-]').forEach((b,j)=>{b.style.background=j===${i}?'rgba(34,197,94,.2)':'transparent';b.style.borderColor=j===${i}?'#22c55e':'var(--border)'})" style="flex:1;padding:7px;border-radius:7px;border:1px solid ${q.correctIdx===i?'#22c55e':'var(--border)'};background:${q.correctIdx===i?'rgba(34,197,94,.2)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${l}</button>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Points / mode</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        ${[1,2,3,5,10].map(p=>`<button type="button" onclick="_qbPoints=${p};_qbIsBingo=false;document.querySelectorAll('.qb-pt-btn').forEach(b=>{b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--text1)'});this.style.background='rgba(3,92,128,.3)';this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" class="qb-pt-btn" style="flex:1;min-width:40px;padding:7px;border-radius:7px;border:1px solid ${!q.isBingo && q.points===p?'var(--accent)':'var(--border)'};background:${!q.isBingo && q.points===p?'rgba(3,92,128,.3)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${p}pt</button>`).join('')}
        <button type="button" onclick="_qbPoints=20;_qbIsBingo=true;document.querySelectorAll('.qb-pt-btn').forEach(b=>{b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--text1)'});this.style.background='rgba(245,158,11,.25)';this.style.borderColor='#f59e0b';this.style.color='#f59e0b'" class="qb-pt-btn" style="flex:1;min-width:58px;padding:7px;border-radius:7px;border:1px solid ${q.isBingo?'#f59e0b':'var(--border)'};background:${q.isBingo?'rgba(245,158,11,.25)':'transparent'};color:var(--text1);font-size:11px;font-weight:800;cursor:pointer;font-family:'Sora',sans-serif;">🎯 Bingo</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,.02);">
        <input type="checkbox" id="qb-speed-bonus" ${q.speedBonus?'checked':''} style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer;">
        <div style="font-size:12px;font-weight:700;color:var(--text1);">⚡ Bonus rapidité</div>
      </label>
    </div>
    <div style="margin-bottom:20px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;text-transform:uppercase;">Durée</label>
      <div style="display:flex;gap:8px;">
        ${[15,20,30,45].map(s=>`<button type="button" onclick="document.getElementById('qb-duration').value=${s};this.parentElement.querySelectorAll('button').forEach(b=>{b.style.cssText='flex:1;padding:7px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:Sora,sans-serif;'});this.style.background='rgba(3,92,128,.3)';this.style.borderColor='var(--accent)'" style="flex:1;padding:7px;border-radius:7px;border:1px solid ${q.duration===s?'var(--accent)':'var(--border)'};background:${q.duration===s?'rgba(3,92,128,.3)':'transparent'};color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">${s}s</button>`).join('')}
        <input type="hidden" id="qb-duration" value="${q.duration}">
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="quizBankCancelForm()" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text1);font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">Annuler</button>
      <button onclick="quizBankSaveQuestion()" style="flex:2;padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#a78bfa,#6d28d9);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">💾 Enregistrer dans la banque</button>
    </div>`;
  _qbCorrectIdx = q.correctIdx;
  _qbPoints     = q.isBingo ? 20 : q.points;
  _qbIsBingo    = q.isBingo;
}

function quizBankSaveQuestion() {
  const question = document.getElementById('qb-question')?.value.trim();
  if (!question) { notify('Écris une question !'); return; }

  const allOpts = [0,1,2,3].map(i => document.getElementById('qb-opt-'+i)?.value.trim());
  const options = allOpts.filter(Boolean);
  if (options.length < 2) { notify('Ajoute au moins 2 options'); return; }

  const correctIdx = (typeof _qbCorrectIdx !== 'undefined') ? _qbCorrectIdx : -1;
  if (correctIdx < 0 || !allOpts[correctIdx]) {
    notify('⚠️ Sélectionne la bonne réponse (A/B/C/D) — elle doit correspondre à une option remplie');
    return;
  }

  const points      = (typeof _qbPoints  !== 'undefined') ? _qbPoints  : 1;
  const isBingo     = (typeof _qbIsBingo !== 'undefined') ? _qbIsBingo : false;
  const speedBonus  = document.getElementById('qb-speed-bonus')?.checked || false;
  const duration    = parseInt(document.getElementById('qb-duration')?.value) || 30;

  const item = {
    id: _quizBankEditId || ('qb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7)),
    question, options, correctIdx, points, duration, isBingo, speedBonus,
  };

  if (_quizBankEditId) {
    const idx = _quizBank.findIndex(x => x.id === _quizBankEditId);
    if (idx >= 0) _quizBank[idx] = item;
  } else {
    _quizBank.push(item);
  }
  saveQuizBank();
  _quizBankEditId = null;
  notify('✅ Question enregistrée dans la banque');
  renderQuizBankTab(document.getElementById('qtab-body'));
}

// Lance directement une question préprogrammée, sans repasser par la modale de création.
function launchQuizFromBank(id) {
  if (!MeetState.IS_HOST) return;
  const q = _quizBank.find(x => x.id === id);
  if (!q) return;
  document.getElementById('quiz-creator')?.remove();
  _quizVoted = false;
  MeetState.socket?.emit('quiz_launch', {
    meetingId: MeetState.MEETING_ID,
    question: q.question, options: q.options, correctIdx: q.correctIdx,
    duration: q.duration, points: q.points, isBingo: q.isBingo, speedBonus: q.speedBonus,
  });
}

function quizBankTriggerImport() {
  document.getElementById('quiz-bank-file-input')?.click();
}

function handleQuizBankFileImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const nameLC = file.name.toLowerCase();
  const isTsq  = nameLC.endsWith('.tsq');
  const isTxt  = nameLC.endsWith('.txt');
  if (!isTsq && !isTxt) {
    notify('⚠️ Fichier non reconnu — utilise un .txt ou un .tsq');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = isTsq ? parseTsqQuizFile(reader.result) : parseTxtQuizFile(reader.result);
      if (!imported.length) { notify('⚠️ Aucune question valide trouvée dans ce fichier'); return; }
      imported.forEach(q => {
        q.id = 'qb_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        _quizBank.push(q);
      });
      saveQuizBank();
      notify(`✅ ${imported.length} question(s) importée(s) dans la banque`);
      renderQuizBankTab(document.getElementById('qtab-body'));
    } catch (err) {
      notify('⚠️ Erreur de lecture du fichier : ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
  event.target.value = '';
}

// ── Format .txt (simple, remplissable à la main) ───────────────────────────
// Blocs séparés par une ligne "---". Clés : Q / A / B / C / D / CORRECT / POINTS / DUREE
function parseTxtQuizFile(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/^-{3,}\s*$/m).map(b => b.trim()).filter(Boolean);
  const out = [];
  blocks.forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let question = '', options = [], correctLetter = '', points = 1, duration = 30;
    lines.forEach(line => {
      const m = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
      if (!m) return;
      const key = m[1].toUpperCase();
      const val = m[2].trim();
      if (key === 'Q') question = val;
      else if (['A','B','C','D'].includes(key)) options[['A','B','C','D'].indexOf(key)] = val;
      else if (key === 'CORRECT') correctLetter = val.toUpperCase();
      else if (key === 'POINTS') points = parseInt(val) || 1;
      else if (key === 'DUREE' || key === 'DURATION') duration = parseInt(val) || 30;
    });
    options = options.filter(Boolean);
    const correctIdx = ['A','B','C','D'].indexOf(correctLetter);
    if (question && options.length >= 2 && correctIdx >= 0 && correctIdx < options.length) {
      out.push({ question, options, correctIdx, points, duration, isBingo: false, speedBonus: false });
    }
  });
  return out;
}

// ── Format .tsq (TechSphere Quiz — JSON structuré, gère Bingo + bonus vitesse) ──
function parseTsqQuizFile(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.questions)) {
    throw new Error('champ "questions" manquant dans le fichier .tsq');
  }
  const out = [];
  data.questions.forEach(q => {
    const options    = Array.isArray(q.options) ? q.options.map(o => String(o||'').trim()).filter(Boolean) : [];
    const correctIdx = Number.isInteger(q.correctIdx) ? q.correctIdx : -1;
    if (q.question && options.length >= 2 && correctIdx >= 0 && correctIdx < options.length) {
      out.push({
        question:   String(q.question),
        options,
        correctIdx,
        points:     Number.isFinite(q.points)   ? q.points   : 1,
        duration:   Number.isFinite(q.duration) ? q.duration : 30,
        isBingo:    !!q.isBingo,
        speedBonus: !!q.speedBonus,
      });
    }
  });
  return out;
}

// Téléchargement robuste et générique (utilisé par la banque de quiz ET la banque Popcorn) :
// Blob → si bloqué, lien data: → si bloqué aussi, nouvel onglet pour copier/coller.
function _triggerFileDownload(content, filename, mime) {
  try {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    notify('⬇ Téléchargement de ' + filename);
  } catch (err1) {
    try {
      const a = document.createElement('a');
      a.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content);
      a.download = filename; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      notify('⬇ Téléchargement de ' + filename);
    } catch (err2) {
      console.error('[Download] Téléchargement impossible :', err1, err2);
      const win = window.open('', '_blank');
      if (win && win.document) {
        win.document.title = filename;
        win.document.body.style.cssText = 'background:#111;color:#eee;font-family:monospace;padding:20px;';
        win.document.body.innerHTML = '<p>Ton navigateur bloque le téléchargement direct. Copie ce contenu (Ctrl+A puis Ctrl+C) et colle-le dans un fichier nommé <b>' + filename + '</b> :</p><pre style="white-space:pre-wrap;">' + content.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
        notify('⚠️ Téléchargement direct bloqué — contenu ouvert dans un nouvel onglet');
      } else {
        notify('❌ Le navigateur bloque à la fois le téléchargement et les popups. Autorise les popups pour ce site puis réessaie.');
      }
    }
  }
}

function downloadQuizBankTemplate(type) {
  let content, filename, mime;
  if (type === 'tsq') {
    const template = {
      tsqVersion: 1,
      title: "Ma banque de quiz",
      author: MeetState.displayName || "Hôte",
      questions: [
        { question: "Quelle est la capitale de la France ?", options: ["Paris","Lyon","Marseille","Nice"], correctIdx: 0, points: 2, duration: 30, isBingo: false, speedBonus: true },
        { question: "2 + 2 = ?", options: ["3","4","5"], correctIdx: 1, points: 1, duration: 15, isBingo: false, speedBonus: false },
      ],
    };
    content  = JSON.stringify(template, null, 2);
    filename = 'modele-banque-quiz.tsq';
    mime     = 'application/json';
  } else {
    content = [
      'Q: Quelle est la capitale de la France ?',
      'A: Paris', 'B: Lyon', 'C: Marseille', 'D: Nice',
      'CORRECT: A', 'POINTS: 2', 'DUREE: 30',
      '---',
      'Q: 2 + 2 = ?',
      'A: 3', 'B: 4', 'C: 5',
      'CORRECT: B', 'POINTS: 1', 'DUREE: 15',
    ].join('\n');
    filename = 'modele-banque-quiz.txt';
    mime     = 'text/plain';
  }
  _triggerFileDownload(content, filename, mime);
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
  const isHost  = MeetState.IS_HOST;
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
        <button id="qopt-${i}" onclick="submitQuizVote(${i},'${q.id}')" ${isHost?'disabled':''} style="padding:12px;border-radius:10px;border:2px solid ${colors[i]}33;background:${colors[i]}11;color:var(--text1);font-size:12px;font-weight:700;cursor:${isHost?'default':'pointer'};font-family:'Sora',sans-serif;text-align:left;transition:all .15s;display:flex;align-items:center;gap:8px;">
          <span style="width:22px;height:22px;border-radius:6px;background:${colors[i]};display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:white;flex-shrink:0;">${'ABCD'[i]}</span>
          <span>${escHtml(opt)}</span>
        </button>`).join('')}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
      <div id="quiz-vote-count" style="font-size:11px;color:var(--muted);">0 vote</div>
      ${MeetState.IS_HOST?`<button onclick="openQuizLeaderboard()" style="padding:4px 10px;border-radius:20px;border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.1);color:#f59e0b;font-size:11px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;">🏆 Classement</button>`:''}
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
    const ctx = getSharedAudioCtx();
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
                ${MeetState.IS_HOST?`<button onclick="quizApplaud('${escHtml(s.name)}')" style="padding:3px 8px;border-radius:20px;border:none;background:rgba(245,158,11,.15);color:#f59e0b;font-size:12px;cursor:pointer;" title="Applaudir">👏</button>`:''}
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
  const lines  = _quizLiveLeaderboard.map((s,i) => medals[i] + ' ' + s.name + ' — ' + s.total + ' pts');
  if (format === 'txt') {
    _quizDownload('classement_quiz.txt', [
      '=== CLASSEMENT QUIZ — ' + new Date().toLocaleString('fr-FR') + ' ===', '',
      ...lines, '', 'Réunion : ' + (MeetState.MEETING_ID || ''),
    ].join('\n'), 'text/plain');
  } else {
    _quizDownloadPDF('classement_quiz.pdf', '🏆 Classement Quiz', [{ lines }]);
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
    const sections = _quizHistory.map((q, i) => {
      const total = q.votes.reduce((a,b)=>a+b,0)||1;
      const heading = 'Q' + (i+1) + ' [' + (q.ts||'') + '] ' + (q.isBingo?'BINGO · ':'') + '(' + q.points + 'pt) — ' + q.question;
      const lines = q.options.map((opt, oi) => {
        const pct  = Math.round(q.votes[oi]/total*100);
        const ok   = oi === q.correctIdx;
        let line = 'ABCD'[oi] + '. ' + opt + ' — ' + q.votes[oi] + ' vote(s) (' + pct + '%)' + (ok ? ' ✓ Bonne réponse' : '');
        if (q.voterNames[oi]?.length) line += '  [' + q.voterNames[oi].join(', ') + ']';
        return line;
      });
      return { heading, lines };
    });
    _quizDownloadPDF('historique_quiz.pdf', '📋 Historique Quiz', sections);
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

// Génère un vrai fichier PDF téléchargeable (jsPDF, déjà chargé pour l'export du tableau blanc)
// sections: [{ heading?: string, lines: string[] }]
function _quizDownloadPDF(filename, title, sections) {
  try {
    const jspdf = window.jspdf;
    if (!jspdf?.jsPDF) throw new Error('jsPDF absent');
    const pdf = new jspdf.jsPDF('portrait', 'pt', 'a4');
    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    let y = 54;

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(109, 40, 217);
    pdf.text(title, margin, y); y += 18;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(107, 114, 128);
    pdf.text(new Date().toLocaleString('fr-FR') + '  ·  Réunion : ' + (MeetState.MEETING_ID || ''), margin, y); y += 16;
    pdf.setDrawColor(229, 231, 235); pdf.line(margin, y, pageWidth - margin, y); y += 22;

    const ensureSpace = (needed) => {
      if (y + needed > pageHeight - margin) { pdf.addPage(); y = margin + 14; }
    };

    sections.forEach(section => {
      if (section.heading) {
        ensureSpace(20);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(17, 24, 39);
        const wrappedHeading = pdf.splitTextToSize(section.heading, pageWidth - margin * 2);
        wrappedHeading.forEach(w => { ensureSpace(14); pdf.text(w, margin, y); y += 14; });
        y += 2;
      }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(55, 65, 81);
      section.lines.forEach(line => {
        const wrapped = pdf.splitTextToSize(String(line), pageWidth - margin * 2 - 10);
        wrapped.forEach(w => { ensureSpace(14); pdf.text(w, margin + 10, y); y += 14; });
      });
      y += 10;
    });

    pdf.save(filename);
    notify('⬇ ' + filename + ' téléchargé');
  } catch (err) {
    console.error('[Quiz] Export PDF impossible :', err);
    notify("⚠️ Export PDF indisponible (module PDF non chargé) — utilise l'export .txt en attendant");
  }
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
    const ctx = getSharedAudioCtx();
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
