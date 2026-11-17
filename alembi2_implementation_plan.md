# Mise en place d'Alembic pour les Migrations de Base de Données

Ce plan détaille la mise en place d'Alembic pour gérer les migrations de base de données PostgreSQL de manière robuste et sécurisée.

## User Review Required

> [!IMPORTANT]
> Pour que les migrations s'appliquent correctement sans détruire de données existantes dans ta base PostgreSQL locale :
> 
> 1. Nous allons initialiser Alembic en mode asynchrone (nécessaire pour `asyncpg`).
> 2. Nous allons générer une migration initiale correspondant aux tables actuelles (`users`, `events`, `calendar_links`).
> 3. Nous allons marquer la base actuelle comme à jour (via `alembic stamp head`) pour éviter qu'Alembic ne tente de recréer les tables existantes.
> 4. À l'avenir, toutes les modifications sur les modèles SQLAlchemy (`db_models.py`) devront passer par `alembic revision --autogenerate` puis `alembic upgrade head`.

## Proposed Changes

### Configuration d'Alembic
1. **Installation** : Installer le package `alembic` dans le venv.
2. **Initialisation** : Lancer `alembic init -t async alembic` pour créer le dossier et les scripts de configuration.

#### [MODIFY] [alembic.ini](file:///c:/Users/HP/fastapi-langgraph/alembic.ini) (Fichier généré)
- Configurer l'URL de base de données générique (la valeur réelle sera surchargée dynamiquement dans `env.py` pour lire le fichier `.env`).

#### [MODIFY] [alembic/env.py](file:///c:/Users/HP/fastapi-langgraph/alembic/env.py) (Fichier généré)
- Importer `Base` depuis `backend.database` et tous les modèles de `backend.models.db_models` pour que l'autogénération détecte les tables.
- Remplacer l'URL de connexion par `settings.database_url` (importé de `backend.config`).
- Assurer le bon fonctionnement asynchrone avec PostgreSQL.

### Code Applicatif
#### [MODIFY] [main.py](file:///c:/Users/HP/fastapi-langgraph/backend/main.py)
- Retirer ou commenter la ligne `await conn.run_sync(Base.metadata.create_all)` au démarrage, car les tables seront désormais gérées par Alembic.

## Verification Plan

### Automated & Command Line Tests
1. **Initialisation de la base existante** :
   ```bash
   alembic revision --autogenerate -m "Initial migration"
   alembic stamp head
   ```
   *(Puisqu'on a déjà des tables, `stamp head` dit à Alembic qu'elles existent déjà).*
2. **Test de modification de schéma** :
   Ajouter temporairement un champ test dans un modèle, lancer `alembic revision --autogenerate -m "Add test column"`, vérifier que le fichier de migration généré contient bien l'ajout de colonne, puis appliquer avec `alembic upgrade head`. Annuler le test avec `alembic downgrade -1`.
