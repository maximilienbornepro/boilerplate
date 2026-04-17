import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import { AssistantProvider, clearStorage, useAssistant } from './AssistantContext';
import styles from './Assistant.module.css';

// Lazy-load each step component — keeps the main bundle lean (the assistant
// is only used by admins).
const Step1 = lazy(() => import('./steps/Step1PickSkill'));
const Step2 = lazy(() => import('./steps/Step2PickLog'));
const Step3 = lazy(() => import('./steps/Step3DiagnoseLog'));
const Step4 = lazy(() => import('./steps/Step4PrepareDataset'));
const Step5 = lazy(() => import('./steps/Step5AddItem'));
const Step6 = lazy(() => import('./steps/Step6Baseline'));
const Step7 = lazy(() => import('./steps/Step7Playground'));
const Step8 = lazy(() => import('./steps/Step8PickWinner'));
const Step9 = lazy(() => import('./steps/Step9Promote'));
const Step10 = lazy(() => import('./steps/Step10ValidateAndDecide'));

interface AssistantFlowProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the skill dropdown of step 1 (e.g. from a page's context). */
  initialSkillSlug?: string | null;
}

export function AssistantFlow({ open, onClose, initialSkillSlug }: AssistantFlowProps) {
  if (!open) return null;
  return (
    <AssistantProvider initialSkillSlug={initialSkillSlug}>
      <AssistantShell onClose={onClose} />
    </AssistantProvider>
  );
}

// ── Step definitions ─────────────────────────────────────────────────

interface StepDef {
  title: string;
  shortLabel: string;
  why: string;
  Component: React.LazyExoticComponent<React.ComponentType<StepProps>>;
  /** When returning a value, the "Next" button is enabled. */
  isComplete: (ctx: ReturnType<typeof useAssistant>['state']) => boolean;
}

export interface StepProps {
  onAdvance: () => void;
}

export const STEPS: StepDef[] = [
  {
    title: 'Choisir le skill à améliorer',
    shortLabel: 'Skill',
    why:
      'Un « skill » = les instructions (prompt) que reçoit l\'IA pour une tâche précise (router une transcription, réorganiser un board, etc.). ' +
      'Pour ne pas mélanger les choses, on travaille sur un seul skill à la fois. ' +
      'Ce qu\'on va améliorer dans les étapes suivantes, c\'est son contenu.',
    Component: Step1,
    isComplete: s => !!s.skillSlug,
  },
  {
    title: 'Identifier un cas problématique',
    shortLabel: 'Log',
    why:
      'Améliorer un skill dans le vide, c\'est du coup de dé. On part plutôt d\'un cas réel qui a mal marché : une transcription mal routée, un email où l\'IA a inventé un fait, etc. ' +
      'Chaque appel IA est archivé comme un « log » avec l\'input envoyé et la sortie produite. ' +
      'On va en choisir un ici pour avoir un problème concret devant nous.',
    Component: Step2,
    isComplete: s => !!s.logId,
  },
  {
    title: 'Diagnostiquer le log',
    shortLabel: 'Diag',
    why:
      'Avant de changer le prompt, il faut comprendre POURQUOI l\'IA s\'est trompée. ' +
      'On lit l\'input, la sortie, les scores automatiques — et on met un 👍 ou 👎 avec une note courte qui explique ce qui cloche. ' +
      'Cette note sert de boussole pour toute la suite : elle dit ce qu\'on essaie de corriger.',
    Component: Step3,
    isComplete: s => s.humanVote !== null,
  },
  {
    title: 'Préparer un dataset de référence',
    shortLabel: 'Dataset',
    why:
      'Un « dataset », c\'est simplement une liste de cas qu\'on garde sous la main pour tester le skill. ' +
      'Pourquoi c\'est utile : si tu modifies le prompt pour corriger LE cas que tu viens de voir, tout peut sembler parfait… mais 3 autres cas peuvent s\'être mis à échouer sans que tu le saches. ' +
      'En relançant le skill sur le dataset après chaque changement, tu vois immédiatement ce qui s\'améliore et ce qui casse. ' +
      'Ici on va créer (ou réutiliser) un dataset pour y glisser le cas de l\'étape 2.',
    Component: Step4,
    isComplete: s => !!s.datasetId,
  },
  {
    title: 'Ajouter l\'input au dataset',
    shortLabel: 'Item',
    why:
      'On colle le cas choisi à l\'étape 2 dans le dataset. Il devient un « item » qu\'on pourra rejouer autant de fois qu\'on veut. ' +
      'Optionnel mais recommandé : écrire l\'output que tu aurais aimé recevoir (en JSON ou texte libre). ' +
      'Ça permet plus tard à un second IA (le « juge ») de noter automatiquement les nouvelles sorties en les comparant à ta référence.',
    Component: Step5,
    isComplete: s => !!s.itemId,
  },
  {
    title: 'Mesurer la baseline',
    shortLabel: 'Baseline',
    why:
      'Avant d\'essayer d\'améliorer quoi que ce soit, on mesure les performances du skill actuel sur tous les items du dataset. ' +
      'Ce résultat (scores moyens, coût, temps) devient la « baseline » — la référence contre laquelle on comparera toutes les versions suivantes. ' +
      'Sans baseline, impossible de dire « c\'est mieux » ou « c\'est pire » : on aurait juste une opinion.',
    Component: Step6,
    isComplete: s => !!s.baselineReport && s.baselineReport.experiment.status === 'done',
  },
  {
    title: 'Itérer dans le playground',
    shortLabel: 'Playground',
    why:
      'Maintenant, l\'amélioration. On écrit 2 ou 3 variantes du prompt (la « v1 » = le prompt actuel, et des v2/v3 = tes idées de correction). ' +
      'On les teste en parallèle sur quelques inputs du dataset, sans toucher au skill en prod. ' +
      'En 30 secondes on voit si une idée marche mieux, moins bien, ou casse des choses — et on ajuste jusqu\'à être content.',
    Component: Step7,
    isComplete: s => !!s.playgroundResult,
  },
  {
    title: 'Choisir la variante gagnante',
    shortLabel: 'Winner',
    why:
      'Parmi les variantes testées, il faut en retenir UNE. ' +
      'Celle avec le meilleur score moyen est suggérée avec un 🏆, mais rien ne t\'empêche d\'en préférer une autre (par exemple plus rapide ou moins chère en tokens). ' +
      'C\'est ton jugement — l\'assistant te donne juste les chiffres pour décider.',
    Component: Step8,
    isComplete: s => s.winnerVariantIndex !== null,
  },
  {
    title: 'Promouvoir la nouvelle version',
    shortLabel: 'Save',
    why:
      'On remplace le prompt actif du skill par ta variante gagnante. À partir de cette seconde, toutes les nouvelles analyses IA utiliseront cette nouvelle version. ' +
      'L\'ancienne n\'est pas perdue : elle reste archivée dans l\'historique du skill et peut être restaurée à l\'étape suivante si besoin.',
    Component: Step9,
    isComplete: s => !!s.newSkillVersionHash,
  },
  {
    title: 'Valider ou rollback',
    shortLabel: 'Check',
    why:
      'Le playground t\'a convaincu sur 2–3 inputs, mais est-ce vraiment mieux sur L\'ENSEMBLE du dataset ? ' +
      'On relance une experiment complète avec la nouvelle version et on affiche les deltas (score par score, coût, temps) face à la baseline. ' +
      'Si c\'est globalement mieux → « Garder ». Si une régression apparaît → « Rollback » pour revenir à l\'ancien prompt en 1 clic.',
    Component: Step10,
    isComplete: s => !!s.finalReport,
  },
];

// ── Shell (Modal + stepper + footer) ─────────────────────────────────

function AssistantShell({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useAssistant();
  const current = state.currentStep;
  const def = STEPS[current];
  const Step = def.Component;

  const isCompleted = useMemo(
    () => STEPS.map((s, i) => s.isComplete(state) || state.completedSteps.includes(i)),
    [state],
  );

  const handleAdvance = () => {
    dispatch({ type: 'COMPLETE_STEP', step: current });
    if (current < STEPS.length - 1) {
      dispatch({ type: 'GOTO', step: current + 1 });
    }
  };

  const handlePrev = () => {
    if (current > 0) dispatch({ type: 'GOTO', step: current - 1 });
  };

  const handleJumpTo = (i: number) => {
    // Only jump to already-completed steps or the current one.
    if (i <= current || isCompleted[i]) dispatch({ type: 'GOTO', step: i });
  };

  const handleReset = () => {
    if (confirm('Tout recommencer ? Les données persistées de cet assistant seront effacées (les datasets/experiments créés restent en place).')) {
      clearStorage();
      dispatch({ type: 'RESET' });
    }
  };

  const canAdvance = def.isComplete(state) || state.completedSteps.includes(current);

  return (
    <Modal title="🚀 Assistant d'amélioration de skill" onClose={onClose} size="xl">
      <div className={styles.root}>
        <Stepper current={current} completed={isCompleted} onJump={handleJumpTo} />

        <div className={styles.content}>
          <header className={styles.stepHeader}>
            <h2 className={styles.stepTitle}>{current + 1}. {def.title}</h2>
            <div className={styles.stepPourquoi}>
              <div className={styles.stepPourquoiLabel}>Pourquoi cette étape ?</div>
              {def.why}
            </div>
          </header>

          <Suspense fallback={<LoadingSpinner message="Chargement…" />}>
            <Step onAdvance={handleAdvance} />
          </Suspense>
        </div>

        <footer className={styles.footer}>
          <Button variant="secondary" onClick={handlePrev} disabled={current === 0}>← Précédent</Button>
          <div className={styles.footerRight}>
            <Button variant="secondary" onClick={handleReset}>⟲ Tout recommencer</Button>
            <Button variant="secondary" onClick={onClose}>Reprendre plus tard</Button>
            <Button
              variant="primary"
              onClick={handleAdvance}
              disabled={!canAdvance || current === STEPS.length - 1}
            >
              {current === STEPS.length - 1 ? 'Terminé' : 'Suivant →'}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

// ── Stepper row ──────────────────────────────────────────────────────

function Stepper({
  current, completed, onJump,
}: { current: number; completed: boolean[]; onJump: (i: number) => void }) {
  return (
    <div className={styles.stepperRow}>
      <span className={styles.stepperCount}>Étape {current + 1} / {STEPS.length}</span>
      <div className={styles.stepperBar}>
        {STEPS.map((s, i) => {
          const isDone = completed[i];
          const isActive = i === current;
          const reachable = isDone || i <= current;
          return (
            <button
              key={s.shortLabel}
              type="button"
              className={`${styles.stepperDot} ${reachable ? styles.stepperDotClickable : ''}`}
              disabled={!reachable}
              onClick={() => reachable && onJump(i)}
              title={s.title}
            >
              <span className={`${styles.stepperBullet} ${isDone ? styles.stepperBulletDone : ''} ${isActive ? styles.stepperBulletActive : ''}`}>
                {isDone ? '✓' : i + 1}
              </span>
              <span className={`${styles.stepperLabel} ${isActive ? styles.stepperLabelActive : ''}`}>
                {s.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Small UI helper re-exported for step components ──────────────────

export function FormBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className={styles.label}>{label}</div>
      {children}
    </div>
  );
}

export { styles as assistantStyles };
