# Skills IA — documentation

Ce document décrit **tous les skills IA** du boilerplate : à quoi ils servent, comment
ils s'enchaînent, où ils sont invoqués, comment les éditer.

Source de vérité pour le code : [`registry.ts`](./registry.ts).

---

## Vue d'ensemble

Un **skill** est le prompt système (texte en markdown) envoyé à l'IA pour une tâche
précise. Chaque skill :

- Est défini par un **slug stable** (ex : `suivitess-extract-transcript`) — ne jamais
  renommer après déploiement, sinon les logs historiques perdent leur lien.
- A un **contenu par défaut** dans un fichier `.md` à côté du code, et un **contenu
  courant** stocké en DB (`ai_skills`) éditable via **Admin → AI Skills**.
- Est exécuté via `runSkill()` (tracing, versioning, pricing, cache Anthropic,
  logging dans `ai_analysis_logs`).

Les skills sont groupés en **3 catégories** :

| Catégorie | Nb | Rôle |
|---|---|---|
| **Pipeline modulaire** (actif) | 7 | 3 tiers qui se chaînent pour analyser une source et proposer des changements dans un suivitess |
| **Skills autonomes** | 2 | Invoqués directement depuis une action UI (bouton reformuler, bouton réorganiser board) |
| **Scorers** | 1 | Évalue la qualité d'un autre output IA (pour /ai-evals) |
| **Legacy** (plus appelés) | 2 | Anciens monolithes conservés pour la navigation dans les vieux logs |

**Total : 12 skills.**

---

## Pipeline modulaire (7 skills)

Le pipeline est la **seule voie runtime** pour toute analyse d'une source (transcription,
Slack, email) dans suivitess. Il a remplacé les skills monolithiques `suivitess-import-
source-into-document` et `suivitess-route-source-to-review` (voir [Legacy](#legacy-2-skills)).

### Architecture

```
┌─ Tier 1 — ADAPTERS (1 appel, selon la source) ──────────────────────┐
│  • suivitess-extract-transcript   (Fathom / Otter)                   │
│  • suivitess-extract-slack        (threads, mentions, réactions)     │
│  • suivitess-extract-outlook      (Outlook / Gmail chains)           │
│  Output uniforme : Subject[] avec rawQuotes (citations textuelles)   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Tier 2 — PLACEMENT (1 appel, selon le contexte) ───────────────────┐
│  • suivitess-place-in-document   (import dans UN suivitess ouvert)   │
│  • suivitess-place-in-reviews    (routage multi-review, page listing)│
│  Décide enrich / create_subject / create_section pour chaque sujet.  │
│  NE RÉDIGE RIEN — produit uniquement des décisions de placement.     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Tier 3 — WRITERS (N appels EN PARALLÈLE, un par placement) ────────┐
│  • suivitess-append-situation    (rédige appendText pour enrich)     │
│  • suivitess-compose-situation   (rédige situation pour create_*)    │
│  Strict : uniquement à partir des rawQuotes capturées en Tier 1.     │
│  Aucune invention possible — c'est ce qui élimine les hallucinations.│
└──────────────────────────────────────────────────────────────────────┘
```

### Contrats entre tiers

**Tier 1 → Tier 2** : `ExtractedSubject[]`
```ts
{
  index: number;              // ordre d'arrivée
  title: string;              // titre court
  rawQuotes: string[];        // citations textuelles (≤ 150 chars chacune)
  participants: string[];     // qui a parlé
  entities: string[];         // projets, features, chiffres
  statusHint: string | null;  // 🔴 à faire / 🟡 en cours / ...
  responsibilityHint: string | null;
  confidence: 'high' | 'medium' | 'low';
}
```

**Tier 2 → Tier 3** : `DocumentPlacement[]` ou `ReviewPlacement[]` (selon la variante)
```ts
// DocumentPlacement (place-in-document)
{
  subjectIndex: number;       // pointe vers Subject[] du T1
  action: 'enrich' | 'create_subject' | 'create_section';
  targetSubjectId?: string;   // si enrich
  sectionId?: string;
  suggestedNewSectionName?: string;
  reason: string;
}
```

**Tier 3 → UI** : `{ appendText: string | null }` (append) ou `{ situation: string }` (compose)

### Endpoints qui déclenchent le pipeline

| Endpoint backend | Trigger UI | Pipeline |
|---|---|---|
| `POST /suivitess/api/documents/:docId/transcript-analyze-and-propose` | TranscriptionWizard → « Analyser et fusionner » | extract-transcript → place-in-document → append/compose |
| `POST /suivitess/api/documents/:docId/content-analyze-and-propose` | TranscriptionWizard (Slack/Outlook) | extract-slack OR extract-outlook → place-in-document → append/compose |
| `POST /suivitess/api/transcription/analyze-and-route` | BulkTranscriptionImportModal (page listing) | extract-* → place-in-reviews → append/compose |

### Observabilité

Chaque appel de tier produit **un log séparé** dans `ai_analysis_logs`, chaînés via
`parent_log_id`. Dans `/ai-logs` tu peux naviguer l'arbre :

```
▼ log #501  extract-transcript  (2.45s)
  ▼ log #502  place-in-document  (3.10s)
    ├─ log #503  append-situation  (1.80s)  ← proposition #1
    ├─ log #504  append-situation  (1.95s)  ← proposition #2
    └─ log #505  compose-situation (1.50s)  ← proposition #3
```

Dans les logs serveur, une ligne de synthèse par run du pipeline :

```
[pipeline:summary] (document) T1=2.45s (2450ms) · T2=3.10s (3100ms) ·
T3=2.30s (2300ms) (5 writers in //) · TOTAL=7.85s (7850ms) ·
final=4/5 proposals
```

### Détail des 7 skills

| Slug | Tier | Rôle | Fichier |
|---|---|---|---|
| `suivitess-extract-transcript` | 1 | Extraire sujets atomiques d'une transcription Fathom/Otter | [extract-transcript.md](../apps/platform/servers/unified/src/prompts/suivitess/extract-transcript.md) |
| `suivitess-extract-slack` | 1 | Extraire sujets d'un digest Slack (threads, réactions) | [extract-slack.md](../apps/platform/servers/unified/src/prompts/suivitess/extract-slack.md) |
| `suivitess-extract-outlook` | 1 | Extraire sujets d'une chaîne d'emails | [extract-outlook.md](../apps/platform/servers/unified/src/prompts/suivitess/extract-outlook.md) |
| `suivitess-place-in-document` | 2 | Décider enrich/create dans un suivitess ouvert | [place-in-document.md](../apps/platform/servers/unified/src/prompts/suivitess/place-in-document.md) |
| `suivitess-place-in-reviews` | 2 | Router vers la bonne review + section (multi-review) | [place-in-reviews.md](../apps/platform/servers/unified/src/prompts/suivitess/place-in-reviews.md) |
| `suivitess-append-situation` | 3 | Rédiger `appendText` à concaténer (enrich) | [append-situation.md](../apps/platform/servers/unified/src/prompts/suivitess/append-situation.md) |
| `suivitess-compose-situation` | 3 | Rédiger `situation` d'un nouveau sujet | [compose-situation.md](../apps/platform/servers/unified/src/prompts/suivitess/compose-situation.md) |

---

## Skills autonomes (2 skills)

Invoqués **directement** depuis une action UI, pas dans un pipeline.

### `suivitess-reformulate-subject`

- **Rôle** : reformule le titre et la situation d'un sujet pour plus de clarté, sans
  rien supprimer ni changer le sens.
- **Trigger UI** : bouton « Reformuler avec l'IA » sur un sujet.
- **Endpoint** : `POST /suivitess/api/subjects/:id/reformulate`
- **Fichier** : [reformulate-subject.md](../apps/platform/servers/unified/src/prompts/suivitess/reformulate-subject.md)
- **Output JSON** : `{ title, situation }`

### `delivery-reorganize-board`

- **Rôle** : analyse un delivery board et propose un plan de réorganisation colonne par
  colonne selon statut, estimation et version fix des tickets externes (Jira, ClickUp,
  Linear, …).
- **Trigger UI** : bouton « Vérifier avec l'IA » sur un delivery board.
- **Endpoint** : `POST /delivery/api/boards/:id/ai-sanity-check`
- **Fichier** : [reorganize-board.md](../apps/platform/servers/unified/src/prompts/delivery/legacy/reorganize-board.md) (LEGACY)

---

## Scorers (1 skill)

### `llm-judge-faithfulness`

- **Rôle** : évalue la **fidélité factuelle** d'un output IA par rapport à son input
  source. Retourne un score 0.0–1.0. Utilisé dans le scoring automatique des logs et
  dans les experiments `/ai-evals`.
- **Trigger** : interne, déclenché en fire-and-forget après chaque `runSkill()` et
  manuellement via `POST /ai-skills/api/logs/:id/rescore`.
- **Fichier** : [llm-judge-faithfulness.md](../apps/platform/servers/unified/src/prompts/judge/llm-judge-faithfulness.md)
- **Output** : `{ score: number, rationale: string }`

---

## Legacy (2 skills)

Plus jamais invoqués au runtime depuis le passage au pipeline modulaire (avril 2026),
mais **conservés dans le registre** pour :
- la navigation des logs historiques (qui pointent encore vers ces slugs)
- l'historique des versions (`ai_skill_versions`)
- le rollback éventuel si un jour on revenait au monolithe

### `suivitess-import-source-into-document` (LEGACY)

- Ancien monolithe qui faisait l'équivalent de `extract + place-in-document + append +
  compose` dans un seul prompt de 184 lignes.
- Remplacé par le pipeline pour éliminer les hallucinations (l'écriture est maintenant
  isolée, avec rawQuotes stricts).

### `suivitess-route-source-to-review` (LEGACY)

- Ancien monolithe qui faisait l'équivalent de `extract + place-in-reviews + compose`
  dans un seul prompt de 253 lignes.
- Remplacé par le pipeline.

---

## Éditer un skill

### Via l'admin UI (recommandé)

1. Va sur **Admin → AI Skills** (réservé admin)
2. Clique le skill à modifier
3. L'éditeur propose 3 vues : **Éditer** (markdown numéroté), **Aperçu** (rendu), **Diff
   vs contenu par défaut**
4. Sauvegarde → nouvelle version taggée avec hash SHA-256, visible dans l'historique
5. Les prochains appels utilisent immédiatement cette version
6. Pour restaurer le contenu par défaut : bouton « Restaurer par défaut »

Chaque modification crée une ligne dans `ai_skill_versions` avec `hash`, `content`,
`created_by_user_id`, `created_at`. Le hash apparaît dans les logs → tu peux tracer
quelle version de quel skill a produit un output.

### Via l'assistant d'amélioration (pour tester avant de sauver)

1. Va sur `/ai-improve-assistant` (ou le bouton depuis `/ai-logs`, `/ai-evals`,
   `/ai-playground`)
2. Suis les 10 étapes : choisir skill → choisir log → diagnostiquer → préparer dataset
   → ajouter items → baseline → playground (N variantes × M cas) → choisir gagnante →
   promouvoir → valider/rollback
3. Le playground de l'étape 7 te permet de tester plusieurs versions sans toucher au
   skill en prod.

### Via le fichier `.md` (pour modifier le défaut)

Les fichiers `.md` dans `suivitess/` et `delivery/` sont le **contenu par défaut**.
Modifier un fichier :
- Ne change **pas** le comportement tant qu'un admin n'a pas cliqué « Restaurer par
  défaut » (ou qu'il n'y a pas encore de version DB pour ce skill).
- Sert de référence pour le bouton « Restaurer par défaut » dans l'UI.
- Est déployé avec le code.

---

## Ajouter un nouveau skill

1. Créer le fichier `.md` dans le bon module (`suivitess/`, `delivery/`, ou un nouveau)
2. Ajouter une entrée dans `registry.ts` :
   ```ts
   {
     slug: 'mon-module-mon-skill',
     name: 'Mon Module — Mon Skill',
     description: '…',
     usage: { module: 'suivitess', endpoint: '…', trigger: '…' },
     defaultFilePath: resolve(PROMPTS_DIR, 'mon-module/mon-skill.md'),
   }
   ```
3. Mettre à jour le test `aiSkills.test.ts` pour inclure le nouveau slug dans l'assertion
4. Invoquer le skill depuis le route handler via `runSkill({ slug: 'mon-module-mon-skill', ... })`

Le skill apparaît automatiquement dans Admin → AI Skills et dans les filtres de `/ai-logs`
et `/ai-playground`.

---

## Tests

Tests unitaires couvrant le registre et les helpers du pipeline :

```bash
npm run test:server:aiSkills
```

Le test `aiSkills.test.ts` vérifie les 12 slugs attendus et valide que chaque entrée a
un nom, description et `defaultFilePath` pointant vers un `.md`.

Le test `analyzeSourcePipeline.test.ts` mirror les helpers purs (`extractorSlugFor`,
`extractJson` avec récupération de JSON tronqué) — si tu modifies la fonction réelle,
mets le mirror à jour sinon la review diff sera flagguée.

---

## Observabilité globale

| Outil | Où | Quoi |
|---|---|---|
| **`/ai-logs`** | UI admin | Liste + détail de tous les appels IA, filtrable par skill, coût par ligne, erreurs en rouge, arbre parent/enfant |
| **`/ai-evals`** | UI admin | Datasets + experiments : rejouer un skill sur N cas, comparer à une baseline |
| **`/ai-playground`** | UI admin | Matrice N variantes × M inputs, scoring auto |
| **`/ai-improve-assistant`** | UI admin | Flow 10 étapes qui orchestre tout ce qui précède |
| **Serveur stdout** | logs | `[pipeline:summary]`, `[runSkill:<slug>] cache hit_tokens=…`, `[rescore]` |

Toutes les pages admin sont réservées via `user.isAdmin` côté UI + `authMiddleware` côté
backend.
