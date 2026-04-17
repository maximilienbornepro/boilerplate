import { useEffect, useState } from 'react';
import { Button, LoadingSpinner } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import SkillEditor from '../SkillEditor';
import {
  getDatasetDetail,
  getSkillDetail,
  runPlayground,
  type PlaygroundResult,
} from '../assistantApi';

interface Variant { label: string; content: string }
interface InputPick { itemId: number; label: string; content: string; selected: boolean }

export default function Step7Playground({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [variants, setVariants] = useState<Variant[]>(state.variants.length > 0 ? state.variants : []);
  const [items, setItems] = useState<InputPick[]>([]);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlaygroundResult | null>(state.playgroundResult);

  // Seed : v1 = current skill content ; v2 = empty copy for edits.
  // Also load the dataset items so the user can pick 1–2 inputs.
  useEffect(() => {
    if (!state.skillSlug || !state.datasetId) return;
    if (variants.length > 0 && items.length > 0) return;
    setLoadingSeed(true);
    Promise.all([
      getSkillDetail(state.skillSlug),
      getDatasetDetail(state.datasetId),
    ])
      .then(([skill, ds]) => {
        if (variants.length === 0) {
          setVariants([
            { label: 'current', content: skill.content },
            { label: 'v2 (édite moi)', content: skill.content },
          ]);
          // Save the original content so the final-step can rollback.
          dispatch({ type: 'PATCH', patch: { originalSkillContent: skill.content } });
        }
        // Default : first 2 items pre-selected.
        setItems(ds.items.map((it, idx) => ({
          itemId: it.id,
          label: `item #${it.id}`,
          content: it.input_content,
          selected: idx < 2,
        })));
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoadingSeed(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.skillSlug, state.datasetId]);

  const patchVariant = (i: number, patch: Partial<Variant>) => {
    setVariants(v => v.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  };
  const addVariant = () => {
    const last = variants[variants.length - 1]?.content ?? '';
    setVariants(v => [...v, { label: `v${v.length + 1}`, content: last }]);
  };
  const removeVariant = (i: number) => setVariants(v => v.filter((_, idx) => idx !== i));
  const toggleItem = (id: number) => setItems(i => i.map(x => x.itemId === id ? { ...x, selected: !x.selected } : x));

  const doRun = async () => {
    if (!state.skillSlug) return;
    const selectedItems = items.filter(i => i.selected);
    const nonEmptyVariants = variants.filter(v => v.content.trim().length > 0);
    if (nonEmptyVariants.length === 0 || selectedItems.length === 0) {
      setError('Sélectionne au moins 1 variante et 1 input.');
      return;
    }
    if (nonEmptyVariants.length * selectedItems.length > 40) {
      setError('Matrice trop grande (max 40 cellules)');
      return;
    }
    setRunning(true); setError('');
    try {
      const res = await runPlayground({
        skillSlug: state.skillSlug,
        variants: nonEmptyVariants,
        inputs: selectedItems.map(i => ({ label: i.label, content: i.content })),
      });
      setResult(res);
      dispatch({ type: 'PATCH', patch: { variants: nonEmptyVariants, playgroundResult: res } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setRunning(false); }
  };

  if (loadingSeed) return <LoadingSpinner message="Préparation des variantes et inputs…" />;
  if (!state.skillSlug || !state.datasetId) return <p>Reviens aux étapes précédentes.</p>;

  return (
    <div className={styles.actionBlock}>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        Ici tu testes des variantes du prompt <strong>sans toucher au skill en prod</strong>. La <strong>v1 "current"</strong> est ton prompt actuel (copie de référence — ne la modifie pas). La <strong>v2</strong> est ton terrain d'expérimentation — modifie-la pour corriger ce qui a mal marché à l'étape 3.
        <br />
        Chaque cellule de la matrice (variante × input) = 1 appel IA + les scorers. Max 40 cellules pour éviter d'exploser les coûts.
      </p>

      {/* Variants */}
      <FormBlock label={`Variantes du prompt (${variants.length})`}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: -2, marginBottom: 8 }}>
          Chaque variante = une version modifiée du skill à tester. L'éditeur propose 3 vues : <strong>Éditer</strong> (textarea numérotée), <strong>Aperçu</strong> (markdown rendu), <strong>Diff vs v1</strong> (ce que tu as changé vs la v1 current). Utilise l'outline de gauche pour sauter de section en section.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
          {variants.map((v, i) => {
            // v1 content = variants[0], used as reference for all others.
            const referenceContent = i === 0 ? null : variants[0]?.content ?? null;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 'var(--spacing-xs)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', gap: 'var(--spacing-xs)', alignItems: 'center' }}>
                  <input
                    className={styles.input}
                    style={{ width: 160 }}
                    value={v.label}
                    onChange={e => patchVariant(i, { label: e.target.value })}
                    placeholder="label de la variante"
                  />
                  <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)' }}>
                    {i === 0 ? '(version actuelle — ne pas modifier)' : 'variante à tester'}
                  </span>
                  {variants.length > 1 && (
                    <Button variant="secondary" onClick={() => removeVariant(i)}>× retirer</Button>
                  )}
                </div>
                <SkillEditor
                  value={v.content}
                  onChange={next => patchVariant(i, { content: next })}
                  refContent={referenceContent}
                  refLabel={variants[0]?.label ?? 'v1'}
                  minHeight={280}
                />
              </div>
            );
          })}
          <Button variant="secondary" onClick={addVariant}>＋ Ajouter une variante</Button>
        </div>
      </FormBlock>

      {/* Inputs picker (from dataset) */}
      <FormBlock label={`Inputs à tester (depuis le dataset ${state.datasetName})`}>
        {items.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Le dataset n'a aucun item. Retourne à l'étape 5.
          </p>
        ) : (
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            <table className={styles.table}>
              <thead><tr><th style={{ width: 20 }} /><th>Item</th><th>Aperçu</th></tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.itemId} className={it.selected ? styles.selected : ''} onClick={() => toggleItem(it.itemId)} style={{ cursor: 'pointer' }}>
                    <td><input type="checkbox" checked={it.selected} onChange={() => toggleItem(it.itemId)} /></td>
                    <td>#{it.itemId}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.content.slice(0, 200)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FormBlock>

      {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}

      <Button variant="primary" onClick={doRun} disabled={running}>
        {running ? 'Exécution…' : `▶ Run all (${variants.filter(v => v.content.trim()).length} × ${items.filter(i => i.selected).length})`}
      </Button>

      {result && <MatrixPreview result={result} />}
    </div>
  );
}

function MatrixPreview({ result }: { result: PlaygroundResult }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '8px 0', lineHeight: 1.5 }}>
        ✓ {result.cells.length} cellules exécutées. Chaque cellule montre la sortie + les scores auto (0–1).
        <br />
        Si une variante produit des outputs <em>visiblement</em> différents ou des scores différents, tu as une piste. Sinon, modifie plus les variantes et re-run. À l'étape 8 on comparera les moyennes.
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Variante</th>
            {result.inputs.map((inp, i) => <th key={i}>{inp.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {result.variants.map((v, vi) => (
            <tr key={vi}>
              <th>{v.label}<br /><code style={{ fontSize: 10 }}>v {v.shortHash}</code></th>
              {result.inputs.map((_, ii) => {
                const cell = result.cells.find(c => c.variantIndex === vi && c.inputIndex === ii);
                if (!cell) return <td key={ii}>—</td>;
                return (
                  <td key={ii} style={{ fontSize: 11, maxWidth: 260 }}>
                    <div style={{ maxHeight: 100, overflow: 'hidden', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                      {cell.output.slice(0, 200)}…
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {cell.scores.map(s => (
                        <span key={`${s.kind}:${s.name}`} style={{ fontSize: 10, color: 'var(--accent-primary)' }}>
                          {s.name}:{s.value.toFixed(2)}
                        </span>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
