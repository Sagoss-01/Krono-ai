# Krono AI — Documentation d'implémentation (pour débutant)

Ce document explique **ce qui a été construit**, **pourquoi**, et **comment reproduire
chaque étape toi-même**, module par module, en suivant le Programme de Développement
du cahier des charges. Chaque section = un module du programme.

Structure finale du projet :

```
krono-ai/
├── requirements.txt
└── app/
    ├── main.py                        # Point d'entrée FastAPI
    ├── config.py                      # Configuration (variables d'env)
    ├── database.py                    # Connexion PostgreSQL async
    ├── models/
    │   ├── db_models.py                # Tables SQLAlchemy (User, Event, CalendarLink)
    │   └── schemas.py                  # Schémas Pydantic (validation API)
    ├── auth/
    │   ├── security.py                 # Bcrypt, JWT, chiffrement Fernet
    │   └── routes.py                   # /auth/register, /auth/login, /auth/me
    ├── privacy/
    │   └── gateway.py                  # Anonymisation RGPD avant appel Gemini
    ├── ai/
    │   ├── gemini_client.py            # Appels Gemini avec response_schema
    │   └── nlp_service.py              # Nettoyage des transcriptions vocales
    ├── scheduler/
    │   ├── conflict_engine.py          # Smart-Scheduler : détection/résolution conflits
    │   └── eta.py                      # Calcul ETA et détection de retard
    ├── calendar_sync/
    │   ├── providers.py                # Connecteurs Google Calendar / Outlook
    │   └── deduplication.py            # Anti-doublon multi-sources
    └── notifications/
        └── push_service.py             # Notifications Web Push (VAPID)
```

---

## Module A — Sécurité, Authentification & Privacy Gateway

### 1. Pourquoi séparer hachage et chiffrement ?

Un **mot de passe** est **haché** (bcrypt) : opération à sens unique. On ne le
récupère jamais en clair, on compare juste deux hash.

```python
# app/auth/security.py
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
```

Un **token OAuth2** (Google/Outlook), lui, doit être **chiffré** (Fernet) :
on doit pouvoir le déchiffrer plus tard pour l'envoyer à l'API externe. Le
chiffrement est réversible avec la bonne clé, contrairement au hachage.

### 2. JWT : comment ça marche concrètement ?

1. L'utilisateur se connecte avec email + mot de passe (`POST /auth/login`).
2. Le serveur vérifie le mot de passe, puis génère un jeton signé contenant
   son `user_id` et une date d'expiration.
3. Le client stocke ce jeton et le renvoie dans le header
   `Authorization: Bearer <token>` à chaque requête suivante.
4. Le serveur décode et vérifie la signature à chaque requête protégée —
   c'est le rôle de la dépendance `get_current_user()`.

```python
# app/auth/routes.py
async def get_current_user(token: str = Depends(oauth2_scheme), db=Depends(get_db)):
    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Jeton invalide ou expiré.")
    ...
```

Utilisation dans n'importe quelle future route protégée :

```python
@router.get("/mes-evenements")
async def my_events(current_user: User = Depends(get_current_user)):
    ...
```

### 3. Privacy Gateway (exigence RGPD)

Avant d'envoyer un texte utilisateur à Gemini, on remplace les données
sensibles (noms, emails, téléphones) par des jetons anonymes, on garde la
correspondance en mémoire, puis on restaure les vraies valeurs dans la
réponse de Gemini.

```python
gw = PrivacyGateway()
result = gw.anonymize("Contacte Jean Dupont à jean.dupont@email.com")
# -> "Contacte __NAME_9ae62e__ __NAME_d44f33__ à __EMAIL_5cd53d__"
# ... on envoie ce texte anonymisé à Gemini ...
restored = gw.restore(reponse_gemini, result.token_map)
# -> les vraies valeurs sont remises à la bonne place
```

**Limite actuelle (à améliorer plus tard)** : la détection utilise des
regex simples. Pour une V2 plus robuste, remplacer par un vrai modèle NER
(Named Entity Recognition), par exemple via `spaCy` en français.

---

## Module B — Moteur d'IA (NLP & Parsing)

### 1. Forcer un JSON valide avec `response_schema`

Le piège classique avec un LLM : lui demander "réponds en JSON" dans le
prompt et espérer qu'il obéisse. Le SDK Gemini permet de **forcer**
structurellement la sortie via `response_schema` — la réponse est
garantie conforme, pas besoin de parser un texte imprévisible.

```python
TASK_INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["create_event", "delete_event", "move_event"]},
        "title": {"type": "string"},
        "date": {"type": "string"},
        ...
    },
    "required": ["action", "title", "date"],
}

response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=TASK_INTENT_SCHEMA,
    ),
)
data = json.loads(response.text)  # toujours un JSON valide conforme au schéma
```

### 2. Nettoyage sémantique AVANT d'appeler l'IA

On filtre les tics de langage ("euh", "genre"...) et les répétitions
**côté backend, avec du code déterministe**, plutôt que de tout laisser
faire à Gemini. Pourquoi ?

- **Coût et latence** : moins de tokens envoyés = réponse plus rapide
  (contrainte du cahier des charges : pipeline vocal < 3 secondes).
- **Testabilité** : une regex se teste avec Pytest de façon 100%
  déterministe ; le comportement d'un LLM est plus difficile à garantir.

```python
clean_transcription("euh ajoute ajoute un point d'équipe demain euh après-midi genre")
# -> "ajoute un point d'équipe demain après-midi"
```

**Pour aller plus loin** : la liste `FILLER_WORDS` est volontairement
courte. Ariel peut l'enrichir avec d'autres expressions ("tu vois",
"comment dire"...) au fil des tests utilisateurs réels.

---

## Module C — Synchronisation & Déduplication

### 1. Pattern "Provider" pour les connecteurs calendrier

Chaque fournisseur (Google, Outlook) implémente la même interface
abstraite. Le reste du code n'a jamais besoin de savoir "avec qui il
parle" :

```python
provider = get_provider("google")  # ou "microsoft"
events = await provider.fetch_events(access_token, start, end)
```

Avantage concret : ajouter un jour un connecteur Apple Calendar ne
nécessitera de toucher qu'à un seul nouveau fichier, jamais au code
existant.

### 2. Déduplication en deux niveaux

**Niveau 1 (certain)** : l'événement a déjà un `external_id` connu en
base -> c'est forcément un doublon, on l'ignore.

**Niveau 2 (probable)** : pas d'ID commun (ex: le même rendez-vous créé
indépendamment sur Google ET Outlook). On compare :
- la **similarité du titre** (`difflib.SequenceMatcher`, un algorithme
  standard de Python pour comparer deux chaînes de caractères) ;
- le **taux de chevauchement temporel** des deux créneaux.

Si les deux dépassent un seuil (85% de similarité de titre, 80% de
chevauchement horaire), on considère que c'est un doublon.

> **Bug corrigé pendant le développement** : la première version ne
> comparait les nouveaux événements qu'entre eux (au sein du même lot
> importé), pas contre les événements déjà présents en base depuis une
> synchro précédente. Un événement Outlook pouvait donc passer entre les
> mailles du filet s'il correspondait à un événement Google importé la
> veille. Corrigé en passant explicitement `existing_events` (déjà en
> base) à la fonction, en plus du nouveau lot à traiter.

```python
to_import, duplicates = deduplicate(
    existing_events=evenements_deja_en_base,
    incoming_events=nouveaux_evenements_importes,
)
```

---

## Module D — Smart-Scheduler (l'algorithme central)

C'est le cœur du projet. Trois fonctions travaillent ensemble :

### 1. `detect_conflicts()` — trouver les chevauchements

Deux événements se chevauchent si l'un commence avant que l'autre finisse :

```python
def overlaps(self, other):
    return self.start < other.end and other.start < self.end
```

On compare chaque paire d'événements (complexité O(n²), largement
suffisant pour un agenda perso avec quelques dizaines d'événements/jour).

### 2. `resolve_conflicts()` — qui doit bouger ?

Règle de sanctuarisation du cahier des charges : **une contrainte dure ne
bouge JAMAIS**. Trois cas possibles pour une paire en conflit :

| Cas | Action |
|---|---|
| HARD vs SOFT | Le SOFT est déplacé, le HARD reste fixe |
| HARD vs HARD | Conflit non résolvable automatiquement (à signaler à l'utilisateur en orange, cf. Module 2 UI) |
| SOFT vs SOFT | Le second (par ordre chronologique) est déplacé |

### 3. `find_nearest_free_slot()` — trouver où déplacer

Recherche par pas de 15 minutes, en alternant après/avant le créneau
d'origine, jusqu'à trouver un créneau libre de la même durée (fenêtre de
recherche : 12h par défaut, ajustable).

**Exemple testé** :
```
Réunion (HARD) : 9h00 → 10h00
Sport   (SOFT) : 9h30 → 10h30   <- chevauche la réunion

Résultat : le Sport est déplacé à 10h00 → 11h00, la Réunion ne bouge pas.
```

### 4. Calcul d'ETA et détection de retard (`eta.py`)

Compare position GPS actuelle + heure courante + heure cible du rendez-vous
via une API de calcul d'itinéraire (Google Distance Matrix ici, remplaçable).
Si l'heure d'arrivée estimée dépasse l'heure du rendez-vous, `is_late=True`
et on peut déclencher le module d'excuse automatique (Module D, "Nouveau").

### 5. Génération d'excuses contextuelles

Un prompt Gemini dédié, dont le **ton s'adapte au contexte** (entreprise,
administration, médecin) et qui **mentionne le minutage exact** du retard —
exigence explicite du cahier des charges.

---

## Module E — Notifications Push (VAPID)

VAPID permet au serveur de signer ses notifications sans dépendre d'un
service tiers payant. On utilise `pywebpush`, demandé dans la Tech Stack.

Point clé : le **niveau d'urgence détermine le son joué côté client** :

```python
_SOUND_MAP = {
    Urgency.LOW: "bip_discret.mp3",
    Urgency.CRITICAL: "alarme_critique.mp3",
}
```

Le payload envoyé inclut aussi les `actions` (boutons "Valider",
"Reporter", "Refuser") — c'est le Service Worker côté frontend qui
affichera ces boutons dans la bannière de notification.

---

## Module F — Frontend Web (React + Calendrier)

### 1. Pourquoi une grille de calendrier "maison" plutôt que FullCalendar.js directement dans ce fichier ?

Le cahier des charges demande `FullCalendar.js`, et `package.json` l'inclut
bien comme dépendance réelle (`@fullcalendar/react`) — **utilise-le dans ton
vrai projet**. Le composant `<WeekGrid>` fourni ici est une version "maison"
volontairement simple, pour deux raisons pédagogiques :

1. Elle montre **exactement** comment calculer la position d'un événement
   dans une grille horaire à partir de deux nombres (`start`, `end`) —
   c'est ce que FullCalendar fait en interne, mais en le codant toi-même
   une fois, tu comprends vraiment le calcul (`top = (heure_debut - 7) * 48px`).
2. Elle est 100% autonome (aucune dépendance externe), donc tu peux la
   tester tout de suite sans rien installer.

**Migration vers FullCalendar (quand tu es prêt)** : remplace `<WeekGrid
events={events} />` par :
```jsx
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';

<FullCalendar
  plugins={[timeGridPlugin]}
  initialView="timeGridWeek"
  events={events.map(e => ({
    title: e.title,
    start: toISODate(e.day, e.start),
    end: toISODate(e.day, e.end),
    color: e.type === 'hard' ? '#E5484D' : e.type === 'conflict' ? '#F5A524' : '#30A46C',
  }))}
/>
```
Garde exactement la même structure de données (`events` avec `type`,
`day`, `start`, `end`) — seul le composant d'affichage change.

### 2. Le code couleur contextuel (exigence explicite du cahier des charges)

```js
const color = event.type === "hard" ? COLORS.hard        // rouge
            : event.type === "conflict" ? COLORS.conflict // orange, clignote
            : COLORS.soft;                                 // vert
```

Le clignotement est fait en CSS pur (`@keyframes pulseWarn`), pas en
JavaScript — plus performant, le navigateur optimise nativement les
animations CSS.

### 3. Simuler le pipeline vocal + NLP côté frontend (pour développer sans backend)

`simulateIntentParsing()` reproduit en local (avec des regex simples) ce
que fera `app/ai/gemini_client.py` côté serveur. C'est une pratique
courante : **développer le frontend avec des données simulées** pendant
que le backend n'est pas encore branché, puis remplacer l'appel simulé par
un vrai `fetch('/api/parse-task', ...)` une fois prêt.

```js
// Aujourd'hui (démo) :
const intent = simulateIntentParsing(userText);

// Demain (vrai backend) :
const response = await fetch('/api/parse-task', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: userText }),
});
const intent = await response.json();
```

### 4. L'élément signature : la ligne de pouls

Quand l'assistant "réfléchit" (`thinking === true`), une petite barre
bleue pulse à côté du texte "Krono analyse ta demande…". C'est purement
visuel (`@keyframes pulseFlow`) mais ça matérialise concrètement
l'objectif du projet : donner l'impression d'un assistant **proactif**,
pas d'un simple formulaire qui attend une réponse serveur en silence.

### 5. Prochaine étape technique réelle : IndexedDB (Module E, offline-first)

Le `package.json` inclut déjà `dexie` (wrapper simplifié d'IndexedDB). Le
principe pour brancher le offline-first plus tard :
```js
import Dexie from 'dexie';
const db = new Dexie('KronoAI');
db.version(1).stores({ events: 'id, day, start' });

// Lire/écrire localement, indépendamment du réseau :
await db.events.put(newEvent);
const localEvents = await db.events.toArray();
```
Le `Service Worker` intercepte ensuite les requêtes réseau pour basculer
automatiquement entre API distante et `db.events` locale selon la
connectivité.

### Comment lancer le frontend en local

```bash
cd krono-ai/frontend
npm install
npm run dev
# -> http://localhost:5173
```

---

```bash
cd krono-ai
python3 -m venv venv
source venv/bin/activate          # Windows : venv\Scripts\activate
pip install -r requirements.txt

# Variables d'environnement minimales (fichier .env à la racine)
echo "DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/krono_ai" >> .env
echo "JWT_SECRET_KEY=une-cle-secrete-longue-et-aleatoire" >> .env
echo "GEMINI_API_KEY=ta-cle-gemini" >> .env

uvicorn app.main:app --reload
# -> http://127.0.0.1:8000/docs pour tester l'API interactivement
```

## Module G — Messagerie liée et assistance IA (`backend/mailbox/`)

**Pourquoi ce module ?** Krono lisait déjà les mails Gmail/Outlook via OAuth, mais ne pouvait ni lier une adresse hébergée ailleurs, ni envoyer un message rédigé avec l'IA. Ce module ajoute les deux, en reprenant le principe du webmail : l'IA propose, l'utilisateur valide.

**Ce que le module fait**
- Lier une adresse par identifiants IMAP/SMTP (mot de passe d'application). Krono teste la connexion avant d'enregistrer, et chiffre le mot de passe avec Fernet (même mécanisme que les jetons OAuth).
- Lire les messages (en-têtes puis texte), en lecture seule : un message consulté n'est pas marqué comme lu.
- Envoyer un message, uniquement après confirmation explicite de l'utilisateur (`confirmed: true`), avec fil de réponse (`In-Reply-To`, `References`) et copie dans « Envoyés ».
- Demander à l'IA un brouillon, une réponse, une reformulation, une traduction, un résumé ou un objet.

**Frontières : ce que l'IA ne fait pas**
- Elle ne choisit jamais les destinataires : les adresses saisies ne lui sont jamais transmises.
- Elle n'envoie rien et n'a aucun outil de recherche : seul le message que l'utilisateur sélectionne lui est fourni, lu par le serveur.
- Son résultat est un texte que l'utilisateur relit et peut modifier avant l'envoi.

**Confidentialité et sécurité**
- Tout texte passe par la Privacy Gateway avant Gemini (règle 2 de CLAUDE.md), puis les jetons sont restaurés. Limite : la détection des noms est heuristique.
- Le contenu d'un message reçu est une donnée non fiable : il est délimité dans le prompt, et les délimiteurs sont retirés de la donnée pour qu'elle ne puisse pas « sortir » du bloc.
- Serveurs de messagerie : TLS obligatoire (IMAP 993, SMTP 465 ou 587) et refus des adresses privées ou locales (protection contre le détournement vers le réseau interne, ou SSRF). Limite : une résolution DNS différente à la connexion ne peut pas être exclue.
- Aucun contenu de message n'est stocké en base. Les mots de passe sont effacés à la déliaison.

**Limites de la version 1** (volontaires)
- 20 destinataires par message, objet 200 caractères, corps 20 000 caractères, 5 adresses liées par utilisateur, 30 envois par heure.
- Limite d'envois en mémoire : valable pour un seul processus serveur.
- Recherche en ASCII uniquement, pas de pièces jointes (listées seulement), pas de Bcc, pas d'envoi différé (le module `messaging` existant gère les messages programmés, sans passer par ce module).
- Changer `JWT_SECRET_KEY` rend illisibles les mots de passe déjà enregistrés : il faudra relier les adresses.

**Fichiers** : `backend/mailbox/policy.py` (règles et limites), `protocol.py` (IMAP/SMTP), `ai_assistant.py` (IA), `routes.py` (API `/mailbox/...`). Frontend : `front/src/components/MailboxPanel.jsx` et `mailbox.css`, sous-onglet « Boîtes mail & IA » de la messagerie.

**Tests** : `python -m pytest tests/test_mailbox.py` (33 tests, hors réseau). Les échanges IMAP/SMTP réels n'ont pas été testés : aucun serveur de messagerie de test n'est disponible dans l'environnement.

---

## Module H — Carte : lieux fréquentés et itinéraire de la journée

**Pourquoi ?** La carte savait chercher un lieu ou relier deux points, mais ne connaissait ni vos lieux habituels, ni votre journée.

**Lieux fréquentés** (`/geo/frequent-places`) : Domicile, Bureau, École, QG ou lieu libre. Un lieu se place par clic sur la carte, par coordonnées saisies ou par adresse (géocodée). Un libellé est unique par utilisateur.

**Itinéraire de la journée** (`/geo/day-itinerary?date=AAAA-MM-JJ`) :
- les arrêts sont les événements du jour ayant un lieu, dans l'ordre horaire ;
- un lieu d'événement identique à un lieu fréquent (« Bureau ») utilise ses coordonnées, sans appel réseau ;
- sinon le lieu est géocodé, et les coordonnées sont mémorisées sur l'événement (colonnes `latitude`, `longitude`, `geo_source`). Si le lieu change, elles sont recalculées ;
- le départ est votre position actuelle si vous l'envoyez, sinon votre domicile, sinon le premier arrêt ;
- tout le trajet est calculé en une seule requête Geoapify (jusqu'à 23 arrêts).

**Cas traités** : lieu introuvable (signalé, les autres arrêts sont gardés), événement sans lieu (compté, non tracé), point situé loin de toute route (message clair : 422), plus de 23 arrêts (tronqué, signalé).

**Piège rencontré** : pour un trajet à plusieurs étapes, Geoapify renvoie le tracé sous forme de `MultiLineString`. Le tracé est aplati avant d'être dessiné (`flatten_line`).

**Fichiers** : `backend/geo/itinerary.py` (logique pure), `backend/geo/routes.py` (API), `front/src/GeoMapTab.jsx`, `GeoPlacesPanel.jsx`, `GeoItineraryPanel.jsx`.

**Tests** : `python -m pytest tests/test_itinerary.py` (13 tests hors réseau). Vérifiés aussi avec le vrai Geoapify : itinéraire de trois arrêts, persistance des coordonnées, lieux fréquents créés, modifiés et supprimés.

---

## Ce qui a été testé (et validé) pendant le développement

| Composant | Méthode de test | Résultat |
|---|---|---|
| Nettoyage NLP (`clean_transcription`) | Exécution directe, sans dépendance | ✅ Filtre bien les hésitations et répétitions |
| Smart-Scheduler (`resolve_conflicts`) | Scénario HARD vs SOFT en conflit | ✅ La contrainte dure ne bouge jamais |
| Déduplication (`deduplicate`) | Scénario cross-provider Google/Outlook | ✅ Bug détecté et corrigé en cours de route |
| Privacy Gateway (`anonymize`/`restore`) | Aller-retour anonymisation | ✅ Restauration fidèle au texte d'origine |
| Syntaxe de tous les fichiers | `ast.parse()` sur les 15 fichiers | ✅ Aucune erreur |

Les tests nécessitant une vraie connexion (Gemini, Google Calendar, Outlook,
PostgreSQL) n'ont pas pu être exécutés dans cet environnement (pas de clés
API ni de base de données disponibles) — c'est la prochaine étape pour
Ariel une fois les credentials configurés. Les squelettes de code (Modules
B et C) sont prêts à être branchés dès que les clés seront disponibles.

## Prochaines étapes suggérées (Modules non encore codés)

- **Module F (approfondissement)** : migrer `<WeekGrid>` vers le vrai
  `@fullcalendar/react` (déjà en dépendance), brancher IndexedDB/Dexie pour
  le offline-first réel, intégrer la Web Speech API pour un vrai
  Speech-to-Text (actuellement simulé dans `toggleMic()`).
- **Module G (Tests & Déploiement)** : écrire les tests Pytest formels
  (actuellement les tests ont été faits manuellement en script), configurer
  Docker + CI/CD, déployer sur VPS avec Nginx/HTTPS.
- **Alembic** : pour gérer les migrations de schéma PostgreSQL proprement
  (actuellement `Base.metadata.create_all` au démarrage, à remplacer avant
  la mise en production).
