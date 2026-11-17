const activityLog = require('../services/activityLogService');
const adminService = require('../services/adminService');
const adminMailService = require('../services/adminMailService');
const { pool } = require('../services/db');

function activeEmail(req) {
  return req.session.activeAccount || req.session.accounts?.[0]?.email;
}

// GET /api/admin/status — utilisé par le client pour savoir s'il doit
// afficher la section Administration dans la sidebar.
async function status(req, res) {
  const email = activeEmail(req);
  const admin = await adminService.isAdmin(email);
  res.json({ ok: true, isAdmin: admin });
}

async function overview(req, res) {
  try {
    const stats = await activityLog.getStats();
    const [[{ cnt: liveMeetings }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM meetings WHERE status = 'live'`);
    const [[{ cnt: scheduledMeetings }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM meetings WHERE status = 'scheduled'`);
    const [[{ cnt: suspendedCount }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM account_status WHERE status='suspended'`);
    res.json({ ok: true, stats: { ...stats, liveMeetings, scheduledMeetings, suspendedCount } });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function activity(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ ok: true, activity: await activityLog.getRecent(limit) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function accounts(req, res) {
  try {
    const rows = await activityLog.getAccountsOverview();
    const [statusRows] = await pool.query('SELECT email, status, reason FROM account_status');
    const statusMap = Object.fromEntries(statusRows.map(r => [r.email, r]));
    const merged = rows.map(r => ({ ...r, status: statusMap[r.email]?.status || 'active', reason: statusMap[r.email]?.reason || null }));
    res.json({ ok: true, accounts: merged });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function meetings(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, host, status, access, parent_meeting_id, scheduled_at, started_at
       FROM meetings WHERE status IN ('live','scheduled')
       ORDER BY (status = 'live') DESC, COALESCE(started_at, scheduled_at) DESC LIMIT 200`
    );
    res.json({ ok: true, meetings: rows });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// ── Gestion des administrateurs ─────────────────────────────────────────────
async function listAdmins(req, res) {
  try { res.json({ ok: true, admins: await adminService.listAdmins() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
}

async function addAdmin(req, res) {
  const me = activeEmail(req);
  const { email } = req.body || {};
  if (!email) return res.json({ ok: false, error: 'Email requis' });
  try {
    await adminService.addAdmin(email.trim().toLowerCase(), me);
    activityLog.log(me, 'admin_added', { detail: email });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function removeAdminRoute(req, res) {
  const me = activeEmail(req);
  const target = req.params.email;
  try {
    await adminService.removeAdmin(target);
    activityLog.log(me, 'admin_removed', { detail: target });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'LAST_ADMIN') return res.json({ ok: false, error: e.message });
    res.json({ ok: false, error: e.message });
  }
}

// ── Gestion des comptes ──────────────────────────────────────────────────────
async function suspendAccount(req, res) {
  const me = activeEmail(req);
  const target = req.params.email;
  const { reason } = req.body || {};
  if (target.toLowerCase() === me.toLowerCase()) return res.json({ ok: false, error: 'Tu ne peux pas suspendre ton propre compte' });

  try {
    await adminService.suspendAccount(target, reason, me);
    activityLog.log(me, 'account_suspended', { detail: `${target} — ${reason || 'sans motif'}` });
    try { await adminMailService.sendSuspensionNotice({ to: target, reason }); }
    catch (e) { console.error('[Admin] Notification suspension échouée:', e.message); }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

async function unsuspendAccount(req, res) {
  const me = activeEmail(req);
  const target = req.params.email;
  try {
    await adminService.unsuspendAccount(target, me);
    activityLog.log(me, 'account_unsuspended', { detail: target });
    try { await adminMailService.sendReactivationNotice({ to: target }); }
    catch (e) { console.error('[Admin] Notification réactivation échouée:', e.message); }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

// Suppression réelle et définitive de la boîte mail — irréversible.
async function deleteAccount(req, res) {
  const me = activeEmail(req);
  const target = req.params.email;
  if (target.toLowerCase() === me.toLowerCase()) return res.json({ ok: false, error: 'Tu ne peux pas supprimer ton propre compte' });

  try {
    // On notifie AVANT de supprimer la boîte — après, l'email n'existe plus pour le recevoir.
    await adminMailService.sendAccountDeletedNotice({ to: target });
    await adminService.deleteMailbox(target);
    await adminService.purgeAccountRecords(target);
    activityLog.log(me, 'account_deleted', { detail: target });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}

module.exports = {
  status, overview, activity, accounts, meetings,
  listAdmins, addAdmin, removeAdminRoute,
  suspendAccount, unsuspendAccount, deleteAccount,
};
