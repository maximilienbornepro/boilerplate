# Design: Auto-sync with Boilerplate Before Commit

## Architecture Decision

Ajouter une **regle obligatoire** dans CLAUDE.md pour les projets derives :
- Avant chaque commit, verifier si des updates boilerplate sont disponibles
- Si oui, les appliquer avant de commit

## Workflow

### Sequence: Commit avec sync

```mermaid
sequenceDiagram
    participant D as Developer
    participant C as Claude
    participant G as Git
    participant B as Boilerplate Remote

    D->>C: "Je veux commit"
    C->>G: git fetch boilerplate
    G->>B: fetch main
    B-->>G: updates disponibles?

    alt Updates disponibles
        G-->>C: X commits behind
        C->>D: "Updates boilerplate disponibles"
        D->>C: "Sync d'abord"
        C->>G: git merge boilerplate/main
        G-->>C: merged
        C->>D: "Sync OK, je commit"
    else Pas d'updates
        G-->>C: up to date
        C->>D: "Boilerplate a jour, je commit"
    end

    C->>G: git add + commit
    G-->>C: committed
    C->>D: "Commit effectue"
```

### Sequence: Conflit lors du sync

```mermaid
sequenceDiagram
    participant D as Developer
    participant C as Claude
    participant G as Git

    C->>G: git merge boilerplate/main
    G-->>C: CONFLICT
    C->>D: "Conflits detectes"
    C->>C: Resoudre conflits
    C->>G: git add resolved files
    C->>G: git commit
    G-->>C: merge complete
    C->>D: "Conflits resolus, pret a commit"
```

## Implementation

### Option 1: Instruction dans CLAUDE.md (Recommande)

Ajouter une section "Projets Derives" dans CLAUDE.md avec la regle de sync.

### Option 2: Skill dedie

Creer un skill `sync-check` qui est appele automatiquement avant commit.

**Decision**: Option 1 - Plus simple, pas besoin de skill supplementaire.

### Sequence: Archive/Validate avec merge automatique

```mermaid
sequenceDiagram
    participant D as Developer
    participant C as Claude
    participant G as Git
    participant T as Tests

    D->>C: /opsx:archive (ou /opsx:validate)
    C->>T: npm test
    T-->>C: Tests OK

    C->>G: git checkout main
    C->>G: git merge feat/xxx --no-ff
    G-->>C: merged

    C->>G: git push origin main
    G-->>C: pushed

    C->>G: git branch -d feat/xxx
    G-->>C: branch deleted

    C->>C: Update progress.md (status=completed)
    C->>D: "Feature mergee sur main et pushee"
```

## Changes Required

1. CLAUDE.md : Ajouter section "Projets Derives - Sync Obligatoire"
2. OpenSpec skill : Confirmer que `/opsx:archive` merge automatiquement sur parent (deja fait)
