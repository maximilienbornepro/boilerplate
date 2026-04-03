## Exigences ajoutées

### Exigence : Page Connecteurs
Le système DOIT fournir une page de paramètres "Connecteurs" permettant de configurer les connexions aux services externes.

#### Scénario : Accéder aux connecteurs
- **QUAND** l'utilisateur clique sur "Connecteurs" dans la navigation
- **ALORS** la page affiche les connecteurs disponibles (Jira actif, Notion/ClickUp en "Bientôt disponible")

### Exigence : Configurer Jira
L'utilisateur DOIT pouvoir saisir ses credentials Jira (URL, email, API token) dans un formulaire.

#### Scénario : Sauvegarder la configuration
- **QUAND** l'utilisateur remplit les champs et clique "Sauvegarder"
- **ALORS** les credentials sont stockés en base pour cet utilisateur

#### Scénario : Tester la connexion
- **QUAND** l'utilisateur clique "Tester la connexion"
- **ALORS** le backend appelle l'API Jira et retourne le résultat (nom d'utilisateur ou erreur)

#### Scénario : Supprimer la connexion
- **QUAND** l'utilisateur clique "Supprimer"
- **ALORS** les credentials sont supprimés de la base

### Exigence : Sécurité des tokens
Les tokens NE DOIVENT PAS être renvoyés au frontend dans les réponses GET. Ils sont masqués par `***masked***`.

#### Scénario : Lister les connecteurs
- **QUAND** le client envoie GET /api/connectors
- **ALORS** les champs sensibles (apiToken, apiKey) sont masqués dans la réponse
