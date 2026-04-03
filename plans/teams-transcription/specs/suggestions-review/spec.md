# Spec — suggestions-review

## Comportement

L'utilisateur révise les suggestions IA dans un panneau latéral dédié. Il peut accepter ou rejeter chaque suggestion individuellement. Les suggestions acceptées sont immédiatement appliquées dans le document suivitess.

## Scénarios

### QUAND des suggestions sont disponibles
ALORS un panneau latéral s'ouvre automatiquement avec la liste des suggestions
ET chaque suggestion affiche : type, contenu proposé, rationale IA
ET deux boutons sont disponibles : "Accepter" et "Ignorer"

### QUAND l'utilisateur accepte une suggestion de type "new-subject"
ALORS un nouveau Sujet est créé dans la section cible (ou en fin de document si pas de section précise)
ET la suggestion est masquée (grisée)
ET le document se rafraîchit pour montrer le nouveau sujet

### QUAND l'utilisateur accepte une suggestion de type "update-situation"
ALORS la situation du Sujet existant est complétée avec le contenu proposé
ET la suggestion est masquée

### QUAND l'utilisateur accepte une suggestion de type "new-section"
ALORS une nouvelle Section est créée avec un Sujet initial
ET la suggestion est masquée

### QUAND l'utilisateur rejette une suggestion
ALORS la suggestion est masquée (status=rejected en DB)
ET aucune modification n'est faite au document

### QUAND toutes les suggestions ont été traitées
ALORS le panneau affiche "Toutes les suggestions ont été traitées"
ET un bouton "Fermer" permet de fermer le panneau

## Contraintes

- Les suggestions ne peuvent pas être éditées avant acceptation (accept as-is ou rejeter)
- Une fois acceptée ou rejetée, une suggestion ne peut pas être annulée (V1)
- Le panneau est accessible via un bouton dans le badge de statut (même après fermeture initiale)
