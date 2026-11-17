# Déploiement — Assistant IA TechSphere (lots 1 à 4, cumulatif)

Ce zip contient **tous** les fichiers nouveaux ou modifiés depuis la version `netiify-webmail_13_10_2026`.
**Copiez chaque fichier au même chemin, en écrasant l'existant.** Aucune nouvelle dépendance npm (Node 18 ou plus).
Au démarrage, `initDB` crée seul les nouvelles tables et la colonne `ai_preferences.retention_days` ; aucun SQL à lancer.

## 1. `.env` (déjà inclus — contient votre clé, ne le partagez pas)
Obligatoires : `OPEN_ROUTER_API_KEY`, `OPEN_ROUTER_BASE_URL=https://openrouter.ai/api/v1`, `OPEN_ROUTER_MODEL=openrouter/free`.
Facultatives (lignes commentées déjà ajoutées) : `OPEN_ROUTER_FALLBACK_MODELS` (modèles de secours, séparés par des virgules), `OPEN_ROUTER_MODEL_FAST` (petit modèle pour les tâches simples), `AI_DAILY_CALLS_PER_USER` (quota, défaut 300, 0 = illimité), `AI_DEFAULT_RETENTION_DAYS` (0, 7, 30, 90 ou 365).
`CHAT_ENCRYPTION_KEY` doit être définie : sans elle, l'envoi programmé persistant est refusé (on ne stocke jamais un mot de passe en clair) et l'ancien mode en mémoire est utilisé.
`SYSTEM_EMAIL` / `SYSTEM_EMAIL_PASS` servent aux e-mails automatiques (compte-rendu de réunion, échec d'un envoi programmé).

## 2. Fichiers NOUVEAUX
| Dossier | Fichiers |
|---|---|
| `.github/workflows/` | `tests.yml` |
| `(racine)/` | `DEPLOIEMENT.md` |
| `public/css/` | `ai-assistant.css` |
| `public/js/` | `admin-ai.js`, `ai-assistant.js`, `ai-mail-tools.js` |
| `public/js/meeting/` | `meeting-ai-extras.js`, `meeting-whiteboard-ai.js`, `meeting-whiteboard-images.js` |
| `scripts/` | `archive-dead-files.js`, `eval-prompts.js`, `run-tests.js` |
| `src/controllers/` | `aiAdminController.js`, `aiController.js` |
| `src/services/` | `aiAgendaService.js`, `aiAssistantService.js`, `aiAuditService.js`, `aiChatService.js`, `aiContext.js`, `aiDesignLibrary.js`, `aiFeedbackService.js`, `aiMailboxService.js`, `aiMeetingService.js`, `aiPreferencesService.js`, `aiPrompts.js`, `aiService.js`, `aiStream.js`, `aiTime.js`, `aiUsage.js`, `aiWhiteboardService.js`, `meetingAiSummaryService.js`, `scheduledEmailService.js`, `systemMailer.js`, `wbImageService.js` |
| `src/workers/` | `backgroundJobs.js` |
| `tests/` | `ai-assistant.test.js`, `ai-client.test.js`, `ai-design.test.js`, `ai-governance.test.js`, `ai-injection.test.js`, `ai-json.test.js`, `ai-meeting.test.js`, `ai-preferences.test.js`, `ai-reliability.test.js`, `ai-time-agenda.test.js`, `ai-whiteboard.test.js`, `helpers.js`, `prompt-cases.json`, `prompt-eval.test.js`, `routes-load.test.js`, `scheduled-email.test.js`, `wb-image.test.js` |
| `views/components/` | `ai-assistant.ejs` |

## 3. Fichiers MODIFIÉS (à écraser)
| Dossier | Fichiers |
|---|---|
| `(racine)/` | `.env`, `package.json`, `server.js` |
| `public/js/` | `app.js`, `chat-ui.js`, `compose.js`, `mail.js`, `tools-ui.js` |
| `public/js/meeting/` | `meeting-captions.js`, `meeting-chat.js`, `meeting-features.js` |
| `src/controllers/` | `mailController.js`, `meetingController.js` |
| `src/middlewares/` | `apiRateLimiter.js` |
| `src/` | `routes.js` |
| `src/services/` | `db.js`, `gdprService.js`, `imap.js`, `socket.js` |
| `src/workers/` | `reminderWorker.js` |
| `views/components/` | `compose.ejs`, `sidebar.ejs`, `tools-panel.ejs` |
| `views/pages/` | `mail.ejs`, `meeting-room.ejs` |

## 4. Mise en route
1. Copier les fichiers, `pm2 restart <app>`. Dans les logs : `DB assistant IA initialisee` puis `[Tâches de fond] rappels, envois programmés et maintenance IA démarrés`.
2. `npm test` → 97 tests doivent passer (Node 18+).
3. Réglez la surveillance : **Outils → Administration → onglet IA** (voir §7).
4. Nettoyage facultatif et réversible : `node scripts/archive-dead-files.js` (simulation) puis `--apply` ; `--restore` remet tout.
5. Si un proxy (nginx, Cloudflare) met les réponses en tampon, l'affichage progressif arrivera d'un bloc (`X-Accel-Buffering: no` est déjà envoyé pour nginx).
6. Le dossier `storage/` (images du tableau blanc, pièces jointes d'envois programmés) est créé automatiquement : l'application doit pouvoir y écrire. Il ne doit pas être servi publiquement.
7. Le serveur MySQL et Node doivent être en **UTC** (ou le pool configuré avec `timezone: 'Z'`) : les dates sont stockées en UTC, comme pour l'agenda.

## 5. Lots 1 et 2 (résumé)
Assistant IA du webmail avec cartes d'action confirmées (e-mail, événement, contact, réunion, recherche), lecture seule de la boîte, pièces jointes, préférences, agenda intelligent, outils dans la lecture et la rédaction des e-mails, tableau blanc IA, quiz et compte-rendu de réunion, transcription activée par l'hôte, streaming, RGPD.

## 6. Lot 3 — Tableau blanc
Conversations sauvegardées dans le navigateur avec versions restaurables, 6 gabarits de pages et 23 composants (vérifiés visuellement), modification par groupe, images par lien ou depuis l'ordinateur importées par le serveur (SSRF bloqué, SVG refusé, `/wb-media/…`, suppression après 3 jours).

## 7. Lot 4 — Fiabilité, qualité, sécurité
**Fiabilité de l'IA**
- **Modèles de secours** : si le modèle échoue (429, panne, délai, réponse vide), le suivant répond, avant même que l'utilisateur ne s'en aperçoive. Disjoncteur : un modèle en panne 3 fois d'affilée est ignoré 60 s. Les 401 (clé) et 402 (crédits) arrêtent tout immédiatement avec un message clair.
- **Petit modèle** (`OPEN_ROUTER_MODEL_FAST`) pour l'objet, la correction, la traduction et les sous-titres traduits ; le gros modèle reste réservé aux maquettes, résumés, cartes.
- **Écran admin « IA »** : état de la clé et de chaque modèle (coupé automatiquement ou non), bouton « Tester les modèles », **interrupteur** avec message personnalisé, **quota par utilisateur et par jour**, taux d'échec, latence médiane et p95, jetons, appels par heure, usage par utilisateur / fonctionnalité / modèle, causes d'échec, journal d'audit, signalements. Journal d'usage conservé 60 jours.
- **Envoi programmé persistant** : survit aux redémarrages et à la déconnexion. Mot de passe de la boîte, message et pièces jointes **chiffrés au repos** (AES-256-GCM) et **effacés dès l'envoi, l'annulation ou l'abandon**. 3 tentatives espacées de 5 min puis e-mail d'avertissement ; réservation atomique (jamais d'envoi en double) ; reprise des envois interrompus ; 20 envois en attente maximum par compte, 30 jours maximum ; annulation depuis la carte de l'assistant (`DELETE /api/schedule/:id`, liste `GET /api/schedule`).
- **Rappels d'agenda** : `reminderWorker.js` est enfin démarré (il ne l'était nulle part), avec rattrapage de 15 min après un redémarrage et sans rappel pour un événement déjà commencé.

**Qualité**
- `npm run eval:prompts` rejoue 31 demandes types sur le **vrai modèle** (assistant, injections, tableau blanc), avec `--runs 3` (taux de réussite), `--model` (comparer deux modèles), `--baseline ancien.json` (liste les régressions), `--cases` (par ex. les cas signalés par les utilisateurs, téléchargeables depuis l'écran admin). Il n'écrit rien et n'envoie rien : base, messagerie, agenda et contacts sont simulés. **Je n'ai pas pu l'exécuter sur le vrai modèle** (pas d'accès à OpenRouter depuis mon environnement) : seuls le jeu de cas et l'exécuteur sont testés avec un faux modèle.
- **Tests d'injection de prompt** : un modèle simulé qui OBÉIT à l'attaque (message piégé, outils inventés, adresses cachées, liens d'image, effacement) ne peut ni ajouter de destinataire, ni exécuter un outil inconnu, ni effacer le tableau, ni télécharger un lien.
- **Bouton « Signaler une réponse ratée »** sous chaque réponse de l'assistant : l'échange (demande + réponse) est chiffré, conservé 60 jours, relu par l'administrateur, 20 signalements par jour et par personne. L'utilisateur en est informé avant l'envoi.

**Sécurité et vie privée**
- Mention claire que le contenu part chez OpenRouter (accueil de l'assistant et préférences).
- **Durée de conservation des conversations** choisissable (7 j, 30 j, 90 j, 1 an, ou illimitée par défaut) ; purge quotidienne automatique.
- **Journal d'audit** : e-mails envoyés ou programmés (et annulés), événements créés / modifiés / supprimés, contacts, réunions, lectures de messagerie par l'IA, réglages admin. Les actions des cartes sont signalées par le navigateur **après** réussite de l'opération ; les lectures de messagerie sont journalisées côté serveur. Conservé 180 jours.
- RGPD : l'export et la suppression de compte couvrent désormais signalements, audit, usage et envois programmés (fichiers compris).

**Confort et accessibilité**
- **Dictée vocale** dans l'assistant (Chrome, Edge, Safari ; micro autorisé par l'utilisateur).
- Accessibilité de l'assistant : zone de conversation annoncée (`role=log`, sans annoncer chaque morceau pendant l'écriture), conversations atteignables au clavier, fenêtre des préférences avec focus piégé et retour du focus, `Échap`, contours visibles, respect de `prefers-reduced-motion`.
- **Tests automatiques** : `.github/workflows/tests.yml` (GitHub Actions, Node 20 et 22) lance `npm test` à chaque modification ; sinon `npm ci --ignore-scripts && npm test`.

## 8. À savoir
- **Non réalisé dans ce lot** (voir le détail dans la réponse) : transcription serveur sans action des participants (nécessite un service de reconnaissance vocale), maquette vers code, relances / mise en attente / tri des mails, page de rendez-vous partageable, interface en anglais, découpage de `meeting-features.js`, tests Playwright, test sur un vrai téléphone.
- `src/services/mailboxProvision.js` (exécute des scripts `sudo` pour créer ou supprimer des boîtes mail) et `src/services/accountStore.js` (mémorise dans `data/known_accounts.json` les adresses ayant déjà ouvert une session, pour préremplir la page de connexion) ne sont importés nulle part : ces fonctions sont inactives. Je n'y ai pas touché. Le second conserve des adresses de tous les visiteurs : à garder désactivé sauf besoin.
- `npm run check:dead-scripts` renvoie une erreur tant que les 11 fichiers listés ne sont pas archivés (le workflow CI tolère cette étape pour l'instant).
- Quota, interrupteur et journal s'appliquent à **tous** les appels IA (assistant, tableau blanc, réunions, sous-titres, compte-rendu automatique) sans exception.
- Les modèles gratuits varient en qualité : en cas de réponse non conforme, l'assistant garde le texte sans carte, et toutes les cartes sont validées côté serveur.
