import React, { useEffect, useState } from "react";
import { Check, RefreshCw, AlertTriangle } from "lucide-react";
import { api, getApiUrl } from "../api";

/**
 * Compte Google : liaison, autorisation Gmail, import de l'agenda.
 * La liaison ouvre la page de consentement Google ; au retour, le statut est relu.
 */
export default function GoogleAccountCard({ token, onImported }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      setStatus(await api.googleStatus());
    } catch (e) {
      setStatus({ connected: false, error: e.message });
    }
  };

  useEffect(() => { load(); }, [token]);

  const link = () => {
    window.location.href = `${getApiUrl()}/calendar/auth/google/login?token=${token}`;
  };

  const importAgenda = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await api.syncCalendars();
      setMessage(`${res.imported ?? 0} événement(s) importé(s) depuis Google Agenda.`);
      onImported?.();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const connected = !!status?.connected;

  return (
    <div className="flex flex-col gap-2 p-sm rounded border border-outline-variant bg-surface-container-low">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-on-surface block">Google (Agenda et Gmail)</span>
          {connected && <span className="text-[11px] text-outline">{status.email}</span>}
        </div>
        {connected ? (
          <span className="text-[10px] font-geist text-secondary flex items-center gap-1 uppercase font-bold">
            <Check className="w-3.5 h-3.5" /> Lié
          </span>
        ) : (
          <button onClick={link} className="px-3 py-1 bg-primary text-white text-xs font-medium rounded hover:bg-blue-700 transition-all">
            Lier
          </button>
        )}
      </div>

      {connected && (
        <>
          <div className="text-[11px] flex items-center gap-1.5">
            {status.gmail_ready ? (
              <span className="text-emerald-700 flex items-center gap-1"><Check className="w-3 h-3" /> Gmail autorisé : lecture et envoi d'e-mails</span>
            ) : (
              <span className="text-amber-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Gmail non autorisé : reconnectez Google et acceptez l'accès à Gmail.
                <button onClick={link} className="underline ml-1">Reconnecter</button>
              </span>
            )}
          </div>
          <button
            onClick={importAgenda}
            disabled={busy}
            className="self-start px-3 py-1.5 bg-outline-variant/20 hover:bg-outline-variant/30 text-on-surface text-xs font-semibold rounded flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} /> Importer mon agenda Google
          </button>
        </>
      )}
      {message && <p className="text-[11px] text-outline">{message}</p>}
    </div>
  );
}
