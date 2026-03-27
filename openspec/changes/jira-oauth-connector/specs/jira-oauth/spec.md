## Exigences ajoutées

### Exigence : Onglets de mode d'authentification Jira
La carte Jira dans la page Connecteurs DOIT afficher deux onglets : "Token API" (Basic Auth existant) et "OAuth" (nouveau).

#### Scénario : OAuth disponible
- **QUAND** les env vars OAuth sont configurées
- **ALORS** les deux onglets sont affichés

#### Scénario : OAuth non configuré
- **QUAND** les env vars OAuth ne sont pas définies
- **ALORS** seul l'onglet "Token API" est affiché

### Exigence : Flow OAuth 2.0
L'utilisateur DOIT pouvoir se connecter via OAuth Atlassian et obtenir un token automatiquement.

#### Scénario : Initier la connexion
- **QUAND** l'utilisateur clique "Se connecter avec Jira"
- **ALORS** il est redirigé vers l'écran d'autorisation Atlassian

#### Scénario : Callback réussi
- **QUAND** l'utilisateur autorise et revient sur le callback
- **ALORS** les tokens sont stockés et l'utilisateur voit "Connecté"

#### Scénario : Déconnexion OAuth
- **QUAND** l'utilisateur clique "Déconnecter"
- **ALORS** les tokens sont supprimés et jira_linked passe à false

### Exigence : Token refresh automatique
Le backend DOIT rafraîchir automatiquement le token OAuth avant expiration.

#### Scénario : Token expiré
- **QUAND** un appel Jira est fait avec un token proche de l'expiration
- **ALORS** le backend refresh le token et stocke le nouveau en base
