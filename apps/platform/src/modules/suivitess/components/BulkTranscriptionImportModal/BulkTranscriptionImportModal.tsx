import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { Document } from '../../types';
import styles from './BulkTranscriptionImportModal.module.css';

interface Props {
  onClose: () => void;
  onDone: (summary: { imported: number; createdReviews: number }) => void;
}

type Phase = 'loading' | 'routing' | 'importing' | 'done' | 'error';

/** Chosen destination for each item — user can override the AI suggestion. */
interface Destination {
  /** 'existing' → `docId` required. 'new' → `newTitle` required. */
  action: 'existing' | 'new' | 'skip';
  docId: string | null;
  newTitle: string | null;
}

interface RowState {
  item: api.BulkSourceItem;
  suggestion: api.RoutingSuggestion | null;
  destination: Destination;
  /** Per-row import state during the run */
  runState: 'idle' | 'running' | 'ok' | 'error';
  runError?: string;
}

export function BulkTranscriptionImportModal({ onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [existingReviews, setExistingReviews] = useState<Document[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, ko: 0 });

  // ============ Initial load ============
  useEffect(() => {
    (async () => {
      try {
        const [items, reviews] = await Promise.all([
          api.fetchBulkSources(),
          api.fetchDocuments(),
        ]);
        setExistingReviews(reviews);
        if (items.length === 0) {
          setRows([]);
          setPhase('routing');
          return;
        }
        // Call AI routing
        let routing: api.RoutingResponse;
        try {
          routing = await api.fetchRoutingSuggestions(items);
        } catch {
          routing = {
            summary: 'Suggestions IA indisponibles — choisissez manuellement la destination de chaque item.',
            suggestions: items.map(i => ({
              itemId: i.id,
              suggestedAction: 'new',
              suggestedDocId: null,
              suggestedNewTitle: i.title.slice(0, 80),
              confidence: 'low',
              reasoning: '',
            })),
          };
        }
        setSummary(routing.summary);

        const byItemId = new Map(routing.suggestions.map(s => [s.itemId, s]));
        const newRows: RowState[] = items.map(it => {
          const sug = byItemId.get(it.id) ?? null;
          const destination: Destination = sug
            ? (sug.suggestedAction === 'existing' && sug.suggestedDocId
                ? { action: 'existing', docId: sug.suggestedDocId, newTitle: null }
                : { action: 'new', docId: null, newTitle: sug.suggestedNewTitle || it.title.slice(0, 80) })
            : { action: 'new', docId: null, newTitle: it.title.slice(0, 80) };
          return { item: it, suggestion: sug, destination, runState: 'idle' };
        });
        setRows(newRows);
        setPhase('routing');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Chargement échoué');
        setPhase('error');
      }
    })();
  }, []);

  // ============ Derived state ============
  const stats = useMemo(() => {
    let existing = 0, creating = 0, skip = 0;
    for (const r of rows) {
      if (r.destination.action === 'existing') existing++;
      else if (r.destination.action === 'new') creating++;
      else skip++;
    }
    return { existing, creating, skip };
  }, [rows]);

  const changeAction = (itemId: string, action: 'existing' | 'new' | 'skip') => {
    setRows(prev => prev.map(r => {
      if (r.item.id !== itemId) return r;
      if (action === 'existing') {
        const firstDoc = existingReviews[0]?.id ?? null;
        return {
          ...r,
          destination: { action, docId: r.destination.docId ?? firstDoc, newTitle: null },
        };
      }
      if (action === 'new') {
        return {
          ...r,
          destination: {
            action,
            docId: null,
            newTitle: r.destination.newTitle
              ?? r.suggestion?.suggestedNewTitle
              ?? r.item.title.slice(0, 80),
          },
        };
      }
      return { ...r, destination: { action: 'skip', docId: null, newTitle: null } };
    }));
  };

  const changeDocId = (itemId: string, docId: string) => {
    setRows(prev => prev.map(r =>
      r.item.id === itemId
        ? { ...r, destination: { ...r.destination, action: 'existing', docId, newTitle: null } }
        : r,
    ));
  };

  const changeNewTitle = (itemId: string, newTitle: string) => {
    setRows(prev => prev.map(r =>
      r.item.id === itemId
        ? { ...r, destination: { ...r.destination, action: 'new', docId: null, newTitle } }
        : r,
    ));
  };

  // ============ Apply ============
  const handleImport = async () => {
    const todo = rows.filter(r => r.destination.action !== 'skip');
    if (todo.length === 0) return;

    setPhase('importing');
    setProgress({ done: 0, total: todo.length, ok: 0, ko: 0 });

    // Cache of "new review title → newly created docId" so multiple items
    // targeting the same new title all go into the same review.
    const createdByTitle = new Map<string, string>();
    let createdCount = 0;

    for (const r of todo) {
      let targetDocId = r.destination.docId;

      if (r.destination.action === 'new') {
        const title = (r.destination.newTitle || r.item.title).trim().slice(0, 100);
        const cached = createdByTitle.get(title);
        if (cached) {
          targetDocId = cached;
        } else {
          try {
            const doc = await api.createDocument(title, undefined, 'private');
            createdByTitle.set(title, doc.id);
            targetDocId = doc.id;
            createdCount++;
          } catch (err: unknown) {
            setRows(prev => prev.map(x =>
              x.item.id === r.item.id
                ? { ...x, runState: 'error', runError: (err instanceof Error ? err.message : 'Création review échouée') }
                : x,
            ));
            setProgress(p => ({ ...p, done: p.done + 1, ko: p.ko + 1 }));
            continue;
          }
        }
      }

      if (!targetDocId) {
        setRows(prev => prev.map(x =>
          x.item.id === r.item.id
            ? { ...x, runState: 'error', runError: 'Aucune destination' }
            : x,
        ));
        setProgress(p => ({ ...p, done: p.done + 1, ko: p.ko + 1 }));
        continue;
      }

      setRows(prev => prev.map(x => x.item.id === r.item.id ? { ...x, runState: 'running' } : x));
      try {
        await api.importTranscriptionIntoDocument(targetDocId, {
          callId: r.item.id,
          callTitle: r.item.title,
          provider: r.item.provider,
          useAI: true,
        });
        setRows(prev => prev.map(x => x.item.id === r.item.id ? { ...x, runState: 'ok' } : x));
        setProgress(p => ({ ...p, done: p.done + 1, ok: p.ok + 1 }));
      } catch (err: unknown) {
        setRows(prev => prev.map(x =>
          x.item.id === r.item.id
            ? { ...x, runState: 'error', runError: (err instanceof Error ? err.message : 'Import échoué') }
            : x,
        ));
        setProgress(p => ({ ...p, done: p.done + 1, ko: p.ko + 1 }));
      }
    }

    setPhase('done');
    onDone({ imported: todo.filter((_, i) => rows[i]?.runState === 'ok').length, createdReviews: createdCount });
  };

  // ============ Render ============
  return (
    <Modal title="✨ Importer & ranger" onClose={onClose} size="xl">
      <div className={styles.content}>
        {phase === 'loading' && (
          <div className={styles.loading}>
            <LoadingSpinner message="Récupération des transcriptions et emails, l'IA décide où les ranger…" />
          </div>
        )}

        {phase === 'error' && (
          <div className={styles.error}>
            <strong>Chargement impossible</strong>
            <p>{error}</p>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        )}

        {phase === 'routing' && rows.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Aucun nouvel item à importer.</p>
            <p className={styles.emptyHint}>Tous vos calls et emails récents ont déjà été traités.</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>D'accord</Button>
            </div>
          </div>
        )}

        {phase === 'routing' && rows.length > 0 && (
          <>
            <div className={styles.summary}>{summary}</div>
            <div className={styles.toolbar}>
              <div className={styles.counter}>
                <span>{stats.existing} vers une review existante</span>
                <span>·</span>
                <span>{stats.creating} → nouvelle review</span>
                {stats.skip > 0 && <><span>·</span><span>{stats.skip} ignorés</span></>}
              </div>
            </div>

            <div className={styles.list}>
              {rows.map(r => (
                <RoutingRow
                  key={r.item.id}
                  row={r}
                  reviews={existingReviews}
                  onChangeAction={a => changeAction(r.item.id, a)}
                  onChangeDocId={id => changeDocId(r.item.id, id)}
                  onChangeNewTitle={t => changeNewTitle(r.item.id, t)}
                />
              ))}
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Annuler</Button>
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={rows.every(r => r.destination.action === 'skip')}
              >
                Importer ({rows.length - stats.skip})
              </Button>
            </div>
          </>
        )}

        {phase === 'importing' && (
          <div className={styles.importing}>
            <LoadingSpinner
              message={`Import en cours… ${progress.done}/${progress.total} (${progress.ok} OK · ${progress.ko} erreurs)`}
            />
            <div className={styles.list}>
              {rows.map(r => (
                <RoutingRow
                  key={r.item.id}
                  row={r}
                  reviews={existingReviews}
                  disabled
                  onChangeAction={() => {}}
                  onChangeDocId={() => {}}
                  onChangeNewTitle={() => {}}
                />
              ))}
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className={styles.done}>
            <p className={styles.doneTitle}>Import terminé</p>
            <p className={styles.doneHint}>
              {progress.ok} item(s) importés · {progress.ko} erreur(s).
            </p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ==================== Row ====================

function RoutingRow({
  row, reviews, disabled,
  onChangeAction, onChangeDocId, onChangeNewTitle,
}: {
  row: RowState;
  reviews: Document[];
  disabled?: boolean;
  onChangeAction: (a: 'existing' | 'new' | 'skip') => void;
  onChangeDocId: (id: string) => void;
  onChangeNewTitle: (t: string) => void;
}) {
  const { item, suggestion, destination, runState, runError } = row;

  return (
    <div className={`${styles.row} ${runState === 'ok' ? styles.rowOk : ''} ${runState === 'error' ? styles.rowError : ''}`}>
      <div className={styles.rowHead}>
        <div className={styles.rowInfo}>
          <span className={`${styles.providerTag} ${styles[`provider_${item.provider}`]}`}>{item.provider}</span>
          <span className={styles.rowTitle}>{item.title}</span>
          {item.date && <span className={styles.rowDate}>{formatDate(item.date)}</span>}
        </div>
        {suggestion && (
          <span className={`${styles.confidence} ${styles[`conf_${suggestion.confidence}`]}`}>
            IA · {confLabel(suggestion.confidence)}
          </span>
        )}
      </div>

      {suggestion?.reasoning && (
        <p className={styles.reasoning}>{suggestion.reasoning}</p>
      )}

      <div className={styles.destination}>
        <label className={styles.radio}>
          <input
            type="radio"
            name={`dest-${item.id}`}
            checked={destination.action === 'existing'}
            disabled={disabled || reviews.length === 0}
            onChange={() => onChangeAction('existing')}
          />
          <span>Vers review existante</span>
          {destination.action === 'existing' && (
            <select
              className={styles.select}
              value={destination.docId ?? ''}
              disabled={disabled}
              onChange={e => onChangeDocId(e.target.value)}
            >
              {reviews.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          )}
        </label>

        <label className={styles.radio}>
          <input
            type="radio"
            name={`dest-${item.id}`}
            checked={destination.action === 'new'}
            disabled={disabled}
            onChange={() => onChangeAction('new')}
          />
          <span>Nouvelle review</span>
          {destination.action === 'new' && (
            <input
              className={styles.input}
              type="text"
              placeholder="Titre de la nouvelle review"
              value={destination.newTitle ?? ''}
              disabled={disabled}
              onChange={e => onChangeNewTitle(e.target.value)}
              maxLength={100}
            />
          )}
        </label>

        <label className={styles.radio}>
          <input
            type="radio"
            name={`dest-${item.id}`}
            checked={destination.action === 'skip'}
            disabled={disabled}
            onChange={() => onChangeAction('skip')}
          />
          <span>Ignorer</span>
        </label>
      </div>

      {runState === 'running' && <div className={styles.runState}>Import en cours…</div>}
      {runState === 'ok' && <div className={`${styles.runState} ${styles.runOk}`}>✓ Importé</div>}
      {runState === 'error' && <div className={`${styles.runState} ${styles.runError}`}>✗ {runError || 'Erreur'}</div>}
    </div>
  );
}

// ==================== Helpers ====================

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function confLabel(c: 'high' | 'medium' | 'low'): string {
  return c === 'high' ? 'haute confiance' : c === 'low' ? 'à valider' : 'moyenne';
}
