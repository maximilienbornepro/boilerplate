import { useState } from 'react';
import { Button } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { addItemFromLog } from '../assistantApi';

export default function Step5AddItem({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (!state.datasetId || !state.logId) return;
    setAdding(true); setError('');
    try {
      // `expected` is free text; try to JSON.parse, otherwise store as a string.
      let expectedOutput: unknown = null;
      const trimmed = expected.trim();
      if (trimmed.length > 0) {
        try { expectedOutput = JSON.parse(trimmed); }
        catch { expectedOutput = trimmed; }
      }
      const item = await addItemFromLog(state.datasetId, state.logId, expectedOutput, notes || null);
      dispatch({ type: 'PATCH', patch: { itemId: item.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setAdding(false); }
  };

  if (!state.datasetId || !state.logId) return <p>Dataset ou log manquant — reviens aux étapes précédentes.</p>;

  return (
    <div className={styles.actionBlock}>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        On prend l'input brut du log choisi à l'étape 2 et on le colle dans le dataset <strong>{state.datasetName}</strong> en tant que nouvel « item ». À partir de là, le cas peut être rejoué autant qu'on veut, même après des dizaines de modifications du skill.
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
          👁 <strong>À quoi ça sert ?</strong> Un 2ᵉ IA (le « juge ») peut comparer cet output attendu aux futures sorties du skill et leur mettre une note de fidélité 0–1. Sans ça, le juge évalue seulement la cohérence générale.
          <br />
          Laisse vide si tu veux juste que les scorers automatiques (JSON valide, nb propositions, latence…) tournent.
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
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
          Mémo interne pour toi et ton équipe. Visible plus tard dans la table des items du dataset.
        </p>
      </FormBlock>

      {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}

      {!state.itemId ? (
        <Button variant="primary" onClick={go} disabled={adding}>
          {adding ? 'Ajout en cours…' : 'Ajouter ce log au dataset'}
        </Button>
      ) : (
        <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(76,175,80,0.08)', borderLeft: '3px solid var(--success, #4caf50)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          ✓ Item #{state.itemId} ajouté au dataset <strong>{state.datasetName}</strong>. À l'étape suivante, on va rejouer le skill <em>actuel</em> sur ce cas (et les autres items du dataset s'il y en a) pour établir les scores de référence.
        </div>
      )}
    </div>
  );
}
