## Exigences ajoutées

### Exigence : Diagramme de Gantt interactif
Le système DOIT afficher un diagramme de Gantt avec une colonne de noms fixe à gauche et une grille timeline scrollable à droite. Les tâches sont rendues sous forme de barres colorées positionnées par dates.

#### Scénario : Chargement du Gantt
- **QUAND** l'utilisateur sélectionne un planning
- **ALORS** le Gantt charge les tâches, dépendances et marqueurs et affiche la timeline

#### Scénario : Scroll synchronisé
- **QUAND** l'utilisateur scroll horizontalement dans la grille
- **ALORS** le header des mois/jours scroll en synchronisation

#### Scénario : Today marker
- **QUAND** le Gantt est affiché et la date du jour est dans la plage visible
- **ALORS** une ligne verticale cyan marque la position du jour actuel

### Exigence : Modes de vue
Le système DOIT supporter trois modes de zoom : Mois (défaut), Trimestre et Année via un sélecteur pill.

#### Scénario : Changement de vue
- **QUAND** l'utilisateur clique sur Mois, Trim. ou Année
- **ALORS** la largeur des colonnes change et les barres se repositionnent

### Exigence : Tâches hiérarchiques
Le Gantt DOIT supporter les tâches parent/enfants avec collapse/expand. Les tâches parent DOIVENT avoir leurs dates calculées automatiquement d'après leurs enfants.

#### Scénario : Collapse d'un parent
- **QUAND** l'utilisateur clique sur le toggle d'un parent
- **ALORS** les enfants sont masqués et le parent reste visible

#### Scénario : Dates parent auto-calculées
- **QUAND** une tâche enfant est modifiée
- **ALORS** les dates du parent s'ajustent pour englober tous les enfants

### Exigence : Drag des tâches
L'utilisateur DOIT pouvoir déplacer une tâche horizontalement par drag & drop pour changer ses dates.

#### Scénario : Drag d'une tâche
- **QUAND** l'utilisateur fait un mousedown sur une barre de tâche et drag horizontalement
- **ALORS** la barre suit le curseur et au mouseup les nouvelles dates sont sauvegardées

### Exigence : Resize des tâches
L'utilisateur DOIT pouvoir redimensionner une tâche en tirant le bord gauche ou droit.

#### Scénario : Resize du bord droit
- **QUAND** l'utilisateur tire le bord droit d'une barre
- **ALORS** la date de fin est ajustée et sauvegardée au relâchement

#### Scénario : Resize du bord gauche
- **QUAND** l'utilisateur tire le bord gauche d'une barre
- **ALORS** la date de début est ajustée et sauvegardée au relâchement

### Exigence : Flèches de dépendances
Les dépendances entre tâches DOIVENT être rendues sous forme de flèches SVG reliant la fin d'une tâche au début d'une autre.

#### Scénario : Affichage des dépendances
- **QUAND** des dépendances existent entre des tâches
- **ALORS** des flèches SVG sont dessinées de la fin de la tâche source au début de la tâche cible

### Exigence : Dessin de dépendances
L'utilisateur DOIT pouvoir créer une dépendance en dessinant une ligne d'une tâche à une autre.

#### Scénario : Dessin d'une dépendance
- **QUAND** l'utilisateur clique sur le connecteur de sortie d'une tâche et drag vers le connecteur d'entrée d'une autre
- **ALORS** la dépendance est créée et la flèche apparaît
