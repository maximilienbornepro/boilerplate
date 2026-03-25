## Exigences ajoutées

### Exigence : Wizard de revue
Le système DOIT fournir un wizard multi-étapes pour la revue d'un document : sélection → édition → prévisualisation.

#### Scénario : Démarrer une revue
- **QUAND** l'utilisateur sélectionne un document
- **ALORS** le wizard passe en mode édition avec les sections et sujets

### Exigence : Édition inline des sujets
L'utilisateur DOIT pouvoir modifier directement les sujets (titre, situation, statut, responsabilité) dans le wizard.

#### Scénario : Modification avec auto-save
- **QUAND** l'utilisateur modifie un champ d'un sujet
- **ALORS** la modification est sauvegardée automatiquement après un délai (debounce 1.5s)

### Exigence : Table des matières
Le wizard DOIT inclure une table des matières navigable avec les sections et sujets.

#### Scénario : Navigation par TOC
- **QUAND** l'utilisateur clique sur un élément de la table des matières
- **ALORS** la vue scroll vers l'élément correspondant

### Exigence : Prévisualisation
Le wizard DOIT permettre de prévisualiser les modifications avant de finaliser.

#### Scénario : Voir les changements
- **QUAND** l'utilisateur passe à l'étape prévisualisation
- **ALORS** les modifications depuis le dernier snapshot sont affichées
