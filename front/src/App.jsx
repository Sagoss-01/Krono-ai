import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Calendar, Mic, Send, Bell, AlertTriangle, Sparkles, 
  User, MapPin, Compass, Settings, LogOut, RefreshCw, 
  Trash2, Play, Pause, ChevronRight, Check, X, ShieldAlert, Plus, Pencil,
  CheckCircle2, Clock, ArrowRight, ListTodo, Scissors,
  MessageSquare, Mail, Users, Phone, Smartphone, UserPlus,
  Upload, FileText, BookOpen, Sun, Volume2, VolumeX, GraduationCap,
  Download, Shield, Home, QrCode, Star, ThumbsUp, ThumbsDown,
  Menu, Moon, ChevronDown, Video, Search, Zap, ChevronLeft, SlidersHorizontal
} from "lucide-react";
import { db } from "./db";
import { api, getApiUrl, setApiUrl } from "./api";
import kronoLogo from "./assets/logo.png";
import GeoMapTab from "./GeoMapTab";
import GoogleAccountCard from "./components/GoogleAccountCard";
import LandingPage from "./components/LandingPage";
import AdminTab from "./components/AdminTab";
import MessagingTab from "./components/MessagingTab";
import SecurityModal from "./components/SecurityModal";
import MeetingToolsModal from "./components/MeetingToolsModal";

// Code couleur strict (Règles métier CLAUDE.md)
// rouge = contrainte dure (hard)
// vert = contrainte souple (soft)
// orange clignotant = conflit non résolu
const COLORS = {
  bg: "#060d1a", // TechSphere Dark Navy
  text: "#f1f5f9", // Crisp White
  textDim: "#94a3b8", // Slate 400
  border: "rgba(3, 92, 128, 0.22)", // Cyan Border
  hard: "#ef4444", // Crimson Red
  soft: "#22c55e", // Emerald Green
  conflict: "#f97316", // Vibrant Orange
  ai: "#00d2ff", // TechSphere Cyan Accent
  surface: "#0c1526", // Panel Navy
  surfaceDim: "#0a1220"
};

const getDaysOfCurrentWeek = () => {
  const current = new Date();
  const day = current.getDay();
  const diff = current.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(current.getFullYear(), current.getMonth(), diff);
  
  const days = [];
  const names = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push({
      name: names[i],
      date: `${yyyy}-${mm}-${dd}`
    });
  }
  return days;
};

const getTodayDateString = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const DAYS = getDaysOfCurrentWeek();

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0h -> 23h
const CALENDAR_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

const getCurrentTimeTopOffset = () => {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  return Math.min(Math.max((h - 8) * 64, 0), 10 * 64);
};


function MessageDraftCard({ msgId, draft, sentStatus, isSending, onSend }) {
  const [editedBody, setEditedBody] = useState(draft.body || "");
  const [editedSubject, setEditedSubject] = useState(draft.subject || "");
  const [isEditing, setIsEditing] = useState(false);

  const isWhatsApp = (draft.channel || "whatsapp").toLowerCase() === "whatsapp";

  if (sentStatus) {
    return (
      <div className="mt-3 p-3.5 rounded-xl border bg-emerald-50/90 border-emerald-300 shadow-sm transition-all">
        <div className="flex items-center gap-2 text-emerald-800 font-semibold text-xs mb-1">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Message {isWhatsApp ? "WhatsApp" : "Email"} expédié avec succès</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200/80 text-emerald-900 font-mono">
            {sentStatus.status === "simulated" ? "SIMULÉ EN CONSOLE" : "ENVOYÉ"}
          </span>
        </div>
        <p className="text-xs text-emerald-700">{sentStatus.detail}</p>
      </div>
    );
  }

  return (
    <div className={`mt-3 p-3.5 rounded-xl border shadow-md transition-all ${
      isWhatsApp 
        ? "bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 border-emerald-200" 
        : "bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/40 border-blue-200"
    }`}>
      {/* En-tête avec badge canal et destinataire */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-outline-variant/20">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider ${
            isWhatsApp ? "bg-emerald-600 text-white" : "bg-primary text-white"
          }`}>
            {isWhatsApp ? <MessageSquare className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
            {isWhatsApp ? "WhatsApp" : "Email"}
          </span>
          <span className="text-xs font-bold text-on-surface">
            {draft.recipient_name}
          </span>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-variant/70 text-outline">
          {draft.recipient_target}
        </span>
      </div>

      {/* Objet si email */}
      {!isWhatsApp && (
        <div className="mb-2">
          <label className="block text-[10px] uppercase font-bold text-outline mb-0.5">Objet :</label>
          <input
            type="text"
            value={editedSubject}
            onChange={(e) => setEditedSubject(e.target.value)}
            className="w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white focus:border-primary outline-none"
          />
        </div>
      )}

      {/* Corps du message modifiable */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-0.5">
          <label className="text-[10px] uppercase font-bold text-outline">Contenu rédigé par l'IA :</label>
          <button 
            type="button" 
            onClick={() => setIsEditing(!isEditing)}
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
          >
            <Pencil className="w-2.5 h-2.5" />
            {isEditing ? "Fermer l'édition" : "Modifier le texte"}
          </button>
        </div>
        {isEditing ? (
          <textarea
            rows={3}
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            className="w-full text-xs p-2 rounded-lg border border-outline-variant focus:border-primary outline-none bg-white resize-y"
          />
        ) : (
          <div className="p-2.5 rounded-lg bg-white/90 border border-outline-variant/40 text-xs text-on-surface whitespace-pre-wrap leading-relaxed shadow-inner">
            {editedBody}
          </div>
        )}
      </div>

      {/* Action buttons (Human-in-the-loop) */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={isSending}
          onClick={() => onSend(editedBody, editedSubject)}
          className={`px-3.5 py-1.5 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all ${
            isWhatsApp 
              ? "bg-emerald-600 hover:bg-emerald-700" 
              : "bg-primary hover:bg-blue-700"
          } ${isSending ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {isSending ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Expédition en cours...
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              Confirmer et envoyer
            </>
          )}
        </button>
        <span className="text-[10px] text-outline flex items-center gap-1">
          <ShieldAlert className="w-3 h-3 text-amber-500" />
          Validation requise avant envoi
        </span>
      </div>
    </div>
  );
}


export default function App() {
  // --- States ---
  // Nettoyage de l'ancienne clé legacy
  localStorage.removeItem("KronoToken");
  const [token, setToken] = useState(localStorage.getItem("KRONO_TOKEN") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard, assistant, contacts, messaging, admin, briefing, schedule-import, map, preferences
  const [showLandingPage, setShowLandingPage] = useState(!localStorage.getItem("KRONO_TOKEN"));
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showMeetingToolsModal, setShowMeetingToolsModal] = useState(false);
  const [meetingNotesInput, setMeetingNotesInput] = useState("");
  const [meetingSummaryResult, setMeetingSummaryResult] = useState(null);
  const [meetingQuizResult, setMeetingQuizResult] = useState(null);
  const [meetingToolsLoading, setMeetingToolsLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appTheme, setAppTheme] = useState(localStorage.getItem("KRONO_THEME") || "dark");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [calendarSearch, setCalendarSearch] = useState("");
  
  // API URL
  const [apiUrlInput, setApiUrlInput] = useState(getApiUrl());
  
  // Auth Forms
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Notifications Toast & Banner
  const [toastNotification, setToastNotification] = useState(null);
  const [emergencyAlert, setEmergencyAlert] = useState(null);

  // Chat/Assistant states
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [assistantMeetingLink, setAssistantMeetingLink] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState("");
  const [showAiPrefs, setShowAiPrefs] = useState(false);
  const [aiPrefs, setAiPrefs] = useState({
    tone: "formel",
    language: "fr",
    closing: "Cordialement",
    meetingDuration: "30",
    reminderMinutes: "15",
    workStart: 9,
    workEnd: 18,
    weekends: false,
    retentionDays: 0,
  });

  // Map state
  const [currentLat, setCurrentLat] = useState("48.8566");
  const [currentLng, setCurrentLng] = useState("2.3522");
  const [meetingLat, setMeetingLat] = useState("48.8738");
  const [meetingLng, setMeetingLng] = useState("2.2950");
  const [meetingTime, setMeetingTime] = useState("14:00");
  const [etaResult, setEtaResult] = useState(null);
  const [etaLoading, setEtaLoading] = useState(false);

  // Sync state
  const [calendarLinks, setCalendarLinks] = useState([]);
  const [syncLoading, setSyncLoading] = useState(false);

  // Topbar Global Search & Notifications States
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);

  // Calendar Dynamic View & Category Filter States
  const [calendarView, setCalendarView] = useState("week"); // "day", "week", "month", "agenda"
  const [categoryFilter, setCategoryFilter] = useState("all"); // "all", "ops", "briefing", "terrain"

  // Assistant History Search State
  const [historyFilter, setHistoryFilter] = useState("");

  // Confirmation déconnexion
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Panneau Quick Action (rétractable)
  const [showQuickPanel, setShowQuickPanel] = useState(false);

  // Modal ajout d'événement manuel
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalDate, setModalDate] = useState(selectedDate);
  const [modalStartTime, setModalStartTime] = useState("09:00");
  const [modalEndTime, setModalEndTime] = useState("10:00");
  const [modalConstraint, setModalConstraint] = useState("soft");
  const [modalDescription, setModalDescription] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  // Modal édition d'événement
  const [showEditModal, setShowEditModal] = useState(false);
  const [editEventId, setEditEventId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");
  const [editConstraint, setEditConstraint] = useState("soft");
  const [editDescription, setEditDescription] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Modal confirmation de suppression
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, title }
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Modal Optimiseur d'Intentions Floues & Données Hétérogènes
  const [showFuzzyModal, setShowFuzzyModal] = useState(false);
  const [fuzzyInput, setFuzzyInput] = useState("");
  const [fuzzyLoading, setFuzzyLoading] = useState(false);
  const [fuzzyResults, setFuzzyResults] = useState(null);
  const [fuzzySummary, setFuzzySummary] = useState("");
  const [fuzzyError, setFuzzyError] = useState("");
  const [fuzzyAcceptedMap, setFuzzyAcceptedMap] = useState({});
  const [acceptedProposals, setAcceptedProposals] = useState({});

  // --- Contacts & Messaging States ---
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactCompany, setNewContactCompany] = useState("");
  const [sentMessages, setSentMessages] = useState({});
  const [sendingMessageId, setSendingMessageId] = useState(null);

  // --- Briefing Matinal States ---
  const [briefingData, setBriefingData] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState("");
  const [briefingDate, setBriefingDate] = useState(getTodayDateString());
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechSynthRef = useRef(null);

  // --- Import Emploi du Temps States ---
  const [importFile, setImportFile] = useState(null);
  const [importWeekStart, setImportWeekStart] = useState(getTodayDateString());
  const [importRepeatWeeks, setImportRepeatWeeks] = useState(1);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importParsed, setImportParsed] = useState(null); // Résultat du parsing
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [importSelection, setImportSelection] = useState({}); // { index: true/false }
  const [importConfirmLoading, setImportConfirmLoading] = useState(false);

  const loadContacts = async () => {
    try {
      setContactsLoading(true);
      const list = await api.getContacts();
      setContacts(list || []);
    } catch (e) {
      console.warn("Erreur chargement contacts:", e);
    } finally {
      setContactsLoading(false);
    }
  };

  const handleCreateContact = async (e) => {
    e?.preventDefault();
    if (!newContactName.trim()) return;
    try {
      await api.createContact(
        newContactName.trim(),
        newContactEmail.trim() || null,
        newContactPhone.trim() || null,
        newContactCompany.trim() || null
      );
      setToastNotification({
        title: "Contact ajouté",
        body: `${newContactName} a été ajouté à votre carnet.`
      });
      setShowAddContactModal(false);
      setNewContactName("");
      setNewContactPhone("");
      setNewContactEmail("");
      setNewContactCompany("");
      await loadContacts();
    } catch (err) {
      alert(`Erreur création contact : ${err.message}`);
    }
  };

  const handleSeedDemoContacts = async () => {
    try {
      const res = await api.seedDemoContacts();
      setToastNotification({
        title: "Contacts Démo ajoutés",
        body: `${res.imported_count} contacts démo (Thomas, Sophie, Dr. Bernard) importés.`
      });
      await loadContacts();
    } catch (err) {
      alert(`Erreur import démo : ${err.message}`);
    }
  };

  const handleImportPhoneContacts = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const props = ['name', 'email', 'tel'];
        const selected = await navigator.contacts.select(props, { multiple: true });
        if (selected && selected.length > 0) {
          const formatted = selected.map(c => ({
            name: (c.name && c.name[0]) || "Contact mobile",
            phone_number: (c.tel && c.tel[0]) || null,
            email: (c.email && c.email[0]) || null,
          }));
          const res = await api.batchImportContacts(formatted);
          setToastNotification({
            title: "Contacts synchronisés",
            body: `${res.imported_count} contacts importés depuis votre téléphone.`
          });
          await loadContacts();
        }
      } catch (err) {
        console.warn("Annulation ou erreur contact picker:", err);
      }
    } else {
      alert("La sélection native des contacts du téléphone est supportée sur Chrome mobile (Android) via HTTPS. Utilisez le bouton 'Contacts Démo' ou 'Ajouter' pour saisir vos contacts.");
    }
  };

  const handleDeleteContact = async (id) => {
    if (!confirm("Supprimer ce contact ?")) return;
    try {
      await api.deleteContact(id);
      setContacts(prev => prev.filter(c => c.id !== id));
      setToastNotification({
        title: "Contact supprimé",
        body: "Le contact a été retiré de votre carnet."
      });
    } catch (err) {
      alert(`Erreur suppression : ${err.message}`);
    }
  };

  const handleToggleFavoriteContact = async (id) => {
    try {
      const updated = await api.toggleFavoriteContact(id);
      setContacts(prev => prev.map(c => c.id === id ? { ...c, is_favorite: updated.is_favorite } : c));
    } catch (err) {
      alert(`Erreur favori : ${err.message}`);
    }
  };

  const handleSendDraftMessage = async (msgId, draft, editedBody, editedSubject) => {
    try {
      setSendingMessageId(msgId);
      const res = await api.sendMessage(
        draft.channel,
        draft.recipient_target,
        editedSubject || draft.subject,
        editedBody || draft.body
      );
      setSentMessages(prev => ({
        ...prev,
        [msgId]: {
          status: res.status,
          detail: res.detail,
          timestamp: Date.now(),
        }
      }));
      setToastNotification({
        title: draft.channel === "whatsapp" ? "WhatsApp envoyé" : "Email envoyé",
        body: res.detail || `Message transmis à ${draft.recipient_name} (${draft.recipient_target}).`
      });
    } catch (err) {
      alert(`Échec de l'envoi : ${err.message}`);
    } finally {
      setSendingMessageId(null);
    }
  };

  const recognitionRef = useRef(null);

  // --- Monitoring offline status ---
  useEffect(() => {
    const goOnline = async () => {
      setIsOffline(false);
      await syncOfflineMutations();
      await loadEvents();
    };
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // --- Initial load when authenticated ---
  useEffect(() => {
    if (token) {
      localStorage.setItem("KRONO_TOKEN", token);
      loadUserData();
      loadEvents();
      loadContacts();
      initializeChat();
      loadCalendarLinks();

      // Check URL for OAuth callbacks
      const params = new URLSearchParams(window.location.search);
      if (params.get("sync") === "success") {
        setToastNotification({ title: "Succès", body: "Calendrier lié avec succès !" });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (params.get("sync") === "error") {
        setToastNotification({ title: "Erreur", body: "La liaison du calendrier a échoué." });
        window.history.replaceState({}, document.title, window.location.pathname);
      }

    } else {
      localStorage.removeItem("KRONO_TOKEN");
      setCurrentUser(null);
    }
  }, [token]);

  // --- API connection helper ---
  const loadUserData = async () => {
    try {
      const user = await api.me();
      setCurrentUser(user);
    } catch (e) {
      console.error("Impossible de récupérer l'utilisateur", e);
      // Jeton expiré, invalide ou compte suspendu : le backend répond 401 → on déconnecte
      if (e.status === 401) {
        handleLogout();
      }
    }
  };

  // Dynamic week calculation based on selectedDate
  const daysOfWeek = useMemo(() => {
    const current = new Date(selectedDate);
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(current.getFullYear(), current.getMonth(), diff);
    
    const res = [];
    const names = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      res.push({
        name: names[i],
        date: `${yyyy}-${mm}-${dd}`
      });
    }
    return res;
  }, [selectedDate]);

  // Event category filter helper
  const filterEventByCategory = (evt) => {
    if (categoryFilter === "all") return true;
    const t = (evt.title || "").toLowerCase();
    const c = (evt.category || "").toLowerCase();
    if (categoryFilter === "ops") {
      return t.includes("rh") || t.includes("ops") || t.includes("audit") || t.includes("synthèse") || t.includes("arbitrage") || c.includes("ops");
    }
    if (categoryFilter === "briefing") {
      return t.includes("briefing") || t.includes("ia") || t.includes("déjeuner") || c.includes("briefing");
    }
    if (categoryFilter === "terrain") {
      return t.includes("terrain") || t.includes("sig") || t.includes("visite") || t.includes("mapping") || c.includes("terrain");
    }
    return true;
  };

  const handleSyncNow = async () => {
    setSyncLoading(true);
    try {
      await Promise.all([loadEvents(), loadContacts()]);
      setToastNotification({
        title: "Synchronisation réussie",
        body: "Votre agenda et vos contacts sont synchronisés avec succès."
      });
    } catch (e) {
      setToastNotification({
        title: "Erreur de synchronisation",
        body: e.message
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const loadEvents = async () => {
    try {
      let fetchedEvents = [];
      if (!isOffline) {
        // Résolution de conflits à la volée qui retourne la liste à jour
        fetchedEvents = await api.resolveConflicts();
        // Cacher en local
        await db.events.clear();
        await db.events.bulkAdd(fetchedEvents.map(e => ({
          id: String(e.id),
          title: e.title,
          start_time: e.start_time,
          end_time: e.end_time,
          constraint_type: e.constraint_type,
          status: e.status,
          source: e.source,
          external_id: e.external_id
        })));
      } else {
        // Charger du cache local Dexie
        fetchedEvents = await db.events.toArray();
      }
      setEvents(fetchedEvents);
      checkCriticalConflicts(fetchedEvents);
    } catch (e) {
      console.error("Échec du chargement des événements", e);
      // Fallback local Dexie
      const cached = await db.events.toArray();
      setEvents(cached);
      checkCriticalConflicts(cached);
    }
  };

  const createNewConversation = async () => {
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const title = `Discussion du ${dateStr} à ${timeStr}`;
    
    const newConv = {
      id,
      title,
      timestamp: Date.now()
    };
    await db.conversations.add(newConv);
    // Pas de message d'accueil enregistré : l'écran « Comment puis-je vous aider ? » est affiché tant qu'il n'y a aucun message
    return id;
  };

  const loadMessagesForConversation = async (convId) => {
    if (!convId) return;
    const list = await db.messages.where("conversationId").equals(convId).toArray();
    setMessages(list);
  };

  const initializeChat = async () => {
    let convList = await db.conversations.orderBy('timestamp').reverse().toArray();
    let activeId = sessionStorage.getItem("KRONO_CONVERSATION_ID");

    if (!activeId) {
      // Aucune conversation ouverte (nouvelle connexion) : écran d'accueil, la conversation se crée au premier message
      setConversations(convList);
      setCurrentConversationId("");
      setMessages([]);
      return;
    }

    setConversations(convList);
    setCurrentConversationId(activeId);
    await loadMessagesForConversation(activeId);
  };

  const loadCalendarLinks = async () => {
    try {
      if (!isOffline) {
        const links = await api.getCalendarLinks();
        setCalendarLinks(links);
      }
    } catch (e) {
      console.error("Impossible de récupérer les calendriers tiers", e);
    }
  };

  // --- Sync offline mutations queued in Dexie (replayed when coming back online) ---
  const syncOfflineMutations = async () => {
    const mutations = await db.offline_mutations.orderBy('id').toArray();
    if (mutations.length === 0) return;

    setToastNotification({
      title: "Synchronisation hors-ligne",
      body: `Envoi de ${mutations.length} modification(s) en attente…`
    });

    let successCount = 0;
    let failCount = 0;

    for (const mutation of mutations) {
      try {
        if (mutation.type === 'CREATE') {
          const d = mutation.data;
          await api.createEvent(d.title, d.start_time, d.end_time, d.constraint_type, d.description);
        } else if (mutation.type === 'UPDATE') {
          const d = mutation.data;
          await api.updateEvent(mutation.targetId, {
            title: d.title,
            startTime: d.start_time,
            endTime: d.end_time,
            constraintType: d.constraint_type,
            description: d.description,
          });
        } else if (mutation.type === 'DELETE') {
          await api.deleteEvent(mutation.targetId);
        }
        // Remove from queue on success
        await db.offline_mutations.delete(mutation.id);
        successCount++;
      } catch (err) {
        console.error(`Échec de la mutation hors-ligne (${mutation.type} #${mutation.id}):`, err);
        failCount++;
      }
    }

    if (failCount === 0) {
      setToastNotification({
        title: "Synchronisation réussie ✓",
        body: `${successCount} modification(s) synchronisée(s) avec le serveur.`
      });
    } else {
      setToastNotification({
        title: "Synchronisation partielle",
        body: `${successCount} réussie(s), ${failCount} en échec. Réessayez plus tard.`
      });
    }
  };

  const checkCriticalConflicts = (evts) => {
    // Si un événement a un statut "conflict" et est de type "hard", on alerte l'utilisateur
    const critical = evts.find(e => e.status === "conflict" && e.constraint_type === "hard");
    if (critical) {
      setEmergencyAlert({
        title: `Conflit critique détecté !`,
        body: `L'événement majeur "${critical.title}" chevauche un autre événement important. Le Smart-Scheduler n'a pas pu déplacer cette contrainte dure.`,
        event: critical
      });
    } else {
      setEmergencyAlert(null);
    }
  };

  // --- Auth Handlers ---
  // Règles de mot de passe miroir de backend/models/schemas.py (UserCreate).
  // La validation serveur reste la référence ; ceci évite un aller-retour inutile.
  const validateRegistration = () => {
    if (!authName.trim()) return "Le nom complet est requis.";
    if (authPassword.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
    if (new TextEncoder().encode(authPassword).length > 72) return "Le mot de passe est trop long (72 octets maximum).";
    if (!/[A-Za-zÀ-ÿ]/.test(authPassword) || !/\d/.test(authPassword)) {
      return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
    }
    if (authPassword !== authPasswordConfirm) return "Les deux mots de passe ne correspondent pas.";
    return null;
  };

  const switchAuthMode = (toLogin) => {
    setIsLogin(toLogin);
    setAuthError("");
    setAuthPasswordConfirm("");
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");

    if (!isLogin) {
      const validationError = validateRegistration();
      if (validationError) {
        setAuthError(validationError);
        return;
      }
    }

    setAuthLoading(true);
    try {
      if (!isLogin) {
        await api.register(authEmail.trim(), authPassword, authName);
      }
      // Connexion dans les deux cas (après inscription, le compte vient d'être créé)
      const res = await api.login(authEmail.trim(), authPassword);
      setAuthPassword("");
      setAuthPasswordConfirm("");
      sessionStorage.removeItem("KRONO_CONVERSATION_ID");
      setCurrentConversationId("");
      setMessages([]);
      setActiveTab("assistant");
      setToken(res.access_token);
      setShowLandingPage(false);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    // Nettoyer toutes les clés localStorage
    localStorage.removeItem("KRONO_TOKEN");
    localStorage.removeItem("KRONO_API_URL");
    sessionStorage.removeItem("KRONO_CONVERSATION_ID");
    // Réinitialiser tout le state
    api.logout();
    setToken("");
    setCurrentUser(null);
    setEvents([]);
    setMessages([]);
    setConversations([]);
    setCurrentConversationId("");
    setCalendarLinks([]);
    setEmergencyAlert(null);
    setToastNotification(null);
    setShowLogoutConfirm(false);
    setShowLandingPage(true);
  };

  const updateApiBaseUrl = () => {
    setApiUrl(apiUrlInput);
    setToastNotification({
      title: "API URL modifiée",
      body: `Le frontend pointe maintenant vers ${apiUrlInput}`
    });
  };

  // --- Calendar/Dashboard Handlers ---
  const handleResolveAI = async () => {
    setSyncLoading(true);
    try {
      await loadEvents();
      setToastNotification({
        title: "Optimisation AI complétée",
        body: "Le Smart-Scheduler a réorganisé vos créneaux souples pour éliminer les conflits."
      });
    } catch (e) {
      setToastNotification({
        title: "Erreur d'optimisation",
        body: e.message
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    setModalError("");
    if (!modalTitle.trim()) { setModalError("Le titre est obligatoire."); return; }
    if (modalEndTime <= modalStartTime) { setModalError("L'heure de fin doit être après l'heure de début."); return; }
    setModalLoading(true);
    try {
      const startISO = `${modalDate}T${modalStartTime}:00`;
      const endISO   = `${modalDate}T${modalEndTime}:00`;

      if (isOffline) {
        // Enregistrer la mutation localement pour envoi ultérieur
        const tempId = `offline_${Date.now()}`;
        await db.offline_mutations.add({
          type: 'CREATE',
          targetId: null,
          data: {
            title: modalTitle.trim(),
            start_time: startISO,
            end_time: endISO,
            constraint_type: modalConstraint,
            description: modalDescription.trim()
          },
          timestamp: Date.now()
        });
        // Optimistic local insert
        await db.events.add({
          id: tempId,
          title: modalTitle.trim(),
          start_time: startISO,
          end_time: endISO,
          constraint_type: modalConstraint,
          status: 'pending',
          source: 'offline',
          external_id: null
        });
        setToastNotification({
          title: "Événement enregistré hors-ligne",
          body: `"${modalTitle}" sera synchronisé au retour en ligne.`
        });
      } else {
        await api.createEvent(modalTitle.trim(), startISO, endISO, modalConstraint, modalDescription.trim());
        setToastNotification({
          title: "Événement créé",
          body: `"${modalTitle}" ajouté le ${modalDate} de ${modalStartTime} à ${modalEndTime}.`
        });
      }
      setShowAddModal(false);
      setModalTitle("");
      setModalDescription("");
      await loadEvents();
    } catch (err) {
      console.error("Erreur création événement:", err);
      if (err.message === "Failed to fetch" || err.message.includes("NetworkError") || err.message.includes("fetch")) {
        setModalError(`Impossible de joindre le serveur (${getApiUrl()}). Vérifiez que le backend tourne sur ce port.`);
      } else {
        setModalError(err.message);
      }
    } finally {
      setModalLoading(false);
    }
  };

  // Ouvrir la modal d'édition pré-remplie avec les données de l'événement
  const openEditModal = (evt) => {
    const startD = new Date(evt.start_time);
    const endD   = new Date(evt.end_time);
    const toTime = (d) => `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
    setEditEventId(String(evt.id));
    setEditTitle(evt.title);
    setEditDate(evt.start_time.split("T")[0]);
    setEditStartTime(toTime(startD));
    setEditEndTime(toTime(endD));
    setEditConstraint(evt.constraint_type || "soft");
    setEditDescription(evt.description || "");
    setEditError("");
    setShowEditModal(true);
  };

  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    setEditError("");
    if (!editTitle.trim()) { setEditError("Le titre est obligatoire."); return; }
    if (editEndTime <= editStartTime) { setEditError("L'heure de fin doit être après l'heure de début."); return; }
    setEditLoading(true);
    try {
      const startISO = `${editDate}T${editStartTime}:00`;
      const endISO   = `${editDate}T${editEndTime}:00`;

      if (isOffline) {
        // Enregistrer la mutation de mise à jour
        await db.offline_mutations.add({
          type: 'UPDATE',
          targetId: editEventId,
          data: {
            title: editTitle.trim(),
            start_time: startISO,
            end_time: endISO,
            constraint_type: editConstraint,
            description: editDescription.trim()
          },
          timestamp: Date.now()
        });
        // Mise à jour optimiste dans le cache Dexie
        await db.events.update(editEventId, {
          title: editTitle.trim(),
          start_time: startISO,
          end_time: endISO,
          constraint_type: editConstraint,
          status: 'pending'
        });
        setToastNotification({
          title: "Modification enregistrée hors-ligne",
          body: `"${editTitle}" sera synchronisé au retour en ligne.`
        });
      } else {
        await api.updateEvent(editEventId, {
          title: editTitle.trim(),
          startTime: startISO,
          endTime: endISO,
          constraintType: editConstraint,
          description: editDescription.trim(),
        });
        setToastNotification({
          title: "Événement modifié",
          body: `"${editTitle}" mis à jour avec succès.`
        });
      }
      setShowEditModal(false);
      await loadEvents();
    } catch (err) {
      console.error("Erreur mise à jour événement:", err);
      if (err.message === "Failed to fetch" || err.message.includes("NetworkError") || err.message.includes("fetch")) {
        setEditError(`Impossible de joindre le serveur (${getApiUrl()}). Vérifiez que le backend tourne sur ce port.`);
      } else {
        setEditError(err.message);
      }
    } finally {
      setEditLoading(false);
    }
  };

  // Ouvrir la confirmation de suppression
  const openDeleteConfirm = (evt) => {
    setDeleteTarget({ id: String(evt.id), title: evt.title });
    setShowDeleteConfirm(true);
  };

  const handleDeleteEvent = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      if (isOffline) {
        // Enregistrer la mutation de suppression
        await db.offline_mutations.add({
          type: 'DELETE',
          targetId: deleteTarget.id,
          data: {},
          timestamp: Date.now()
        });
        // Suppression optimiste du cache local
        await db.events.delete(deleteTarget.id);
        setToastNotification({
          title: "Suppression enregistrée hors-ligne",
          body: `"${deleteTarget.title}" sera supprimé du serveur au retour en ligne.`
        });
      } else {
        await api.deleteEvent(deleteTarget.id);
        setToastNotification({
          title: "Événement supprimé",
          body: `"${deleteTarget.title}" a été supprimé définitivement.`
        });
      }
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      await loadEvents();
    } catch (err) {
      console.error("Erreur suppression événement:", err);
      setToastNotification({
        title: "Erreur de suppression",
        body: err.message
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const triggerCalendarSync = async () => {
    setSyncLoading(true);
    try {
      const res = await api.syncCalendars();
      setToastNotification({
        title: "Synchronisation externe réussie",
        body: `${res.imported} événement(s) importé(s), ${res.scheduler_relocations} déplacement(s) d'optimisation.`
      });
      await loadEvents();
    } catch (e) {
      setToastNotification({
        title: "Échec de synchronisation",
        body: e.message
      });
    } finally {
      setSyncLoading(false);
    }
  };

  // --- Optimisation d'Intentions Floues & Données Hétérogènes ---
  const handleOptimizeFuzzy = async (overrideText) => {
    const textToAnalyze = overrideText !== undefined ? overrideText : fuzzyInput;
    if (!textToAnalyze || !textToAnalyze.trim()) {
      setFuzzyError("Veuillez saisir une intention ou coller des notes à analyser.");
      return;
    }
    setFuzzyLoading(true);
    setFuzzyError("");
    try {
      const res = await api.optimizeFuzzy(textToAnalyze, selectedDate);
      if (res.status === "no_intent_detected") {
        setFuzzyError(res.summary || "Aucune intention concrète n'a pu être déduite de ce texte.");
        setFuzzyResults([]);
      } else {
        setFuzzyResults(res.proposals || []);
        setFuzzySummary(res.summary || "");
      }
    } catch (err) {
      console.error(err);
      setFuzzyError(err.message || "Erreur lors de l'analyse et de l'optimisation.");
    } finally {
      setFuzzyLoading(false);
    }
  };

  const handleAcceptFuzzyItem = async (item) => {
    try {
      await api.createEvent(
        item.title,
        item.start_time,
        item.end_time,
        item.constraint_type || "soft",
        item.reasoning || ""
      );
      setFuzzyAcceptedMap(prev => ({ ...prev, [item.id]: true }));
      setToastNotification({
        title: "Événement planifié !",
        body: `« ${item.title} » a été ajouté à votre agenda pour ${item.formatted_slot}.`
      });
      await loadEvents();
    } catch (err) {
      console.error(err);
      alert(`Erreur: ${err.message}`);
    }
  };

  const handleBatchAcceptFuzzy = async () => {
    if (!fuzzyResults || fuzzyResults.length === 0) return;
    const toCreate = fuzzyResults
      .filter(item => !fuzzyAcceptedMap[item.id])
      .map(item => ({
        title: item.title,
        start_time: item.start_time,
        end_time: item.end_time,
        constraint_type: item.constraint_type || "soft",
        description: item.reasoning || ""
      }));

    if (toCreate.length === 0) return;
    setFuzzyLoading(true);
    try {
      await api.batchCreateEvents(toCreate);
      const newMap = { ...fuzzyAcceptedMap };
      fuzzyResults.forEach(item => { newMap[item.id] = true; });
      setFuzzyAcceptedMap(newMap);
      setToastNotification({
        title: "Planning mis à jour !",
        body: `${toCreate.length} événement(s) ont été intégrés dynamiquement à votre calendrier.`
      });
      await loadEvents();
    } catch (err) {
      console.error(err);
      alert(`Erreur lors de la création par lot : ${err.message}`);
    } finally {
      setFuzzyLoading(false);
    }
  };

  const handleAcceptProposal = async (proposalItem) => {
    try {
      await api.createEvent(
        proposalItem.title,
        proposalItem.start_time,
        proposalItem.end_time,
        proposalItem.constraint_type || "soft",
        proposalItem.reasoning || ""
      );
      setAcceptedProposals(prev => ({ ...prev, [proposalItem.id]: true }));
      setToastNotification({
        title: "Événement planifié !",
        body: `« ${proposalItem.title} » a été ajouté à votre agenda pour ${proposalItem.formatted_slot}.`
      });
      await loadEvents();
    } catch (err) {
      console.error(err);
      alert(`Erreur lors de l'ajout : ${err.message}`);
    }
  };

  // --- Assistant Conversational Logic ---
  const handleSendMessage = async (textToSend) => {
    const text = textToSend || chatInput;
    if (!text.trim()) return;

    let activeId = currentConversationId;
    if (!activeId) {
      activeId = await createNewConversation();
      setCurrentConversationId(activeId);
      sessionStorage.setItem("KRONO_CONVERSATION_ID", activeId);
    }

    const userMsg = { 
      conversationId: activeId, 
      sender: "user", 
      text, 
      timestamp: Date.now() 
    };
    await db.messages.add(userMsg);
    if (activeId === currentConversationId) {
      setMessages(prev => [...prev, userMsg]);
    }
    setChatInput("");
    setAssistantThinking(true);

    try {
      // Conversation : Aura reçoit les derniers échanges de cette conversation, pas seulement la dernière phrase
      const history = [...messages, userMsg]
        .filter((m) => m.conversationId === activeId)
        .slice(-12)
        .map((m) => ({ role: m.sender === "user" ? "user" : "assistant", content: m.text }));
      const pad = (n) => String(n).padStart(2, "0");
      const now = new Date();
      const nowLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const res = await api.assistantChat(history, nowLocal);

      const assistantMsg = {
        conversationId: activeId,
        sender: "assistant",
        text: res.reply,
        timestamp: Date.now(),
        suggestions: res.suggestions || [],
        actions: (res.actions || []).map((a) => ({ ...a, status: "pending" })),
        mailResults: res.mail_results || null,
      };
      const id = await db.messages.add(assistantMsg);
      if (activeId === currentConversationId) {
        setMessages(prev => [...prev, { ...assistantMsg, id }]);
      }
    } catch (e) {
      console.error(e);
      const errMsg = {
        conversationId: activeId,
        sender: "assistant",
        text: e.message && e.message.includes("indisponible")
          ? "Je ne peux pas répondre pour le moment : le service d'IA est indisponible. Réessayez dans un instant."
          : `Je n'ai pas pu traiter votre message (${e.message}). Reformulez-le, ou dites-moi simplement en quoi je peux vous aider.`,
        timestamp: Date.now()
      };
      const id = await db.messages.add(errMsg);
      if (activeId === currentConversationId) {
        setMessages(prev => [...prev, { ...errMsg, id }]);
      }
    } finally {
      setAssistantThinking(false);
    }
  };

  // --- Actions proposées par Aura : exécutées UNIQUEMENT après confirmation de l'utilisateur ---
  const setAssistantActionStatus = async (msg, actionId, status, error = null) => {
    const actions = (msg.actions || []).map((a) => (a.id === actionId ? { ...a, status, error } : a));
    await db.messages.update(msg.id, { actions });
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, actions } : m)));
  };

  const confirmAssistantAction = async (msg, action) => {
    const p = action.params || {};
    const iso = (date, time) => `${date}T${time}:00`;
    try {
      if (action.type === "create_event") {
        await api.createEvent(p.title, iso(p.date, p.start_time), iso(p.date, p.end_time), "soft", "", p.location || null);
      } else if (action.type === "move_event") {
        await api.updateEvent(p.event_id, { startTime: iso(p.date, p.start_time), endTime: iso(p.date, p.end_time) });
      } else if (action.type === "delete_event") {
        await api.deleteEvent(p.event_id);
      } else if (action.type === "send_email") {
        await api.googleSend({ to: p.to, cc: p.cc || [], subject: p.subject, body: p.body });
      } else if (action.type === "schedule_email") {
        await api.googleSchedule({ to: p.to, cc: p.cc || [], subject: p.subject, body: p.body, send_at: p.send_at });
      } else if (action.type === "create_contact") {
        await api.createContact(p.name, p.email || null, p.phone || null, p.company || null);
      } else if (action.type === "create_meeting") {
        const res = await api.assistantCreateMeeting({
          title: p.title,
          start_time: iso(p.date, p.start_time).slice(0, 16),
          end_time: iso(p.date, p.end_time).slice(0, 16),
          invitees: p.invitees || [],
          send_invitations: (p.invitees || []).length > 0,
        });
        setAssistantMeetingLink(res.link);
      } else {
        throw new Error("Action inconnue.");
      }
      await setAssistantActionStatus(msg, action.id, "done");
      if (["create_event", "move_event", "delete_event", "create_meeting"].includes(action.type)) await loadEvents();
    } catch (e) {
      await setAssistantActionStatus(msg, action.id, "error", e.message);
    }
  };

  const cancelAssistantAction = (msg, action) => setAssistantActionStatus(msg, action.id, "cancelled");

  // Véritable reconnaissance vocale (Web Speech API)
  const handleMicClick = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Votre navigateur ne supporte pas la reconnaissance vocale.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceTranscription("En écoute...");
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceTranscription(`Compris : "${transcript}"`);
      setTimeout(() => {
        setIsListening(false);
        setVoiceTranscription("");
        handleSendMessage(transcript);
      }, 1000);
    };

    recognition.onerror = (event) => {
      console.error("Erreur micro:", event.error);
      setVoiceTranscription(`Erreur : ${event.error}`);
      setTimeout(() => {
        setIsListening(false);
        setVoiceTranscription("");
      }, 2000);
    };
    
    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("Impossible de démarrer le micro:", e);
      setIsListening(false);
    }
  };

  // --- Trip / ETA Handlers ---
  const handleComputeETA = async (e) => {
    e.preventDefault();
    setEtaLoading(true);
    setEtaResult(null);
    try {
      const now = new Date();
      const targetTime = new Date(`${selectedDate}T${meetingTime}:00`);
      
      const res = await api.computeEta(
        currentLat, 
        currentLng, 
        meetingLat, 
        meetingLng, 
        targetTime.toISOString()
      );
      setEtaResult(res);
    } catch (err) {
      setToastNotification({
        title: "Calcul ETA échoué",
        body: err.message
      });
    } finally {
      setEtaLoading(false);
    }
  };

  // --- Sync Google / MS simulation ---
  const handleLinkCalendar = async (provider) => {
    const token = localStorage.getItem("KRONO_TOKEN");
    if (!token) {
      setToastNotification({ title: "Erreur", body: "Vous devez être connecté pour lier un calendrier." });
      return;
    }
    // Redirect to backend login endpoint, passing the JWT so backend knows which user is authenticating
    window.location.href = `http://127.0.0.1:8000/calendar/auth/${provider}/login?token=${token}`;
  };

  // Helper de formatage de l'heure
  const formatTime = (isoString) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}h${m === "00" ? "" : m}`;
  };

  // Filtrer les événements pour le jour sélectionné
  const dayEvents = useMemo(() => {
    return events.filter(e => {
      const eventDate = e.start_time.split("T")[0];
      return eventDate === selectedDate;
    });
  }, [events, selectedDate]);

  // Nombre de conflits totaux
  const conflictsCount = useMemo(() => {
    return events.filter(e => e.status === "conflict").length;
  }, [events]);

  // Rendu de la Page d'Accueil moderne TechSphere
  if (showLandingPage) {
    return (
      <LandingPage
        isLoggedIn={!!token}
        onEnterApp={() => setShowLandingPage(false)}
        onOpenAuth={(mode) => {
          switchAuthMode(mode === "login");
          setShowLandingPage(false);
        }}
      />
    );
  }

  // Rendu de l'écran d'Authentification si non connecté
  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-mesh-alert-light px-4 py-12 relative" style={{ backgroundColor: COLORS.bg }}>
        {/* Bouton retour accueil */}
        <button
          onClick={() => setShowLandingPage(true)}
          className="absolute top-6 left-6 px-4 py-2 rounded-xl bg-white border border-outline-variant/40 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-2 shadow-sm transition-all"
        >
          <Home className="w-4 h-4 text-primary" />
          <span>← Page d'accueil Krono AI</span>
        </button>

        <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl border border-outline-variant/40 shadow-lg">
          <div className="text-center">
            <h1 className="text-3xl font-hanken font-bold tracking-tight text-primary">Krono AI</h1>
            <p className="mt-2 text-sm text-outline uppercase tracking-wider font-geist">Digital Atelier Planning</p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleAuth}>
            {authError && (
              <div className="bg-error-container text-on-error-container p-3 rounded text-sm border border-error/20 flex gap-2">
                <AlertTriangle className="shrink-0 w-4 h-4 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <div className="space-y-4">
              {!isLogin && (
                <div>
                  <label htmlFor="auth-name" className="blueprint-label">Nom complet</label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={255}
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-outline-variant/60 rounded focus:border-primary outline-none text-sm"
                  />
                </div>
              )}
              <div>
                <label htmlFor="auth-email" className="blueprint-label">Adresse Email</label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-outline-variant/60 rounded focus:border-primary outline-none text-sm"
                />
              </div>
              <div>
                <label htmlFor="auth-password" className="blueprint-label">Mot de passe</label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-outline-variant/60 rounded focus:border-primary outline-none text-sm"
                />
                {!isLogin && (
                  <p className="mt-1 text-[11px] text-outline">
                    8 caractères minimum, avec au moins une lettre et un chiffre.
                  </p>
                )}
              </div>
              {!isLogin && (
                <div>
                  <label htmlFor="auth-password-confirm" className="blueprint-label">Confirmer le mot de passe</label>
                  <input
                    id="auth-password-confirm"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={authPasswordConfirm}
                    onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-outline-variant/60 rounded focus:border-primary outline-none text-sm"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2 bg-primary-black hover:bg-neutral-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded active:scale-95 transition-all text-sm uppercase tracking-wide flex justify-center items-center"
              >
                {authLoading
                  ? (isLogin ? "Connexion..." : "Création du compte...")
                  : (isLogin ? "Se connecter" : "S'inscrire")}
              </button>

              <button
                type="button"
                onClick={() => switchAuthMode(!isLogin)}
                className="text-xs text-secondary-blue hover:underline text-center mt-2"
              >
                {isLogin ? "Créer un compte à l'atelier" : "Déjà membre ? Se connecter"}
              </button>
            </div>
          </form>

          {/* Config URL API */}
          <div className="pt-6 border-t border-outline-variant/20 flex flex-col gap-2">
            <span className="text-[10px] font-geist text-outline uppercase">Adresse de l'API Backend</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                className="flex-1 px-2 py-1 text-xs border border-outline-variant/60 rounded outline-none"
              />
              <button
                onClick={updateApiBaseUrl}
                className="px-2 py-1 bg-outline-variant/30 text-xs font-medium rounded hover:bg-outline-variant/50"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden text-slate-100 font-sans"
      style={{ background: "var(--bg-main, #060d1a)" }}
      data-theme={appTheme}
    >
      {/* ─── TOPBAR TECHSPHERE WEBMAIL (52PX) ─── */}
      {/* ─── EN-TÊTE SUPÉRIEUR (TOPBAR KRONO AI EXACTE DESIGN) ─── */}
      <header
        className="h-[54px] shrink-0 border-b flex items-center justify-between px-5 z-40 select-none shadow-sm"
        style={{
          background: "#0b0f19",
          borderColor: "rgba(255, 255, 255, 0.07)",
        }}
      >
        {/* Left: Global Search Input */}
        <div className="relative">
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-[#101726] border border-slate-800/80 text-xs text-slate-300 w-80 max-w-sm focus-within:border-indigo-500/50 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchDropdown(true);
              }}
              onFocus={() => setShowSearchDropdown(true)}
              placeholder="Rechercher événements, contacts, dossiers"
              className="bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500 flex-1"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setShowSearchDropdown(false);
                }}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Instant Search Results Dropdown */}
          {showSearchDropdown && searchQuery.trim().length > 1 && (
            <div
              className="absolute top-full left-0 mt-2 w-96 rounded-xl shadow-2xl p-2.5 z-50 animate-fadeIn"
              style={{
                background: "#121826",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
              onMouseLeave={() => setShowSearchDropdown(false)}
            >
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Résultats pour « {searchQuery} »
              </div>

              {/* Événements correspondants */}
              <div className="mt-1">
                <div className="text-[10px] text-indigo-400 font-semibold px-2 py-0.5">ÉVÉNEMENTS AGENDA</div>
                {events.filter(e => (e.title || "").toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(e => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setShowSearchDropdown(false);
                      openEditModal(e);
                    }}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-800/60 flex items-center justify-between text-xs transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-white truncate">{e.title}</div>
                      <div className="text-[10px] text-slate-400">{e.start_time?.slice(0, 16).replace("T", " à ")}</div>
                    </div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                      Voir
                    </span>
                  </button>
                ))}
                {events.filter(e => (e.title || "").toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <div className="px-2 py-1 text-[11px] text-slate-500 italic">Aucun événement correspondant</div>
                )}
              </div>

              {/* Contacts correspondants */}
              <div className="mt-2 pt-2 border-t border-slate-800">
                <div className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5">CONTACTS</div>
                {contacts.filter(c => (c.name || "").toLowerCase().includes(searchQuery.toLowerCase()) || (c.email || "").toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setShowSearchDropdown(false);
                      setContactSearch(c.name);
                      setActiveTab("contacts");
                    }}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-800/60 flex items-center justify-between text-xs transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-white truncate">{c.name}</div>
                      <div className="text-[10px] text-slate-400">{c.email || c.phone_number || "Contact"}</div>
                    </div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      Ouvrir
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center: System Status Chips */}
        <div className="hidden md:flex items-center gap-2.5">
          <button
            onClick={handleSyncNow}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#101726] border border-slate-800/80 hover:border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
            title="Cliquer pour forcer la synchronisation de l'agenda et des contacts"
          >
            <span className={`w-2 h-2 rounded-full bg-emerald-500 ${syncLoading ? "animate-spin" : "animate-pulse"}`}></span>
            <span>{syncLoading ? "Synchronisation..." : "Synchronisation active"}</span>
          </button>
          <button
            onClick={() => setShowAiPrefs(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#101726] border border-slate-800/80 hover:border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
            title="Cliquer pour configurer le moteur et les modèles IA"
          >
            <span className="w-2 h-2 rounded-full bg-sky-400"></span>
            <span>Moteur IA connecté</span>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setModalDate(selectedDate); setShowAddModal(true); }}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#a5b4fc] text-[#0b0f19] hover:bg-[#818cf8] hover:text-white transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Planifier</span>
          </button>
          
          <button
            onClick={() => setShowFuzzyModal(true)}
            className="w-8 h-8 rounded-xl bg-[#101726] border border-slate-800/80 flex items-center justify-center text-slate-300 hover:text-amber-400 hover:bg-slate-800 transition-colors"
            title="Actions rapides / Intentions floues"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowNotificationsDropdown(!showNotificationsDropdown)}
              className="w-8 h-8 rounded-xl bg-[#101726] border border-slate-800/80 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors relative"
              title="Centre de notifications"
            >
              <Bell className="w-3.5 h-3.5" />
              {(toastNotification || events.some(e => e.status === "conflict")) && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
              )}
            </button>

            {showNotificationsDropdown && (
              <div
                className="absolute top-full right-0 mt-2 w-80 rounded-xl shadow-2xl p-3 z-50 animate-fadeIn"
                style={{
                  background: "#121826",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
                onMouseLeave={() => setShowNotificationsDropdown(false)}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-white">Notifications & Alertes</span>
                  <span className="text-[10px] text-slate-400">Temps réel</span>
                </div>

                <div className="py-2 space-y-2">
                  {toastNotification && (
                    <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-xs">
                      <div className="font-bold text-indigo-300">{toastNotification.title}</div>
                      <div className="text-[11px] text-slate-300 mt-0.5">{toastNotification.body}</div>
                    </div>
                  )}

                  {events.some(e => e.status === "conflict") ? (
                    <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/50 text-xs space-y-1.5">
                      <div className="font-bold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        Conflits d'agenda détectés
                      </div>
                      <div className="text-[11px] text-slate-300">
                        {events.filter(e => e.status === "conflict").length} créneau(x) en chevauchement.
                      </div>
                      <button
                        onClick={() => {
                          setShowNotificationsDropdown(false);
                          handleResolveAI();
                        }}
                        className="w-full mt-1 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px] transition-colors"
                      >
                        Résoudre par IA
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Aucun conflit d'agenda en cours.</span>
                    </div>
                  )}

                  <div className="p-2 rounded-lg bg-[#0b0f19] border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Aujourd'hui : {events.filter(e => e.start_time?.startsWith(selectedDate)).length} événement(s)</span>
                    <button
                      onClick={() => {
                        setShowNotificationsDropdown(false);
                        setActiveTab("dashboard");
                      }}
                      className="text-indigo-400 hover:underline font-semibold"
                    >
                      Voir
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Profile User Avatar Button */}
          <div className="relative">
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="w-8 h-8 rounded-full bg-[#1e293b] border border-slate-700 flex items-center justify-center text-slate-200 hover:border-slate-500 transition-colors"
              title="Profil utilisateur"
            >
              <User className="w-4 h-4 text-slate-300" />
            </button>

            {showAccountMenu && (
              <div
                className="absolute top-full right-0 mt-2 w-64 rounded-xl shadow-2xl p-2 z-50 animate-fadeIn"
                style={{
                  background: "#121826",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
                onMouseLeave={() => setShowAccountMenu(false)}
              >
                <div className="px-3 py-2 border-b border-slate-800">
                  <p className="text-xs font-bold text-white truncate">{currentUser?.full_name || "Directeur Ops"}</p>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{currentUser?.email || "ops@krono.ai"}</p>
                </div>
                <button
                  onClick={() => { setShowAccountMenu(false); setShowSecurityModal(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors mt-1"
                >
                  <Shield className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Sécurité 2FA & Appareils</span>
                </button>
                <button
                  onClick={() => { setShowAccountMenu(false); setActiveTab("admin"); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Panneau d'Administration</span>
                </button>
                <button
                  onClick={() => { setShowAccountMenu(false); setShowLandingPage(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors"
                >
                  <Home className="w-3.5 h-3.5 text-slate-400" />
                  <span>Page d'accueil</span>
                </button>
                <div className="my-1 border-t border-slate-800"></div>
                <button
                  onClick={() => { setShowAccountMenu(false); handleLogout(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Se déconnecter</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── CORPS PRINCIPAL DE L'APPLICATION ─── */}
      <div className="app-body flex flex-1 overflow-hidden relative">

        {/* ─── SIDEBAR KRONO AI (EXACTE DESIGN DES CAPTURES) ─── */}
        <aside
          className="sidebar shrink-0 flex flex-col justify-between transition-all duration-200 z-30 select-none w-[230px] min-w-[230px]"
          style={{
            background: "#090d16",
            borderRight: "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <div>
            {/* Logo & Marque KronoAI */}
            <div className="p-4 flex items-center gap-3 border-b border-slate-800/40">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-950/50 shrink-0">
                <Calendar className="w-4 h-4 stroke-[2.2]" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-sm text-white tracking-wide leading-tight">KronoAI</span>
                <span className="text-[11px] text-slate-400 leading-tight">Planification &amp; IA</span>
              </div>
            </div>

            {/* Menu Items */}
            <div className="p-3 space-y-4">
              {/* Section 1: NAVIGATION */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 py-1">
                  NAVIGATION
                </div>

                {/* 1. Calendrier */}
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "dashboard"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <Calendar className="w-4 h-4 shrink-0" />
                  <span>Calendrier</span>
                </button>

                {/* 2. Assistant IA with PRO badge */}
                <button
                  onClick={() => setActiveTab("assistant")}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "assistant"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>Assistant IA</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    activeTab === "assistant" ? "bg-white/20 text-white" : "bg-indigo-950 text-indigo-300 border border-indigo-800/50"
                  }`}>
                    PRO
                  </span>
                </button>

                {/* 3. Contact */}
                <button
                  onClick={() => setActiveTab("contacts")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "contacts"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <User className="w-4 h-4 shrink-0" />
                  <span>Contact</span>
                </button>

                {/* 4. Mapping */}
                <button
                  onClick={() => setActiveTab("geomap")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "geomap"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <Compass className="w-4 h-4 shrink-0" />
                  <span>Mapping</span>
                </button>

                {/* 5. Messagerie with badge 3 */}
                <button
                  onClick={() => setActiveTab("messaging")}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "messaging"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <span>Messagerie</span>
                  </div>
                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                    3
                  </span>
                </button>
              </div>

              {/* Section 2: OUTILS */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 py-1">
                  OUTILS
                </div>

                {/* Briefing */}
                <button
                  onClick={() => setActiveTab("briefing")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "briefing"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>Briefing</span>
                </button>

                {/* Réunion */}
                <button
                  onClick={() => setShowMeetingToolsModal(true)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
                >
                  <Video className="w-4 h-4 shrink-0" />
                  <span>Réunion</span>
                </button>

                {/* Importer Planning */}
                <button
                  onClick={() => setShowFuzzyModal(true)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Importer Planning</span>
                </button>

                {/* Panneau Admin */}
                <button
                  onClick={() => setActiveTab("admin")}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "admin"
                      ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/40 font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <SlidersHorizontal className="w-4 h-4 shrink-0" />
                    <span>Administration</span>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-800/40">
                    ADMIN
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-slate-800/80 flex flex-col gap-3">
            <div className="flex items-center justify-between text-slate-400 px-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowNotificationsDropdown(!showNotificationsDropdown)}
                  className="p-1.5 hover:text-white rounded-lg transition-colors"
                  title="Notifications"
                >
                  <Bell className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setShowSecurityModal(true)}
                  className="p-1.5 hover:text-white rounded-lg transition-colors"
                  title="Sécurité & Paramètres"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="text-[11px] font-mono text-slate-500">v2.4 Pro</span>
            </div>

            <div 
              onClick={() => setShowSecurityModal(true)}
              className="flex items-center gap-2.5 p-2 rounded-xl bg-[#121826] border border-slate-800/60 cursor-pointer hover:border-slate-700 transition-colors"
              title="Gérer la sécurité et les appareils connectés"
            >
              <div className="w-7 h-7 rounded-full bg-indigo-950 border border-indigo-700/50 flex items-center justify-center text-indigo-300 font-bold text-xs shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-white truncate">Directeur Ops</span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  En ligne
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* ─── CORPS PRINCIPAL DE VUE ─── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative" style={{ background: "#0b0f19" }}>
        
        {/* Banner Alert d'Urgence (Module F + templates) */}
        {emergencyAlert && (
          <div className="bg-error text-white px-container-padding py-2 flex items-center justify-between gap-4 z-50">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>{emergencyAlert.title} : {emergencyAlert.body}</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleSendMessage(`déplace ${emergencyAlert.event.title} à demain`)}
                className="bg-white text-error font-medium px-3 py-1 rounded text-xs hover:bg-neutral-100 active:scale-95 transition-all shadow"
              >
                Résoudre par AI
              </button>
              <button 
                onClick={() => setEmergencyAlert(null)} 
                className="text-white/80 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* --- VIEW ROUTER --- */}
        <main className="flex-1 overflow-hidden relative">
          
          {/* TAB 1: CALENDRIER DYNAMIQUE (EXACT DESIGN DE LA CAPTURE) */}
          {activeTab === "dashboard" && (
            <div className="h-full flex flex-col p-5 overflow-y-auto min-w-0 hide-scrollbar" style={{ background: "#0b0f19" }}>
              {/* Header Title & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">Calendrier dynamique</h1>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>Semaine / {daysOfWeek[0]?.date.split("-")[2]} — {daysOfWeek[6]?.date.split("-")[2]} {new Date(selectedDate).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={handleSyncNow}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-[#121826] border border-slate-800 hover:border-slate-700 flex items-center gap-2 transition-all shadow-sm"
                    title="Synchroniser avec le backend et les calendriers externes"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${syncLoading ? "animate-spin" : ""}`} />
                    <span>Synchroniser (SIG/EDT)</span>
                  </button>
                  <button
                    onClick={() => setShowFuzzyModal(true)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-[#121826] border border-slate-800 hover:border-slate-700 flex items-center gap-2 transition-all shadow-sm"
                  >
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Importer planning</span>
                  </button>
                  <button
                    onClick={handleResolveAI}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-indigo-200 bg-gradient-to-r from-indigo-950/90 to-purple-950/90 border border-indigo-500/50 hover:border-indigo-400 flex items-center gap-2 transition-all shadow-sm shadow-indigo-950/50"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                    <span>Optimiser créneaux via IA</span>
                  </button>
                </div>
              </div>

              {/* Toolbar: Navigation, View switcher, Filters */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-[#121826] border border-slate-800/80 mb-4 text-xs">
                <div className="flex items-center gap-2.5">
                  <button onClick={() => {
                    const d = new Date(selectedDate);
                    d.setDate(d.getDate() - 7);
                    setSelectedDate(d.toISOString().slice(0, 10));
                  }} className="p-1 text-slate-400 hover:text-white transition-colors" title="Semaine précédente">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setSelectedDate(getTodayDateString())} className="font-semibold text-slate-200 hover:text-white px-2.5 py-1 rounded-lg hover:bg-slate-800 transition-colors">
                    Aujourd'hui
                  </button>
                  <button onClick={() => {
                    const d = new Date(selectedDate);
                    d.setDate(d.getDate() + 7);
                    setSelectedDate(d.toISOString().slice(0, 10));
                  }} className="p-1 text-slate-400 hover:text-white transition-colors" title="Semaine suivante">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="font-bold text-white text-sm ml-2">
                    {new Date(selectedDate).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                  </span>
                </div>

                {/* View switcher pills */}
                <div className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-lg border border-slate-800/80">
                  <button
                    onClick={() => setCalendarView("day")}
                    className={`px-3 py-1 rounded-md transition-colors ${calendarView === "day" ? "bg-[#818cf8] text-white font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Jour
                  </button>
                  <button
                    onClick={() => setCalendarView("week")}
                    className={`px-3 py-1 rounded-md transition-colors ${calendarView === "week" ? "bg-[#818cf8] text-white font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Semaine
                  </button>
                  <button
                    onClick={() => setCalendarView("month")}
                    className={`px-3 py-1 rounded-md transition-colors ${calendarView === "month" ? "bg-[#818cf8] text-white font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Mois
                  </button>
                  <button
                    onClick={() => setCalendarView("agenda")}
                    className={`px-3 py-1 rounded-md transition-colors ${calendarView === "agenda" ? "bg-[#818cf8] text-white font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Planning
                  </button>
                </div>

                {/* Filter pills */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCategoryFilter("all")}
                    className={`px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5 transition-colors ${
                      categoryFilter === "all" ? "bg-slate-800 text-white font-semibold border border-slate-700" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> Tous
                  </button>
                  <button
                    onClick={() => setCategoryFilter("ops")}
                    className={`px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5 transition-colors ${
                      categoryFilter === "ops" ? "bg-slate-800 text-white font-semibold border border-slate-700" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span> Ops &amp; RH
                  </button>
                  <button
                    onClick={() => setCategoryFilter("briefing")}
                    className={`px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5 transition-colors ${
                      categoryFilter === "briefing" ? "bg-slate-800 text-white font-semibold border border-slate-700" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Briefings IA
                  </button>
                  <button
                    onClick={() => setCategoryFilter("terrain")}
                    className={`px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5 transition-colors ${
                      categoryFilter === "terrain" ? "bg-slate-800 text-white font-semibold border border-slate-700" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span> Missions Terrain
                  </button>
                </div>
              </div>

              {/* Affichage conditionnel selon calendarView */}
              {calendarView === "agenda" ? (
                /* Vue Planning / Agenda chronologique */
                <div className="flex-1 rounded-2xl p-5 bg-[#0c1220] border border-slate-800/90 shadow-2xl space-y-3 overflow-y-auto">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Liste chronologique des événements planifiés</div>
                  {events
                    .filter(e => filterEventByCategory(e))
                    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""))
                    .map((evt) => (
                      <div
                        key={evt.id}
                        onClick={() => openEditModal(evt)}
                        className="p-3 rounded-xl bg-[#121826] border border-slate-800 hover:border-indigo-500/50 flex items-center justify-between cursor-pointer transition-all shadow-md group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-indigo-950/60 border border-indigo-800/50 flex items-center justify-center text-indigo-400 font-bold text-xs">
                            <Calendar className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">{evt.title}</div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              {evt.start_time?.slice(0, 10)} · {formatTime(evt.start_time)} - {formatTime(evt.end_time)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            evt.constraint_type === "hard" ? "bg-rose-950 text-rose-300 border border-rose-800" : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          }`}>
                            {evt.constraint_type === "hard" ? "FIXE" : "FLEXIBLE"}
                          </span>
                          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                /* Grille hebdomadaire 7 jours dynamique avec indicateur temps réel */
                <div className="flex-1 rounded-2xl overflow-x-auto overflow-y-auto relative min-h-[520px] bg-[#0c1220] border border-slate-800/90 shadow-2xl hide-scrollbar">
                  <div className="min-w-[850px] relative">
                    {/* Header Row: Fuseau + 7 Jours (ou 1 Jour si calendarView === "day") */}
                    <div className={`grid ${calendarView === "day" ? "grid-cols-[80px_1fr]" : "grid-cols-[80px_repeat(7,1fr)]"} border-b border-slate-800/80 sticky top-0 bg-[#0c1220] z-20`}>
                      <div className="p-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-center border-r border-slate-800/80">
                        FUSEAU UTC+2
                      </div>
                      {(calendarView === "day" ? daysOfWeek.filter(d => d.date === selectedDate) : daysOfWeek).map((day) => {
                        const isToday = day.date === getTodayDateString();
                        const isSelected = day.date === selectedDate;
                        const dayNum = day.date.split("-")[2];
                        return (
                          <div
                            key={day.date}
                            className={`p-2.5 flex flex-col items-center justify-center border-r border-slate-800/80 last:border-r-0 cursor-pointer transition-colors ${
                              isSelected ? "bg-indigo-950/40" : "hover:bg-slate-900/30"
                            }`}
                            onClick={() => setSelectedDate(day.date)}
                          >
                            <span className={`text-[11px] font-bold uppercase tracking-wider ${isToday ? "text-indigo-400" : "text-slate-400"}`}>
                              {day.name} {isToday ? "(AUJ)" : ""}
                            </span>
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-1 ${
                              isSelected ? "bg-[#818cf8] text-white shadow-md shadow-indigo-950/60" : "text-slate-200"
                            }`}>
                              {dayNum}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Body: Grille horaire 08:00 -> 18:00 */}
                    <div className="relative" style={{ height: `${CALENDAR_HOURS.length * 64}px` }}>
                      {/* Lignes horizontales d'heures */}
                      {CALENDAR_HOURS.map((h, idx) => (
                        <div
                          key={h}
                          className="absolute left-0 right-0 border-t border-slate-800/60 flex"
                          style={{ top: `${idx * 64}px`, height: "64px" }}
                        >
                          <div className="w-[80px] text-[10px] font-bold text-slate-500 font-mono pr-3 pt-1 text-right border-r border-slate-800/80 select-none">
                            {String(h).padStart(2, "0")}:00
                          </div>
                          {(calendarView === "day" ? daysOfWeek.filter(d => d.date === selectedDate) : daysOfWeek).map((day) => (
                            <div
                              key={day.date}
                              onClick={() => {
                                setModalDate(day.date);
                                setModalStartTime(`${String(h).padStart(2, "0")}:00`);
                                setModalEndTime(`${String(Math.min(h + 1, 23)).padStart(2, "0")}:00`);
                                setShowAddModal(true);
                              }}
                              className="flex-1 border-r border-slate-800/40 last:border-r-0 hover:bg-indigo-950/20 cursor-pointer transition-colors"
                              title={`Cliquer pour ajouter un événement le ${day.date} à ${String(h).padStart(2, "0")}:00`}
                            ></div>
                          ))}
                        </div>
                      ))}

                      {/* Ligne temps réel rouge/saumon qui traverse la grille */}
                      <div
                        className="absolute left-0 right-0 z-10 pointer-events-none flex items-center"
                        style={{
                          top: `${getCurrentTimeTopOffset()}px`,
                        }}
                      >
                        <span className="w-[74px] ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#f87171] text-white text-center shadow font-mono">
                          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <div className="flex-1 h-[2px] bg-[#f87171] shadow-[0_0_8px_rgba(248,113,113,0.8)]"></div>
                      </div>

                      {/* Colonnes d'événements */}
                      <div className={`absolute inset-0 left-[80px] grid ${calendarView === "day" ? "grid-cols-1" : "grid-cols-7"} pointer-events-none`}>
                        {(calendarView === "day" ? daysOfWeek.filter(d => d.date === selectedDate) : daysOfWeek).map((day) => {
                          const colEvents = events.filter(e => e.start_time && e.start_time.startsWith(day.date) && filterEventByCategory(e));
                          return (
                            <div key={day.date} className="relative h-full pointer-events-auto">
                              {colEvents.map((evt) => {
                                const startD = new Date(evt.start_time);
                                const endD = new Date(evt.end_time);
                                const startHour = startD.getHours() + startD.getMinutes() / 60;
                                const endHour = endD.getHours() + endD.getMinutes() / 60;
                                const topPx = Math.max(0, (startHour - 8) * 64);
                                const heightPx = Math.max(34, (endHour - startHour) * 64);

                                const isBriefing = evt.category === "briefing" || evt.title?.toLowerCase().includes("briefing");
                                const isSync = evt.title?.toLowerCase().includes("synchro") || evt.title?.toLowerCase().includes("edt");
                                const isHard = evt.constraint_type === "hard";
                                const isConflict = evt.status === "conflict";

                                return (
                                  <div
                                    key={evt.id}
                                    onClick={(e) => { e.stopPropagation(); openEditModal(evt); }}
                                    className={`absolute left-1.5 right-1.5 p-2 rounded-xl text-left cursor-pointer transition-all hover:scale-[1.02] shadow-lg select-none border ${
                                      isBriefing
                                        ? "bg-[#064e3b]/80 border-emerald-500/50 text-emerald-100"
                                        : isSync
                                        ? "bg-[#162036]/90 border-cyan-500/50 text-cyan-100"
                                        : isConflict
                                        ? "bg-[#451a03]/90 border-amber-500/60 text-amber-100 animate-pulse"
                                        : "bg-[#162036]/90 border-slate-700/80 text-slate-100"
                                    }`}
                                    style={{
                                      top: `${topPx + 2}px`,
                                      height: `${heightPx - 4}px`,
                                    }}
                                    title={`${evt.title} (${formatTime(evt.start_time)} - ${formatTime(evt.end_time)})`}
                                  >
                                    <div className="flex items-center justify-between gap-1 mb-0.5">
                                      <span className="text-[9px] font-bold font-mono opacity-80 truncate">
                                        {formatTime(evt.start_time)} - {formatTime(evt.end_time)}
                                      </span>
                                      {isHard && (
                                        <span className="text-[8px] font-bold uppercase px-1 rounded bg-rose-500/20 text-rose-300">
                                          HARD
                                        </span>
                                      )}
                                    </div>
                                    <h4 className="text-xs font-bold leading-tight truncate">{evt.title}</h4>
                                    {evt.reasoning && heightPx > 50 && (
                                      <p className="text-[10px] text-slate-400 truncate mt-0.5 opacity-90">{evt.reasoning}</p>
                                    )}
                                    {isConflict && (
                                      <span className="inline-block text-[8px] font-bold px-1 py-0.2 rounded bg-amber-500/30 text-amber-300 mt-0.5">
                                        Conflit év...
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Barre de synthèse sous la grille */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl bg-[#121826] border border-slate-800/80 my-4 text-xs">
                <div className="flex items-center gap-4 text-slate-300 font-medium">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    {Math.round(events.filter(e => daysOfWeek.some(d => e.start_time?.startsWith(d.date))).reduce((acc, e) => {
                      const s = new Date(e.start_time).getTime();
                      const en = new Date(e.end_time).getTime();
                      return acc + Math.max(0, (en - s) / 3600000);
                    }, 0))}h planifiées cette semaine
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                    {events.some(e => e.status === "conflict") ? "82% d'efficacité (conflits à résoudre)" : "94% d'efficacité d'agenda estimée"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Optimisation dynamique active par KronoAI</span>
                </div>
              </div>

              {/* Section inférieure : Mini Calendrier + Raccourcis Opérationnels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-1">
                {/* Carte 1: Mini Calendrier Mensuel */}
                <div className="p-4 rounded-2xl bg-[#121826] border border-slate-800/80">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-white">
                      {new Date(selectedDate).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                    </span>
                    <div className="flex items-center gap-1 text-slate-400">
                      <button onClick={() => {
                        const d = new Date(selectedDate);
                        d.setMonth(d.getMonth() - 1);
                        setSelectedDate(d.toISOString().slice(0, 10));
                      }} className="p-1 hover:text-white"><ChevronLeft className="w-3.5 h-3.5" /></button>
                      <button onClick={() => {
                        const d = new Date(selectedDate);
                        d.setMonth(d.getMonth() + 1);
                        setSelectedDate(d.toISOString().slice(0, 10));
                      }} className="p-1 hover:text-white"><ChevronRight className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs">
                    {["L", "M", "M", "J", "V", "S", "D"].map((l, i) => (
                      <span key={i} className="text-[10px] font-bold text-slate-500 py-1">{l}</span>
                    ))}
                    {Array.from({ length: 35 }, (_, idx) => {
                      const curDayNum = ((idx + 24) % 31) + 1;
                      const isSel = curDayNum === Number(selectedDate.split("-")[2]);
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            const cur = new Date(selectedDate);
                            cur.setDate(curDayNum);
                            setSelectedDate(cur.toISOString().slice(0, 10));
                          }}
                          className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isSel ? "bg-[#818cf8] text-white font-bold" : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                          }`}
                        >
                          {curDayNum}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Carte 2: Raccourcis Opérationnels */}
                <div className="p-4 rounded-2xl bg-[#121826] border border-slate-800/80 flex flex-col justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                    RACCOURCIS OPÉRATIONNELS
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <button
                      onClick={() => setActiveTab("briefing")}
                      className="p-3 rounded-xl bg-[#0b0f19] border border-slate-800/80 hover:border-indigo-500/50 text-left transition-all group"
                    >
                      <FileText className="w-4 h-4 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
                      <div className="text-xs font-bold text-white">Générateur Briefing</div>
                      <div className="text-[10px] text-slate-500">Prêt en 1 clic</div>
                    </button>

                    <button
                      onClick={() => setShowMeetingToolsModal(true)}
                      className="p-3 rounded-xl bg-[#0b0f19] border border-slate-800/80 hover:border-indigo-500/50 text-left transition-all group"
                    >
                      <Video className="w-4 h-4 text-sky-400 mb-2 group-hover:scale-110 transition-transform" />
                      <div className="text-xs font-bold text-white">Salle Express</div>
                      <div className="text-[10px] text-slate-500">Rejoindre visio</div>
                    </button>
                  </div>

                  <button
                    onClick={() => setShowFuzzyModal(true)}
                    className="w-full p-3 rounded-xl bg-[#0b0f19] border border-slate-800/80 hover:border-indigo-500/50 flex items-center justify-between text-left transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <Upload className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="text-xs font-bold text-white">Glisser ICS / XLSX / EDT</div>
                        <div className="text-[10px] text-slate-500">Synchronisation immédiate</div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ASSISTANT IA (DESIGN EXACT DES CAPTURES) */}
          {activeTab === "assistant" && (
            <div id="mode-ai" className="h-full flex flex-1 overflow-hidden w-full relative" style={{ background: "#0b0f19" }}>
              {/* Colonne latérale conversations */}
              <aside
                className="ai-side w-[280px] shrink-0 flex flex-col justify-between border-r border-slate-800/80 select-none"
                style={{ background: "#090d16" }}
              >
                <div className="flex flex-col flex-1 min-h-0">
                  {/* Header: Titre & Bouton + Nouvelle */}
                  <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-slate-300" />
                      <span className="font-bold text-sm text-white">Conversations</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const newId = await createNewConversation();
                        const convList = await db.conversations.orderBy('timestamp').reverse().toArray();
                        setConversations(convList);
                        setCurrentConversationId(newId);
                        sessionStorage.setItem("KRONO_CONVERSATION_ID", newId);
                        await loadMessagesForConversation(newId);
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-[#818cf8] hover:bg-[#6366f1] transition-all flex items-center gap-1 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Nouvelle</span>
                    </button>
                  </div>

                  {/* Champ de recherche: Filtrer l'historique */}
                  <div className="p-3 border-b border-slate-800/40">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#101726] border border-slate-800 text-xs text-slate-300">
                      <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type="text"
                        value={historyFilter}
                        onChange={(e) => setHistoryFilter(e.target.value)}
                        placeholder="Filtrer l'historique..."
                        className="bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500 flex-1"
                      />
                      {historyFilter && (
                        <button onClick={() => setHistoryFilter("")} className="text-slate-500 hover:text-white">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Liste ou État Vide */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-1 hide-scrollbar">
                    {conversations.filter(c => !historyFilter || (c.title || "").toLowerCase().includes(historyFilter.toLowerCase())).length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center py-10 px-2">
                        <div className="w-12 h-12 rounded-2xl bg-[#121826] border border-slate-800 flex items-center justify-center text-slate-500 mb-3 shadow-inner">
                          <MessageSquare className="w-6 h-6 stroke-[1.5]" />
                        </div>
                        <h4 className="text-xs font-bold text-white mb-1">
                          {historyFilter ? "Aucune conversation trouvée." : "Aucune conversation pour le moment."}
                        </h4>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {historyFilter ? "Modifiez votre filtre de recherche." : "Posez votre première question pour lancer l'orchestration !"}
                        </p>
                      </div>
                    ) : (
                      conversations
                        .filter(c => !historyFilter || (c.title || "").toLowerCase().includes(historyFilter.toLowerCase()))
                        .map((conv) => {
                        const isActive = conv.id === currentConversationId;
                        return (
                          <div
                            key={conv.id}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all ${
                              isActive
                                ? "bg-[#162036] text-white border border-indigo-500/40 shadow-sm"
                                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                            }`}
                            onClick={() => {
                              setCurrentConversationId(conv.id);
                              sessionStorage.setItem("KRONO_CONVERSATION_ID", conv.id);
                              loadMessagesForConversation(conv.id);
                            }}
                          >
                            <span className="truncate flex-1 pr-2">{conv.title}</span>
                            <button
                              type="button"
                              className="text-slate-500 hover:text-rose-400 p-0.5 rounded transition-colors"
                              title="Supprimer la conversation"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm("Supprimer cette conversation et ses messages ?")) {
                                  await db.conversations.delete(conv.id);
                                  await db.messages.where("conversationId").equals(conv.id).delete();
                                  let convList = await db.conversations.orderBy('timestamp').reverse().toArray();
                                  setConversations(convList);
                                  if (currentConversationId === conv.id) {
                                    if (convList.length > 0) {
                                      const firstId = convList[0].id;
                                      setCurrentConversationId(firstId);
                                      sessionStorage.setItem("KRONO_CONVERSATION_ID", firstId);
                                      await loadMessagesForConversation(firstId);
                                    } else {
                                      const newId = await createNewConversation();
                                      sessionStorage.setItem("KRONO_CONVERSATION_ID", newId);
                                      convList = await db.conversations.orderBy('timestamp').reverse().toArray();
                                      setConversations(convList);
                                      setCurrentConversationId(newId);
                                      await loadMessagesForConversation(newId);
                                    }
                                  }
                                }
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Section: Sujets Suggérés */}
                  <div className="p-3 border-t border-slate-800/60">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
                      SUJETS SUGGÉRÉS
                    </div>
                    <div className="space-y-1.5">
                      <button
                        onClick={() => handleSendMessage("Point agenda après-midi")}
                        className="w-full flex items-center gap-2 p-2 rounded-xl bg-[#121826] border border-slate-800 hover:border-indigo-500/40 text-left transition-all text-xs text-slate-300 group"
                      >
                        <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="truncate">Point agenda après-midi</span>
                      </button>

                      <button
                        onClick={() => handleSendMessage("Aide-moi à rédiger une note Q3.")}
                        className="w-full flex items-center gap-2 p-2 rounded-xl bg-[#121826] border border-slate-800 hover:border-indigo-500/40 text-left transition-all text-xs text-slate-300 group"
                      >
                        <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="truncate">Brouillon note Q3</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Footer du volet conversations */}
                <div className="p-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 bg-[#070b12]">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Modèle Llama-3 Enterprise</span>
                  </div>
                  <button
                    onClick={async () => {
                      if (confirm("Réinitialiser l'historique complet de discussion ?")) {
                        await db.conversations.clear();
                        await db.messages.clear();
                        setConversations([]);
                        setMessages([]);
                        const newId = await createNewConversation();
                        setCurrentConversationId(newId);
                      }
                    }}
                    className="p-1 hover:text-rose-400 text-slate-500 transition-colors"
                    title="Vider l'historique"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </aside>

              {/* Zone principale Assistant IA */}
              <section className="ai-main flex-1 flex flex-col min-w-0" style={{ background: "#0b0f19" }}>
                {/* Header Assistant IA */}
                <header className="h-[54px] px-5 border-b border-slate-800/80 flex items-center justify-between bg-[#0b0f19]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-950/40">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">Assistant IA</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          Actif
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">E-mails, agenda, contacts et réunions</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-slate-400">
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:text-white hover:bg-slate-800/60 transition-colors"
                      title="Filtres avancés"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:text-white hover:bg-slate-800/60 transition-colors"
                      onClick={() => setShowAiPrefs(true)}
                      title="Préférences de l'assistant"
                      aria-label="Préférences de l'assistant"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </header>

                <div className="ai-scroll flex-1 overflow-y-auto p-6 min-h-0 hide-scrollbar">
                  <div className="ai-thread max-w-4xl mx-auto flex flex-col gap-5" role="log" aria-live="polite">
                    {messages.length === 0 ? (
                      /* Écran d'accueil exact de la capture */
                      <div className="ai-welcome text-center py-6 px-2">
                        {/* Grand badge cyan avec point vert d'activité */}
                        <div className="relative inline-block mx-auto mb-4">
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500 to-cyan-400 flex items-center justify-center text-white shadow-xl shadow-cyan-900/40">
                            <Sparkles className="w-7 h-7" />
                          </div>
                          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#0b0f19]"></span>
                        </div>

                        <h2 className="text-2xl font-extrabold text-white tracking-tight mb-2">
                          Comment puis-je vous aider ?
                        </h2>
                        <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed mb-6">
                          Je rédige vos e-mails, remplis votre agenda, ajoute vos contacts et lance vos réunions. Vous vérifiez toujours avant de confirmer.
                        </p>
                        
                        {/* Grille des 7 tuiles d'actions sombres */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-left">
                          {/* Tuile 1: Écrire un e-mail */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md"
                            onClick={() => handleSendMessage("Je veux envoyer un e-mail")}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <Mail className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Écrire un e-mail</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Brouillon prêt à envoyer, objet généré</div>
                            </div>
                          </button>

                          {/* Tuile 2: Programmer un envoi */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md"
                            onClick={() => handleSendMessage("Je veux programmer l'envoi d'un e-mail à une date et une heure précises.")}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <Clock className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Programmer un envoi</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Choisissez le jour et l'heure</div>
                            </div>
                          </button>

                          {/* Tuile 3: Ajouter un rendez-vous */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md"
                            onClick={() => handleSendMessage("Je veux ajouter un rendez-vous dans mon agenda.")}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <Calendar className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Ajouter un rendez-vous</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Création dans votre agenda</div>
                            </div>
                          </button>

                          {/* Tuile 4: Mon agenda */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md"
                            onClick={() => handleSendMessage("Qu'est-ce que j'ai de prévu cette semaine dans mon agenda ?")}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <Calendar className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Mon agenda</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Ce que vous avez de prévu</div>
                            </div>
                          </button>

                          {/* Tuile 5: Nouveau contact */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md"
                            onClick={() => handleSendMessage("Je veux enregistrer un nouveau contact.")}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <User className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Nouveau contact</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Enregistrer une personne</div>
                            </div>
                          </button>

                          {/* Tuile 6: Réunion vidéo */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md"
                            onClick={() => handleSendMessage("Je veux planifier une réunion vidéo avec des invités.")}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <Video className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Réunion vidéo</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Démarrer ou programmer</div>
                            </div>
                          </button>

                          {/* Tuile 7: Retrouver des e-mails */}
                          <button
                            type="button"
                            className="p-3.5 rounded-2xl bg-[#121826] border border-slate-800 hover:border-cyan-500/50 flex items-start gap-3 transition-all group shadow-md md:col-span-2 lg:col-span-1"
                            onClick={() => { setChatInput("Retrouve dans mes e-mails "); document.getElementById("ai-input")?.focus(); }}
                          >
                            <div className="w-8 h-8 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-110 transition-transform">
                              <Search className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Retrouver des e-mails</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">Ouvrir la boîte de messagerie</div>
                            </div>
                          </button>
                        </div>

                        {/* Paragraphe de confidentialité */}
                        <p className="text-[11px] text-slate-500 max-w-2xl mx-auto text-center mt-6 leading-relaxed">
                          <b className="text-slate-300">Confidentialité.</b> Pour répondre, l'assistant envoie vos demandes, les extraits d'e-mails ou d'agenda concernés et le contenu des réunions à notre fournisseur d'IA sécurisé. Rien n'est exécuté sans votre confirmation. Vos conversations sont conservées selon la durée choisie dans les préférences.
                        </p>
                      </div>
                    ) : (
                      /* Historique des messages conversationnels */
                      messages.map((msg, index) => {
                        const isUser = msg.sender === "user";
                        return (
                          <div key={index} className={`ai-msg ${isUser ? "user" : "assistant"}`}>
                            {!isUser && (
                              <div className="ai-avatar">
                                <Sparkles className="w-4 h-4" />
                              </div>
                            )}

                            <div className="ai-body">
                              <div className="ai-bubble">
                                <p className="whitespace-pre-wrap">{msg.text}</p>
                              </div>

                              {/* Suggestions de réponse : cliquer relance la conversation */}
                              {!isUser && msg.suggestions && msg.suggestions.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {msg.suggestions.map((s, si) => (
                                    <button
                                      key={si}
                                      type="button"
                                      disabled={assistantThinking}
                                      onClick={() => handleSendMessage(s)}
                                      className="text-xs px-3 py-1.5 rounded-full border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50 transition-all"
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Actions proposées : rien n'est modifié tant que vous ne confirmez pas */}
                              {!isUser && msg.actions && msg.actions.map((action) => (
                                <div key={action.id} className="mt-2 p-3 rounded-xl border border-slate-600/50 bg-slate-900/60 text-xs text-slate-200 space-y-1.5">
                                  <div className="font-semibold text-slate-100">{action.label}</div>
                                  {action.type === "send_email" || action.type === "schedule_email" ? (
                                    <div className="space-y-1 text-slate-300">
                                      <div>À : {(action.params.to || []).join(", ")}</div>
                                      {(action.params.cc || []).length > 0 && <div>Cc : {action.params.cc.join(", ")}</div>}
                                      <div>Objet : {action.params.subject}</div>
                                      <div className="whitespace-pre-wrap text-slate-400 max-h-32 overflow-y-auto">{action.params.body}</div>
                                    </div>
                                  ) : null}
                                  {action.type === "create_contact" && (
                                    <div className="text-slate-300">
                                      {action.params.email && <div>E-mail : {action.params.email}</div>}
                                      {action.params.phone && <div>Téléphone : {action.params.phone}</div>}
                                      {action.params.company && <div>Entreprise : {action.params.company}</div>}
                                    </div>
                                  )}
                                  {action.reason && <div className="text-slate-400">{action.reason}</div>}
                                  {(action.warnings || []).map((w, wi) => (
                                    <div key={wi} className="text-amber-300">{w}</div>
                                  ))}
                                  <div className="flex gap-2 pt-1">
                                    {action.status === "pending" && (
                                      <>
                                        <button type="button" onClick={() => confirmAssistantAction(msg, action)} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Confirmer</button>
                                        <button type="button" onClick={() => cancelAssistantAction(msg, action)} className="px-3 py-1.5 rounded-lg border border-slate-500 text-slate-300 hover:bg-slate-800">Annuler</button>
                                      </>
                                    )}
                                    {action.status === "done" && <span className="text-emerald-300 font-semibold">Fait</span>}
                                    {action.status === "cancelled" && <span className="text-slate-400">Annulé</span>}
                                    {action.status === "error" && <span className="text-red-300">Échec : {action.error}</span>}
                                  </div>
                                  {action.type === "create_meeting" && action.status === "done" && assistantMeetingLink && (
                                    <a href={assistantMeetingLink} target="_blank" rel="noreferrer" className="text-cyan-300 underline break-all">{assistantMeetingLink}</a>
                                  )}
                                </div>
                              ))}

                              {/* Résultats de recherche Gmail (lecture seule) */}
                              {!isUser && msg.mailResults && msg.mailResults.length > 0 && (
                                <div className="mt-2 space-y-1.5">
                                  {msg.mailResults.map((m) => (
                                    <div key={m.id} className="p-2.5 rounded-lg border border-slate-700 bg-slate-900/60 text-xs">
                                      <div className="font-semibold text-slate-100 truncate">{m.subject || "(Sans objet)"}</div>
                                      <div className="text-slate-400 truncate">{m.from} · {m.date}</div>
                                      {m.snippet && <div className="text-slate-400 truncate">{m.snippet}</div>}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Proposition d'optimisation d'agenda si présente */}
                              {msg.proposal && msg.proposal.items && msg.proposal.items.length > 0 && (
                                <div className="ai-cards mt-2">
                                  {msg.proposal.items.map((propItem) => {
                                    const isAccepted = acceptedProposals[propItem.id];
                                    return (
                                      <div key={propItem.id} className="aic">
                                        <div className="aic-head">
                                          <div className="aic-ico">
                                            <Calendar className="w-4 h-4" />
                                          </div>
                                          <div>
                                            <div className="aic-title">{propItem.title}</div>
                                            <div className="aic-sub">{propItem.category || "Activité planifiée"}</div>
                                          </div>
                                          {isAccepted && (
                                            <span className="ml-auto text-xs font-bold text-emerald-600 flex items-center gap-1">
                                              <Check className="w-3.5 h-3.5" /> Planifié
                                            </span>
                                          )}
                                        </div>
                                        <div className="p-3 text-xs space-y-1.5">
                                          <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300 font-medium">
                                            <span className="flex items-center gap-1 text-cyan-600 font-semibold">
                                              <Clock className="w-3.5 h-3.5" />
                                              {propItem.formatted_slot}
                                            </span>
                                            <span>·</span>
                                            <span>{propItem.duration_minutes} min</span>
                                          </div>
                                          {propItem.reasoning && (
                                            <p className="text-[11.5px] text-slate-500 italic bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                                              💡 {propItem.reasoning}
                                            </p>
                                          )}
                                        </div>
                                        {!isAccepted && (
                                          <div className="aic-foot">
                                            <button
                                              type="button"
                                              onClick={() => handleAcceptProposal(propItem)}
                                              className="aic-btn primary"
                                            >
                                              <Check className="w-3.5 h-3.5" />
                                              Accepter &amp; Ajouter au planning
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Carte de validation de Brouillon Message (Email / WhatsApp) */}
                              {msg.message_draft && (
                                <div className="mt-2">
                                  <MessageDraftCard
                                    msgId={msg.id || index}
                                    draft={msg.message_draft}
                                    sentStatus={sentMessages[msg.id || index]}
                                    isSending={sendingMessageId === (msg.id || index)}
                                    onSend={(editedBody, editedSubject) => handleSendDraftMessage(msg.id || index, msg.message_draft, editedBody, editedSubject)}
                                  />
                                </div>
                              )}

                              {/* Footer message / feedback */}
                              <div className="flex items-center justify-between gap-2 mt-1">
                                <span className="text-[10px] text-slate-400">
                                  {isUser ? "VOUS" : "ASSISTANT IA"} · {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {!isUser && (
                                  <div className="flex items-center gap-1 text-slate-400">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await api.submitAiFeedback({ feedback_type: "positive", message_content: msg.text });
                                          alert("Merci pour votre retour positif !");
                                        } catch (e) {}
                                      }}
                                      className="p-1 hover:text-emerald-500 rounded transition-colors"
                                      title="Réponse utile"
                                    >
                                      <ThumbsUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await api.submitAiFeedback({ feedback_type: "negative", message_content: msg.text });
                                          alert("Merci pour votre retour. Nous ajustons les réponses de l'assistant.");
                                        } catch (e) {}
                                      }}
                                      className="p-1 hover:text-rose-500 rounded transition-colors"
                                      title="Réponse imprécise"
                                    >
                                      <ThumbsDown className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {assistantThinking && (
                      <div className="ai-msg assistant">
                        <div className="ai-avatar">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div className="ai-body">
                          <div className="ai-bubble">
                            <span className="ai-typing">
                              <span></span><span></span><span></span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dictée vocale active feedback banner */}
                {isListening && (
                  <div className="px-4 py-2 bg-cyan-50 dark:bg-cyan-950/40 border-t border-cyan-200 dark:border-cyan-800 text-center">
                    <p className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 animate-pulse">
                      Dictée en cours : {voiceTranscription || "Écoute active..."}
                    </p>
                  </div>
                )}

                {/* Composer en bas identique à TechSphere */}
                <div className="ai-composer-wrap">
                  <div className="ai-composer">
                    <textarea
                      id="ai-input"
                      rows={1}
                      maxLength={4000}
                      value={chatInput}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder="Demandez quelque chose... ex : « Écris un e-mail à Marie pour reporter la réunion »"
                      aria-label="Votre message à l'assistant"
                    />
                    <button
                      type="button"
                      id="ai-mic"
                      className={`ai-mic ${isListening ? "on" : ""}`}
                      onClick={handleMicClick}
                      title={isListening ? "Arrêter la dictée" : "Dicter votre message"}
                      aria-label="Dicter votre message"
                      aria-pressed={isListening}
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      id="ai-send"
                      className="ai-send"
                      onClick={() => handleSendMessage()}
                      disabled={assistantThinking || !chatInput.trim()}
                      title="Envoyer"
                      aria-label="Envoyer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="ai-foot">
                    L'IA peut se tromper : vérifiez avant de confirmer. Aucune action n'est exécutée sans votre clic.
                  </div>
                </div>
              </section>

              {/* Modal Préférences de l'assistant IA */}
              {showAiPrefs && (
                <div className="ai-modal">
                  <div className="ai-modal-card" role="dialog" aria-modal="true" aria-label="Préférences de l'assistant">
                    <div className="ai-modal-h">
                      <div>
                        <div className="ai-modal-t">Préférences de l'assistant</div>
                        <div className="ai-modal-s">Appliquées à vos e-mails, rendez-vous et réunions</div>
                      </div>
                      <button
                        type="button"
                        className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
                        onClick={() => setShowAiPrefs(false)}
                        aria-label="Fermer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="ai-modal-b">
                      <label>
                        Ton par défaut des e-mails
                        <select
                          value={aiPrefs.tone}
                          onChange={(e) => setAiPrefs(prev => ({ ...prev, tone: e.target.value }))}
                        >
                          <option value="formel">Formel et courtois</option>
                          <option value="amical">Amical</option>
                          <option value="concis">Concis et direct</option>
                          <option value="chaleureux">Chaleureux</option>
                          <option value="ferme">Ferme mais poli</option>
                        </select>
                      </label>
                      <label>
                        Langue des e-mails
                        <select
                          value={aiPrefs.language}
                          onChange={(e) => setAiPrefs(prev => ({ ...prev, language: e.target.value }))}
                        >
                          <option value="fr">Français</option>
                          <option value="en">Anglais</option>
                          <option value="es">Espagnol</option>
                          <option value="pt">Portugais</option>
                          <option value="de">Allemand</option>
                          <option value="ar">Arabe</option>
                        </select>
                      </label>
                      <label>
                        Formule de politesse / signature
                        <input
                          type="text"
                          maxLength={200}
                          placeholder="Ex : Cordialement, Aude"
                          value={aiPrefs.closing}
                          onChange={(e) => setAiPrefs(prev => ({ ...prev, closing: e.target.value }))}
                        />
                      </label>
                      <div className="ai-modal-row">
                        <label>
                          Durée d'une réunion
                          <select
                            value={aiPrefs.meetingDuration}
                            onChange={(e) => setAiPrefs(prev => ({ ...prev, meetingDuration: e.target.value }))}
                          >
                            <option value="15">15 min</option>
                            <option value="30">30 min</option>
                            <option value="45">45 min</option>
                            <option value="60">1 heure</option>
                            <option value="90">1 h 30</option>
                            <option value="120">2 heures</option>
                          </select>
                        </label>
                        <label>
                          Rappel par défaut
                          <select
                            value={aiPrefs.reminderMinutes}
                            onChange={(e) => setAiPrefs(prev => ({ ...prev, reminderMinutes: e.target.value }))}
                          >
                            <option value="0">À l'heure</option>
                            <option value="5">5 minutes avant</option>
                            <option value="10">10 minutes avant</option>
                            <option value="15">15 minutes avant</option>
                            <option value="30">30 minutes avant</option>
                            <option value="60">1 heure avant</option>
                            <option value="120">2 heures avant</option>
                            <option value="1440">1 jour avant</option>
                          </select>
                        </label>
                      </div>
                      <div className="ai-modal-row">
                        <label>
                          Début de journée
                          <select
                            value={aiPrefs.workStart}
                            onChange={(e) => setAiPrefs(prev => ({ ...prev, workStart: Number(e.target.value) }))}
                          >
                            {Array.from({ length: 24 }, (_, i) => (
                              <option key={i} value={i}>{String(i).padStart(2, "0")} h</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Fin de journée
                          <select
                            value={aiPrefs.workEnd}
                            onChange={(e) => setAiPrefs(prev => ({ ...prev, workEnd: Number(e.target.value) }))}
                          >
                            {Array.from({ length: 24 }, (_, i) => (
                              <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, "0")} h</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="ai-modal-chk">
                        <input
                          type="checkbox"
                          checked={aiPrefs.weekends}
                          onChange={(e) => setAiPrefs(prev => ({ ...prev, weekends: e.target.checked }))}
                        />
                        <span>Inclure les week-ends dans les créneaux libres</span>
                      </label>
                      <label>
                        Conservation des conversations
                        <select
                          value={aiPrefs.retentionDays}
                          onChange={(e) => setAiPrefs(prev => ({ ...prev, retentionDays: Number(e.target.value) }))}
                        >
                          <option value="0">Jusqu'à suppression manuelle</option>
                          <option value="7">7 jours</option>
                          <option value="30">30 jours</option>
                          <option value="90">90 jours</option>
                          <option value="365">1 an</option>
                        </select>
                      </label>
                      <div className="ai-modal-note">
                        <b>Confidentialité.</b> Pour répondre, l'assistant envoie vos demandes, les extraits d'e-mails ou d'agenda concernés et le contenu des réunions à notre fournisseur d'IA (OpenRouter / Gemini / LangGraph). Rien n'est exécuté sans votre confirmation.
                      </div>
                    </div>
                    <div className="ai-modal-f">
                      <button
                        type="button"
                        className="aic-btn primary"
                        onClick={() => setShowAiPrefs(false)}
                      >
                        Enregistrer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BRIEFING MATINAL — Connecté à l'API */}
          {activeTab === "briefing" && (
            <div className="h-full overflow-y-auto p-lg max-w-4xl mx-auto w-full">
              {/* Header */}
              <section className="mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-hanken font-bold text-white flex items-center gap-2">
                      <Sun className="w-7 h-7 text-amber-400" />
                      Briefing Matinal
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">Synthèse intelligente de votre journée, générée par Aura.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={briefingDate}
                      onChange={e => setBriefingDate(e.target.value)}
                      className="text-xs bg-[#121826] text-white border border-slate-800 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={async () => {
                        setBriefingLoading(true);
                        setBriefingError("");
                        try {
                          const data = await api.getMorningBriefing(briefingDate);
                          setBriefingData(data);
                        } catch(e) {
                          setBriefingError(e.message);
                        } finally {
                          setBriefingLoading(false);
                        }
                      }}
                      disabled={briefingLoading}
                      className="px-3 py-1.5 bg-[#818cf8] hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all shadow-md shadow-indigo-950/40"
                    >
                      {briefingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sun className="w-3.5 h-3.5" />}
                      {briefingData ? "Régénérer" : "Charger"}
                    </button>
                  </div>
                </div>
              </section>

              {briefingError && (
                <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-sm text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  {briefingError}
                </div>
              )}

              {/* Loader */}
              {briefingLoading && !briefingData && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
                  <p className="text-sm text-slate-400">Aura prépare votre briefing…</p>
                </div>
              )}

              {/* Prompt initial */}
              {!briefingData && !briefingLoading && (
                <div
                  className="flex flex-col items-center justify-center py-20 gap-6 text-center cursor-pointer rounded-2xl border-2 border-dashed border-slate-800 bg-[#121826]/60 hover:border-indigo-500/50 hover:bg-[#121826] transition-all"
                  onClick={async () => {
                    setBriefingLoading(true);
                    setBriefingError("");
                    try {
                      const data = await api.getMorningBriefing(briefingDate);
                      setBriefingData(data);
                    } catch(e) {
                      setBriefingError(e.message);
                    } finally {
                      setBriefingLoading(false);
                    }
                  }}
                >
                  <div className="w-16 h-16 rounded-full bg-amber-950/60 border border-amber-700/50 flex items-center justify-center">
                    <Sun className="w-8 h-8 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">Générer votre Briefing Matinal</p>
                    <p className="text-sm text-slate-400 mt-1">Cliquez pour obtenir la synthèse IA de votre journée du {briefingDate}</p>
                  </div>
                  <span className="text-xs px-4 py-2 bg-[#818cf8] hover:bg-indigo-600 text-white rounded-full font-semibold shadow-md shadow-indigo-950/40">Générer maintenant</span>
                </div>
              )}

              {/* Contenu du Briefing */}
              {briefingData && (
                <div className="space-y-5">
                  {/* Carte principale avec speech */}
                  <div className="bg-[#121826] border border-slate-800 rounded-2xl p-5 shadow-md">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-xl font-hanken font-bold text-white">{briefingData.greeting}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(briefingData.target_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (!briefingData?.speech_text) return;
                            if (isSpeaking) {
                              window.speechSynthesis.cancel();
                              setIsSpeaking(false);
                              return;
                            }
                            const utt = new SpeechSynthesisUtterance(briefingData.speech_text);
                            utt.lang = 'fr-FR';
                            utt.rate = 0.95;
                            utt.onend = () => setIsSpeaking(false);
                            utt.onerror = () => setIsSpeaking(false);
                            window.speechSynthesis.speak(utt);
                            setIsSpeaking(true);
                          }}
                          className={`w-11 h-11 rounded-full flex items-center justify-center shadow-md active:scale-95 transition-all text-white ${
                            isSpeaking ? "bg-rose-600" : "bg-[#818cf8] hover:bg-indigo-600"
                          }`}
                          title={isSpeaking ? "Arrêter la lecture" : "Lire le briefing à voix haute"}
                        >
                          {isSpeaking ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        </button>
                        {isSpeaking && (
                          <div className="flex gap-0.5 items-end h-5">
                            {[3,5,4,6,3].map((h, i) => (
                              <div key={i} className="w-1 bg-indigo-400 rounded wave-bar" style={{ height: `${h*4}px`, animationDelay: `${i*150}ms` }}></div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Texte vocal */}
                    <div className="bg-[#162036] rounded-xl p-4 border border-slate-800 text-slate-200">
                      <p className="text-sm leading-relaxed italic">{briefingData.speech_text}</p>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="bg-[#162036] rounded-xl p-3 border border-slate-800 text-center">
                        <p className="text-2xl font-bold text-indigo-400">{briefingData.events_count}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Événements</p>
                      </div>
                      <div className="bg-[#162036] rounded-xl p-3 border border-slate-800 text-center">
                        <p className="text-2xl font-bold text-emerald-400">{briefingData.total_hours}h</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Temps planifié</p>
                      </div>
                    </div>
                  </div>

                  {/* Alerte de départ */}
                  {briefingData.departure_alert && (
                    <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4 flex items-start gap-3">
                      <div className="w-9 h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-amber-300">Alerte de départ</p>
                        <p className="text-xs text-amber-200/80 mt-0.5">
                          Pour <strong>{briefingData.departure_alert.event_title}</strong> à {briefingData.departure_alert.start_time} 
                          ({briefingData.departure_alert.location})
                        </p>
                        <p className="text-xs font-bold text-amber-400 mt-1">
                          → Partez à {briefingData.departure_alert.recommended_departure} 
                          (trajet estimé : {briefingData.departure_alert.estimated_travel_minutes} min)
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Points clés */}
                  {briefingData.highlights?.length > 0 && (
                    <div className="bg-[#121826] border border-slate-800 rounded-xl p-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Points clés</h4>
                      <ul className="space-y-2">
                        {briefingData.highlights.map((h, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            {h}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Conseil productivité */}
                  {briefingData.productivity_tip && (
                    <div className="bg-indigo-950/30 border border-indigo-800/50 rounded-xl p-4">
                      <p className="text-xs font-bold text-indigo-300 mb-1">💡 Conseil du jour</p>
                      <p className="text-sm text-indigo-200">{briefingData.productivity_tip}</p>
                    </div>
                  )}

                  {/* Chronologie */}
                  {briefingData.timeline?.length > 0 && (
                    <div className="bg-[#121826] border border-slate-800 rounded-xl p-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">Chronologie du jour</h4>
                      <div className="space-y-3">
                        {briefingData.timeline.map((evt, idx) => (
                          <div key={evt.id || idx} className="flex gap-3 items-start">
                            <div className="w-14 text-right shrink-0">
                              <span className="text-xs font-bold text-indigo-400 block">{evt.start_time}</span>
                              <span className="text-[10px] text-slate-500">{evt.end_time}</span>
                            </div>
                            <div className="flex flex-col items-center shrink-0">
                              <div className={`w-3 h-3 rounded-full border-2 border-slate-900 shadow ${
                                evt.constraint_type === 'hard' ? 'bg-red-500' : 'bg-emerald-500'
                              }`}></div>
                              {idx < briefingData.timeline.length - 1 && (
                                <div className="w-0.5 h-8 bg-slate-800 mt-1"></div>
                              )}
                            </div>
                            <div className="flex-1 pb-2">
                              <p className="text-sm font-semibold text-on-surface">{evt.title}</p>
                              {evt.location && (
                                <p className="text-xs text-outline flex items-center gap-1 mt-0.5">
                                  <MapPin className="w-3 h-3" /> {evt.location}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: IMPORT D'EMPLOI DU TEMPS */}
          {activeTab === "schedule-import" && (
            <div className="h-full overflow-y-auto p-lg max-w-3xl mx-auto w-full">
              <section className="mb-6">
                <h2 className="text-2xl font-hanken font-bold text-on-surface flex items-center gap-2">
                  <GraduationCap className="w-6 h-6 text-primary" />
                  Import d'Emploi du Temps
                </h2>
                <p className="text-sm text-outline mt-1">Importez votre emploi du temps depuis un document (image, PDF, Excel, Word) et laissez Aura extraire automatiquement vos cours.</p>
              </section>

              {/* Étape 1 : Upload */}
              {!importParsed && (
                <div className="space-y-5">
                  {/* Zone de drop */}
                  <div
                    className="border-2 border-dashed border-outline-variant/50 rounded-2xl p-8 text-center hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer"
                    onClick={() => document.getElementById('schedule-file-input').click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f) setImportFile(f);
                    }}
                  >
                    <input
                      id="schedule-file-input"
                      type="file"
                      className="hidden"
                      accept=".pdf,.xlsx,.xls,.docx,.png,.jpg,.jpeg,.webp"
                      onChange={e => setImportFile(e.target.files[0] || null)}
                    />
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Upload className="w-7 h-7 text-primary" />
                    </div>
                    {importFile ? (
                      <div>
                        <p className="text-sm font-semibold text-on-surface">{importFile.name}</p>
                        <p className="text-xs text-outline mt-1">{(importFile.size / 1024).toFixed(1)} KB — Cliquez pour changer</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-semibold text-on-surface">Glissez-déposez ou cliquez pour choisir un fichier</p>
                        <p className="text-xs text-outline mt-1">Formats acceptés : PDF, Excel (.xlsx), Word (.docx), Image (.png, .jpg, .webp)</p>
                      </div>
                    )}
                  </div>

                  {/* Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-on-surface mb-1">Date de début de semaine</label>
                      <input
                        type="date"
                        value={importWeekStart}
                        onChange={e => setImportWeekStart(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-outline-variant/60 rounded-xl focus:border-primary outline-none"
                      />
                      <p className="text-[10px] text-outline mt-1">Lundi de la semaine concernée par l'emploi du temps</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-on-surface mb-1">Répéter sur (semaines)</label>
                      <input
                        type="number"
                        min="1"
                        max="16"
                        value={importRepeatWeeks}
                        onChange={e => setImportRepeatWeeks(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 text-sm border border-outline-variant/60 rounded-xl focus:border-primary outline-none"
                      />
                      <p className="text-[10px] text-outline mt-1">Ex: 14 pour un semestre entier</p>
                    </div>
                  </div>

                  {importError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {importError}
                    </div>
                  )}

                  <button
                    disabled={!importFile || importLoading}
                    onClick={async () => {
                      if (!importFile) return;
                      setImportLoading(true);
                      setImportError("");
                      try {
                        const result = await api.uploadAndParseSchedule(
                          importFile,
                          importWeekStart,
                          importRepeatWeeks
                        );
                        setImportParsed(result);
                        // Sélectionner tout par défaut
                        const sel = {};
                        (result.events || []).forEach((_, i) => { sel[i] = true; });
                        setImportSelection(sel);
                        setImportConfirmed(false);
                      } catch(e) {
                        setImportError(e.message);
                      } finally {
                        setImportLoading(false);
                      }
                    }}
                    className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow ${
                      !importFile || importLoading
                        ? "bg-surface-container-high text-outline cursor-not-allowed"
                        : "bg-primary hover:bg-blue-700 text-white"
                    }`}
                  >
                    {importLoading ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Analyse en cours par l'IA…</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Analyser avec l'IA</>  
                    )}
                  </button>
                </div>
              )}

              {/* Étape 2 : Prévisualisation & Confirmation */}
              {importParsed && !importConfirmed && (
                <div className="space-y-5">
                  {/* Résumé parsing */}
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-900">
                          {importParsed.events?.length || 0} cours détectés dans «{importFile?.name}»
                        </p>
                        <p className="text-xs text-emerald-700">Type : {importParsed.file_type} · Méthode : {importParsed.extraction_method || 'IA'}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setImportParsed(null); setImportFile(null); }}
                      className="text-xs text-outline hover:text-on-surface flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Recommencer
                    </button>
                  </div>

                  {/* Message d'avertissement si vide */}
                  {(!importParsed.events || importParsed.events.length === 0) && (
                    <div className="text-center py-8 text-outline">
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Aucun cours détecté. Essayez avec un autre fichier ou ajustez la date de début.</p>
                    </div>
                  )}

                  {/* Liste des événements à confirmer */}
                  {importParsed.events?.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-on-surface">Sélectionnez les cours à importer</h4>
                        <div className="flex gap-2">
                          <button onClick={() => {
                            const sel = {};
                            importParsed.events.forEach((_, i) => { sel[i] = true; });
                            setImportSelection(sel);
                          }} className="text-xs text-primary hover:underline">Tout sélectionner</button>
                          <span className="text-outline">·</span>
                          <button onClick={() => setImportSelection({})} className="text-xs text-outline hover:underline">Tout désélectionner</button>
                        </div>
                      </div>

                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                        {importParsed.events.map((evt, idx) => (
                          <div
                            key={idx}
                            onClick={() => setImportSelection(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                              importSelection[idx]
                                ? 'bg-primary/5 border-primary/30'
                                : 'bg-white border-outline-variant/30 opacity-60'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded flex items-center justify-center border-2 shrink-0 transition-all ${
                              importSelection[idx] ? 'bg-primary border-primary' : 'border-outline-variant'
                            }`}>
                              {importSelection[idx] && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-on-surface truncate">{evt.title}</p>
                              <p className="text-xs text-outline">
                                {evt.start_time ? new Date(evt.start_time).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                                {evt.end_time ? ` → ${new Date(evt.end_time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                                {evt.location ? ` · ${evt.location}` : ''}
                              </p>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                              evt.constraint_type === 'hard' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {evt.constraint_type === 'hard' ? 'FIXE' : 'FLEXIBLE'}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => { setImportParsed(null); setImportFile(null); }}
                          className="flex-1 py-2.5 border border-outline-variant/50 text-on-surface-variant rounded-xl text-sm font-medium hover:bg-surface-container transition-all"
                        >
                          Annuler
                        </button>
                        <button
                          disabled={importConfirmLoading || Object.values(importSelection).filter(Boolean).length === 0}
                          onClick={async () => {
                            const toImport = importParsed.events.filter((_, i) => importSelection[i]);
                            if (!toImport.length) return;
                            setImportConfirmLoading(true);
                            try {
                              await api.confirmScheduleImport(toImport);
                              setImportConfirmed(true);
                              await loadEvents();
                              setToastNotification({
                                title: "Emploi du temps importé !",
                                body: `${toImport.length} cours ajoutés à votre agenda.`
                              });
                            } catch(e) {
                              setImportError(`Erreur d'import : ${e.message}`);
                            } finally {
                              setImportConfirmLoading(false);
                            }
                          }}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow ${
                            importConfirmLoading || Object.values(importSelection).filter(Boolean).length === 0
                              ? 'bg-surface-container-high text-outline cursor-not-allowed'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          }`}
                        >
                          {importConfirmLoading ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Import en cours…</>
                          ) : (
                            <><Check className="w-4 h-4" /> Importer {Object.values(importSelection).filter(Boolean).length} cours</>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Étape 3 : Succès */}
              {importConfirmed && (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-hanken font-bold text-on-surface">Emploi du temps importé !</h3>
                  <p className="text-sm text-outline">Vos cours ont été ajoutés à votre agenda Krono AI.</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => { setImportParsed(null); setImportFile(null); setImportConfirmed(false); setImportSelection({}); }}
                      className="px-4 py-2 bg-primary hover:bg-blue-700 text-white rounded-xl text-sm font-semibold active:scale-95 transition-all"
                    >
                      Importer un autre document
                    </button>
                    <button
                      onClick={() => setActiveTab('dashboard')}
                      className="px-4 py-2 border border-outline-variant/50 text-on-surface rounded-xl text-sm font-medium hover:bg-surface-container transition-all"
                    >
                      Voir mon agenda
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CARTE & ETA — Leaflet + Geoapify */}
          {(activeTab === "map" || activeTab === "geomap") && (
            <div className="h-full overflow-hidden">
              <GeoMapTab token={token} />
            </div>
          )}

          {/* TAB: CONTACTS & CARNET D'ADRESSES */}
          {activeTab === "contacts" && (
            <div className="h-full overflow-y-auto p-lg max-w-5xl mx-auto w-full space-y-lg">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div>
                  <h2 className="text-2xl font-hanken font-bold text-white flex items-center gap-2">
                    <Users className="w-6 h-6 text-indigo-400" />
                    Carnet d'Adresses & Contacts
                  </h2>
                  <p className="text-sm text-slate-400">
                    Utilisé par l'assistant vocal et textuel pour adresser vos messages WhatsApp et Emails.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleSeedDemoContacts}
                    className="px-3 py-1.5 bg-[#162036] hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700/60 flex items-center gap-1.5 transition-all"
                    title="Ajouter 3 contacts de démonstration"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    Contacts Démo (Thomas, Sophie...)
                  </button>
                  <button
                    onClick={handleImportPhoneContacts}
                    className="px-3 py-1.5 bg-[#162036] hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700/60 flex items-center gap-1.5 transition-all"
                    title="Importer via la Contact Picker API du smartphone"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                    Importer du téléphone
                  </button>
                  <button
                    onClick={() => setShowAddContactModal(true)}
                    className="px-3.5 py-1.5 bg-[#818cf8] hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-md shadow-indigo-950/40 active:scale-95 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nouveau Contact
                  </button>
                </div>
              </div>

              {/* Barre de recherche */}
              <div className="max-w-md">
                <input
                  type="text"
                  placeholder="Rechercher un contact (nom, téléphone, email)..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#121826] border border-slate-800 text-white placeholder-slate-500 rounded-xl focus:border-indigo-500 outline-none shadow-sm"
                />
              </div>

              {/* Grille des contacts */}
              {contactsLoading ? (
                <div className="flex items-center justify-center p-12 text-slate-500 gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
                  Chargement des contacts...
                </div>
              ) : contacts.length === 0 ? (
                <div className="p-8 text-center bg-[#121826] border border-slate-800 rounded-2xl shadow-sm space-y-3">
                  <Users className="w-10 h-10 text-slate-600 mx-auto" />
                  <h3 className="font-bold text-white">Aucun contact enregistré</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Pour que la commande vocale sache à qui envoyer ("Envoie un WhatsApp à Thomas..."), ajoutez vos contacts ou chargez les contacts de démo ci-dessous.
                  </p>
                  <div className="flex justify-center gap-2 pt-2">
                    <button
                      onClick={handleSeedDemoContacts}
                      className="px-4 py-2 bg-[#818cf8] hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm active:scale-95 transition-all"
                    >
                      Charger les 3 contacts démo
                    </button>
                    <button
                      onClick={() => setShowAddContactModal(true)}
                      className="px-4 py-2 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      Ajouter manuellement
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {contacts
                    .filter(c => 
                      !contactSearch || 
                      c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
                      (c.email && c.email.toLowerCase().includes(contactSearch.toLowerCase())) ||
                      (c.phone_number && c.phone_number.includes(contactSearch))
                    )
                    .sort((a, b) => {
                      if (a.is_favorite && !b.is_favorite) return -1;
                      if (!a.is_favorite && b.is_favorite) return 1;
                      return (a.name || "").localeCompare(b.name || "");
                    })
                    .map((contact) => (
                      <div
                        key={contact.id}
                        className="p-4 rounded-2xl border border-slate-800 hover:border-cyan-800/60 transition-all flex flex-col justify-between shadow-md"
                        style={{ background: "var(--bg-card, #0f1e35)" }}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-sm"
                                style={{ background: "linear-gradient(135deg, #035c80, #8b5cf6)" }}
                              >
                                {contact.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <h4 className="font-bold text-sm text-slate-100">{contact.name}</h4>
                                {contact.company && (
                                  <p className="text-[11px] text-slate-400">{contact.company}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleToggleFavoriteContact(contact.id)}
                                className={`p-1 rounded transition-colors ${
                                  contact.is_favorite ? "text-amber-400" : "text-slate-500 hover:text-amber-400"
                                }`}
                                title={contact.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                              >
                                <Star className={`w-3.5 h-3.5 ${contact.is_favorite ? "fill-amber-400" : ""}`} />
                              </button>
                              <button
                                onClick={() => handleDeleteContact(contact.id)}
                                className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors"
                                title="Supprimer ce contact"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5 mt-3 text-xs">
                            {contact.phone_number ? (
                              <div className="flex items-center gap-2 text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1.5 rounded-lg font-mono text-[11px]">
                                <MessageSquare className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                                <span>{contact.phone_number}</span>
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-500 italic px-2">Pas de numéro WhatsApp</div>
                            )}

                            {contact.email ? (
                              <div className="flex items-center gap-2 text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 px-2.5 py-1.5 rounded-lg text-[11px]">
                                <Mail className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                                <span className="truncate">{contact.email}</span>
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-500 italic px-2">Pas d'adresse email</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MESSAGERIE ÉLECTRONIQUE (TECHSPHERE) */}
          {activeTab === "messaging" && (
            <div className="h-full overflow-hidden">
              <MessagingTab token={token} contacts={contacts} onEventCreated={loadEvents} />
            </div>
          )}

          {/* TAB 5: PANNEAU D'ADMINISTRATION (TECHSPHERE) */}
          {activeTab === "admin" && (
            <div className="h-full overflow-hidden">
              <AdminTab token={token} />
            </div>
          )}

          {/* TAB 5: PRÉFÉRENCES */}
          {activeTab === "preferences" && (
            <div className="h-full overflow-y-auto p-lg max-w-3xl mx-auto w-full space-y-xl">
              <section className="mb-lg border-b border-outline-variant/20 pb-4">
                <h2 className="text-2xl font-hanken font-bold text-on-surface">Préférences & Configurations</h2>
                <p className="text-sm text-outline">Gérez vos synchronisations externes et les paramètres techniques.</p>
              </section>

              {/* Profil utilisateur */}
              <div className="bg-white border border-outline-variant/40 p-lg rounded-xl space-y-md shadow-sm">
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider font-geist">Profil Primaire</h3>
                <div className="flex gap-lg items-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20 text-primary text-xl font-bold">
                    {currentUser?.full_name?.charAt(0) || "J"}
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-on-surface">{currentUser?.full_name || "Julian Thorne"}</h4>
                    <p className="text-xs text-outline">{currentUser?.email || "julian.thorne@atelier.ai"}</p>
                    <span className="inline-block mt-2 px-2 py-0.5 text-[9px] font-geist font-bold bg-surface-container text-outline rounded border">
                      Rôle : Utilisateur
                    </span>
                  </div>
                </div>
              </div>

              {/* Liaisons de calendrier tiers */}
              <div className="bg-white border border-outline-variant/40 p-lg rounded-xl space-y-md shadow-sm">
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider font-geist">Liaison de Calendriers</h3>
                <p className="text-xs text-outline leading-relaxed">
                  Connectez vos flux externes (Google Calendar / Microsoft Exchange) pour synchroniser bidirectionnellement vos contraintes. 
                  Notre Privacy Gateway filtrera toutes les données nominatives avant le traitement IA.
                </p>

                <div className="space-y-sm">
                  <GoogleAccountCard token={token} onImported={loadEvents} />

                  {/* Microsoft */}
                  <div className="flex items-center justify-between p-sm rounded border border-outline-variant bg-surface-container-low">
                    <span className="text-xs font-semibold text-on-surface">Microsoft Outlook</span>
                    {calendarLinks.some(l => l.provider === "microsoft") ? (
                      <span className="text-[10px] font-geist text-secondary flex items-center gap-1 uppercase font-bold">
                        <Check className="w-3.5 h-3.5" /> Lié
                      </span>
                    ) : (
                      <button
                        onClick={() => handleLinkCalendar("microsoft")}
                        className="px-3 py-1 bg-primary text-white text-xs font-medium rounded hover:bg-blue-700 transition-all"
                      >
                        Lier
                      </button>
                    )}
                  </div>
                </div>

                {calendarLinks.length > 0 && (
                  <button
                    onClick={triggerCalendarSync}
                    disabled={syncLoading}
                    className="mt-md py-2 px-4 bg-secondary text-white rounded text-xs font-semibold uppercase tracking-wide transition-all shadow flex items-center gap-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncLoading ? "animate-spin" : ""}`} />
                    Synchroniser et Résoudre
                  </button>
                )}
              </div>

              {/* Config Technique URL API */}
              <div className="bg-white border border-outline-variant/40 p-lg rounded-xl space-y-md shadow-sm">
                <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider font-geist">Paramètres Serveur</h3>
                <div>
                  <label className="text-[9px] font-geist uppercase text-outline">URL du point d'API Krono AI</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      value={apiUrlInput}
                      onChange={(e) => setApiUrlInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-outline-variant/60 rounded text-sm focus:border-primary outline-none"
                    />
                    <button
                      onClick={updateApiBaseUrl}
                      className="px-4 py-1.5 bg-primary-black hover:bg-neutral-800 text-white rounded text-xs font-semibold uppercase"
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* --- TOAST NOTIFICATIONS (Module F) --- */}
      {toastNotification && (
        <div className="fixed bottom-6 right-6 max-w-sm rounded-xl p-4 shadow-2xl bg-white border border-primary/20 flex gap-3 items-start z-50 animate-bounce">
          <Bell className="shrink-0 mt-0.5 w-5 h-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-on-surface">{toastNotification.title}</p>
            <p className="text-xs text-outline mt-1">{toastNotification.body}</p>
          </div>
          <button onClick={() => setToastNotification(null)}>
            <X className="w-4 h-4 text-outline" />
          </button>
        </div>
      )}

      {/* --- MODAL OPTIMISEUR D'INTENTIONS FLOUES & DONNÉES HÉTÉROGÈNES --- */}
      {showFuzzyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(15, 12, 41, 0.6)", backdropFilter: "blur(6px)" }}
          onClick={(e) => e.target === e.currentTarget && setShowFuzzyModal(false)}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-purple-100 animate-in fade-in zoom-in-95 duration-200">
            {/* En-tête Gradient Ultra-Premium */}
            <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 p-6 text-white relative shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-400/30 text-[10px] font-semibold tracking-wider uppercase mb-2">
                    <Sparkles className="w-3 h-3 text-amber-300 animate-pulse" />
                    Intelligence Sémantique & Smart-Scheduler
                  </div>
                  <h3 className="font-hanken font-bold text-xl text-white">
                    Optimiseur d'Intentions Floues & Données Hétérogènes
                  </h3>
                  <p className="text-xs text-purple-200/80 mt-1 max-w-lg font-geist leading-relaxed">
                    Transformez des pensées en vrac, des besoins implicites ou des to-do déstructurées en un emploi du temps dynamiquement optimisé sans aucun conflit.
                  </p>
                </div>
                <button
                  onClick={() => setShowFuzzyModal(false)}
                  className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Corps du modal avec défilement */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Exemples rapides (Chips) */}
              <div>
                <label className="block text-[11px] font-bold text-outline uppercase font-geist tracking-wider mb-2">
                  Exemples d'intentions floues et données en vrac (cliquer pour tester) :
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "💇 Mes cheveux sont trop longs", text: "mes cheuveux sont devenus trop longs" },
                    { label: "🛒 Frigo vide & voiture", text: "le frigo est vide et la voiture fait un bruit bizarre" },
                    { label: "🦷 Mal aux dents & dossier", text: "j'ai mal aux dents depuis ce matin et dossier Dupont à terminer avant mardi" },
                    { label: "🏃 Sport & café", text: "besoin de courir 45 min et penser à racheter du café" }
                  ].map((example, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setFuzzyInput(example.text);
                        handleOptimizeFuzzy(example.text);
                      }}
                      className="px-3 py-1.5 rounded-full text-xs bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200/60 font-medium transition-all active:scale-95 text-left flex items-center gap-1.5 shadow-sm"
                    >
                      <span>{example.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Saisie textuelle */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                    <ListTodo className="w-4 h-4 text-purple-600" />
                    Vos notes, pensées ou liste en vrac :
                  </label>
                  <span className="text-[10px] text-outline font-geist">
                    Expression naturelle ou multi-tâches
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={fuzzyInput}
                  onChange={(e) => setFuzzyInput(e.target.value)}
                  placeholder="Ex: 'mes cheveux sont devenus trop longs', 'frigo vide', to-do list en désordre..."
                  className="w-full px-4 py-3 border border-outline-variant/60 rounded-xl focus:border-purple-600 focus:ring-2 focus:ring-purple-100 outline-none text-sm transition-all resize-none font-sans"
                />
              </div>

              {/* Message d'erreur */}
              {fuzzyError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{fuzzyError}</span>
                </div>
              )}

              {/* Bouton d'action principal */}
              <button
                type="button"
                onClick={() => handleOptimizeFuzzy()}
                disabled={fuzzyLoading || !fuzzyInput.trim()}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
              >
                {fuzzyLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Inférence IA & Recherche de créneaux optimaux...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Analyser & Optimiser l'Emploi du Temps</span>
                  </>
                )}
              </button>

              {/* Résultats & Propositions Dynamiques */}
              {fuzzyResults && (
                <div className="pt-3 border-t border-outline-variant/20 space-y-4 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-hanken font-bold text-sm text-on-surface flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Créneaux Optimisés Déduits ({fuzzyResults.length})
                      </h4>
                      <p className="text-[11px] text-outline font-geist">
                        Créneaux sans conflit identifiés en accord avec vos disponibilités et la nature des activités.
                      </p>
                    </div>

                    {fuzzyResults.length > 1 && (
                      <button
                        type="button"
                        onClick={handleBatchAcceptFuzzy}
                        disabled={fuzzyLoading || fuzzyResults.every(r => fuzzyAcceptedMap[r.id])}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Tout intégrer au calendrier
                      </button>
                    )}
                  </div>

                  {/* Cartes de propositions */}
                  <div className="space-y-3">
                    {fuzzyResults.map((item) => {
                      const isAccepted = fuzzyAcceptedMap[item.id];
                      return (
                        <div
                          key={item.id}
                          className={`p-4 rounded-2xl border transition-all ${
                            isAccepted
                              ? "bg-emerald-50/90 border-emerald-300 shadow-sm"
                              : "bg-gradient-to-br from-purple-50/60 via-indigo-50/30 to-white border-purple-200/80 shadow-sm hover:shadow-md"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 uppercase tracking-wider">
                                {item.category || "activité"}
                              </span>
                              <span className="text-xs font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Check className="w-3 h-3" /> Zéro conflit
                              </span>
                            </div>

                            {isAccepted ? (
                              <span className="text-xs text-emerald-700 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4" /> Planifié avec succès !
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAcceptFuzzyItem(item)}
                                className="px-3.5 py-1.5 bg-primary hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all w-fit"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Accepter ce créneau
                              </button>
                            )}
                          </div>

                          <div className="mb-2">
                            <h5 className="font-hanken font-bold text-base text-on-surface">
                              {item.title}
                            </h5>
                            <p className="text-sm text-primary font-semibold flex items-center gap-1.5 mt-0.5 font-geist">
                              <Calendar className="w-4 h-4" />
                              {item.formatted_slot}
                              <span className="text-outline font-normal">
                                ({item.duration_minutes} minutes)
                              </span>
                            </p>
                          </div>

                          {item.reasoning && (
                            <p className="text-xs text-outline italic bg-white/70 p-2.5 rounded-xl border border-outline-variant/20">
                              💡 {item.reasoning}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Pied de modal */}
            <div className="p-4 bg-surface-container-low border-t border-outline-variant/20 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-outline font-geist uppercase tracking-wider">
                Module Sémantique & Smart-Scheduler · Krono AI
              </span>
              <button
                type="button"
                onClick={() => setShowFuzzyModal(false)}
                className="px-4 py-2 bg-surface hover:bg-surface-container border border-outline-variant/40 text-on-surface rounded-xl text-xs font-semibold transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL AJOUT MANUEL D'ÉVÉNEMENT --- */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
          onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* En-tête modal */}
            <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Plus className="w-4 h-4 text-emerald-700" />
                </div>
                <div>
                  <h3 className="font-hanken font-bold text-on-surface text-sm">Nouvel Événement</h3>
                  <p className="text-[10px] text-outline uppercase font-geist">Ajout Manuel · Calendrier Krono AI</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-outline hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Formulaire */}
            <form onSubmit={handleCreateEvent} className="p-6 space-y-4">
              {modalError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {modalError}
                </div>
              )}

              {/* Titre */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Titre de l'événement <span className="text-red-500">*</span>
                </label>
                <input
                  id="modal-title"
                  type="text"
                  required
                  autoFocus
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  placeholder="Ex: Réunion d'équipe, Sport, Cours..."
                  className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 outline-none text-sm transition-all"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Date
                </label>
                <input
                  id="modal-date"
                  type="date"
                  value={modalDate}
                  onChange={(e) => setModalDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 outline-none text-sm transition-all"
                />
              </div>

              {/* Horaires côte à côte */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Début
                  </label>
                  <input
                    id="modal-start"
                    type="time"
                    value={modalStartTime}
                    onChange={(e) => setModalStartTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 outline-none text-sm transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Fin
                  </label>
                  <input
                    id="modal-end"
                    type="time"
                    value={modalEndTime}
                    onChange={(e) => setModalEndTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 outline-none text-sm transition-all"
                  />
                </div>
              </div>

              {/* Type de contrainte */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  Type de contrainte
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalConstraint("soft")}
                    className={`flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                      modalConstraint === "soft"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                        : "border-outline-variant/40 text-on-surface-variant hover:border-emerald-300"
                    }`}
                  >
                    <span className="text-base">🟢</span>
                    Souple (SOFT)
                    <span className="text-[9px] font-normal opacity-70">Peut être déplacé par l'IA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalConstraint("hard")}
                    className={`flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                      modalConstraint === "hard"
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-outline-variant/40 text-on-surface-variant hover:border-red-300"
                    }`}
                  >
                    <span className="text-base">🔴</span>
                    Dure (HARD)
                    <span className="text-[9px] font-normal opacity-70">Ne bouge jamais</span>
                  </button>
                </div>
              </div>

              {/* Description optionnelle */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Description <span className="text-outline font-normal normal-case">(optionnel)</span>
                </label>
                <textarea
                  id="modal-description"
                  value={modalDescription}
                  onChange={(e) => setModalDescription(e.target.value)}
                  placeholder="Notes, lieu, informations complémentaires..."
                  rows={2}
                  className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 outline-none text-sm resize-none transition-all"
                />
              </div>

              {/* Boutons action */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 border border-outline-variant/50 text-on-surface-variant rounded-xl text-sm font-medium hover:bg-surface-container transition-all active:scale-95"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow disabled:opacity-60"
                >
                  {modalLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Création...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Créer l'événement
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL ÉDITION D'ÉVÉNEMENT --- */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
          onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* En-tête */}
            <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Pencil className="w-4 h-4 text-blue-700" />
                </div>
                <div>
                  <h3 className="font-hanken font-bold text-on-surface text-sm">Modifier l'événement</h3>
                  <p className="text-[10px] text-outline uppercase font-geist">Édition Manuelle · Calendrier Krono AI</p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-outline hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Formulaire */}
            <form onSubmit={handleUpdateEvent} className="p-6 space-y-4">
              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {editError}
                </div>
              )}

              {/* Titre */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Titre de l'événement <span className="text-red-500">*</span>
                </label>
                <input
                  id="edit-title"
                  type="text"
                  required
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Ex: Réunion d'équipe, Sport, Cours..."
                  className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none text-sm transition-all"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Date
                </label>
                <input
                  id="edit-date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none text-sm transition-all"
                />
              </div>

              {/* Horaires */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Début</label>
                  <input
                    id="edit-start"
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none text-sm transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Fin</label>
                  <input
                    id="edit-end"
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none text-sm transition-all"
                  />
                </div>
              </div>

              {/* Contrainte */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  Type de contrainte
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditConstraint("soft")}
                    className={`flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                      editConstraint === "soft"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                        : "border-outline-variant/40 text-on-surface-variant hover:border-emerald-300"
                    }`}
                  >
                    <span className="text-base">🟢</span>
                    Souple (SOFT)
                    <span className="text-[9px] font-normal opacity-70">Peut être déplacé par l'IA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditConstraint("hard")}
                    className={`flex flex-col items-center gap-1.5 py-3 px-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                      editConstraint === "hard"
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-outline-variant/40 text-on-surface-variant hover:border-red-300"
                    }`}
                  >
                    <span className="text-base">🔴</span>
                    Dure (HARD)
                    <span className="text-[9px] font-normal opacity-70">Ne bouge jamais</span>
                  </button>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Description <span className="text-outline font-normal normal-case">(optionnel)</span>
                </label>
                <textarea
                  id="edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Notes, lieu, informations complémentaires..."
                  rows={2}
                  className="w-full px-3 py-2.5 border border-outline-variant/60 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none text-sm resize-none transition-all"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget({ id: editEventId, title: editTitle });
                    setShowEditModal(false);
                    setShowDeleteConfirm(true);
                  }}
                  className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-sm font-semibold border border-red-200 transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 py-2.5 border border-outline-variant/50 text-on-surface-variant rounded-xl text-sm font-medium hover:bg-surface-container transition-all active:scale-95 text-center"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow disabled:opacity-60"
                >
                  {editLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Enregistrer
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL CONFIRMATION SUPPRESSION --- */}
      {showDeleteConfirm && deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={(e) => e.target === e.currentTarget && !deleteLoading && setShowDeleteConfirm(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 py-5 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="font-hanken font-bold text-on-surface text-base">Supprimer l'événement ?</h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  <span className="font-semibold text-on-surface">"{deleteTarget.title}"</span> sera supprimé
                  définitivement. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                disabled={deleteLoading}
                className="flex-1 py-2.5 border border-outline-variant/50 text-on-surface-variant rounded-xl text-sm font-medium hover:bg-surface-container transition-all active:scale-95 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                onClick={handleDeleteEvent}
                disabled={deleteLoading}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow disabled:opacity-60"
              >
                {deleteLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Suppression...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Supprimer
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL AJOUT DE CONTACT --- */}
      {showAddContactModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
          onClick={(e) => e.target === e.currentTarget && setShowAddContactModal(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-outline-variant/30">
            <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h3 className="font-hanken font-bold text-base text-on-surface">Nouveau Contact</h3>
              </div>
              <button
                onClick={() => setShowAddContactModal(false)}
                className="text-outline hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContact} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">Nom complet *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Thomas Dupont"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-outline-variant/60 rounded-xl focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1 flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  Numéro de téléphone (WhatsApp)
                </label>
                <input
                  type="tel"
                  placeholder="ex: +33612345678"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-outline-variant/60 rounded-xl focus:border-primary outline-none font-mono"
                />
                <span className="text-[10px] text-outline">Format international recommandé (ex: +33 6 ...)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  Adresse Email
                </label>
                <input
                  type="email"
                  placeholder="ex: thomas.dupont@entreprise.com"
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-outline-variant/60 rounded-xl focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1">Entreprise / Fonction (optionnel)</label>
                <input
                  type="text"
                  placeholder="ex: Responsable de projet"
                  value={newContactCompany}
                  onChange={(e) => setNewContactCompany(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-outline-variant/60 rounded-xl focus:border-primary outline-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddContactModal(false)}
                  className="flex-1 py-2.5 border border-outline-variant/50 text-on-surface-variant rounded-xl text-sm font-medium hover:bg-surface-container transition-all active:scale-95"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-primary hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow"
                >
                  <Plus className="w-4 h-4" />
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- CENTRE DE SÉCURITÉ & 2FA / DEVICES / RGPD --- */}
      <SecurityModal
        isOpen={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
        token={token}
      />

      {/* --- OUTILS DE RÉUNION IA & QUIZ --- */}
      <MeetingToolsModal
        isOpen={showMeetingToolsModal}
        onClose={() => setShowMeetingToolsModal(false)}
        onAddEvent={(title) => {
          setModalTitle(title);
          setShowAddModal(true);
        }}
      />

      </div> {/* fin app-body */}

    </div>
  );
}
