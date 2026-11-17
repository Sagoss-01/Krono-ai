/**
 * meeting-whiteboard-ai.js
 * Designer IA du tableau blanc : le participant décrit, l'IA dessine, modifie et organise pour tout le monde.
 *
 *  - Conversation SAUVEGARDÉE (localStorage, par réunion et par participant) : elle survit au rechargement.
 *  - Chaque réponse qui modifie le tableau crée une VERSION : « Revenir à cette version » restaure le
 *    tableau tel qu'il était juste après cette réponse, « Annuler » tel qu'il était juste avant.
 *  - Ajouts (formes, textes, composants natifs, composants/gabarits de design, images), modifications par
 *    id ou par groupe, suppressions, ordre, alignement, répartition, effacement.
 * Dépend de meeting-features.js (wbObjects, wbRedraw, wbSaveHistory, wbSyncAll, wbCanEdit…) et de
 * meeting-utils.js (notify). À charger APRÈS meeting-features.js.
 */
(function (g) {
  'use strict';

  const REQUEST_TIMEOUT_MS = 90000;
  const MAX_SNAPSHOTS = 30;            // 2 par réponse (avant / après) → ~15 versions
  const MAX_SNAPSHOT_BYTES = 1200000;
  const MAX_MESSAGES = 60;
  const state = { bound: false, pending: null, busy: false, store: null, key: '', version: 0, confirmTimer: null };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function luminance(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 0;
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  // ── Onglets du panneau de droite ────────────────────────────────────────────────────────────────────
  function showTab(tab) {
    const isAi = tab === 'ai';
    $('wb-tab-props')?.toggleAttribute('hidden', isAi);
    $('wb-tab-ai')?.toggleAttribute('hidden', !isAi);
    document.querySelectorAll('.wb-rail-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (isAi) { ensureStore(); setTimeout(() => $('wbai-input')?.focus(), 50); }
  }

  function open() {
    $('wb-right-rail')?.classList.add('open');
    showTab('ai');
  }

  // ═══ Sauvegarde de la conversation ═══════════════════════════════════════════════════════════════════
  function storageKey() {
    const who = MeetState.USER_EMAIL || ('guest:' + (MeetState.displayName || 'invite'));
    return `wbai:v1:${MeetState.MEETING_ID}:${who}`;
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(state.key);
      const data = raw ? JSON.parse(raw) : null;
      if (data && data.v === 1 && Array.isArray(data.messages) && data.snaps && typeof data.snaps === 'object') return data;
    } catch (_) { /* stockage illisible : on repart d'une conversation vide */ }
    return { v: 1, messages: [], snaps: {} };
  }

  function pruneSnapshots() {
    const ids = Object.keys(state.store.snaps);
    // on supprime d'abord les plus anciens (ordre d'insertion)
    while (ids.length > MAX_SNAPSHOTS) delete state.store.snaps[ids.shift()];
    state.store.messages = state.store.messages.slice(-MAX_MESSAGES);
  }

  function save() {
    if (!state.store) return;
    pruneSnapshots();
    for (let attempt = 0; attempt < 12; attempt++) {
      try { localStorage.setItem(state.key, JSON.stringify(state.store)); return; }
      catch (_) {                                                          // quota dépassé : on sacrifie la plus ancienne version
        const ids = Object.keys(state.store.snaps);
        if (!ids.length) return;
        delete state.store.snaps[ids[0]];
      }
    }
  }

  function ensureStore() {
    if (state.store || !MeetState.MEETING_ID) return;
    state.key = storageKey();
    state.store = loadStore();
    state.version = state.store.messages.reduce((m, x) => Math.max(m, x.ver || 0), 0);
    renderAll();
  }

  function clearConversation() {
    if (state.busy) return;
    state.store = { v: 1, messages: [], snaps: {} };
    state.version = 0;
    save();
    renderAll();
  }

  // ═══ Affichage ═══════════════════════════════════════════════════════════════════════════════════════
  function renderMessage(m) {
    const list = $('wbai-msgs');
    if (!list) return null;
    $('wbai-welcome')?.remove();
    const div = document.createElement('div');
    div.className = 'wbai-msg ' + m.role + (m.error ? ' error' : '');
    div.dataset.id = m.id;
    let html = `<div class="wbai-text">${esc(m.text)}</div>`;
    if (m.role === 'assistant' && m.counts) {
      const beforeOk = !!state.store.snaps[m.beforeId], afterOk = !!state.store.snaps[m.afterId];
      const time = new Date(m.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      html += `<div class="wbai-ver"><span class="wbai-count">Version ${m.ver} · ${time} · ${esc(m.counts)}</span>
        <span class="wbai-vbtns">
          <button type="button" class="wbai-undo" data-snap="${esc(m.beforeId)}" data-label="Annuler" ${beforeOk ? '' : 'disabled'} title="Remettre le tableau comme avant cette réponse">${beforeOk ? 'Annuler' : 'Expirée'}</button>
          <button type="button" class="wbai-restore" data-snap="${esc(m.afterId)}" data-label="Revenir à cette version" ${afterOk ? '' : 'disabled'} title="Remettre le tableau tel qu'il était juste après cette réponse">${afterOk ? 'Revenir à cette version' : 'Expirée'}</button>
        </span></div>`;
    }
    div.innerHTML = html;
    div.querySelectorAll('button[data-snap]').forEach((b) => b.addEventListener('click', () => confirmRestore(b)));
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  function renderAll() {
    const list = $('wbai-msgs');
    if (!list) return;
    list.querySelectorAll('.wbai-msg').forEach((n) => n.remove());
    if (!state.store.messages.length) {
      if (!$('wbai-welcome')) {
        const w = document.createElement('div');
        w.className = 'wbai-welcome'; w.id = 'wbai-welcome';
        w.innerHTML = `<div class="wbai-welcome-title">Que voulez-vous dessiner&nbsp;?</div>
          <div class="wbai-welcome-text">Schémas, organigrammes, cartes mentales… et de vraies maquettes de sites et d'applications. L'IA peut aussi modifier ce qui existe. Chaque réponse crée une version à laquelle vous pouvez revenir.</div>
          <div class="wbai-chips">
            <button type="button" onclick="WbAI.suggest('Dessine une maquette de site e-commerce de mode : page d\\'accueil complète')">Site e-commerce</button>
            <button type="button" onclick="WbAI.suggest('Dessine une landing page pour une application de gestion de projets')">Landing page</button>
            <button type="button" onclick="WbAI.suggest('Dessine un tableau de bord d\\'administration avec statistiques et graphique')">Tableau de bord</button>
            <button type="button" onclick="WbAI.suggest('Dessine 3 écrans mobiles d\\'une application de livraison de repas')">Écrans mobiles</button>
            <button type="button" onclick="WbAI.suggest('Dessine un organigramme simple d\\'une équipe projet')">Organigramme</button>
          </div>`;
        list.appendChild(w);
      }
      return;
    }
    $('wbai-welcome')?.remove();
    state.store.messages.forEach(renderMessage);
  }

  function setBusy(busy) {
    state.busy = busy;
    const btn = $('wbai-send'), inp = $('wbai-input');
    if (btn) btn.disabled = busy;
    if (inp) inp.disabled = busy;
  }

  function addLocalMessage(m) {
    const msg = { id: uid(), ts: Date.now(), ...m };
    state.store.messages.push(msg);
    save();
    return renderMessage(msg) && msg;
  }

  // Retour à une version : deux clics (le second confirme) pour éviter une perte accidentelle
  function confirmRestore(btn) {
    if (btn.dataset.armed === '1') { clearTimeout(state.confirmTimer); btn.dataset.armed = ''; restore(btn.dataset.snap); return; }
    document.querySelectorAll('button[data-armed="1"]').forEach((b) => { b.dataset.armed = ''; b.textContent = b.dataset.label; });
    btn.dataset.armed = '1'; btn.textContent = 'Confirmer ?';
    clearTimeout(state.confirmTimer);
    state.confirmTimer = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; }, 3500);
  }

  function restore(snapId) {
    if (typeof wbCanEdit === 'function' && !wbCanEdit()) { notify("Le tableau n'est pas modifiable"); return; }
    const json = state.store.snaps[snapId];
    if (!json) { notify('Cette version a expiré.'); return; }
    wbObjects = JSON.parse(json);
    wbRedraw(true);
    wbSaveHistory('modification');
    wbSyncAll('immediate');
    notify('Version restaurée pour tous les participants');
  }

  const snapshot = () => {
    const json = JSON.stringify(wbObjects);
    if (json.length > MAX_SNAPSHOT_BYTES) return null;
    const id = 's' + uid();
    state.store.snaps[id] = json;
    return id;
  };

  // ═══ Contexte envoyé à l'IA ═══════════════════════════════════════════════════════════════════════════
  function normBox(o) {
    const c = MeetState.wbCanvas;
    if (!c) return null;
    const W = c.width, H = c.height;
    if (o.type === 'shape') return { t: o.shape, x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    if (o.type === 'text') {
      const px = Math.max(10, (o.size || 4) * 5), lines = String(o.text || '').split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * px * 0.58 / W;
      const x = o.textAlign === 'center' ? o.x - w / 2 : o.textAlign === 'right' ? o.x - w : o.x;
      return { t: 'text', x, y: o.y, w, h: lines.length * px * 1.25 / H, text: String(o.text || '').slice(0, 40) };
    }
    if (o.type === 'sticker') return { t: 'ui', st: o.sticker, x: Math.min(o.x, o.x2), y: Math.min(o.y, o.y2), w: Math.abs(o.x2 - o.x), h: Math.abs(o.y2 - o.y) };
    if (o.type === 'stroke' && Array.isArray(o.points) && o.points.length) {
      const xs = o.points.map((p) => p.x), ys = o.points.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { t: 'stroke', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    return null;
  }

  function describe(o) {
    const b = normBox(o);
    if (!b) return null;
    const isBox = o.type === 'shape' && ['rect', 'circle', 'triangle'].includes(o.shape);
    const fill = isBox && (o.fillOpacity ?? 100) > 0 ? (o.fillColor || o.color || '') : '';
    const src = o.sticker === 'image' && o.props?.src ? o.props.src : '';
    const text = b.text || (o.type === 'sticker' ? String(o.props?.label || o.props?.title || o.props?.brand || o.props?.placeholder || '').slice(0, 40) : '');
    return { id: String(o.id), ...b, text, color: o.color || '', fill, g: o.g || '', src };
  }

  function buildContext() {
    const c = MeetState.wbCanvas;
    const list = (typeof wbObjects !== 'undefined' ? wbObjects : []).slice(-140).map(describe).filter(Boolean);
    const shapes = list.filter((e) => ['rect', 'circle', 'triangle'].includes(e.t));
    list.filter((e) => e.t === 'text').forEach((t) => {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      const host = shapes.find((sh) => cx >= sh.x && cx <= sh.x + sh.w && cy >= sh.y && cy <= sh.y + sh.h);
      if (host) t.labelOf = host.id;
    });
    // groupes (composants et gabarits)
    const map = new Map();
    (typeof wbObjects !== 'undefined' ? wbObjects : []).forEach((o) => {
      if (!o.g) return;
      const b = normBox(o); if (!b) return;
      const e = map.get(o.g) || { g: o.g, n: o.n || 'groupe', x1: 1, y1: 1, x2: 0, y2: 0, count: 0 };
      e.x1 = Math.min(e.x1, b.x); e.y1 = Math.min(e.y1, b.y); e.x2 = Math.max(e.x2, b.x + b.w); e.y2 = Math.max(e.y2, b.y + b.h); e.count++;
      map.set(o.g, e);
    });
    const groups = [...map.values()].map((e) => ({ g: e.g, n: e.n, x: e.x1, y: e.y1, w: e.x2 - e.x1, h: e.y2 - e.y1, count: e.count }));
    return {
      aspect: `${(c ? c.width / c.height : 1.78).toFixed(2)}:1`,
      canvas: c ? { w: c.width, h: c.height } : { w: 1600, h: 900 },
      bgColor: typeof wbBgColor_ !== 'undefined' ? wbBgColor_ : '#1a2540',
      existing: list, groups,
    };
  }

  // ═══ Conversion « réponse de l'IA » → objets du tableau ═══════════════════════════════════════════════
  function fitLabel(label, boxW, boxH) {
    const CHAR = 0.58;
    const maxPxW = (len) => (boxW * 0.88) / (Math.max(1, len) * CHAR);
    let lines = [label], px = Math.min(maxPxW(label.length), boxH * 0.4);
    if (px < 15 && label.includes(' ')) {
      const mid = label.length / 2; let cut = -1, best = Infinity;
      for (let i = 0; i < label.length; i++) if (label[i] === ' ' && Math.abs(i - mid) < best) { best = Math.abs(i - mid); cut = i; }
      if (cut > 0) { lines = [label.slice(0, cut), label.slice(cut + 1)]; px = Math.min(maxPxW(Math.max(lines[0].length, lines[1].length)), (boxH * 0.8) / (2 * 1.25)); }
    }
    return { text: lines.join('\n'), lines: lines.length, size: clamp(Math.floor(px / 5), 2, 12) };
  }

  function elementsToObjects(elements, batch) {
    const c = MeetState.wbCanvas, W = c.width, H = c.height;
    const bg = typeof wbBgColor_ !== 'undefined' ? wbBgColor_ : '#1a2540';
    const meta = typeof wbLocalAuthorMeta === 'function' ? wbLocalAuthorMeta() : {};
    const out = [];
    let n = 0;
    const id = () => `ai_${batch}_${n++}`;
    const tag = (o, el) => { if (el.g) { o.g = `${batch}_${el.g}`; o.n = el.n; } return o; };

    for (const el of elements) {
      if (el.kind === 'rect' || el.kind === 'ellipse' || el.kind === 'triangle') {
        const shape = {
          id: id(), type: 'shape', shape: el.kind === 'ellipse' ? 'circle' : el.kind,
          x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h, color: el.color, size: el.strokeSize ?? 2,
          fillColor: el.fill || el.color, fillOpacity: el.fill ? 100 : 0, radius: el.radius ?? (el.kind === 'rect' ? 10 : 0),
          opacity: el.opacity ?? 100, ...meta,
        };
        if (el.noStroke) shape.borderStyle = 'none'; else if (el.dash) shape.borderStyle = el.dash;
        out.push(tag(shape, el));
        if (el.label) {
          const fit = fitLabel(el.label, el.w * W, el.h * H);
          const px = Math.max(10, fit.size * 5), lh = Math.round(px * 1.25), cy = (el.y + el.h / 2) * H;
          out.push(tag({
            id: id(), type: 'text', text: fit.text, x: el.x + el.w / 2, y: (cy - (fit.lines * lh) / 2) / H,
            color: luminance(el.fill || bg) < 0.5 ? '#ffffff' : '#0f172a', size: fit.size, bold: false, textAlign: 'center', opacity: 100, ...meta,
          }, el));
        }
      } else if (el.kind === 'line' || el.kind === 'arrow') {
        const l = { id: id(), type: 'shape', shape: el.kind, x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, color: el.color, size: el.strokeSize ?? 2, fillOpacity: 0, radius: 0, opacity: 100, ...meta };
        if (el.dash) l.borderStyle = el.dash;
        out.push(tag(l, el));
      } else if (el.kind === 'text') {
        out.push(tag({
          id: id(), type: 'text', text: el.text, x: el.x, y: el.y, color: el.color, size: el.size, bold: !!el.bold || (!('bold' in el) && el.size >= 6),
          italic: !!el.italic, textAlign: el.align || 'left', opacity: 100, ...meta,
        }, el));
      } else if (el.kind === 'freehand') {
        out.push(tag({ id: id(), type: 'stroke', points: el.points.map(([x, y]) => ({ x, y })), color: el.color, size: el.strokeSize ?? 3, opacity: 100, ...meta }, el));
      } else if (el.kind === 'ui') {
        out.push(tag({
          id: id(), type: 'sticker', sticker: el.sticker, x: el.x, y: el.y, x2: el.x + el.w, y2: el.y + el.h,
          color: el.color, size: 2, opacity: 100, props: { ...el.props }, ...meta,
        }, el));
      }
    }
    return out;
  }

  // ═══ Opérations sur l'existant ════════════════════════════════════════════════════════════════════════
  function objBox(o) {
    const b = normBox(o);
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }

  function moveObj(o, dx, dy) {
    if (o.type === 'shape') { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; }
    else if (o.type === 'sticker') { o.x += dx; o.x2 += dx; o.y += dy; o.y2 += dy; }
    else if (o.type === 'text') { o.x += dx; o.y += dy; }
    else if (o.type === 'stroke') o.points.forEach((p) => { p.x += dx; p.y += dy; });
  }

  /** Éléments cités par id ou par groupe → liste d'unités ({ ids, members, box }). */
  function resolveUnits(refs) {
    const units = [];
    for (const ref of refs) {
      const members = wbObjects.filter((o) => String(o.id) === ref || o.g === ref);
      if (!members.length) continue;
      const boxes = members.map(objBox).filter(Boolean);
      if (!boxes.length) continue;
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      units.push({ members, box: { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y } });
    }
    return units;
  }

  function applyUpdate(o, u) {
    if (u.color) o.color = u.color;
    if (u.opacity) o.opacity = u.opacity;
    if (o.type === 'shape') {
      if (u.fill) { o.fillColor = u.fill; o.fillOpacity = 100; }
    } else if (o.type === 'sticker') {
      if (u.fill) { o.props = { ...(o.props || {}), bgColor: u.fill }; }
    }
    if (u.props && o.type === 'sticker') o.props = { ...(o.props || {}), ...u.props };
    if (o.type === 'text') { if (u.text) o.text = u.text; if (u.size) o.size = u.size; }

    // géométrie absolue (x, y, w, h) puis déplacement relatif (dx, dy)
    const b = objBox(o);
    if (b && ['x', 'y', 'w', 'h'].some((k) => u[k] !== undefined)) {
      const nx = u.x ?? b.x, ny = u.y ?? b.y, nw = u.w ?? b.w, nh = u.h ?? b.h;
      if (o.type === 'shape') {
        const flipX = o.x2 < o.x1, flipY = o.y2 < o.y1;
        o.x1 = flipX ? nx + nw : nx; o.x2 = flipX ? nx : nx + nw; o.y1 = flipY ? ny + nh : ny; o.y2 = flipY ? ny : ny + nh;
        followLabel(o, b, (nx + nw / 2) - (b.x + b.w / 2), (ny + nh / 2) - (b.y + b.h / 2));
      } else if (o.type === 'sticker') { o.x = nx; o.y = ny; o.x2 = nx + nw; o.y2 = ny + nh; }
      else if (o.type === 'text') { if (u.x !== undefined) o.x = u.x; if (u.y !== undefined) o.y = u.y; }
    }
    if (u.dx || u.dy) {
      if (o.type === 'shape' && b) followLabel(o, b, u.dx || 0, u.dy || 0);
      moveObj(o, u.dx || 0, u.dy || 0);
    }
  }

  /** Le texte centré dans une forme suit le déplacement de celle-ci. */
  function followLabel(shape, oldBox, dx, dy) {
    if (!dx && !dy) return;
    if (!['rect', 'circle', 'triangle'].includes(shape.shape)) return;
    wbObjects.filter((t) => t.type === 'text' && t !== shape && !t._moved && t.x >= oldBox.x && t.x <= oldBox.x + oldBox.w && t.y >= oldBox.y - 0.02 && t.y <= oldBox.y + oldBox.h)
      .forEach((t) => { t.x += dx; t.y += dy; t._moved = true; });
  }

  /** Applique la réponse validée de l'IA. @returns {string|null} résumé des changements, ou null si rien n'a changé */
  function applyOps(res, batch) {
    let added = 0, changed = 0, removed = 0;

    if (res.clear && wbObjects.length) { removed += wbObjects.length; wbObjects = []; }

    const del = new Set(res.deletes || []);
    if (del.size) {
      const before = wbObjects.length;
      wbObjects = wbObjects.filter((o) => !del.has(String(o.id)) && !del.has(o.g));
      removed += before - wbObjects.length;
    }

    for (const u of res.updates || []) {
      const targets = u.id ? wbObjects.filter((o) => String(o.id) === u.id) : wbObjects.filter((o) => o.g === u.group);
      if (!targets.length) continue;
      const groupMove = !!u.group;                                                  // un groupe ne change ni de taille ni de position absolue
      const upd = groupMove ? { ...u, x: undefined, y: undefined, w: undefined, h: undefined } : u;
      targets.forEach((o) => applyUpdate(o, upd));
      changed += targets.length;
    }
    wbObjects.forEach((t) => { delete t._moved; });

    for (const a of res.align || []) {
      const units = resolveUnits(a.ids);
      if (units.length < 2) continue;
      const left = Math.min(...units.map((u) => u.box.x)), right = Math.max(...units.map((u) => u.box.x + u.box.w));
      const top = Math.min(...units.map((u) => u.box.y)), bottom = Math.max(...units.map((u) => u.box.y + u.box.h));
      units.forEach((u) => {
        const dx = a.mode === 'left' ? left - u.box.x : a.mode === 'right' ? right - (u.box.x + u.box.w) : a.mode === 'center' ? (left + right) / 2 - (u.box.x + u.box.w / 2) : 0;
        const dy = a.mode === 'top' ? top - u.box.y : a.mode === 'bottom' ? bottom - (u.box.y + u.box.h) : a.mode === 'middle' ? (top + bottom) / 2 - (u.box.y + u.box.h / 2) : 0;
        u.members.forEach((m) => moveObj(m, dx, dy));
      });
      changed += units.length;
    }
    for (const d of res.distribute || []) {
      const units = resolveUnits(d.ids).sort((p, q) => (d.axis === 'v' ? p.box.y - q.box.y : p.box.x - q.box.x));
      if (units.length < 3) continue;
      const k = d.axis === 'v' ? 'y' : 'x', s = d.axis === 'v' ? 'h' : 'w';
      const first = units[0].box, last = units[units.length - 1].box;
      const total = last[k] + last[s] - first[k], used = units.reduce((t, u) => t + u.box[s], 0), gap = (total - used) / (units.length - 1);
      let pos = first[k] + first[s] + gap;
      units.slice(1, -1).forEach((u) => { const delta = pos - u.box[k]; u.members.forEach((m) => moveObj(m, k === 'x' ? delta : 0, k === 'y' ? delta : 0)); pos += u.box[s] + gap; });
      changed += units.length - 2;
    }

    // ordre d'empilement : le dernier élément de la liste est dessiné au-dessus
    const reorder = (refs, toFront) => {
      const moved = wbObjects.filter((o) => refs.includes(String(o.id)) || refs.includes(o.g));
      if (!moved.length) return;
      const rest = wbObjects.filter((o) => !moved.includes(o));
      wbObjects = toFront ? [...rest, ...moved] : [...moved, ...rest];
      changed += moved.length;
    };
    if (res.order?.back?.length) reorder(res.order.back, false);
    if (res.order?.front?.length) reorder(res.order.front, true);

    const objs = elementsToObjects(res.elements || [], batch);
    wbObjects.push(...objs);
    added = objs.length;

    if (!added && !changed && !removed) return null;
    wbRedraw(true);
    wbSaveHistory('modification');
    wbSyncAll('immediate');
    const parts = [];
    if (added) parts.push(`${added} ajouté${added > 1 ? 's' : ''}`);
    if (changed) parts.push(`${changed} modifié${changed > 1 ? 's' : ''}`);
    if (removed) parts.push(`${removed} supprimé${removed > 1 ? 's' : ''}`);
    return parts.join(' · ');
  }

  // ═══ Réseau ═══════════════════════════════════════════════════════════════════════════════════════════
  function bindSocket() {
    if (state.bound || !MeetState.socket) return state.bound;
    MeetState.socket.on('wb_ai_result', onResult);
    MeetState.socket.on('wb_ai_status', ({ busy, name }) => { if (busy) notify(`IA • ${name || 'Un participant'} demande un dessin…`); });
    state.bound = true;
    return true;
  }

  function onResult(res) {
    if (!state.pending || state.pending.requestId !== res.requestId) return;
    clearTimeout(state.pending.timer);
    state.pending.typing?.remove();
    const { beforeId } = state.pending;
    state.pending = null;
    setBusy(false);

    if (!res.ok) { addLocalMessage({ role: 'assistant', text: res.error || "Erreur de l'assistant IA.", error: true }); return; }

    const counts = applyOps(res, uid());
    if (!counts) { addLocalMessage({ role: 'assistant', text: res.message }); return; }
    const afterId = snapshot();
    addLocalMessage({ role: 'assistant', text: res.message, counts, beforeId, afterId, ver: ++state.version });
  }

  function send(textOverride) {
    if (state.busy) return;
    ensureStore();
    const inp = $('wbai-input');
    const text = String(textOverride ?? inp?.value ?? '').trim();
    if (text.length < 3) { notify('Décrivez ce que vous voulez dessiner ou modifier.'); return; }
    if (!MeetState.socket || !bindSocket()) { notify('Connexion à la réunion indisponible'); return; }
    if (typeof wbCanEdit === 'function' && !wbCanEdit()) {
      notify(typeof wbLockMode_ !== 'undefined' && wbLockMode_ === 'readonly' ? 'Tableau en lecture seule' : "Tableau réservé à l'hôte");
      return;
    }
    if (!MeetState.wbCanvas) { notify('Ouvrez le tableau blanc avant de demander un dessin.'); return; }

    if (inp) { inp.value = ''; inp.style.height = ''; }
    addLocalMessage({ role: 'user', text });
    const typing = document.createElement('div');
    typing.className = 'wbai-msg assistant loading';
    typing.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
    $('wbai-msgs')?.appendChild(typing);
    $('wbai-msgs') && ($('wbai-msgs').scrollTop = $('wbai-msgs').scrollHeight);

    const requestId = 'wbai_' + uid();
    const beforeId = snapshot();                                     // état juste avant : sert au bouton « Annuler »
    state.pending = {
      requestId, typing, beforeId,
      timer: setTimeout(() => {
        typing.remove(); state.pending = null; setBusy(false);
        addLocalMessage({ role: 'assistant', text: "L'IA met trop de temps à répondre. Réessayez avec une demande plus simple.", error: true });
      }, REQUEST_TIMEOUT_MS),
    };
    setBusy(true);
    MeetState.socket.emit('wb_ai_request', { meetingId: MeetState.MEETING_ID, prompt: text, requestId, context: buildContext() });
  }

  function suggest(text) {
    const inp = $('wbai-input');
    if (inp) { inp.value = text; inp.focus(); }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Le socket est créé au moment où l'utilisateur rejoint : on attend qu'il existe
  const poll = setInterval(() => { if (bindSocket()) { clearInterval(poll); ensureStore(); } }, 1000);
  setTimeout(() => clearInterval(poll), 10 * 60 * 1000);

  // Quand on sélectionne un objet, on revient automatiquement sur l'onglet Propriétés
  if (typeof g.showWbProperties === 'function') {
    const original = g.showWbProperties;
    g.showWbProperties = function (...args) { showTab('props'); return original.apply(this, args); };
  }

  /** Historique des versions (ids des instantanés avant / après chaque réponse qui a modifié le tableau). */
  const versions = () => { ensureStore(); return state.store.messages.filter(m => m.ver).map(m => ({ ver: m.ver, beforeId: m.beforeId, afterId: m.afterId, summary: m.counts })); };

  g.WbAI = { showTab, open, send, suggest, onKey, clearConversation, versions, restoreVersion: restore };
})(window);
