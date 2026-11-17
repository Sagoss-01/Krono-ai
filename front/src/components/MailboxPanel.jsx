import React, { useCallback, useEffect, useState } from "react";
import { Mail, Send, Sparkles, RefreshCw, Trash2, Reply, Plus, Search, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { api } from "../api";
import "./mailbox.css";

/**
 * Messagerie liée aux adresses e-mail (IMAP/SMTP) avec assistance IA.
 *
 * Règles affichées à l'utilisateur et respectées ici :
 * - rien n'est envoyé sans clic sur « Envoyer » et sans confirmation des destinataires ;
 * - l'IA remplit des champs que l'utilisateur relit et peut modifier ; elle ne choisit pas les destinataires ;
 * - la lecture ne marque jamais un message comme lu.
 * Les couleurs passent par les variables du thème (mailbox.css), clair et sombre.
 */

const PROVIDERS = [
  { value: "gmail", label: "Gmail (mot de passe d'application)" },
  { value: "outlook", label: "Outlook / Microsoft 365" },
  { value: "custom", label: "Autre serveur (IMAP / SMTP)" },
];
const TONES = [["formel", "Formel"], ["amical", "Amical"], ["concis", "Concis"], ["chaleureux", "Chaleureux"], ["ferme", "Ferme"]];
const LANGS = [["fr", "Français"], ["en", "Anglais"], ["es", "Espagnol"], ["pt", "Portugais"], ["de", "Allemand"], ["ar", "Arabe"]];

const EMPTY_LINK = { address: "", password: "", provider: "gmail", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465 };
const EMPTY_DRAFT = { to: "", cc: "", subject: "", body: "", in_reply_to: null, references: null };

// Mêmes classes que les sous-onglets voisins (la coque de l'application reste sombre dans les deux thèmes)
const tabClass = (on) =>
  `px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${on ? "border-primary text-primary font-bold" : "border-transparent text-outline"}`;

const splitAddresses = (s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const addressOf = (from) => (String(from || "").match(/[^\s<>",;]+@[^\s<>",;]+/) || [""])[0];

export default function MailboxPanel() {
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState("inbox"); // inbox | compose
  const [feedback, setFeedback] = useState(null); // { type: "ok" | "err", text }

  // Liaison d'une adresse
  const [linking, setLinking] = useState(false);
  const [linkForm, setLinkForm] = useState(EMPTY_LINK);
  const [linkBusy, setLinkBusy] = useState(false);

  // Boîte de réception
  const [folder, setFolder] = useState("INBOX");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [listBusy, setListBusy] = useState(false);
  const [openMsg, setOpenMsg] = useState(null); // message lu, avec son dossier
  const [readBusy, setReadBusy] = useState(false);

  // Rédaction, assistance IA, envoi
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiTone, setAiTone] = useState("formel");
  const [aiLang, setAiLang] = useState("fr");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProposed, setAiProposed] = useState(false); // un texte IA est présent et doit être relu
  const [sendBusy, setSendBusy] = useState(false);

  const showError = (e) => setFeedback({ type: "err", text: e?.message || "Une erreur est survenue." });

  const loadAccounts = useCallback(async () => {
    try {
      const list = await api.mailboxListAccounts();
      setAccounts(list);
      setActiveId((current) => (list.some((a) => a.id === current) ? current : list[0]?.id ?? null));
    } catch (e) {
      showError(e);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const loadMessages = useCallback(async (q = "") => {
    if (!activeId) return;
    setListBusy(true);
    try {
      const data = await api.mailboxListMessages(activeId, { folder, unread: unreadOnly, q });
      setMessages(data.messages);
    } catch (e) {
      showError(e);
      setMessages([]);
    } finally {
      setListBusy(false);
    }
  }, [activeId, folder, unreadOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOpenMsg(null);
    setQuery("");
    loadMessages("");
  }, [activeId, folder, unreadOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Liaison / déliaison ──────────────────────────────────────────────────

  const handleLink = async (e) => {
    e.preventDefault();
    setLinkBusy(true);
    setFeedback(null);
    try {
      const payload = { address: linkForm.address.trim(), password: linkForm.password, provider: linkForm.provider };
      if (linkForm.provider === "custom") {
        Object.assign(payload, {
          imap_host: linkForm.imap_host.trim(), imap_port: Number(linkForm.imap_port),
          smtp_host: linkForm.smtp_host.trim(), smtp_port: Number(linkForm.smtp_port),
        });
      }
      const created = await api.mailboxLinkAccount(payload);
      setLinking(false);
      setLinkForm(EMPTY_LINK);
      await loadAccounts();
      setActiveId(created.id);
      setFeedback({ type: "ok", text: `Adresse ${created.address} liée. Les identifiants ont été testés avant enregistrement.` });
    } catch (err) {
      showError(err);
    } finally {
      setLinkBusy(false);
    }
  };

  const handleUnlink = async () => {
    const account = accounts.find((a) => a.id === activeId);
    if (!account || !window.confirm(`Délier ${account.address} ? Le mot de passe enregistré sera effacé de Krono.`)) return;
    try {
      await api.mailboxUnlinkAccount(account.id);
      setFeedback({ type: "ok", text: `${account.address} n'est plus liée.` });
      await loadAccounts();
    } catch (err) {
      showError(err);
    }
  };

  // ─── Lecture ─────────────────────────────────────────────────────────────

  const openMessage = async (m) => {
    setReadBusy(true);
    setFeedback(null);
    try {
      const full = await api.mailboxReadMessage(activeId, m.uid, folder);
      setOpenMsg({ ...full, folder });
      setMessages((list) => list.map((x) => (x.uid === m.uid ? { ...x, unread: false } : x)));
    } catch (err) {
      showError(err);
    } finally {
      setReadBusy(false);
    }
  };

  const startReply = (msg = openMsg) => {
    if (!msg) return;
    const subject = /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`;
    setDraft({
      to: addressOf(msg.from),
      cc: "",
      subject,
      body: "",
      in_reply_to: msg.message_id || null,
      references: [msg.references, msg.message_id].filter(Boolean).join(" ") || null,
    });
    setAiProposed(false);
    setView("compose");
  };

  // ─── Assistance IA (ne fait que proposer du texte) ───────────────────────

  const runAssist = async (action, extra = {}) => {
    setAiBusy(true);
    setFeedback(null);
    try {
      return await api.mailboxAssist({ action, account_id: activeId, tone: aiTone, language: aiLang, ...extra });
    } catch (err) {
      showError(err);
      return null;
    } finally {
      setAiBusy(false);
    }
  };

  const assistDraft = async () => {
    const res = await runAssist("draft", { instruction: aiInstruction });
    if (res) {
      setDraft((d) => ({ ...d, subject: res.subject || d.subject, body: res.body }));
      setAiProposed(true);
    }
  };

  const assistRewrite = async () => {
    const res = await runAssist("rewrite", { body: draft.body });
    if (res) { setDraft((d) => ({ ...d, body: res.body })); setAiProposed(true); }
  };

  const assistSubject = async () => {
    const res = await runAssist("subject", { body: draft.body });
    if (res?.subject) { setDraft((d) => ({ ...d, subject: res.subject })); setAiProposed(true); }
  };

  const assistTranslate = async () => {
    const res = await runAssist("translate", { body: draft.body });
    if (res) { setDraft((d) => ({ ...d, body: res.body })); setAiProposed(true); }
  };

  // Réponse proposée à partir du message lu : le serveur relit le message lui-même.
  const assistReplyToOpened = async () => {
    const msg = openMsg;
    startReply(msg);
    const res = await runAssist("reply", { folder: msg.folder, uid: msg.uid, instruction: aiInstruction });
    if (res) {
      setDraft((d) => ({ ...d, subject: res.subject || d.subject, body: res.body }));
      setAiProposed(true);
    }
  };

  const summarizeOpened = async () => {
    const res = await runAssist("summarize", { folder: openMsg.folder, uid: openMsg.uid });
    if (res?.summary) setFeedback({ type: "ok", text: `Résumé : ${res.summary}` });
  };

  // ─── Envoi (après confirmation) ──────────────────────────────────────────

  const handleSend = async (e) => {
    e.preventDefault();
    const to = splitAddresses(draft.to);
    const cc = splitAddresses(draft.cc);
    if (!to.length) return setFeedback({ type: "err", text: "Indiquez au moins un destinataire." });
    if (!draft.body.trim()) return setFeedback({ type: "err", text: "Le message est vide." });

    const recipients = [...to, ...cc.map((a) => `${a} (copie)`)].join("\n");
    const ok = window.confirm(
      `Envoyer ce message ?\n\nDe : ${accounts.find((a) => a.id === activeId)?.address}\nÀ :\n${recipients}\n\nObjet : ${draft.subject || "(sans objet)"}`
    );
    if (!ok) return;

    setSendBusy(true);
    try {
      const res = await api.mailboxSend(activeId, {
        to, cc, subject: draft.subject, body: draft.body,
        in_reply_to: draft.in_reply_to, references: draft.references, confirmed: true,
      });
      setDraft(EMPTY_DRAFT);
      setAiProposed(false);
      setAiInstruction("");
      setView("inbox");
      setFeedback({
        type: "ok",
        text: res.saved_to_sent ? "Message envoyé. Une copie est dans Envoyés." : "Message envoyé. La copie dans Envoyés n'a pas pu être enregistrée.",
      });
    } catch (err) {
      showError(err);
    } finally {
      setSendBusy(false);
    }
  };

  const activeAccount = accounts.find((a) => a.id === activeId);

  // ─── Rendu ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 max-w-6xl mx-auto w-full space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-4">
        <div>
          <h3 className="text-xl font-bold font-['Sora'] text-on-surface flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" /> Boîtes mail liées
          </h3>
          <p className="text-xs text-outline mt-1 flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> Rien n'est envoyé sans votre confirmation. L'IA propose, vous validez.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 0 && (
            <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)} className="mbx-select">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}
            </select>
          )}
          <button onClick={() => setLinking((v) => !v)} className="mbx-btn">
            <Plus className="w-3.5 h-3.5" /> Lier une adresse
          </button>
          {activeAccount && (
            <button onClick={handleUnlink} title="Délier cette adresse" className="mbx-btn mbx-btn-icon">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`mbx-alert ${feedback.type === "ok" ? "mbx-alert-ok" : "mbx-alert-err"}`}>
          {feedback.type === "ok" ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1">{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="mbx-muted underline">Fermer</button>
        </div>
      )}

      {linking && (
        <form onSubmit={handleLink} className="mbx-card p-5 space-y-4">
          <div>
            <p className="mbx-subtitle">Lier une adresse e-mail</p>
            <p className="mbx-muted mt-1">
              Utilisez un <strong>mot de passe d'application</strong> plutôt que votre mot de passe principal. Krono le chiffre et ne l'affiche jamais.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="mbx-label">Adresse
              <input type="email" required autoComplete="off" value={linkForm.address} onChange={(e) => setLinkForm({ ...linkForm, address: e.target.value })} className="mbx-input" />
            </label>
            <label className="mbx-label">Mot de passe d'application
              <input type="password" required autoComplete="new-password" value={linkForm.password} onChange={(e) => setLinkForm({ ...linkForm, password: e.target.value })} className="mbx-input" />
            </label>
            <label className="mbx-label md:col-span-2">Fournisseur
              <select value={linkForm.provider} onChange={(e) => setLinkForm({ ...linkForm, provider: e.target.value })} className="mbx-input">
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
          </div>
          {linkForm.provider === "custom" && (
            <div className="grid md:grid-cols-4 gap-3">
              <label className="mbx-label md:col-span-2">Serveur IMAP
                <input required value={linkForm.imap_host} onChange={(e) => setLinkForm({ ...linkForm, imap_host: e.target.value })} placeholder="imap.exemple.fr" className="mbx-input" />
              </label>
              <label className="mbx-label">Port IMAP
                <input required type="number" value={linkForm.imap_port} onChange={(e) => setLinkForm({ ...linkForm, imap_port: e.target.value })} className="mbx-input" />
              </label>
              <label className="mbx-label">Port SMTP
                <input required type="number" value={linkForm.smtp_port} onChange={(e) => setLinkForm({ ...linkForm, smtp_port: e.target.value })} className="mbx-input" />
              </label>
              <label className="mbx-label md:col-span-4">Serveur SMTP
                <input required value={linkForm.smtp_host} onChange={(e) => setLinkForm({ ...linkForm, smtp_host: e.target.value })} placeholder="smtp.exemple.fr" className="mbx-input" />
              </label>
              <p className="mbx-hint md:col-span-4">Connexion chiffrée uniquement : IMAP 993, SMTP 465 ou 587.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={linkBusy} className="mbx-btn mbx-btn-primary">{linkBusy ? "Test de connexion…" : "Tester et lier"}</button>
            <button type="button" onClick={() => setLinking(false)} className="mbx-btn">Annuler</button>
          </div>
        </form>
      )}

      {accounts.length === 0 && !linking ? (
        <div className="mbx-card p-8 text-center space-y-3">
          <Mail className="w-8 h-8 mx-auto" style={{ color: "var(--text-muted)" }} />
          <p className="mbx-subtitle">Aucune adresse liée</p>
          <p className="mbx-muted max-w-sm mx-auto">Liez une adresse pour lire vos messages et rédiger avec l'assistant IA.</p>
          <button onClick={() => setLinking(true)} className="mbx-btn mbx-btn-primary"><Plus className="w-3.5 h-3.5" /> Lier une adresse</button>
        </div>
      ) : accounts.length > 0 && (
        <>
          <div className="flex border-b border-outline-variant/30 gap-2">
            <button onClick={() => setView("inbox")} className={tabClass(view === "inbox")}>Boîte de réception</button>
            <button onClick={() => { setView("compose"); setAiProposed(false); }} className={tabClass(view === "compose")}>Nouveau message</button>
          </div>

          {view === "inbox" && (
            <div className="grid md:grid-cols-5 gap-4">
              <div className="md:col-span-2 space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={folder} onChange={(e) => setFolder(e.target.value)} className="mbx-select">
                    <option value="INBOX">Réception</option>
                    <option value="Sent">Envoyés</option>
                  </select>
                  <label className="mbx-check">
                    <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Non lus
                  </label>
                  <button onClick={() => loadMessages(query.trim())} disabled={listBusy} className="mbx-btn mbx-btn-icon" title="Actualiser">
                    <RefreshCw className={`w-3.5 h-3.5 ${listBusy ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); loadMessages(query.trim()); }} className="flex gap-2">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher (ASCII)" className="mbx-input" style={{ marginTop: 0 }} />
                  <button type="submit" className="mbx-btn mbx-btn-icon" title="Rechercher"><Search className="w-3.5 h-3.5" /></button>
                </form>
                <div className="mbx-list max-h-[60vh] overflow-y-auto">
                  {messages.length === 0 && <p className="mbx-muted p-4">{listBusy ? "Chargement…" : "Aucun message."}</p>}
                  {messages.map((m) => (
                    <button key={m.uid} onClick={() => openMessage(m)} className={`mbx-list-item ${openMsg?.uid === m.uid ? "active" : ""}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {m.unread && <span className="mbx-dot" />}
                        <span className={`mbx-list-from ${m.unread ? "unread" : ""}`}>{m.from || "Expéditeur inconnu"}</span>
                      </div>
                      <p className="mbx-list-subject">{m.subject || "(Sans objet)"}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mbx-card md:col-span-3 p-5 min-h-[300px]">
                {readBusy && <p className="mbx-muted">Chargement du message…</p>}
                {!readBusy && !openMsg && <p className="mbx-muted">Sélectionnez un message pour le lire.</p>}
                {openMsg && !readBusy && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="mbx-title text-base">{openMsg.subject || "(Sans objet)"}</h4>
                      <p className="mbx-muted mt-1">De : {openMsg.from}</p>
                      <p className="mbx-muted">À : {openMsg.to}</p>
                      <p className="mbx-muted">{openMsg.date}</p>
                    </div>
                    {openMsg.attachments?.length > 0 && (
                      <p className="mbx-muted">Pièces jointes (non ouvertes par Krono) : {openMsg.attachments.join(", ")}</p>
                    )}
                    <pre className="mbx-body">{openMsg.text || "(Message sans texte)"}</pre>
                    <div className="flex flex-wrap gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <button onClick={() => startReply()} className="mbx-btn"><Reply className="w-3.5 h-3.5" /> Répondre</button>
                      <button onClick={summarizeOpened} disabled={aiBusy} className="mbx-btn"><Sparkles className="w-3.5 h-3.5" /> Résumer</button>
                      <button onClick={assistReplyToOpened} disabled={aiBusy} className="mbx-btn"><Sparkles className="w-3.5 h-3.5" /> Proposer une réponse</button>
                    </div>
                    <p className="mbx-hint">L'IA ne lit que ce message et ne l'envoie jamais. Vous relisez avant tout envoi.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "compose" && (
            <form onSubmit={handleSend} className="grid md:grid-cols-5 gap-4">
              <div className="mbx-card md:col-span-3 p-5 space-y-3">
                <label className="mbx-label">À
                  <input required value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="nom@exemple.fr, autre@exemple.fr" className="mbx-input" />
                </label>
                <label className="mbx-label">Copie (Cc)
                  <input value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} className="mbx-input" />
                </label>
                <label className="mbx-label">Objet
                  <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="mbx-input" />
                </label>
                <label className="mbx-label">Message
                  <textarea required rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="mbx-input" />
                </label>
                {aiProposed && (
                  <p className="mbx-alert mbx-alert-warn"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Texte proposé par l'IA : relisez-le avant d'envoyer.</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={sendBusy} className="mbx-btn mbx-btn-primary"><Send className="w-3.5 h-3.5" /> {sendBusy ? "Envoi…" : "Envoyer"}</button>
                  <button type="button" onClick={() => { setDraft(EMPTY_DRAFT); setAiProposed(false); }} className="mbx-btn">Vider</button>
                </div>
              </div>

              <div className="mbx-card md:col-span-2 p-5 space-y-3 h-fit">
                <p className="mbx-subtitle flex items-center gap-1.5"><Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> Assistant d'écriture</p>
                <textarea rows={3} value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)} placeholder="Ce que vous voulez dire, ex. : demander un rendez-vous jeudi" className="mbx-input" />
                <div className="grid grid-cols-2 gap-2">
                  <label className="mbx-label">Ton
                    <select value={aiTone} onChange={(e) => setAiTone(e.target.value)} className="mbx-input">
                      {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="mbx-label">Langue
                    <select value={aiLang} onChange={(e) => setAiLang(e.target.value)} className="mbx-input">
                      {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                </div>
                <button type="button" onClick={assistDraft} disabled={aiBusy || !aiInstruction.trim()} className="mbx-btn mbx-btn-primary mbx-btn-block">
                  <Sparkles className="w-3.5 h-3.5" /> {aiBusy ? "Rédaction…" : "Rédiger avec l'IA"}
                </button>
                <div className="grid grid-cols-1 gap-2">
                  <button type="button" onClick={assistRewrite} disabled={aiBusy || !draft.body.trim()} className="mbx-btn mbx-btn-block">Reformuler mon message</button>
                  <button type="button" onClick={assistSubject} disabled={aiBusy || !draft.body.trim()} className="mbx-btn mbx-btn-block">Proposer un objet</button>
                  <button type="button" onClick={assistTranslate} disabled={aiBusy || !draft.body.trim()} className="mbx-btn mbx-btn-block">Traduire le message</button>
                </div>
                <p className="mbx-hint">
                  L'IA ne choisit jamais les destinataires et n'envoie rien. Les noms et adresses sont masqués avant l'envoi au modèle.
                </p>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
