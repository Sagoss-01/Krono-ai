/**
 * public/js/admin-ai.js
 * Onglet « IA » de l'administration : état de la clé et des modèles, interrupteur, quotas,
 * statistiques d'usage, journal d'audit et signalements « réponse ratée ».
 */
const AdminAI = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const root = () => $('adm-panel-ai');
  const fmtDate = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const pct = (x) => (x * 100).toFixed(x > 0 && x < 0.01 ? 1 : 0) + ' %';
  const ms = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms');
  const FEATURES = { assistant: 'Assistant webmail', mail_tools: 'Outils e-mail', whiteboard: 'Tableau blanc', captions: 'Sous-titres', meeting: 'Réunion (actions, quiz…)', meeting_chat: 'Chat IA réunion', meeting_summary: 'Résumé de réunion', health: 'Tests de santé' };
  const ERRORS = { auth_401: 'Clé refusée (401)', credits_402: 'Crédits épuisés (402)', rate_limited: 'Limite du fournisseur (429)', server_5xx: 'Panne du fournisseur (5xx)', timeout: 'Délai dépassé', network: 'Réseau', empty: 'Réponse vide', bad_response: 'Réponse illisible', http_4xx: 'Requête refusée (4xx)', stream: 'Flux interrompu', inconnue: 'Inconnue' };
  let hours = 24;

  const table = (cols, rows, empty = 'Aucune donnée') => rows.length
    ? `<table class="tools-adm-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : `<div class="tools-empty">${esc(empty)}</div>`;

  async function load() {
    const el = root();
    el.innerHTML = '<div class="tools-empty">Chargement…</div>';
    const res = await App.apiGet(`/api/admin/ai/overview?hours=${hours}`);
    if (!res.ok) { el.innerHTML = `<div class="tools-empty">${esc(res.error || 'Erreur de chargement')}</div>`; return; }
    render(res);
    loadAudit(); loadFeedback();
  }

  function modelRole(h, m) {
    const roles = [];
    if (m === h.models.main) roles.push('principal');
    if (h.models.fallbacks.includes(m)) roles.push('secours');
    if (m === h.models.fast) roles.push('rapide');
    return roles.join(' + ') || '—';
  }

  function render({ settings, health, stats }) {
    const h = health;
    const keyState = !h.configured ? ['bad', 'Configuration incomplète (.env)']
      : h.keyProblem === 'auth_401' ? ['bad', 'Clé refusée par OpenRouter']
      : h.keyProblem === 'credits_402' ? ['bad', 'Crédits OpenRouter épuisés']
      : ['ok', 'Clé configurée'];
    const failColor = stats.failureRate > 0.2 ? 'bad' : stats.failureRate > 0.05 ? 'warn' : 'ok';
    const maxHour = Math.max(1, ...stats.perHour.map(p => p.calls));

    root().innerHTML = `
      <div class="adm-ai-grid">
        <section class="adm-ai-card">
          <div class="adm-ai-h"><span>État du service</span><button type="button" class="tools-btn" data-a="test">Tester les modèles</button></div>
          <div class="adm-ai-row"><span class="adm-ai-dot ${keyState[0]}"></span><b>${esc(keyState[1])}</b><span class="adm-ai-sub">${esc(h.baseUrl || '')}</span></div>
          ${h.breakers.map(b => `<div class="adm-ai-row" data-model="${esc(b.model)}">
              <span class="adm-ai-dot ${b.open ? 'bad' : (b.fails ? 'warn' : 'ok')}"></span>
              <b>${esc(b.model)}</b><span class="adm-ai-tag">${esc(modelRole(h, b.model))}</span>
              <span class="adm-ai-sub">${b.open ? `coupé automatiquement (${b.reopenInSec} s) · dernière erreur : ${esc(ERRORS[b.lastError] || b.lastError)}` : (b.fails ? `${b.fails} échec(s) d'affilée · ${esc(ERRORS[b.lastError] || b.lastError)}` : (b.lastOkAt ? 'dernier succès ' + fmtDate(b.lastOkAt) : 'aucun appel depuis le démarrage'))}</span>
              <span class="adm-ai-test" data-test></span></div>`).join('')}
          <div class="adm-ai-hint">En cas d'échec, l'IA bascule d'elle-même sur le modèle suivant ; après 3 échecs d'affilée un modèle est ignoré pendant 60 s.</div>
        </section>

        <section class="adm-ai-card">
          <div class="adm-ai-h"><span>Réglages</span></div>
          <label class="adm-ai-switch"><input type="checkbox" id="adm-ai-enabled" ${settings.enabled ? 'checked' : ''}> <span>IA activée pour tous les utilisateurs</span></label>
          <label class="adm-ai-field">Message affiché quand l'IA est coupée
            <input type="text" id="adm-ai-message" maxlength="300" placeholder="Ex : Maintenance jusqu'à 18 h." value="${esc(settings.message)}"></label>
          <label class="adm-ai-field">Quota par utilisateur et par jour (0 = illimité)
            <input type="number" id="adm-ai-quota" min="0" max="100000" value="${Number(settings.dailyCallsPerUser)}"></label>
          <div class="adm-ai-actions"><span id="adm-ai-saved" class="adm-ai-sub"></span><button type="button" class="tools-btn primary" data-a="save">Enregistrer</button></div>
        </section>
      </div>

      <div class="adm-ai-period">Période :
        ${[[24, '24 h'], [168, '7 jours'], [720, '30 jours']].map(([v, l]) => `<button type="button" class="adm-ai-chip ${v === stats.hours ? 'on' : ''}" data-hours="${v}">${l}</button>`).join('')}
      </div>

      <div class="adm-ai-kpis">
        <div class="adm-ai-kpi"><div class="v">${stats.calls}</div><div class="l">Appels</div></div>
        <div class="adm-ai-kpi ${failColor}"><div class="v">${pct(stats.failureRate)}</div><div class="l">Taux d'échec (${stats.failures})</div></div>
        <div class="adm-ai-kpi"><div class="v">${ms(stats.latency.p50)}</div><div class="l">Latence médiane</div></div>
        <div class="adm-ai-kpi"><div class="v">${ms(stats.latency.p95)}</div><div class="l">Latence p95</div></div>
        <div class="adm-ai-kpi"><div class="v">${stats.tokens.toLocaleString('fr-FR')}</div><div class="l">Jetons</div></div>
      </div>

      ${stats.perHour.length ? `<div class="adm-ai-chart" role="img" aria-label="Appels par heure">${stats.perHour.map(p => `<div class="adm-ai-bar" title="${esc(p.slot)} : ${p.calls} appel(s), ${p.failures} échec(s)"><i style="height:${Math.max(4, (p.calls / maxHour) * 100)}%"><b style="height:${p.calls ? (p.failures / p.calls) * 100 : 0}%"></b></i></div>`).join('')}</div>` : ''}

      <div class="adm-ai-grid">
        <section class="adm-ai-card"><div class="adm-ai-h"><span>Usage par utilisateur</span></div>
          ${table(['Utilisateur', 'Appels', 'Échecs', 'Jetons'], stats.byUser.map(u => [esc(u.user), u.calls, u.failures, (u.tokens || 0).toLocaleString('fr-FR')]))}</section>
        <section class="adm-ai-card"><div class="adm-ai-h"><span>Par fonctionnalité</span></div>
          ${table(['Fonction', 'Appels', 'Échecs', 'Durée moy.'], stats.byFeature.map(f => [esc(FEATURES[f.feature] || f.feature), f.calls, f.failures, ms(f.avg_ms)]))}</section>
        <section class="adm-ai-card"><div class="adm-ai-h"><span>Par modèle</span></div>
          ${table(['Modèle', 'Appels', 'Échecs', 'Durée moy.'], stats.byModel.map(m => [esc(m.model || '—'), m.calls, m.failures, ms(m.avg_ms)]))}</section>
        <section class="adm-ai-card"><div class="adm-ai-h"><span>Causes d'échec</span></div>
          ${table(['Cause', 'Nombre'], stats.errors.map(e => [esc(ERRORS[e.code] || e.code), e.n]), 'Aucun échec sur la période')}</section>
      </div>

      <section class="adm-ai-card"><div class="adm-ai-h"><span>Journal d'audit des actions IA</span></div><div id="adm-ai-audit" class="tools-empty">Chargement…</div></section>
      <section class="adm-ai-card"><div class="adm-ai-h"><span>Réponses signalées</span><a class="tools-btn" href="/api/admin/ai/feedback/cases" download>Télécharger les cas (JSON)</a></div><div id="adm-ai-feedback" class="tools-empty">Chargement…</div></section>`;

    root().querySelector('[data-a=test]').addEventListener('click', runTest);
    root().querySelector('[data-a=save]').addEventListener('click', save);
    root().querySelectorAll('[data-hours]').forEach(b => b.addEventListener('click', () => { hours = Number(b.dataset.hours); load(); }));
  }

  async function runTest(e) {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Test en cours…';
    root().querySelectorAll('[data-test]').forEach(s => { s.textContent = '…'; s.className = 'adm-ai-test'; });
    const res = await App.apiPost('/api/admin/ai/test', {});
    btn.disabled = false; btn.textContent = 'Tester les modèles';
    if (!res.ok) { App.toast(res.error || 'Test impossible', 'error'); return; }
    res.results.forEach(r => {
      const row = [...root().querySelectorAll('[data-model]')].find(x => x.dataset.model === r.model);
      const s = row?.querySelector('[data-test]');
      if (s) { s.textContent = r.ok ? `✓ ${ms(r.latencyMs)}` : `✗ ${ERRORS[r.code] || r.error}`; s.className = 'adm-ai-test ' + (r.ok ? 'ok' : 'bad'); }
    });
    App.toast(res.results.every(r => r.ok) ? 'Tous les modèles répondent' : 'Au moins un modèle ne répond pas', res.results.every(r => r.ok) ? 'success' : 'error');
  }

  async function save(e) {
    const btn = e.currentTarget; btn.disabled = true;
    const enabled = $('adm-ai-enabled').checked;
    if (!enabled) {
      const go = await ConfirmModal.show({ title: "Couper l'IA ?", body: "Tous les utilisateurs perdront l'accès à l'assistant, aux résumés, au tableau blanc IA et aux outils e-mail jusqu'à ce que vous la réactiviez.", danger: true });
      if (!go) { btn.disabled = false; return; }
    }
    const res = await App.apiPost('/api/admin/ai/settings', { enabled, message: $('adm-ai-message').value, dailyCallsPerUser: $('adm-ai-quota').value });
    btn.disabled = false;
    if (!res.ok) { App.toast(res.error || 'Enregistrement impossible', 'error'); return; }
    $('adm-ai-saved').textContent = 'Enregistré · ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    App.toast(res.settings.enabled ? 'Réglages enregistrés' : "IA désactivée pour tous", 'success');
  }

  async function loadAudit() {
    const el = $('adm-ai-audit'); if (!el) return;
    const res = await App.apiGet('/api/admin/ai/audit?limit=60');
    el.className = '';
    el.innerHTML = res.ok ? table(['Date', 'Utilisateur', 'Action', 'Détail'], res.entries.map(a => [fmtDate(a.ts), esc(a.user), esc(a.label), esc(a.detail)]), 'Aucune action enregistrée') : `<div class="tools-empty">${esc(res.error || 'Erreur')}</div>`;
  }

  async function loadFeedback() {
    const el = $('adm-ai-feedback'); if (!el) return;
    const res = await App.apiGet('/api/admin/ai/feedback?limit=30');
    el.className = '';
    if (!res.ok) { el.innerHTML = `<div class="tools-empty">${esc(res.error || 'Erreur')}</div>`; return; }
    el.innerHTML = res.items.length ? res.items.map(f => `<details class="adm-ai-fb"><summary><b>${esc(FEATURES[f.feature] || f.feature)}</b> · ${esc(f.user)} · ${fmtDate(f.ts)}${f.note ? ' — ' + esc(f.note) : ''}</summary>
        <div class="adm-ai-fbq"><b>Demande</b><pre>${esc(f.prompt)}</pre><b>Réponse de l'IA</b><pre>${esc(f.response)}</pre></div></details>`).join('') : '<div class="tools-empty">Aucun signalement</div>';
  }

  return { load };
})();
