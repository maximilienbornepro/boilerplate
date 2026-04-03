## Contexte

Les utilisateurs doivent pouvoir connecter des services externes (Jira, Notion, ClickUp) sans avoir accès aux fichiers de configuration serveur. La configuration se fait via l'UI et est stockée par utilisateur en base.

## Décisions

### 1. Credentials stockés en JSONB par utilisateur
Chaque connecteur a un champ `config JSONB` flexible qui stocke les champs spécifiques au service. Pour Jira : `{ baseUrl, email, apiToken }`.

### 2. Pas de chiffrement des tokens pour le moment
Même approche que delivery-process — les tokens sont stockés en clair en DB. Le chiffrement peut être ajouté plus tard.

### 3. Test de connexion côté serveur
Le backend fait un appel `GET /rest/api/3/myself` à l'API Jira avec Basic Auth pour vérifier les credentials.

### 4. Sanitization des réponses
L'API masque les tokens dans les réponses GET (remplacé par `***masked***`) pour ne jamais envoyer les secrets au frontend inutilement.

## Contrats API

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | /api/connectors | Liste des connecteurs de l'utilisateur (tokens masqués) |
| PUT | /api/connectors/:service | Créer/modifier un connecteur |
| DELETE | /api/connectors/:service | Supprimer un connecteur |
| POST | /api/connectors/:service/test | Tester la connexion |

## Diagrammes de séquence

### Configurer Jira

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Page Connecteurs
    participant A as PUT /api/connectors/jira
    participant D as Table user_connectors

    U->>F: Remplit URL, email, API token
    U->>F: Click "Sauvegarder"
    F->>A: { config: { baseUrl, email, apiToken } }
    A->>D: INSERT ... ON CONFLICT UPDATE
    D-->>A: connecteur sauvé
    A-->>F: 200 { success }
    F-->>U: Toast "Configuration sauvegardée"
```

### Tester la connexion Jira

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Page Connecteurs
    participant A as POST /api/connectors/jira/test
    participant J as API Jira

    U->>F: Click "Tester"
    F->>A: POST
    A->>D: SELECT config FROM user_connectors
    A->>J: GET /rest/api/3/myself (Basic Auth)
    alt Succès
        J-->>A: { displayName, accountId }
        A-->>F: { success: true, displayName }
        F-->>U: "Connecté en tant que [displayName]"
    else Échec
        J-->>A: 401 / timeout
        A-->>F: { success: false, error }
        F-->>U: Message d'erreur
    end
```

## Modèle de données

```mermaid
erDiagram
    users ||--o{ user_connectors : "a des connecteurs"

    user_connectors {
        serial id PK
        int user_id FK
        varchar service
        jsonb config
        boolean is_active
        timestamp last_tested_at
        timestamp created_at
        timestamp updated_at
    }
```
