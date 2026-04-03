## 1. Base de données

- [ ] 1.1 Créer migration : table `jira_tokens` + colonne `jira_linked` sur users

## 2. Backend

- [ ] 2.1 Porter `jiraAuth.ts` depuis delivery-process (token manager avec refresh)
- [ ] 2.2 Ajouter endpoints OAuth dans gateway.ts (GET /jira, GET /jira/callback, GET /jira/status, DELETE /jira)
- [ ] 2.3 Ajouter config jira.oauth dans config.ts (clientId, clientSecret, redirectUri)
- [ ] 2.4 Ajouter endpoint GET /api/connectors/jira/oauth-available pour que le frontend sache si OAuth est configuré

## 3. Frontend

- [ ] 3.1 Modifier ConnectorsPage — ajouter onglets "Token API" / "OAuth" dans la carte Jira
- [ ] 3.2 Onglet OAuth : bouton "Se connecter avec Jira", statut, bouton déconnecter
- [ ] 3.3 Détecter ?jira_connected=1 dans l'URL pour afficher un message de succès

## 4. Tests

- [ ] 4.1 Tests backend OAuth (config validation, token format)
- [ ] 4.2 `npm test` passe
