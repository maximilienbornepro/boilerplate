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

interface Variant { label: string; content: string; selected: boolean }
interface InputPick { itemId: number; label: string; content: string; selected: boolean }

export default function Step7Playground({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [variants, setVariants] = useState<Variant[]>(state.variants.length > 0 ? state.variants : []);
  const [items, setItems] = useState<InputPick[]>([]);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlaygroundResult | null>(state.playgroundResult);

  // Seed : v1 = current skill content ; v2 = empty copy for edits.
  // Also load the dataset items so the user can pick 1–2 inputs.
  // Refactored as a reusable loader — called on mount AND by the
  // "🔄 Rafraîchir" button so items added in step 5 after the first load
  // show up without rebuilding the variants.
  const loadSeed = async (keepVariants: boolean) => {
    if (!state.skillSlug || !state.datasetId) return;
    try {
      const [skill, ds] = await Promise.all([
        getSkillDetail(state.skillSlug),
        getDatasetDetail(state.datasetId),
      ]);
      if (!keepVariants || variants.length === 0) {
        setVariants([
          { label: 'current', content: skill.content, selected: true },
          { label: 'v2 (édite moi)', content: skill.content, selected: true },
        ]);
        dispatch({ type: 'PATCH', patch: { originalSkillContent: skill.content } });
      }
      // Preserve current selection state when refreshing.
      const prevSelected = new Set(items.filter(i => i.selected).map(i => i.itemId));
      setItems(ds.items.map((it, idx) => ({
        itemId: it.id,
        label: `item #${it.id}`,
        content: it.input_content,
        selected: prevSelected.size > 0 ? prevSelected.has(it.id) : idx < 2,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  };

  useEffect(() => {
    if (!state.skillSlug || !state.datasetId) return;
    if (variants.length > 0 && items.length > 0) return;
    setLoadingSeed(true);
    loadSeed(true).finally(() => setLoadingSeed(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.skillSlug, state.datasetId]);

  const refresh = async () => {
    setRefreshing(true); setError('');
    await loadSeed(true);
    setRefreshing(false);
  };

  const goBackToStep5 = () => dispatch({ type: 'GOTO', step: 4 }); // 0-indexed : step 5 = index 4

  const patchVariant = (i: number, patch: Partial<Variant>) => {
    setVariants(v => v.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  };
  const addVariant = () => {
    const last = variants[variants.length - 1]?.content ?? '';
    setVariants(v => [...v, { label: `v${v.length + 1}`, content: last, selected: true }]);
  };
  const removeVariant = (i: number) => setVariants(v => v.filter((_, idx) => idx !== i));
  const toggleVariant = (i: number) => setVariants(v => v.map((x, idx) => idx === i ? { ...x, selected: !x.selected } : x));
  const toggleItem = (id: number) => setItems(i => i.map(x => x.itemId === id ? { ...x, selected: !x.selected } : x));

  const doRun = async () => {
    if (!state.skillSlug) return;
    const selectedItems = items.filter(i => i.selected);
    const nonEmptyVariants = variants.filter(v => v.selected && v.content.trim().length > 0);
    if (nonEmptyVariants.length === 0 || selectedItems.length === 0) {
      setError('Coche au moins 1 variante ET 1 cas du dataset avant de lancer.');
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
      <div style={{
        padding: 'var(--spacing-sm) var(--spacing-md)',
        background: 'rgba(102,126,234,0.08)',
        borderLeft: '3px solid var(--accent-primary)',
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        fontSize: 'var(--font-size-sm)', lineHeight: 1.5, margin: 0,
      }}>
        <strong>Comment ça marche :</strong>
        <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          <li>
            <strong>Coche les variantes du prompt</strong> que tu veux tester (bloc <em>Variantes</em> ci-dessous).
            La <strong>v1</strong> est ton prompt actuel (référence, toujours cochée par défaut).
            La <strong>v2</strong> est une copie éditable — modifie-la pour corriger ce qui clochait à l'étape 3.
          </li>
          <li>
            <strong>Coche les cas du dataset</strong> à rejouer (bloc <em>Cas à rejouer</em>). Chaque cas = un
            exemple réel capturé dans tes logs précédents.
          </li>
          <li>
            Clique <strong>▶ Run all</strong>. Chaque cellule (variante × cas) = 1 appel IA + scorers. Max 40 cellules.
          </li>
        </ol>
      </div>

      {/* Variants */}
      <FormBlock label={`Variantes du prompt — ${variants.filter(v => v.selected).length} / ${variants.length} cochée(s)`}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: -2, marginBottom: 8 }}>
          Chaque variante = une version modifiée du skill à tester. <strong>Coche</strong> les variantes que tu
          veux lancer, décoche celles que tu veux ignorer pour ce run. L'éditeur propose 3 vues :
          <strong> Éditer</strong>, <strong>Aperçu</strong>, <strong>Diff vs v1</strong>.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          {variants.map((v, i) => {
            const referenceContent = i === 0 ? null : variants[0]?.content ?? null;
            const isBaseline = i === 0;
            // Visual identity per variant : v1 neutral, v2+ accent color.
            const badgeColor = isBaseline ? 'var(--text-secondary)' : 'var(--accent-primary)';
            const badgeBg = isBaseline ? 'var(--bg-secondary, rgba(128,128,128,0.08))' : 'var(--accent-primary)';
            const badgeFg = isBaseline ? 'var(--text-primary)' : '#0a0a0a';
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                padding: 'var(--spacing-sm)',
                border: `1px solid ${isBaseline ? 'var(--border-color)' : badgeColor}`,
                borderLeft: `4px solid ${badgeColor}`,
                borderRadius: 'var(--radius-sm)',
              }}>
                {/* Header row 1 : checkbox + badge + role description. */}
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    checked={v.selected}
                    onChange={() => toggleVariant(i)}
                    title={v.selected ? 'Décocher pour exclure cette variante du run' : 'Cocher pour inclure cette variante dans le run'}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                  />
                  <span style={{
                    padding: '4px 12px',
                    background: badgeBg,
                    color: badgeFg,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    borderRadius: 2,
                    whiteSpace: 'nowrap',
                    opacity: v.selected ? 1 : 0.5,
                  }}>
                    v{i + 1}
                  </span>
                  <span style={{
                    flex: 1,
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    opacity: v.selected ? 1 : 0.5,
                  }}>
                    {isBaseline
                      ? <>🔒 Ton prompt <em>actuel</em> — référence en lecture seule</>
                      : <>✏️ Variante <em>à tester</em> — édite ce prompt pour corriger ce qui ne marchait pas</>}
                  </span>
                  {!isBaseline && variants.length > 1 && (
                    <Button variant="secondary" onClick={() => removeVariant(i)}>× retirer</Button>
                  )}
                </div>
                {/* Header row 2 : label input (secondary). */}
                <div style={{ display: 'flex', gap: 'var(--spacing-xs)', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 60 }}>Libellé&nbsp;:</span>
                  <input
                    className={styles.input}
                    style={{ flex: 1, maxWidth: 360 }}
                    value={v.label}
                    onChange={e => patchVariant(i, { label: e.target.value })}
                    placeholder={isBaseline ? 'current' : 'ex : « sans emojis dans les situations »'}
                    disabled={isBaseline}
                  />
                </div>
                <SkillEditor
                  value={v.content}
                  onChange={next => patchVariant(i, { content: next })}
                  refContent={referenceContent}
                  refLabel={variants[0]?.label ?? 'v1'}
                  minHeight={280}
                  disabled={isBaseline}
                />
              </div>
            );
          })}
          <Button variant="secondary" onClick={addVariant}>＋ Ajouter une variante</Button>
        </div>
      </FormBlock>

      {/* Inputs picker (from dataset) */}
      <FormBlock label={`Cas à rejouer — issus du dataset « ${state.datasetName} »`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>
            {items.length === 0
              ? <>Le dataset <code>#{state.datasetId}</code> n'a <strong>aucun item</strong>. Ajoutes-en depuis l'étape 5.</>
              : <>
                <strong>{items.filter(i => i.selected).length} / {items.length}</strong> item(s) sélectionné(s).
                {' '}Coche les lignes que tu veux rejouer. Chaque cellule (variante × input) = 1 appel IA.
              </>}
          </span>
          <Button variant="secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? '…' : '🔄 Rafraîchir'}
          </Button>
          {items.length === 0 && (
            <Button variant="primary" onClick={goBackToStep5}>↩ Retour étape 5</Button>
          )}
          {items.length > 0 && (
            <>
              <Button variant="secondary" onClick={() => setItems(is => is.map(x => ({ ...x, selected: true })))}>Tout cocher</Button>
              <Button variant="secondary" onClick={() => setItems(is => is.map(x => ({ ...x, selected: false })))}>Tout décocher</Button>
            </>
          )}
        </div>
        {items.length === 0 ? null : (
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
            {items.map(it => {
              const onToggle = () => toggleItem(it.itemId);
              return (
                <div
                  key={it.itemId}
                  onClick={onToggle}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: 'var(--spacing-xs) var(--spacing-sm)',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    background: it.selected ? 'rgba(102,126,234,0.08)' : 'transparent',
                    borderLeft: it.selected ? '3px solid var(--accent-primary)' : '3px solid transparent',
                  }}
                >
                  {/* Big visible checkbox */}
                  <input
                    type="checkbox"
                    checked={it.selected}
                    onChange={onToggle}
                    onClick={e => e.stopPropagation()}
                    style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                      item #{it.itemId}
                      <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-secondary)' }}>
                        · {it.content.length.toLocaleString()} chars
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      lineHeight: 1.4,
                    }}>
                      {it.content.slice(0, 300)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </FormBlock>

      {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}

      <Button variant="primary" onClick={doRun} disabled={running}>
        {running
          ? 'Exécution…'
          : `▶ Run all — ${variants.filter(v => v.selected && v.content.trim()).length} variante(s) × ${items.filter(i => i.selected).length} cas = ${variants.filter(v => v.selected && v.content.trim()).length * items.filter(i => i.selected).length} cellule(s)`}
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
