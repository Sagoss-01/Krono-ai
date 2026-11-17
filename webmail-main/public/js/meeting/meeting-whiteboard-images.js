/**
 * meeting-whiteboard-images.js
 * Images du tableau blanc : de vrais objets (composant « image »), jamais de pixels collés sur le canvas.
 *
 *  - Depuis l'ordinateur : le fichier est envoyé au serveur (socket 'wb_image_upload') qui vérifie sa
 *    signature (PNG, JPEG, GIF, WebP — pas de SVG), sa taille et ses dimensions.
 *  - Depuis un lien : propriété « Lien de l'image » du composant (ou fenêtre « Importer »). Le SERVEUR
 *    télécharge l'image (https uniquement, adresses publiques) : les navigateurs des participants ne
 *    chargent jamais de ressource externe → pas de pixel espion, export PNG/PDF intact.
 *  - Seules les sources /wb-media/<id>.<ext> (notre domaine) sont affichées.
 * À charger APRÈS meeting-features.js et AVANT la création de MeetApp.
 */
(function (g) {
  'use strict';

  const LOCAL_SRC = /^\/wb-media\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX_BYTES = 4 * 1024 * 1024;
  const ACK_TIMEOUT_MS = 20000;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Cache des images affichées (utilisé par le dessin du composant « image ») ───────────────────────
  const cache = new Map();
  g.wbGetImage = function wbGetImage(src) {
    if (!LOCAL_SRC.test(String(src || ''))) return null;                 // jamais de source externe
    let entry = cache.get(src);
    if (!entry) {
      const img = new Image();
      entry = { img, ok: false };
      img.onload = () => { entry.ok = true; if (typeof wbRedraw === 'function') wbRedraw(); };
      img.onerror = () => { entry.failed = true; };
      img.src = src;
      cache.set(src, entry);
    }
    return entry.ok ? entry.img : null;
  };

  // ── Échanges avec le serveur ────────────────────────────────────────────────────────────────────────
  function emitAck(event, payload) {
    return new Promise((resolve) => {
      if (!MeetState.socket) return resolve({ ok: false, error: 'Connexion à la réunion indisponible.' });
      const timer = setTimeout(() => resolve({ ok: false, error: 'Le serveur met trop de temps à répondre.' }), ACK_TIMEOUT_MS);
      MeetState.socket.emit(event, { meetingId: MeetState.MEETING_ID, ...payload }, (res) => { clearTimeout(timer); resolve(res || { ok: false, error: 'Réponse invalide.' }); });
    });
  }

  async function uploadFile(file) {
    if (!file) return { ok: false, error: 'Aucun fichier.' };
    if (!ALLOWED_TYPES.includes(file.type)) return { ok: false, error: 'Format non pris en charge. Utilisez PNG, JPEG, GIF ou WebP (pas de SVG).' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'Image trop lourde (4 Mo maximum).' };
    return emitAck('wb_image_upload', { data: await file.arrayBuffer() });
  }

  const importLink = (url) => emitAck('wb_image_import', { url: String(url || '').trim() });

  // ── Objets du tableau ───────────────────────────────────────────────────────────────────────────────
  function addImageObject({ url, width, height }, link) {
    const c = MeetState.wbCanvas;
    const W = c.width, H = c.height;
    const scale = Math.min((W * 0.55) / width, (H * 0.55) / height, 1);
    const w = (width * scale) / W, h = (height * scale) / H;
    const meta = typeof wbLocalAuthorMeta === 'function' ? wbLocalAuthorMeta() : {};
    const obj = {
      id: 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: 'sticker', sticker: 'image',
      x: (1 - w) / 2, y: (1 - h) / 2, x2: (1 + w) / 2, y2: (1 + h) / 2, color: '#4db8d8', size: 2, opacity: 100,
      props: { src: url, link: link || '', fit: 'cover', radius: 0 }, ...meta,
    };
    wbObjects.push(obj);
    wbRedraw(true);
    wbSaveHistory('modification');
    wbSyncAll('immediate');
    if (typeof wbSetSelection === 'function') wbSetSelection([obj.id]);
    return obj;
  }

  function setObjectImage(id, { url }, link) {
    const obj = wbObjects.find(o => o.id === id);
    if (!obj) return;
    obj.props = { ...(obj.props || {}), src: url, link: link || '' };
    obj.updatedAt = Date.now();
    wbRedraw(true);
    wbSaveHistory('property');
    wbSyncAll('immediate');
    if (typeof showWbProperties === 'function') showWbProperties(obj);
  }

  // ── Fenêtre « Importer une image » (ordinateur ou lien) ─────────────────────────────────────────────
  function openImportDialog(targetId) {
    if (typeof wbCanEdit === 'function' && !wbCanEdit()) { notify("Tableau verrouillé par l'hôte"); return; }
    document.getElementById('wbimg-modal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'wbimg-modal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Importer une image" style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:440px;padding:22px;">
      <div style="font-size:16px;font-weight:800;color:var(--text1);margin-bottom:4px;">${targetId ? 'Remplacer l\'image' : 'Importer une image'}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:16px;">L'image est vérifiée et enregistrée sur notre serveur : les participants ne chargent jamais de site externe. Formats : PNG, JPEG, GIF, WebP — 4 Mo maximum.</div>
      <button type="button" data-a="file" style="width:100%;padding:12px;border-radius:10px;border:1px dashed var(--accent);background:transparent;color:var(--accent);font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Choisir un fichier de mon ordinateur</button>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
      <div style="display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--muted);font-size:11px;"><span style="flex:1;height:1px;background:var(--border)"></span>ou<span style="flex:1;height:1px;background:var(--border)"></span></div>
      <label style="font-size:11.5px;font-weight:700;color:var(--muted);">Lien de l'image (https://…)</label>
      <div style="display:flex;gap:8px;margin-top:6px;"><input type="text" data-f="url" maxlength="2000" placeholder="https://exemple.com/image.png" style="flex:1;min-width:0;padding:10px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);font-family:inherit;font-size:13px;outline:none;">
        <button type="button" data-a="link" style="padding:10px 16px;border-radius:9px;border:none;background:var(--accent);color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Importer</button></div>
      <div data-role="msg" style="font-size:12.5px;min-height:18px;margin:12px 0 4px;"></div>
      <button type="button" data-a="close" style="width:100%;padding:10px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text2);font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Fermer</button></div>`;
    document.body.appendChild(ov);
    const msg = ov.querySelector('[data-role=msg]'), fileInput = ov.querySelector('input[type=file]'), urlInput = ov.querySelector('[data-f=url]');
    const busy = (on, text) => { ov.querySelectorAll('button').forEach(b => { b.disabled = on; }); msg.style.color = 'var(--muted)'; msg.textContent = on ? text : ''; };
    const fail = (m) => { ov.querySelectorAll('button').forEach(b => { b.disabled = false; }); msg.style.color = '#f87171'; msg.textContent = m; };
    const apply = (res, link) => {
      if (!res.ok) return fail(res.error || 'Importation impossible.');
      if (targetId) setObjectImage(targetId, res, link); else addImageObject(res, link);
      ov.remove();
    };
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelector('[data-a=close]').addEventListener('click', () => ov.remove());
    ov.querySelector('[data-a=file]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => { busy(true, 'Vérification et envoi de l\'image…'); apply(await uploadFile(fileInput.files[0]), ''); });
    const runLink = async () => {
      const url = urlInput.value.trim();
      if (!/^https:\/\//i.test(url)) return fail('Collez un lien commençant par https://');
      busy(true, 'Téléchargement de l\'image par le serveur…');
      apply(await importLink(url), url);
    };
    ov.querySelector('[data-a=link]').addEventListener('click', runLink);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runLink(); });
    urlInput.focus();
  }

  // ── Intégration au code existant (fonctions globales de meeting-features.js) ─────────────────────────
  // 1) Bouton « Importer » de la barre d'outils : images sécurisées au lieu de pixels collés sur le canvas
  g.wbImportImage = function () { openImportDialog(null); };

  // 2) Propriété « Lien de l'image » : le lien est importé par le serveur, jamais chargé directement
  if (typeof g.wbUpdateProp === 'function') {
    const original = g.wbUpdateProp;
    g.wbUpdateProp = function (id, path, value, commitNow) {
      const obj = wbObjects.find(o => o.id === id);
      if (obj && obj.sticker === 'image' && path === 'props.link') {
        const url = String(value || '').trim();
        if (!url) { obj.props = { ...(obj.props || {}), link: '', src: '' }; wbRedraw(true); wbSyncAll('immediate'); return; }
        if (!/^https:\/\//i.test(url)) { notify('Le lien doit commencer par https://'); return; }
        notify("Téléchargement de l'image…");
        importLink(url).then((res) => {
          if (!res.ok) { notify(res.error || "Impossible d'importer l'image."); return; }
          setObjectImage(id, res, url);
          notify('Image importée');
        });
        return;
      }
      return original.apply(this, arguments);
    };
  }

  // 3) Panneau de propriétés : bouton « Remplacer par un fichier »
  if (typeof g.showWbProperties === 'function') {
    const original = g.showWbProperties;
    g.showWbProperties = function (obj) {
      const out = original.apply(this, arguments);
      try {
        if (obj && obj.sticker === 'image') {
          const holder = document.querySelector('#wb-props-panel > div');
          if (holder && !holder.querySelector('[data-wbimg-replace]')) {
            const box = document.createElement('div');
            box.setAttribute('data-wbimg-replace', '1');
            box.style.cssText = 'margin:4px 0 12px;';
            box.innerHTML = `<button type="button" style="width:100%;padding:10px;border-radius:10px;border:1px dashed var(--accent);background:transparent;color:var(--accent);font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;">Remplacer par un fichier de l'ordinateur</button>
              <div style="font-size:10.5px;color:var(--muted);margin-top:6px;line-height:1.5;">Les images sont vérifiées et hébergées sur notre serveur.</div>`;
            box.querySelector('button').addEventListener('click', () => openImportDialog(obj.id));
            holder.appendChild(box);
          }
        }
      } catch (_) { /* décor facultatif : ne doit jamais bloquer le panneau */ }
      return out;
    };
  }

  g.WbImages = { uploadFile, importLink, addImageObject, setObjectImage, openImportDialog };
})(window);
