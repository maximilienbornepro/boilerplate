---
name: openspec
description: Workflow OpenSpec - Spec-driven development avec @fission-ai/openspec
invocation: user
---

# OpenSpec - Spec-Driven Development

Ce skill utilise l'outil **@fission-ai/openspec** pour un developpement specification-first.

## ⛔ REGLE DE BLOCAGE ABSOLUE

### AVANT D'ECRIRE DU CODE - VERIFICATIONS OBLIGATOIRES

**Claude DOIT executer ces verifications AVANT tout appel a Write ou Edit sur du code applicatif :**

```bash
# 1. Verifier le mode OpenSpec
MODE=$(cat .claude/config 2>/dev/null | grep OPENSPEC_MODE | cut -d= -f2)
if [ "$MODE" != "off" ]; then
  echo "OpenSpec ACTIF - Verification requise"
fi

# 2. Verifier qu'on n'est PAS sur main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then
  echo "⛔ ERREUR: Sur main - Creer une branche feat/ d'abord"
  exit 1
fi

# 3. Verifier qu'une spec existe
SPEC_DIR=$(ls -d .openspec/changes/*/ 2>/dev/null | head -1)
if [ -z "$SPEC_DIR" ]; then
  echo "⛔ ERREUR: Aucune spec - Utiliser /opsx:propose d'abord"
  exit 1
fi

# 4. Verifier que progress.md existe et phase = implementation
if [ ! -f "${SPEC_DIR}progress.md" ]; then
  echo "⛔ ERREUR: progress.md manquant"
  exit 1
fi

PHASE=$(grep "Current Phase:" ${SPEC_DIR}progress.md | cut -d: -f2 | tr -d ' ')
if [ "$PHASE" != "implementation" ] && [ "$PHASE" != "verification" ]; then
  echo "⛔ ERREUR: Phase '$PHASE' - Pas en implementation"
  exit 1
fi

echo "✅ Verification OK - Code autorise"
```

### COMPORTEMENT EN CAS D'ECHEC

Si les verifications echouent, Claude DOIT :

1. **REFUSER** d'ecrire du code
2. **EXPLIQUER** ce qui manque
3. **PROPOSER** la commande OpenSpec appropriee

**Exemple de reponse :**

```
Je ne peux pas ecrire de code car :
- Nous sommes sur la branche 'main' (interdit)
- Aucune spec OpenSpec n'existe

Pour commencer, utilise :
/opsx:propose "description de ta fonctionnalite"

Cela va :
1. Creer une branche feat/<feature>
2. Generer les fichiers de spec
3. Permettre ensuite l'implementation
```

### EXCEPTIONS (code autorise sans spec)

- Fichiers de configuration (.env, package.json versions)
- Documentation (CLAUDE.md, README.md)
- Corrections de typos dans le code existant
- Hotfix critique en production (avec justification explicite)

---

## REGLES OBLIGATOIRES

### 0. Detection automatique des anomalies

**IMPORTANT** : Si l'utilisateur signale un probleme, bug, ou demande une correction, tu DOIS automatiquement :

1. Detecter qu'il s'agit d'une anomalie (mots cles : "bug", "erreur", "ne marche pas", "corrige", "fix", "probleme", "anomalie", "ca plante", "crash", etc.)
2. Lancer le workflow `/opsx:fix` SANS attendre que l'utilisateur le demande explicitement
3. Creer le change `fix-<slug>` et la branche appropriee

**Exemples de detection :**
- "Le login ne marche pas" → `/opsx:fix "login-broken"`
- "J'ai une erreur sur le formulaire" → `/opsx:fix "form-error"`
- "Corrige le bug de validation" → `/opsx:fix "validation-bug"`
- "Ca plante quand je clique" → `/opsx:fix "click-crash"`

### 1. Creer une branche AVANT tout travail

Quand tu recois `/opsx:propose "description"` :

```bash
# 1. Verifier qu'on n'est pas deja sur une branche feature
git branch --show-current

# 2. Si on est sur main, creer la branche
git checkout -b feat/<feature-slug>
```

Le `<feature-slug>` est derive de la description (kebab-case, max 30 chars).

### 2. Generer des diagrammes de sequence Mermaid (OBLIGATOIRE)

Chaque changement DOIT inclure au moins un diagramme de sequence dans `design.md`.

**Quand generer quoi :**

| Type de changement | Diagrammes requis |
|-------------------|-------------------|
| Module CRUD | 4 sequences : Create, Read, Update, Delete |
| Nouvelle feature | Flux principal + cas d'erreur |
| Integration API externe | Appels sortants + callbacks/webhooks |
| Workflow multi-etapes | Sequence complete avec etats |

**Format obligatoire dans design.md :**

```markdown
## Sequence Diagrams

### Flux principal : <action>

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API
    participant D as Database

    U->>F: Action
    F->>A: POST /api/endpoint
    A->>D: INSERT/SELECT/UPDATE
    D-->>A: result
    A-->>F: 201/200 { data }
    F-->>U: Toast succes
```

### Flux erreur : <cas d'erreur>

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API

    U->>F: Action invalide
    F->>A: POST /api/endpoint
    A-->>F: 400 { error }
    F-->>U: Toast erreur
```
```

**Pour les entites avec statuts, ajouter un diagramme d'etat :**

```markdown
## State Diagram

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> pending: submit
    pending --> approved: approve
    pending --> rejected: reject
    approved --> [*]
    rejected --> draft: revise
```
```

### 3. Persister l'etat dans progress.md

A CHAQUE changement de phase, mettre a jour `.openspec/changes/<feature>/progress.md` :

```markdown
# Progress: <feature-name>

## Metadata
- Branch: feat/<feature-slug>
- Started: 2024-01-15T10:30:00Z
- Current Phase: implementation

## Phases

### [x] Proposal (2024-01-15T10:30:00Z)
- Created proposal.md
- Defined scope and objectives

### [x] Design (2024-01-15T10:45:00Z)
- Architecture decisions documented
- API contracts defined

### [ ] Implementation (in progress)
- Started: 2024-01-15T11:00:00Z
- Tasks completed: 2/5
- Current task: "Creer les routes API"

### [ ] Verification
### [ ] Testing
### [ ] Archive
```

Ce fichier DOIT etre mis a jour a chaque etape pour survivre a la compaction de conversation.

## Workflow Detaille

### /opsx:propose "description"

1. **Verifier le mode OpenSpec**
   ```bash
   cat .claude/config 2>/dev/null | grep OPENSPEC_MODE || echo "on"
   ```

2. **Creer la branche** (si on est sur main)
   ```bash
   FEATURE_SLUG=$(echo "description" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-30)
   git checkout -b feat/$FEATURE_SLUG
   ```

3. **Creer le dossier OpenSpec**
   ```bash
   mkdir -p .openspec/changes/$FEATURE_SLUG
   ```

4. **Generer les fichiers de spec** :
   - `proposal.md` - Description, objectifs, scope
   - `specs/` - Specifications techniques detaillees
   - `design.md` - Decisions d'architecture + **diagrammes Mermaid obligatoires**
   - `tasks.md` - Liste des taches numerotees

5. **Generer les diagrammes dans design.md** :
   - Identifier le type de changement (CRUD, feature, integration, workflow)
   - Generer les diagrammes de sequence appropries
   - Ajouter diagramme d'etat si entite avec statuts

6. **Initialiser progress.md** avec la phase "Proposal" completee

7. **Afficher le resume** et demander validation

### /opsx:fix "description"

Creer un change pour une **anomalie/bug**. Le change est nomme `fix-<slug>`.

1. **Identifier la branche parente**
   ```bash
   PARENT_BRANCH=$(git branch --show-current)
   # Si on est sur main, parent = main
   # Si on est sur feat/user-management, parent = feat/user-management
   ```

2. **Creer la branche fix**
   ```bash
   FIX_SLUG=$(echo "description" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-30)
   # Branche nommee : fix/<parent>--<fix-slug> ou fix/<fix-slug> si parent=main
   if [ "$PARENT_BRANCH" = "main" ]; then
     git checkout -b fix/$FIX_SLUG
   else
     PARENT_SHORT=$(echo "$PARENT_BRANCH" | sed 's/feat\///')
     git checkout -b fix/${PARENT_SHORT}--${FIX_SLUG}
   fi
   ```

3. **Creer le dossier OpenSpec**
   ```bash
   mkdir -p .openspec/changes/fix-$FIX_SLUG
   ```

4. **Generer les fichiers de spec** :
   - `proposal.md` - Description du bug, comportement actuel vs attendu
   - `design.md` - Diagramme du flux bugue + flux corrige
   - `tasks.md` - Etapes de correction

5. **Diagrammes obligatoires pour un fix** :
   - Sequence "Flux actuel (bug)" - ce qui se passe actuellement
   - Sequence "Flux attendu (fix)" - ce qui devrait se passer

6. **Initialiser progress.md** avec :
   - Parent branch reference
   - Type: fix

**Exemple de design.md pour un fix :**

```markdown
# Design: fix-login-validation

## Bug Description

- **Comportement actuel** : Le formulaire accepte des emails invalides
- **Comportement attendu** : Validation email cote client et serveur

## Sequence Diagrams

### Flux actuel (BUG)

```mermaid
sequenceDiagram
    participant U as User
    participant F as LoginForm
    participant A as POST /auth/login

    U->>F: Email "invalid"
    U->>F: Click Login
    F->>A: { email: "invalid" }
    A-->>F: 500 Internal Error
    F-->>U: Erreur incomprehensible
```

### Flux corrige (FIX)

```mermaid
sequenceDiagram
    participant U as User
    participant F as LoginForm
    participant A as POST /auth/login

    U->>F: Email "invalid"
    U->>F: Click Login
    F->>F: Validation regex
    F-->>U: "Email invalide"
```
```

### /opsx:apply

1. **Lire progress.md** pour reprendre le contexte
2. **Lire tasks.md** pour voir les taches restantes
3. **Mettre a jour progress.md** : phase = "Implementation"
4. **Executer les taches** une par une
5. **Mettre a jour progress.md** apres chaque tache completee

### /opsx:verify

1. **Lire progress.md** et les specs

2. **Verifier les diagrammes dans design.md** :
   - Si diagrammes absents → **LES GENERER MAINTENANT**
   - Si diagrammes incomplets → les completer
   - Les diagrammes doivent correspondre a l'implementation reelle

3. **Verifier** que l'implementation correspond aux specs :
   - Code implemente vs tasks.md
   - API contracts respectes
   - Flux correspond aux diagrammes

4. **Mettre a jour progress.md** : phase = "Verification"

5. **Lister** les ecarts trouves ou confirmer la conformite

**IMPORTANT** : Si les diagrammes manquent, ne pas passer a la suite sans les avoir generes. Les diagrammes sont OBLIGATOIRES.

### /opsx:continue

1. **Lire progress.md** pour connaitre l'etat actuel
2. **Reprendre** la ou on en etait
3. Utile apres une compaction de conversation

### /opsx:status

1. **Lire progress.md**
2. **Afficher** un resume de l'etat actuel :
   - Branche courante
   - Phase en cours
   - Taches completees/restantes
   - Derniere activite

### /opsx:archive

1. **Verifier** que les tests passent : `npm test`

2. **Merge vers la branche parente** :
   ```bash
   # Lire la branche parente depuis progress.md
   PARENT=$(grep "Parent Branch:" .openspec/changes/*/progress.md | cut -d: -f2 | tr -d ' ')
   CURRENT=$(git branch --show-current)

   # Merge
   git checkout $PARENT
   git merge $CURRENT --no-ff -m "Merge $CURRENT into $PARENT"
   ```

   | Type | Branche | Merge vers |
   |------|---------|------------|
   | Feature | `feat/user-mgmt` | `main` |
   | Fix sur main | `fix/typo` | `main` |
   | Fix sur feature | `fix/user-mgmt--login` | `feat/user-mgmt` |

3. **Mettre a jour progress.md** : phase = "Archive", status = "completed"

4. **DEMANDER CONFIRMATION** avant de supprimer la branche

   **NE JAMAIS supprimer une branche sans demander a l'utilisateur.**

   ```
   Claude: "La branche feat/xxx a ete mergee. Tu veux que je la supprime ?"
   User: "oui" → git branch -d $CURRENT
   User: "non" → garder la branche
   ```

5. **Optionnel** : deplacer vers `.openspec/archive/`

## Structure des Fichiers

```
.openspec/
├── config.yaml
└── changes/
    ├── <feature-slug>/           # Pour /opsx:propose
    │   ├── proposal.md
    │   ├── specs/
    │   ├── design.md             # Diagrammes OBLIGATOIRES
    │   ├── tasks.md
    │   └── progress.md
    └── fix-<anomalie-slug>/      # Pour /opsx:fix
        ├── proposal.md           # Description bug
        ├── design.md             # Flux bugue + flux corrige
        ├── tasks.md
        └── progress.md
```

## Format de proposal.md

**IMPORTANT** : Bien distinguer ce qui EXISTE de ce qui est A FAIRE et de ce qui est EXCLU.

```markdown
# Proposal: <feature-name>

## Description

<Description claire de la fonctionnalite en 2-3 phrases>

## Objectifs

1. <Objectif 1>
2. <Objectif 2>
3. <Objectif 3>

## Existant (a reutiliser, ne pas modifier)

Elements deja presents dans le codebase qui seront reutilises :

| Element | Fichier/Endpoint | Usage dans cette feature |
|---------|------------------|--------------------------|
| API X | `services/api.ts:fetchX` | Charger les donnees |
| Composant Y | `components/Y/` | Affichage existant |
| Backend Z | `GET /api/z` | Endpoint existant |

> Si rien n'existe, ecrire "Aucun element existant a reutiliser."

## Scope (a implementer)

### Fichiers a creer

| Fichier | Description |
|---------|-------------|
| `components/X/X.tsx` | Composant principal |
| `components/X/X.module.css` | Styles |

### Fichiers a modifier

| Fichier | Modification |
|---------|--------------|
| `App.tsx` | Ajouter routing |
| `Y.tsx` | Ajouter callback |

### Fonctionnalites incluses

- <Fonctionnalite 1>
- <Fonctionnalite 2>
- <Fonctionnalite 3>

## Out of Scope (exclus volontairement)

| Element | Raison de l'exclusion |
|---------|----------------------|
| Feature X | Sera une spec separee |
| Modification Y | Le composant existant suffit |

## Regles UI (checklist obligatoire)

Si la feature inclut une page de detail ou une vue d'element :

- [ ] `ModuleHeader` utilise pour le header (JAMAIS de header custom)
- [ ] Bouton "Retour" dans ModuleHeader via `onBack`
- [ ] Bouton "Modifier" dans ModuleHeader si edition possible
- [ ] Bouton "Embed" dans ModuleHeader si mode embed actif dans le module

> **Rappel** : Tous les boutons d'action DOIVENT etre dans `ModuleHeader`, jamais dans un header custom.

## Criteres d'acceptation

1. <Critere testable 1>
2. <Critere testable 2>
3. Tests unitaires presents
4. `npm test` passe
5. Boutons dans ModuleHeader (pas de header custom)
```

## Format de design.md

```markdown
# Design: <feature-name>

## Architecture Decisions

- Decision 1: [description]
- Decision 2: [description]

## API Contracts

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/items | Creer un item |
| GET | /api/items | Lister les items |
| PUT | /api/items/:id | Modifier un item |
| DELETE | /api/items/:id | Supprimer un item |

### Payloads

```typescript
// Request
interface CreateItemRequest {
  name: string;
  // ...
}

// Response
interface ItemResponse {
  id: number;
  name: string;
  createdAt: string;
}
```

## Sequence Diagrams

### Create Item

```mermaid
sequenceDiagram
    participant U as User
    participant F as ItemForm
    participant A as POST /api/items
    participant D as items table

    U->>F: Remplit formulaire
    U->>F: Click "Creer"
    F->>F: Validation client
    alt Validation echoue
        F-->>U: Erreurs affichees
    else Validation OK
        F->>A: { name, ... }
        A->>A: Validation serveur
        alt Donnees invalides
            A-->>F: 400 { error }
            F-->>U: Toast erreur
        else OK
            A->>D: INSERT INTO items
            D-->>A: item
            A-->>F: 201 { item }
            F-->>U: Toast succes
        end
    end
```

### List Items

```mermaid
sequenceDiagram
    participant U as User
    participant F as ItemList
    participant A as GET /api/items
    participant D as items table

    F->>A: ?page=1&limit=20
    A->>D: SELECT ... LIMIT
    D-->>A: rows
    A-->>F: { items, total }
    F-->>U: Affiche liste
```

### Update Item

```mermaid
sequenceDiagram
    participant U as User
    participant F as ItemForm
    participant A as PUT /api/items/:id
    participant D as items table

    U->>F: Modifie champs
    U->>F: Click "Sauvegarder"
    F->>A: { name, ... }
    A->>D: UPDATE items SET ...
    D-->>A: updated item
    A-->>F: 200 { item }
    F-->>U: Toast succes
```

### Delete Item

```mermaid
sequenceDiagram
    participant U as User
    participant F as ConfirmModal
    participant A as DELETE /api/items/:id
    participant D as items table

    U->>F: Click "Supprimer"
    F-->>U: "Confirmer ?"
    U->>F: Click "Confirmer"
    F->>A: DELETE
    A->>D: DELETE FROM items
    D-->>A: OK
    A-->>F: 204
    F-->>U: Toast succes + refresh
```

## State Diagram (si applicable)

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> pending: submit
    pending --> approved: approve
    pending --> rejected: reject
    approved --> [*]
    rejected --> draft: revise
```

## Data Model

```mermaid
erDiagram
    ITEMS {
        int id PK
        string name
        timestamp created_at
        timestamp updated_at
    }
```
```

## Format de progress.md

```markdown
# Progress: <name>

## Metadata
- Type: feature|fix
- Branch: feat/<slug> | fix/<slug> | fix/<parent>--<slug>
- Parent Branch: main | feat/<parent>    # Pour les fix
- Started: <ISO8601>
- Current Phase: proposal|design|implementation|verification|testing|archive
- Status: in_progress|blocked|completed

## Phases

### [x] Proposal (<timestamp>)
- proposal.md created
- Scope defined

### [x] Design (<timestamp>)
- Architecture decisions documented
- API contracts defined
- Sequence diagrams: X (Create, Read, Update, Delete)
- State diagram: Yes/No
- Data model: Yes/No

### [ ] Implementation
- Started: <timestamp>
- Tasks: X/Y completed
- Current: "<task description>"
- Notes:
  - <any blockers or decisions>

### [ ] Verification
### [ ] Testing
### [ ] Archive

## History
- <timestamp>: <action taken>
- <timestamp>: <action taken>
```

## Reprise apres Compaction

Si la conversation est compactee et tu perds le contexte :

1. **Lire progress.md** en premier
2. **Lire tasks.md** pour les taches
3. **Reprendre** exactement ou tu en etais

Le fichier progress.md est la SOURCE DE VERITE pour l'etat du travail.

## Integration Git

| Commande | Branche creee |
|----------|---------------|
| `/opsx:propose` | `feat/<slug>` depuis main |
| `/opsx:fix` (sur main) | `fix/<slug>` depuis main |
| `/opsx:fix` (sur feat/X) | `fix/X--<slug>` depuis feat/X |

| Phase | Action Git |
|-------|------------|
| propose/fix | `git checkout -b <branch>` |
| apply | commits incrementaux |
| verify | - |
| archive | PR ready, merge vers parent |

**Strategie de branches :**

```
main
├── feat/user-management              # Feature
│   ├── fix/user-management--login    # Fix sur la feature
│   └── fix/user-management--validation
└── fix/typo-readme                   # Fix direct sur main
```

## Checklist par Phase

### Proposal (feature)
- [ ] Branche `feat/<slug>` creee depuis main
- [ ] proposal.md ecrit
- [ ] design.md avec diagrammes Mermaid
- [ ] tasks.md defini
- [ ] progress.md initialise

### Proposal (fix)
- [ ] Branche `fix/...` creee depuis branche parente
- [ ] proposal.md avec description bug (actuel vs attendu)
- [ ] design.md avec flux bugue + flux corrige
- [ ] tasks.md defini
- [ ] progress.md initialise avec parent branch

### Design (dans design.md)
- [ ] Architecture decisions documentees
- [ ] API contracts definis
- [ ] Diagrammes de sequence (OBLIGATOIRE)
- [ ] Diagramme d'etat (si entite avec statuts)
- [ ] Data model (ERD si nouvelle table)

### Design (fix - dans design.md)
- [ ] Diagramme "Flux actuel (BUG)" - OBLIGATOIRE
- [ ] Diagramme "Flux corrige (FIX)" - OBLIGATOIRE

### Implementation
- [ ] Chaque tache = 1 commit
- [ ] Tests ecrits
- [ ] progress.md mis a jour

### Verification
- [ ] Specs respectees
- [ ] Diagrammes correspondent a l'implementation
- [ ] Tests passent
- [ ] Code review ready

### Archive
- [ ] `npm test` passe
- [ ] Documentation a jour
- [ ] PR cree ou merge effectue
- [ ] **Demander confirmation** avant suppression de branche (JAMAIS supprimer sans demander)
