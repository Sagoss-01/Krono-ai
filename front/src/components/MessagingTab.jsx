import React, { useState, useEffect } from "react";
import { 
  Mail, MessageSquare, Send, Clock, Trash2, CheckCircle2, 
  AlertTriangle, RefreshCw, Calendar, User, Search, Plus
} from "lucide-react";
import { api } from "../api";
import MailboxPanel from "./MailboxPanel";

export default function MessagingTab({ token, contacts = [], onEventCreated }) {
  const [subTab, setSubTab] = useState("inbox"); // inbox, compose, scheduled, mailbox
  const [inboxMessages, setInboxMessages] = useState([]);
  const [scheduledMessages, setScheduledMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Formulaire d'envoi / programmation
  const [recipient, setRecipient] = useState("");
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(null);

  const fetchInboxAndScheduled = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Inbox
      const inboxData = await api.getInboxMessages().catch(() => []);
      setInboxMessages(Array.isArray(inboxData) ? inboxData : []);

      // 2. Scheduled
      const sched = await api.getScheduledMessages().catch(() => []);
      setScheduledMessages(Array.isArray(sched) ? sched : []);
    } catch (e) {
      setError("Erreur lors de la récupération des messages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInboxAndScheduled();
  }, [token]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!recipient || !body) {
      alert("Veuillez renseigner un destinataire et un contenu.");
      return;
    }

    setSending(true);
    setSendSuccess(null);
    try {
      if (isScheduled) {
        if (!scheduledDate || !scheduledTime) {
          throw new Error("Veuillez indiquer la date et l'heure pour l'envoi programmé.");
        }
        const scheduledIso = `${scheduledDate}T${scheduledTime}:00`;
        const res = await api.scheduleMessage(recipient, channel, subject, body, scheduledIso);
        setSendSuccess(`Message programmé avec succès pour le ${scheduledDate} à ${scheduledTime}.`);
      } else {
        const res = await api.sendMessage(channel, recipient, subject, body);
        setSendSuccess(`Message ${channel.toUpperCase()} expédié avec succès.`);
      }

      // Réinitialiser
      setRecipient("");
      setSubject("");
      setBody("");
      setIsScheduled(false);
      await fetchInboxAndScheduled();
      setTimeout(() => setSendSuccess(null), 4000);
    } catch (e) {
      alert(e.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const handleCancelScheduled = async (id) => {
    if (!confirm("Voulez-vous vraiment annuler cet envoi programmé ?")) return;
    try {
      await api.cancelScheduledMessage(id);
      await fetchInboxAndScheduled();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleAcceptInboxEvent = async (msg) => {
    if (!msg.event_title || !msg.event_date) return;
    try {
      const startTime = `${msg.event_date}T${msg.event_time || "09:00"}:00`;
      const endTime = `${msg.event_date}T10:00:00`;
      await api.createEvent(msg.event_title, startTime, endTime, "soft", msg.event_location || "Lieu convenu par mail");
      alert(`Événement "${msg.event_title}" ajouté avec succès à votre agenda !`);
      if (onEventCreated) onEventCreated();
    } catch (e) {
      alert(e.message || "Erreur lors de l'ajout au calendrier");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
        <div>
          <h2 className="text-2xl font-bold font-['Sora'] text-on-surface flex items-center gap-2.5">
            <Mail className="w-6 h-6 text-primary" />
            Messagerie & Communications Intelligentes
          </h2>
          <p className="text-xs text-outline font-mono mt-1">
            Détection automatique d'événements, synchronisation Google/Outlook et envois différés.
          </p>
        </div>

        <button
          onClick={fetchInboxAndScheduled}
          disabled={loading}
          className="px-3.5 py-2 bg-surface hover:bg-surface-container border border-outline-variant/40 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Navigation sous-onglets */}
      <div className="flex border-b border-outline-variant/30 gap-2">
        <button
          onClick={() => setSubTab("inbox")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            subTab === "inbox" ? "border-primary text-primary font-bold" : "border-transparent text-outline"
          }`}
        >
          Boîte de Réception ({inboxMessages.length})
        </button>
        <button
          onClick={() => setSubTab("compose")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            subTab === "compose" ? "border-primary text-primary font-bold" : "border-transparent text-outline"
          }`}
        >
          Nouveau Message & Programmation
        </button>
        <button
          onClick={() => setSubTab("scheduled")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            subTab === "scheduled" ? "border-primary text-primary font-bold" : "border-transparent text-outline"
          }`}
        >
          Envois Différés ({scheduledMessages.length})
        </button>
        <button
          onClick={() => setSubTab("mailbox")}
          className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            subTab === "mailbox" ? "border-primary text-primary font-bold" : "border-transparent text-outline"
          }`}
        >
          Boîtes mail & IA
        </button>
      </div>

      {/* ─── 4. BOÎTES MAIL LIÉES & ASSISTANCE IA ─── */}
      {subTab === "mailbox" && <MailboxPanel />}

      {/* ─── 1. BOÎTE DE RÉCEPTION & DÉTECTION ÉVÉNEMENTS ─── */}
      {subTab === "inbox" && (
        <div className="space-y-4">
          {inboxMessages.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-outline-variant/30 text-center space-y-2">
              <Mail className="w-8 h-8 text-outline mx-auto" />
              <p className="text-sm font-semibold text-on-surface">Aucun message pour le moment</p>
              <p className="text-xs text-outline max-w-sm mx-auto">
                Connectez vos comptes Google ou Outlook dans les Préférences pour analyser vos emails entrants.
              </p>
            </div>
          ) : (
            inboxMessages.map((msg) => (
              <div
                key={msg.id}
                className="bg-white p-5 rounded-2xl border border-outline-variant/30 shadow-sm hover:shadow-md transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {msg.provider || "Email"}
                    </span>
                    <h4 className="text-sm font-bold text-on-surface mt-1">{msg.subject || "(Sans objet)"}</h4>
                    <p className="text-xs text-outline">De : {msg.sender || "Expéditeur inconnu"}</p>
                  </div>
                  {msg.contains_event && (
                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Événement détecté
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 italic">
                  "{msg.snippet || msg.body_text || "..."}"
                </p>

                {msg.contains_event && (
                  <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-50/50 p-3 rounded-xl border border-emerald-200">
                    <div>
                      <span className="text-xs font-bold text-emerald-900 block">{msg.event_title}</span>
                      <span className="text-[11px] text-emerald-700 font-mono">
                        Date : {msg.event_date} à {msg.event_time || "09:00"} {msg.event_location ? `· ${msg.event_location}` : ""}
                      </span>
                    </div>

                    <button
                      onClick={() => handleAcceptInboxEvent(msg)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all w-fit"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Ajouter au planning</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── 2. NOUVEAU MESSAGE & ENVOI DIFFÉRÉ ─── */}
      {subTab === "compose" && (
        <form onSubmit={handleSendMessage} className="bg-white p-6 rounded-2xl border border-outline-variant/30 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
            <h3 className="font-bold text-sm text-on-surface">Rédiger & Planifier un Message</h3>
            
            {/* Choix Canal */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChannel("email")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  channel === "email" ? "bg-primary text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Email
              </button>
              <button
                type="button"
                onClick={() => setChannel("whatsapp")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  channel === "whatsapp" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
              </button>
            </div>
          </div>

          {sendSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{sendSuccess}</span>
            </div>
          )}

          {/* Destinataire */}
          <div>
            <label className="block text-xs font-semibold text-outline uppercase mb-1">
              Destinataire ({channel === "whatsapp" ? "Numéro WhatsApp" : "Email"})
            </label>
            <div className="flex gap-2">
              <input
                type={channel === "whatsapp" ? "tel" : "email"}
                required
                placeholder={channel === "whatsapp" ? "+33612345678" : "destinataire@exemple.com"}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="flex-1 px-3 py-2.5 text-xs border border-outline-variant/60 rounded-xl"
              />
              {contacts.length > 0 && (
                <select
                  onChange={(e) => {
                    const ct = contacts.find((c) => c.id === e.target.value);
                    if (ct) {
                      setRecipient(channel === "whatsapp" ? (ct.phone_number || "") : (ct.email || ""));
                    }
                  }}
                  className="px-3 py-2 text-xs border border-outline-variant/60 rounded-xl bg-slate-50 text-slate-700"
                >
                  <option value="">Sélectionner un contact...</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.is_favorite ? "⭐" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Objet si email */}
          {channel === "email" && (
            <div>
              <label className="block text-xs font-semibold text-outline uppercase mb-1">Objet</label>
              <input
                type="text"
                placeholder="Objet du message..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2.5 text-xs border border-outline-variant/60 rounded-xl"
              />
            </div>
          )}

          {/* Corps du message */}
          <div>
            <label className="block text-xs font-semibold text-outline uppercase mb-1">Message</label>
            <textarea
              required
              rows={4}
              placeholder="Contenu du message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2.5 text-xs border border-outline-variant/60 rounded-xl"
            />
          </div>

          {/* Option Envoi Différé */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>Programmer l'envoi à une date/heure ultérieure (Scheduled Message)</span>
            </label>

            {isScheduled && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-[11px] text-outline mb-1 font-mono uppercase">Date</label>
                  <input
                    type="date"
                    required={isScheduled}
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-outline-variant/60 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-outline mb-1 font-mono uppercase">Heure</label>
                  <input
                    type="time"
                    required={isScheduled}
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-outline-variant/60 rounded-lg bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bouton d'action */}
          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={sending}
              className="px-6 py-3 bg-primary hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-md active:scale-95 transition-all disabled:opacity-50"
            >
              {sending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Traitement...</span>
                </>
              ) : isScheduled ? (
                <>
                  <Clock className="w-4 h-4" />
                  <span>Programmer cet envoi</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Envoyer immédiatement</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* ─── 3. LISTE DES ENVOIS DIFFÉRÉS ─── */}
      {subTab === "scheduled" && (
        <div className="space-y-4">
          {scheduledMessages.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-outline-variant/30 text-center text-outline text-xs">
              Aucun envoi programmé en attente.
            </div>
          ) : (
            scheduledMessages.map((m) => (
              <div
                key={m.id}
                className="bg-white p-4 rounded-2xl border border-outline-variant/30 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">
                      {m.channel}
                    </span>
                    <span className="text-xs font-semibold text-on-surface">Vers {m.recipient}</span>
                  </div>
                  {m.subject && <p className="text-xs text-slate-700 font-medium mt-1">Objet : {m.subject}</p>}
                  <p className="text-xs text-outline mt-0.5 font-mono">
                    Programmé pour le : {new Date(m.scheduled_at).toLocaleString("fr-FR")}
                  </p>
                </div>

                <button
                  onClick={() => handleCancelScheduled(m.id)}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 border border-red-200 w-fit"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Annuler l'envoi</span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

