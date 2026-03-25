## Contexte

Portage du module `suivitess` depuis delivery-process. C'est un outil de suivi de sujets structurés en documents/sections/sujets avec versioning par snapshots. On retire Jira et l'IA (Anthropic SDK) pour garder un module standalone.

Le backend source est un fichier monolithique (~1100 lignes). On le restructure en dbService + routes comme les autres modules du boilerplate.

## Objectifs / Hors périmètre

**Objectifs :**
- Documents structurés avec sections et sujets
- Statuts emoji pour les sujets (à faire, en cours, terminé, etc.)
- Snapshots manuels avec restauration complète
- Diff entre état courant et dernier snapshot
- Wizard de revue avec édition inline
- Table des matières avec drag & drop
- Marque blanche, zéro dépendance externe

**Hors périmètre :**
- IA (reformulation, réécriture, résumé) — retirable, ajout futur possible
- Jira (création de tickets)
- Tables legacy (review_sessions, subject_changes, new_subjects)

## Décisions

### 1. Restructuration du backend monolithique
Le fichier `suivitess.ts` de delivery-process (~1100 lignes) est splitté en `dbService.ts` + `routes.ts` + `index.ts`, cohérent avec les patterns congés et roadmap.

### 2. Base de données simplifiée (4 tables au lieu de 7)
On garde uniquement : `suivitess_documents`, `suivitess_sections`, `suivitess_subjects`, `suivitess_snapshots`. Les tables legacy (review_sessions, subject_changes, new_subjects) sont retirées.

### 3. IDs de documents en slug kebab-case
Les documents utilisent un ID dérivé du titre (ex: "Suivi Projet X" → "suivi-projet-x") au lieu d'un UUID. C'est le comportement original.

### 4. Statuts avec emojis
Les statuts de sujets utilisent des emojis : 🔴 à faire, 🟡 en cours, 🔵 en analyse, 🟢 terminé, 🟣 bloqué, 🚀 à déployer.

## Contrats API

### Endpoints

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | /suivitess/api/documents | Liste des documents |
| POST | /suivitess/api/documents | Créer un document |
| GET | /suivitess/api/documents/:docId | Document avec sections et sujets |
| PUT | /suivitess/api/documents/:docId | Modifier un document |
| DELETE | /suivitess/api/documents/:docId | Supprimer (cascade) |
| POST | /suivitess/api/documents/:docId/sections | Ajouter une section |
| POST | /suivitess/api/documents/:docId/sections/reorder | Réordonner les sections |
| PUT | /suivitess/api/sections/:sectionId | Modifier une section |
| DELETE | /suivitess/api/sections/:sectionId | Supprimer (cascade sujets) |
| POST | /suivitess/api/sections/:sectionId/subjects | Ajouter un sujet |
| POST | /suivitess/api/sections/:sectionId/subjects/reorder | Réordonner les sujets |
| PUT | /suivitess/api/subjects/:subjectId | Modifier un sujet |
| DELETE | /suivitess/api/subjects/:subjectId | Supprimer un sujet |
| POST | /suivitess/api/documents/:docId/snapshots | Créer un snapshot |
| GET | /suivitess/api/documents/:docId/snapshots | Liste des snapshots |
| GET | /suivitess/api/snapshots/:snapshotId | Données d'un snapshot |
| POST | /suivitess/api/snapshots/:snapshotId/restore | Restaurer un snapshot |
| GET | /suivitess/api/documents/:docId/diff | Diff courant vs dernier snapshot |

## Diagrammes de séquence

### Charger un document

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as DocumentSelector
    participant A as GET /suivitess/api/documents/:docId
    participant D as Base de données

    U->>F: Sélectionne un document
    F->>A: (credentials: include)
    A->>D: SELECT document + sections + subjects
    D-->>A: document avec sections imbriquées
    A-->>F: DocumentWithSections
    F-->>U: Affiche les sections et sujets
```

### Créer un snapshot

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as HistoryPanel
    participant A as POST /suivitess/api/documents/:docId/snapshots
    participant D as Base de données

    U->>F: Click "Sauvegarder un snapshot"
    F->>A: { type: 'manual' }
    A->>D: SELECT document complet (sections + sujets)
    A->>D: INSERT INTO suivitess_snapshots (snapshot_data JSONB)
    D-->>A: snapshot créé
    A-->>F: 201 { snapshot }
    F-->>U: Toast "Snapshot sauvegardé"
```

### Obtenir le diff

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Preview
    participant A as GET /suivitess/api/documents/:docId/diff
    participant D as Base de données

    U->>F: Ouvre l'onglet "Modifications"
    F->>A: (credentials: include)
    A->>D: SELECT dernier snapshot
    A->>D: SELECT état courant (sections + sujets)
    A->>A: Compare snapshot vs courant
    A-->>F: { hasChanges, changes[], changesCount }
    F-->>U: Affiche la liste des modifications
```

### Restaurer un snapshot

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as HistoryPanel
    participant A as POST /suivitess/api/snapshots/:id/restore
    participant D as Base de données

    U->>F: Click "Restaurer" sur un snapshot
    F-->>U: Confirmation "Restaurer cette version ?"
    U->>F: Confirme
    F->>A: POST
    A->>D: DELETE sections + sujets existants
    A->>D: INSERT sections + sujets depuis snapshot JSONB
    D-->>A: OK
    A-->>F: 200 { success }
    F-->>U: Toast "Version restaurée" + rechargement
```

## Modèle de données

```mermaid
erDiagram
    suivitess_documents ||--o{ suivitess_sections : "contient"
    suivitess_documents ||--o{ suivitess_snapshots : "a des versions"
    suivitess_sections ||--o{ suivitess_subjects : "contient"

    suivitess_documents {
        varchar id PK
        varchar title
        timestamp created_at
        timestamp updated_at
    }

    suivitess_sections {
        uuid id PK
        varchar document_id FK
        varchar name
        int position
        timestamp created_at
        timestamp updated_at
    }

    suivitess_subjects {
        uuid id PK
        uuid section_id FK
        varchar title
        text situation
        varchar status
        varchar responsibility
        int position
        timestamp created_at
        timestamp updated_at
    }

    suivitess_snapshots {
        serial id PK
        varchar document_id FK
        jsonb snapshot_data
        varchar type
        timestamp created_at
    }
```

## Risques / Compromis

- **[Compromis] Pas d'IA** → Les boutons reformuler/réécrire sont retirés. Peut être ajouté plus tard comme capacité optionnelle via env var.
- **[Compromis] Pas de Jira** → Le bouton "Créer ticket Jira" est retiré du SubjectReview.
- **[Risque] Backend monolithique** → Le split en dbService/routes doit préserver toute la logique de diff et snapshot. Porter fidèlement.
