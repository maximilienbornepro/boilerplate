## ADDED Requirements

### Requirement: Persistance automatique des adaptations
Le système SHALL sauvegarder automatiquement chaque adaptation générée par l'IA dans une table dédiée `cv_adaptations`, sans modifier le CV de base.

#### Scenario: Adaptation sauvegardée après génération
- **WHEN** l'utilisateur clique "Valider" dans AdaptCVPage
- **THEN** le système crée une entrée `cv_adaptation` liée au CV source avec : contenu adapté, offre d'emploi, score ATS avant/après, changements, date de création
- **THEN** le CV original (`cvs` table) reste inchangé

#### Scenario: Multiples adaptations pour le même CV et la même offre
- **WHEN** l'utilisateur adapte le même CV plusieurs fois pour la même offre
- **THEN** chaque adaptation est conservée comme entrée distincte
- **THEN** aucune adaptation n'écrase une autre

### Requirement: Liste des adaptations par CV
Le système SHALL exposer la liste des adaptations d'un CV donné, triée par date décroissante.

#### Scenario: Consultation de l'historique
- **WHEN** l'utilisateur accède à l'historique d'un CV
- **THEN** le système affiche toutes les adaptations avec : date, aperçu de l'offre (50 premiers caractères), score ATS after, nombre de missions ajoutées

#### Scenario: Aucune adaptation
- **WHEN** un CV n'a aucune adaptation sauvegardée
- **THEN** le système affiche un état vide avec un CTA "Adapter ce CV"

### Requirement: Consultation et édition d'une adaptation
Le système SHALL permettre de consulter le détail d'une adaptation et d'éditer son contenu (missions, projet, compétences générés).

#### Scenario: Affichage du détail
- **WHEN** l'utilisateur ouvre une adaptation
- **THEN** le système affiche le score ATS avant/après, l'offre d'emploi complète, et les sections éditables (missions, projet, compétences)

#### Scenario: Édition et sauvegarde
- **WHEN** l'utilisateur modifie le contenu d'une adaptation et clique "Sauvegarder"
- **THEN** le système met à jour l'entrée `cv_adaptation` avec le nouveau contenu
- **THEN** le CV de base reste inchangé

### Requirement: Téléchargement PDF d'une adaptation
Le système SHALL permettre de télécharger en PDF n'importe quelle adaptation sauvegardée.

#### Scenario: Téléchargement depuis la liste
- **WHEN** l'utilisateur clique "PDF" sur une adaptation dans la liste
- **THEN** le système génère et télécharge le PDF du CV adapté

#### Scenario: Téléchargement depuis le détail
- **WHEN** l'utilisateur clique "Télécharger PDF" dans la page de détail
- **THEN** le système génère et télécharge le PDF de l'adaptation dans son état édité actuel

### Requirement: Suppression d'une adaptation
Le système SHALL permettre de supprimer une adaptation sans affecter le CV de base ni les autres adaptations.

#### Scenario: Suppression avec confirmation
- **WHEN** l'utilisateur demande la suppression d'une adaptation
- **THEN** le système demande une confirmation
- **THEN** si confirmé, supprime uniquement cette adaptation
- **THEN** les autres adaptations du même CV restent intactes
