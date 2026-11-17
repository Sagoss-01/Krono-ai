import React, { useState, useEffect } from "react";
import { 
  Shield, Users, Activity, Settings, RefreshCw, AlertTriangle, 
  Check, X, Lock, Unlock, UserCheck, UserX, Cpu, ThumbsUp, ThumbsDown
} from "lucide-react";
import { api } from "../api";

export default function AdminTab({ token }) {
  const [activeSubTab, setActiveSubTab] = useState("overview"); // overview, users, audit, ai_settings
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Données
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [aiSettings, setAiSettings] = useState({ default_model: "", system_prompt: "", temperature: 0.2 });
  const [feedbacks, setFeedbacks] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchAllAdminData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, us, au, ai, fb] = await Promise.all([
        api.getAdminOverview().catch(() => null),
        api.getAdminUsers().catch(() => []),
        api.getAdminAudit().catch(() => []),
        api.getAdminAiSettings().catch(() => ({})),
        api.getAdminAiFeedbacks().catch(() => []),
      ]);
      setOverview(ov);
      setUsers(us);
      setAuditLogs(au);
      setAiSettings(ai);
      setFeedbacks(fb);
    } catch (e) {
      setError(e.message || "Erreur de chargement des données administrateur.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllAdminData();
  }, [token]);

  const handleSuspendUser = async (userId) => {
    setActionLoading(true);
    try {
      await api.suspendUser(userId);
      await fetchAllAdminData();
    } catch (e) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsuspendUser = async (userId) => {
    setActionLoading(true);
    try {
      await api.unsuspendUser(userId);
      await fetchAllAdminData();
    } catch (e) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleAdmin = async (userId) => {
    setActionLoading(true);
    try {
      await api.toggleAdminRole(userId);
      await fetchAllAdminData();
    } catch (e) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveAiSettings = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    setSaveSuccess(false);
    try {
      await api.updateAdminAiSettings(aiSettings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-outline">
        <RefreshCw className="w-6 h-6 animate-spin text-primary mr-2" />
        <span>Chargement du panneau superviseur...</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
      {/* Header Panneau Superviseur */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
        <div>
          <h2 className="text-2xl font-bold font-['Sora'] text-on-surface flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-amber-600" />
            Panneau d'Administration & Supervision
          </h2>
          <p className="text-xs text-outline font-mono mt-1">
            Gouvernance globale, audit de sécurité et paramétrage du moteur IA.
          </p>
        </div>

        <button
          onClick={fetchAllAdminData}
          disabled={loading || actionLoading}
          className="px-3.5 py-2 bg-surface hover:bg-surface-container border border-outline-variant/40 rounded-xl text-xs font-semibold text-on-surface flex items-center gap-2 transition-all shadow-sm active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sous-onglets Admin */}
      <div className="flex border-b border-outline-variant/30 gap-2">
        <button
          onClick={() => setActiveSubTab("overview")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeSubTab === "overview"
              ? "border-amber-600 text-amber-700 font-bold"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          Vue d'ensemble
        </button>
        <button
          onClick={() => setActiveSubTab("users")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeSubTab === "users"
              ? "border-amber-600 text-amber-700 font-bold"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          Utilisateurs ({users.length})
        </button>
        <button
          onClick={() => setActiveSubTab("audit")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeSubTab === "audit"
              ? "border-amber-600 text-amber-700 font-bold"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          Audit & Journaux ({auditLogs.length})
        </button>
        <button
          onClick={() => setActiveSubTab("ai_settings")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeSubTab === "ai_settings"
              ? "border-amber-600 text-amber-700 font-bold"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          Configuration IA & Feedbacks
        </button>
      </div>

      {/* ─── VUE D'ENSEMBLE (OVERVIEW) ─── */}
      {activeSubTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-outline-variant/30 shadow-sm">
              <div className="flex items-center justify-between text-outline text-xs">
                <span>Utilisateurs</span>
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div className="text-2xl font-bold font-mono text-on-surface mt-2">
                {overview?.kpis?.total_users || 0}
              </div>
              <span className="text-[10px] text-emerald-600 font-medium">Actifs en base</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-outline-variant/30 shadow-sm">
              <div className="flex items-center justify-between text-outline text-xs">
                <span>Événements gérés</span>
                <Activity className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-on-surface mt-2">
                {overview?.kpis?.total_events || 0}
              </div>
              <span className="text-[10px] text-outline font-medium">Contraintes Hard & Soft</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-outline-variant/30 shadow-sm">
              <div className="flex items-center justify-between text-outline text-xs">
                <span>Mails Inbox analysés</span>
                <Activity className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-on-surface mt-2">
                {overview?.kpis?.total_messages_analyzed || 0}
              </div>
              <span className="text-[10px] text-blue-600 font-medium">Google / Outlook</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-outline-variant/30 shadow-sm">
              <div className="flex items-center justify-between text-outline text-xs">
                <span>Alertes de doublons</span>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold font-mono text-on-surface mt-2">
                {overview?.kpis?.total_duplicate_alerts || 0}
              </div>
              <span className="text-[10px] text-amber-600 font-medium">Résolus par l'IA</span>
            </div>
          </div>

          {/* État système TechSphere */}
          <div className="bg-white p-6 rounded-2xl border border-outline-variant/30 shadow-sm space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-600" />
              Architecture Système & Moteurs d'Inférence
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-outline block text-[10px] uppercase font-mono">Orchestration & Workflow</span>
                <span className="font-semibold text-slate-800">{overview?.system?.llm_engine || "LangGraph + Gemini"}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-outline block text-[10px] uppercase font-mono">Persistance & Transactions</span>
                <span className="font-semibold text-slate-800">{overview?.system?.db_type || "PostgreSQL Async"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── UTILISATEURS (USERS) ─── */}
      {activeSubTab === "users" && (
        <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between">
            <h3 className="font-bold text-sm text-on-surface">Gestion des Comptes</h3>
            <span className="text-xs text-outline">{users.length} comptes enregistrés</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-outline border-b border-outline-variant/20 uppercase font-mono text-[10px]">
                <tr>
                  <th className="p-3">Utilisateur</th>
                  <th className="p-3">Rôle</th>
                  <th className="p-3">Statut</th>
                  <th className="p-3">2FA</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20 font-sans">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3">
                      <div className="font-semibold text-on-surface">{u.full_name}</div>
                      <div className="text-[11px] text-outline font-mono">{u.email}</div>
                    </td>
                    <td className="p-3">
                      {u.is_admin ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px] uppercase">
                          Admin
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] uppercase">
                          Utilisateur
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {u.is_suspended ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold text-[10px]">
                          Suspendu
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[10px]">
                          Actif
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`text-[11px] font-mono ${u.two_factor_enabled ? "text-emerald-600 font-bold" : "text-outline"}`}>
                        {u.two_factor_enabled ? "Actif (TOTP)" : "Non"}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => handleToggleAdmin(u.id)}
                        disabled={actionLoading}
                        className="px-2 py-1 rounded-lg border border-outline-variant/40 hover:bg-slate-100 text-[11px] font-medium transition-all"
                        title="Basculer le rôle Admin"
                      >
                        {u.is_admin ? "Rétrograder" : "Nommer Admin"}
                      </button>
                      {u.is_suspended ? (
                        <button
                          onClick={() => handleUnsuspendUser(u.id)}
                          disabled={actionLoading}
                          className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-[11px] font-medium"
                        >
                          Réactiver
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSuspendUser(u.id)}
                          disabled={actionLoading}
                          className="px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-[11px] font-medium"
                        >
                          Suspendre
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── AUDIT & JOURNAUX (AUDIT) ─── */}
      {activeSubTab === "audit" && (
        <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between">
            <h3 className="font-bold text-sm text-on-surface">Journaux d'Audit de Sécurité</h3>
            <span className="text-[11px] text-outline font-mono">Derniers 50 événements</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-outline border-b border-outline-variant/20 uppercase font-mono text-[10px]">
                <tr>
                  <th className="p-3">Horodatage</th>
                  <th className="p-3">Utilisateur</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Détails</th>
                  <th className="p-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20 font-mono text-[11px]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="p-3 text-outline">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString("fr-FR") : "—"}
                    </td>
                    <td className="p-3 font-sans font-medium text-on-surface">{log.user_email}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 font-sans text-slate-600">{log.details || log.target || "—"}</td>
                    <td className="p-3 text-outline">{log.ip_address || "127.0.0.1"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── CONFIGURATION IA & FEEDBACKS ─── */}
      {activeSubTab === "ai_settings" && (
        <div className="space-y-6">
          <form onSubmit={handleSaveAiSettings} className="bg-white p-6 rounded-2xl border border-outline-variant/30 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-on-surface uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />
              Configuration du Modèle & Prompts Système
            </h3>

            <div>
              <label className="block text-xs font-semibold text-outline uppercase mb-1">Modèle LLM</label>
              <input
                type="text"
                value={aiSettings.default_model || ""}
                onChange={(e) => setAiSettings({ ...aiSettings, default_model: e.target.value })}
                className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs font-mono"
                placeholder="gemini-2.5-flash ou openrouter/auto"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-outline uppercase mb-1">Prompt Système (Aura)</label>
              <textarea
                rows={3}
                value={aiSettings.system_prompt || ""}
                onChange={(e) => setAiSettings({ ...aiSettings, system_prompt: e.target.value })}
                className="w-full px-3 py-2 border border-outline-variant/60 rounded-xl text-xs"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="submit"
                disabled={actionLoading}
                className="px-5 py-2.5 bg-primary hover:bg-blue-700 text-white font-semibold rounded-xl text-xs shadow-sm active:scale-95 transition-all flex items-center gap-2"
              >
                {actionLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Enregistrer la configuration</span>
              </button>

              {saveSuccess && (
                <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                  <Check className="w-4 h-4" /> Paramètres mis à jour !
                </span>
              )}
            </div>
          </form>

          {/* Liste des feedbacks utilisateurs */}
          <div className="bg-white p-6 rounded-2xl border border-outline-variant/30 shadow-sm space-y-3">
            <h3 className="font-bold text-sm text-on-surface uppercase tracking-wider flex items-center gap-2">
              <ThumbsUp className="w-4 h-4 text-emerald-600" />
              Retours Utilisateurs sur l'Assistant ({feedbacks.length})
            </h3>
            {feedbacks.length === 0 ? (
              <p className="text-xs text-outline italic">Aucun feedback enregistré pour le moment.</p>
            ) : (
              <div className="divide-y divide-outline-variant/20">
                {feedbacks.map((f) => (
                  <div key={f.id} className="py-2.5 flex items-start justify-between gap-4">
                    <div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        f.feedback_type === "positive" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                      }`}>
                        {f.feedback_type === "positive" ? "Utile" : "À améliorer"}
                      </span>
                      <p className="text-xs text-on-surface mt-1">{f.comment || "Pas de commentaire textuel"}</p>
                    </div>
                    <span className="text-[10px] text-outline font-mono">
                      {f.created_at ? new Date(f.created_at).toLocaleDateString("fr-FR") : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

