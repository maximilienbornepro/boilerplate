import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@boilerplate/shared/components';
import { assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { listRecentInputsForSkill, type RecentInput } from '../assistantApi';

function sourceBadge(kind: string | null): { icon: string; label: string; color: string } {
  const k = (kind ?? '').toLowerCase();
  if (k === 'transcript' || k === 'fathom' || k === 'otter') return { icon: '🎙', label: 'transcript', color: 'var(--accent-primary)' };
  if (k === 'slack')   return { icon: '💬', label: 'slack',   color: '#4a154b' };
  if (k === 'outlook') return { icon: '✉',  label: 'outlook', color: '#0072c6' };
  if (k === 'gmail')   return { icon: '📧', label: 'gmail',   color: '#ea4335' };
  if (k === 'subject') return { icon: '📌', label: 'subject', color: '#6c757d' };
  if (k === 'board')   return { icon: '📊', label: 'board',   color: '#17a2b8' };
  return { icon: '✦', label: k || '—', color: 'var(--text-secondary)' };
}

export default function Step2PickLog({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [rows, setRows] = useState<RecentInput[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!state.skillSlug) return;
    setLoading(true);
    listRecentInputsForSkill(state.skillSlug, 50)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [state.skillSlug]);

  const select = (id: number) => {
    dispatch({ type: 'PATCH', patch: { logId: id, logScores: [], humanVote: null } });
  };

  if (!state.skillSlug) return <p>Reviens à l'étape 1 pour choisir un skill.</p>;
  if (loading || !rows) return <LoadingSpinner message="Chargement des logs…" />;
  if (rows.length === 0) {
    return (
      <p style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
        Aucun log pour le skill <code>{state.skillSlug}</code> pour le moment. Un log est créé à chaque fois qu'on lance une analyse IA (par exemple : analyser une transcription dans un suivitess, réorganiser un board delivery…).
        <br /><br />
        Va dans le module concerné, déclenche une analyse IA, puis reviens ici — ton cas apparaîtra dans cette liste.
      </p>
    );
  }

  return (
    <div className={styles.actionBlock}>
      <p className={styles.statusLine} style={{ lineHeight: 1.5 }}>
        Voici les <strong>{rows.length} derniers logs</strong> du skill. Chaque ligne = un appel IA réel qu'un utilisateur a déclenché. Le badge coloré indique d'où vient l'input (🎙 transcription, 💬 slack, ✉ email…).
        <br />
        👉 Clique sur celui où la sortie de l'IA n'était <strong>pas bonne</strong> (titre/preview qui te semblent problématiques). C'est ce cas qui servira de cobaye pour améliorer le skill.
      </p>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 20 }} />
              <th>Source</th>
              <th>Titre</th>
              <th style={{ textAlign: 'right' }}>#id / chars</th>
              <th>Aperçu</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const badge = sourceBadge(r.source_kind);
              const isSelected = state.logId === r.id;
              return (
                <tr key={r.id} className={isSelected ? styles.selected : ''} onClick={() => select(r.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <input type="radio" checked={isSelected} onChange={() => select(r.id)} />
                  </td>
                  <td>
                    <span className={styles.kindBadge} style={{ background: badge.color }}>
                      {badge.icon} {badge.label}
                    </span>
                  </td>
                  <td>{r.source_title ?? '(sans titre)'}</td>
                  <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>
                    #{r.id}<br />{r.input_length} chars
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.input_preview}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
