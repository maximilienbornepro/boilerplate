# AiReviewWizard

Shared single-tile wizard for the **"AI proposes, user validates"** pattern.
Originally extracted from the SuiviTess bulk-transcription import modal.

Any workflow where an AI skill produces **N structured proposals** that a
human should review one-by-one — accept / override / reject — plugs into
this component with ~30 lines of mapping code.

```
┌─ Tile header ─────────────────────────────────────────────────┐
│  Sujet 3 sur 26                                26 restants     │
│  ← ●●●○○○○○○○○○○○○○○○○○○○○○○○○○ →                            │
└───────────────────────────────────────────────────────────────┘
┌─ Decision card ───────────────────────────────────────────────┐
│  Mise en prod 1.24.1   [Mise à jour]  ● Terminé                │
│  ──────────────────────────────────────────────────────────   │
│  Dans la review existante [« Suivi Hebdo TV » ▼]               │
│  Section existante [« Releases » ▼]                            │
│  MISE À JOUR du sujet existant [« Mise en prod 1.24 » ▼]       │
│  ──────────────────────────────────────────────────────────   │
│  Raison IA : Match direct sur le sujet existant …              │
│                                                                │
│  [Ignorer]  [Pas d'accord]  [Valider et passer au suivant]    │
└───────────────────────────────────────────────────────────────┘
```

## When to use

- You have a pipeline that produces **a list** of structured decisions
  (one proposal per subject / section / field).
- Each decision has **editable parts** the user may want to override
  (dropdown pills inline with the verdict sentence).
- You want the user's corrections to feed back into observability
  (`/ai-logs`, `/ai-routing`, `/ai-evals`) and the RAG memory.

Typical consumers:
- SuiviTess — place extracted subjects into the right review/section
- Mon-CV *(planned)* — adapt each CV section against a job offer
- Roadmap *(planned)* — validate AI-suggested task dependencies
- Delivery *(planned)* — accept AI-proposed board moves

## API — the contract

The component takes a {@link WizardConfig} with a typed payload `T`:

```ts
import {
  AiReviewWizard,
  type ReviewableDecision,
} from '@boilerplate/shared/components';

type MyPayload = { sectionId: string; adaptedText: string };

const decisions: ReviewableDecision<MyPayload>[] = proposals.map((p, i) => ({
  id: p.sectionId,
  title: `Expérience ${i + 1}/${proposals.length}`,
  modeTag: { label: 'adapter', variant: 'update' },
  statementLines: [
    {
      text: 'Réécrire la section',
      slot: {
        currentValue: `« ${p.adaptedText.slice(0, 40)}… »`,
        variant: 'new',
        options: p.variants.map((v, idx) => ({
          id: String(idx),
          label: v.slice(0, 60) + '…',
        })),
        onChange: newId => updateVariantLocally(i, Number(newId)),
      },
    },
    { text: `pour matcher l'offre ${offerTitle}` },
  ],
  reasoning: p.aiReasoning,
  payload: { sectionId: p.sectionId, adaptedText: p.adaptedText },
  logId: analysisLogId,
  proposalIndex: i,
}));

<AiReviewWizard<MyPayload>
  decisions={decisions}
  onSkip={d => removeFromLocal(d.id)}
  onDisagree={d => flagLog(d.logId, d.id)}      // POST human.thumbs=-1
  onCommit={async d => api.applyDecision(d.payload, d.logId, d.proposalIndex)}
  onDone={closeModal}
/>
```

### `ReviewableDecision<T>`

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Stable key for React + for linking to audit / logs. |
| `title` | `string` | Visible on the tile header + dot tooltips. |
| `status` | `{ label, color }?` | Optional status pill on the right. |
| `modeTag` | `{ label, variant }?` | "Mise à jour" / "Nouveau" tag. Variants: `update`, `create`, `neutral`. |
| `statementLines` | `StatementLine[]` | 1-N sentences that describe the AI's verdict. Each can embed a dropdown. |
| `reasoning` | `ReactNode?` | The AI's self-justification under the statement block. |
| `payload` | `T` | Opaque data passed through to the handlers — the wizard never reads it. |
| `logId` | `number \| null?` | Back-reference to the `ai_analysis_logs` row that produced this. |
| `proposalIndex` | `number?` | Index in the log's `proposals_json` — used by `/ai-routing`. |

### `StatementLine`

```ts
{
  text: ReactNode;          // "Dans la review existante"
  slot?: EditableSlot;      // [« Suivi Hebdo TV » ▼]
}
```

### `EditableSlot`

```ts
{
  currentValue: string;     // "« Suivi Hebdo TV »" — rendered as-is
  variant?: 'existing' | 'new';   // pill color
  options: Array<{
    id: string;
    label: string;
    badge?: string;
    kind?: 'value' | 'create';     // 'create' highlights "＋ Créer nouvelle …"
  }>;
  onChange: (newId: string | null) => void;
  disabled?: boolean;
}
```

### `WizardConfig<T>` — handlers

| Handler | Fires when | Advances tile? |
|---|---|---|
| `onSkip` | "Ignorer" | Yes (auto) |
| `onDisagree` | "Je ne suis pas d'accord" | **No** — consumers typically open an editor to fix the proposal, then call their own commit |
| `onCommit` | "Valider" | Yes (on resolved Promise) |
| `onDone` | After last decision handled | — |

Handlers receive the full `ReviewableDecision<T>` so the consumer can
access both the payload AND the metadata (`logId`, `proposalIndex`) in
one place.

## Plugging into the observability stack

The wizard was designed to plug into the platform's AI admin tooling
without extra work. Follow **3 conventions** when wiring your skill
and the decisions appear automatically in every dashboard — no code
touching `/ai-logs`, `/ai-routing`, or `/ai-evals`.

```
  ┌─ USER CLICKS ────┐      ┌─ GATEWAY / BACKEND ──────────────┐      ┌─ ADMIN DASHBOARDS ─────────┐
  │                  │      │                                   │      │                             │
  │  [Valider] ─────►│─────►│ /<module>/apply                    │─────►│ /ai-logs      (log appears)│
  │                  │      │   - updates module state           │      │                             │
  │                  │      │   - inserts row in <module>_      │─────►│ /ai-routing   (3-col view) │
  │                  │      │     decisions (log_id, idx, ai vs │      │                             │
  │                  │      │     user, overrode?)              │      │                             │
  │                  │      │                                   │      │                             │
  │  [Pas d'accord] ─┼─────►│ /ai-skills/api/logs/:id/scores    │─────►│ /ai-logs      (orange row)│
  │                  │      │   - POST human.thumbs = -1        │      │   + "⚠ N désaccords"      │
  │                  │      │   - stored in ai_analysis_scores  │      │   + filter "⚠ Flaggés"    │
  │                  │      │                                   │      │                             │
  │  (skill run) ────┼─────►│ runSkill() → logAnalysis()        │─────►│ /ai-logs      (row added)  │
  │                  │      │   - writes ai_analysis_logs       │      │ /ai-evals     (dataset candidate)│
  └──────────────────┘      └───────────────────────────────────┘      └─────────────────────────────┘
```

### Convention 1 — log your AI calls

Every AI call the wizard depends on must go through `runSkill()` or
call `logAnalysis()` manually. This ensures the `ai_analysis_logs`
row exists, with `proposals_json` set via `attachProposalsToLog`.
Without this, the wizard has no `logId` to link back to — the
/ai-routing page can't show anything and the disagree flag is
fire-into-the-void.

**Pattern** (backend, your `/analyze` endpoint):
```ts
import { runSkill, attachProposalsToLog } from '.../aiSkills/...';

const run = await runSkill({
  slug: 'my-module-proposer',
  userId: req.user!.id,
  userEmail: req.user!.email,
  buildContext: () => makePromptContext(),
  inputContent: req.body.input,
  sourceKind: 'my-module',
  sourceTitle: req.body.title,
  documentId: req.body.documentId,
  maxTokens: 6000,
});
const proposals = extractJson(run.outputText);
if (run.logId && Array.isArray(proposals)) {
  await attachProposalsToLog(run.logId, proposals);
}
res.json({ logId: run.logId, proposals });
```

The log now appears in `/ai-logs` with filter `skill=my-module-proposer`.

### Convention 2 — persist the user's final decision

On each commit, the consumer writes a per-module "decisions" row that
mirrors `suivitess_routing_memory` — the shape `/ai-routing` expects:

```sql
CREATE TABLE my_module_decisions (
  id SERIAL PRIMARY KEY,
  log_id INTEGER REFERENCES ai_analysis_logs(id) ON DELETE SET NULL,
  proposal_index INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  -- Whatever fields describe "what the user committed":
  final_text TEXT,
  target_id VARCHAR(100),
  -- What the AI proposed before the user edited (for the comparison page):
  ai_proposed_text TEXT,
  ai_proposed_target_id VARCHAR(100),
  -- Did the user change anything?
  user_overrode_ai BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON my_module_decisions (log_id, proposal_index);
```

**Pattern** (backend, your `/apply` endpoint):
```ts
router.post('/apply-proposal', asyncHandler(async (req, res) => {
  const { logId, proposalIndex, finalText, aiProposedText, targetId, aiTargetId } = req.body;
  const overrode = finalText !== aiProposedText || targetId !== aiTargetId;
  await db.pool.query(
    `INSERT INTO my_module_decisions
       (log_id, proposal_index, user_id, final_text, target_id,
        ai_proposed_text, ai_proposed_target_id, user_overrode_ai)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [logId, proposalIndex, req.user!.id, finalText, targetId,
     aiProposedText, aiTargetId, overrode],
  );
  // ... actually apply the change to your module's state ...
  res.json({ ok: true });
}));
```

The last piece is a small extension in
`apps/platform/servers/unified/src/modules/aiSkills/routingComparisonService.ts`
that routes `listComparableLogs` / `fetchUserDecisions` to the right
table based on `ai_analysis_logs.skill_slug`. See the existing
`suivitess_routing_memory` branch for the pattern — it's ~20 lines
of dispatch code per new module.

### Convention 3 — call the shared disagree helper

Use `flagDisagreement()` (or `createDisagreeHandler()`) exported from
this package. One line, fire-and-forget, records a `human.thumbs = -1`
score on `ai_analysis_logs/:logId/scores`:

```ts
import { createDisagreeHandler } from '@boilerplate/shared/components';

<AiReviewWizard
  decisions={decisions}
  onDisagree={createDisagreeHandler({
    buildRationale: d => `Désaccord sur « ${d.title} » — contexte ${d.payload.kind}`,
  })}
  ...
/>
```

### What the admin sees automatically

| Page | What lights up |
|---|---|
| `/ai-logs` | The run appears with its skill filter. Disagreements tint the row orange + badge `⚠ N désaccords`. Filter pills `⚠ Flaggés` / `× Erreurs` work out of the box. |
| `/ai-routing` | Once your module's `_decisions` table is queryable, the 3-column comparison renders: AI proposal \| user decision \| similar past RAG hits. |
| `/ai-evals` | Any log is promotable to a dataset item from `/ai-logs` → add to dataset. Runs experiments against new skill versions. |
| Routing memory (pgvector) | The per-module decisions feed the RAG few-shot examples on next imports of the SAME skill — `suivitess_routing_memory` pattern extends to any module once you write to the pgvector-enabled table. |

---

## End-to-end example — adapting the `mon-cv` module

Imagine you want: upload a CV, paste a job offer, get N proposals to
adapt specific sections. User validates each adaptation one-by-one.

### 1. Prompt (`apps/platform/servers/unified/src/prompts/mon-cv/adapt-against-offer.md`)

A `.md` file describing the skill. Takes `{cv, offer}`, returns
`[{sectionId, originalText, proposedText, reasoning, confidence}]`.
~150 lines of prompt engineering, zero code.

### 2. Backend — analyze endpoint (~25 lines)

```ts
// apps/platform/servers/unified/src/modules/mon-cv/routes.ts
router.post('/adapt-against-offer', asyncHandler(async (req, res) => {
  const { cvId, offerText } = req.body;
  const cv = await db.getCV(cvId, req.user!.id);
  const run = await runSkill({
    slug: 'mon-cv-adapt-against-offer',
    userId: req.user!.id,
    userEmail: req.user!.email,
    buildContext: () => `## CV\n\`\`\`json\n${JSON.stringify(cv)}\n\`\`\`\n\n## Offre\n${offerText}`,
    inputContent: offerText,
    sourceKind: 'cv-adapt',
    sourceTitle: cv.name,
    documentId: String(cvId),
    maxTokens: 8000,
  });
  const proposals = extractJson(run.outputText);
  if (run.logId && Array.isArray(proposals)) {
    await attachProposalsToLog(run.logId, proposals);
  }
  res.json({ logId: run.logId, proposals });
}));
```

### 3. Backend — apply endpoint (~25 lines)

```ts
router.post('/apply-adapted-section', asyncHandler(async (req, res) => {
  const { cvId, sectionId, finalText, aiProposedText, logId, proposalIndex } = req.body;
  await db.updateCVSection(cvId, sectionId, finalText);
  await db.pool.query(
    `INSERT INTO mon_cv_adapt_decisions
       (log_id, proposal_index, user_id, cv_id, section_id,
        final_text, ai_proposed_text, user_overrode_ai)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [logId, proposalIndex, req.user!.id, cvId, sectionId,
     finalText, aiProposedText, finalText !== aiProposedText],
  );
  res.json({ ok: true });
}));
```

### 4. SQL migration (`mon_cv_adapt_decisions` table) — 15 lines (see Convention 2)

### 5. Frontend — the modal (~70 lines)

```tsx
import { Modal, AiReviewWizard, createDisagreeHandler, type ReviewableDecision } from '@boilerplate/shared/components';

type CvAdaptPayload = { sectionId: string; finalText: string; aiProposedText: string };

export function AdaptWithOfferModal({ cvId, offerText, onClose }) {
  const [logId, setLogId] = useState<number | null>(null);
  const [proposals, setProposals] = useState<Array<any>>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/mon-cv-api/adapt-against-offer', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cvId, offerText }),
    }).then(r => r.json()).then(({ logId, proposals }) => {
      setLogId(logId);
      setProposals(proposals);
    });
  }, [cvId, offerText]);

  const decisions: ReviewableDecision<CvAdaptPayload>[] = proposals.map((p, i) => ({
    id: p.sectionId,
    title: sectionLabels[p.sectionId],
    modeTag: { label: 'Adaptation', variant: 'update' },
    status: { label: p.confidence, color: p.confidence === 'high' ? '#10b981' : '#f59e0b' },
    statementLines: [
      { text: `Section «${sectionLabels[p.sectionId]}»` },
      {
        text: 'Nouveau texte :',
        slot: {
          currentValue: `« ${(overrides[p.sectionId] ?? p.proposedText).slice(0, 60)}… »`,
          variant: 'new',
          options: [
            { id: 'ai',       label: `IA : ${p.proposedText.slice(0, 80)}` },
            { id: 'original', label: `Garder l'original : ${p.originalText.slice(0, 80)}` },
          ],
          onChange: id => setOverrides(prev => ({
            ...prev,
            [p.sectionId]: id === 'ai' ? p.proposedText : p.originalText,
          })),
        },
      },
    ],
    reasoning: p.reasoning,
    payload: {
      sectionId: p.sectionId,
      finalText: overrides[p.sectionId] ?? p.proposedText,
      aiProposedText: p.proposedText,
    },
    logId,
    proposalIndex: i,
  }));

  return (
    <Modal title="Adapter le CV à l'offre" size="xl" onClose={onClose}>
      <AiReviewWizard<CvAdaptPayload>
        decisions={decisions}
        onSkip={() => {}}
        onDisagree={createDisagreeHandler({
          buildRationale: d => `Désaccord sur « ${d.title} » (mon-cv adapt)`,
        })}
        onCommit={async d => {
          await fetch('/mon-cv-api/apply-adapted-section', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cvId,
              sectionId: d.payload.sectionId,
              finalText: d.payload.finalText,
              aiProposedText: d.payload.aiProposedText,
              logId: d.logId,
              proposalIndex: d.proposalIndex,
            }),
          });
        }}
        onDone={onClose}
      />
    </Modal>
  );
}
```

### 6. Extension `/ai-routing` (~20 lines)

Open
`apps/platform/servers/unified/src/modules/aiSkills/routingComparisonService.ts`
and dispatch `fetchUserDecisions` on `skill_slug`:

```ts
if (skillSlug.startsWith('mon-cv-adapt-')) {
  // Query mon_cv_adapt_decisions instead of suivitess_routing_memory
  return fetchCvDecisions(logId);
}
```

### Total effort

~6 files, ~295 lines of new code. The shared wizard saved ~700 lines
of tile navigation / dot progress / inline dropdown / CSS boilerplate.

Every admin dashboard lights up automatically:
- `/ai-logs` shows CV adapt runs (filterable by `mon-cv-adapt-against-offer`)
- Disagreements show as orange rows with rationale
- `/ai-routing` renders the before/after comparison per section
- `/ai-evals` lets you build a dataset of "bad adaptations" to tune the skill

## Customisation

### Labels

All UI strings default to French. Override any of them via `labels`:

```ts
<AiReviewWizard
  decisions={...}
  labels={{
    commit: 'Adopter cette variante',
    disagree: 'Regenerate',
    tileRemaining: r => `${r} left`,
  }}
  ...
/>
```

See {@link WizardLabels} for the full set.

### Styling

The wizard reads its colors from the global CSS variables:
`--accent-primary`, `--text-primary`, `--text-muted`, `--bg-primary`,
`--bg-secondary`, `--bg-tertiary`, `--border-color`, `--color-warning`,
`--color-error`. It inherits the app's light/dark theme automatically.

Per-decision overrides: pass `--status-color` via inline style on your
surrounding container if you want to tint the status dot.

## What this component does NOT do

- **Modal shell**: wrap the wizard in the shared `<Modal size="xl">`
  yourself. The wizard is content-only so you can also use it inline.
- **Edit sub-wizard on disagree**: `onDisagree` is fire-and-forget.
  If you want to show an "edit then re-validate" flow, render your own
  edit UI outside the wizard and call `onCommit` when done.
- **Backend calls**: the wizard is 100% presentational. Your
  `onSkip` / `onDisagree` / `onCommit` handlers own every network
  round-trip. This is deliberate — keeps the component reusable across
  modules without baking any HTTP knowledge in.

## Files

```
AiReviewWizard/
├── AiReviewWizard.tsx          # orchestrator — progress + nav + current card
├── DecisionCard.tsx            # single-decision rendering (stateless except for commit spinner)
├── InlineSlotDropdown.tsx      # the inline pill + menu in statement lines
├── AiReviewWizard.module.css   # all visual styles (tokens-based)
├── types.ts                    # ReviewableDecision, EditableSlot, StatementLine, WizardConfig, WizardLabels
└── index.ts                    # barrel export
```

## See also

- `apps/platform/src/modules/suivitess/components/BulkTranscriptionImportModal/` — the original in-app implementation the pattern was extracted from. Not yet migrated to this shared component — preserved as reference.
- `apps/platform/src/modules/ai-logs/App.tsx` — flagged / errored filter wiring.
- `apps/platform/src/modules/ai-routing/App.tsx` — the AI-vs-user comparison page.
- `apps/platform/servers/unified/src/modules/aiSkills/routingComparisonService.ts` — backend layer that joins logs ↔ user decisions.
