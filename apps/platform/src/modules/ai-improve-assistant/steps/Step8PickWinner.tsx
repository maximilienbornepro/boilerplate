import { useMemo } from 'react';
import { Button } from '@boilerplate/shared/components';
import { assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';

export default function Step8PickWinner({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const result = state.playgroundResult;

  // Aggregate average score per variant (mean across scores & inputs).
  const variantStats = useMemo(() => {
    if (!result) return [];
    return result.variants.map((v, vi) => {
      const cells = result.cells.filter(c => c.variantIndex === vi);
      const allScores = cells.flatMap(c => c.scores.map(s => s.value));
      const avg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
      const totalCost = cells.reduce((a, c) => a + c.costUsd, 0);
      const totalMs = cells.reduce((a, c) => a + c.durationMs, 0);
      return {
        index: vi,
        label: v.label,
        shortHash: v.shortHash,
        avg,
        cellCount: cells.length,
        totalCost,
        totalMs,
      };
    });
  }, [result]);

  const bestIdx = useMemo(() => {
    if (variantStats.length === 0) return null;
    const sorted = [...variantStats].sort((a, b) => b.avg - a.avg);
    return sorted[0]?.index ?? null;
  }, [variantStats]);

  if (!result) return <p>Reviens à l'étape 7 pour exécuter le playground.</p>;

  const select = (idx: number) => {
    const chosen = state.variants[idx];
    dispatch({ type: 'PATCH', patch: { winnerVariantIndex: idx, promotedContent: chosen.content } });
  };

  return (
    <div className={styles.actionBlock}>
      <p className={styles.statusLine} style={{ lineHeight: 1.5 }}>
        Le tableau ci-dessous résume chaque variante du playground en un chiffre : la moyenne de tous les scores sur toutes les cellules.
        <br />
        Le 🏆 pointe la variante avec la meilleure moyenne — mais ce n'est qu'une suggestion. Tu peux préférer :
        <br />
        • une variante <strong>légèrement moins bonne mais plus rapide</strong> (coût ↓)
        <br />
        • une variante dont tu aimes mieux la sortie <em>visuellement</em> même si le score est proche
        <br />
        • la <strong>v1 (current)</strong> si aucune des variantes testées n'apporte d'amélioration nette — dans ce cas, reviens à l'étape 7 pour tester d'autres idées.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: 20 }} />
            <th>Variante</th>
            <th style={{ textAlign: 'right' }}>Score moyen</th>
            <th style={{ textAlign: 'right' }}>Coût</th>
            <th style={{ textAlign: 'right' }}>Durée cumulée</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {variantStats.map(v => {
            const isBest = v.index === bestIdx;
            const isSelected = state.winnerVariantIndex === v.index;
            return (
              <tr key={v.index} className={isSelected ? styles.selected : ''}>
                <td>{isBest ? '🏆' : ''}</td>
                <td>
                  <strong>{v.label}</strong> <code style={{ fontSize: 11, color: 'var(--text-secondary)' }}>v {v.shortHash}</code>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent-primary)' }}>
                  {v.avg.toFixed(2)}
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>
                    ({v.cellCount} cellules)
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontSize: 11 }}>${v.totalCost.toFixed(4)}</td>
                <td style={{ textAlign: 'right', fontSize: 11 }}>{Math.round(v.totalMs / 1000)}s</td>
                <td style={{ textAlign: 'right' }}>
                  <Button variant={isSelected ? 'primary' : 'secondary'} onClick={() => select(v.index)}>
                    {isSelected ? '✓ Choisie' : 'Sélectionner'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state.winnerVariantIndex !== null && (
        <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(76,175,80,0.08)', borderLeft: '3px solid var(--success, #4caf50)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          ✓ Variante <strong>{state.variants[state.winnerVariantIndex].label}</strong> retenue. À l'étape 9 tu pourras la relire et l'ajuster avant de la déployer — puis à l'étape 10 on vérifie qu'elle bat vraiment la baseline sur tout le dataset (pas juste sur les 1–2 inputs testés ici).
        </div>
      )}
    </div>
  );
}
