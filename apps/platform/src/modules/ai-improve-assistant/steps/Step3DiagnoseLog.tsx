import { useEffect, useState } from 'react';
import { Button, LoadingSpinner } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { getLogDetail, listScoresForLog, voteLog, type LogDetail, type ScoreRow } from '../assistantApi';

export default function Step3DiagnoseLog({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!state.logId) return;
    setLoading(true);
    Promise.all([
      getLogDetail(state.logId),
      listScoresForLog(state.logId),
    ])
      .then(([d, s]) => { setDetail(d); setScores(s); dispatch({ type: 'PATCH', patch: { logScores: s } }); })
      .catch(() => { /* best-effort */ })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.logId]);

  const submit = async (value: -1 | 1) => {
    if (!state.logId) return;
    setVoting(true);
    try {
      await voteLog(state.logId, value, note || undefined);
      const refreshed = await listScoresForLog(state.logId);
      setScores(refreshed);
      dispatch({ type: 'PATCH', patch: { humanVote: value, logScores: refreshed } });
    } finally { setVoting(false); }
  };

  if (!state.logId) return <p>Aucun log sélectionné — reviens à l'étape précédente.</p>;
  if (loading || !detail) return <LoadingSpinner message="Chargement du log…" />;

  return (
    <div className={styles.actionBlock}>
      {/* Input → Output */}
      <FormBlock label="📥 Input brut (ce que l'utilisateur a fourni)">
        <pre className={styles.codeBlock}>{detail.input_content.slice(0, 1200) || '(vide)'}{detail.input_content.length > 1200 ? ' […]' : ''}</pre>
      </FormBlock>
      <FormBlock label="📤 Sortie produite par l'IA">
        <pre className={styles.codeBlock}>{detail.ai_output_raw.slice(0, 1200) || '(vide)'}{detail.ai_output_raw.length > 1200 ? ' […]' : ''}</pre>
      </FormBlock>

      {/* Scores actuels */}
      <FormBlock label="⭐ Scores automatiques déjà calculés">
        {scores.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Pas encore de score pour ce log. C'est normal s'il est très récent ou très ancien — les scorers automatiques (validation JSON, nombre de propositions, latence, fidélité par un juge IA) tournent en arrière-plan et peuvent mettre quelques secondes.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 6 }}>
              Chaque ligne = un critère évalué automatiquement sur une échelle 0–1. <code>heuristic</code> = test logique (JSON valide, nb propositions…), <code>llm-judge</code> = un 2ᵉ IA qui note la qualité.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 'var(--font-size-sm)' }}>
              {scores.map(s => (
                <li key={s.id}>
                  <strong>{s.scorer_kind}:{s.score_name}</strong> — {parseFloat(s.score_value).toFixed(2)}
                  {s.rationale && <span style={{ color: 'var(--text-secondary)' }}> — {s.rationale}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </FormBlock>

      {/* Vote humain */}
      <div className={styles.stepPourquoi} style={{ borderLeftColor: state.humanVote === 1 ? 'var(--success, #4caf50)' : state.humanVote === -1 ? 'var(--error, #f44336)' : 'var(--accent-primary)' }}>
        <div className={styles.stepPourquoiLabel}>Ton diagnostic</div>
        <p style={{ margin: '6px 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          Après avoir lu l'input et la sortie ci-dessus : à ton avis, la réponse de l'IA est-elle <strong>correcte</strong> ou <strong>mauvaise</strong> ?
          <br />
          Écris en une phrase <em>ce qui ne va pas</em> (ou pourquoi c'est bon). Cette note deviendra la boussole des étapes suivantes — c'est elle qui définit ce qu'on essaie d'améliorer.
        </p>
        <input
          type="text"
          className={styles.input}
          placeholder="Ex : « n'a pas détecté que ce sujet existait déjà en section Backend », « a inventé une date de mise en prod »…"
          value={note}
          onChange={e => setNote(e.target.value)}
          disabled={voting}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginTop: 8 }}>
          <Button variant="secondary" onClick={() => submit(-1)} disabled={voting}>👎 Mauvaise sortie</Button>
          <Button variant="primary"   onClick={() => submit(1)}  disabled={voting}>👍 Sortie correcte</Button>
        </div>
        {state.humanVote !== null && (
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 6 }}>
            ✓ Diagnostic enregistré ({state.humanVote === 1 ? '👍 correct' : '👎 à améliorer'}). Ta note est stockée avec le log et visible dans /ai-logs — elle resservira plus tard pour mesurer si tes corrections marchent.
          </p>
        )}
      </div>
    </div>
  );
}
