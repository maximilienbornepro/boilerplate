import { useState } from 'react';
import { Button } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import SkillEditor from '../SkillEditor';
import { listSkillVersions, saveSkillContent } from '../assistantApi';

export default function Step9Promote({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [draft, setDraft] = useState(state.promotedContent ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!state.skillSlug || state.winnerVariantIndex === null) {
    return <p>Choisis d'abord une variante à l'étape 8.</p>;
  }

  // If the user navigates back here after save, prefer the DB version hash.
  const savedHash = state.newSkillVersionHash;
  const originalContent = state.originalSkillContent ?? '';
  const contentChanged = draft !== originalContent;

  const save = async () => {
    if (!state.skillSlug || draft.trim().length === 0) return;
    setSaving(true); setError('');
    try {
      await saveSkillContent(state.skillSlug, draft);
      // Fetch the new version list to capture the freshly-saved hash.
      const versions = await listSkillVersions(state.skillSlug);
      const current = versions.find(v => v.isCurrent);
      dispatch({ type: 'PATCH', patch: {
        promotedContent: draft,
        newSkillVersionHash: current?.hash ?? null,
      }});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setSaving(false); }
  };

  return (
    <div className={styles.actionBlock}>
      <p className={styles.statusLine} style={{ lineHeight: 1.5 }}>
        Dernière chance de <strong>relire et d'ajuster</strong> le prompt avant déploiement. Dès que tu cliques « Sauvegarder », toutes les <em>prochaines</em> analyses IA (transcriptions, imports…) utiliseront ce contenu.
        <br />
        Pas d'inquiétude : l'ancien prompt n'est pas écrasé, il est archivé dans l'historique des versions. L'étape 10 pourra le restaurer en 1 clic si les mesures ne sont pas bonnes.
      </p>

      <FormBlock label="Contenu de la nouvelle version">
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: -2, marginBottom: 6 }}>
          L'onglet <strong>Diff vs v1</strong> te montre exactement ce que ta variante change par rapport au prompt actuellement en prod. Vérifie avant de sauvegarder.
        </p>
        <SkillEditor
          value={draft}
          onChange={setDraft}
          refContent={state.originalSkillContent ?? null}
          refLabel="v1 prod"
          disabled={saving}
          minHeight={360}
        />
      </FormBlock>

      {!contentChanged && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          ⚠ Le contenu est <strong>exactement identique</strong> à la version active. La sauvegarde ne créera pas de nouvelle version distincte. Si c'est intentionnel (tu as choisi la v1 current à l'étape 8), continue — sinon, reviens éditer à l'étape 7.
        </p>
      )}
      {error && <div style={{ color: 'var(--error, #f44336)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}

      {!savedHash ? (
        <Button variant="primary" onClick={save} disabled={saving || draft.trim().length === 0}>
          {saving ? 'Sauvegarde…' : '💾 Sauvegarder comme nouvelle version'}
        </Button>
      ) : (
        <div style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', background: 'rgba(76,175,80,0.08)', borderLeft: '3px solid var(--success, #4caf50)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          ✓ Nouvelle version sauvegardée — identifiant court : <code>{savedHash.slice(0, 7)}</code>. Le skill est <strong>déjà en prod avec ce nouveau prompt</strong>. L'étape 10 va lancer automatiquement une vérification sur tout le dataset pour confirmer qu'on a bien progressé.
        </div>
      )}
    </div>
  );
}
