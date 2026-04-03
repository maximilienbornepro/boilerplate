## Exigences ajoutées

### Exigence : CRUD documents
Le système DOIT permettre de créer, lire, modifier et supprimer des documents. L'ID est un slug kebab-case dérivé du titre.

#### Scénario : Créer un document
- **QUAND** l'utilisateur crée un document avec un titre
- **ALORS** le document est créé avec un ID slug et apparaît dans la liste

#### Scénario : Supprimer un document
- **QUAND** l'utilisateur supprime un document
- **ALORS** toutes les sections, sujets et snapshots associés sont supprimés en cascade

### Exigence : Sections avec réordonnement
Le système DOIT supporter des sections ordonnées dans un document avec drag & drop pour réordonner.

#### Scénario : Ajouter une section
- **QUAND** l'utilisateur ajoute une section
- **ALORS** la section est créée à la dernière position

#### Scénario : Réordonner les sections
- **QUAND** l'utilisateur drag & drop une section
- **ALORS** les positions sont recalculées

### Exigence : Sujets avec statuts emoji
Chaque sujet DOIT avoir un titre, une situation (texte), un statut (emoji), une responsabilité et une position.

#### Scénario : Créer un sujet
- **QUAND** l'utilisateur ajoute un sujet dans une section
- **ALORS** le sujet est créé avec le statut par défaut "🔴 à faire"

#### Scénario : Modifier le statut
- **QUAND** l'utilisateur change le statut d'un sujet
- **ALORS** le nouveau statut emoji est sauvegardé

#### Scénario : Déplacer un sujet entre sections
- **QUAND** l'utilisateur déplace un sujet vers une autre section
- **ALORS** le sujet change de section_id et sa position est mise à jour
