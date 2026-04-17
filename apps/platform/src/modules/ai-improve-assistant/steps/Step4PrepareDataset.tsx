import { useEffect, useState } from 'react';
import { Button, LoadingSpinner } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { createDataset, listDatasets, type Dataset } from '../assistantApi';

export default function Step4PrepareDataset({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [existing, setExisting] = useState<Dataset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!state.skillSlug) return;
    setLoading(true);
    listDatasets(state.skillSlug)
      .then(rows => {
        setExisting(rows);
        if (rows.length === 0) setMode('create');
      })
      .catch(() => setExisting([]))
      .finally(() => setLoading(false));
  }, [state.skillSlug]);

  const pickExisting = (d: Dataset) => {
    dispatch({ type: 'PATCH', patch: { datasetId: d.id, datasetName: d.name } });
  };

  const doCreate = async () => {
    if (!state.skillSlug || !newName.trim()) return;
    setCreating(true); setError('');
    try {
      const ds = await createDataset({ name: newName.trim(), skillSlug: state.skillSlug, description: newDesc || null });
      dispatch({ type: 'PATCH', patch: { datasetId: ds.id, datasetName: ds.name } });
      // Refresh list so the UI shows the new one if the user goes back.
      setExisting(prev => prev ? [ds, ...prev] : [ds]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setCreating(false); }
  };

  if (!state.skillSlug) return <p>Reviens à l'étape 1 pour choisir un skill.</p>;
  if (loading || !existing) return <LoadingSpinner message="Recherche des datasets existants…" />;

  return (
    <div className={styles.actionBlock}>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {existing.length > 0
          ? <>Tu peux soit <strong>réutiliser un dataset existant</strong> (si tu travailles sur un type de bug récurrent), soit <strong>en créer un nouveau</strong> (pour isoler une campagne d'amélioration précise). Peu importe le choix — le log de l'étape 2 y sera ajouté à l'étape suivante.</>
          : <>Aucun dataset existant pour ce skill. On va donc en créer un — pense à un nom qui résume les cas que tu veux regrouper (ex : « bugs doublons », « transcriptions FireTV », « oubli de responsable »).</>}
      </p>

      <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
        <Button variant={mode === 'pick' ? 'primary' : 'secondary'} onClick={() => setMode('pick')} disabled={existing.length === 0}>
          Utiliser un existant ({existing.length})
        </Button>
        <Button variant={mode === 'create' ? 'primary' : 'secondary'} onClick={() => setMode('create')}>
          ＋ Créer un nouveau
        </Button>
      </div>

      {mode === 'pick' && (
        existing.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Aucun dataset existant pour ce skill. Clique sur « ＋ Créer un nouveau ».
          </p>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className={styles.table}>
              <thead><tr><th style={{ width: 20 }} /><th>Nom</th><th>Items</th><th>Créé</th></tr></thead>
              <tbody>
                {existing.map(d => (
                  <tr key={d.id} className={state.datasetId === d.id ? styles.selected : ''} style={{ cursor: 'pointer' }} onClick={() => pickExisting(d)}>
                    <td><input type="radio" checked={state.datasetId === d.id} onChange={() => pickExisting(d)} /></td>
                    <td>{d.name}</td>
                    <td style={{ textAlign: 'right' }}>{d.item_count ?? 0}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {mode === 'create' && (
        <>
          <FormBlock label="Nom du dataset">
            <input
              className={styles.input}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder='Ex: "bugs doublons — oct 2025"'
              disabled={creating}
            />
          </FormBlock>
          <FormBlock label="Description (optionnel)">
            <input
              className={styles.input}
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="À quoi sert ce dataset ? Quels types de cas ?"
              disabled={creating}
            />
          </FormBlock>
          {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}
          <Button variant="primary" onClick={doCreate} disabled={creating || !newName.trim()}>
            {creating ? 'Création…' : 'Créer le dataset'}
          </Button>
        </>
      )}

      {state.datasetId && state.datasetName && (
        <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(76,175,80,0.08)', borderLeft: '3px solid var(--success, #4caf50)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)' }}>
          ✓ Dataset <strong>{state.datasetName}</strong> sélectionné (#{state.datasetId}).
        </div>
      )}
    </div>
  );
}
