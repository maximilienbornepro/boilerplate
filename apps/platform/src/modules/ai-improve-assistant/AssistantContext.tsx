import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import type {
  ExperimentReport,
  PlaygroundResult,
  ScoreRow,
} from './assistantApi';

// The assistant state is a forward-only workflow — we only advance through
// completed steps. Everything is kept client-side + mirrored to localStorage
// so the user can close the modale and come back later.

export interface AssistantState {
  currentStep: number;                    // 0..9 (step 1 = index 0)
  skillSlug: string | null;

  // Step 2-3 : a log under review.
  logId: number | null;
  logScores: ScoreRow[];
  humanVote: -1 | 1 | null;

  // Step 4-5 : the dataset + the item.
  datasetId: number | null;
  datasetName: string | null;
  itemId: number | null;
  /** Live count of items in the current dataset — set by Step5 on mount
   *  and after every add. Source of truth for Step5.isComplete so we
   *  don't rely on a stale itemId from a previous session. */
  datasetItemCount: number;

  // Step 6 : baseline experiment.
  baselineExperimentId: number | null;
  baselineReport: ExperimentReport | null;

  // Step 7-8 : playground variants + winner.
  originalSkillContent: string | null;    // snapshot of the skill before the assistant ran — for rollback
  variants: Array<{ label: string; content: string }>;
  playgroundResult: PlaygroundResult | null;
  winnerVariantIndex: number | null;

  // Step 9 : new skill version saved.
  promotedContent: string | null;
  newSkillVersionHash: string | null;

  // Step 10 : final experiment + comparison.
  finalExperimentId: number | null;
  finalReport: ExperimentReport | null;

  completedSteps: number[];               // stored as array for JSON serialisation
}

export const INITIAL_STATE: AssistantState = {
  currentStep: 0,
  skillSlug: null,
  logId: null,
  logScores: [],
  humanVote: null,
  datasetId: null,
  datasetName: null,
  itemId: null,
  datasetItemCount: 0,
  baselineExperimentId: null,
  baselineReport: null,
  originalSkillContent: null,
  variants: [],
  playgroundResult: null,
  winnerVariantIndex: null,
  promotedContent: null,
  newSkillVersionHash: null,
  finalExperimentId: null,
  finalReport: null,
  completedSteps: [],
};

export type AssistantAction =
  | { type: 'RESET' }
  | { type: 'HYDRATE'; state: AssistantState }
  | { type: 'GOTO'; step: number }
  | { type: 'PATCH'; patch: Partial<AssistantState> }
  | { type: 'COMPLETE_STEP'; step: number };

export function reducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'RESET':
      return INITIAL_STATE;
    case 'HYDRATE':
      return action.state;
    case 'GOTO':
      // Only allow navigating to completed steps + the next one.
      return { ...state, currentStep: Math.max(0, Math.min(9, action.step)) };
    case 'PATCH':
      return { ...state, ...action.patch };
    case 'COMPLETE_STEP': {
      if (state.completedSteps.includes(action.step)) return state;
      return { ...state, completedSteps: [...state.completedSteps, action.step] };
    }
    default:
      return state;
  }
}

// ── Persistence ──────────────────────────────────────────────────────

const STORAGE_KEY = 'assistant:improve-skill';

function loadFromStorage(): AssistantState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AssistantState>;
    // Only hydrate if the shape looks right.
    if (typeof parsed.currentStep !== 'number') return null;
    return { ...INITIAL_STATE, ...parsed };
  } catch { return null; }
}

function saveToStorage(state: AssistantState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* quota / disabled */ }
}

export function clearStorage(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ── Context ──────────────────────────────────────────────────────────

interface AssistantCtx {
  state: AssistantState;
  dispatch: React.Dispatch<AssistantAction>;
}

const Ctx = createContext<AssistantCtx | null>(null);

export function AssistantProvider({ children, initialSkillSlug }: { children: ReactNode; initialSkillSlug?: string | null }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, (init) => {
    const stored = loadFromStorage();
    if (stored) return stored;
    return initialSkillSlug ? { ...init, skillSlug: initialSkillSlug } : init;
  });

  useEffect(() => {
    saveToStorage(state);
  }, [state]);

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return c;
}
