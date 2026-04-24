import type { ReactNode } from 'react';

/** A dropdown slot embedded mid-sentence inside a {@link StatementLine}.
 *  Used to let the user override an individual piece of the AI's
 *  structured proposition without leaving the tile view. */
export interface EditableSlot {
  /** Visible label on the dropdown trigger (ex: "Review cible"). Omitted
   *  when the pill itself already describes the field (ex: "« Suivi
   *  Hebdo TV »"). */
  label?: string;
  /** Current value shown on the pill. Rendered as-is, so callers own
   *  the formatting (quotes, emoji, short/long form). */
  currentValue: string;
  /** Optional styling hint — "existing" = neutral pill, "new" = accent
   *  color for "＋ Créer …" type entries. Defaults to "existing". */
  variant?: 'existing' | 'new';
  /** List of pickable values. The consumer can prepend a "＋ Créer …"
   *  entry to surface the allowCreate affordance. */
  options: Array<{
    id: string;
    label: string;
    /** Small tag displayed after the label (ex: count, source icon). */
    badge?: string;
    /** Optional styling hint per option (e.g. "create" to highlight). */
    kind?: 'value' | 'create';
  }>;
  /** Fired when the user picks an option. `null` means "clear the slot"
   *  when the consumer supports it. */
  onChange: (newValueId: string | null) => void;
  /** Disable the dropdown (ex: when a field is locked by parent context). */
  disabled?: boolean;
}

/** One line of the AI's structured verdict, rendered as a readable
 *  sentence with an optional inline editable pill.
 *
 *  @example
 *  // "Dans la review existante « Suivi Hebdo TV »"
 *  {
 *    text: 'Dans la review existante',
 *    slot: { currentValue: '« Suivi Hebdo TV »', variant: 'existing', ... }
 *  }
 */
export interface StatementLine {
  /** The fixed prose before the slot. Supports plain strings or JSX
   *  so consumers can mix bold/italic ("MISE À JOUR du sujet …"). */
  text: ReactNode;
  slot?: EditableSlot;
}

/** Payload kind helps the wizard decide whether to call {@link WizardConfig.onCommit}
 *  or short-circuit via skip/disagree. The wizard never introspects the
 *  payload itself — only the consumer does. */
export interface ReviewableDecision<TPayload = unknown> {
  /** Stable key — used for React lists, dot highlighting, and score /
   *  audit correlation. Must be unique within the `decisions` array. */
  id: string;
  /** One-line title shown in the tile header and the dots tooltip. */
  title: string;
  /** Optional status badge on the right (color + label). Typical use:
   *  reflect the subject's final status after AI proposal. */
  status?: {
    label: string;
    color: string;
  };
  /** Optional mode tag ("Mise à jour sujet", "Nouveau", "Update", ...).
   *  Rendered as a colored pill inline with the title. */
  modeTag?: {
    label: string;
    variant?: 'update' | 'create' | 'neutral';
  };
  /** The 1-to-N sentences that describe the AI's decision. Rendered
   *  stacked, each on its own line. Most consumers produce 2-3 lines. */
  statementLines: StatementLine[];
  /** The AI's self-justification. Rendered under the decision card
   *  with a "Raison IA :" lead. Plain string or JSX for links / quotes. */
  reasoning?: ReactNode;
  /** Opaque data the consumer passes through to its own handlers.
   *  The wizard never reads this field — it's a handle for `onCommit`,
   *  `onSkip` and `onDisagree`. */
  payload: TPayload;
  /** Link back to the AI analysis log that produced this proposal.
   *  When set, it lets the consumer record a thumbs-down (disagree)
   *  and feed `/ai-routing` with (log_id, proposalIndex) joins. */
  logId?: number | null;
  /** Position of this decision in the log's `proposals_json` array. */
  proposalIndex?: number;
}

/** Top-level wizard configuration — the contract between consumers and
 *  the shared {@link AiReviewWizard}. */
export interface WizardConfig<TPayload> {
  /** Ordered list of decisions to review. The wizard walks them
   *  sequentially and auto-advances on skip / commit. */
  decisions: ReviewableDecision<TPayload>[];
  /** Fired when the user clicks "Ignorer". No backend call expected —
   *  the wizard just drops the tile and moves to the next one. */
  onSkip: (decision: ReviewableDecision<TPayload>) => void;
  /** Fired when the user clicks "Je ne suis pas d'accord". Consumers
   *  typically:
   *    (a) open an edit sub-wizard or form to fix the proposal, and
   *    (b) record a `human.thumbs = -1` score via the gateway so
   *        /ai-logs and /ai-routing surface the disagreement. */
  onDisagree: (decision: ReviewableDecision<TPayload>) => void;
  /** Fired when the user accepts and commits. Typically POSTs to the
   *  consumer's `/apply` endpoint. Should resolve on success — the
   *  wizard auto-advances when the promise settles. Throws cause the
   *  wizard to surface the error under the action bar. */
  onCommit: (decision: ReviewableDecision<TPayload>) => Promise<void>;
  /** Fired after the last decision is handled (skipped or committed).
   *  Consumers typically close their modal here. */
  onDone?: () => void;
  /** Optional label overrides — falls back to French defaults. */
  labels?: Partial<WizardLabels>;
}

export interface WizardLabels {
  /** "Sujet {n} sur {total}" */
  tileCountLead: string;
  /** "{n} restants" */
  tileRemaining: (remaining: number) => string;
  /** "Sujet précédent" — button title */
  prev: string;
  /** "Sujet suivant (sans l'importer)" — button title */
  next: string;
  /** "Ignorer" button text */
  skip: string;
  /** "Je ne suis pas d'accord" button text */
  disagree: string;
  /** "Importer et passer au suivant" button text */
  commit: string;
  /** "Raison IA :" lead before the reasoning block */
  reasoningLead: string;
  /** Rendered when the decision list is empty or exhausted. */
  emptyState: ReactNode;
}
