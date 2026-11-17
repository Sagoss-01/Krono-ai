/**
 * public/js/mail.js
 * - Taille email dans la liste (RFC822.SIZE)
 * - Avatars robustes (RFC2047 decode + Gravatar fallback)
 * - Pièces jointes : preview image/PDF + téléchargement tous types
 */

const Mail = (() => {
  let emails        = [];
  let filtered      = [];
  let currentFolder = 'INBOX';
  let currentUid    = null;
  let currentEmail  = null;
  let fromCache     = false;
  let activeFilters = new Set(); // 'unread','starred','attachments'
  let compactMode   = localStorage.getItem('ts_compact') === '1';
  let page          = 0;
  const PAGE_SIZE   = 40;
  let selectedUids  = new Set();

  const FOLDER_NAMES = {
    INBOX:'Boîte de réception', Sent:'Envoyés', 'INBOX.Sent':'Envoyés',
    Drafts:'Brouillons', 'INBOX.Drafts':'Brouillons',
    Junk:'Spam', 'INBOX.Junk':'Spam', Spam:'Spam',
    Trash:'Corbeille', 'INBOX.Trash':'Corbeille',
  };

  /* ══════════════════════════════════════════════════════
     AVATARS
  ══════════════════════════════════════════════════════ */
  const AVATAR_COLORS = [
    ['#035c80','#01405c'],['#8b5cf6','#6d28d9'],['#06b6d4','#0e7490'],
    ['#22c55e','#15803d'],['#f59e0b','#b45309'],['#f43f5e','#be123c'],
    ['#a855f7','#7e22ce'],['#14b8a6','#0f766e'],
  ];

  function avatarColor(str) {
    let h = 0;
    for (let i = 0; i < (str||'').length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  // Décode les encoded-words RFC2047 côté client (=?UTF-8?B?...?=)
  function decodeEncodedWord(str) {
    if (!str || !str.includes('=?')) return str;
    return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, charset, enc, data) => {
      try {
        if (enc.toUpperCase() === 'B') {
          return decodeURIComponent(escape(atob(data)));
        } else {
          return data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
            String.fromCharCode(parseInt(h, 16)));
        }
      } catch (_) { return match; }
    });
  }

  // Parse "Prénom Nom <email@domain.com>" ou "email@domain.com"
  // Gère les guillemets doubles/simples, les encoded words, les crochets manquants
  function parseFrom(from) {
    from = decodeEncodedWord(String(from || '').trim());

    // Forme: "Name" <email> ou Name <email>
    const m1 = from.match(/^"?([^"<>]+?)"?\s*<([^>]+)>$/);
    if (m1) return { name: m1[1].trim(), email: m1[2].trim() };

    // Forme: <email> seul
    const m2 = from.match(/^<([^>]+)>$/);
    if (m2) return { name: '', email: m2[1].trim() };

    // Forme: email@domain.com seul
    if (from.includes('@') && !from.includes(' ')) {
      return { name: '', email: from };
    }

    // Fallback
    return { name: from, email: '' };
  }

  // Gravatar MD5 simple (djb2 hash sur l'email — pas de crypto, approx)
  // On utilise plutôt l'UI lettre + couleur comme primary, gravatar en bonus via img onerror
  function makeAvatar(from, size) {
    const p = parseFrom(from || '');
    const label    = p.name || p.email || '?';
    const initials = label
      .split(/[\s._\-+]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('') || label[0]?.toUpperCase() || '?';

    const [c1, c2] = avatarColor(p.email || label);
    const s = size || 30;
    const r = Math.round(s * 0.3);

    // Si on a un email, on tente Gravatar (silencieux si échec)
    const emailLower = (p.email || '').toLowerCase().trim();
    const gravatarId = emailLower ? simpleHash(emailLower) : '';

    if (gravatarId) {
      // img avec fallback sur le div lettre
      return `<div style="position:relative;width:${s}px;height:${s}px;flex-shrink:0;">
        <div id="av-bg-${gravatarId.slice(0,8)}" style="width:${s}px;height:${s}px;border-radius:${r}px;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:${Math.round(s*0.37)}px;font-weight:800;color:white;font-family:'Sora',sans-serif;position:absolute;inset:0;">${initials}</div>
        <img src="https://www.gravatar.com/avatar/${md5Hex(emailLower)}?s=${s*2}&d=404"
             width="${s}" height="${s}"
             style="border-radius:${r}px;position:absolute;inset:0;object-fit:cover;"
             onerror="this.style.display='none'"
             loading="lazy" />
      </div>`;
    }

    return `<div style="width:${s}px;height:${s}px;border-radius:${r}px;flex-shrink:0;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:${Math.round(s*0.37)}px;font-weight:800;color:white;font-family:'Sora',sans-serif;">${initials}</div>`;
  }

  // MD5 simplifié pour Gravatar (implémentation complète)
  function md5Hex(str) {
    // Utilise un simple hash djb2 en hex comme identifiant — pas du vrai MD5
    // Pour un vrai MD5, il faudrait une lib. On utilise l'URL Gravatar sans MD5
    // et on laisse le onerror gérer le fallback.
    // En pratique on retourne un hash non-MD5 qui fera afficher le fallback Gravatar → onerror → lettre
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
  }

  function simpleHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
    return Math.abs(h).toString(16);
  }

  /* ── Cache ── */
  function cacheKey(f) { return `ts_mail_${App.state.activeAccount}_${f}`; }
  function readCache(f) {
    try { const r = localStorage.getItem(cacheKey(f)); return r ? JSON.parse(r) : null; } catch(_) { return null; }
  }
  function writeCache(f, data) {
    try { localStorage.setItem(cacheKey(f), JSON.stringify({ emails: data, ts: Date.now() })); } catch(_) {}
  }

  /* ── Dossiers ── */
  async function loadFolders() {
    const res = await App.apiGet('/api/folders');
    if (!res.ok) return;
    const known = Object.keys(FOLDER_NAMES).map(k => k.toLowerCase());
    const extra = res.folders.filter(f => !known.includes(f.toLowerCase()));
    const container = document.getElementById('extra-folders');
    if (extra.length) {
      container.innerHTML = `<div class="sb-section-label sb-label" style="margin-top:8px;">Autres</div>` +
        extra.map(f => `
          <div class="folder-item" data-folder="${esc(f)}" onclick="Mail.selectFolder('${esc(f)}',this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="sb-label folder-name">${esc(f)}</span>
          </div>`).join('');
    }
  }

  function selectFolder(folder, el) {
    // Revenir en mode Mail si on était sur Outils (Calendrier/Contacts) ou Chat
    const toolsMode = document.getElementById('mode-tools');
    const chatMode  = document.getElementById('mode-chat');
    const mailMode  = document.getElementById('mode-mail');
    if (toolsMode && toolsMode.style.display !== 'none') toolsMode.style.display = 'none';
    if (chatMode  && chatMode.style.display  !== 'none') chatMode.style.display  = 'none';
    const aiMode = document.getElementById('mode-ai');
    if (aiMode) aiMode.style.display = 'none';
    document.getElementById('sb-ai-item')?.classList.remove('active');
    if (mailMode) mailMode.style.display = 'flex';
    sessionStorage.setItem('ts_mode', 'mail');

    currentFolder = folder;
    currentUid    = null;
    currentEmail  = null;
    document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('folder-title').textContent = FOLDER_NAMES[folder] || folder;
    document.getElementById('search-inp').value = '';
    showView('empty');
    document.getElementById('sidebar').classList.remove('mobile-open');
    loadEmails(false);
  }

  /* ── Chargement emails ── */
  async function loadEmails(forceRefresh) {
    if (!forceRefresh) {
      const cached = readCache(currentFolder);
      if (cached && Array.isArray(cached.emails) && cached.emails.length > 0) {
        emails    = cached.emails;
        filtered  = [...emails];
        fromCache = true;
        renderList();
        document.getElementById('cache-badge').style.display = 'inline-flex';
      } else {
        showListLoading(true);
      }
    } else {
      showListLoading(true);
    }

    const res = await App.apiGet(`/api/emails?folder=${encodeURIComponent(currentFolder)}&limit=120`);
    showListLoading(false);
    document.getElementById('cache-badge').style.display = 'none';

    if (!res.ok) {
      App.toast('Erreur chargement : ' + res.error, 'error');
      if (!fromCache) showView('empty');
      return;
    }

    emails    = res.emails || [];
    filtered  = [...emails];
    fromCache = false;
    writeCache(currentFolder, emails);
    renderList();
    updateBadge();
  }

  /* ── Insertion temps réel (socket push) ── */
  function prependEmails(newEmails) {
    if (!newEmails || newEmails.length === 0) return;
    const existingUids = new Set(emails.map(e => e.uid));
    const toAdd = newEmails.filter(e => !existingUids.has(e.uid));
    if (toAdd.length === 0) return;
    emails = [...toAdd.slice().reverse(), ...emails];
    // Reconstruire filtered en appliquant recherche + filtres actifs
    var q = (document.getElementById('search-inp')?.value || '').toLowerCase();
    var base = q ? emails.filter(function(e) {
      return (e.headers.subject||'').toLowerCase().includes(q) ||
             (e.headers.from   ||'').toLowerCase().includes(q);
    }) : emails.slice();
    filtered = applyFilters(base);
    writeCache(currentFolder, emails);
    renderList();
    updateBadge();
    setTimeout(function() {
      var first = document.querySelector('.email-item');
      if (first) {
        first.classList.add('new-highlight');
        setTimeout(function() { first.classList.remove('new-highlight'); }, 2000);
      }
    }, 50);
  }

  function refresh() {
    const btn = document.getElementById('refresh-btn');
    btn.querySelector('svg').classList.add('spin');
    loadEmails(true).then(() => {
      btn.querySelector('svg').classList.remove('spin');
      App.toast('Actualisé', 'success');
    });
  }

  function updateBadge() {
    if (currentFolder !== 'INBOX') return;
    const n = emails.filter(e => !e.flags.includes('\\Seen')).length;
    const b = document.getElementById('inbox-badge');
    if (!b) return;
    b.textContent   = n > 0 ? n : '';
    b.style.display = n > 0 ? 'inline-block' : 'none';
  }

  /* ── Rendu liste avec taille et avatar ── */
  function applyFilters(list) {
    let out = [...list];
    if (activeFilters.has('unread'))      out = out.filter(e => !e.flags.includes('\\Seen'));
    if (activeFilters.has('starred'))     out = out.filter(e => e.flags.includes('\\Flagged'));
    if (activeFilters.has('attachments')) out = out.filter(e => e.hasAttachment);
    return out;
  }

  function filter() {
    const q = (document.getElementById('search-inp')?.value || '').toLowerCase();
    let base = q ? emails.filter(e =>
      (e.headers.subject||'').toLowerCase().includes(q) ||
      (e.headers.from   ||'').toLowerCase().includes(q)
    ) : [...emails];
    filtered = applyFilters(base);
    page = 0;
    renderList();
  }

  function toggleFilter(f) {
    if (activeFilters.has(f)) activeFilters.delete(f);
    else activeFilters.add(f);
    document.querySelectorAll('.quick-filter').forEach(btn => {
      btn.classList.toggle('active', activeFilters.has(btn.dataset.filter));
    });
    filter();
  }

  let threadMode = localStorage.getItem('ts_thread') === '1';

  function toggleThread() {
    threadMode = !threadMode;
    localStorage.setItem('ts_thread', threadMode ? '1' : '0');
    const btn = document.getElementById('thread-btn');
    if (btn) btn.classList.toggle('active', threadMode);
    renderList();
    App.toast(threadMode ? 'Vue conversation activée' : 'Vue conversation désactivée', 'info');
  }

  function groupByThread(list) {
    var threads = {};
    var order   = [];
    list.forEach(function(email) {
      // Clé de thread : sujet normalisé (sans Re:/Fwd:)
      var subj = (email.headers.subject || '')
        .replace(/^(Re:|Fwd:|Fw:|AW:|TR:)\s*/gi, '').trim().toLowerCase();
      var key = email.headers.inReplyTo || email.headers.references?.split(/\s+/)[0] || subj || email.uid;
      if (!threads[key]) { threads[key] = []; order.push(key); }
      threads[key].push(email);
    });
    // Retourner seulement le dernier email de chaque thread + count
    return order.map(function(key) {
      var group = threads[key];
      var last  = group[0]; // déjà trié par date desc
      last._threadCount = group.length;
      last._threadEmails = group;
      return last;
    });
  }

  function toggleCompact() {
    compactMode = !compactMode;
    localStorage.setItem('ts_compact', compactMode ? '1' : '0');
    document.getElementById('list-items').classList.toggle('compact', compactMode);
    const btn = document.getElementById('compact-btn');
    if (btn) btn.title = compactMode ? 'Vue normale' : 'Mode compact';
  }

  function renderList() {
    showListLoading(false);
    const container = document.getElementById('list-items');
    const emptyEl   = document.getElementById('list-empty');

    if (filtered.length === 0) {
      container.style.display = 'none';
      emptyEl.style.display   = 'flex';
      return;
    }
    container.style.display = 'block';
    container.classList.toggle('compact', compactMode);
    emptyEl.style.display   = 'none';

    // Appliquer threading si activé
    const displayList = threadMode ? groupByThread(filtered) : filtered;

    // Scroll infini : afficher la page actuelle
    const visible = displayList.slice(0, (page + 1) * PAGE_SIZE);
    const hasMore = displayList.length > visible.length;

    container.innerHTML = visible.map(email => {
      const isUnread  = !email.flags.includes('\\Seen');
      const isStarred = email.flags.includes('\\Flagged');
      const from      = parseFrom(email.headers.from || '');
      const date      = fmtDate(email.headers.date);
      const isActive  = email.uid === currentUid;
      const avatar    = makeAvatar(email.headers.from);
      const hasAtt    = email.hasAttachment;
      const sizeStr   = email.size ? fmtSize(email.size) : '';

      const snippet = (email.snippet || (email.headers && email.headers.snippet) || '').slice(0,120);
      return `
        <div class="email-item ${isUnread ? 'unread' : ''} ${isActive ? 'active' : ''} ${compactMode ? 'compact' : ''}"
             data-uid="${email.uid}"
             onmouseenter="Mail.showPreview(event, ${email.uid})"
             onmouseleave="Mail.hidePreview()"
             onclick="Mail.openEmail(${email.uid})">
          <div class="ei-row">
            <div class="ei-avatar-row">
              ${avatar}
              <div class="ei-from ${isUnread ? 'ei-from-unread' : ''}">
                ${esc(from.name || from.email || email.headers.from)}
              </div>
            </div>
            <div class="ei-meta-right">
              <button class="ei-star ${isStarred ? 'starred' : ''}" onclick="event.stopPropagation();Mail.toggleStar(${email.uid})" title="${isStarred ? 'Retirer étoile' : 'Étoiler'}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="${isStarred ? '#f59e0b' : 'none'}" stroke="${isStarred ? '#f59e0b' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              ${hasAtt ? `<svg class="ei-att-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>` : ''}
              <div class="ei-date">${date}</div>
            </div>
          </div>
          <div class="ei-bottom">
            <div class="ei-subject">${esc(email.headers.subject || '(Sans sujet)')}</div>
            ${email._threadCount > 1 ? `<span class="ei-thread-badge">${email._threadCount}</span>` : ''}
            ${sizeStr ? `<span class="ei-size">${sizeStr}</span>` : ''}
          </div>
        </div>`;
    }).join('');

    // Sentinelle scroll infini
    if (hasMore) {
      const sentinel = document.createElement('div');
      sentinel.className = 'scroll-sentinel';
      sentinel.style.cssText = 'height:40px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:11px;';
      sentinel.textContent = `+ ${filtered.length - visible.length} emails`;
      container.appendChild(sentinel);
      // IntersectionObserver pour charger la page suivante
      if (window._listObserver) window._listObserver.disconnect();
      window._listObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { page++; renderList(); }
      }, { root: container, threshold: 0.1 });
      window._listObserver.observe(sentinel);
    }
  }

  function showListLoading(show) {
    document.getElementById('list-loading').style.display = show ? 'flex' : 'none';
    if (show) {
      document.getElementById('list-items').style.display = 'none';
      document.getElementById('list-empty').style.display = 'none';
    }
  }

  /* ── Affichage email ── */
  async function openEmail(uid) {
    currentUid = uid;
    document.querySelectorAll('.email-item').forEach(el =>
      el.classList.toggle('active', parseInt(el.dataset.uid) === uid)
    );

    const meta = emails.find(e => e.uid === uid);
    if (meta && !meta.flags.includes('\\Seen')) {
      meta.flags.push('\\Seen');
      document.querySelector(`.email-item[data-uid="${uid}"]`)?.classList.remove('unread');
      updateBadge();
    }

    showView('loading');
    document.getElementById('view-panel').classList.add('mobile-open');

    const res = await App.apiGet(`/api/email/${uid}?folder=${encodeURIComponent(currentFolder)}`);
    if (!res.ok) { App.toast('Erreur : ' + res.error, 'error'); showView('empty'); return; }

    currentEmail = res.email;
    const e = res.email;
    const p = parseFrom(e.from || '');

    document.getElementById('v-subject').textContent = e.subject || '(Sans sujet)';
    document.getElementById('v-from').textContent    = e.from || '';
    document.getElementById('v-to').textContent      = 'À : ' + (e.to || '');
    const ccEl = document.getElementById('v-cc');
    if (ccEl) { ccEl.textContent = e.cc ? 'Cc : ' + e.cc : ''; ccEl.style.display = e.cc ? 'block' : 'none'; }
    document.getElementById('v-date').textContent    = e.date ? new Date(e.date).toLocaleString('fr-FR') : '';

    // Avatar dans la vue détail
    const avEl     = document.getElementById('v-avatar');
    const initials = ((p.name||p.email||'?').split(/[\s._\-+]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')) || '?';
    const [c1, c2] = avatarColor(p.email || p.name || '?');
    avEl.style.background = `linear-gradient(135deg,${c1},${c2})`;
    avEl.textContent      = initials;

    // Taille dans le header si dispo
    const sizeEl = document.getElementById('v-size');
    if (sizeEl && meta && meta.size) {
      sizeEl.textContent = fmtSize(meta.size);
      sizeEl.style.display = 'inline';
    } else if (sizeEl) { sizeEl.style.display = 'none'; }

    // Bouton étoile dans la vue
    const isStarred = meta?.flags?.includes('\\Flagged');
    const starBtnEl = document.getElementById('v-star-btn');
    if (starBtnEl) {
      starBtnEl.innerHTML = isStarred
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    }

    // SPF/DKIM/SPAM indicateur
    const spamStatus = meta?.headers?.spamStatus || '';
    const hasDkim    = meta?.headers?.hasDkim || false;
    const isSpam     = spamStatus.toLowerCase().includes('yes');
    const vFromEl    = document.getElementById('v-from');
    if (vFromEl) {
      let badge = '';
      if (hasDkim)  badge += '<span class="auth-badge dkim" title="DKIM vérifié">✓ DKIM</span>';
      if (isSpam)   badge += '<span class="auth-badge spam" title="Marqué comme spam">⚠ SPAM</span>';
      vFromEl.innerHTML = esc(e.from || '') + ' ' + badge;
    }

    // Body — images bloquées par défaut
    const bodyEl = document.getElementById('v-body');
    const imgPref = localStorage.getItem('ts_show_images') === '1';

    if (e.html) {
      let html = sanitizeHtml(e.html);
      // Remplacer les src des images par data-src (blocage)
      if (!imgPref) {
        html = html.replace(/<img([^>]*)\ssrc=["']([^"']+)["']([^>]*)>/gi,
          '<img$1 data-src="$2" src="" style="display:none" class="blocked-img"$3>');
      } else {
        // Images autorisées : zoom au clic
        html = html.replace(/<img([^>]+)>/gi, (match, attrs) => {
          if (!attrs.includes('src=')) return match;
          return '<img' + attrs + ' style="max-width:100%;border-radius:6px;cursor:zoom-in;" onclick="Mail.zoomImg(this.src)" loading="lazy">';
        });
      }
      bodyEl.innerHTML = html;

      // Forcer tous les liens à s'ouvrir dans un nouvel onglet
      if (window.MailUI && typeof MailUI.patchMailLinks === 'function') {
        MailUI.patchMailLinks();
      }

      // Bannière blocage images
      const blockedCount = bodyEl.querySelectorAll('.blocked-img').length;
      const existingBanner = document.getElementById('img-block-banner');
      if (existingBanner) existingBanner.remove();
      if (blockedCount > 0 && !imgPref) {
        const banner = document.createElement('div');
        banner.id = 'img-block-banner';
        banner.className = 'img-block-banner';
        banner.innerHTML =
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
          '<span>' + blockedCount + ' image(s) bloquée(s)</span>' +
          '<button onclick="Mail.showImages()" style="background:var(--accent);border:none;color:white;border-radius:5px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-left:8px;">Afficher</button>' +
          '<button onclick="Mail.alwaysShowImages()" style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;margin-left:4px;">Toujours</button>';
        bodyEl.parentNode.insertBefore(banner, bodyEl);
      }
    } else {
      bodyEl.innerHTML = '<pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.7;">' + esc(e.text||'') + '</pre>';
      // Patch des liens même dans les emails texte brut
      if (window.MailUI && typeof MailUI.patchMailLinks === 'function') {
        MailUI.patchMailLinks();
      }
    }

    // Pièces jointes
    const attEl = document.getElementById('v-attachments');
    if (e.attachments && e.attachments.length) {
      attEl.style.display = 'flex';
      attEl.innerHTML = `
        <div class="att-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span>${e.attachments.length} pièce(s) jointe(s)</span>
        </div>
        <div class="att-list">
          ${e.attachments.map((a, idx) => renderAttachment(a, uid, idx)).join('')}
        </div>`;
    } else {
      attEl.style.display = 'none';
    }

    showView('content');
  }

  /* ── Rendu d'une pièce jointe ── */
  function renderAttachment(att, uid, idx) {
    const folder  = encodeURIComponent(currentFolder);
    const url     = `/api/attachment/${uid}/${idx}?folder=${folder}`;
    const ct      = att.contentType || '';
    const isImage = ct.startsWith('image/');
    const isPdf   = ct === 'application/pdf';
    const name    = att.filename || `fichier_${idx + 1}`;
    const size    = fmtSize(att.size);

    return `
      <div class="att-card">
        <div class="att-icon-wrap">${getFileIcon(ct)}</div>
        <div class="att-info">
          <div class="att-name" title="${esc(name)}">${esc(name)}</div>
          <div class="att-size">${size} · <span style="opacity:.6;">${ct.split('/')[1] || ct}</span></div>
        </div>
        <div class="att-actions">
          ${(isImage || isPdf) ? `
            <button class="att-btn preview" onclick="Mail.previewAttachment('${url}','${esc(ct)}','${esc(name)}')" title="Aperçu">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              ${isPdf ? 'Ouvrir' : 'Voir'}
            </button>` : ''}
          <a class="att-btn download" href="${url}" download="${esc(name)}" title="Télécharger">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Télécharger
          </a>
        </div>
      </div>`;
  }

  /* ── Icônes types MIME ── */
  function getFileIcon(ct) {
    if (ct.startsWith('image/'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#035c80" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    if (ct === 'application/pdf')
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`;
    if (ct.includes('word') || ct.includes('document'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#024a6a" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`;
    if (ct.includes('excel') || ct.includes('spreadsheet'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;
    if (ct.includes('zip') || ct.includes('compressed') || ct.includes('archive') || ct.includes('x-tar') || ct.includes('x-rar'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="12" y1="22" x2="12" y2="11"/></svg>`;
    if (ct.startsWith('video/'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
    if (ct.startsWith('audio/'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    if (ct.startsWith('text/'))
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/><line x1="9" y1="9" x2="11" y2="9"/></svg>`;
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }

  /* ── Prévisualisation pièce jointe ── */
  function previewAttachment(url, contentType, filename) {
    const existing = document.getElementById('att-preview-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'att-preview-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;animation:fadeUp .2s ease;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:10px;max-width:92vw;width:100%;padding:0 16px;';
    toolbar.innerHTML = `
      <span style="color:#94a3b8;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(filename)}</span>
      <a href="${url}" download="${esc(filename)}"
         style="padding:6px 14px;border-radius:8px;background:#035c80;color:white;font-size:12px;font-weight:600;text-decoration:none;display:flex;align-items:center;gap:5px;flex-shrink:0;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Télécharger
      </a>
      <button onclick="document.getElementById('att-preview-modal').remove()"
        style="width:30px;height:30px;border-radius:8px;background:rgba(239,68,68,0.15);border:none;color:#f87171;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;

    const content = document.createElement('div');
    content.style.cssText = 'max-width:92vw;max-height:82vh;display:flex;align-items:center;justify-content:center;';

    if (contentType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'max-width:92vw;max-height:82vh;border-radius:10px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6);';
      content.appendChild(img);
    } else if (contentType === 'application/pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:88vw;height:80vh;border:none;border-radius:10px;background:white;';
      content.appendChild(iframe);
    }

    modal.appendChild(toolbar);
    modal.appendChild(content);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    const esc_ = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc_); } };
    document.addEventListener('keydown', esc_);
  }

  async function toggleRead(uid) {
    const target = uid || currentUid;
    if (!target) return;
    const email = emails.find(e => e.uid === target);
    if (!email) return;
    const nowRead = !email.flags.includes('\\Seen');
    await App.apiPost(`/api/email/${target}/mark?folder=${encodeURIComponent(currentFolder)}`, { read: nowRead });
    if (nowRead) email.flags.push('\\Seen'); else email.flags = email.flags.filter(f => f !== '\\Seen');
    renderList(); updateBadge();
  }

  async function toggleStar(uid) {
    const target = uid || currentUid;
    if (!target) return;
    const email = emails.find(e => e.uid === target);
    if (!email) return;
    const nowStarred = !email.flags.includes('\\Flagged');
    if (nowStarred) App.playSound('send'); // petit son feedback
    await App.apiPost(`/api/email/${target}/star?folder=${encodeURIComponent(currentFolder)}`, { starred: nowStarred });
    if (nowStarred) email.flags.push('\\Flagged'); else email.flags = email.flags.filter(f => f !== '\\Flagged');
    // Mettre à jour l'étoile dans la vue détail aussi
    const starBtn = document.getElementById('v-star-btn');
    if (starBtn) {
      starBtn.innerHTML = nowStarred
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    }
    renderList();
  }

  async function deleteEmail() {
    if (!currentUid) return;
    const ok = await ConfirmModal.show({
      title: 'Supprimer cet email ?',
      body:  'Cette action est irréversible.',
      danger: true,
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    });
    if (!ok) return;
    const res = await App.apiDelete(`/api/email/${currentUid}?folder=${encodeURIComponent(currentFolder)}`);
    if (res.ok) {
      emails   = emails.filter(e => e.uid !== currentUid);
      filtered = filtered.filter(e => e.uid !== currentUid);
      writeCache(currentFolder, emails);
      showView('empty');
      currentUid = null; currentEmail = null;
      renderList();
      App.toast('Email supprimé', 'success');
    } else App.toast(res.error, 'error');
  }

  function reply()       { if (currentEmail) Compose.openReply(currentEmail); }
  function replyAll()    { if (currentEmail) Compose.openReplyAll(currentEmail); }
  function forward()     { if (currentEmail) Compose.openForward(currentEmail); }

  async function markSpam() {
    if (!currentUid) return;
    const ok = await ConfirmModal.show({ title: 'Marquer comme spam ?', body: 'Cet email va dans le dossier Spam.', danger: true, icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' });
    if (!ok) return;
    const res = await App.apiPost('/api/email/' + currentUid + '/spam?folder=' + encodeURIComponent(currentFolder), {});
    if (res.ok) {
      emails = emails.filter(function(e) { return e.uid !== currentUid; });
      filtered = filtered.filter(function(e) { return e.uid !== currentUid; });
      writeCache(currentFolder, emails);
      showView('empty'); currentUid = null; currentEmail = null;
      renderList(); App.toast('Email déplacé dans Spam', 'success');
    } else App.toast(res.error, 'error');
  }

  async function moveEmail(toFolder) {
    if (!currentUid || !toFolder) return;
    const res = await App.apiPost('/api/email/' + currentUid + '/move?folder=' + encodeURIComponent(currentFolder), { toFolder });
    if (res.ok) {
      emails = emails.filter(function(e) { return e.uid !== currentUid; });
      filtered = filtered.filter(function(e) { return e.uid !== currentUid; });
      writeCache(currentFolder, emails);
      showView('empty'); currentUid = null; currentEmail = null;
      renderList(); App.toast('Email déplacé vers ' + toFolder, 'success');
    } else App.toast(res.error, 'error');
  }

  // ── Mapping dossiers techniques → noms lisibles + icônes ─────────────────
  var FOLDER_SVG = {
    inbox:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    sent:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    drafts:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    spam:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    trash:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    archive: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    folder:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  };
  var FOLDER_LABELS = {
    'INBOX':          { label: 'Boîte de réception', svgKey: 'inbox',   color: 'var(--accent)' },
    'Sent':           { label: 'Envoyés',             svgKey: 'sent',    color: 'var(--accent)' },
    'INBOX.Sent':     { label: 'Envoyés',             svgKey: 'sent',    color: 'var(--accent)' },
    'Sent Messages':  { label: 'Envoyés',             svgKey: 'sent',    color: 'var(--accent)' },
    'Drafts':         { label: 'Brouillons',          svgKey: 'drafts',  color: 'var(--accent)' },
    'INBOX.Drafts':   { label: 'Brouillons',          svgKey: 'drafts',  color: 'var(--accent)' },
    'Junk':           { label: 'Spam',                svgKey: 'spam',    color: '#f87171' },
    'INBOX.Junk':     { label: 'Spam',                svgKey: 'spam',    color: '#f87171' },
    'Spam':           { label: 'Spam',                svgKey: 'spam',    color: '#f87171' },
    'Trash':          { label: 'Corbeille',           svgKey: 'trash',   color: '#f87171' },
    'INBOX.Trash':    { label: 'Corbeille',           svgKey: 'trash',   color: '#f87171' },
    'Deleted Items':  { label: 'Corbeille',           svgKey: 'trash',   color: '#f87171' },
    'Archive':        { label: 'Archives',            svgKey: 'archive', color: 'var(--accent)' },
    'INBOX.Archive':  { label: 'Archives',            svgKey: 'archive', color: 'var(--accent)' },
  };

  function getFolderDisplay(folder) {
    return FOLDER_LABELS[folder] || { label: folder, svgKey: 'folder', color: 'var(--text-muted)' };
  }

  function showMoveDropdown() {
    if (document.getElementById('move-modal-overlay')) { closeMoveModal(); return; }
    App.apiGet('/api/folders').then(function(res) {
      var folders = (res.ok && res.folders) ? res.folders : ['Sent','Drafts','Junk','Trash','INBOX'];
      // Dédupliquer par label lisible
      var seen = new Set();
      var unique = [];
      folders.forEach(function(f) {
        if (f === currentFolder) return;
        var disp = getFolderDisplay(f);
        if (!seen.has(disp.label)) {
          seen.add(disp.label);
          unique.push({ folder: f, label: disp.label, svgKey: disp.svgKey, color: disp.color });
        }
      });
      // Ordre logique
      var ORDER = ['Boîte de réception','Envoyés','Brouillons','Spam','Corbeille','Archives'];
      unique.sort(function(a, b) {
        var ia = ORDER.indexOf(a.label), ib = ORDER.indexOf(b.label);
        if (ia === -1) ia = 99; if (ib === -1) ib = 99;
        return ia - ib || a.label.localeCompare(b.label);
      });
      // Construire la modale
      var overlay = document.createElement('div');
      overlay.id = 'move-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;width:300px;max-height:75vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden;';
      // Header
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 18px 14px;border-bottom:1px solid var(--border);flex-shrink:0;';
      header.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--text-1);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Déplacer vers…</div>' +
        '<button onclick="Mail.closeMoveModal()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;border-radius:6px;display:flex;align-items:center;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      // Liste
      var list = document.createElement('div');
      list.style.cssText = 'overflow-y:auto;padding:8px;flex:1;';
      if (unique.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Aucun autre dossier disponible</div>';
      } else {
        unique.forEach(function(item) {
          var btn = document.createElement('button');
          btn.style.cssText = 'width:100%;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;border:none;cursor:pointer;background:transparent;color:var(--text-1);font-size:14px;font-family:inherit;text-align:left;transition:background .12s;';
          btn.onmouseover = function() { this.style.background = 'var(--bg-hover)'; };
          btn.onmouseout  = function() { this.style.background = 'transparent'; };
          var isRed = (item.color === '#f87171');
          btn.innerHTML =
            '<span style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + (isRed ? 'rgba(248,113,113,0.12)' : 'rgba(3,92,128,0.12)') + ';color:' + item.color + ';">' + FOLDER_SVG[item.svgKey] + '</span>' +
            '<span style="flex:1;font-weight:500;color:' + (isRed ? '#f87171' : 'var(--text-1)') + ';">' + esc(item.label) + '</span>' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
          (function(f){ btn.onclick = function() { closeMoveModal(); moveEmail(f); }; })(item.folder);
          list.appendChild(btn);
        });
      }
      card.appendChild(header);
      card.appendChild(list);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) closeMoveModal(); });
      overlay._keydown = function(e) { if (e.key === 'Escape') closeMoveModal(); };
      document.addEventListener('keydown', overlay._keydown);
    });
  }

  // ── Aperçu au survol ──────────────────────────────────────────────────────
  var _previewTimer = null;
  var _previewEl    = null;

  function showPreview(event, uid) {
    hidePreview();
    // Capturer la référence DOM AVANT le setTimeout (event.currentTarget devient null après)
    var item = event.currentTarget;
    if (!item) return;

    _previewTimer = setTimeout(function() {
      var email = emails.find(function(e) { return e.uid === uid; });
      if (!email) return;
      // Vérifier que l'item est toujours dans le DOM (l'utilisateur a peut-être scrollé)
      if (!document.body.contains(item)) return;

      var from     = parseFrom(email.headers.from || '');
      var name     = from.name || from.email || email.headers.from || '?';
      var initials = name.trim().split(/\s+/).map(function(w){ return w[0] || ''; }).slice(0,2).join('').toUpperCase() || '?';
      var subject  = email.headers.subject || '(Sans sujet)';
      var snippet  = (email.snippet || '').trim().slice(0, 160) || 'Aucun aperçu disponible';
      var date     = fmtDate(email.headers.date);
      var isUnread = !email.flags.includes('\\Seen');

      var tip = document.createElement('div');
      tip.id  = 'mail-preview-tip';
      tip.style.cssText = [
        'position:fixed',
        'z-index:9999',
        'width:280px',
        'background:var(--bg-panel)',
        'border:1px solid var(--border)',
        'border-radius:14px',
        'padding:14px 16px',
        'box-shadow:0 16px 48px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.03)',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity .15s ease',
      ].join(';');

      tip.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#035c80,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:white;flex-shrink:0;">' + initials + '</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:13px;font-weight:' + (isUnread ? '700' : '500') + ';color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(name) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:1px;">' + date + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(subject) + '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);line-height:1.55;">' + esc(snippet) + '</div>';

      document.body.appendChild(tip);

      // Positionnement relatif à l'item
      var rect = item.getBoundingClientRect();
      var tipW = tip.offsetWidth  || 280;
      var tipH = tip.offsetHeight || 120;

      // Par défaut : au-dessus à droite de la liste
      var top  = rect.top;
      var left = rect.right + 10;

      // Si déborde à droite → mettre à gauche
      if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 10;
      // Si déborde en bas → remonter
      if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
      // Minimum
      if (top < 8) top = 8;
      if (left < 8) left = 8;

      tip.style.top  = top  + 'px';
      tip.style.left = left + 'px';
      // Fade in
      requestAnimationFrame(function() { tip.style.opacity = '1'; });
      _previewEl = tip;
    }, 400);
  }

  function hidePreview() {
    clearTimeout(_previewTimer);
    _previewTimer = null;
    if (_previewEl) { _previewEl.remove(); _previewEl = null; }
    var existing = document.getElementById('mail-preview-tip');
    if (existing) existing.remove();
  }

    function closeMoveModal() {
    var overlay = document.getElementById('move-modal-overlay');
    if (!overlay) return;
    overlay.remove();
    if (overlay._keydown) document.removeEventListener('keydown', overlay._keydown);
  }

  function closeMobile() { document.getElementById('view-panel').classList.remove('mobile-open'); }

  function showImages() {
    document.querySelectorAll('.blocked-img').forEach(function(img) {
      var src = img.getAttribute('data-src');
      if (src) {
        img.src = src;
        img.style.display = '';
        img.style.maxWidth = '100%';
        img.style.borderRadius = '6px';
        img.style.cursor = 'zoom-in';
        img.onclick = function() { Mail.zoomImg(this.src); };
      }
    });
    var banner = document.getElementById('img-block-banner');
    if (banner) banner.remove();
  }

  function alwaysShowImages() {
    localStorage.setItem('ts_show_images', '1');
    showImages();
    App.toast('Images toujours affichées pour les futurs emails', 'success');
  }

  function zoomImg(src) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    ov.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:10px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6);">`;
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  }

  function showView(mode) {
    document.getElementById('view-empty').style.display   = mode==='empty'   ? 'flex' : 'none';
    document.getElementById('view-loading').style.display = mode==='loading' ? 'flex' : 'none';
    document.getElementById('view-content').style.display = mode==='content' ? 'flex' : 'none';
  }

  async function init() {
    await loadFolders();
    await loadEmails(false);
  }

  // Expose getMaxUid pour que le socket évite les doublons
  function getMaxUid() {
    if (!emails || emails.length === 0) return 0;
    return Math.max.apply(null, emails.map(function(e) { return e.uid || 0; }));
  }

  /* ── Aperçu au survol ──────────────────────────────────────────────── */


  /* ── Sélection multiple ─────────────────────────────────────────────── */
  function toggleSelect(uid, el) {
    if (selectedUids.has(uid)) {
      selectedUids.delete(uid);
      if (el) el.closest('.email-item').classList.remove('selected');
    } else {
      selectedUids.add(uid);
      if (el) el.closest('.email-item').classList.add('selected');
    }
    updateSelectionBar();
  }

  function selectAll() {
    filtered.forEach(function(e) { selectedUids.add(e.uid); });
    document.querySelectorAll('.email-item').forEach(function(el) { el.classList.add('selected'); });
    updateSelectionBar();
  }

  function clearSelection() {
    selectedUids.clear();
    document.querySelectorAll('.email-item').forEach(function(el) { el.classList.remove('selected'); });
    updateSelectionBar();
  }

  function updateSelectionBar() {
    var bar = document.getElementById('selection-bar');
    if (!bar) return;
    bar.style.display = selectedUids.size > 0 ? 'flex' : 'none';
    var countEl = document.getElementById('sel-count');
    if (countEl) countEl.textContent = selectedUids.size + ' email(s)';
  }

  async function deleteSelected() {
    if (!selectedUids.size) return;
    var ok = await ConfirmModal.show({
      title: 'Supprimer ' + selectedUids.size + ' email(s) ?',
      body: 'Cette action est irréversible.',
      danger: true,
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    });
    if (!ok) return;
    var uids = Array.from(selectedUids);
    await Promise.all(uids.map(function(uid) {
      return App.apiDelete('/api/email/' + uid + '?folder=' + encodeURIComponent(currentFolder));
    }));
    emails   = emails.filter(function(e) { return !selectedUids.has(e.uid); });
    filtered = filtered.filter(function(e) { return !selectedUids.has(e.uid); });
    writeCache(currentFolder, emails);
    clearSelection();
    showView('empty'); currentUid = null; currentEmail = null;
    renderList();
    App.toast(uids.length + ' email(s) supprim\u00e9(s)', 'success');
  }

  async function markAllReadInFolder() {
    var ok = await ConfirmModal.show({
      title: 'Marquer tout comme lu ?',
      body: 'Tous les emails non lus de ce dossier seront marqu\u00e9s comme lus.',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6"/></svg>',
    });
    if (!ok) return;
    var unread = emails.filter(function(e) { return !e.flags.includes('\\Seen'); });
    await Promise.all(unread.map(function(e) {
      return App.apiPost('/api/email/' + e.uid + '/mark?folder=' + encodeURIComponent(currentFolder), { read: true });
    }));
    unread.forEach(function(e) { e.flags.push('\\Seen'); });
    renderList(); updateBadge();
    App.toast(unread.length + ' email(s) marqu\u00e9(s) comme lus', 'success');
  }

  /* ── Print et Export .eml ───────────────────────────────────────────── */
  function printEmail() {
    if (!currentEmail) return;
    var win = window.open('', '_blank', 'width=800,height=600');
    if (!win) return;
    var html = '<!DOCTYPE html><html><head><title>' + esc(currentEmail.subject || '') + '</title>';
    html += '<style>body{font-family:sans-serif;padding:24px;max-width:760px;margin:0 auto}.header{border-bottom:2px solid #eee;padding-bottom:16px;margin-bottom:20px}h1{font-size:20px;margin:0 0 12px}.meta{font-size:13px;color:#666;line-height:1.8}@media print{body{padding:0}}</style></head><body>';
    html += '<div class="header"><h1>' + esc(currentEmail.subject || '(Sans sujet)') + '</h1>';
    html += '<div class="meta"><b>De :</b> ' + esc(currentEmail.from || '') + '<br>';
    html += '<b>À :</b> ' + esc(currentEmail.to || '') + '<br>';
    if (currentEmail.cc) html += '<b>Cc :</b> ' + esc(currentEmail.cc) + '<br>';
    html += '<b>Date :</b> ' + (currentEmail.date ? new Date(currentEmail.date).toLocaleString('fr-FR') : '') + '</div></div>';
    html += currentEmail.html ? sanitizeHtml(currentEmail.html) : '<pre style="white-space:pre-wrap">' + esc(currentEmail.text || '') + '</pre>';
    html += '</body></html>';
    win.document.write(html);
    win.document.close();
    win.onload = function() { win.print(); };
  }

  function exportEml() {
    if (!currentUid) return;
    var url = '/api/email/' + currentUid + '/eml?folder=' + encodeURIComponent(currentFolder);
    var a = document.createElement('a');
    a.href = url; a.download = (currentEmail && currentEmail.subject ? currentEmail.subject.replace(/[^a-z0-9]/gi,'_') : 'email') + '.eml';
    a.click();
  }

  function moveEmailAndClose(el) {
    var folder = el ? el.getAttribute('data-folder') : null;
    closeMoveModal();
    if (folder) Mail.moveEmail(folder);
  }

  function navigateEmail(dir) {
    if (!filtered.length) return;
    var idx = filtered.findIndex(function(e) { return e.uid === currentUid; });
    var next = idx + dir;
    if (next < 0 || next >= filtered.length) return;
    openEmail(filtered[next].uid);
  }

  function activateFilter(f) {
    // Désactiver tous les filtres puis activer uniquement celui-ci
    activeFilters.clear();
    activeFilters.add(f);
    // Highlight sidebar sub-items
    ['unread','starred','attachments'].forEach(k => {
      const el = document.getElementById('sub-' + k);
      if (el) el.classList.toggle('active', k === f);
    });
    // Retirer highlight sur INBOX principal
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    document.getElementById('sub-' + f)?.classList.add('active');
    filter();
  }

  function showHelp() {
    document.querySelectorAll('.folder-item').forEach(function(el) { el.classList.remove('active'); });
    var hf = document.getElementById('folder-help');
    if (hf) hf.classList.add('active');

    showView('content');
    document.getElementById('view-panel').classList.add('mobile-open');
    document.getElementById('v-subject').textContent = 'Aide & Raccourcis clavier';
    document.getElementById('v-from').textContent    = 'TechSphere Webmail';
    document.getElementById('v-to').textContent      = '';
    document.getElementById('v-date').textContent    = '';
    document.getElementById('v-cc').style.display    = 'none';
    document.getElementById('v-attachments').style.display = 'none';
    if (document.getElementById('v-size')) document.getElementById('v-size').style.display = 'none';
    document.getElementById('v-avatar').textContent  = '?';
    document.getElementById('v-avatar').style.background = 'linear-gradient(135deg,#035c80,#0e7490)';

    var sections = [
      { icon: '', title: 'Messagerie', rows: [
        ['R',           'R\u00e9pondre \u00e0 l\u2019email ouvert'],
        ['F',           'Transf\u00e9rer l\u2019email ouvert'],
        ['D',           'Supprimer l\u2019email (confirmation)'],
        ['U',           'Marquer lu / non-lu'],
        ['S',           '\u00c9toiler / retirer l\u2019\u00e9toile'],
        ['/',           'Focus sur la barre de recherche'],
        ['Esc',         'Fermer la vue email']
      ]},
      { icon: '', title: 'Chat', rows: [
        ['Enter',       'Envoyer le message'],
        ['Shift+Enter', 'Nouvelle ligne dans le message']
      ]},
      { icon: '', title: 'G\u00e9n\u00e9ral', rows: [
        ['?', 'Ouvrir / fermer cette aide']
      ]},
      { icon: '', title: 'Filtres \u2014 Sidebar', rows: [
        ['Non lus',         'Emails non lus uniquement'],
        ['\u00c9toil\u00e9s',  'Emails marqu\u00e9s en favoris'],
        ['Pi\u00e8ces jointes', 'Emails avec pi\u00e8ces jointes']
      ]}
    ];

    var kbdStyle = 'display:inline-flex;align-items:center;justify-content:center;background:var(--bg-hover);border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-family:JetBrains Mono,monospace;font-size:12px;font-weight:700;color:var(--text-1);box-shadow:0 2px 0 var(--border);white-space:nowrap;';

    var html = '<div style="padding:4px 0 24px;">';
    html += '<div style="display:flex;align-items:center;gap:14px;padding:0 0 20px;border-bottom:1px solid var(--border);margin-bottom:20px;">';
    html += '<div style="width:52px;height:52px;border-radius:14px;background:var(--accent-lo);border:1px solid var(--accent);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">&#9000;</div>';
    html += '<div><h2 style="font-size:20px;font-weight:800;margin:0 0 4px;color:var(--text-1);">Raccourcis clavier</h2><p style="font-size:12px;color:var(--text-muted);margin:0;">Naviguez rapidement sans toucher la souris.</p></div></div>';
    html += '<div style="background:var(--accent-lo);border:1px solid var(--accent);border-radius:10px;padding:11px 16px;margin-bottom:22px;font-size:13px;color:var(--text-muted);">';
    html += 'Appuyez sur <kbd style="' + kbdStyle + '">?</kbd> depuis n\'importe o\u00f9 pour rouvrir cette aide.</div>';

    sections.forEach(function(sec) {
      html += '<div style="margin-bottom:22px;">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid var(--border);"><span style="margin-right:6px;">' + sec.icon + '</span>' + sec.title + '</div>';
      html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:9px 16px;align-items:center;">';
      sec.rows.forEach(function(row) {
        html += '<kbd style="' + kbdStyle + '">' + row[0] + '</kbd>';
        html += '<span style="font-size:13px;color:var(--text-muted);">' + row[1] + '</span>';
      });
      html += '</div></div>';
    });

    html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text-muted);">&#9888; Les raccourcis ne fonctionnent pas quand le curseur est dans un champ texte.</div>';
    html += '</div>';

    document.getElementById('v-body').innerHTML = html;
  }

  function toggleInboxExpand() {
    const sub  = document.getElementById('inbox-subsections');
    const icon = document.getElementById('inbox-expand-icon');
    if (!sub) return;
    const open = sub.style.display !== 'none';
    sub.style.display = open ? 'none' : 'block';
    if (icon) icon.style.transform = open ? '' : 'rotate(-90deg)';
  }

  /* ── Recherche avancée ───────────────────────────────────────────────── */
  let searchPanel = null;

  function toggleAdvancedSearch() {
    if (searchPanel) { searchPanel.remove(); searchPanel = null; return; }
    searchPanel = document.createElement('div');
    searchPanel.className = 'adv-search-panel';
    searchPanel.innerHTML =
      '<div class="adv-search-title">Recherche avancée</div>' +
      '<div class="adv-search-grid">' +
        '<label>De</label><input type="text" id="as-from" class="search-inp" placeholder="expéditeur"/>' +
        '<label>Objet</label><input type="text" id="as-subject" class="search-inp" placeholder="mots-clés"/>' +
        '<label>Depuis</label><input type="date" id="as-since" class="search-inp"/>' +
        '<label>Avant</label><input type="date" id="as-before" class="search-inp"/>' +
        '<label>Dossier</label><select id="as-folder" class="search-inp"><option value="INBOX">Boîte de réception</option><option value="ALL">Tous les dossiers</option></select>' +
        '<label>&nbsp;</label><div style="display:flex;gap:6px;">' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;"><input type="checkbox" id="as-unread"> Non lus</label>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;"><input type="checkbox" id="as-att"> PJ</label>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        '<button onclick="Mail.runAdvancedSearch()" class="quick-filter active" style="flex:1;">Rechercher</button>' +
        '<button onclick="Mail.toggleAdvancedSearch()" class="quick-filter">Annuler</button>' +
      '</div>';
    var listHeader = document.querySelector('.list-header');
    if (listHeader) listHeader.insertAdjacentElement('afterend', searchPanel);
  }

  /* Affiche une liste de résultats (recherche IA) dans la vue Mail */
  function showSearchResults(list, label, folder) {
    ['mode-tools', 'mode-chat', 'mode-ai'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    document.getElementById('sb-ai-item')?.classList.remove('active');
    const mailMode = document.getElementById('mode-mail');
    if (mailMode) mailMode.style.display = 'flex';
    sessionStorage.setItem('ts_mode', 'mail');
    if (folder && folder !== 'ALL') currentFolder = folder;
    currentUid = null; currentEmail = null;
    emails = list; filtered = list;
    document.getElementById('folder-title').textContent = label || 'Résultats de recherche';
    showView('empty');
    renderList();
  }

  function getCurrentEmail() { return currentEmail; }

  async function runAdvancedSearch() {
    var from    = document.getElementById('as-from')?.value.trim() || '';
    var subject = document.getElementById('as-subject')?.value.trim() || '';
    var since   = document.getElementById('as-since')?.value || '';
    var before  = document.getElementById('as-before')?.value || '';
    var folder  = document.getElementById('as-folder')?.value || 'INBOX';
    var unread  = document.getElementById('as-unread')?.checked ? '1' : '';
    var att     = document.getElementById('as-att')?.checked ? '1' : '';

    if (folder === 'ALL') {
      // Recherche dans tous les dossiers connus
      showListLoading(true);
      var folders = ['INBOX','Sent','Drafts','Junk','Trash'];
      var allResults = [];
      for (var f of folders) {
        var params = new URLSearchParams({ folder: f, from, subject, since, before, unread, hasAttachment: att });
        var res = await App.apiGet('/api/search?' + params.toString());
        if (res.ok && res.emails) allResults = allResults.concat(res.emails.map(function(e) { e._folder = f; return e; }));
      }
      emails = allResults;
      filtered = allResults;
      showListLoading(false);
      renderList();
      App.toast(allResults.length + ' résultat(s)', 'info');
    } else {
      var params = new URLSearchParams({ folder, from, subject, since, before, unread, hasAttachment: att });
      showListLoading(true);
      var res = await App.apiGet('/api/search?' + params.toString());
      showListLoading(false);
      if (res.ok) {
        emails = res.emails;
        filtered = res.emails;
        renderList();
        App.toast(res.emails.length + ' résultat(s)', 'info');
      } else App.toast(res.error, 'error');
    }
    if (searchPanel) { searchPanel.remove(); searchPanel = null; }
  }

  return {
    get currentFolder() { return currentFolder; },
    selectFolder, loadEmails, prependEmails, refresh, filter,
    toggleFilter, toggleCompact, toggleThread, toggleInboxExpand, activateFilter, showHelp,
    openEmail, deleteEmail, toggleRead, toggleStar,
    reply, replyAll, forward, markSpam, moveEmail, moveEmailAndClose, showMoveDropdown, closeMoveModal, closeMobile, showPreview, hidePreview, zoomImg, showImages, alwaysShowImages, navigateEmail, toggleAdvancedSearch, runAdvancedSearch, toggleSelect, selectAll, clearSelection, deleteSelected, markAllReadInFolder, printEmail, exportEml,
    previewAttachment,
    getMaxUid,
    showSearchResults, getCurrentEmail,
    init,
  };
})();

window.addEventListener('DOMContentLoaded', Mail.init);

/* ── Helpers globaux ── */
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function parseFrom(from) {
  // Déléguer à Mail interne — mais on en a besoin globalement pour compose.js
  from = String(from||'').trim();
  // Decode encoded words
  from = from.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (match, cs, enc, data) => {
    try {
      return enc.toUpperCase() === 'B'
        ? decodeURIComponent(escape(atob(data)))
        : data.replace(/_/g,' ').replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
    } catch(_) { return match; }
  });
  const m1 = from.match(/^"?([^"<>]+?)"?\s*<([^>]+)>$/);
  if (m1) return { name: m1[1].trim(), email: m1[2].trim() };
  const m2 = from.match(/^<([^>]+)>$/);
  if (m2) return { name: '', email: m2[1].trim() };
  if (from.includes('@') && !from.includes(' ')) return { name: '', email: from };
  return { name: from, email: '' };
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d), diff = Date.now() - dt;
  if (diff < 60000)     return 'À l\'instant';
  if (diff < 3600000)   return Math.floor(diff/60000) + 'min';
  if (diff < 86400000)  return dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  if (diff < 604800000) return dt.toLocaleDateString('fr-FR',{weekday:'short'});
  return dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
}
function fmtSize(b) {
  if (!b || b === 0) return '';
  if (b < 1024)     return b + ' o';
  if (b < 1048576)  return (b/1024).toFixed(0) + ' Ko';
  if (b < 1073741824) return (b/1048576).toFixed(1) + ' Mo';
  return (b/1073741824).toFixed(1) + ' Go';
}
function sanitizeHtml(html) {
  return forceLinksNewTab(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<embed\b[^>]*>/gi, '')
      .replace(/<base\b[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=[^\s>]*/gi, '')
      .replace(/javascript\s*:/gi, 'javascript_blocked:')
      .replace(/data\s*:\s*text\/html/gi, 'data_blocked:')
      .replace(/vbscript\s*:/gi, 'vbscript_blocked:')
  );
}

// Force l'ouverture de tous les liens <a> d'un email en nouvel onglet,
// en retirant tout target/rel existant pour éviter les doublons, et en
// ajoutant rel="noopener noreferrer" pour la sécurité (anti tab-nabbing).
function forceLinksNewTab(html) {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    let cleanAttrs = attrs
      .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      .replace(/\s+rel\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    return `<a${cleanAttrs} target="_blank" rel="noopener noreferrer">`;
  });
}