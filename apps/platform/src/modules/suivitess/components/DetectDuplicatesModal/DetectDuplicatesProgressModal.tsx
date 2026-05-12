// Loading modal shown while the cross-doc duplicate detection runs.
//
// Mirrors the visual language of ConsolidationProgressModal :
//   - Modal size="xl"
//   - LoadingSpinner at the top
//   - A stepped indicator below ('✓ done' / '◉ active pulsing' / '○ pending')
//
// Steps are client-driven on a timer — the API is a single round-trip so
// the backend doesn't expose per-tier progress. The "analyze" step
// stays active until the API responds (we never auto-flip past it).

import { useEffect, useState } from 'react';
import { Modal, ModalBody, LoadingSpinner } from '@boilerplate/shared/components';

type StepKey = 'portfolio' | 'filter' | 'analyze' | 'validate' | 'finalize';

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'portfolio', label: 'Lecture du portefeuille' },
  { key: 'filter',    label: 'Filtrage des paires déjà liées' },
  { key: 'analyze',   label: 'Analyse IA — détection sémantique des doublons' },
  { key: 'validate',  label: 'Validation des règles de sécurité' },
  { key: 'finalize',  label: 'Finalisation' },
];

const STEP_DELAYS_MS: Record<StepKey, number> = {
  portfolio: 0,
  filter:    700,
  analyze:   1600,
  validate:  Number.POSITIVE_INFINITY,
  finalize:  Number.POSITIVE_INFINITY,
};

interface Props {
  /** Optional subtitle — e.g. "146 sujets dans le portefeuille". */
  subtitle?: string;
}

export function DetectDuplicatesProgressModal({ subtitle }: Props) {
  const [activeKey, setActiveKey] = useState<StepKey>('portfolio');

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const step of STEPS) {
      const delay = STEP_DELAYS_MS[step.key];
      if (!Number.isFinite(delay) || delay <= 0) continue;
      timers.push(setTimeout(() => setActiveKey(step.key), delay));
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, []);

  const activeIdx = STEPS.findIndex(s => s.key === activeKey);

  return (
    <Modal
      // Informational only — closing is driven by the parent when the
      // API resolves. Swallow the close prop to keep the API happy.
      onClose={() => { /* swallow */ }}
      title={
        <span>
          Détection des doublons
          {subtitle && (
            <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 400 }}>
              · {subtitle}
            </span>
          )}
        </span>
      }
      size="xl"
    >
      <ModalBody>
        <LoadingSpinner message="L'IA croise tes sujets et cherche les doublons sémantiques cross-documents…" />
        <style>{`@keyframes duplicateDetectionPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: '16px auto 0',
          maxWidth: 560,
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.8,
        }}>
          {STEPS.map((step, i) => {
            const stepStatus: 'done' | 'active' | 'pending' =
              i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
            const color =
              stepStatus === 'done' ? 'var(--accent-primary)' :
              stepStatus === 'active' ? 'var(--accent-primary)' :
              'var(--text-secondary)';
            const opacity = stepStatus === 'pending' ? 0.45 : 1;
            const marker =
              stepStatus === 'done' ? '✓' :
              stepStatus === 'active' ? '◉' :
              '○';
            return (
              <li key={step.key} style={{ color, opacity, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  display: 'inline-block', width: 14, textAlign: 'center', fontWeight: 700,
                  animation: stepStatus === 'active' ? 'duplicateDetectionPulse 1.2s ease-in-out infinite' : undefined,
                }}>
                  {marker}
                </span>
                <span>{step.label}</span>
              </li>
            );
          })}
        </ul>
      </ModalBody>
    </Modal>
  );
}

export default DetectDuplicatesProgressModal;
