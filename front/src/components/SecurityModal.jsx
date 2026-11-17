import React, { useState, useEffect } from "react";
import { 
  Shield, Smartphone, QrCode, Lock, CheckCircle2, 
  AlertTriangle, X, RefreshCw, Trash2, Download, UserCheck, UserX, Key
} from "lucide-react";
import { api } from "../api";

export default function SecurityModal({ isOpen, onClose, token }) {
  const [activeTab, setActiveTab] = useState("2fa"); // 2fa, quick_connect, devices, gdpr
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  // 2FA state
  const [twoFactorStatus, setTwoFactorStatus] = useState({ enabled: false, configured: false });
  const [twoFactorSetup, setTwoFactorSetup] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  // Quick Connect state
  const [quickConnectData, setQuickConnectData] = useState(null);

  // Devices state
  const [devices, setDevices] = useState([]);

  // RGPD export state
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSecurityOverview();
    }
  }, [isOpen]);

  const loadSecurityOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, devList] = await Promise.all([
        api.get2FAStatus().catch(() => ({ enabled: false })),
        api.getDevices().catch(() => []),
      ]);
      setTwoFactorStatus(status);
      setDevices(devList);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 2FA Actions
  const handleStart2FASetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const setup = await api.setup2FA();
      setTwoFactorSetup(setup);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEnable2FA = async (e) => {
    e.preventDefault();
    if (!twoFactorCode) return;
    setLoading(true);
    setError(null);
    try {
      await api.enable2FA(twoFactorCode);
      setTwoFactorStatus({ enabled: true, configured: true });
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setMessage("Double authentification activée avec succès !");
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    const code = prompt("Veuillez saisir votre code d'authentification 2FA pour confirmer la désactivation :");
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      await api.disable2FA(code);
      setTwoFactorStatus({ enabled: false, configured: false });
      setMessage("Double authentification désactivée.");
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Quick Connect Actions
  const handleGenerateQuickConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.quickConnectGenerate();
      setQuickConnectData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Device Actions
  const handleTrustDevice = async (id) => {
    try {
      await api.trustDevice(id);
      await loadSecurityOverview();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleBlockDevice = async (id) => {
    try {
      await api.blockDevice(id);
      await loadSecurityOverview();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRevokeDevice = async (id) => {
    try {
      await api.revokeDevice(id);
      await loadSecurityOverview();
    } catch (e) {
      alert(e.message);
    }
  };

  // RGPD Actions
  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const data = await api.exportGDPRData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `krono_ai_rgpd_export_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      alert(e.message || "Erreur lors de l'export des données");
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm("ATTENTION : Cette action supprimera définitivement votre compte et toutes vos données (événements, contacts, messages). Confirmer ?")) return;
    try {
      await api.deleteAccountGDPR();
      alert("Votre compte a été supprimé. Vous allez être redirigé.");
      api.logout();
      window.location.reload();
    } catch (e) {
      alert(e.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(5, 12, 26, 0.75)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-outline-variant/30 flex flex-col max-h-[90vh]">
        {/* En-tête */}
        <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-950 flex items-center justify-center text-cyan-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-on-surface font-['Sora']">Centre de Sécurité & Accès</h3>
              <p className="text-[11px] text-outline font-mono">Module 2FA, Terminaux & RGPD TechSphere</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-outline hover:text-on-surface p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation des onglets */}
        <div className="flex border-b border-outline-variant/20 px-6 bg-white gap-2">
          <button
            onClick={() => setActiveTab("2fa")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "2fa" ? "border-cyan-600 text-cyan-800 font-bold" : "border-transparent text-outline"
            }`}
          >
            Double Authentification (2FA)
          </button>
          <button
            onClick={() => setActiveTab("quick_connect")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "quick_connect" ? "border-cyan-600 text-cyan-800 font-bold" : "border-transparent text-outline"
            }`}
          >
            Quick Connect (QR)
          </button>
          <button
            onClick={() => setActiveTab("devices")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "devices" ? "border-cyan-600 text-cyan-800 font-bold" : "border-transparent text-outline"
            }`}
          >
            Terminaux ({devices.length})
          </button>
          <button
            onClick={() => setActiveTab("gdpr")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "gdpr" ? "border-cyan-600 text-cyan-800 font-bold" : "border-transparent text-outline"
            }`}
          >
            Conformité RGPD
          </button>
        </div>

        {/* Corps de la modale */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {message && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ─── ONGLET 1 : 2FA / TOTP ─── */}
          {activeTab === "2fa" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <h4 className="text-sm font-bold text-on-surface">Statut de la Double Authentification</h4>
                  <p className="text-xs text-outline mt-0.5">
                    Protégez votre compte avec Google Authenticator ou FreeOTP.
                  </p>
                </div>
                <div>
                  {twoFactorStatus.enabled ? (
                    <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Activé
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-slate-200 text-slate-700 font-medium text-xs">
                      Désactivé
                    </span>
                  )}
                </div>
              </div>

              {!twoFactorStatus.enabled && !twoFactorSetup && (
                <button
                  onClick={handleStart2FASetup}
                  disabled={loading}
                  className="w-full py-3 bg-cyan-700 hover:bg-cyan-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md"
                >
                  <Lock className="w-4 h-4" />
                  <span>Configurer la double authentification</span>
                </button>
              )}

              {twoFactorSetup && (
                <form onSubmit={handleEnable2FA} className="p-5 rounded-2xl border border-cyan-200 bg-cyan-50/40 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-900">
                    Étape 1 : Scanner le QR Code
                  </h4>

                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={twoFactorSetup.qr_uri}
                      alt="QR Code TOTP"
                      className="w-40 h-40 bg-white p-2 rounded-xl border border-slate-200 shadow-sm"
                    />
                    <div className="space-y-2 text-xs text-slate-700">
                      <p>1. Ouvrez Google Authenticator ou FreeOTP sur votre téléphone.</p>
                      <p>2. Scannez ce QR Code ou saisissez la clé manuelle :</p>
                      <code className="p-2 bg-white rounded border border-slate-200 font-mono text-[11px] block break-all font-bold">
                        {twoFactorSetup.secret}
                      </code>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-cyan-200/60">
                    <label className="block text-xs font-bold text-cyan-900 mb-1">
                      Étape 2 : Entrez le code à 6 chiffres
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        required
                        placeholder="123456"
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value)}
                        className="w-36 text-center text-lg font-mono font-bold tracking-widest px-3 py-2 border border-cyan-400 rounded-xl bg-white"
                      />
                      <button
                        type="submit"
                        disabled={loading || twoFactorCode.length !== 6}
                        className="px-5 py-2 bg-cyan-700 hover:bg-cyan-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase"
                      >
                        Valider & Activer
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {twoFactorStatus.enabled && (
                <div className="pt-2">
                  <button
                    onClick={handleDisable2FA}
                    disabled={loading}
                    className="px-4 py-2 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-semibold flex items-center gap-2"
                  >
                    <span>Désactiver le 2FA</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ─── ONGLET 2 : QUICK CONNECT (QR) ─── */}
          {activeTab === "quick_connect" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <h4 className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-cyan-700" />
                  Connexion Rapide par QR Code
                </h4>
                <p className="text-xs text-outline leading-relaxed">
                  Autorisez un nouveau terminal (mobile, tablette ou navigateur) sans avoir à retaper votre mot de passe ni votre code 2FA.
                </p>
              </div>

              {!quickConnectData ? (
                <button
                  onClick={handleGenerateQuickConnect}
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-cyan-700 to-indigo-700 hover:from-cyan-800 hover:to-indigo-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-md"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Générer un QR Code d'invitation</span>
                </button>
              ) : (
                <div className="p-6 rounded-2xl border border-cyan-200 bg-cyan-50/40 text-center space-y-3">
                  <img
                    src={quickConnectData.qr_uri}
                    alt="Quick Connect QR Code"
                    className="w-48 h-48 mx-auto bg-white p-2 rounded-2xl border border-slate-200 shadow-md"
                  />
                  <p className="text-xs text-slate-700 font-medium">
                    Scannez ce QR Code depuis votre nouvel appareil pour vous connecter instantanément.
                  </p>
                  <span className="text-[10px] text-outline font-mono block">
                    Expire dans 5 minutes · Usage unique
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ─── ONGLET 3 : TERMINAUX (DEVICES) ─── */}
          {activeTab === "devices" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-outline border-b pb-2">
                <span>Sessions et appareils associés à votre compte</span>
                <span className="font-mono">{devices.length} terminaux</span>
              </div>

              {devices.map((d) => (
                <div
                  key={d.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-cyan-700" />
                      <span className="text-xs font-bold text-on-surface">{d.device_name}</span>
                      {d.is_current && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 font-bold">
                          Session actuelle
                        </span>
                      )}
                      {d.is_trusted && !d.is_blocked && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                          De confiance
                        </span>
                      )}
                      {d.is_blocked && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold">
                          Bloqué
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-outline mt-1 font-mono">
                      IP : {d.ip_address} · Dernier accès : {d.last_active ? new Date(d.last_active).toLocaleString("fr-FR") : "—"}
                    </p>
                  </div>

                  {!d.is_current && (
                    <div className="flex items-center gap-2 shrink-0">
                      {!d.is_blocked ? (
                        <button
                          onClick={() => handleBlockDevice(d.id)}
                          className="px-2.5 py-1 text-[11px] rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                        >
                          Bloquer
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTrustDevice(d.id)}
                          className="px-2.5 py-1 text-[11px] rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        >
                          Faire confiance
                        </button>
                      )}
                      <button
                        onClick={() => handleRevokeDevice(d.id)}
                        className="px-2.5 py-1 text-[11px] rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Révoquer
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ─── ONGLET 4 : RGPD ─── */}
          {activeTab === "gdpr" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <h4 className="text-sm font-bold text-on-surface">Conformité RGPD & Droits des Utilisateurs</h4>
                <p className="text-xs text-outline leading-relaxed">
                  Conformément au Règlement Général sur la Protection des Données (Articles 17 et 20), vous disposez du plein contrôle sur la portabilité et l'effacement de vos informations.
                </p>
              </div>

              {/* Téléchargement archive */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-bold text-on-surface">Télécharger mes données (Portabilité)</h5>
                  <p className="text-[11px] text-outline mt-0.5">
                    Génère une archive JSON intégrale (profil, événements, contacts, alertes).
                  </p>
                </div>
                <button
                  onClick={handleExportData}
                  disabled={exportLoading}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{exportLoading ? "Génération..." : "Exporter"}</span>
                </button>
              </div>

              {/* Droit à l'oubli */}
              <div className="p-4 rounded-xl border border-red-200 bg-red-50/50 flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-bold text-red-900">Droit à l'effacement (Suppression du compte)</h5>
                  <p className="text-[11px] text-red-700 mt-0.5">
                    Purge définitive et irréversible de votre compte et de l'ensemble de vos données.
                  </p>
                </div>
                <button
                  onClick={handleDeleteAccount}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                >
                  Supprimer
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pied de modal */}
        <div className="p-4 bg-slate-50 border-t border-outline-variant/20 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-outline-variant/40 text-on-surface rounded-xl text-xs font-semibold hover:bg-slate-100 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

