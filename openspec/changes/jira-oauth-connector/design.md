## Contexte

Le boilerplate a une page Connecteurs avec un mode Basic Auth pour Jira. On ajoute un mode OAuth 2.0 (3LO) en portant le code de delivery-process. Les deux modes coexistent via des onglets dans la carte Jira.

## Décisions

### 1. Deux onglets : "Token API" et "OAuth"
L'onglet OAuth n'est affiché que si les env vars `JIRA_OAUTH_CLIENT_ID` et `JIRA_OAUTH_CLIENT_SECRET` sont définies. Sinon seul le mode Basic Auth est disponible.

### 2. Porter jiraAuth.ts depuis delivery-process
Le fichier `jiraAuth.ts` gère le token refresh et le fallback Basic Auth. Porté tel quel avec adaptation des imports.

### 3. Endpoints OAuth dans gateway.ts
Les routes `/api/auth/jira`, `/api/auth/jira/callback`, `/api/auth/jira/status`, `DELETE /api/auth/jira` sont ajoutées au gateway existant.

### 4. Table jira_tokens dans la base app
Ajoutée via migration SQL. Colonne `jira_linked` ajoutée à la table `users`.

## Contrats API

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | /api/auth/jira | Redirige vers Atlassian OAuth consent |
| GET | /api/auth/jira/callback | Callback OAuth — échange code → tokens |
| GET | /api/auth/jira/status | Statut connexion OAuth de l'utilisateur |
| DELETE | /api/auth/jira | Déconnexion OAuth |

## Diagrammes de séquence

### Connexion OAuth Jira

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Page Connecteurs
    participant B as Backend /api/auth/jira
    participant A as Atlassian OAuth
    participant D as Base de données

    U->>F: Click "Se connecter avec Jira"
    F->>B: GET /api/auth/jira
    B->>A: Redirect vers consent screen
    A-->>U: Écran d'autorisation Atlassian
    U->>A: Autorise l'accès
    A->>B: GET /api/auth/jira/callback?code=...
    B->>A: POST token exchange (code → tokens)
    A-->>B: { access_token, refresh_token, expires_in }
    B->>A: GET /oauth/token/accessible-resources
    A-->>B: [{ id: cloud_id, url: site_url }]
    B->>D: INSERT INTO jira_tokens
    B->>D: UPDATE users SET jira_linked = true
    B-->>F: Redirect avec ?jira_connected=1
    F-->>U: "Connecté à Jira via OAuth"
```

## Modèle de données

```mermaid
erDiagram
    users ||--o| jira_tokens : "a un token OAuth"

    jira_tokens {
        int user_id PK,FK
        text access_token
        text refresh_token
        timestamptz expires_at
        text cloud_id
        text site_url
        timestamptz created_at
        timestamptz updated_at
    }
```
