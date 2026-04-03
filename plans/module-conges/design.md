## Contexte

Le boilerplate a une architecture modulaire avec `products` comme module de référence. On porte le module `conges` depuis `delivery-process`, en supprimant toutes les références Jira/marque pour le rendre totalement standalone. Le module source est déjà fonctionnel — c'est une adaptation, pas une construction from scratch.

Les membres sont dérivés de la table `users` du gateway (utilisateurs ayant la permission `conges`). Pas besoin de table membre séparée — uniquement une table de préférences pour la couleur/ordre de tri par utilisateur.

## Objectifs / Hors périmètre

**Objectifs :**
- Module standalone de gestion des congés respectant exactement les patterns du boilerplate
- Vue calendrier avec barres colorées par membre, navigation annuelle, zoom mois/semaine
- Support demi-journée (matin/après-midi)
- Permissions admin vs utilisateur standard (les admins gèrent tout, les utilisateurs gèrent les leurs)
- Marque blanche : zéro référence à delivery-process, france-tv ou toute marque

**Hors périmètre :**
- Workflow d'approbation (les congés sont créés directement, pas d'état "en attente")
- Système de notification par email
- Intégration avec des systèmes RH externes
- Gestion de solde/quota de congés
- Fonctionnalité d'export (CSV, PDF)

## Décisions

### 1. Membres issus du gateway (pas de table séparée)
Les membres sont les utilisateurs ayant la permission `conges` dans `user_permissions`. Le backend requête `users` jointé avec `user_permissions` pour obtenir la liste. Une table `conges_user_preferences` stocke couleur et ordre de tri.

**Justification** : Évite de dupliquer les données utilisateur. Le gateway gère déjà les utilisateurs et permissions. C'est le pattern utilisé dans delivery-process et ça garde le module léger.

### 2. Base de données dans `app` (pas séparée)
Toutes les tables utilisent la base `app` avec le préfixe `conges_`, cohérent avec le fonctionnement de `products` dans le boilerplate.

**Justification** : Le boilerplate utilise une seule base `app`. La version delivery-process utilisait une base `conges` séparée, mais c'était spécifique à leur architecture multi-bases.

### 3. Adaptation des imports de `@delivery-process/shared` vers `@boilerplate/shared`
Tous les imports de composants partagés changent de `@delivery-process/shared/*` vers `@boilerplate/shared/*`. Les composants utilisés (Layout, ModuleHeader, Modal, ConfirmModal, Toast, LoadingSpinner) existent tous dans le package shared du boilerplate.

### 4. Type ViewMode défini localement
La source importe `ViewMode` depuis `@delivery-process/shared/utils`. On définit ce type localement dans `types/index.ts` du module car c'est un simple union type (`'month' | 'week'`).

### 5. CSS utilise les design tokens du boilerplate
Tous les styles utilisent les tokens `var(--*)` de `packages/shared/src/styles/theme.css`. Pas de couleurs en dur. Esthétique terminal (monospace, coins carrés, accent cyan).

## Contrats API

### Endpoints

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | /conges/api/members | Liste des membres (utilisateurs avec permission conges) |
| PUT | /conges/api/members/:id | Modifier les préférences d'un membre (couleur, ordre) |
| GET | /conges/api/leaves?startDate=&endDate= | Congés dans une plage de dates |
| POST | /conges/api/leaves | Créer un congé |
| PUT | /conges/api/leaves/:id | Modifier un congé |
| DELETE | /conges/api/leaves/:id | Supprimer un congé |

### Payloads

```typescript
// Réponse GET /members
interface Member {
  id: number;
  email: string;
  color: string;
  sortOrder: number;
}

// Requête POST /leaves
interface LeaveFormData {
  memberId: number;
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  startPeriod: 'full' | 'morning' | 'afternoon';
  endPeriod: 'full' | 'morning' | 'afternoon';
  reason: string;
}

// Réponse Leave
interface Leave {
  id: string;             // UUID
  memberId: number;
  startDate: string;
  endDate: string;
  startPeriod: 'full' | 'morning' | 'afternoon';
  endPeriod: 'full' | 'morning' | 'afternoon';
  reason: string | null;
  status: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}
```

## Diagrammes de séquence

### Créer un congé

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Formulaire congé
    participant A as POST /conges/api/leaves
    participant D as Table conges_leaves

    U->>F: Remplit formulaire (membre, dates, périodes)
    U->>F: Click "Créer"
    F->>F: Validation client (dates cohérentes)
    alt Validation échoue
        F-->>U: Erreurs affichées
    else Validation OK
        F->>A: { memberId, startDate, endDate, startPeriod, endPeriod, reason }
        A->>A: Validation serveur (startDate <= endDate)
        alt Données invalides
            A-->>F: 400 { error }
            F-->>U: Toast erreur
        else OK
            A->>D: INSERT INTO conges_leaves
            D-->>A: congé créé
            A-->>F: 201 { leave }
            F-->>U: Toast "Congé ajouté"
        end
    end
```

### Charger le calendrier

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Calendrier
    participant A1 as GET /conges/api/members
    participant A2 as GET /conges/api/leaves
    participant D as Base de données

    F->>A1: (credentials: include)
    F->>A2: ?startDate=2025-01-01&endDate=2025-12-31
    A1->>D: SELECT users JOIN user_permissions + conges_user_preferences
    D-->>A1: membres[]
    A2->>D: SELECT FROM conges_leaves WHERE dates chevauchent
    D-->>A2: congés[]
    A1-->>F: membres[]
    A2-->>F: congés[]
    F-->>U: Affiche calendrier avec barres colorées
```

### Modifier un congé

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Formulaire congé
    participant A as PUT /conges/api/leaves/:id
    participant D as Table conges_leaves

    U->>F: Click sur un congé dans le calendrier
    F-->>U: Formulaire pré-rempli
    U->>F: Modifie les champs
    U->>F: Click "Sauvegarder"
    F->>A: { startDate, endDate, startPeriod, endPeriod, reason }
    A->>D: UPDATE conges_leaves SET ... WHERE id = :id
    D-->>A: congé mis à jour
    A-->>F: 200 { leave }
    F-->>U: Toast "Congé modifié"
```

### Supprimer un congé

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Modale de confirmation
    participant A as DELETE /conges/api/leaves/:id
    participant D as Table conges_leaves

    U->>F: Click "Supprimer" dans le formulaire
    F-->>U: "Êtes-vous sûr de vouloir supprimer ce congé ?"
    U->>F: Click "Confirmer"
    F->>A: DELETE
    A->>D: DELETE FROM conges_leaves WHERE id = :id
    D-->>A: OK
    A-->>F: 200 { success: true }
    F-->>U: Toast "Congé supprimé" + rafraîchissement calendrier
```

### Modifier les préférences d'un membre

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as Panel équipe (modale)
    participant A as PUT /conges/api/members/:id
    participant D as conges_user_preferences

    U->>F: Click "Équipe"
    F-->>U: Modale avec liste des membres
    U->>F: Change couleur / ordre d'un membre
    F->>A: { color: "#ff6b6b" }
    A->>D: INSERT ... ON CONFLICT UPDATE
    D-->>A: OK
    A-->>F: 200 { success: true }
    F-->>U: Toast "Préférences mises à jour"
```

## Modèle de données

```mermaid
erDiagram
    users ||--o| conges_user_preferences : "a des préférences"
    users ||--o{ conges_leaves : "a des congés"
    users ||--o{ user_permissions : "a des permissions"

    users {
        int id PK
        string email
        boolean is_admin
    }

    user_permissions {
        int user_id FK
        string app_id
    }

    conges_user_preferences {
        int user_id PK,FK
        string color
        int sort_order
    }

    conges_leaves {
        uuid id PK
        int member_id FK
        date start_date
        date end_date
        string start_period
        string end_period
        text reason
        string status
        int created_by FK
        timestamp created_at
        timestamp updated_at
    }
```

## Risques / Compromis

- **[Risque] Le CSS source peut utiliser des tokens spécifiques à delivery-process** → Auditer tous les fichiers CSS et remplacer par les tokens du boilerplate. Le thème terminal est différent.
- **[Risque] La requête membres dépend du middleware auth du gateway** → Le middleware est déjà disponible et testé. L'objet `req.user` fournit `id`, `email`, `isAdmin`.
- **[Compromis] Pas de workflow d'approbation** → Garde le module simple. Peut être ajouté plus tard comme capacité séparée sans changement cassant.
