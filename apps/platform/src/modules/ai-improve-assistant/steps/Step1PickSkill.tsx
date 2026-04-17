import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { listSkills, type Skill } from '../assistantApi';

export default function Step1PickSkill({ onAdvance }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    listSkills()
      .then(rows => setSkills(rows.filter(s => !s.slug.startsWith('llm-judge'))))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (slug: string) => {
    dispatch({ type: 'PATCH', patch: { skillSlug: slug } });
  };

  if (loading || !skills) return <LoadingSpinner message="Chargement des skills…" />;
  if (skills.length === 0) return <p>Aucun skill configuré.</p>;

  return (
    <div className={styles.actionBlock}>
      <FormBlock label="Skill cible">
        <select
          className={styles.select}
          value={state.skillSlug ?? ''}
          onChange={e => handleSelect(e.target.value)}
        >
          <option value="">— Choisir —</option>
          {skills.map(s => (
            <option key={s.slug} value={s.slug}>{s.name}</option>
          ))}
        </select>
      </FormBlock>

      {state.skillSlug && (() => {
        const s = skills.find(x => x.slug === state.skillSlug);
        if (!s) return null;
        return (
          <div className={styles.stepPourquoi} style={{ marginTop: 'var(--spacing-xs)' }}>
            <div className={styles.stepPourquoiLabel}>{s.name}</div>
            <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>{s.description}</div>
            {s.usage && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 6 }}>
                Module : {s.usage.module} · Endpoint : <code>{s.usage.endpoint}</code>
              </div>
            )}
          </div>
        );
      })()}

      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
        {state.skillSlug
          ? <>Tu as sélectionné un skill. Aux étapes suivantes on va <strong>chercher dans les logs</strong> un cas réel où ce skill s'est mal comporté, puis on essaiera de le corriger. Clique <strong>Suivant</strong>.</>
          : <>Pas sûr(e) duquel choisir ? Prends celui sur lequel tu as déjà vu des erreurs — c'est là qu'on a le plus à apprendre.</>}
      </p>
    </div>
  );
}
