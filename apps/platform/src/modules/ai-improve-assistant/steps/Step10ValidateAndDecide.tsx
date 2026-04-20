import { useEffect, useRef, useState } from 'react';
import { Button } from '@boilerplate/shared/components';
import { assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import {
  getExperimentReport,
  pollExperimentUntilDone,
  saveSkillContent,
  startExperiment,
  type Experiment,
  type ExperimentReport,
} from '../assistantApi';

export default function Step10ValidateAndDecide({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [exp, setExp] = useState<Experiment | null>(null);
  const [report, setReport] = useState<ExperimentReport | null>(state.finalReport);
  const [launching, setLaunching] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [decision, setDecision] = useState<'kept' | 'rolled-back' | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Auto-launch the validation experiment when we land here with a fresh
  // promoted version and no report yet.
  useEffect(() => {
    if (!state.datasetId || !state.newSkillVersionHash) return;
    if (state.finalReport || state.finalExperimentId || launching) return;
    launch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.datasetId, state.newSkillVersionHash]);

  const launch = async () => {
    if (!state.datasetId) return;
    setLaunching(true); setError('');
    try {
      const e = await startExperiment({
        datasetId: state.datasetId,
        name: `validation-${new Date().toISOString().slice(0, 16)}`,
      });
      setExp(e);
      dispatch({ type: 'PATCH', patch: { finalExperimentId: e.id } });

      abortRef.current = new AbortController();
      const final = await pollExperimentUntilDone(e.id, {
        onProgress: live => setExp(live),
        signal: abortRef.current.signal,
      });
      setExp(final);
      if (final.status === 'done') {
        const fullReport = await getExperimentReport(e.id);
        setReport(fullReport);
        dispatch({ type: 'PATCH', patch: { finalReport: fullReport } });
      } else if (final.status === 'error') {
        setError(final.error || 'Experiment en erreur');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setLaunching(false); }
  };

  const keep = () => setDecision('kept');
  const rollback = async () => {
    if (!state.skillSlug || !state.originalSkillContent) return;
    setRolling(true); setError('');
    try {
      await saveSkillContent(state.skillSlug, state.originalSkillContent);
      setDecision('rolled-back');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setRolling(false); }
  };

  if (!state.datasetId || !state.newSkillVersionHash) {
    return <p>Reviens aux étapes précédentes : dataset et version du skill manquants.</p>;
  }

  return (
    <div className={styles.actionBlock}>
      {exp && exp.status !== 'done' && !report && <ProgressBox experiment={exp} />}

      {report && state.baselineReport && (
        <Comparison baseline={state.baselineReport} final={report} />
      )}

      {report && !decision && (
        <>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 'var(--spacing-sm)', marginBottom: 0 }}>
            <strong>Comment interpréter les Δ ci-dessus ?</strong>
            <br />
            • <span className={styles.deltaUp}>+0.xx vert</span> = amélioration sur ce critère. Plus c'est positif, mieux c'est (sauf pour le coût et la durée où le ↓ est bon).
            <br />
            • <span className={styles.deltaDown}>-0.xx rouge</span> = régression. Même petite, à prendre au sérieux si elle tombe sur un critère important (ex. json_valid, faithfulness).
            <br />
            • <span className={styles.deltaNeutral}>≈ 0</span> = aucun changement — ta modification n'a probablement pas eu d'effet sur ce critère.
            <br /><br />
            <strong>Quelle décision ?</strong> Si la majorité des scores progresse et qu'aucune régression grave n'apparaît → garde. Sinon, rollback et retour à l'étape 7 pour essayer une autre piste.
          </p>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={rollback} disabled={rolling || !state.originalSkillContent}>
              {rolling ? 'Restauration…' : '⟲ Rollback — restaurer l\'ancienne version'}
            </Button>
            <Button variant="primary" onClick={keep}>
              ✓ Garder la nouvelle version
            </Button>
          </div>
        </>
      )}

      {decision === 'kept' && (
        <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(76,175,80,0.08)', borderLeft: '3px solid var(--success, #4caf50)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          ✓ Décision : <strong>garder</strong>. Le skill <code>{state.skillSlug}</code> tourne déjà en prod avec le nouveau prompt. Tu peux fermer l'assistant.
          <br />
          Le dataset reste, tu peux l'enrichir de nouveaux cas problématiques plus tard et relancer l'assistant quand tu veux — chaque cycle est une mesure de plus de progrès.
        </div>
      )}
      {decision === 'rolled-back' && (
        <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(255,152,0,0.08)', borderLeft: '3px solid var(--warning, #ff9800)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          ⟲ Décision : <strong>rollback</strong>. L'ancien prompt est réactivé, la version testée est archivée (consultable et ré-activable via la page /ai-logs ou directement dans l'admin).
          <br />
          Pas de regret : tu as gagné une donnée précieuse — tu sais que <em>cette</em> variante ne marche pas. Reviens à l'étape 7 dans l'assistant pour en essayer une autre, ou récolte d'autres cas problématiques dans le dataset avant de recommencer.
        </div>
      )}

      {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}
    </div>
  );
}

function ProgressBox({ experiment }: { experiment: Experiment }) {
  const done = experiment.runs_done ?? 0;
  const total = experiment.item_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className={styles.statusLine}>
        Validation en cours — {done}/{total} items ({pct}%) · status : <strong>{experiment.status}</strong>
      </div>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Comparison({ baseline, final }: { baseline: ExperimentReport; final: ExperimentReport }) {
  // Build a row per score key : baseline avg / final avg / delta.
  const keys = Array.from(new Set([
    ...Object.keys(baseline.summary.avgByScore),
    ...Object.keys(final.summary.avgByScore),
  ])).sort();

  const costDelta = final.summary.totalCostUsd - baseline.summary.totalCostUsd;
  const msDelta = final.summary.totalDurationMs - baseline.summary.totalDurationMs;

  const fmtDelta = (d: number, digits = 2) => {
    if (Math.abs(d) < 1 / Math.pow(10, digits + 1)) return <span className={styles.deltaNeutral}>≈ 0</span>;
    return d > 0
      ? <span className={styles.deltaUp}>+{d.toFixed(digits)}</span>
      : <span className={styles.deltaDown}>{d.toFixed(digits)}</span>;
  };

  return (
    <div>
      <div className={styles.statusLine} style={{ marginBottom: 8 }}>
        Comparaison <strong>baseline #{baseline.experiment.id}</strong> vs <strong>validation #{final.experiment.id}</strong>.
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Métrique</th>
            <th style={{ textAlign: 'right' }}>Baseline</th>
            <th style={{ textAlign: 'right' }}>Nouvelle version</th>
            <th style={{ textAlign: 'right' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(k => {
            const b = baseline.summary.avgByScore[k]?.avg ?? 0;
            const f = final.summary.avgByScore[k]?.avg ?? 0;
            return (
              <tr key={k}>
                <td>{k}</td>
                <td style={{ textAlign: 'right' }}>{b.toFixed(2)}</td>
                <td style={{ textAlign: 'right' }}>{f.toFixed(2)}</td>
                <td style={{ textAlign: 'right' }}>{fmtDelta(f - b)}</td>
              </tr>
            );
          })}
          <tr>
            <td>Coût total ($)</td>
            <td style={{ textAlign: 'right' }}>${baseline.summary.totalCostUsd.toFixed(4)}</td>
            <td style={{ textAlign: 'right' }}>${final.summary.totalCostUsd.toFixed(4)}</td>
            <td style={{ textAlign: 'right' }}>{fmtDelta(costDelta, 4)}</td>
          </tr>
          <tr>
            <td>Durée cumulée (s)</td>
            <td style={{ textAlign: 'right' }}>{Math.round(baseline.summary.totalDurationMs / 1000)}s</td>
            <td style={{ textAlign: 'right' }}>{Math.round(final.summary.totalDurationMs / 1000)}s</td>
            <td style={{ textAlign: 'right' }}>{fmtDelta(msDelta / 1000, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
