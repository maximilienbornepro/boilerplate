## Pourquoi

La page Connecteurs a actuellement un seul mode de connexion Jira (Basic Auth avec API token). Certains utilisateurs préfèrent OAuth 2.0 (plus sécurisé, pas besoin de gérer un token API manuellement). Il faut supporter les deux modes avec un système d'onglets dans la page Connecteurs.

## Ce qui change

- **Onglets dans la carte Jira** — "Token API" (Basic Auth) et "OAuth" (OAuth 2.0)
- **Backend OAuth** — endpoints pour initier le flow OAuth, callback, status, déconnexion
- **Table `jira_tokens`** — stocke les tokens OAuth par utilisateur (access_token, refresh_token, cloud_id)
- **Token refresh automatique** — rafraîchit le token avant expiration
- **Colonne `jira_linked`** sur la table users — indique si l'utilisateur a un compte Jira lié
- **Variables d'environnement optionnelles** — JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_CALLBACK_URL (si non définies, l'onglet OAuth est masqué)

## Existant (à réutiliser)

| Élément | Source | Usage |
|---------|--------|-------|
| Flow OAuth complet | delivery-process `gateway.ts` lignes 489-738 | Porter fidèlement |
| Token manager | delivery-process `jiraAuth.ts` | Porter fidèlement |
| Table jira_tokens | delivery-process `05_gateway_schema.sql` | Adapter au boilerplate |
| ConnectorsPage | boilerplate existant | Ajouter les onglets |

## Hors scope

| Élément | Raison |
|---------|--------|
| OAuth Notion/ClickUp | Sera fait plus tard |
| Workspace / multi-tenant | Pas dans le boilerplate |

## Impact

- **Backend** : Nouveau module `jiraAuth.ts`, nouveaux endpoints OAuth dans gateway
- **Frontend** : Onglets dans ConnectorsPage pour Jira
- **Base de données** : Table `jira_tokens`, colonne `jira_linked` sur users
