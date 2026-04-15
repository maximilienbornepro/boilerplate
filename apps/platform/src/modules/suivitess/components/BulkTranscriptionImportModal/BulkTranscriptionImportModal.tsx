import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import styles from './BulkTranscriptionImportModal.module.css';

interface Props {
  onClose: () => void;
  onDone: (summary: { importedSubjects: number; createdReviews: number; createdSections: number }) => void;
}

type Phase = 'picking' | 'analyzing' | 'routing' | 'applying' | 'done' | 'error';

/** Per-subject user-overridable routing choice. */
interface Row {
  key: string; // stable id for React keys (index-based)
  subject: api.AnalyzedSubject;
  /** Target review — either an existing id OR null meaning "new review" */
  reviewId: string | null;
  newReviewTitle: string; // only used when reviewId == null
  /** Target section — either an existing id OR null meaning "new section" */
  sectionId: string | null;
  newSectionName: string; // only used when sectionId == null
  skipped: boolean;
}

export function BulkTranscriptionImportModal({ onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('picking');
  const [error, setError] = useState('');

  // Step 1 — picking
  const [sources, setSources] = useState<api.BulkSourceItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Step 2 — analysis results
  const [summary, setSummary] = useState('');
  const [availableReviews, setAvailableReviews] = useState<api.AvailableReview[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  // Step 3 — apply progress
  const [applyResult, setApplyResult] = useState<api.ApplyRoutingResponse | null>(null);

  // ============ Load sources on mount ============
  useEffect(() => {
    api.fetchBulkSources()
      .then(setSources)
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Chargement échoué');
        setPhase('error');
      });
  }, []);

  const selectedItem = useMemo(
    () => sources?.find(s => s.id === selectedId) ?? null,
    [sources, selectedId],
  );

  // ============ Actions ============
  const handleAnalyze = async () => {
    if (!selectedItem) return;
    setPhase('analyzing');
    try {
      const res = await api.analyzeAndRoute({
        source: selectedItem.provider,
        id: selectedItem.id,
        title: selectedItem.title,
        date: selectedItem.date,
      });
      setSummary(res.summary);
      setAvailableReviews(res.availableReviews);
      setRows(res.subjects.map((s, i) => ({
        key: `s-${i}`,
        subject: s,
        reviewId: s.action === 'existing-review' ? s.reviewId : null,
        newReviewTitle: s.suggestedNewReviewTitle ?? '',
        sectionId: s.sectionAction === 'existing-section' ? s.sectionId : null,
        newSectionName: s.suggestedNewSectionName ?? '',
        skipped: false,
      })));
      setPhase('routing');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analyse échouée');
      setPhase('error');
    }
  };

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  };

  const handleApply = async () => {
    if (!selectedItem) return;
    const subjectsToApply: api.ApplyRoutingSubject[] = rows
      .filter(r => !r.skipped)
      .map(r => ({
        title: r.subject.title,
        situation: r.subject.situation,
        status: r.subject.status,
        responsibility: r.subject.responsibility,
        targetReviewId: r.reviewId,
        newReviewTitle: r.reviewId ? null : (r.newReviewTitle || r.subject.suggestedNewReviewTitle || 'Nouvelle review'),
        targetSectionId: r.reviewId && r.sectionId ? r.sectionId : null,
        newSectionName: r.reviewId && r.sectionId ? null : (r.newSectionName || r.subject.suggestedNewSectionName || 'Nouveau point'),
      }));
    if (subjectsToApply.length === 0) return;

    setPhase('applying');
    try {
      const res = await api.applyRouting(selectedItem.id, subjectsToApply);
      setApplyResult(res);
      setPhase('done');
      onDone({
        importedSubjects: res.subjectsCreated.length,
        createdReviews: res.reviewsCreated.length,
        createdSections: res.sectionsCreated.length,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import échoué');
      setPhase('error');
    }
  };

  // ============ Render ============
  return (
    <Modal title="✨ Analyser & ranger une transcription" onClose={onClose} size="xl">
      <div className={styles.content}>
        {phase === 'error' && (
          <div className={styles.error}>
            <strong>Une erreur est survenue</strong>
            <p>{error}</p>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        )}

        {phase === 'picking' && (
          <>
            {sources === null ? (
              <div className={styles.loading}>
                <LoadingSpinner message="Récupération des transcriptions et emails…" />
              </div>
            ) : sources.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>Aucune source disponible</p>
                <p className={styles.emptyHint}>
                  Connecte Fathom, Otter, Gmail ou Outlook dans Réglages pour voir tes transcriptions et mails récents apparaître ici.
                </p>
                <div className={styles.actions}>
                  <Button variant="primary" onClick={onClose}>Fermer</Button>
                </div>
              </div>
            ) : (
              <>
                <p className={styles.summary}>
                  Sélectionne la transcription ou l'email à analyser. L'IA va en extraire les sujets
                  importants et te proposer pour chaque sujet la review et la section de destination.
                </p>
                <div className={styles.sourceList}>
                  {sources.map(s => (
                    <label
                      key={s.id}
                      className={`${styles.sourceItem} ${selectedId === s.id ? styles.sourceItemSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="source"
                        checked={selectedId === s.id}
                        onChange={() => setSelectedId(s.id)}
                      />
                      <span className={`${styles.providerTag} ${styles[`provider_${s.provider}`]}`}>{s.provider}</span>
                      <span className={styles.sourceTitle}>{s.title}</span>
                      {s.date && <span className={styles.sourceDate}>{formatDate(s.date)}</span>}
                    </label>
                  ))}
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={onClose}>Annuler</Button>
                  <Button variant="primary" onClick={handleAnalyze} disabled={!selectedId}>
                    Analyser →
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'analyzing' && (
          <div className={styles.loading}>
            <LoadingSpinner message="L'IA lit la transcription et décide où ranger chaque sujet…" />
          </div>
        )}

        {phase === 'routing' && (
          <>
            <div className={styles.summaryBlock}>
              <strong>{summary}</strong>
            </div>
            <div className={styles.subjectsList}>
              {rows.length === 0 ? (
                <p className={styles.emptyHint}>L'IA n'a identifié aucun sujet digne d'un suivi dans ce contenu.</p>
              ) : rows.map(r => (
                <SubjectRow
                  key={r.key}
                  row={r}
                  reviews={availableReviews}
                  onUpdate={patch => updateRow(r.key, patch)}
                />
              ))}
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Annuler</Button>
              <Button
                variant="primary"
                onClick={handleApply}
                disabled={rows.length === 0 || rows.every(r => r.skipped)}
              >
                Importer ({rows.filter(r => !r.skipped).length} sujet{rows.filter(r => !r.skipped).length > 1 ? 's' : ''})
              </Button>
            </div>
          </>
        )}

        {phase === 'applying' && (
          <div className={styles.loading}>
            <LoadingSpinner message="Import en cours…" />
          </div>
        )}

        {phase === 'done' && applyResult && (
          <div className={styles.done}>
            <p className={styles.doneTitle}>Import terminé ✓</p>
            <p className={styles.doneHint}>
              {applyResult.subjectsCreated.length} sujet{applyResult.subjectsCreated.length > 1 ? 's' : ''} ajouté{applyResult.subjectsCreated.length > 1 ? 's' : ''}
              {applyResult.reviewsCreated.length > 0 && ` · ${applyResult.reviewsCreated.length} review${applyResult.reviewsCreated.length > 1 ? 's' : ''} créée${applyResult.reviewsCreated.length > 1 ? 's' : ''}`}
              {applyResult.sectionsCreated.length > 0 && ` · ${applyResult.sectionsCreated.length} section${applyResult.sectionsCreated.length > 1 ? 's' : ''} créée${applyResult.sectionsCreated.length > 1 ? 's' : ''}`}
            </p>
            {applyResult.errors.length > 0 && (
              <p className={styles.doneError}>
                {applyResult.errors.length} erreur{applyResult.errors.length > 1 ? 's' : ''} — voir la console pour les détails.
              </p>
            )}
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ==================== Subject row ====================

function SubjectRow({
  row, reviews, onUpdate,
}: {
  row: Row;
  reviews: api.AvailableReview[];
  onUpdate: (patch: Partial<Row>) => void;
}) {
  const { subject, reviewId, newReviewTitle, sectionId, newSectionName, skipped } = row;

  const currentReview = reviewId
    ? reviews.find(r => r.id === reviewId) ?? null
    : null;

  return (
    <div className={`${styles.subjectRow} ${skipped ? styles.subjectRowSkipped : ''}`}>
      <div className={styles.subjectHeader}>
        <span className={styles.statusTag}>{subject.status}</span>
        <span className={styles.subjectTitle}>{subject.title}</span>
        {subject.responsibility && (
          <span className={styles.responsibility}>@{subject.responsibility}</span>
        )}
        <span className={`${styles.confidence} ${styles[`conf_${subject.confidence}`]}`}>
          IA · {subject.confidence === 'high' ? 'haute confiance' : subject.confidence === 'low' ? 'à valider' : 'moyenne'}
        </span>
      </div>

      {subject.situation && <p className={styles.situation}>{subject.situation}</p>}
      {subject.reasoning && <p className={styles.reasoning}>{subject.reasoning}</p>}

      <div className={styles.routing}>
        <div className={styles.routingField}>
          <label>Review de destination</label>
          <select
            value={reviewId ?? '__new__'}
            disabled={skipped}
            onChange={e => {
              const val = e.target.value;
              if (val === '__new__') {
                onUpdate({ reviewId: null, sectionId: null });
              } else {
                const firstSection = reviews.find(r => r.id === val)?.sections[0]?.id ?? null;
                onUpdate({ reviewId: val, sectionId: firstSection });
              }
            }}
          >
            <option value="__new__">➕ Nouvelle review…</option>
            {reviews.map(r => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
          {!reviewId && (
            <input
              type="text"
              placeholder="Titre de la nouvelle review"
              value={newReviewTitle}
              disabled={skipped}
              onChange={e => onUpdate({ newReviewTitle: e.target.value })}
              maxLength={100}
            />
          )}
        </div>

        <div className={styles.routingField}>
          <label>Section</label>
          {currentReview && currentReview.sections.length > 0 ? (
            <select
              value={sectionId ?? '__new__'}
              disabled={skipped}
              onChange={e => onUpdate({ sectionId: e.target.value === '__new__' ? null : e.target.value })}
            >
              <option value="__new__">➕ Nouvelle section…</option>
              {currentReview.sections.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <span className={styles.hint}>La nouvelle review aura cette section :</span>
          )}
          {(!reviewId || sectionId === null) && (
            <input
              type="text"
              placeholder="Nom de la nouvelle section"
              value={newSectionName}
              disabled={skipped}
              onChange={e => onUpdate({ newSectionName: e.target.value })}
              maxLength={80}
            />
          )}
        </div>
      </div>

      <label className={styles.skipToggle}>
        <input type="checkbox" checked={skipped} onChange={e => onUpdate({ skipped: e.target.checked })} />
        <span>Ignorer ce sujet</span>
      </label>
    </div>
  );
}

// ==================== helpers ====================

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}
