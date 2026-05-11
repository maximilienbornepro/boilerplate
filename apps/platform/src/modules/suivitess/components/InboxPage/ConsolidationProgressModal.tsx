// Loading modal shown while the cross-source consolidation is running.
//
// Same visual language as the bulk-import modal's analyzing phase :
//   - Modal size="xl" (matches BulkTranscriptionImportModal)
//   - LoadingSpinner at the top
//   - A stepped indicator below ('✓ done' / '◉ active pulsing' / '○ pending')
//
// Difference vs the import pipeline : consolidation is ONE LLM call, so
// the backend doesn't expose per-tier progress. The steps below are
// client-driven on a timer to give an honest sense of advancement —
// they line up with what consolidationService actually does on the
// server (fetch rows → snapshot reviews → AI → safety → finalize).

import { useEffect, useState } from 'react';
import { Modal, ModalBody, LoadingSpinner } from '@boilerplate/shared/components';

type StepKey = 'source' | 'context' | 'analyze' | 'validate' | 'finalize';

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'source',   label: 'Lecture des propositions en attente' },
  { key: 'context',  label: 'Préparation du contexte (snapshot des reviews + agrégat des sources)' },
  { key: 'analyze',  label: 'Analyse IA — fusion thématique cross-source' },
  { key: 'validate', label: 'Validation des règles de sécurité (cross-target safety)' },
  { key: 'finalize', label: 'Finalisation' },
];

// Time after which we advance to the next "client-side" step, in ms.
// The big one ('analyze') just stays active until the API responds —
// we never auto-flip past it because that would lie.
const STEP_DELAYS_MS: Record<StepKey, number> = {
  source: 0,
  context: 700,
  analyze: 1600,
  validate: Number.POSITIVE_INFINITY,
  finalize: Number.POSITIVE_INFINITY,
};

interface Props {
  /** Optional summary header shown in the modal title — e.g. "12 propositions · 4 sources". */
  subtitle?: string;
}

export function ConsolidationProgressModal({ subtitle }: Props) {
  const [activeKey, setActiveKey] = useState<StepKey>('source');

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
      // No-op close — the modal is purely informational and lifecycle-
      // driven by the parent (closes when the consolidation resolves).
      onClose={() => { /* swallow */ }}
      title={
        <span>
          Consolidation IA
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
        <LoadingSpinner message="L'IA croise les propositions cross-source et fusionne les doublons thématiques…" />
        <style>{`@keyframes consolidationPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
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
                  animation: stepStatus === 'active' ? 'consolidationPulse 1.2s ease-in-out infinite' : undefined,
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

export default ConsolidationProgressModal;
