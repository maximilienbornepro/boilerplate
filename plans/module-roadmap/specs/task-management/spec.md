## Exigences ajoutées

### Exigence : Créer une tâche
Le système DOIT permettre de créer une tâche avec nom, dates, couleur, parent optionnel et planning associé.

#### Scénario : Création d'une tâche racine
- **QUAND** l'utilisateur crée une tâche sans parent
- **ALORS** la tâche apparaît au premier niveau dans le Gantt

#### Scénario : Création d'une sous-tâche
- **QUAND** l'utilisateur crée une tâche avec un parent
- **ALORS** la tâche apparaît indentée sous son parent

### Exigence : Modifier une tâche
Le système DOIT permettre de modifier le nom, les dates, la couleur, la progression et le parent.

#### Scénario : Modification via formulaire
- **QUAND** l'utilisateur double-clique sur une tâche
- **ALORS** le formulaire d'édition s'ouvre pré-rempli

#### Scénario : Modification via drag/resize
- **QUAND** l'utilisateur déplace ou redimensionne une barre
- **ALORS** les dates sont mises à jour automatiquement

### Exigence : Supprimer une tâche
Le système DOIT permettre de supprimer une tâche. Les sous-tâches et dépendances associées DOIVENT être supprimées en cascade.

#### Scénario : Suppression avec cascade
- **QUAND** l'utilisateur supprime une tâche parent
- **ALORS** toutes les sous-tâches et dépendances associées sont supprimées

### Exigence : Couleurs de tâches
Chaque tâche DOIT avoir une couleur personnalisable. Un ensemble de couleurs par défaut DOIT être disponible.

#### Scénario : Couleur par défaut
- **QUAND** une tâche est créée sans couleur spécifiée
- **ALORS** la prochaine couleur de la palette par défaut est attribuée

### Exigence : Endpoints API des tâches

#### Scénario : GET tâches d'un planning
- **QUAND** le client envoie `GET /roadmap/api/plannings/:id/tasks`
- **ALORS** le serveur retourne toutes les tâches du planning triées par sort_order

#### Scénario : POST créer une tâche
- **QUAND** le client envoie `POST /roadmap/api/tasks` avec des données valides
- **ALORS** le serveur crée la tâche et retourne l'objet avec UUID

#### Scénario : PUT modifier une tâche
- **QUAND** le client envoie `PUT /roadmap/api/tasks/:id`
- **ALORS** le serveur met à jour les champs fournis

#### Scénario : DELETE supprimer une tâche
- **QUAND** le client envoie `DELETE /roadmap/api/tasks/:id`
- **ALORS** le serveur supprime la tâche et ses sous-tâches/dépendances en cascade
