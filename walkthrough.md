# Mise en place de l'Authentification OAuth2

Le flux d'authentification complet pour **Google Calendar** et **Microsoft Outlook** est désormais intégré au système.

## Résumé des modifications

1. **Fournisseurs (Backend)** :
   - Ajout de `get_auth_url(state)` pour générer l'URL de consentement (Google Cloud Console / Azure Entra ID).
   - Ajout de `exchange_code(code)` pour transformer le code d'autorisation renvoyé en un `access_token` et `refresh_token`.

2. **Routes d'authentification (Backend)** :
   - `GET /calendar/auth/{provider}/login` : Reçoit le JWT du frontend, le décode pour obtenir l'ID de l'utilisateur (le `state`), puis redirige vers l'URL du fournisseur.
   - `GET /calendar/auth/{provider}/callback` : C'est ici que Google/Microsoft vous redirige après le consentement. Le backend enregistre les jetons de façon sécurisée (chiffrement) dans la base PostgreSQL pour l'utilisateur concerné, puis vous redirige vers le tableau de bord.

3. **Interface Utilisateur (Frontend)** :
   - Les boutons de liaison ("Connecter Google" / "Connecter Microsoft") pointent désormais vers le backend.
   - À votre retour sur la page, un toast (notification) confirmera le succès (`?sync=success`) ou l'échec (`?sync=error`) de la liaison.

## Prochaines étapes de votre côté

> [!WARNING]
> Pour que les redirections vers Google/Microsoft fonctionnent réellement sans erreur 400 ou 401, vous **devez absolument** configurer vos identifiants côté serveur.

1. **Générez vos API Keys** (Client ID / Client Secret) sur Google Cloud et Azure.
2. Renseignez-les dans le fichier `.env` à la racine de votre backend :
   ```env
   GOOGLE_CLIENT_ID=votre-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=votre-client-secret
   MICROSOFT_CLIENT_ID=votre-client-id
   MICROSOFT_CLIENT_SECRET=votre-client-secret
   ```
3. **Important** : Dans les paramètres d'OAuth de Google/Microsoft, ajoutez impérativement ces URI de redirection autorisées (Redirect URIs) :
   - `http://127.0.0.1:8000/calendar/auth/google/callback`
   - `http://127.0.0.1:8000/calendar/auth/microsoft/callback`
                                                                                                                                                                                                                                                                                                                                          