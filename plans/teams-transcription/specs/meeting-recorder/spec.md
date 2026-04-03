# Spec — meeting-recorder

## Comportement

L'utilisateur peut démarrer l'enregistrement d'un call Teams depuis un document suivitess. Un agent Puppeteer rejoint le call de façon autonome et collecte la transcription via les sous-titres en direct.

## Scénarios

### QUAND l'utilisateur colle un lien Teams valide et clique "Enregistrer"
ALORS l'agent démarre et tente de rejoindre le meeting
ET le badge de statut passe à "En attente d'admission..."
ET le bouton "Enregistrer" est désactivé (un seul agent par document)

### QUAND l'agent rejoint le call avec succès
ALORS le statut passe à "En cours d'enregistrement"
ET le badge affiche le nombre de répliques capturées (mis à jour toutes les 10s)

### QUAND l'utilisateur clique "Arrêter"
ALORS l'agent quitte le call proprement
ET le traitement post-call démarre immédiatement

### QUAND le call se termine naturellement
ALORS l'agent détecte la fin du call et se déconnecte
ET le traitement post-call démarre automatiquement

### QUAND l'agent ne peut pas rejoindre après 5 minutes
ALORS le statut passe à "Erreur — l'agent n'a pas pu rejoindre"
ET l'utilisateur peut réessayer avec un nouveau lien

### QUAND le lien Teams est invalide ou expiré
ALORS le backend rejette la requête avec un message d'erreur
ET aucun agent n'est démarré

## Contraintes

- Un seul agent actif par document à la fois
- L'agent ne peut pas rejoindre les réunions qui bloquent les participants anonymes sans compte
- Les sous-titres Teams doivent être disponibles dans le meeting
- Timeout de rejointe : 5 minutes
- La transcription est perdue si le serveur redémarre pendant un call (V1, pas de persistance temps réel)
