import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import { SkillButton } from '../SkillButton/SkillButton';
import * as api from '../../services/api';
import styles from './BulkTranscriptionImportModal.module.css';

interface Props {
  onClose: () => void;
  onDone: (summary: {
    importedSubjects: number;
    updatedSubjects: number;
    createdReviews: number;
    createdSections: number;
    /** Ids of every review touched by this import — used by the list page
     *  to show a "freshly updated" indicator on the matching cards. */
    touchedReviewIds: string[];
  }) => void;
}

type Phase = 'picking' | 'analyzing' | 'routing' | 'applying' | 'done' | 'error';

/** Per-subject user-overridable routing choice. */
interface Row {
  key: string;
  subject: api.AnalyzedSubject;
  reviewId: string | null;
  newReviewTitle: string;
  sectionId: string | null;
  newSectionName: string;
  /** 'update' → we patch the targetSubjectId ; 'create' → we append a new subject. */
  subjectAction: 'update' | 'create';
  targetSubjectId: string | null;
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

  // DB id of the ai_analysis_logs row written on analyze — surfaced as a
  // "voir le log" link during the routing step.
  const [lastLogId, setLastLogId] = useState<number | null>(null);

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
    setLastLogId(null);
    try {
      const res = await api.analyzeAndRoute({
        source: selectedItem.provider,
        id: selectedItem.id,
        title: selectedItem.title,
        date: selectedItem.date,
      });
      if (res.logId != null) setLastLogId(res.logId);
      setSummary(res.summary);
      setAvailableReviews(res.availableReviews);
      setRows(res.subjects.map((s, i) => ({
        key: `s-${i}`,
        subject: s,
        reviewId: s.action === 'existing-review' ? s.reviewId : null,
        newReviewTitle: s.suggestedNewReviewTitle ?? '',
        sectionId: s.sectionAction === 'existing-section' ? s.sectionId : null,
        newSectionName: s.suggestedNewSectionName ?? '',
        subjectAction: s.subjectAction === 'update-existing-subject' ? 'update' : 'create',
        targetSubjectId: s.targetSubjectId,
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
      .map(r => {
        const isUpdate = r.subjectAction === 'update' && r.targetSubjectId;
        return {
          title: r.subject.title,
          situation: r.subject.situation,
          status: r.subject.status,
          responsibility: r.subject.responsibility,
          targetReviewId: r.reviewId,
          newReviewTitle: r.reviewId ? null : (r.newReviewTitle || r.subject.suggestedNewReviewTitle || 'Nouvelle review'),
          targetSectionId: r.reviewId && r.sectionId ? r.sectionId : null,
          newSectionName: r.reviewId && r.sectionId ? null : (r.newSectionName || r.subject.suggestedNewSectionName || 'Nouveau point'),
          subjectAction: isUpdate ? 'update-existing-subject' : 'new-subject',
          targetSubjectId: isUpdate ? r.targetSubjectId : null,
          updatedSituation: isUpdate ? (r.subject.updatedSituation ?? r.subject.situation) : null,
          updatedStatus: isUpdate ? (r.subject.updatedStatus ?? r.subject.status) : null,
          updatedResponsibility: isUpdate ? r.subject.updatedResponsibility : null,
        };
      });
    if (subjectsToApply.length === 0) return;

    setPhase('applying');
    try {
      const res = await api.applyRouting(selectedItem.id, subjectsToApply);
      setApplyResult(res);
      setPhase('done');

      // Collect every review id touched by the import : freshly-created
      // reviews, reviews that received new subjects (reported by the
      // backend), and reviews that got updates (inferred from the rows
      // because the backend update path doesn't carry a reviewId).
      const touched = new Set<string>();
      for (const r of res.reviewsCreated) touched.add(r.id);
      for (const s of res.subjectsCreated) touched.add(s.reviewId);
      for (const row of rows) {
        if (row.skipped) continue;
        if (row.subjectAction === 'update' && row.reviewId) touched.add(row.reviewId);
      }

      onDone({
        importedSubjects: res.subjectsCreated.length,
        updatedSubjects: res.subjectsUpdated.length,
        createdReviews: res.reviewsCreated.length,
        createdSections: res.sectionsCreated.length,
        touchedReviewIds: Array.from(touched),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import échoué');
      setPhase('error');
    }
  };

  // ============ Render ============
  return (
    <Modal title="Analyser & ranger une transcription" onClose={onClose} size="xl">
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
                  <Button variant="primary" onClick={() => { onClose(); window.location.href = '/reglages'; }}>Connecter une IA</Button>
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
                      <span className={styles.sourceTitle}>{s.title}</span>
                      <span className={styles.providerTag}>{s.provider}</span>
                      {s.alreadyImported && (
                        <span className={styles.alreadyImportedBadge}>Déjà importé</span>
                      )}
                      {s.date && <span className={styles.sourceDate}>{formatDate(s.date)}</span>}
                    </label>
                  ))}
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={onClose}>Annuler</Button>
                  <SkillButton skillSlug="suivitess-route-source-to-review" disabled={!selectedId}>
                    <Button variant="primary" onClick={handleAnalyze} disabled={!selectedId}>
                      {selectedItem?.alreadyImported ? 'Ré-importer →' : 'Analyser →'}
                    </Button>
                  </SkillButton>
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
            {lastLogId != null && (
              <div className={styles.logBanner}>
                <span>🧠 Analyse loggée — <a href={`/ai-logs/${lastLogId}`} target="_blank" rel="noreferrer">voir le log #{lastLogId}</a></span>
                <button
                  type="button"
                  className={styles.logBannerCopy}
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/ai-logs/${lastLogId}`)}
                >📋 copier l'URL</button>
              </div>
            )}
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
              {applyResult.subjectsUpdated.length > 0 && ` · ${applyResult.subjectsUpdated.length} sujet${applyResult.subjectsUpdated.length > 1 ? 's' : ''} mis à jour`}
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
  const { subject, reviewId, newReviewTitle, sectionId, newSectionName, subjectAction, targetSubjectId, skipped } = row;

  const currentReview = reviewId
    ? reviews.find(r => r.id === reviewId) ?? null
    : null;
  const currentSection = currentReview && sectionId
    ? currentReview.sections.find(s => s.id === sectionId) ?? null
    : null;

  // The existing subject the user might choose to update instead of creating
  const targetSubject = currentSection && targetSubjectId
    ? currentSection.subjects.find(s => s.id === targetSubjectId) ?? null
    : null;

  // When the action is "update" but the selected review/section changed and
  // no longer contains the target subject → force back to "create".
  const updateIsPossible = currentSection && currentSection.subjects.length > 0;

  return (
    <div className={`${styles.subjectRow} ${skipped ? styles.subjectRowSkipped : ''} ${subjectAction === 'update' ? styles.subjectRowUpdate : ''}`}>
      <div className={styles.subjectHeader}>
        <span className={`${styles.modeTag} ${subjectAction === 'update' ? styles.modeUpdate : styles.modeCreate}`}>
          {subjectAction === 'update' ? '↻ Mise à jour' : '+ Nouveau'}
        </span>
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

      {subjectAction === 'update' && targetSubject && (
        <div className={styles.updateBox}>
          <strong>Sujet existant ciblé :</strong> <span>{targetSubject.title}</span>
          {targetSubject.status && <span className={styles.updateStatus}>{targetSubject.status}</span>}
        </div>
      )}

      <div className={styles.routing}>
        <div className={styles.routingField}>
          <label>Review de destination</label>
          <CustomDropdown
            value={reviewId ?? '__new__'}
            displayLabel={reviewId ? (reviews.find(r => r.id === reviewId)?.title ?? '—') : '+ Nouvelle review…'}
            disabled={skipped}
            options={[
              { value: '__new__', label: '+ Nouvelle review…' },
              ...reviews.map(r => ({ value: r.id, label: r.title })),
            ]}
            onChange={(val) => {
              if (val === '__new__') {
                onUpdate({ reviewId: null, sectionId: null });
              } else {
                const firstSection = reviews.find(r => r.id === val)?.sections[0]?.id ?? null;
                onUpdate({ reviewId: val, sectionId: firstSection });
              }
            }}
          />
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
            <CustomDropdown
              value={sectionId ?? '__new__'}
              displayLabel={sectionId ? (currentReview.sections.find(s => s.id === sectionId)?.name ?? '—') : '+ Nouvelle section…'}
              disabled={skipped}
              options={[
                { value: '__new__', label: '+ Nouvelle section…' },
                ...currentReview.sections.map(s => ({ value: s.id, label: s.name })),
              ]}
              onChange={(val) => {
                const next = val === '__new__' ? null : val;
                onUpdate({
                  sectionId: next,
                  subjectAction: 'create',
                  targetSubjectId: null,
                });
              }}
            />
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

        {updateIsPossible && (
          <div className={`${styles.routingField} ${styles.routingFieldFull}`}>
            <label>Que faire de ce sujet ?</label>
            <div className={styles.modeChoice}>
              <label className={styles.modeRadio}>
                <input
                  type="radio"
                  name={`mode-${row.key}`}
                  checked={subjectAction === 'create'}
                  disabled={skipped}
                  onChange={() => onUpdate({ subjectAction: 'create', targetSubjectId: null })}
                />
                <span>Créer un nouveau sujet</span>
              </label>
              <label className={styles.modeRadio}>
                <input
                  type="radio"
                  name={`mode-${row.key}`}
                  checked={subjectAction === 'update'}
                  disabled={skipped}
                  onChange={() => onUpdate({
                    subjectAction: 'update',
                    targetSubjectId: targetSubjectId ?? currentSection?.subjects[0]?.id ?? null,
                  })}
                />
                <span>Mettre à jour un sujet existant</span>
              </label>
              {subjectAction === 'update' && currentSection && (
                <CustomDropdown
                  value={targetSubjectId ?? ''}
                  displayLabel={currentSection.subjects.find(s => s.id === targetSubjectId)?.title ?? '—'}
                  disabled={skipped}
                  options={currentSection.subjects.map(s => ({ value: s.id, label: s.title }))}
                  onChange={(val) => onUpdate({ targetSubjectId: val })}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.rowActionBtn} ${skipped ? styles.rowActionBtnIgnored : ''}`}
          onClick={() => onUpdate({ skipped: true })}
        >
          Ignorer
        </button>
        <button
          type="button"
          className={`${styles.rowActionBtn} ${!skipped ? styles.rowActionBtnActive : ''}`}
          onClick={() => onUpdate({ skipped: false })}
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

// ==================== Custom dropdown (matches "Actions" dropdown UI) ====================

function CustomDropdown({
  value,
  displayLabel,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  displayLabel: ReactNode;
  options: Array<{ value: string; label: ReactNode }>;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Auto-disable when only one option is available (nothing to choose from)
  const effectiveDisabled = disabled || options.length <= 1;

  return (
    <div ref={ref} className="suivitess-exports" style={{ width: '100%' }}>
      <button
        type="button"
        className={styles.customDropdownBtn}
        onClick={() => !effectiveDisabled && setOpen(v => !v)}
        disabled={effectiveDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.customDropdownLabel}>{displayLabel || placeholder || '—'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="suivitess-exports-menu" role="menu" style={{ width: '100%', maxHeight: 240, overflowY: 'auto' }}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`suivitess-exports-item ${opt.value === value ? styles.customDropdownItemActive : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
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
