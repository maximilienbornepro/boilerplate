import { useState, useEffect } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import { TicketCreateModal } from '../TicketCreateModal/TicketCreateModal';
import type { TargetService } from '../TicketCreateModal/TicketCreateModal';
import styles from './SubjectAnalysisModal.module.css';

interface Suggestion {
  subjectId: string;
  subjectTitle: string;
  needsAction: boolean;
  suggestedService: TargetService | null;
  reason: string;
  suggestedTitle: string;
  suggestedDescription: string;
}

interface Props {
  documentId: string;
  onClose: () => void;
  onDone: () => void;
}

const API_BASE = '/suivitess-api';

const SERVICE_LABELS: Record<TargetService, string> = {
  jira: 'Jira',
  notion: 'Notion',
  roadmap: 'Roadmap',
};

const SERVICE_COLORS: Record<TargetService, string> = {
  jira: '#0052CC',
  notion: '#000000',
  roadmap: '#8b5cf6',
};

export function SubjectAnalysisModal({ documentId, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<Suggestion | null>(null);
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API_BASE}/documents/${documentId}/analyze-subjects-for-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
      .then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((data: { suggestions: Suggestion[] }) => {
        setSuggestions(data.suggestions || []);
        setSelected(new Set((data.suggestions || []).map(s => s.subjectId)));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Analyse echouee'))
      .finally(() => setLoading(false));
  }, [documentId]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleCreateNext = () => {
    const next = suggestions.find(s => selected.has(s.subjectId) && !processedIds.has(s.subjectId));
    setCurrent(next || null);
    if (!next) onDone();
  };

  const handleCreated = () => {
    if (current) {
      setProcessedIds(prev => new Set([...prev, current.subjectId]));
    }
    setCurrent(null);
  };

  const remaining = suggestions.filter(s => selected.has(s.subjectId) && !processedIds.has(s.subjectId)).length;

  return (
    <>
      <Modal title="Analyse IA — Creation de tickets" onClose={onClose}>
        <div className={styles.content}>
          {loading ? (
            <p className={styles.loading}>L'IA analyse les sujets...</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : suggestions.length === 0 ? (
            <p className={styles.empty}>Aucun sujet ne necessite la creation d'un ticket.</p>
          ) : (
            <>
              <p className={styles.intro}>
                {suggestions.length} sujet{suggestions.length > 1 ? 's' : ''} pourrai{suggestions.length > 1 ? 'ent' : 't'} beneficier d'un ticket. Decochez ceux que vous ne souhaitez pas traiter.
              </p>
              <div className={styles.list}>
                {suggestions.map(s => (
                  <label key={s.subjectId} className={`${styles.item} ${processedIds.has(s.subjectId) ? styles.processed : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(s.subjectId)}
                      onChange={() => toggle(s.subjectId)}
                      disabled={processedIds.has(s.subjectId)}
                    />
                    <div className={styles.itemContent}>
                      <div className={styles.itemHeader}>
                        <span className={styles.itemTitle}>{s.subjectTitle}</span>
                        {s.suggestedService && (
                          <span
                            className={styles.badge}
                            style={{ background: SERVICE_COLORS[s.suggestedService] }}
                          >
                            {SERVICE_LABELS[s.suggestedService]}
                          </span>
                        )}
                        {processedIds.has(s.subjectId) && <span className={styles.check}>✓</span>}
                      </div>
                      <p className={styles.reason}>{s.reason}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div className={styles.actions}>
                <Button variant="secondary" onClick={onClose}>Fermer</Button>
                <Button variant="primary" onClick={handleCreateNext} disabled={remaining === 0}>
                  {remaining === 0
                    ? 'Terminé'
                    : `Creer ${remaining} ticket${remaining > 1 ? 's' : ''}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {current && (
        <TicketCreateModal
          subjectId={current.subjectId}
          subjectTitle={current.suggestedTitle}
          subjectSituation={current.suggestedDescription}
          initialService={current.suggestedService || undefined}
          onClose={() => setCurrent(null)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}

export default SubjectAnalysisModal;
