import React from "react";
import { 
  Calendar, Sparkles, Shield, Cpu, Clock, CheckCircle2, 
  ArrowRight, Users, Mail, Compass, Lock, Smartphone, 
  Layers, ChevronRight, Zap, RefreshCw, Eye
} from "lucide-react";
import kronoLogo from "../assets/logo.png";

export default function LandingPage({ onEnterApp, isLoggedIn, onOpenAuth }) {
  return (
    <div className="h-screen w-full bg-[#050c1a] text-slate-100 flex flex-col relative overflow-y-auto overflow-x-hidden font-['Sora',sans-serif] scroll-smooth">
      {/* Arrière-plan néon TechSphere */}
      <div className="fixed inset-0 pointer-events-none z-0 techsphere-bg-glow opacity-80" />
      <div className="fixed inset-0 pointer-events-none z-0 techsphere-grid opacity-50" />

      {/* Navigation TopBar */}
      <nav className="sticky top-0 z-50 h-16 px-6 md:px-12 flex items-center justify-between border-b border-cyan-500/10 bg-[#050c1a]/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#035c80] to-[#8b5cf6] p-0.5 shadow-lg shadow-cyan-900/30 flex items-center justify-center">
            <img src={kronoLogo} alt="Krono AI" className="w-8 h-8 object-contain" />
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent">
              Krono AI
            </span>
            <span className="ml-2 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-cyan-300">
              v2.0 TechSphere
            </span>
          </div>
        </div>

        {/* Liens de navigation */}
        <div className="hidden md:flex items-center gap-8 text-sm text-slate-300">
          <a href="#features" className="hover:text-cyan-400 transition-colors">Fonctionnalités</a>
          <a href="#security" className="hover:text-cyan-400 transition-colors">Sécurité 2FA & RGPD</a>
          <a href="#assistant" className="hover:text-cyan-400 transition-colors">Assistant Aura</a>
        </div>

        {/* Action principale */}
        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <button
              onClick={onEnterApp}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold text-xs tracking-wider uppercase flex items-center gap-2 shadow-lg shadow-cyan-900/40 transition-all active:scale-95"
            >
              <Calendar className="w-4 h-4" />
              <span>Ouvrir mon Agenda</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button
                onClick={() => onOpenAuth("login")}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/60 border border-slate-700/50 transition-all"
              >
                Connexion
              </button>
              <button
                onClick={() => onOpenAuth("register")}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-all shadow-md shadow-cyan-900/30"
              >
                Créer un compte
              </button>
            </>
          )}
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative z-10 pt-16 md:pt-24 pb-16 px-6 max-w-6xl mx-auto flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 text-xs font-medium mb-6 backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Planning Intelligent · Arbitrage de Conflits · Offline-First PWA</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight max-w-4xl">
          L'agenda qui pense, arbitre et <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">protège votre temps</span>.
        </h1>

        <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl font-light">
          Krono AI fusionne l'intelligence d'un arbitre de contraintes dures/souples avec la robustesse collaborative de <strong>TechSphere</strong>. Maîtrisez vos journées sans jamais subir les conflits d'agenda.
        </p>

        {/* Boutons d'action Hero */}
        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={onEnterApp}
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-sm tracking-wide uppercase flex items-center justify-center gap-3 shadow-xl shadow-cyan-900/50 transition-all active:scale-98"
          >
            <Calendar className="w-5 h-5" />
            <span>Accéder au Tableau de Bord</span>
            <ChevronRight className="w-4 h-4" />
          </button>
          
          <button
            onClick={onEnterApp}
            className="w-full sm:w-auto px-6 py-4 rounded-2xl techsphere-glass hover:bg-slate-800/80 text-slate-200 font-semibold text-sm border border-slate-700/60 flex items-center justify-center gap-2 transition-all"
          >
            <Eye className="w-4 h-4 text-cyan-400" />
            <span>Découvrir en Mode Démo</span>
          </button>
        </div>

        {/* Mini stats badges */}
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-3xl">
          <div className="p-4 rounded-xl techsphere-glass border border-cyan-500/20 text-center">
            <div className="text-2xl font-bold text-cyan-300">&lt; 3s</div>
            <div className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider font-mono">Arbitrage Vocal</div>
          </div>
          <div className="p-4 rounded-xl techsphere-glass border border-cyan-500/20 text-center">
            <div className="text-2xl font-bold text-emerald-400">100%</div>
            <div className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider font-mono">Sanctuarisation Hard</div>
          </div>
          <div className="p-4 rounded-xl techsphere-glass border border-cyan-500/20 text-center">
            <div className="text-2xl font-bold text-indigo-400">2FA / TOTP</div>
            <div className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider font-mono">Protection Forte</div>
          </div>
          <div className="p-4 rounded-xl techsphere-glass border border-cyan-500/20 text-center">
            <div className="text-2xl font-bold text-purple-400">Offline PWA</div>
            <div className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider font-mono">IndexedDB Ready</div>
          </div>
        </div>
      </section>

      {/* APERÇU DE L'INTERFACE PRINCIPALE DANS L'ORDRE REQUIS */}
      <section id="features" className="relative z-10 py-16 px-6 max-w-6xl mx-auto border-t border-slate-800/80 scroll-mt-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Architecture Complète</span>
          <h2 className="text-3xl font-bold mt-2">5 Piliers Organisés pour Votre Productivité</h2>
          <p className="text-sm text-slate-400 mt-2">
            Chaque espace répond à un besoin précis, centré en première loge sur votre calendrier.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Pilier 1 : Calendrier */}
          <div className="p-6 rounded-2xl techsphere-glass-card border border-cyan-500/30 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 mb-4">
                <Calendar className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest">1. En Première Loge</span>
              <h3 className="text-lg font-bold text-white mt-1">Calendrier & Smart-Scheduler</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Visualisation jour/semaine, arbitrage automatique des contraintes dures/souples, détection des temps de transport et export standard <strong>iCalendar (.ics)</strong>.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Zéro conflit garanti</span>
            </div>
          </div>

          {/* Pilier 2 : Assistant IA */}
          <div id="assistant" className="p-6 rounded-2xl techsphere-glass-card border border-indigo-500/30 flex flex-col justify-between scroll-mt-20">
            <div>
              <div className="w-12 h-12 rounded-xl bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-4">
                <Sparkles className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest">2. Co-Pilote IA</span>
              <h3 className="text-lg font-bold text-white mt-1">Assistant IA Aura & Outils Réunions</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Chat en streaming SSE, cartes interactives d'actions, synthèses de réunions automatiques, extraction des plans d'action et génération de quiz d'évaluation.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 text-xs text-indigo-300 font-mono">
              <Zap className="w-3.5 h-3.5" />
              <span>Streaming SSE mot par mot</span>
            </div>
          </div>

          {/* Pilier 3 : Carnet d'Adresses */}
          <div className="p-6 rounded-2xl techsphere-glass-card border border-purple-500/30 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-purple-400 mb-4">
                <Users className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest">3. Collaboration</span>
              <h3 className="text-lg font-bold text-white mt-1">Carnet d'Adresses & Contacts</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Annuaire complet avec gestion des favoris, recherche en temps réel et liaison directe avec l'assistant pour composer vos messages WhatsApp et emails.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 text-xs text-purple-300 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Contacts favoris en un clic</span>
            </div>
          </div>

          {/* Pilier 4 : Messagerie */}
          <div className="p-6 rounded-2xl techsphere-glass-card border border-teal-500/30 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-teal-950/80 border border-teal-500/40 flex items-center justify-center text-teal-400 mb-4">
                <Mail className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono text-teal-400 uppercase tracking-widest">4. Messagerie & Envoi</span>
              <h3 className="text-lg font-bold text-white mt-1">Messagerie Intelligente & Programmation</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Extraction d'événements depuis vos emails Google/Outlook, déduplication sémantique multi-sources et <strong>programmation d'envois différés</strong> (Scheduled Mail).
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 text-xs text-teal-300 font-mono">
              <Clock className="w-3.5 h-3.5" />
              <span>Envoi différé géré par Worker</span>
            </div>
          </div>

          {/* Pilier 5 : Administration */}
          <div className="p-6 rounded-2xl techsphere-glass-card border border-amber-500/30 flex flex-col justify-between md:col-span-2">
            <div>
              <div className="w-12 h-12 rounded-xl bg-amber-950/80 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4">
                <Shield className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono text-amber-400 uppercase tracking-widest">5. Gouvernance</span>
              <h3 className="text-lg font-bold text-white mt-1">Panneau d'Administration & Supervision</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Tableau de bord superviseur avec métriques de charge, gestion des comptes et privilèges administrateur, journaux d'audit de sécurité et réglage des invites système IA.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 text-xs text-amber-300 font-mono">
              <Lock className="w-3.5 h-3.5" />
              <span>Audit de conformité & gestion fine des rôles</span>
            </div>
          </div>
        </div>
      </section>

      {/* SÉCURITÉ & RGPD TECHSPHERE */}
      <section id="security" className="relative z-10 py-16 px-6 max-w-5xl mx-auto border-t border-slate-800/80 scroll-mt-16">
        <div className="p-8 rounded-3xl techsphere-glass border border-cyan-500/30 bg-gradient-to-br from-[#050c1a] via-[#091830] to-[#0d1b3a]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-4 max-w-xl">
              <span className="text-xs font-mono px-3 py-1 rounded-full bg-cyan-950 border border-cyan-500/30 text-cyan-300">
                Sécurité & Confidentialité Intégrées
              </span>
              <h3 className="text-2xl font-bold text-white">
                Authentification 2FA, Quick Connect QR & Respect Total du RGPD
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Connectez un nouvel appareil sans mot de passe en scannant un QR code depuis votre mobile, activez la double authentification par TOTP, surveillez les sessions actives et exportez toutes vos données d'un clic.
              </p>
            </div>

            <div className="flex flex-col gap-3 shrink-0 w-full sm:w-auto">
              <button
                onClick={onEnterApp}
                className="px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-lg shadow-cyan-900/30 flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>Tester la Sécurité</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 mt-auto border-t border-slate-800/80 py-8 px-6 text-center text-xs text-slate-500 font-mono">
        <p>Krono AI © 2026 · Intégration Suite TechSphere · iP Net Institute of Technology</p>
      </footer>
    </div>
  );
}

