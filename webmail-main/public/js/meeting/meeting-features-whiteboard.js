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
const WB_MAX_HISTORY = 30;
const WB_HANDLE_NAMES = ['tl','tc','tr','ml','mr','bl','bc','br'];

let wbClipboard_ = null;
let wbLastPersistAt_ = 0;
let wbHydrating_ = false;

function wbStorageKey() {
  return `netiify:whiteboard:${MeetState.MEETING_ID || 'default'}`;
}

function wbIsEditableTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return el.isContentEditable || ['input', 'textarea', 'select', 'option', 'button'].includes(tag);
}

function wbPersistState(reason = 'local') {
  try {
    wbLastPersistAt_ = Date.now();
    localStorage.setItem(wbStorageKey(), JSON.stringify({
      version: 1,
      savedAt: wbLastPersistAt_,
      reason,
      bgColor: wbBgColor_,
      objects: wbObjects,
    }));
  } catch (_) {}
}

function wbRestoreLocalState() {
  try {
    const raw = localStorage.getItem(wbStorageKey());
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.bgColor) wbBgColor_ = parsed.bgColor;
    if (Array.isArray(parsed?.objects)) {
      wbObjects = parsed.objects;
      wbHydrating_ = true;
      wbRedraw();
      wbHistory_ = [JSON.parse(JSON.stringify(wbObjects))];
      wbRedo_ = [];
      wbHydrating_ = false;
      return true;
    }
  } catch (_) {}
  return false;
}

function wbCloneSelected() {
  const obj = wbObjects.find(o => o.id === wbSelectedObj);
  if (!obj) return null;
  return JSON.parse(JSON.stringify(obj));
}

function wbPasteClipboard() {
  if (!wbClipboard_) return;
  const copy = JSON.parse(JSON.stringify(wbClipboard_));
  const off = 0.03;
  copy.id = 'obj_' + Date.now();
  if (copy.type === 'sticker') {
    copy.x += off; copy.y += off; copy.x2 += off; copy.y2 += off;
  } else if (copy.type === 'shape') {
    copy.x1 += off; copy.y1 += off; copy.x2 += off; copy.y2 += off;
  } else if (copy.type === 'text') {
    copy.x += off; copy.y += off;
  } else if (copy.type === 'stroke' && Array.isArray(copy.points)) {
    copy.points = copy.points.map(pt => ({ x: pt.x + off, y: pt.y + off }));
  }
  wbObjects.push(copy);
  wbSelectedObj = copy.id;
  wbRedraw();
  wbSaveHistory();
  wbSyncAll();
  showWbProperties(copy);
}

function wbNudgeSelected(dxPx, dyPx) {
  if (!wbSelectedObj || !MeetState.wbCanvas) return;
  const obj = wbObjects.find(o => o.id === wbSelectedObj);
  if (!obj) return;
  const dx = dxPx / MeetState.wbCanvas.width;
  const dy = dyPx / MeetState.wbCanvas.height;
  if (obj.type === 'sticker') {
    obj.x += dx; obj.y += dy; obj.x2 += dx; obj.y2 += dy;
  } else if (obj.type === 'shape') {
    obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy;
  } else if (obj.type === 'text') {
    obj.x += dx; obj.y += dy;
  } else if (obj.type === 'stroke' && Array.isArray(obj.points)) {
    obj.points.forEach(pt => { pt.x += dx; pt.y += dy; });
  }
  wbRedraw();
  wbSaveHistory();
  wbSyncAll();
}

function wbApplyDimensions(obj, nextW, nextH) {
  if (!MeetState.wbCanvas || !obj) return;
  const wNorm = Math.max(10, parseInt(nextW, 10) || 10) / MeetState.wbCanvas.width;
  const hNorm = Math.max(10, parseInt(nextH, 10) || 10) / MeetState.wbCanvas.height;
  if (obj.type === 'sticker') {
    obj.x2 = obj.x + wNorm;
    obj.y2 = obj.y + hNorm;
  } else if (obj.type === 'shape') {
    obj.x2 = obj.x1 + wNorm;
    obj.y2 = obj.y1 + hNorm;
  }
}

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
  if(f.type==='pixels') {
    const v=Math.round(parseFloat(val)||0);
    return `<input type="number" min="${f.min||10}" max="${f.max||2000}" step="${f.step||1}" value="${v}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',parseFloat(this.value))" style="${s}">`;
  }
  if(f.type==='checkbox') return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 0;"><input type="checkbox" ${val?'checked':''} onchange="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.checked);this.nextElementSibling.textContent=this.checked?'Oui':'Non'" style="width:15px;height:15px;accent-color:#4db8d8;cursor:pointer;"><span style="font-size:11px;color:var(--text2);">${val?'Oui':'Non'}</span></label>`;
  if(f.type==='select') return `<select oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value)" style="${s}">${(f.opts||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}</select>`;
  return `<input type="text" value="${String(val).replace(/"/g,'&quot;')}" oninput="MeetApp.wbUpdateProp('${obj.id}','${f.path}',this.value)" style="${s}" placeholder="${f.placeholder||''}">`;
}

function getPropsFields(obj) {
  // Dimensions actuelles (lecture seule en header du panel, modifiables via toolbar W/H)
  const bb = wbGetBBox(obj);
  const base=[
    {label:'Largeur (px)',   path:'__width',  type:'pixels', min:10, max:2000, default:Math.round(bb?.w||wbW_)},
    {label:'Hauteur (px)',   path:'__height', type:'pixels', min:10, max:2000, default:Math.round(bb?.h||wbH_)},
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
  if (path === '__width' || path === '__height') {
    const bb = wbGetBBox(obj);
    wbApplyDimensions(obj, path === '__width' ? value : Math.round(bb?.w || wbW_), path === '__height' ? value : Math.round(bb?.h || wbH_));
    const bb2 = wbGetBBox(obj);
    const wi=document.getElementById('wb-w-input'), hi=document.getElementById('wb-h-input');
    if(wi&&bb2) wi.value=Math.round(bb2.w);
    if(hi&&bb2) hi.value=Math.round(bb2.h);
    wbRedraw(); wbSaveHistory(); wbSyncAll();
    return;
  }
  const keys=path.split('.');let t=obj;
  for(let i=0;i<keys.length-1;i++){if(!t[keys[i]])t[keys[i]]={};t=t[keys[i]];}
  t[keys[keys.length-1]]=value;
  wbRedraw(); wbSaveHistory(); wbSyncAll();
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
  const key = (e.key || '').toLowerCase();
  const editable = wbIsEditableTarget(document.activeElement);
  if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) { e.preventDefault(); wbUndo(); return; }
  if (((e.ctrlKey || e.metaKey) && key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'z')) { e.preventDefault(); wbRedo(); return; }
  if (editable) return;
  if ((e.ctrlKey || e.metaKey) && key === 'c' && wbSelectedObj) { e.preventDefault(); wbClipboard_ = wbCloneSelected(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'x' && wbSelectedObj) { e.preventDefault(); wbClipboard_ = wbCloneSelected(); wbDeleteObj(wbSelectedObj); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'v') { e.preventDefault(); wbPasteClipboard(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'd' && e.shiftKey && wbSelectedObj) { e.preventDefault(); wbDeleteObj(wbSelectedObj); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'd' && wbSelectedObj) { e.preventDefault(); wbDuplicateObj(wbSelectedObj); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'a') { e.preventDefault(); if (wbObjects.length) { wbSelectedObj = wbObjects[0].id; wbRedraw(); const panel=document.getElementById('wb-props-panel'); if(panel) panel.innerHTML='<div style="padding:12px;color:var(--text2);font-size:12px;">'+wbObjects.length+' éléments présents sur le tableau.</div>'; } return; }
  if (key === 'escape') { e.preventDefault(); wbTool('select'); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && wbSelectedObj) { e.preventDefault(); wbDeleteObj(wbSelectedObj); return; }
  if (wbSelectedObj && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp') wbNudgeSelected(0, -step);
    if (e.key === 'ArrowDown') wbNudgeSelected(0, step);
    if (e.key === 'ArrowLeft') wbNudgeSelected(-step, 0);
    if (e.key === 'ArrowRight') wbNudgeSelected(step, 0);
  }
}

function initWhiteboard() {
  if(MeetState.wbCanvas){wbRedraw();return;}
  MeetState.wbCanvas=document.getElementById('wb-canvas');
  MeetState.wbCtx=MeetState.wbCanvas.getContext('2d',{willReadFrequently:true, alpha:false});
  const resize=()=>{ MeetState.wbCanvas.width=MeetState.wbCanvas.offsetWidth; MeetState.wbCanvas.height=MeetState.wbCanvas.offsetHeight; wbRedraw(); };
  wbRestoreLocalState();
  resize(); window.addEventListener('resize',resize); wbSaveHistory();
  window.addEventListener('beforeunload', ()=> wbPersistState('beforeunload'));
  MeetState.wbCanvas.style.background = wbBgColor_;

  const getPos=e=>{ const r=MeetState.wbCanvas.getBoundingClientRect(),t=e.touches?.[0]||e; return {x:t.clientX-r.left,y:t.clientY-r.top}; };

  MeetState.wbCanvas.addEventListener('pointerdown',e=>{
    if (wbIsEditableTarget(e.target) || e.target.closest?.('#wb-props-panel')) return;
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
        wbObjects.push(obj); wbSelectedObj=obj.id; wbRedraw(); wbSaveHistory();
        MeetState.socket?.emit('wb_text',{meetingId:MeetState.MEETING_ID,...obj});
        wbTool('select'); showWbProperties(obj);
      }); return;
    }
    if(!['pen','eraser','highlighter'].includes(wbTool_)&&!wbTool_.startsWith('sticker_')){
      const id='obj_'+Date.now(),n1=toNorm(wbStart_.x,wbStart_.y),n2=toNorm(pos.x,pos.y);
      const obj={id,type:'shape',shape:wbTool_,x1:n1.x,y1:n1.y,x2:n2.x,y2:n2.y,color:wbColor_,size:wbSize_,fillColor:wbColor_+'33',radius:0,opacity:100};
      wbObjects.push(obj); wbSelectedObj=obj.id; wbRedraw();
      MeetState.socket?.emit('wb_shape',{meetingId:MeetState.MEETING_ID,...obj});
      wbTool('select'); showWbProperties(obj);
    }
    if(wbTool_.startsWith('sticker_')){
      const sid=wbTool_.replace('sticker_',''),id='obj_'+Date.now();
      let w2=Math.abs(pos.x-wbStart_.x),h2=Math.abs(pos.y-wbStart_.y);
      if(w2<20) w2=wbW_; if(h2<20) h2=wbH_;
      const n1=toNorm(Math.min(wbStart_.x,pos.x),Math.min(wbStart_.y,pos.y));
      const n2=toNorm(Math.min(wbStart_.x,pos.x)+w2,Math.min(wbStart_.y,pos.y)+h2);
      const props={...(WB_STICKER_PROPS[sid]||{})};
      const obj={id,type:'sticker',sticker:sid,x:n1.x,y:n1.y,x2:n2.x,y2:n2.y,color:wbColor_,props,opacity:100};
      wbObjects.push(obj); wbSelectedObj=obj.id; wbRedraw(); wbSaveHistory();
      MeetState.socket?.emit('wb_sticker',{meetingId:MeetState.MEETING_ID,...obj});
      wbTool('select'); showWbProperties(obj);
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
  wbPersistState('sync');
  MeetState.socket?.emit('wb_sync',{meetingId:MeetState.MEETING_ID,objects:wbObjects,bgColor:wbBgColor_});
}

function wbSaveHistory() {
  wbHistory_.push(JSON.parse(JSON.stringify(wbObjects)));
  if(wbHistory_.length>WB_MAX_HISTORY) wbHistory_.shift();
  wbRedo_=[];
  if (!wbHydrating_) wbPersistState('history');
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

function wbBgColor(c) { wbBgColor_=c; if (MeetState.wbCanvas) MeetState.wbCanvas.style.background = c; wbRedraw(); wbSaveHistory(); wbSyncAll(); }

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
  wbPersistState('clear');
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
