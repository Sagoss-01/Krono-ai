# Implémentation de l'Authentification OAuth2 (Google / Microsoft)

Ce plan décrit les étapes pour mettre en place le flux d'authentification complet permettant à Krono AI de se connecter de manière sécurisée aux calendriers externes.

## User Review Required

> [!IMPORTANT]
> L'authentification OAuth2 exige que vous possédiez des **clés d'API (Client ID et Client Secret)** pour Google et Microsoft. 
> Ces clés doivent être générées depuis la **Google Cloud Console** et le **Portail Azure (Entra ID)**, puis ajoutées au fichier `.env` du projet.
> 
> De plus, les URI de redirection (Callback URLs) devront être enregistrées exactement telles quelles dans ces consoles (ex: `http://127.0.0.1:8000/calendar/auth/google/callback`).

## Open Questions

> [!WARNING]
> Avez-vous déjà créé ces identifiants sur Google et Microsoft, ou avez-vous besoin d'un guide étape par étape pour les générer avant que je n'implémente le code ?

## Proposed Changes

### Backend - Routes d'authentification
#### [MODIFY] [routes.py](file:///c:/Users/HP/fastapi-langgraph/backend/calendar_sync/routes.py)
Ajout de deux nouveaux endpoints pour gérer le flux standard (Authorization Code Flow) :
- `GET /calendar/auth/{provider}/login` : Redirige l'utilisateur vers la page de consentement Google/Microsoft. Le `user_id` sera passé dans le paramètre `state` de l'URL pour garder le contexte.
- `GET /calendar/auth/{provider}/callback` : Intercepte le code renvoyé par Google/Microsoft, l'échange contre un `access_token` et un `refresh_token`, chiffre ces tokens via `encrypt_token()`, les sauvegarde dans la base PostgreSQL (table `CalendarLink`), et redirige l'utilisateur vers le frontend (`http://localhost:3000`).

### Backend - Fournisseurs
#### [MODIFY] [providers.py](file:///c:/Users/HP/fastapi-langgraph/backend/calendar_sync/providers.py)
- Ajouter les méthodes `get_auth_url(state: str)` et `exchange_code(code: str)` pour `GoogleCalendarProvider` et `OutlookCalendarProvider`.

### Frontend - Connexion utilisateur
#### [MODIFY] [App.jsx](file:///c:/Users/HP/fastapi-langgraph/front/src/App.jsx)
- Modifier la fonction `handleLinkCalendar(provider)` pour qu'elle redirige le navigateur vers `http://127.0.0.1:8000/calendar/auth/{provider}/login?token={jwt}`.
- Ajouter la gestion des retours de succès ou d'échec dans l'URL (ex: `?sync=success`) pour afficher une notification à l'utilisateur après la redirection.

## Verification Plan

### Manual Verification
1. L'utilisateur clique sur le bouton "Google Calendar" dans l'UI.
2. Il est redirigé vers la page de consentement Google.
3. Après validation, il est redirigé vers l'application Krono AI.
4. L'état du lien passe à "Connecté" dans l'interface et le bouton devient "Synchroniser".
5. Les jetons chiffrés sont bien stockés dans PostgreSQL.
