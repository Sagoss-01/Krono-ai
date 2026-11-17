import React, { useState } from "react";
import { Sparkles, X, CheckCircle2, ListTodo, HelpCircle, Copy, Check, Calendar, RefreshCw } from "lucide-react";
import { api } from "../api";

export default function MeetingToolsModal({ isOpen, onClose, onAddEvent }) {
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState("summary"); // summary, quiz
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [quizData, setQuizData] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleGenerateSummary = async () => {
    if (!notes.trim()) {
      alert("Veuillez saisir ou coller des notes de réunion.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.generateMeetingSummary("meeting-direct", notes);
      setSummaryData(data);
      setActiveTab("summary");
    } catch (err) {
      setError(err.message || "Erreur lors de la génération du compte-rendu.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!notes.trim()) {
      alert("Veuillez saisir ou coller des notes de réunion.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.generateMeetingQuiz("meeting-direct", notes);
      setQuizData(data.quiz || []);
      setActiveTab("quiz");
    } catch (err) {
      setError(err.message || "Erreur lors de la génération du quiz.");
    } finally {
      setLoading(false);
    }
  };

  const copySummaryToClipboard = () => {
    if (!summaryData) return;
    const text = `COMPTE-RENDU DE RÉUNION - KRONO AI\n\n` +
      `SYNTHÈSE :\n${summaryData.summary}\n\n` +
      `DÉCISIONS PRISES :\n${(summaryData.decisions || []).map(d => `• ${d}`).join('\n')}\n\n` +
      `ACTIONS & ASSIGNATIONS :\n${(summaryData.actions || []).map(a => `• [${a.assignee || 'Équipe'}] ${a.task} (Délai: ${a.due_date || 'Non spécifié'})`).join('\n')}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-outline-variant/30">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between bg-surface-container/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-hanken font-bold text-base text-on-surface">Outils de Réunion & Visio IA</h3>
              <p className="text-[11px] text-outline">Comptes-rendus automatiques, extraction d'actions et quiz d'assimilation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-outline hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Notes Input Area */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5 flex items-center justify-between">
              <span>Déroulé, notes ou transcription de la visioconférence</span>
              <span className="text-[10px] text-outline font-normal">Collage libre ou prise de notes directes</span>
            </label>
            <textarea
              rows={5}
              placeholder="Ex: Réunion du comité de projet du 10/11. Étaient présents : Alice, Bob et Thomas. Décision de valider la maquette v2. Bob doit finaliser l'API avant vendredi. Alice programme le déploiement en pré-production..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs border border-outline-variant/60 rounded-xl focus:border-primary outline-none transition-all leading-relaxed font-sans"
            />
          </div>

          {/* Action triggers */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleGenerateSummary}
              disabled={loading}
              className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow transition-all active:scale-95 disabled:opacity-60"
            >
              {loading && activeTab === "summary" ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ListTodo className="w-4 h-4" />
              )}
              Générer Synthèse & Plan d'actions
            </button>

            <button
              onClick={handleGenerateQuiz}
              disabled={loading}
              className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow transition-all active:scale-95 disabled:opacity-60"
            >
              {loading && activeTab === "quiz" ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <HelpCircle className="w-4 h-4" />
              )}
              Générer Quiz d'Évaluation
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
              {error}
            </div>
          )}

          {/* Sub-tabs when results exist */}
          {(summaryData || quizData) && (
            <div className="border-t border-outline-variant/30 pt-4 space-y-4">
              <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2">
                <div className="flex gap-2">
                  {summaryData && (
                    <button
                      onClick={() => setActiveTab("summary")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        activeTab === "summary" ? "bg-primary text-white" : "text-outline hover:bg-surface-container"
                      }`}
                    >
                      Compte-rendu & Actions
                    </button>
                  )}
                  {quizData && (
                    <button
                      onClick={() => setActiveTab("quiz")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        activeTab === "quiz" ? "bg-primary text-white" : "text-outline hover:bg-surface-container"
                      }`}
                    >
                      Quiz de réunion ({quizData.length} questions)
                    </button>
                  )}
                </div>

                {activeTab === "summary" && summaryData && (
                  <button
                    onClick={copySummaryToClipboard}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-primary/5 transition-all"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "Copié !" : "Copier le texte"}</span>
                  </button>
                )}
              </div>

              {/* TAB 1: SUMMARY & ACTIONS */}
              {activeTab === "summary" && summaryData && (
                <div className="space-y-4 animate-fadeIn">
                  <div className="bg-surface-container/20 p-4 rounded-xl border border-outline-variant/20">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-outline mb-1.5">Synthèse Exécutive</h4>
                    <p className="text-xs text-on-surface leading-relaxed whitespace-pre-line">
                      {summaryData.summary}
                    </p>
                  </div>

                  {summaryData.decisions && summaryData.decisions.length > 0 && (
                    <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Décisions Prises
                      </h4>
                      <ul className="space-y-1.5">
                        {summaryData.decisions.map((dec, i) => (
                          <li key={i} className="text-xs text-emerald-950 flex items-start gap-2">
                            <span className="text-emerald-500 font-bold">•</span>
                            <span>{dec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summaryData.actions && summaryData.actions.length > 0 && (
                    <div className="bg-white p-4 rounded-xl border border-outline-variant/30 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface mb-2 flex items-center gap-1.5">
                        <ListTodo className="w-4 h-4 text-primary" />
                        Plan d'Action & Détection des Tâches
                      </h4>
                      <div className="space-y-2">
                        {summaryData.actions.map((act, i) => (
                          <div
                            key={i}
                            className="p-3 bg-surface-container/30 border border-outline-variant/20 rounded-xl flex items-center justify-between gap-3"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-on-surface">{act.task}</p>
                              <div className="flex items-center gap-3 mt-1 text-[11px] text-outline">
                                <span>Responsable: <strong className="text-on-surface">{act.assignee || "Équipe"}</strong></span>
                                {act.due_date && <span>Échéance: {act.due_date}</span>}
                              </div>
                            </div>
                            {onAddEvent && (
                              <button
                                onClick={() => {
                                  onAddEvent(act.task);
                                  alert(`Tâche "${act.task}" ajoutée à votre agenda !`);
                                }}
                                className="px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold rounded-lg flex items-center gap-1 transition-all"
                                title="Créer un événement dans l'agenda"
                              >
                                <Calendar className="w-3.5 h-3.5" />
                                <span>Planifier</span>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: QUIZ */}
              {activeTab === "quiz" && quizData && (
                <div className="space-y-4 animate-fadeIn">
                  {quizData.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-white border border-outline-variant/30 rounded-xl space-y-3"
                    >
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <h5 className="text-xs font-semibold text-on-surface">{item.question}</h5>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-7">
                        {(item.options || []).map((opt, optIdx) => {
                          const isCorrect = optIdx === item.correct_index;
                          return (
                            <div
                              key={optIdx}
                              className={`p-2.5 rounded-lg text-xs border transition-all ${
                                isCorrect
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-900 font-medium"
                                  : "bg-surface-container/20 border-outline-variant/20 text-on-surface"
                              }`}
                            >
                              <span className="font-bold mr-1.5">{String.fromCharCode(65 + optIdx)}.</span>
                              {opt}
                              {isCorrect && (
                                <span className="ml-2 text-[10px] text-emerald-700 font-bold uppercase">(Réponse correcte)</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {item.explanation && (
                        <p className="text-[11px] text-outline italic pl-7 border-l-2 border-purple-200 mt-1">
                          Explication : {item.explanation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-outline-variant/20 bg-surface-container/20 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-outline-variant/60 text-on-surface rounded-xl text-xs font-semibold hover:bg-surface-container transition-all"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>
  );
}

