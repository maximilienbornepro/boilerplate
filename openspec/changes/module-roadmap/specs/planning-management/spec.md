## Exigences ajoutées

### Exigence : Lister les plannings
Le système DOIT afficher une liste de tous les plannings disponibles.

#### Scénario : Liste des plannings
- **QUAND** l'utilisateur accède au module Roadmap
- **ALORS** la liste des plannings s'affiche avec nom, description et dates

### Exigence : Créer un planning
Le système DOIT permettre de créer un nouveau planning avec nom, description, dates de début et fin.

#### Scénario : Création réussie
- **QUAND** l'utilisateur soumet le formulaire avec des données valides
- **ALORS** le planning est créé et apparaît dans la liste

### Exigence : Modifier un planning
Le système DOIT permettre de modifier le nom, la description et les dates d'un planning existant.

#### Scénario : Modification réussie
- **QUAND** l'utilisateur modifie un planning et sauvegarde
- **ALORS** les modifications sont enregistrées

### Exigence : Supprimer un planning
Le système DOIT permettre de supprimer un planning avec confirmation. La suppression DOIT cascader sur les tâches, dépendances et marqueurs.

#### Scénario : Suppression avec confirmation
- **QUAND** l'utilisateur confirme la suppression
- **ALORS** le planning et tous ses éléments sont supprimés

### Exigence : Sélectionner un planning
Le système DOIT permettre de sélectionner un planning pour l'afficher dans le Gantt.

#### Scénario : Sélection d'un planning
- **QUAND** l'utilisateur clique sur un planning dans la liste
- **ALORS** le Gantt se charge avec les données de ce planning
