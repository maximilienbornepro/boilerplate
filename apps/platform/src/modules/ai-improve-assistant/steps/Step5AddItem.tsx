import { useEffect, useState } from 'react';
import { Button } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { addItemFromLog, getDatasetDetail } from '../assistantApi';

export default function Step5AddItem({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // On mount AND after each add : fetch the real dataset to get the
  // current item count. This is the ONLY truth — state.itemId is stale
  // as soon as the user picks a different dataset or comes back later.
  const refreshCount = async () => {
    if (!state.datasetId) return;
    setRefreshing(true);
    try {
      const ds = await getDatasetDetail(state.datasetId);
      setItemCount(ds.items.length);
      dispatch({ type: 'PATCH', patch: { datasetItemCount: ds.items.length } });
    } catch {
      /* non-fatal — keep the previous count */
    } finally { setRefreshing(false); }
  };

  useEffect(() => {
    refreshCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.datasetId]);

  const go = async () => {
    if (!state.datasetId || !state.logId) return;
    setAdding(true); setError('');
    try {
      let expectedOutput: unknown = null;
      const trimmed = expected.trim();
      if (trimmed.length > 0) {
        try { expectedOutput = JSON.parse(trimmed); }
        catch { expectedOutput = trimmed; }
      }
      const item = await addItemFromLog(state.datasetId, state.logId, expectedOutput, notes || null);
      setLastAddedId(item.id);
      dispatch({ type: 'PATCH', patch: { itemId: item.id } });
      // Reset the form so the user can add another case right away.
      setExpected('');
      setNotes('');
      // Re-fetch the real count.
      await refreshCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setAdding(false); }
  };

  if (!state.datasetId || !state.logId) return <p>Dataset ou log manquant — reviens aux étapes précédentes.</p>;

  const count = itemCount ?? 0;
  const hasAtLeastOne = count > 0;

  return (
    <div className={styles.actionBlock}>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        On prend l'input brut du log choisi à l'étape 2 et on le colle dans le dataset <strong>{state.datasetName}</strong> en tant que nouvel « item ». À partir de là, le cas peut être rejoué autant qu'on veut, même après des dizaines de modifications du skill.
        <br />
        <strong>Minimum requis pour passer à l'étape suivante : 1 item dans le dataset.</strong> Tu peux en ajouter plusieurs si tu veux tester plusieurs cas types — reviens à l'étape 2 entre chaque ajout pour choisir un autre log.
      </p>

      {/* ── Live count of the dataset ── */}
      <div style={{
        padding: 'var(--spacing-sm) var(--spacing-md)',
        background: hasAtLeastOne ? 'rgba(76,175,80,0.08)' : 'rgba(255,152,0,0.08)',
        borderLeft: `3px solid ${hasAtLeastOne ? 'var(--success, #4caf50)' : 'var(--warning, #ff9800)'}`,
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        fontSize: 'var(--font-size-sm)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ flex: 1 }}>
          Dataset <strong>{state.datasetName}</strong> (<code>#{state.datasetId}</code>) contient actuellement&nbsp;
          <strong style={{ color: hasAtLeastOne ? 'var(--success, #4caf50)' : 'var(--warning, #ff9800)' }}>
            {count} item{count > 1 ? 's' : ''}
          </strong>.
          {!hasAtLeastOne && <> Ajoute au moins un cas ci-dessous pour pouvoir avancer.</>}
          {hasAtLeastOne && <> Tu peux avancer à l'étape 6, ou en ajouter d'autres ci-dessous.</>}
        </span>
        <Button variant="secondary" onClick={refreshCount} disabled={refreshing}>
          {refreshing ? '…' : '🔄 Rafraîchir'}
        </Button>
        <a
          href={`/ai-evals/${state.datasetId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            padding: '4px 10px',
            border: '1px solid var(--accent-primary)',
            color: 'var(--accent-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textDecoration: 'none',
            borderRadius: 2,
            whiteSpace: 'nowrap',
          }}
        >↗ Voir</a>
      </div>

      {/* ── Form to add the current log as a new item ── */}
      <FormBlock label="Ajouter le log courant comme item">
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: -2, marginBottom: 8 }}>
          Tu ajoutes <strong>le log #{state.logId}</strong> (choisi à l'étape 2). L'input brut de ce log devient le « cas » — il pourra être rejoué par toutes les variantes de l'étape 7.
        </p>

        <FormBlock label="Output attendu (optionnel, JSON ou texte libre)">
          <textarea
            className={styles.textarea}
            value={expected}
            onChange={e => setExpected(e.target.value)}
            placeholder='Ex (JSON) : [{"action":"enrich","subjectId":"…","appendText":"Migration validée mercredi"}]&#10;&#10;Ou en texte libre : « Devrait détecter le sujet Migration DB existant et l&apos;enrichir sans créer de doublon. »'
            disabled={adding}
          />
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
            👁 <strong>À quoi ça sert ?</strong> Un 2ᵉ IA (le « juge ») peut comparer cet output attendu aux futures sorties du skill et leur mettre une note de fidélité 0–1. Laisse vide si tu veux juste les scorers automatiques.
          </p>
        </FormBlock>

        <FormBlock label="Notes sur ce cas (optionnel)">
          <input
            className={styles.input}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Ex : « doublon Migration DB non détecté — devrait enrichir »"
            disabled={adding}
          />
        </FormBlock>

        {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}

        <Button variant="primary" onClick={go} disabled={adding}>
          {adding ? 'Ajout en cours…' : hasAtLeastOne ? '＋ Ajouter un autre item' : '＋ Ajouter ce log au dataset'}
        </Button>

        {lastAddedId != null && (
          <div style={{
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            background: 'rgba(76,175,80,0.08)',
            borderLeft: '3px solid var(--success, #4caf50)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            fontSize: 'var(--font-size-sm)',
            marginTop: 8,
          }}>
            ✓ Item <code>#{lastAddedId}</code> ajouté juste maintenant. Le dataset contient désormais <strong>{count}</strong> item{count > 1 ? 's' : ''}.
          </div>
        )}
      </FormBlock>
    </div>
  );
}
