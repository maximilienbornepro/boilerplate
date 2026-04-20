import { useEffect, useMemo, useState, useRef, type ReactNode, type CSSProperties } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import { SkillButton } from '../SkillButton/SkillButton';
import { getStatusOption } from '../../types';
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

  // Real pipeline progress (replaces the fake timer-based indicator).
  // Updated ~500 ms while the async job is running.
  const [pipelineStatus, setPipelineStatus] = useState<api.PipelineJobStatus | null>(null);

  // Per-provider sync status — shows "Dernière synchro Slack : 14:23
  // (12 messages)" even when no new message was collected.
  const [syncMeta, setSyncMeta] = useState<api.SyncMetaResponse | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);

  // ── Reusable loader : trigger the Slack sync, then fetch the list +
  // meta in parallel. Called on mount AND by the 🔄 button. ──
  const reloadAll = async () => {
    setSyncingNow(true);
    try {
      // 1) Fire the sync first. If it fails (expired cookies, etc.) we
      //    don't block — just surface the error in the banner.
      try {
        const res = await api.triggerSyncAll();
        if (!res.slack.ok && res.slack.error) {
          console.warn('[slack sync]', res.slack.error);
        }
      } catch (err) {
        console.warn('[slack sync] trigger failed:', err);
      }
      // 2) Fetch meta + list in parallel.
      const [meta, items] = await Promise.all([
        api.fetchSyncMeta(),
        api.fetchBulkSources(),
      ]);
      setSyncMeta(meta);
      setSources(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement échoué');
      setPhase('error');
    } finally {
      setSyncingNow(false);
    }
  };

  // ============ Load sources on mount ============
  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setPipelineStatus(null);
    try {
      // Use the async polling variant : backend returns a jobId immediately,
      // we poll every 500 ms to drive the real progress indicator.
      const res = await api.analyzeAndRouteWithPolling(
        {
          source: selectedItem.provider,
          id: selectedItem.id,
          title: selectedItem.title,
          date: selectedItem.date,
        },
        (status) => setPipelineStatus(status),
        { intervalMs: 500 },
      );
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
  const sourceTitle = selectedItem?.title;
  const modalTitle = (
    <>
      Analyser & ranger une transcription
      {phase === 'routing' && sourceTitle && (
        <span className={styles.modalTitleSource}>{sourceTitle}</span>
      )}
    </>
  );

  return (
    <Modal title={modalTitle} onClose={onClose} size="xl">
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
            <SyncStatusBanner meta={syncMeta} syncing={syncingNow} onRefresh={reloadAll} />
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
                  <SkillButton
                    pipeline={[
                      { tier: 'T1', label: 'Extract (selon la source)', slugs: ['suivitess-extract-transcript', 'suivitess-extract-slack', 'suivitess-extract-outlook'] },
                      { tier: 'T2', label: 'Place (router vers la review)', slugs: ['suivitess-place-in-reviews'] },
                      { tier: 'T3', label: 'Write (rédiger)', slugs: ['suivitess-append-situation', 'suivitess-compose-situation'] },
                    ]}
                    disabled={!selectedId}
                  >
                    <Button variant="primary" onClick={handleAnalyze} disabled={!selectedId}>
                      {selectedItem?.alreadyImported ? 'Ré-importer' : 'Analyser'}
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
            <PipelineStepsIndicator status={pipelineStatus} />
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
            <p className={styles.summaryIntro}>
              <strong>{summary}</strong>
            </p>
            {rows.length > 0 && (
              <nav className={styles.summaryList} aria-label="Sommaire des sujets extraits">
                {rows.map(r => (
                  <a key={r.key} className={styles.summaryItem} href={`#subj-${r.key}`}>
                    <span className={styles.summaryItemTitle}>{r.subject.title}</span>
                    <span className={`${styles.summaryItemMode} ${r.subjectAction === 'update' ? styles.modeUpdate : styles.modeCreate}`}>
                      {r.subjectAction === 'update' ? 'Mise à jour' : 'Nouveau'}
                    </span>
                  </a>
                ))}
              </nav>
            )}
            <div className={styles.subjectsList}>
              {rows.length === 0 ? (
                <p className={styles.emptyHint}>L'IA n'a identifié aucun sujet digne d'un suivi dans ce contenu.</p>
              ) : rows.map(r => (
                <SubjectRow
                  key={r.key}
                  row={r}
                  id={`subj-${r.key}`}
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
  row, reviews, onUpdate, id,
}: {
  row: Row;
  reviews: api.AvailableReview[];
  onUpdate: (patch: Partial<Row>) => void;
  id?: string;
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
  const statusColor = getStatusOption(subject.status).color;
  const rowStyle: CSSProperties = {
    borderColor: statusColor,
    background: `color-mix(in srgb, ${statusColor} 4%, transparent)`,
    ['--row-accent' as string]: statusColor,
  };

  return (
    <div
      id={id}
      className={`${styles.subjectRow} ${skipped ? styles.subjectRowSkipped : ''} ${subjectAction === 'update' ? styles.subjectRowUpdate : ''}`}
      style={rowStyle}
    >
      <div className={styles.subjectHeader}>
        <span className={styles.subjectTitle}>{subject.title}</span>
        <span className={`${styles.modeTag} ${subjectAction === 'update' ? styles.modeUpdate : styles.modeCreate}`}>
          {subjectAction === 'update' ? '↻ Mise à jour' : '+ Nouveau'}
        </span>
        <span className={styles.statusTag}>{subject.status}</span>
      </div>

      {subject.situation && <p className={styles.situation}>{subject.situation}</p>}
      {subject.reasoning && <p className={styles.reasoning}>{subject.reasoning}</p>}

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
                <span className={styles.modeRadioHeader}>
                  <input
                    type="radio"
                    name={`mode-${row.key}`}
                    checked={subjectAction === 'create'}
                    disabled={skipped}
                    onChange={() => onUpdate({ subjectAction: 'create', targetSubjectId: null })}
                  />
                  <span>Créer un nouveau sujet</span>
                </span>
              </label>
              <span className={styles.modeChoiceSeparator}>ou</span>
              <label className={styles.modeRadio}>
                <span className={styles.modeRadioHeader}>
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
                </span>
                {subjectAction === 'update' && currentSection && (
                  <CustomDropdown
                    value={targetSubjectId ?? ''}
                    displayLabel={currentSection.subjects.find(s => s.id === targetSubjectId)?.title ?? '—'}
                    disabled={skipped}
                    options={currentSection.subjects.map(s => ({ value: s.id, label: s.title }))}
                    onChange={(val) => onUpdate({ targetSubjectId: val })}
                  />
                )}
              </label>
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

/** "il y a 3 min" / "il y a 2 h" / "il y a 4 j" / "à l'instant". */
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'à l\'instant';
  if (diffMs < 3_600_000) return `il y a ${Math.floor(diffMs / 60_000)} min`;
  if (diffMs < 86_400_000) return `il y a ${Math.floor(diffMs / 3_600_000)} h`;
  return `il y a ${Math.floor(diffMs / 86_400_000)} j`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// ── Sync status banner ────────────────────────────────────────────────

interface SyncStatusBannerProps {
  meta: api.SyncMetaResponse | null;
  syncing: boolean;
  onRefresh: () => void;
}

function SyncStatusBanner({ meta, syncing, onRefresh }: SyncStatusBannerProps) {
  const row = (label: string, p: api.ProviderSyncMeta | undefined) => {
    if (!p || !p.configured) {
      return (
        <span style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {label}: non configuré
        </span>
      );
    }
    const errColor = p.error ? 'var(--error, #f44336)' : undefined;
    return (
      <span style={{ color: errColor }}>
        <strong>{label}</strong> : {p.messageCount} message{p.messageCount > 1 ? 's' : ''}
        {' · '}dernière synchro {formatRelative(p.lastSyncAt)}
        <span style={{ opacity: 0.6, marginLeft: 4 }}>({formatDateTime(p.lastSyncAt)})</span>
        {p.error && <span> · erreur : {p.error}</span>}
      </span>
    );
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '6px 12px',
      marginBottom: 'var(--spacing-sm)',
      background: 'var(--bg-secondary, rgba(128,128,128,0.05))',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 11, fontFamily: 'var(--font-mono)',
      color: 'var(--text-secondary)',
      flexWrap: 'wrap',
    }}>
      <span style={{ display: 'flex', flex: 1, gap: 16, flexWrap: 'wrap' }}>
        {row('Slack', meta?.slack)}
        {row('Outlook', meta?.outlook)}
      </span>
      <Button variant="secondary" onClick={onRefresh} disabled={syncing}>
        {syncing ? '🔄 Synchro…' : '🔄 Synchroniser'}
      </Button>
    </div>
  );
}

// ── Pipeline progress indicator (driven by real backend status) ───────
//
// `status` comes from polling GET /suivitess/api/pipeline-jobs/:id every
// 500 ms in the parent. Each update reflects a real tier transition :
//   phase 'queued'   → nothing yet (job just created)
//   phase 'tier1'    → extractor running
//   phase 'tier2'    → placement running (after tier1 finished)
//   phase 'tier3'    → writers running (t3Done/t3Total live count)
//   phase 'done'     → component unmounts, caller switches to next step
//   phase 'error'    → shows the last-reached step as failed
//
// No more fake timers — a step flips to 'done' only when the server
// actually moved past it.

type PhaseKey = 'source' | 'extract' | 'place' | 'write' | 'finalize';

function PipelineStepsIndicator({ status }: { status: api.PipelineJobStatus | null }) {
  // Derive the active step from the backend phase.
  const phase = status?.phase ?? 'queued';
  const active: PhaseKey =
    phase === 'queued' ? 'source'
    : phase === 'tier1' ? 'extract'
    : phase === 'tier2' ? 'place'
    : phase === 'tier3' ? 'write'
    : 'finalize';

  // For the T3 writer step, show "N / M writers done" in real time.
  const t3Progress = phase === 'tier3' && status && status.t3Total > 0
    ? ` — ${status.t3Done} / ${status.t3Total} writers`
    : '';

  // Lightweight step model kept inline — no external state, no timers.
  const STEPS: ReadonlyArray<{ key: PhaseKey; icon: string; label: string }> = [
    { key: 'source',   icon: '🔎', label: 'Lecture de la source' },
    { key: 'extract',  icon: '🧩', label: 'Extraction des sujets atomiques' },
    { key: 'place',    icon: '🗂️',  label: 'Analyse de placement (review + section)' },
    { key: 'write',    icon: '✍️',  label: `Rédaction des situations (en parallèle)${t3Progress}` },
    { key: 'finalize', icon: '🎯', label: 'Finalisation' },
  ];
  const activeIdx = STEPS.findIndex(s => s.key === active);

  // Subtitle with per-tier durations once they're known.
  const { t1, t2, t3 } = status?.durations ?? {};
  const durLine = [
    t1 != null ? `T1 ${(t1 / 1000).toFixed(1)}s` : null,
    t2 != null ? `T2 ${(t2 / 1000).toFixed(1)}s` : null,
    t3 != null ? `T3 ${(t3 / 1000).toFixed(1)}s` : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <style>{`@keyframes pipelinePulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: '16px auto 0',
        maxWidth: 560,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: 1.8,
      }}>
        {STEPS.map((step, i) => {
          const stepStatus: 'done' | 'active' | 'pending' =
            i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          const color =
            stepStatus === 'done' ? 'var(--success, #4caf50)' :
            stepStatus === 'active' ? 'var(--accent-primary)' :
            'var(--text-secondary)';
          const opacity = stepStatus === 'pending' ? 0.45 : 1;
          const marker =
            stepStatus === 'done' ? '✓' :
            stepStatus === 'active' ? '◉' :
            '○';
          return (
            <li key={step.key} style={{ color, opacity, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                display: 'inline-block', width: 14, textAlign: 'center', fontWeight: 700,
                animation: stepStatus === 'active' ? 'pipelinePulse 1.2s ease-in-out infinite' : undefined,
              }}>
                {marker}
              </span>
              <span aria-hidden>{step.icon}</span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ul>
      {durLine && (
        <div style={{
          marginTop: 8, textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-secondary)',
        }}>{durLine}</div>
      )}
    </>
  );
}
