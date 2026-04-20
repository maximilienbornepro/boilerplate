import { useEffect, useMemo, useState, useRef, type ReactNode, type CSSProperties } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import { SkillButton } from '../SkillButton/SkillButton';
import { getStatusOption } from '../../types';
import * as api from '../../services/api';
import '../../../gateway/components/ConnectorsPage.css';
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

  // Step 1 — picking (now multi-select : Set of selected source ids)
  const [sources, setSources] = useState<api.BulkSourceItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Step 2 — analysis results
  const [summary, setSummary] = useState('');
  const [availableReviews, setAvailableReviews] = useState<api.AvailableReview[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  /** Only set when the multi-source pipeline ran — one entry per row at
   *  the same index. null entries = single-source pass-through. Lets the
   *  UI surface "N sources" badges + contradiction warnings. */
  const [consolidationByRow, setConsolidationByRow] = useState<Array<api.ConsolidationMeta | null>>([]);

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

  const selectedItems = useMemo(
    () => (sources ?? []).filter(s => selectedIds.has(s.id)),
    [sources, selectedIds],
  );

  // Referenced by the apply step below — we anchor the import to the FIRST
  // selected source for logging purposes (backend accepts any source id
  // from the run — it's purely bookkeeping for the touchedReviewIds).
  const primaryItem = selectedItems[0] ?? null;
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ============ Actions ============
  const handleAnalyze = async () => {
    if (selectedItems.length === 0) return;
    setPhase('analyzing');
    setLastLogId(null);
    setPipelineStatus(null);
    setConsolidationByRow([]);
    try {
      if (selectedItems.length === 1) {
        // Single-source — keep the original fast path.
        const only = selectedItems[0];
        const res = await api.analyzeAndRouteWithPolling(
          { source: only.provider, id: only.id, title: only.title, date: only.date },
          (status) => setPipelineStatus(status),
          { intervalMs: 500 },
        );
        if (res.logId != null) setLastLogId(res.logId);
        setSummary(res.summary);
        setAvailableReviews(res.availableReviews);
        setRows(buildRowsFromSubjects(res.subjects));
        setConsolidationByRow(res.subjects.map(() => null));
      } else {
        // Multi-source — runs T1 × N → T1.5 reconcile → T2 → T3.
        const res = await api.analyzeMultiSourceWithPolling(
          selectedItems.map(s => ({
            source: s.provider, id: s.id, title: s.title, date: s.date,
          })),
          (status) => setPipelineStatus(status),
          { intervalMs: 500 },
        );
        if (res.logId != null) setLastLogId(res.logId);
        setSummary(res.summary);
        setAvailableReviews(res.availableReviews);
        setRows(buildRowsFromSubjects(res.subjects));
        setConsolidationByRow(res.consolidationByProposal ?? res.subjects.map(() => null));
      }
      setPhase('routing');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analyse échouée');
      setPhase('error');
    }
  };

  function buildRowsFromSubjects(subjects: api.AnalyzedSubject[]): Row[] {
    return subjects.map((s, i) => ({
      key: `s-${i}`,
      subject: s,
      // Par défaut : toujours en mode "création d'une nouvelle review"
      // (même si l'IA a matché une review existante, l'utilisateur
      //  peut basculer via le toggle). Le titre suggéré reste pré-rempli.
      reviewId: null,
      newReviewTitle: s.suggestedNewReviewTitle ?? '',
      sectionId: null,
      newSectionName: s.suggestedNewSectionName ?? '',
      subjectAction: s.subjectAction === 'update-existing-subject' ? 'update' : 'create',
      targetSubjectId: s.targetSubjectId,
      skipped: false,
    }));
  }

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  };

  const handleApply = async () => {
    if (!primaryItem) return;
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
      const res = await api.applyRouting(primaryItem.id, subjectsToApply);
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
  const sourceTitle = primaryItem?.title;
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
                  Sélectionne une ou plusieurs sources à analyser. L'IA extrait les sujets
                  importants et te propose pour chacun la review et la section de destination.
                  {' '}
                  <strong>Si tu sélectionnes au moins 2 sources</strong>, un skill de
                  réconciliation s'active : il détecte les sujets qui se croisent entre sources
                  et gère les contradictions chronologiques (ex : un email contredit un call).
                </p>
                <div className={styles.sourceList}>
                  {sources.map(s => (
                    <label
                      key={s.id}
                      className={`${styles.sourceItem} ${selectedIds.has(s.id) ? styles.sourceItemSelected : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
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
                  <span className={styles.selectionCounter}>
                    {selectedIds.size === 0
                      ? 'Aucune source sélectionnée'
                      : `${selectedIds.size} source${selectedIds.size > 1 ? 's' : ''} sélectionnée${selectedIds.size > 1 ? 's' : ''}`}
                    {selectedIds.size >= 2 && <span className={styles.reconcileHint}> · réconciliation activée 🔀</span>}
                  </span>
                  <SkillButton
                    pipeline={selectedIds.size >= 2 ? [
                      { tier: 'T1', label: 'Extract (par source, en parallèle)', slugs: ['suivitess-extract-transcript', 'suivitess-extract-slack', 'suivitess-extract-outlook'] },
                      { tier: 'T1.5', label: 'Reconcile (croisement multi-source)', slugs: ['suivitess-reconcile-multi-source'] },
                      { tier: 'T2', label: 'Place (router vers la review)', slugs: ['suivitess-place-in-reviews'] },
                      { tier: 'T3', label: 'Write (rédiger)', slugs: ['suivitess-append-situation', 'suivitess-compose-situation'] },
                    ] : [
                      { tier: 'T1', label: 'Extract (selon la source)', slugs: ['suivitess-extract-transcript', 'suivitess-extract-slack', 'suivitess-extract-outlook'] },
                      { tier: 'T2', label: 'Place (router vers la review)', slugs: ['suivitess-place-in-reviews'] },
                      { tier: 'T3', label: 'Write (rédiger)', slugs: ['suivitess-append-situation', 'suivitess-compose-situation'] },
                    ]}
                    disabled={selectedIds.size === 0}
                  >
                    <Button variant="primary" onClick={handleAnalyze} disabled={selectedIds.size === 0}>
                      {selectedIds.size > 1
                        ? `Analyser les ${selectedIds.size} sources`
                        : selectedItems[0]?.alreadyImported ? 'Ré-importer' : 'Analyser'}
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
                <a href={`/ai-logs/${lastLogId}`} target="_blank" rel="noreferrer" className={styles.logBannerLink}>
                  Analyse loggée — voir le log #{lastLogId}
                </a>
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
              ) : rows.map((r, i) => (
                <SubjectRow
                  key={r.key}
                  row={r}
                  id={`subj-${r.key}`}
                  consolidation={consolidationByRow[i] ?? null}
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
  row, consolidation, reviews, onUpdate, id,
}: {
  row: Row;
  consolidation: api.ConsolidationMeta | null;
  reviews: api.AvailableReview[];
  onUpdate: (patch: Partial<Row>) => void;
  id?: string;
}) {
  const { subject, reviewId, newReviewTitle, sectionId, newSectionName, subjectAction, targetSubjectId, skipped } = row;
  // Multi-source metadata — only shown if ≥2 evidence entries.
  const isMultiSource = !!consolidation && consolidation.evidence.length >= 2;
  const hasContradiction = !!consolidation && consolidation.evidence.some(e => e.stance === 'contradict');

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
  // Mode color = based on the AI's INITIAL proposal only:
  //   - yellow if the IA proposed a new subject (subject.subjectAction !== 'update-existing-subject')
  //   - blue if the IA proposed updating an existing subject
  // Does NOT track the user's later toggle to "Mettre à jour un sujet existant"
  // so the block colour stays consistent with what the IA originally extracted.
  const initialIsUpdate = subject.subjectAction === 'update-existing-subject';
  const modeColor = initialIsUpdate ? '#3b82f6' : '#eab308';
  const rowStyle: CSSProperties = {
    borderColor: modeColor,
    background: `color-mix(in srgb, ${modeColor} 4%, transparent)`,
    ['--row-accent' as string]: modeColor,
    ['--status-color' as string]: statusColor,
  };

  return (
    <div
      id={id}
      className={`${styles.subjectRow} ${skipped ? styles.subjectRowSkipped : ''} ${initialIsUpdate ? styles.subjectRowUpdate : ''}`}
      style={rowStyle}
    >
      <div className={styles.subjectHeader}>
        <span className={styles.subjectTitle}>{subject.title}</span>
        <span className={`${styles.modeTag} ${initialIsUpdate ? styles.modeUpdate : styles.modeCreate}`}>
          {initialIsUpdate ? 'Mise à jour' : '+ Nouveau'}
        </span>
        {isMultiSource && (
          <span
            className={`${styles.multiSourceBadge} ${hasContradiction ? styles.multiSourceContradict : ''}`}
            title={consolidation!.chronology ?? undefined}
          >
            {hasContradiction ? '⚠️' : '🔀'} {consolidation!.evidence.length} sources
          </span>
        )}
        <span className={styles.statusTag}>{capitalizeFirstLetter(subject.status)}</span>
      </div>

      {consolidation && consolidation.reconciliationNote && (
        <div className={`${styles.reconcileNote} ${hasContradiction ? styles.reconcileNoteContradict : ''}`}>
          <strong>Réconciliation multi-source :</strong> {consolidation.reconciliationNote}
          <details className={styles.evidenceChain}>
            <summary>Chaîne de preuves ({consolidation.evidence.length})</summary>
            <ul>
              {consolidation.evidence.map((ev, i) => (
                <li key={i} className={`${styles.evidenceItem} ${styles[`stance_${ev.stance}`]}`}>
                  <span className={styles.evidenceTs}>{new Date(ev.ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={styles.evidenceType}>{ev.sourceType}</span>
                  <span className={styles.evidenceStance}>{stanceLabel(ev.stance)}</span>
                  <span className={styles.evidenceSummary}>{ev.summary}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {subject.situation && (
        <p className={styles.situation}>
          {renderWithBullets(subject.situation)}
        </p>
      )}
      {subject.reasoning && <p className={styles.reasoning}>{subject.reasoning}</p>}

      <div className={styles.routing}>
        {/* Toggle drives both Review and Section modes — placed under the
            separator so it reads as "for this subject, choose how to route it". */}
        <div className={styles.routingToggleRow}>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segmentedBtn} ${!reviewId ? styles.segmentedBtnActive : ''}`}
              disabled={skipped}
              onClick={() => onUpdate({ reviewId: null, sectionId: null })}
            >
              + Créer une nouvelle review
            </button>
            <button
              type="button"
              className={`${styles.segmentedBtn} ${reviewId ? styles.segmentedBtnActive : ''}`}
              disabled={skipped || reviews.length === 0}
              onClick={() => {
                const first = reviews[0];
                if (first) {
                  onUpdate({ reviewId: first.id, sectionId: first.sections[0]?.id ?? null });
                }
              }}
            >
              Sélectionner une review existante
            </button>
          </div>
        </div>
        <div className={styles.routingField}>
          <label>Review de destination</label>
          {!reviewId ? (
            <>
              {subject.suggestedNewReviewTitle && (
                <span className={styles.aiHint}>Suggestion IA</span>
              )}
              <input
                type="text"
                placeholder="Titre de la nouvelle review"
                value={newReviewTitle}
                disabled={skipped}
                onChange={e => onUpdate({ newReviewTitle: e.target.value })}
                maxLength={100}
              />
            </>
          ) : (
            <CustomDropdown
              value={reviewId}
              displayLabel={reviews.find(r => r.id === reviewId)?.title ?? '—'}
              disabled={skipped}
              options={reviews.map(r => ({ value: r.id, label: r.title }))}
              onChange={(val) => {
                const firstSection = reviews.find(r => r.id === val)?.sections[0]?.id ?? null;
                onUpdate({ reviewId: val, sectionId: firstSection });
              }}
            />
          )}
        </div>

        <div className={styles.routingField}>
          <label>Section</label>
          {!reviewId ? (
            // Nouvelle review → section toujours nouvelle (avec suggestion IA)
            <>
              {subject.suggestedNewSectionName && (
                <span className={styles.aiHint}>Suggestion IA</span>
              )}
              <input
                type="text"
                placeholder="Nom de la nouvelle section"
                value={newSectionName}
                disabled={skipped}
                onChange={e => onUpdate({ newSectionName: e.target.value })}
                maxLength={80}
              />
            </>
          ) : currentReview && currentReview.sections.length > 0 ? (
            // Review existante avec sections → dropdown + option "nouvelle section"
            <>
              {sectionId === null ? (
                <input
                  type="text"
                  placeholder="Nom de la nouvelle section"
                  value={newSectionName}
                  disabled={skipped}
                  onChange={e => onUpdate({ newSectionName: e.target.value })}
                  maxLength={80}
                />
              ) : (
                <CustomDropdown
                  value={sectionId}
                  displayLabel={currentReview.sections.find(s => s.id === sectionId)?.name ?? '—'}
                  disabled={skipped}
                  options={[
                    ...currentReview.sections.map(s => ({ value: s.id, label: s.name })),
                    { value: '__new__', label: '+ Créer une nouvelle section' },
                  ]}
                  onChange={(val) => {
                    if (val === '__new__') {
                      onUpdate({ sectionId: null, subjectAction: 'create', targetSubjectId: null });
                    } else {
                      onUpdate({ sectionId: val, subjectAction: 'create', targetSubjectId: null });
                    }
                  }}
                />
              )}
            </>
          ) : (
            // Review existante sans sections → toujours créer
            <>
              <span className={styles.hint}>Cette review n'a pas encore de section</span>
              <input
                type="text"
                placeholder="Nom de la nouvelle section"
                value={newSectionName}
                disabled={skipped}
                onChange={e => onUpdate({ newSectionName: e.target.value })}
                maxLength={80}
              />
            </>
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
          {options.map(opt => {
            if (opt.value === '__sep__') {
              return (
                <div
                  key="__sep__"
                  style={{
                    padding: '4px 10px',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    pointerEvents: 'none',
                    cursor: 'default',
                    borderTop: '1px solid var(--border-color)',
                    marginTop: 2,
                  }}
                >
                  {opt.label}
                </div>
              );
            }
            return (
              <button
                key={opt.value}
                type="button"
                className={`suivitess-exports-item ${opt.value === value ? styles.customDropdownItemActive : ''}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
              >
                {opt.label}
              </button>
            );
          })}
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

/** Uppercases the first ALPHABETIC character found in the string (skipping
 *  leading emojis/spaces). Leaves the rest untouched. */
function capitalizeFirstLetter(s: string): string {
  if (!s) return s;
  const match = s.match(/\p{L}/u);
  if (!match || match.index === undefined) return s;
  return s.slice(0, match.index) + match[0].toUpperCase() + s.slice(match.index + 1);
}

/** Renders a text that may contain "•" bullets, putting each bullet on its own line. */
function renderWithBullets(text: string): ReactNode {
  if (!text.includes('•')) return text;
  const parts = text.split(/\s*•\s*/).map(s => s.trim()).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} style={{ display: 'block' }}>
          {i === 0 ? part : `• ${part}`}
        </span>
      ))}
    </>
  );
}

function stanceLabel(stance: 'propose' | 'confirm' | 'complement' | 'contradict'): string {
  switch (stance) {
    case 'propose':    return 'Propose';
    case 'confirm':    return 'Confirme';
    case 'complement': return 'Complète';
    case 'contradict': return '⚠️ Contredit';
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
  const card = (
    name: string,
    iconBg: string,
    icon: ReactNode,
    p: api.ProviderSyncMeta | undefined,
  ) => {
    const configured = !!p?.configured;
    const desc = !configured
      ? null
      : p?.error
        ? `Erreur : ${p.error}`
        : `${p?.messageCount ?? 0} message${(p?.messageCount ?? 0) > 1 ? 's' : ''} · dernière synchro ${formatRelative(p?.lastSyncAt ?? null)}`;
    return (
      <div className="connector-card">
        <div className="connector-card-header" style={{ cursor: 'default', padding: 'var(--spacing-sm) var(--spacing-md)' }}>
          <div className="connector-card-left">
            <div className="connector-card-icon" style={{ background: iconBg, color: '#fff', width: 40, height: 40 }}>
              {icon}
            </div>
            <div className="connector-card-info">
              <div className="connector-card-name">{name}</div>
              {desc && <div className="connector-card-desc">{desc}</div>}
            </div>
          </div>
          <div className="connector-card-right">
            <div className={`connector-status ${configured && !p?.error ? 'active' : 'inactive'}`}>
              <span className="connector-status-dot" />
              {configured && !p?.error ? 'Connecté' : configured ? 'Erreur' : 'Non connecté'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const slackIcon = (
    <svg style={{ width: 36, height: 36 }} viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
      <g>
        <path fill="#E01E5A" d="M99.4,151.2c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h12.9V151.2z"/>
        <path fill="#E01E5A" d="M105.9,151.2c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v32.3c0,7.1-5.8,12.9-12.9,12.9s-12.9-5.8-12.9-12.9V151.2z"/>
        <path fill="#36C5F0" d="M118.8,99.4c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v12.9H118.8z"/>
        <path fill="#36C5F0" d="M118.8,105.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9H86.5c-7.1,0-12.9-5.8-12.9-12.9s5.8-12.9,12.9-12.9H118.8z"/>
        <path fill="#2EB67D" d="M170.6,118.8c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9h-12.9V118.8z"/>
        <path fill="#2EB67D" d="M164.1,118.8c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9V86.5c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9V118.8z"/>
        <path fill="#ECB22E" d="M151.2,170.6c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9v-12.9H151.2z"/>
        <path fill="#ECB22E" d="M151.2,164.1c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h32.3c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9H151.2z"/>
      </g>
    </svg>
  );
  const outlookIcon = (
    <svg style={{ width: 24, height: 24 }} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="4" width="22" height="16" rx="2" fill="#0078D4" />
      <path d="M1 6l11 7 11-7" fill="none" stroke="white" strokeWidth="1.5" />
      <ellipse cx="8" cy="14" rx="4" ry="3.5" fill="#005A9E" />
      <text x="8" y="16" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="Arial">O</text>
    </svg>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
      <div className="connectors-list" style={{ gap: 'var(--spacing-sm)' }}>
        {card('Slack', 'transparent', slackIcon, meta?.slack)}
        {card('Outlook', 'transparent', outlookIcon, meta?.outlook)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="secondary"
          onClick={onRefresh}
          disabled={syncing}
          className={styles.syncBtn}
        >
          {syncing ? 'Synchronisation…' : 'Synchroniser'}
        </Button>
      </div>
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

type PhaseKey = 'source' | 'extract' | 'reconcile' | 'place' | 'write' | 'finalize';

function PipelineStepsIndicator({ status }: { status: api.PipelineJobStatus | null }) {
  // Derive the active step from the backend phase.
  const phase = status?.phase ?? 'queued';
  const active: PhaseKey =
    phase === 'queued' ? 'source'
    : phase === 'tier1' ? 'extract'
    : phase === 'reconcile' ? 'reconcile'
    : phase === 'tier2' ? 'place'
    : phase === 'tier3' ? 'write'
    : 'finalize';

  // For the T3 writer step, show "N / M writers done" in real time.
  const t3Progress = phase === 'tier3' && status && status.t3Total > 0
    ? ` — ${status.t3Done} / ${status.t3Total} writers`
    : '';

  // Reconcile step is only shown for multi-source jobs (sourcesCount >= 2).
  const isMulti = (status?.sourcesCount ?? 1) >= 2;

  // Lightweight step model kept inline — no external state, no timers.
  const ALL_STEPS: ReadonlyArray<{ key: PhaseKey; label: string; multiOnly?: boolean }> = [
    { key: 'source',   label: isMulti ? `Lecture de ${status?.sourcesCount ?? 0} sources` : 'Lecture de la source' },
    { key: 'extract',  label: isMulti ? 'Extraction (par source, en parallèle)' : 'Extraction des sujets atomiques' },
    { key: 'reconcile', label: 'Réconciliation multi-source (croisements + contradictions)', multiOnly: true },
    { key: 'place',    label: 'Analyse de placement (review + section)' },
    { key: 'write',    label: `Rédaction des situations (en parallèle)${t3Progress}` },
    { key: 'finalize', label: 'Finalisation' },
  ];
  const STEPS = ALL_STEPS.filter(s => !s.multiOnly || isMulti);
  const activeIdx = STEPS.findIndex(s => s.key === active);

  // Subtitle with per-tier durations once they're known.
  const { t1, reconcile, t2, t3 } = status?.durations ?? {};
  const durLine = [
    t1 != null ? `T1 ${(t1 / 1000).toFixed(1)}s` : null,
    reconcile != null ? `T1.5 ${(reconcile / 1000).toFixed(1)}s` : null,
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
            stepStatus === 'done' ? 'var(--accent-primary)' :
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
