# Implémentation du Mode Offline-First (PWA & Dexie.js)

Ce plan décrit les étapes pour rendre l'application Krono AI fonctionnelle hors-ligne (Offline-First) grâce à IndexedDB (via `Dexie.js`) et un Service Worker (PWA).

## User Review Required

> [!NOTE]
> - L'application sera installable sur mobile et ordinateur grâce au `manifest.json`.
> - Quand l'utilisateur est hors-ligne :
>   - Les créations, modifications et suppressions d'événements sont appliquées **immédiatement dans l'interface** (IndexedDB).
>   - Ces actions sont empilées dans une table de mutations en attente (`offline_mutations`).
> - Dès que l'application détecte le retour du réseau (évènement `online`), un worker de synchronisation envoie automatiquement toutes les mutations en attente vers le backend PostgreSQL et rafraîchit le calendrier.

## Proposed Changes

### 1. Stockage Local (IndexedDB / Dexie)
#### [MODIFY] [db.js](file:///c:/Users/HP/fastapi-langgraph/front/src/db.js)
- Ajouter une table `offline_mutations` avec le schéma suivant : `++id, type, targetId, data, timestamp`.
  - `type` : `'create' | 'update' | 'delete'`
  - `targetId` : UUID de l'événement concerné
  - `data` : Corps de l'événement (pour création/modification)

### 2. Gestion des mutations hors-ligne et synchronisation
#### [MODIFY] [App.jsx](file:///c:/Users/HP/fastapi-langgraph/front/src/App.jsx)
- **Création d'événement (`handleCreateEvent`)** :
  - Si hors-ligne, générer un UUID temporaire en JS, insérer l'événement dans `db.events`, ajouter une mutation `'create'` dans `db.offline_mutations`, et fermer le modal.
- **Modification d'événement (`handleSaveEditEvent`)** :
  - Si hors-ligne, mettre à jour l'événement directement dans `db.events`, ajouter une mutation `'update'` dans `db.offline_mutations`, et fermer le modal.
- **Suppression d'événement (`handleDeleteEvent`)** :
  - Si hors-ligne, supprimer l'événement de `db.events`, ajouter une mutation `'delete'` dans `db.offline_mutations`, et fermer le modal.
- **Synchronisation automatique (`syncOfflineMutations`)** :
  - Fonction qui boucle sur `db.offline_mutations`, joue les requêtes API correspondantes dans l'ordre chronologique, puis nettoie la table.
  - Déclencher cette fonction au chargement initial de l'application (si réseau disponible) et à l'instant où l'application repasse en ligne via l'écouteur d'évènement `online`.

### 3. Service Worker & Manifeste PWA
#### [NEW] [sw.js](file:///c:/Users/HP/fastapi-langgraph/front/public/sw.js)
- Mettre en place un Service Worker classique avec stratégie de cache :
  - **Cache-first** pour les assets statiques (HTML, CSS, JS, Fonts).
  - **Network-first** (avec fallback sur le cache IndexedDB) pour les appels d'API.
- Gérer l'activation et la mise à jour automatique.

#### [NEW] [manifest.json](file:///c:/Users/HP/fastapi-langgraph/front/public/manifest.json)
- Configurer le manifeste de l'application pour qu'elle soit détectée comme PWA installable (icônes, couleur de thème, mode `standalone`).

#### [MODIFY] [index.html](file:///c:/Users/HP/fastapi-langgraph/front/index.html)
- Lier le `manifest.json`.
- Enregistrer le Service Worker `sw.js` via un script JS standard.

## Verification Plan

### Manual Verification
1. **Mode Hors-ligne (Simulation)** :
   - Désactiver le réseau dans l'onglet Application/Réseau de Chrome.
   - Ajouter un événement "Test Offline". Vérifier qu'il apparaît immédiatement dans le calendrier.
   - Éditer cet événement, puis en supprimer un autre.
   - Inspecter IndexedDB (`KronoAIDatabase`) et vérifier la présence des 3 mutations dans `offline_mutations`.
2. **Synchronisation** :
   - Réactiver le réseau.
   - Vérifier que les requêtes API partent vers le backend (`POST`, `PUT`, `DELETE`).
   - Vérifier que la table `offline_mutations` est vidée et que la base PostgreSQL est bien à jour.
3. **Installabilité PWA** :
   - Vérifier dans Chrome que l'icône d'installation de l'application (petite icône d'écran dans la barre d'adresse) est bien visible.
