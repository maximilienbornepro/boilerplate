# Plan — Delivery : Vérification IA du board (sanity check)

## Objectif

Ajouter un bouton **"Vérifier avec l'IA"** dans l'en-tête d'un Delivery Board qui :
1. Déduit automatiquement le(s) projet(s) + sprint(s) Jira concernés à partir des tickets déjà présents sur le board (pas de sélection manuelle).
2. Récupère l'état **live** de ces tickets dans Jira (statut, estimation, assignee).
3. Compare à l'état courant du board (positions `startCol` / `row`, statuts).
4. Fait analyser l'écart par Claude et reçoit des **recommandations de repositionnement** (jamais de suppression).
5. Affiche les recommandations dans une **modale large** avec bouton "Appliquer".

## Règles de repositionnement (prompt IA)

| Cas | Action |
|---|---|
| Tâche `in_progress` dans Jira, loin à droite du board | Rapprocher du trait "aujourd'hui" |
| Tâche `blocked` | Marquer, laisser proche d'aujourd'hui (signal visuel), description du blocage en reasoning |
| Tâche sans estimation + sans description + statut `todo` | Pousser tout à droite du board (dernière colonne disponible), row basse **mais** au-dessus des tâches qui ont encore moins d'infos |
| Tâche `done` mais positionnée sur du futur | Tirer à gauche du trait aujourd'hui |
| Tâche `todo` avec estimation précise, proche dans le temps | Aligner sur la zone avant le trait aujourd'hui |

Contraintes **absolues** :
- Aucune tâche supprimée.
- Ne pas modifier `task.status` ni `task.estimatedDays` — on change **uniquement** les positions (`startCol`, `endCol`, `row`).
- Les tâches sans `source='jira'` sont ignorées par la recommandation (pas de Jira key).
- Tri vertical : plus une tâche a d'infos (estimation, description, assignee), plus elle est haute ; moins elle en a, plus elle descend (sans jamais être dernière si d'autres sont encore plus floues).

## Architecture

```
User clicks "Vérifier avec l'IA"
  → Frontend: DELIVERY /analyze-sanity-check?boardId=... (POST)
  →   Backend:
        1. fetchBoardTasks + fetchBoardPositions     (DB)
        2. extractJiraKeys(tasks) → { projectKeys, sprintNames }
        3. fetchJiraIssuesByKeys(projectKeys)        (live Jira)
        4. buildBoardSnapshot(today, tasks+positions, jiraState)
        5. analyzeSanity(snapshot) via Claude        (new service)
        6. return { recommendations[], summary }
  → Frontend: open SanityCheckModal showing recommendations
  → User clicks "Appliquer": PATCH positions (bulk)
```

## Détection automatique project + sprint

Pas de `fetchJiraProjects()` / `fetchJiraSprints()`. On lit directement les tickets du board :

```ts
function extractJiraContext(tasks: Task[]) {
  const projectKeys = new Set<string>();
  const sprintNames = new Set<string>();
  for (const t of tasks) {
    if (t.source !== 'jira') continue;
    const match = /^([A-Z][A-Z0-9]+)-\d+/.exec(t.title);
    if (match) projectKeys.add(match[1]);
    if (t.sprintName) sprintNames.add(t.sprintName);
  }
  return { projectKeys: [...projectKeys], sprintNames: [...sprintNames] };
}
```

Si 0 ticket Jira → la modale s'ouvre avec un message "Aucun ticket Jira sur ce board, rien à vérifier."

## Backend

### Nouveau service : `deliveryAISanityService.ts`

```ts
export interface TaskSnapshot {
  id: string;
  jiraKey: string | null;
  title: string;
  boardStatus: string;
  jiraStatus: string | null;
  hasEstimation: boolean;
  hasDescription: boolean;
  hasAssignee: boolean;
  position: { startCol: number; endCol: number; row: number };
  todayCol: number; // calculé côté serveur depuis board start/end
}

export interface MoveRecommendation {
  taskId: string;
  taskTitle: string;
  current:   { startCol: number; endCol: number; row: number };
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;        // 1 phrase en français
  priority: 'high' | 'medium' | 'low';
}

export async function analyzeSanityCheck(
  userId: number,
  board: Board,
  snapshot: TaskSnapshot[],
): Promise<{ summary: string; recommendations: MoveRecommendation[] }>
```

Prompt Claude : bullet-points des règles + snapshot en JSON + demande de JSON strict. Max 20 recommandations.

### Nouvelle route

`POST /delivery-api/boards/:boardId/ai-sanity-check`
- authMiddleware
- deductCredits(userId, 'delivery', 'sanity_check') — nouvelle opération
- logAnthropicUsage après le call

`POST /delivery-api/boards/:boardId/ai-sanity-check/apply` (séparé)
- Body: `{ moves: [{ taskId, startCol, endCol, row }] }`
- Upsert batch dans `delivery_positions`
- Garantit transactional (1 transaction = tout ou rien)

## Frontend

### 1. Bouton dans `ModuleHeader` de `App.tsx` (delivery)

Visible uniquement si :
- Le board a ≥ 1 tâche Jira (`tasks.some(t => t.source === 'jira')`)
- Au moins une IA connectée

```tsx
<button className="module-header-btn" onClick={() => setShowSanityModal(true)}>
  ✨ Vérifier avec l'IA
</button>
```

### 2. `SanityCheckModal.tsx` (nouveau composant)

3 états :
1. **Loading** : "Analyse en cours…" avec spinner (appel POST)
2. **Result** : liste des recommandations dans une modale `size="xl"` :
   - En-tête : résumé IA en 1-2 phrases ("4 tâches à déplacer, dont 2 critiques")
   - Chaque reco : titre tâche + badge priority + raison + delta position visualisé (flèche `→` entre l'ancienne et la nouvelle colonne/row)
   - Checkbox par reco (toutes cochées par défaut) pour choisir lesquelles appliquer
   - Footer : `Annuler` · `Appliquer la sélection (N)`
3. **Applied** : toast de succès + fermeture, le board se recharge

### 3. Style

Réutilise `Modal` partagé, tailles, boutons existants. Ajouter `SanityCheckModal.module.css` (aux couleurs du board : orange delivery accent pour la CTA).

## Tests

### Backend (`apps/platform/servers/unified/src/modules/__tests__/delivery/sanity-check.test.ts`)

- `extractJiraContext` renvoie les bons projectKeys + sprintNames
- `buildSnapshot` calcule correctement `todayCol` pour un board agile de 6 semaines
- La route refuse l'appel si aucun ticket Jira (400 avec message clair)
- La route `/apply` rejette si moves fait référence à des `taskId` qui ne sont pas dans le board
- Mock AI client → vérifier que le prompt contient bien la snapshot et que le parse JSON est robuste

### Frontend (`apps/platform/src/modules/delivery/__tests__/sanity-check.test.ts`)

- Le bouton n'apparaît pas si `tasks.filter(t => t.source === 'jira').length === 0`
- Build du body d'apply filtre uniquement les recos cochées

## Fichiers à créer / modifier

| # | Fichier | Action |
|---|---------|--------|
| 1 | `apps/platform/servers/unified/src/modules/delivery/deliveryAISanityService.ts` | **Nouveau** — analyse Claude |
| 2 | `apps/platform/servers/unified/src/modules/delivery/routes.ts` | Ajouter 2 routes (`/ai-sanity-check` + `/apply`) |
| 3 | `apps/platform/servers/unified/src/modules/delivery/dbService.ts` | Ajouter `bulkUpsertPositions(boardId, moves)` |
| 4 | `apps/platform/servers/unified/src/modules/__tests__/delivery/sanity-check.test.ts` | **Nouveau** — tests backend |
| 5 | `apps/platform/src/modules/delivery/services/api.ts` | Ajouter `aiSanityCheck(boardId)` + `applySanityMoves(...)` |
| 6 | `apps/platform/src/modules/delivery/components/SanityCheckModal/SanityCheckModal.tsx` | **Nouveau** |
| 7 | `apps/platform/src/modules/delivery/components/SanityCheckModal/SanityCheckModal.module.css` | **Nouveau** |
| 8 | `apps/platform/src/modules/delivery/App.tsx` | Ajouter bouton dans header + gestion modale |
| 9 | `apps/platform/src/modules/delivery/__tests__/sanity-check.test.ts` | **Nouveau** — tests frontend |
| 10 | `vitest.config.ts` + `package.json` si besoin | (probablement déjà couvert par les projets delivery existants) |

## Points à valider avant implémentation

1. **Credits** : quel coût (en crédits) attribuer à `sanity_check` ? Proposer 5 (entre analyse de sujets SuiviTess = 3 et génération email = 10).
2. **Limite** : max combien de tâches analysées en un appel ? Proposer 50 (hard-coded). Au-delà, on slice sur les plus anciennes positions.
3. **Mapping statut Jira → delivery** : réutiliser `mapIssueType` / ajouter un util `mapJiraStatusToBoardStatus` ?
4. **Gestion des tâches sans position** (row=0, col=0 par défaut) : l'IA peut-elle les repositionner ? Oui — c'est même un bon cas d'usage (une tâche importée sans position se retrouve positionnée proprement).
5. **Animation d'application** : on applique en batch silencieux ou on anime les mouvements sur le board ? v1 : batch silencieux + refresh ; animations en v2.

## Branche

Déjà créée : `feat/delivery-ai-sanity-check` (à partir de `main`).

## Prochaines étapes proposées

1. Tu valides / ajustes le plan (notamment les 5 points à valider ci-dessus).
2. Je passe en implémentation dans l'ordre : tests backend → service AI → routes → API frontend → modale → bouton header → tests frontend.
3. `npm test` passe, puis commit + PR (je ne merge pas automatiquement — attente de ton OK).
