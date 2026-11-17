# Krono AI — Contexte projet pour Claude Code

## Qu'est-ce que ce projet ?

Krono AI est une application web/mobile de planning intelligent (projet de
fin d'études — Génie Logiciel, iP Net Institute of Technology). Elle
combine :
- interprétation du langage naturel (texte/voix) pour créer des tâches,
- un moteur d'arbitrage automatique des conflits d'agenda (Smart-Scheduler),
- une synchronisation bidirectionnelle avec Google Calendar / Outlook,
- un mode hors-ligne (offline-first),
- des notifications proactives (push, alarmes sonores selon l'urgence).

Le cahier des charges complet (fonctionnel + non-fonctionnel) est
implicite dans le code déjà écrit — se référer à `DOCUMENTATION.md` pour
le détail pédagogique de chaque module.

## Stack technique (ne pas dévier sans discussion explicite)

**Backend**
- Python 3.12, FastAPI (async), SQLAlchemy 2.0 en mode async (`asyncpg`)
- LangGraph
- PostgreSQL (hébergé sur Neon en dev)
- Pydantic v2 pour toute validation d'entrée/sortie
- Auth : JWT (PyJWT) + Bcrypt (passlib) ; tokens OAuth2 tiers chiffrés
  avec Fernet avant stockage en base
- IA : SDK `google-genai` (Gemini), toujours avec `response_schema` pour
  forcer un JSON structuré — ne jamais parser du texte libre côté serveur
- Notifications : `pywebpush` (VAPID)

**Frontend**
- React 18 (hooks, pas de classes), Vite
- `@fullcalendar/react` pour le calendrier (le composant de démo
  `<WeekGrid>` dans `App.jsx` est une version pédagogique "maison" à
  migrer vers FullCalendar quand le backend sera branché)
- Dexie (wrapper IndexedDB) pour le offline-first
- Pas de Tailwind config compiler custom : utiliser des classes Tailwind
  de base ou du style inline pour les couleurs de marque

**Tests**
- Pytest (backend), Jest (frontend) — pas encore écrits formellement,
  seulement validés manuellement via scripts ad hoc pendant le dev

## Conventions de code établies (à respecter)

- **Français** pour tous les commentaires, docstrings et messages
  utilisateur. Code (noms de variables/fonctions) en anglais.
- Chaque module a une docstring de fichier en haut expliquant *pourquoi*
  ce module existe et à quelle exigence du cahier des charges il répond
  (voir n'importe quel fichier dans `app/` comme référence de style).
- Ariel est en cours d'apprentissage (Génie Logiciel, étudiant) — les
  explications techniques doivent rester pédagogiques : dire *pourquoi*
  un choix est fait, pas seulement *quoi* faire. Éviter le jargon non
  expliqué.
- Toujours tester ce qui peut l'être en isolation (sans dépendance
  réseau) avant de livrer — voir comment `conflict_engine.py` et
  `deduplication.py` ont été validés avec des scripts Python directs.

## Règles métier non négociables (issues du cahier des charges)

1. **Sanctuarisation des contraintes dures** : un événement `hard` ne doit
   JAMAIS être déplacé automatiquement par le Smart-Scheduler. Seuls les
   événements `soft` peuvent bouger.
2. **Privacy Gateway obligatoire** : aucune donnée nominative réelle
   (nom, email, téléphone) ne doit partir vers l'API Gemini sans passer
   par `app/privacy/gateway.py` d'abord.
3. **Code couleur strict** côté UI : rouge = contrainte dure, vert =
   contrainte souple, orange clignotant = conflit non résolu. Ne pas
   improviser d'autres couleurs pour ces états.
4. **Latence** : le pipeline vocal complet (STT + Gemini + parsing) doit
   rester sous 3 secondes — éviter d'ajouter des appels réseau
   synchrones bloquants dans ce chemin.

## Ce qui est fait / ce qui reste

Voir la section "Prochaines étapes suggérées" en fin de
`DOCUMENTATION.md`, tenue à jour au fil du développement. Avant de
proposer une nouvelle fonctionnalité, vérifier si un fichier existant
couvre déjà partiellement le besoin (ex : ne pas recréer un second
système d'auth ou un second moteur de conflits).

## Secrets

Jamais de clé API, mot de passe ou token en dur dans le code. Tout passe
par `.env` (voir `.env.example` pour la liste des variables attendues) et
`app/config.py`. Si une fonctionnalité a besoin d'une nouvelle variable
d'environnement, l'ajouter aux deux endroits.
