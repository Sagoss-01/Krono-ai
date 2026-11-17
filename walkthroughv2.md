# Intégration d'Alembic pour les Migrations de Base de Données

Les migrations de base de données asynchrones avec **Alembic** ont été configurées avec succès et sont actives sur le projet.

## Résumé des modifications

1. **Alembic Initialisé (Mode Asynchrone)** :
   - Le dossier `alembic/` a été créé avec le template asynchrone adapté pour SQLAlchemy Async/PostgreSQL (`asyncpg`).

2. **Configuration Dynamique (`alembic/env.py`)** :
   - `alembic/env.py` a été configuré pour importer automatiquement les modèles ORM (`User`, `CalendarLink`, `Event`) pour le support de l'autogénération (`--autogenerate`).
   - L'URL de la base de données est lue dynamiquement depuis ton fichier `.env` via `settings.database_url`.

3. **Migration Initiale Générée & Appliquée** :
   - La première version `079bac26e497_initial_migration.py` a été créée.
   - Les tables existantes n'appartenant pas à `krono_user` posaient des problèmes de privilèges pour les modifications DDL. Un script de correction a été exécuté en tâche de fond pour transférer la propriété (OWNER) des tables `users`, `events` et `calendar_links` à `krono_user`.
   - La migration a été appliquée avec succès (`alembic upgrade head`), synchronisant ton schéma physique local (notamment en supprimant les colonnes obsolètes `latitude` et `longitude` de la table `events`).

4. **Nettoyage Backend (`backend/main.py`)** :
   - Retrait de `Base.metadata.create_all` au démarrage de FastAPI. C'est désormais Alembic qui dicte et met à jour le schéma.

## Utilisation future

Lorsque tu ajouteras ou modifieras un modèle ORM dans `backend/models/db_models.py` :

1. **Générer une migration** :
   ```bash
   .venv\Scripts\alembic revision --autogenerate -m "Description de tes changements"
   ```
2. **Appliquer la migration** :
   ```bash
   .venv\Scripts\alembic upgrade head
   ```
3. **Annuler la dernière migration** (si nécessaire) :
   ```bash
   .venv\Scripts\alembic downgrade -1
   ```
