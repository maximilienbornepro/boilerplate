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

If you follow **3 conventions** when wiring your skill, the decisions
appear automatically in the admin dashboards — no extra code:

| Convention | Admin page that lights up |
|---|---|
| Skill backend calls `logAnalysis()` after each AI call | `/ai-logs` (list + filters + replay) |
| `onDisagree` POSTs `human.thumbs = -1` on `/ai-skills/api/logs/:id/scores` | `/ai-logs` row turns orange, `⚠ N désaccords` shows in sidebar, filter "⚠ Flaggés" works |
| `onCommit` persists `(log_id, proposal_index, user_choice, ai_proposed_*)` in a per-module table | `/ai-routing` renders the 3-column AI-vs-user comparison |

All three pages are reachable from the admin drawer — you don't touch
their code.

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
