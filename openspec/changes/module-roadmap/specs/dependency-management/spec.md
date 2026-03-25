## Exigences ajoutées

### Exigence : Créer une dépendance
Le système DOIT permettre de créer une dépendance de type finish-to-start entre deux tâches.

#### Scénario : Création par dessin
- **QUAND** l'utilisateur dessine une ligne d'une tâche source à une tâche cible
- **ALORS** la dépendance est créée et une flèche SVG apparaît

#### Scénario : Pas de doublon
- **QUAND** l'utilisateur tente de créer une dépendance qui existe déjà
- **ALORS** le système rejette la requête

### Exigence : Supprimer une dépendance
Le système DOIT permettre de supprimer une dépendance existante.

#### Scénario : Suppression d'une dépendance
- **QUAND** l'utilisateur supprime une dépendance
- **ALORS** la flèche SVG disparaît du Gantt

### Exigence : Endpoints API des dépendances

#### Scénario : GET dépendances d'un planning
- **QUAND** le client envoie `GET /roadmap/api/plannings/:id/dependencies`
- **ALORS** le serveur retourne toutes les dépendances des tâches du planning

#### Scénario : POST créer une dépendance
- **QUAND** le client envoie `POST /roadmap/api/dependencies` avec `{ fromTaskId, toTaskId, type }`
- **ALORS** le serveur crée la dépendance avec un UUID

#### Scénario : DELETE supprimer une dépendance
- **QUAND** le client envoie `DELETE /roadmap/api/dependencies/:id`
- **ALORS** le serveur supprime la dépendance
