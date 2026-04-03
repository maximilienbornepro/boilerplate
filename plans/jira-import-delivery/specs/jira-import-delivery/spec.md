## ADDED Requirements

### Requirement: Bouton d'import Jira conditionnel
Le système DOIT afficher le bouton "Importer depuis Jira" dans l'en-tête du Delivery Board uniquement si le connecteur Jira est actif (OAuth connecté ou identifiants Basic Auth configurés).

#### Scenario: Jira OAuth connecté
- **QUAND** l'utilisateur ouvre le Delivery Board
- **ET** que `/api/auth/jira/status` retourne `{ connected: true }`
- **ALORS** le bouton "Importer depuis Jira" est visible dans l'en-tête

#### Scenario: Jira Basic Auth configuré mais pas OAuth
- **QUAND** l'utilisateur ouvre le Delivery Board
- **ET** que `/api/auth/jira/status` retourne `{ connected: false }`
- **ET** que `jiraAuth.getJiraContext()` retourne un contexte Basic valide
- **ALORS** le bouton "Importer depuis Jira" est visible

#### Scenario: Aucun connecteur Jira actif
- **QUAND** l'utilisateur ouvre le Delivery Board
- **ET** qu'aucun connecteur Jira n'est configuré
- **ALORS** le bouton "Importer depuis Jira" est absent du DOM

---

### Requirement: Proxy backend vers l'API Jira
Le système DOIT exposer 3 endpoints proxy authentifiés qui relaient les appels vers l'API Jira en utilisant `jiraAuth`.

#### Scenario: Liste des projets Jira
- **QUAND** le frontend appelle `GET /delivery/api/jira/projects`
- **ET** que `jiraAuth.getJiraContext(userId)` retourne un contexte valide
- **ALORS** le backend retourne la liste des projets Jira au format `JiraProject[]`

#### Scenario: Liste des sprints d'un projet
- **QUAND** le frontend appelle `GET /delivery/api/jira/sprints?projectKey=PROJ`
- **ALORS** le backend retourne les sprints actifs et récents du projet au format `JiraSprint[]`

#### Scenario: Liste des tickets des sprints sélectionnés
- **QUAND** le frontend appelle `GET /delivery/api/jira/issues?sprintIds=101,102`
- **ALORS** le backend retourne tous les tickets des sprints au format `JiraIssue[]`

#### Scenario: Aucun contexte Jira disponible
- **QUAND** le frontend appelle un endpoint proxy Jira
- **ET** que `jiraAuth.getJiraContext(userId)` retourne `null`
- **ALORS** le backend retourne `401 { error: "No Jira auth available" }`

---

### Requirement: Modale d'import en 2 étapes
Le système DOIT afficher une modale avec 2 étapes séquentielles : sélection des sprints puis sélection des tickets.

#### Scenario: Étape 1 — Chargement des projets et sprints
- **QUAND** l'utilisateur clique sur "Importer depuis Jira"
- **ALORS** la modale s'ouvre à l'étape 1
- **ET** la liste des projets Jira est chargée automatiquement
- **ET** un indicateur de chargement est affiché pendant le chargement

#### Scenario: Étape 1 — Sélection de sprints
- **QUAND** l'utilisateur sélectionne un projet dans l'étape 1
- **ALORS** les sprints de ce projet sont affichés (actifs en priorité)
- **ET** l'utilisateur peut cocher un ou plusieurs sprints

#### Scenario: Étape 1 — Navigation vers étape 2
- **QUAND** l'utilisateur a sélectionné au moins un sprint
- **ET** clique sur "Suivant"
- **ALORS** la modale passe à l'étape 2

#### Scenario: Étape 2 — Affichage des tickets
- **QUAND** l'étape 2 s'affiche
- **ALORS** tous les tickets des sprints sélectionnés sont listés
- **ET** chaque ticket affiche : clé Jira, titre, statut, assigné, story points
- **ET** chaque ticket est sélectionnable via une case à cocher

#### Scenario: Étape 2 — Retour à l'étape 1
- **QUAND** l'utilisateur clique sur "Retour"
- **ALORS** la modale revient à l'étape 1 avec les sélections conservées

---

### Requirement: Import en masse des tickets sélectionnés
Le système DOIT créer une tâche delivery pour chaque ticket Jira sélectionné.

#### Scenario: Import réussi
- **QUAND** l'utilisateur sélectionne N tickets et clique sur "Importer"
- **ALORS** N tâches sont créées via `POST /delivery/api/tasks`
- **ET** chaque tâche a le statut `todo`
- **ET** le titre de la tâche est `[KEY] summary` (ex: `[PROJ-42] Corriger le bug de login`)
- **ET** une notification "N tickets importés" s'affiche
- **ET** la modale se ferme

#### Scenario: Mapping du type de tâche
- **QUAND** un ticket Jira de type `Bug` est importé
- **ALORS** la tâche delivery est créée avec le type `bug`
- **QUAND** un ticket Jira de type `Story` ou `Epic` est importé
- **ALORS** la tâche delivery est créée avec le type `feature`
- **QUAND** un ticket Jira de type autre est importé
- **ALORS** la tâche delivery est créée avec le type `tech`

#### Scenario: Import sans ticket sélectionné
- **QUAND** l'utilisateur n'a sélectionné aucun ticket
- **ALORS** le bouton "Importer" est désactivé

#### Scenario: Erreur lors de l'import
- **QUAND** un appel `POST /delivery/api/tasks` échoue
- **ALORS** les tickets déjà importés sont conservés
- **ET** un message d'erreur indique le nombre de tickets en échec
