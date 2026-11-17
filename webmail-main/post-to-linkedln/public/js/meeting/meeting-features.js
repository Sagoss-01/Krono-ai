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
let wbDrawing_ = false;
let wbStart_   = null;
let wbSelectedObj  = null;
let wbDragging_    = false;
let wbDragOffset_  = null;
let wbResizing_    = false;
let wbResizeHandle_= null;
let wbCurrentStroke_ = null;
const WB_MAX_HISTORY = 30;
const WB_HANDLE_NAMES = ['tl','tc','tr','ml','mr','bl','bc','br'];

// ── Stickers draw functions ────────────────────────────────────────────────
// draw(ctx, x, y, w, h, color, props)
const WB_STICKERS = {
  btn:       (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=c+'22';ctx.beginPath();ctx.roundRect(x,y,w,h,6);ctx.fill();ctx.stroke();ctx.fillStyle=c;ctx.font=`bold ${Math.min(h*.45,14)}px Sora,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.label||'Button',x+w/2,y+h/2); },
  input:     (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.strokeRect(x,y,w,h);ctx.fillStyle=c+'66';ctx.font=`${Math.min(h*.5,12)}px Sora,sans-serif`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(p.placeholder||'Placeholder…',x+8,y+h/2); },
  card:      (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=c+'0d';ctx.beginPath();ctx.roundRect(x,y,w,h,8);ctx.fill();ctx.stroke();ctx.strokeRect(x+8,y+8,w-16,h*.4);ctx.fillStyle=c;ctx.font='bold 13px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.title||'Titre',x+w/2,y+h*.65);ctx.font='11px Sora,sans-serif';ctx.fillStyle=c+'99';ctx.fillText(p.subtitle||'Sous-titre',x+w/2,y+h*.8); },
  avatar:    (ctx,x,y,w,h,c,p={}) => { const cx=x+w/2,cy=y+h/2,r=Math.min(w,h)*.22;ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy-h*.1,r,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(cx,cy+h*.5,r*1.4,Math.PI,0);ctx.stroke(); },
  image:     (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x+w*.3,y+h*.6);ctx.lineTo(x+w*.55,y+h*.75);ctx.lineTo(x+w*.75,y+h*.45);ctx.lineTo(x+w,y+h);ctx.stroke();ctx.beginPath();ctx.arc(x+w*.75,y+h*.28,Math.min(w,h)*.1,0,Math.PI*2);ctx.stroke(); },
  nav:       (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.fillStyle=c+'11';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.fillStyle=c;ctx.font='bold 12px Sora,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(p.brand||'Brand',x+10,y+h/2);['Accueil','À propos','Contact'].forEach((t,i)=>{ctx.font='11px Sora,sans-serif';ctx.textAlign='right';ctx.fillText(t,x+w-10-i*65,y+h/2);}); },
  table:     (ctx,x,y,w,h,c,p={}) => { const rows=p.rows||4,cols=p.cols||3,cw=w/cols,rh=h/rows;ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.fillStyle=c+'22';ctx.fillRect(x,y,w,rh);ctx.strokeRect(x,y,w,h);for(let r=1;r<=rows;r++){ctx.beginPath();ctx.moveTo(x,y+r*rh);ctx.lineTo(x+w,y+r*rh);ctx.stroke();}for(let cl=1;cl<cols;cl++){ctx.beginPath();ctx.moveTo(x+cl*cw,y);ctx.lineTo(x+cl*cw,y+h);ctx.stroke();} },
  modal:     (ctx,x,y,w,h,c,p={}) => { ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(x-8,y-8,w+16,h+16);ctx.fillStyle=c+'ee';ctx.beginPath();ctx.roundRect(x,y,w,h,10);ctx.fill();ctx.strokeStyle=c;ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=c;ctx.font='bold 13px Sora,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.title||'Modal',x+w/2,y+h*.18);ctx.fillStyle=c+'44';ctx.fillRect(x+8,y+h*.33,w-16,h*.35);const bw=Math.min(80,w*.35);[x+w/2-bw-4,x+w/2+4].forEach((bx,i)=>{ctx.fillStyle=i===0?c+'22':c;ctx.beginPath();ctx.roundRect(bx,y+h*.78,bw,h*.14,4);ctx.fill();ctx.stroke();}); },
  chart:     (ctx,x,y,w,h,c,p={}) => { ctx.strokeStyle=c;ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);const vals=[.6,.4,.75,.5,.65,.45],bw=(w-16)/(vals.length*1.5);vals.forEach((v,i)=>{const bh=v*(h-20),bx=x+8+i*bw*1.5;ctx.fillStyle=c+(i%2===0?'cc':'66');ctx.fillRect(bx,y+h-10-bh,bw,bh);}); },
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
};

const WB_STICKER_PROPS = {
  btn:{label:'Button'}, input:{placeholder:'Saisir…'}, card:{title:'Titre',subtitle:'Sous-titre'},
  avatar:{}, image:{}, nav:{brand:'Brand'}, table:{rows:4,cols:3}, modal:{title:'Modal'},
  chart:{}, toggle:{on:true}, badge:{label:'Badge'},
  desktop:{res:'1920×1080'}, laptop:{res:'1440×900'}, mobile:{res:'390×844'},
  tablet:{res:'768×1024'}, browser:{url:'https://example.com'},
  container:{label:'Container'}, section:{label:'Section'},
  grid2:{}, grid3:{}, flexrow:{items:4},
};

// Coord helpers
function toNorm(px,py){ return {x:px/MeetState.wbCanvas.width, y:py/MeetState.wbCanvas.height}; }
function fromNorm(nx,ny){ return {x:nx*MeetState.wbCanvas.width, y:ny*MeetState.wbCanvas.height}; }

// Redessiner tout
function wbRedraw() {
  if (!MeetState.wbCtx) return;
  const ctx = MeetState.wbCtx;
  ctx.fillStyle = wbBgColor_; ctx.fillRect(0,0,MeetState.wbCanvas.width,MeetState.wbCanvas.height);
  wbObjects.forEach(o => wbDrawObject(ctx,o));
  if (wbSelectedObj) { const o=wbObjects.find(x=>x.id===wbSelectedObj); if(o) wbDrawSelection(ctx,o); }
}

function wbDrawObject(ctx,obj) {
  ctx.save();
  if (obj.type==='stroke') {
    ctx.strokeStyle=obj.color; ctx.lineWidth=obj.size; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath();
    obj.points.forEach((p,i)=>{ const r=fromNorm(p.x,p.y); i===0?ctx.moveTo(r.x,r.y):ctx.lineTo(r.x,r.y); });
    ctx.stroke();
  } else if (obj.type==='shape') {
    const a=fromNorm(obj.x1,obj.y1),b=fromNorm(obj.x2,obj.y2);
    ctx.strokeStyle=obj.color; ctx.fillStyle=obj.color+'33'; ctx.lineWidth=obj.size; ctx.lineCap='round';
    ctx.beginPath();
    if(obj.shape==='line'){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    else if(obj.shape==='rect'){ctx.roundRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y),obj.radius||0);ctx.fill();ctx.stroke();}
    else if(obj.shape==='circle'){const rx=(b.x-a.x)/2,ry=(b.y-a.y)/2;ctx.ellipse(a.x+rx,a.y+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    else if(obj.shape==='triangle'){ctx.moveTo((a.x+b.x)/2,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(a.x,b.y);ctx.closePath();ctx.fill();ctx.stroke();}
    else if(obj.shape==='arrow'){const ang=Math.atan2(b.y-a.y,b.x-a.x),l=20,s=.4;ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-l*Math.cos(ang-s),b.y-l*Math.sin(ang-s));ctx.lineTo(b.x-l*Math.cos(ang+s),b.y-l*Math.sin(ang+s));ctx.closePath();ctx.fillStyle=obj.color;ctx.fill();}
  } else if (obj.type==='text') {
    const p=fromNorm(obj.x,obj.y); ctx.fillStyle=obj.color; ctx.font=`${obj.size*5}px Sora,sans-serif`; ctx.textBaseline='top'; ctx.fillText(obj.text,p.x,p.y);
  } else if (obj.type==='sticker') {
    const a=fromNorm(obj.x,obj.y),b=fromNorm(obj.x2,obj.y2);
    const fn=WB_STICKERS[obj.sticker]; if(fn) fn(ctx,a.x,a.y,b.x-a.x,b.y-a.y,obj.color,obj.props||{});
  }
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
    ctx.font=`${obj.bold?'bold ':''}${obj.size*5}px Sora,sans-serif`;
    const m=ctx.measureText(obj.text);
    return{x:p.x,y:p.y,w:m.width||60,h:obj.size*5};
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
  for(let i=wbObjects.length-1;i>=0;i--){
    const o=wbObjects[i];
    if(o.type==='sticker'||o.type==='shape'){
      const ax=o.type==='sticker'?o.x:o.x1,ay=o.type==='sticker'?o.y:o.y1,bx=o.x2,by=o.y2;
      const a=fromNorm(ax,ay),b=fromNorm(bx,by);
      if(px>=Math.min(a.x,b.x)-8&&px<=Math.max(a.x,b.x)+8&&py>=Math.min(a.y,b.y)-8&&py<=Math.max(a.y,b.y)+8) return o;
    } else if(o.type==='text'){
      const p=fromNorm(o.x,o.y);
      if(px>=p.x-8&&px<=p.x+200&&py>=p.y-8&&py<=p.y+32) return o;
    }
  }
  return null;
}

// Panneau propriétés
function showWbProperties(obj) {
  // Mettre à jour les inputs W/H dans la toolbar
  const bb=wbGetBBox(obj);
  const wi=document.getElementById('wb-w-input'), hi=document.getElementById('wb-h-input');
  if(wi&&bb) wi.value=Math.round(bb.w);
  if(hi&&bb) hi.value=Math.round(bb.h);
  let panel=document.getElementById('wb-props-panel');
  if(!panel){
    panel=document.createElement('div'); panel.id='wb-props-panel';
    panel.style.cssText='position:absolute;right:0;top:0;bottom:0;width:220px;background:var(--bg2);border-left:1px solid var(--border);overflow-y:auto;z-index:20;font-family:Sora,sans-serif;box-shadow:-4px 0 16px rgba(0,0,0,.3);';
    document.getElementById('whiteboard-modal').querySelector('div[style*="flex:1"]').appendChild(panel);
  }
  const fields=getPropsFields(obj);
  panel.innerHTML=`
    <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);">
      <div style="font-size:12px;font-weight:800;color:var(--text1);">Propriétés</div>
      <button onclick="MeetApp.hideWbProperties()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;">×</button>
    </div>
    <div style="padding:10px 12px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">${obj.type} ${obj.sticker?'· '+obj.sticker:''}</div>
      ${fields.map(f=>`<div style="margin-bottom:10px;"><label style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">${f.label}</label>${renderPropField(f,obj)}</div>`).join('')}
      <div style="margin-top:12px;display:flex;gap:5px;">
        <button onclick="MeetApp.wbDuplicateObj('${obj.id}')" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;font-weight:600;cursor:pointer;font-family:Sora,sans-serif;">⊕ Dupliquer</button>
        <button onclick="MeetApp.wbDeleteObj('${obj.id}')" style="flex:1;padding:6px;border-radius:6px;border:none;background:rgba(248,113,113,0.12);color:var(--red);font-size:10px;font-weight:600;cursor:pointer;font-family:Sora,sans-serif;">✕ Supprimer</button>
      </div>
      <div style="margin-top:5px;display:flex;gap:5px;">
        <button onclick="MeetApp.wbBringFront('${obj.id}')" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;cursor:pointer;font-family:Sora,sans-serif;">↑ Avant-plan</button>
        <button onclick="MeetApp.wbSendBack('${obj.id}')" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;cursor:pointer;font-family:Sora,sans-serif;">↓ Arrière-plan</button>
      </div>
    </div>`;
}

function renderPropField(f,obj) {
  const val=f.path.split('.').reduce((o,k)=>o?.[k],obj)??f.default??'';
  const s='width:100%;padding:5px 7px;border-radius:6px;border:1px solid var(--border);background:rgba(0,0,0,0.2);color:var(--text1);font-size:11px;font-family:Sora,sans-serif;outline:none;box-sizing:border-box;';
  if(f.type==='color') return `<input type="color" value="${val||'#4db8d8'}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value)" style="width:100%;height:30px;border-radius:6px;border:1px solid var(--border);cursor:pointer;padding:2px;">`;
  if(f.type==='number') {
    const v=parseFloat(val)||0;
    return `<div style="display:flex;align-items:center;gap:6px;"><input type="range" min="${f.min||0}" max="${f.max||100}" step="${f.step||1}" value="${v}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',parseFloat(this.value));this.nextElementSibling.textContent=this.value" style="flex:1;accent-color:#4db8d8;cursor:pointer;"><span style="font-size:11px;color:var(--text1);min-width:26px;text-align:right;font-weight:700;">${v}</span></div>`;
  }
  if(f.type==='checkbox') return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 0;"><input type="checkbox" ${val?'checked':''} onchange="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.checked)" style="width:15px;height:15px;accent-color:#4db8d8;cursor:pointer;"><span style="font-size:11px;color:var(--text2);">${val?'Oui':'Non'}</span></label>`;
  if(f.type==='select') return `<select oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value)" style="${s}">${(f.opts||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}</select>`;
  return `<input type="text" value="${String(val).replace(/"/g,'&quot;')}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value)" style="${s}" placeholder="${f.placeholder||''}">`;
}

function getPropsFields(obj) {
  // Dimensions actuelles (lecture seule en header du panel, modifiables via toolbar W/H)
  const bb = wbGetBBox(obj);
  const base=[
    {label:'Couleur accent', path:'color',   type:'color'},
    {label:'Épaisseur trait',path:'size',    type:'number', min:0, max:40, step:1},
    {label:'Opacité %',      path:'opacity', type:'number', min:10, max:100, step:5},
  ];
  const byS={
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
    ],
    card:[
      {label:'Titre',        path:'props.title',    type:'text'},
      {label:'Sous-titre',   path:'props.subtitle', type:'text'},
      {label:'Texte bouton', path:'props.btnLabel', type:'text'},
      {label:'Rayon',        path:'props.radius',   type:'number', min:0, max:30},
    ],
    nav:[
      {label:'Marque / Logo',    path:'props.brand', type:'text'},
      {label:'Liens (virgule)',   path:'props.items', type:'text'},
      {label:'Bouton CTA',       path:'props.cta',   type:'text'},
    ],
    table:[
      {label:'Lignes',           path:'props.rows',    type:'number', min:1, max:20},
      {label:'Colonnes',         path:'props.cols',    type:'number', min:1, max:10},
      {label:'En-têtes (virgule)',path:'props.headers', type:'text'},
      {label:'Lignes alternées', path:'props.altRow',  type:'checkbox'},
    ],
    modal:[
      {label:'Titre',         path:'props.title',       type:'text'},
      {label:'Contenu',       path:'props.bodyText',    type:'text'},
      {label:'Bouton annuler',path:'props.cancelLabel', type:'text'},
      {label:'Bouton valider',path:'props.okLabel',     type:'text'},
      {label:'Rayon',         path:'props.radius',      type:'number', min:0, max:30},
    ],
    chart:[
      {label:'Titre du graphique',path:'props.title',     type:'text'},
      {label:'Type',              path:'props.chartType', type:'select', opts:['bar','line','pie']},
      {label:'Nb de valeurs',     path:'props.bars',      type:'number', min:2, max:7},
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
      {label:'Labels (virgule)',path:'props.labels',type:'text'},
    ],
    grid2:[{label:'Label col 1',path:'props.col1',type:'text'},{label:'Label col 2',path:'props.col2',type:'text'}],
    grid3:[],avatar:[],image:[{label:'Légende',path:'props.caption',type:'text'}],
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
    {label:'Texte',                 path:'text',        type:'text'},
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

function wbUpdateProp(id,path,value) {
  const obj=wbObjects.find(o=>o.id===id); if(!obj) return;
  const keys=path.split('.');let t=obj;
  for(let i=0;i<keys.length-1;i++){if(!t[keys[i]])t[keys[i]]={};t=t[keys[i]];}
  t[keys[keys.length-1]]=value;
  wbRedraw(); wbSaveHistory(); wbSyncAll();
  showWbProperties(obj); // refresh panel
}

function wbDeleteObj(id) {
  wbObjects=wbObjects.filter(o=>o.id!==id); wbSelectedObj=null;
  hideWbProperties(); wbRedraw(); wbSaveHistory(); wbSyncAll();
}

function wbDuplicateObj(id) {
  const obj=wbObjects.find(o=>o.id===id); if(!obj) return;
  const copy=JSON.parse(JSON.stringify(obj)); copy.id='obj_'+Date.now();
  const off=0.03;
  if(copy.x!==undefined){copy.x+=off;copy.y+=off;}
  if(copy.x1!==undefined){copy.x1+=off;copy.y1+=off;copy.x2+=off;copy.y2+=off;}
  else if(copy.x2!==undefined){copy.x2+=off;}
  wbObjects.push(copy); wbSelectedObj=copy.id;
  wbRedraw(); wbSaveHistory(); wbSyncAll();
}

function wbBringFront(id) {
  const i=wbObjects.findIndex(o=>o.id===id); if(i<wbObjects.length-1){wbObjects.push(wbObjects.splice(i,1)[0]);wbRedraw();wbSyncAll();}
}

function wbSendBack(id) {
  const i=wbObjects.findIndex(o=>o.id===id); if(i>0){wbObjects.unshift(wbObjects.splice(i,1)[0]);wbRedraw();wbSyncAll();}
}

function hideWbProperties() {
  document.getElementById('wb-props-panel')?.remove(); wbSelectedObj=null; wbRedraw();
}

function toggleWhiteboard() {
  const modal=document.getElementById('whiteboard-modal');
  const btn=document.getElementById('btn-whiteboard'); if(!modal) return;
  if(modal.classList.contains('open')){
    modal.classList.remove('open'); if(btn) btn.className='ctrl-btn active';
    document.removeEventListener('keydown',wbKeyHandler);
  } else {
    modal.classList.add('open'); if(btn) btn.className='ctrl-btn wb-on';
    initWhiteboard(); document.addEventListener('keydown',wbKeyHandler);
  }
}

function wbKeyHandler(e) {
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();wbUndo();}
  if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();wbRedo();}
  if((e.key==='Delete'||e.key==='Backspace')&&wbSelectedObj&&document.activeElement===document.body){
    wbDeleteObj(wbSelectedObj);
  }
}

function initWhiteboard() {
  if(MeetState.wbCanvas){wbRedraw();return;}
  MeetState.wbCanvas=document.getElementById('wb-canvas');
  MeetState.wbCtx=MeetState.wbCanvas.getContext('2d',{willReadFrequently:true});
  const resize=()=>{ MeetState.wbCanvas.width=MeetState.wbCanvas.offsetWidth; MeetState.wbCanvas.height=MeetState.wbCanvas.offsetHeight; wbRedraw(); };
  resize(); window.addEventListener('resize',resize); wbSaveHistory();

  const getPos=e=>{ const r=MeetState.wbCanvas.getBoundingClientRect(),t=e.touches?.[0]||e; return {x:t.clientX-r.left,y:t.clientY-r.top}; };

  MeetState.wbCanvas.addEventListener('pointerdown',e=>{
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
        wbSelectedObj=found.id; wbDragging_=true; showWbProperties(found);
        const bb=wbGetBBox(found);
        wbDragOffset_={dx:pos.x-(bb?.x||0),dy:pos.y-(bb?.y||0)};
      } else { wbSelectedObj=null; wbDragging_=false; hideWbProperties(); }
      wbRedraw(); return;
    }
    wbDrawing_=true;
    if(['pen','highlighter','eraser'].includes(wbTool_)){
      const id='obj_'+Date.now();
      const color=wbTool_==='eraser'?wbBgColor_:wbTool_==='highlighter'?wbColor_+'55':wbColor_;
      wbCurrentStroke_={id,type:'stroke',color,size:wbTool_==='eraser'?wbSize_*4:wbTool_==='highlighter'?wbSize_*4:wbSize_,points:[toNorm(pos.x,pos.y)]};
      wbObjects.push(wbCurrentStroke_);
    }
  });

  MeetState.wbCanvas.addEventListener('pointermove',e=>{
    const pos=getPos(e);
    // Curseur adaptatif en mode select (même sans drag)
    if(wbTool_==='select'&&!wbDrawing_&&!wbDragging_&&!wbResizing_){
      if(wbSelectedObj){
        const selObj=wbObjects.find(o=>o.id===wbSelectedObj);
        const h=selObj?wbHitHandle(selObj,pos.x,pos.y):null;
        MeetState.wbCanvas.style.cursor=h?WB_RESIZE_CURSORS[h]:wbHitTest(pos.x,pos.y)?'move':'default';
      } else {
        MeetState.wbCanvas.style.cursor=wbHitTest(pos.x,pos.y)?'move':'default';
      }
    }
    if(!wbDrawing_&&!wbDragging_&&!wbResizing_) return;
    e.preventDefault();
    // Resize actif
    if(wbResizing_&&wbSelectedObj){
      const obj=wbObjects.find(o=>o.id===wbSelectedObj); if(!obj) return;
      wbApplyResize(obj,wbResizeHandle_,pos.x,pos.y);
      // Mettre à jour W/H display dans la toolbar
      const bb=wbGetBBox(obj);
      if(bb){
        const wi=document.getElementById('wb-w-input'), hi=document.getElementById('wb-h-input');
        if(wi) wi.value=Math.round(bb.w);
        if(hi) hi.value=Math.round(bb.h);
      }
      wbRedraw(); return;
    }
    if(wbDragging_&&wbSelectedObj){
      const obj=wbObjects.find(o=>o.id===wbSelectedObj); if(!obj) return;
      const bb=wbGetBBox(obj); if(!bb) return;
      const nx=pos.x-wbDragOffset_.dx,ny=pos.y-wbDragOffset_.dy;
      const dx=(nx-bb.x)/MeetState.wbCanvas.width,dy=(ny-bb.y)/MeetState.wbCanvas.height;
      if(obj.type==='sticker'){obj.x+=dx;obj.y+=dy;obj.x2+=dx;obj.y2+=dy;}
      else if(obj.type==='shape'){obj.x1+=dx;obj.y1+=dy;obj.x2+=dx;obj.y2+=dy;}
      else if(obj.type==='text'){obj.x+=dx;obj.y+=dy;}
      wbRedraw(); return;
    }
    if(['pen','highlighter','eraser'].includes(wbTool_)){
      if(wbCurrentStroke_){wbCurrentStroke_.points.push(toNorm(pos.x,pos.y));wbRedraw();}
      MeetState.socket?.emit('wb_draw',{meetingId:MeetState.MEETING_ID,tool:wbTool_,color:wbCurrentStroke_?.color,size:wbCurrentStroke_?.size,x1:toNorm(wbStart_.x,wbStart_.y).x,y1:toNorm(wbStart_.x,wbStart_.y).y,x2:toNorm(pos.x,pos.y).x,y2:toNorm(pos.x,pos.y).y});
      wbStart_=pos; return;
    }
    // Preview en temps réel pour formes & stickers
    wbRedraw();
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
  });

  MeetState.wbCanvas.addEventListener('pointerup',e=>{
    const pos=getPos(e);
    if(wbResizing_){wbResizing_=false;wbResizeHandle_=null;wbSaveHistory();wbSyncAll();
      // Refresh panel propriétés avec nouvelles dimensions
      if(wbSelectedObj){const o=wbObjects.find(x=>x.id===wbSelectedObj);if(o)showWbProperties(o);}
      return;
    }
    if(wbDragging_){wbDragging_=false;wbSaveHistory();wbSyncAll();return;}
    if(!wbDrawing_) return; wbDrawing_=false; wbCurrentStroke_=null;
    if(wbTool_==='text'){
      showWbTextInput(pos.x,pos.y,'',(text)=>{
        if(!text) return;
        const id='obj_'+Date.now();
        const obj={id,type:'text',x:toNorm(pos.x,pos.y).x,y:toNorm(pos.x,pos.y).y,text,color:wbColor_,size:wbSize_,bold:false,opacity:100};
        wbObjects.push(obj); wbRedraw(); wbSaveHistory();
        MeetState.socket?.emit('wb_text',{meetingId:MeetState.MEETING_ID,...obj});
      }); return;
    }
    if(!['pen','eraser','highlighter'].includes(wbTool_)&&!wbTool_.startsWith('sticker_')){
      const id='obj_'+Date.now(),n1=toNorm(wbStart_.x,wbStart_.y),n2=toNorm(pos.x,pos.y);
      const obj={id,type:'shape',shape:wbTool_,x1:n1.x,y1:n1.y,x2:n2.x,y2:n2.y,color:wbColor_,size:wbSize_,fillColor:wbColor_+'33',radius:0,opacity:100};
      wbObjects.push(obj); wbRedraw();
      MeetState.socket?.emit('wb_shape',{meetingId:MeetState.MEETING_ID,...obj});
    }
    if(wbTool_.startsWith('sticker_')){
      const sid=wbTool_.replace('sticker_',''),id='obj_'+Date.now();
      let w2=Math.abs(pos.x-wbStart_.x),h2=Math.abs(pos.y-wbStart_.y);
      if(w2<20) w2=wbW_; if(h2<20) h2=wbH_;
      const n1=toNorm(Math.min(wbStart_.x,pos.x),Math.min(wbStart_.y,pos.y));
      const n2=toNorm(Math.min(wbStart_.x,pos.x)+w2,Math.min(wbStart_.y,pos.y)+h2);
      const props={...(WB_STICKER_PROPS[sid]||{})};
      const obj={id,type:'sticker',sticker:sid,x:n1.x,y:n1.y,x2:n2.x,y2:n2.y,color:wbColor_,props,opacity:100};
      wbObjects.push(obj); wbRedraw(); wbSaveHistory();
      MeetState.socket?.emit('wb_sticker',{meetingId:MeetState.MEETING_ID,...obj});
    }
    wbSaveHistory();
    wbSyncAll(); // ← Synchroniser l'état complet après chaque action
  });

  MeetState.wbCanvas.addEventListener('dblclick',e=>{
    const pos=getPos(e),found=wbHitTest(pos.x,pos.y);
    if(found&&found.type==='text'){showWbTextInput(fromNorm(found.x,found.y).x,fromNorm(found.x,found.y).y,found.text,(t)=>{if(t===null)return;found.text=t;wbRedraw();wbSaveHistory();wbSyncAll();});}
    else if(found&&found.type==='sticker'){showWbProperties(found);}
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

function wbSyncAll() {
  MeetState.socket?.emit('wb_sync',{meetingId:MeetState.MEETING_ID,objects:wbObjects});
}

function wbSaveHistory() {
  wbHistory_.push(JSON.parse(JSON.stringify(wbObjects)));
  if(wbHistory_.length>WB_MAX_HISTORY) wbHistory_.shift();
  wbRedo_=[];
}

function wbUndo() {
  if(wbHistory_.length<2) return;
  wbRedo_.push(wbHistory_.pop());
  wbObjects=JSON.parse(JSON.stringify(wbHistory_[wbHistory_.length-1]));
  wbRedraw(); wbSyncAll();
}

function wbRedo() {
  if(!wbRedo_.length) return;
  const n=wbRedo_.pop(); wbHistory_.push(n);
  wbObjects=JSON.parse(JSON.stringify(n));
  wbRedraw(); wbSyncAll();
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

function wbBgColor(c) { wbBgColor_=c; wbRedraw(); wbSaveHistory(); }

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

function wbClear() {
  if(!confirm('Effacer tout le tableau ?')) return;
  wbObjects=[]; wbSelectedObj=null; hideWbProperties();
  wbRedraw(); wbSaveHistory(); wbSyncAll();
  MeetState.socket?.emit('wb_clear',{meetingId:MeetState.MEETING_ID});
}

function wbExport() {
  if(!MeetState.wbCanvas) return;
  const a=document.createElement('a'); a.download='tableau-'+MeetState.MEETING_ID+'.png'; a.href=MeetState.wbCanvas.toDataURL(); a.click();
}

function wbImportImage() {
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{const img=new Image();img.onload=()=>{const W=MeetState.wbCanvas.width,H=MeetState.wbCanvas.height,sc=Math.min(W*.6/img.width,H*.6/img.height,1);const w=img.width*sc,h=img.height*sc;MeetState.wbCtx.drawImage(img,(W-w)/2,(H-h)/2,w,h);wbSaveHistory();wbSyncAll();};img.src=ev.target.result;};
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
  socket.on('wb_shape', (data) => applyWbShape(data));
  socket.on('wb_text',  ({ text, x, y, color, size }) => {
    if (!MeetState.wbCtx) return;
    MeetState.wbCtx.fillStyle = color; MeetState.wbCtx.font = `${size*6}px Sora,sans-serif`; MeetState.wbCtx.fillText(text, x, y);
  });
  socket.on('wb_clear', () => {
    if (!MeetState.wbCtx) return;
    MeetState.wbCtx.fillStyle = '#1a2540'; MeetState.wbCtx.fillRect(0, 0, MeetState.wbCanvas?.width||800, MeetState.wbCanvas?.height||600);
  });
  socket.on('wb_state', (payload) => {
    if (!payload) return;
    if (payload.objects && Array.isArray(payload.objects)) {
      // Nouveau format : liste d'objets normalisés
      wbObjects = payload.objects;
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
      if (MeetState.wbCanvas) wbRedraw();
    } else if (payload.dataUrl && MeetState.wbCtx && MeetState.wbCanvas) {
      const img = new Image();
      img.onload = () => MeetState.wbCtx.drawImage(img, 0, 0);
      img.src = payload.dataUrl;
    }
  });
  socket.on('wb_sticker', (data) => applyWbSticker(data));
  socket.on('wb_text',    (data) => { if(data.id&&!wbObjects.find(o=>o.id===data.id)){wbObjects.push(data);wbRedraw();} });

  // ── Popcorn ──────────────────────────────────────────────────────────────
  socket.on('popcorn_start', ({ targetName, targetSocketId, question, duration }) => {
    showPopcornModal(targetName, targetSocketId, question, duration);
  });
  socket.on('popcorn_answer', ({ answer, targetName }) => {
    closePopcornModal();
    showPopcornAnswer(targetName, answer);
    appendChat('Popcorn 🍿', `${targetName} : ${answer}`, new Date().toISOString(), false);
  });
  socket.on('popcorn_timeout', ({ targetName }) => {
    closePopcornModal();
    notify(`⏰ ${targetName} n\'a pas répondu à temps`);
  });

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
  if (MeetState._recordingBeforeUnloadHandler) window.removeEventListener('beforeunload', MeetState._recordingBeforeUnloadHandler);
  if (MeetState._recordingKeydownHandler) window.removeEventListener('keydown', MeetState._recordingKeydownHandler);
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
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const allVids = document.querySelectorAll('.peer-tile video');
  allVids.forEach(v => { if (v.srcObject) { try { audioCtx.createMediaStreamSource(v.srcObject).connect(dest); } catch(_){} } });
  if (MeetState.localStream) { try { audioCtx.createMediaStreamSource(MeetState.localStream).connect(dest); } catch(_){} }
  MeetState._recordAudioCtx = audioCtx;
  return new MediaStream([canvas.captureStream(24).getVideoTracks()[0], ...dest.stream.getAudioTracks()]);
}

async function buildMeetingRecordingStream() {
  if (meetingIsIOSLike()) return buildFallbackMeetingRecordingStream();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24, cursor: 'always', displaySurface: 'browser' },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    });
    return stream;
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
  await showRecordCountdown();
  ensureRecordingUnloadProtection();
  const finalStream = await buildMeetingRecordingStream();
  MeetState._recordChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp8,opus';
  MeetState._mediaRecorder = new MediaRecorder(finalStream, { mimeType });
  MeetState._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) MeetState._recordChunks.push(e.data); };
  MeetState._mediaRecorder.onstop = () => {
    cancelAnimationFrame(MeetState._recordFrame);
    try { MeetState._recordAudioCtx?.close?.(); } catch (_) {}
    try { finalStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    teardownRecordingUnloadProtection();
    const blob = new Blob(MeetState._recordChunks, { type: 'video/webm' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `reunion-${MeetState.MEETING_ID}-${new Date().toISOString().slice(0,19)}.webm`; a.click();
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
let _popcornTimer = null;

function openPopcornLauncher() {
  if (!MeetState.IS_HOST) return;
  const existing = document.getElementById('popcorn-launcher');
  if (existing) { existing.remove(); return; }

  // Construire la liste des participants
  const participants = Array.from(document.querySelectorAll('.peer-tile'))
    .map(t => ({ id: t.id.replace('tile-',''), name: t.querySelector('.peer-name')?.textContent?.replace(' (vous)','').trim() || '?' }))
    .filter(p => p.id !== 'local');

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
    const peers = Object.values(MeetState.peers);
    if (!peers.length) { notify('Aucun participant à désigner'); return; }
    const picked = peers[Math.floor(Math.random() * peers.length)];
    targetSocketId = Object.keys(MeetState.peers).find(k => MeetState.peers[k] === picked);
    targetName     = picked.name || 'Quelqu\'un';
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
