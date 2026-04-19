import { useEffect, useRef, useState } from 'react';
import { Button } from '@boilerplate/shared/components';
import { assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import {
  getExperimentReport,
  pollExperimentUntilDone,
  startExperiment,
  type Experiment,
  type ExperimentReport,
} from '../assistantApi';

export default function Step6Baseline({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [launching, setLaunching] = useState(false);
  const [exp, setExp] = useState<Experiment | null>(null);
  const [report, setReport] = useState<ExperimentReport | null>(state.baselineReport);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // If we already have a baselineReport in state (e.g. user navigated back),
  // skip the launch UI entirely.
  const alreadyDone = !!state.baselineReport && state.baselineReport.experiment.status === 'done';

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const launch = async () => {
    if (!state.datasetId) return;
    setLaunching(true); setError('');
    try {
      const e = await startExperiment({
        datasetId: state.datasetId,
        name: `baseline-${new Date().toISOString().slice(0, 16)}`,
      });
      setExp(e);
      dispatch({ type: 'PATCH', patch: { baselineExperimentId: e.id } });

      abortRef.current = new AbortController();
      const final = await pollExperimentUntilDone(e.id, {
        onProgress: (live) => setExp(live),
        signal: abortRef.current.signal,
      });
      setExp(final);
      if (final.status === 'done') {
        const fullReport = await getExperimentReport(e.id);
        setReport(fullReport);
        dispatch({ type: 'PATCH', patch: { baselineReport: fullReport } });
      } else if (final.status === 'error') {
        setError(final.error || 'Experiment en erreur');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setLaunching(false); }
  };

  if (!state.datasetId) return <p>Dataset manquant — reviens aux étapes précédentes.</p>;

  // Display the report if we have one.
  if (alreadyDone && report) {
    return <BaselineReport report={report} />;
  }

  // Hard stop : can't launch a baseline on an empty dataset. Step5 should
  // have blocked this, but we defend against stale state / direct nav.
  const itemCount = state.datasetItemCount;
  if (itemCount <= 0) {
    return (
      <div style={{
        padding: 'var(--spacing-md)',
        background: 'rgba(255,152,0,0.1)',
        border: '1px solid var(--warning, #ff9800)',
        borderLeft: '4px solid var(--warning, #ff9800)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, marginBottom: 8 }}>
          ⚠ Impossible de lancer la baseline — le dataset est vide
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          Le dataset <strong>« {state.datasetName} »</strong> (<code>#{state.datasetId}</code>) ne contient
          aucun item. Une baseline a besoin d'au moins 1 cas pour produire un chiffre de référence.
        </p>
        <Button variant="primary" onClick={() => dispatch({ type: 'GOTO', step: 4 })}>
          ↩ Retour étape 5 pour ajouter des items
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.actionBlock}>
      <p className={styles.statusLine} style={{ lineHeight: 1.5 }}>
        On va <strong>rejouer le skill tel qu'il est aujourd'hui</strong> sur <strong>{itemCount} item{itemCount > 1 ? 's' : ''}</strong> du dataset <strong>{state.datasetName}</strong> — chaque item = un appel complet à l'IA (donc ça coûte quelques centimes et prend ~10–30 s par item). Les scorers automatiques tournent ensuite sur chaque sortie.
        <br />
        Résultat : une « photo » chiffrée des performances actuelles. C'est contre cette photo qu'on comparera toutes les variantes testées après.
      </p>

      {!exp && !report && (
        <Button variant="primary" onClick={launch} disabled={launching}>
          {launching ? 'Démarrage…' : `▶ Lancer la baseline sur ${itemCount} item${itemCount > 1 ? 's' : ''}`}
        </Button>
      )}

      {exp && exp.status !== 'done' && (
        <ProgressBox experiment={exp} />
      )}

      {report && <BaselineReport report={report} />}

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
        Status : <strong>{experiment.status}</strong> · {done}/{total} items traités ({pct}%)
      </div>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BaselineReport({ report }: { report: ExperimentReport }) {
  const scoreEntries = Object.entries(report.summary.avgByScore);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
      <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(76,175,80,0.08)', borderLeft: '3px solid var(--success, #4caf50)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
        ✓ Baseline experiment #{report.experiment.id} terminée sur {report.summary.itemCount} item(s). Ces chiffres sont maintenant notre référence — ils vont apparaître en face des résultats de la nouvelle version à l'étape 10.
      </div>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Items</div>
          <div className={styles.summaryValue}>{report.summary.itemCount}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Durée cumulée</div>
          <div className={styles.summaryValue}>{Math.round(report.summary.totalDurationMs / 1000)}s</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Coût total</div>
          <div className={styles.summaryValue}>${report.summary.totalCostUsd.toFixed(4)}</div>
        </div>
        {scoreEntries.map(([key, s]) => (
          <div key={key} className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{key}</div>
            <div className={styles.summaryValue}>{s.avg.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>n={s.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
