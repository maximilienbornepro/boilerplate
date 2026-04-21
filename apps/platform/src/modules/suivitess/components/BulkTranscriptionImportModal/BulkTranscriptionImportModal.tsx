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
  /** True when the user has explicitly clicked "Ajouter" — surfaces a
   *  "✓ Ajouté" badge on the row. Does not affect the final import
   *  (skipped already controls inclusion). */
  confirmed: boolean;
  /** Explicit UI mode — tracks the review toggle state since `reviewId=null`
   *  no longer unambiguously means "create new" (it can also mean
   *  "existing mode, not yet picked"). */
  mode: 'create' | 'existing';
  /** Independent section-level mode. 'new' lets the user name a brand
   *  new section (input field with the AI suggestion pre-filled), 'existing'
   *  shows the dropdown of the current review's sections. Defaults from
   *  the AI's sectionAction output. */
  sectionMode: 'new' | 'existing';
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

  // ── Replay : restitue un import précédent depuis les logs, sans appel IA.
  //    Permet d'itérer sur l'UX sans attendre 2-3 min de pipeline.
  const [replayableRuns, setReplayableRuns] = useState<api.ReplayableRun[] | null>(null);
  const [replayingLogId, setReplayingLogId] = useState<number | null>(null);
  const [replayedFromLogId, setReplayedFromLogId] = useState<number | null>(null);

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
    // Also load the replay catalog so the user sees "Rejouer un import"
    // as soon as the modal opens — cheap DB query, no LLM.
    api.listReplayableRuns()
      .then(setReplayableRuns)
      .catch(() => setReplayableRuns([])); // silent — feature just hides
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReplay = async (t2LogId: number) => {
    setReplayingLogId(t2LogId);
    setPhase('analyzing');
    setLastLogId(null);
    setPipelineStatus(null);
    setConsolidationByRow([]);
    try {
      const res = await api.replayRun(t2LogId);
      setReplayedFromLogId(res.replayedFromLogId);
      setLastLogId(res.logId ?? null);
      setSummary(res.summary);
      setAvailableReviews(res.availableReviews);
      setRows(buildRowsFromSubjects(res.subjects));
      setConsolidationByRow(res.subjects.map(() => null));
      setPhase('routing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejeu échoué');
      setPhase('error');
    } finally {
      setReplayingLogId(null);
    }
  };

  const selectedItems = useMemo(
    () => (sources ?? []).filter(s => selectedIds.has(s.id)),
    [sources, selectedIds],
  );

  // Referenced by the apply step below — we anchor the import to the FIRST
  // selected source for logging purposes (backend accepts any source id
  // from the run — it's purely bookkeeping for the touchedReviewIds).
  const primaryItem = selectedItems[0] ?? null;

  /** Rows re-ordered by cluster so entries that target the SAME section
   *  (existing id OR same review + same new section name) render
   *  consecutively. Shared by the sommaire nav and the subject list so
   *  both are always in sync — no jumping around between the two. */
  const displayRows = useMemo(() => {
    const clusterKey = (x: Row): string => {
      const reviewPart = x.reviewId ?? x.newReviewTitle.trim() ?? '';
      if (x.sectionMode === 'existing' && x.sectionId) return `${reviewPart}::EXISTING::${x.sectionId}`;
      if (x.sectionMode === 'new' && x.newSectionName.trim()) return `${reviewPart}::NEW::${x.newSectionName.trim().toLowerCase()}`;
      return `${reviewPart}::UNSET::${x.key}`;
    };
    const firstIndexByKey = new Map<string, number>();
    rows.forEach((r, i) => {
      const k = clusterKey(r);
      if (!firstIndexByKey.has(k)) firstIndexByKey.set(k, i);
    });
    return [...rows].map((r, origIdx) => ({ r, origIdx }))
      .sort((a, b) => {
        const ka = firstIndexByKey.get(clusterKey(a.r))!;
        const kb = firstIndexByKey.get(clusterKey(b.r))!;
        if (ka !== kb) return ka - kb;
        return a.origIdx - b.origIdx;
      });
  }, [rows]);
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
    setReplayedFromLogId(null);
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
    return subjects.map((s, i) => {
      const matchedExisting = s.action === 'existing-review' && !!s.reviewId;
      const matchedExistingSection = s.sectionAction === 'existing-section' && !!s.sectionId;
      return {
        // Row keys must be unique even when the AI emits multiple proposals
        // for the same source subject (multi-review dispatch). Using the
        // flat index `i` guarantees uniqueness ; grouping by source is done
        // visually based on subject.title match.
        key: `s-${i}`,
        subject: s,
        // Respecte la décision de l'IA : si elle a matché une review
        // existante, on positionne reviewId ET mode 'existing' pour que
        // le toggle segmented affiche "Sélectionner une review existante"
        // par défaut. Sinon on tombe sur "Nouvelle review" avec le titre
        // suggéré pré-rempli.
        reviewId: matchedExisting ? s.reviewId : null,
        newReviewTitle: s.suggestedNewReviewTitle ?? '',
        sectionId: matchedExistingSection ? s.sectionId : null,
        newSectionName: s.suggestedNewSectionName ?? '',
        subjectAction: s.subjectAction === 'update-existing-subject' ? 'update' : 'create',
        targetSubjectId: s.targetSubjectId,
        skipped: false,
        confirmed: false,
        mode: matchedExisting ? 'existing' : 'create',
        // Section mode mirrors the AI's decision : existing if it found a
        // matching section, 'new' if it proposed a fresh section name.
        sectionMode: matchedExistingSection ? 'existing' : 'new',
      };
    });
  }

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  };

  /** Clone a row so the same source subject can be routed to another
   *  review. Appends right after the source row so the group stays
   *  visually contiguous. Mode is reset to 'existing' so the user can
   *  pick a different review ; reviewId/sectionId are cleared. */
  const duplicateRowForOtherReview = (sourceKey: string) => {
    setRows(prev => {
      const sourceIdx = prev.findIndex(r => r.key === sourceKey);
      if (sourceIdx === -1) return prev;
      const src = prev[sourceIdx];
      const newRow: Row = {
        ...src,
        // Unique key using the subject title + timestamp — survives re-renders.
        key: `${sourceKey}-copy-${Date.now()}`,
        reviewId: null,
        sectionId: null,
        newSectionName: '',
        // Keep the AI's new-review-title suggestion in case the user wants
        // to fall back to a create flow after all.
        mode: 'existing',
        // Default section mode for a user-added duplicate : existing if the
        // picked review has sections to choose from, otherwise the user
        // will end up creating a fresh section for this extra review target.
        sectionMode: 'existing',
        // Always a fresh create when user manually adds a target — they can
        // still switch to "update" in the row UI if the target review has a
        // matching subject.
        subjectAction: 'create',
        targetSubjectId: null,
        confirmed: false,
        skipped: false,
      };
      return [
        ...prev.slice(0, sourceIdx + 1),
        newRow,
        ...prev.slice(sourceIdx + 1),
      ];
    });
  };

  /** Remove a duplicated row (the original, non-copy row cannot be removed —
   *  use skipped for that). */
  const removeRow = (rowKey: string) => {
    setRows(prev => prev.filter(r => r.key !== rowKey));
  };

  /** Rename the "new section" name on a row, and propagate the rename to
   *  every sibling row that shared the SAME previous name + same review
   *  target. Prevents the user from having to rename the same section in
   *  10 rows one by one when the AI proposed the same name for a cluster.
   *
   *  Only fires when the rename is triggered on a newSectionName (not on
   *  section dropdown pick). Silently no-op if the row has no siblings. */
  const renameNewSectionCluster = (rowKey: string, newName: string) => {
    setRows(prev => {
      const src = prev.find(r => r.key === rowKey);
      if (!src) return prev;
      // Only group by (review target, previous name). A row with a
      // sectionId picked (existing section) is never part of the rename.
      if (src.sectionId) return prev.map(r => r.key === rowKey ? { ...r, newSectionName: newName } : r);
      const prevName = src.newSectionName.trim();
      const reviewKey = src.reviewId ?? src.newReviewTitle ?? '';
      const shouldPropagate = (r: Row) => (
        !r.sectionId
        && r.newSectionName.trim() === prevName
        && prevName.length > 0
        && (r.reviewId ?? r.newReviewTitle ?? '') === reviewKey
      );
      return prev.map(r => (
        r.key === rowKey || shouldPropagate(r)
          ? { ...r, newSectionName: newName }
          : r
      ));
    });
  };

  /** Build a single ApplyRoutingSubject payload from a Row. Shared by both
   *  `handleApply` (bulk "Importer la sélection") and `handleImmediateAdd`
   *  (per-row "Ajouter" that commits immediately) so the two paths never
   *  diverge on payload shape. */
  const buildSubjectPayload = (r: Row): api.ApplyRoutingSubject => {
    const isUpdate = r.subjectAction === 'update' && !!r.targetSubjectId;
    return {
      title: r.subject.title,
      situation: r.subject.situation,
      status: r.subject.status,
      responsibility: r.subject.responsibility,
      targetReviewId: r.reviewId,
      newReviewTitle: r.reviewId ? null : (r.newReviewTitle || r.subject.suggestedNewReviewTitle || 'Nouvelle review'),
      // sectionMode is the source of truth : 'existing' → send sectionId,
      // 'new' → send the name (even if a sectionId was previously set in
      // the row, the user explicitly chose to ignore it). Fallback on the
      // AI suggestion for 'new' when the user hasn't typed anything.
      targetSectionId: r.sectionMode === 'existing' ? r.sectionId : null,
      newSectionName: r.sectionMode === 'existing'
        ? null
        : (r.newSectionName || r.subject.suggestedNewSectionName || 'Nouveau point'),
      subjectAction: isUpdate ? 'update-existing-subject' : 'new-subject',
      targetSubjectId: isUpdate ? r.targetSubjectId : null,
      updatedSituation: isUpdate ? (r.subject.updatedSituation ?? r.subject.situation) : null,
      updatedStatus: isUpdate ? (r.subject.updatedStatus ?? r.subject.status) : null,
      updatedResponsibility: isUpdate ? r.subject.updatedResponsibility : null,
      // Forward the source context so the backend can feed the per-user
      // pgvector routing memory with the validated decision. Pure
      // observability at this layer ; safe to drop if undefined.
      rawQuotes: r.subject.sourceRawQuotes,
      entities: r.subject.sourceEntities,
      participants: r.subject.sourceParticipants,
      aiProposedReviewId: r.subject.aiProposedReviewId ?? null,
      aiProposedReviewTitle: r.subject.aiProposedReviewTitle ?? null,
    };
  };

  /** Validation predicate — single source of truth for "is this row
   *  ready to be committed ?". Mirrors the rule used in the sommaire
   *  button and the detailed-row button. Returns the list of missing
   *  field labels (empty = complete). */
  const getMissingFields = (r: Row): string[] => {
    const missing: string[] = [];
    if (r.sectionMode === 'existing') {
      if (!r.reviewId) missing.push('review');
      else if (!r.sectionId && !r.newSectionName.trim()) missing.push('section');
    } else {
      if (!r.reviewId && !r.newReviewTitle.trim()) missing.push('titre de la nouvelle review');
      if (!r.newSectionName.trim()) missing.push('nom de la nouvelle section');
    }
    return missing;
  };

  // ── Cumulative result of all immediate-add clicks. Tracks counts +
  // touched review ids so the final `onDone` (fired on modal close /
  // "Importer le reste") reports the true total instead of only the
  // last bulk import's numbers. Resets when phase goes back to
  // 'picking'. ──
  const [cumulativeApplied, setCumulativeApplied] = useState<{
    importedSubjects: number;
    updatedSubjects: number;
    createdReviews: number;
    createdSections: number;
    touchedReviewIds: Set<string>;
  }>({
    importedSubjects: 0,
    updatedSubjects: 0,
    createdReviews: 0,
    createdSections: 0,
    touchedReviewIds: new Set(),
  });

  // Row key currently being committed via handleImmediateAdd — drives
  // the per-row "Ajout en cours…" spinner without blocking the rest
  // of the UI.
  const [addingRowKey, setAddingRowKey] = useState<string | null>(null);

  /** Commit ONE subject to the DB immediately, then remove its row from
   *  the list. The user clicks "Ajouter" and the subject is persisted
   *  right away (no more batch-accumulate-then-import). */
  const handleImmediateAdd = async (rowKey: string) => {
    const row = rows.find(r => r.key === rowKey);
    if (!row) return;
    const missing = getMissingFields(row);
    if (missing.length > 0) {
      // Surface a temporary error banner — the detailed row will still
      // be visible below so the user can fix it.
      setError(`Impossible d'ajouter « ${row.subject.title} » : manque ${missing.join(', ')}`);
      setTimeout(() => setError(''), 4000);
      return;
    }

    setAddingRowKey(rowKey);
    try {
      const sourceId = primaryItem?.id
        ?? (replayedFromLogId != null ? `replay:${replayedFromLogId}` : 'manual');
      const res = await api.applyRouting(sourceId, [buildSubjectPayload(row)]);

      // Accumulate the result. Touched reviews = freshly-created reviews
      // + reviews that received new subjects + (for updates) the row's
      // original reviewId.
      setCumulativeApplied(prev => {
        const touched = new Set(prev.touchedReviewIds);
        for (const rv of res.reviewsCreated) touched.add(rv.id);
        for (const s of res.subjectsCreated) touched.add(s.reviewId);
        if (row.subjectAction === 'update' && row.reviewId) touched.add(row.reviewId);
        return {
          importedSubjects: prev.importedSubjects + res.subjectsCreated.length,
          updatedSubjects: prev.updatedSubjects + res.subjectsUpdated.length,
          createdReviews: prev.createdReviews + res.reviewsCreated.length,
          createdSections: prev.createdSections + res.sectionsCreated.length,
          touchedReviewIds: touched,
        };
      });

      // Remove the committed row from the list so the user sees exactly
      // what's left to process.
      setRows(prev => prev.filter(r => r.key !== rowKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout échoué");
    } finally {
      setAddingRowKey(null);
    }
  };

  const handleApply = async () => {
    // primaryItem is null when the user arrived via the "Rejouer un
    // import précédent" path — they didn't re-pick sources. We still
    // want to honor their import. The sourceId is optional in the
    // backend (used only to mark bookkeeping in suivitess_transcript_imports).
    const subjectsToApply: api.ApplyRoutingSubject[] = rows
      .filter(r => !r.skipped)
      .map(buildSubjectPayload);
    // Nothing left to apply in bulk — but if the user committed rows
    // one-by-one via "Ajouter", we still need to fire `onDone` with
    // the cumulative tally so the parent refreshes and closes the modal.
    if (subjectsToApply.length === 0) {
      if (cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects > 0) {
        onDone({
          importedSubjects: cumulativeApplied.importedSubjects,
          updatedSubjects: cumulativeApplied.updatedSubjects,
          createdReviews: cumulativeApplied.createdReviews,
          createdSections: cumulativeApplied.createdSections,
          touchedReviewIds: Array.from(cumulativeApplied.touchedReviewIds),
        });
      }
      return;
    }

    setPhase('applying');
    try {
      // Synthetic sourceId for replay runs so the bookkeeping query still
      // runs without marking a real source as imported again.
      const sourceId = primaryItem?.id
        ?? (replayedFromLogId != null ? `replay:${replayedFromLogId}` : 'manual');
      const res = await api.applyRouting(sourceId, subjectsToApply);
      setApplyResult(res);
      setPhase('done');

      // Collect every review id touched by the import : freshly-created
      // reviews, reviews that received new subjects (reported by the
      // backend), and reviews that got updates (inferred from the rows
      // because the backend update path doesn't carry a reviewId).
      // Merge with the cumulative tally from immediate-add clicks.
      const touched = new Set<string>(cumulativeApplied.touchedReviewIds);
      for (const r of res.reviewsCreated) touched.add(r.id);
      for (const s of res.subjectsCreated) touched.add(s.reviewId);
      for (const row of rows) {
        if (row.skipped) continue;
        if (row.subjectAction === 'update' && row.reviewId) touched.add(row.reviewId);
      }

      onDone({
        importedSubjects: cumulativeApplied.importedSubjects + res.subjectsCreated.length,
        updatedSubjects: cumulativeApplied.updatedSubjects + res.subjectsUpdated.length,
        createdReviews: cumulativeApplied.createdReviews + res.reviewsCreated.length,
        createdSections: cumulativeApplied.createdSections + res.sectionsCreated.length,
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
            {replayableRuns && replayableRuns.length > 0 && (
              <details className={styles.replaySection}>
                <summary className={styles.replaySummary}>
                  🔁 Rejouer un import précédent <span className={styles.replayHint}>(instantané, sans nouvelle requête IA)</span>
                </summary>
                <div className={styles.replayList}>
                  {replayableRuns.map(run => (
                    <button
                      key={run.t2LogId}
                      type="button"
                      className={styles.replayItem}
                      disabled={replayingLogId !== null}
                      onClick={() => handleReplay(run.t2LogId)}
                    >
                      <span className={styles.replayItemDate}>
                        {new Date(run.createdAt).toLocaleString('fr-FR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      <span className={styles.replayItemLabel}>
                        #{run.t2LogId} · {run.proposalsCount} sujet{run.proposalsCount > 1 ? 's' : ''}
                      </span>
                      {replayingLogId === run.t2LogId && (
                        <span className={styles.replayItemLoading}>Rejeu…</span>
                      )}
                    </button>
                  ))}
                </div>
              </details>
            )}
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
                  {(() => {
                    // Compute the "N déjà importées" breakdown across the
                    // whole selection so the counter surfaces it even in a
                    // group selection — previously the already-imported flag
                    // was only shown per-card + in the single-item button
                    // label, so users selecting 5 sources couldn't tell at a
                    // glance that 3 of them were re-imports.
                    const alreadyImportedCount = selectedItems.filter(it => it.alreadyImported).length;
                    return (
                      <span className={styles.selectionCounter}>
                        {selectedIds.size === 0
                          ? 'Aucune source sélectionnée'
                          : `${selectedIds.size} source${selectedIds.size > 1 ? 's' : ''} sélectionnée${selectedIds.size > 1 ? 's' : ''}`}
                        {alreadyImportedCount > 0 && (
                          <span className={styles.reconcileHint} title="Ces sources ont déjà été analysées — l'IA va les rejouer">
                            {' · '}
                            {alreadyImportedCount === selectedIds.size
                              ? (selectedIds.size === 1 ? 'déjà importée ↻' : 'toutes déjà importées ↻')
                              : `${alreadyImportedCount} déjà importée${alreadyImportedCount > 1 ? 's' : ''} ↻`}
                          </span>
                        )}
                        {selectedIds.size >= 2 && <span className={styles.reconcileHint}> · réconciliation activée 🔀</span>}
                      </span>
                    );
                  })()}
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
                      {(() => {
                        // When a group selection contains any already-imported
                        // source, relabel the CTA so the user sees they're
                        // about to re-analyze (not discover fresh content) —
                        // matches the single-source "Ré-importer" behavior.
                        const anyAlreadyImported = selectedItems.some(it => it.alreadyImported);
                        if (selectedIds.size > 1) {
                          return anyAlreadyImported
                            ? `Ré-analyser les ${selectedIds.size} sources`
                            : `Analyser les ${selectedIds.size} sources`;
                        }
                        return selectedItems[0]?.alreadyImported ? 'Ré-importer' : 'Analyser';
                      })()}
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
            {/* Transient error banner — shown when handleImmediateAdd
                fails without switching the modal into 'error' phase.
                Auto-clears after 4 s. */}
            {error && (
              <div className={styles.logBanner} style={{ background: 'var(--error-bg, rgba(239, 68, 68, 0.1))', color: 'var(--error, #dc2626)' }}>
                <span>⚠ {error}</span>
              </div>
            )}
            {replayedFromLogId != null && (
              <div className={styles.logBanner}>
                <span>🔁 Rejeu de l'import #{replayedFromLogId} — aucun appel IA, décisions restituées depuis les logs.</span>
              </div>
            )}
            {lastLogId != null && replayedFromLogId == null && (
              <div className={styles.logBanner}>
                <a href={`/ai-logs/${lastLogId}`} target="_blank" rel="noreferrer" className={styles.logBannerLink}>
                  Analyse loggée — voir le log #{lastLogId}
                </a>
              </div>
            )}
            <p className={styles.summaryIntro}>
              <strong>{summary}</strong>
            </p>
            {displayRows.length > 0 && (
              <nav className={styles.summaryList} aria-label="Sommaire des sujets extraits">
                {displayRows.map(({ r }) => {
                  // Resolve the target review label : existing review name
                  // (looked up in availableReviews) OR the AI-suggested title
                  // OR a placeholder if the user hasn't filled it yet.
                  const reviewLabel = r.reviewId
                    ? (availableReviews.find(rv => rv.id === r.reviewId)?.title ?? r.reviewId)
                    : (r.newReviewTitle || r.subject.suggestedNewReviewTitle || 'nouvelle review');
                  const reviewIsExisting = !!r.reviewId;
                  // Section label mirrors the section field : existing
                  // section name OR suggested new section name.
                  const matchingReview = reviewIsExisting
                    ? availableReviews.find(rv => rv.id === r.reviewId)
                    : null;
                  const sectionLabel = r.sectionMode === 'existing' && r.sectionId
                    ? (matchingReview?.sections.find(s => s.id === r.sectionId)?.name ?? r.sectionId)
                    : (r.newSectionName || r.subject.suggestedNewSectionName || 'nouvelle section');
                  const sectionIsExisting = r.sectionMode === 'existing' && !!r.sectionId;
                  // For updates : does the AI want to change the status ?
                  const statusChanged = r.subjectAction === 'update'
                    && !!r.subject.updatedStatus
                    && r.subject.updatedStatus !== r.subject.status;
                  const breadcrumbTitle =
                    `${reviewIsExisting ? 'Review trouvée' : 'Nouvelle review'} : "${reviewLabel}"`
                    + ` › ${sectionIsExisting ? 'Section trouvée' : 'Nouvelle section'} : "${sectionLabel}"`;
                  // Validation mirrors the detailed-row rule so "Ajouter"
                  // in the sommaire behaves identically to "Ajouter" inside
                  // the row — we never commit a row if it's missing required
                  // fields, otherwise the backend would silently persist
                  // incomplete data.
                  const missing = getMissingFields(r);
                  const canConfirmRow = missing.length === 0;
                  const isAddingThisRow = addingRowKey === r.key;
                  return (
                    <div
                      key={r.key}
                      className={styles.summaryItem}
                    >
                      {/* Col 1 : title (clickable link to the detailed row) */}
                      <a
                        href={`#subj-${r.key}`}
                        className={styles.summaryItemTitle}
                        title={r.subject.title}
                      >
                        {r.subject.title}
                      </a>
                      {/* Col 2 : mode */}
                      <span className={`${styles.summaryItemMode} ${r.subjectAction === 'update' ? styles.modeUpdate : styles.modeCreate}`}>
                        {r.subjectAction === 'update' ? 'Mise à jour' : 'Nouveau'}
                      </span>
                      {/* Col 3 : review pill */}
                      <span
                        className={`${styles.breadcrumbPart} ${reviewIsExisting ? styles.summaryItemReviewExisting : styles.summaryItemReviewNew}`}
                        title={breadcrumbTitle}
                      >
                        {reviewIsExisting ? '✓' : '+'} {reviewLabel}
                      </span>
                      {/* Col 4 : separator */}
                      <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
                      {/* Col 5 : section pill */}
                      <span
                        className={`${styles.breadcrumbPart} ${sectionIsExisting ? styles.summaryItemReviewExisting : styles.summaryItemReviewNew}`}
                        title={breadcrumbTitle}
                      >
                        {sectionIsExisting ? '✓' : '+'} {sectionLabel}
                      </span>
                      {/* Col 6 : status-change (optional, placeholder when absent) */}
                      {statusChanged ? (
                        <span
                          className={styles.summaryItemStatusChange}
                          title={`Statut : "${r.subject.status}" → "${r.subject.updatedStatus}"`}
                        >
                          ↻ statut
                        </span>
                      ) : <span aria-hidden="true" />}
                      {/* Col 7 : immediate-add button — commits this ONE
                          subject to the database right now (applyRouting
                          with a single-item payload), then removes the row
                          from the list. Incomplete rows scroll the user
                          to the detailed row so they can fix the missing
                          field instead of silently pushing bad data. */}
                      <button
                        type="button"
                        className={styles.summaryItemValidate}
                        disabled={isAddingThisRow || !!addingRowKey}
                        onClick={() => {
                          if (!canConfirmRow) {
                            const el = document.getElementById(`subj-${r.key}`);
                            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                          }
                          handleImmediateAdd(r.key);
                        }}
                        title={
                          canConfirmRow
                            ? 'Ajouter immédiatement ce sujet à la base de données'
                            : `Incomplet — manque : ${missing.join(', ')}. Clique pour ouvrir la ligne détaillée.`
                        }
                        data-incomplete={!canConfirmRow ? 'true' : undefined}
                      >
                        {isAddingThisRow ? '⏳ Ajout…' : canConfirmRow ? 'Ajouter' : '⚠ Incomplet'}
                      </button>
                    </div>
                  );
                })}
              </nav>
            )}
            <div className={styles.subjectsList}>
              {displayRows.length === 0 ? (
                cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects > 0 ? (
                  <p className={styles.emptyHint}>
                    ✓ Tous les sujets ont été ajoutés ({cumulativeApplied.importedSubjects} créé{cumulativeApplied.importedSubjects > 1 ? 's' : ''}, {cumulativeApplied.updatedSubjects} mis à jour). Clique sur « Terminer » pour fermer.
                  </p>
                ) : (
                  <p className={styles.emptyHint}>L'IA n'a identifié aucun sujet digne d'un suivi dans ce contenu.</p>
                )
              ) : displayRows.map(({ r, origIdx }, i, filteredArr) => {
                // A row is part of a multi-placement group when the same
                // subject.title appears on ≥2 rows (AI emitted multiple
                // targets OR the user clicked "+ ajouter à une autre review").
                const sameTitleCount = rows.filter(x => x.subject.title === r.subject.title).length;
                const isCopyRow = r.key.includes('-copy-');
                // Detect "same-section cluster" : several rows are about to
                // land in the SAME new section (same review + same proposed
                // section name, all with no existing sectionId). The backend
                // dedupes anyway (`newSectionByKey`) but users like to know
                // upfront that N subjects will be grouped in one section.
                const sectionClusterKey = !r.sectionId && r.newSectionName.trim().length > 0
                  ? `${r.reviewId ?? r.newReviewTitle ?? ''}::${r.newSectionName.trim()}`
                  : null;
                const sameSectionCount = sectionClusterKey
                  ? rows.filter(x => !x.skipped && !x.sectionId && x.newSectionName.trim() &&
                      `${x.reviewId ?? x.newReviewTitle ?? ''}::${x.newSectionName.trim()}` === sectionClusterKey
                    ).length
                  : 0;
                return (
                  <SubjectRow
                    key={r.key}
                    row={r}
                    id={`subj-${r.key}`}
                    consolidation={consolidationByRow[origIdx] ?? null}
                    reviews={availableReviews}
                    onUpdate={patch => updateRow(r.key, patch)}
                    onRenameNewSection={(name) => renameNewSectionCluster(r.key, name)}
                    onDuplicate={() => duplicateRowForOtherReview(r.key)}
                    onRemove={isCopyRow ? () => removeRow(r.key) : undefined}
                    onImmediateAdd={() => handleImmediateAdd(r.key)}
                    isAdding={addingRowKey === r.key}
                    addDisabled={!!addingRowKey && addingRowKey !== r.key}
                    isMultiPlacement={sameTitleCount >= 2}
                    sameNewSectionCount={sameSectionCount}
                    nextRowKey={filteredArr[i + 1]?.r.key ?? null}
                  />
                );
              })}
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>
                {cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects > 0 ? 'Fermer' : 'Annuler'}
              </Button>
              {rows.filter(r => !r.skipped).length > 0 ? (
                // User still has rows to process in bulk — commits every
                // non-skipped row at once. Useful when the user trusts the
                // AI proposals and just wants to import everything.
                <Button
                  variant="primary"
                  onClick={handleApply}
                  disabled={rows.length === 0 || rows.every(r => r.skipped) || !!addingRowKey}
                >
                  Importer le reste ({rows.filter(r => !r.skipped).length} sujet{rows.filter(r => !r.skipped).length > 1 ? 's' : ''})
                </Button>
              ) : cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects > 0 ? (
                // Everything was committed one-by-one via "Ajouter". Firing
                // handleApply with zero subjects triggers the `onDone` path
                // that flushes the cumulative tally to the parent.
                <Button variant="primary" onClick={handleApply}>
                  Terminer ({cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects} sujet{cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects > 1 ? 's' : ''})
                </Button>
              ) : null}
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
            <p className={styles.doneTitle}>Import terminé</p>
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
  row, consolidation, reviews, onUpdate, onRenameNewSection, id, nextRowKey,
  onDuplicate, onRemove, onImmediateAdd, isAdding, addDisabled,
  isMultiPlacement, sameNewSectionCount,
}: {
  row: Row;
  consolidation: api.ConsolidationMeta | null;
  reviews: api.AvailableReview[];
  onUpdate: (patch: Partial<Row>) => void;
  /** Rename the row's `newSectionName` AND propagate to every sibling
   *  row that shared the same previous name + same review target. Lets
   *  the user fix a proposed section name once for the whole cluster. */
  onRenameNewSection: (newName: string) => void;
  id?: string;
  nextRowKey?: string | null;
  /** Clone this row so the subject can be routed to another review.
   *  Always available — the AI might emit a single placement that the
   *  user wants to dispatch elsewhere too. */
  onDuplicate: () => void;
  /** Only set for user-created duplicate rows (key contains "-copy-").
   *  The original AI-emitted row is never removable — use `skipped`
   *  to exclude it from the import. */
  onRemove?: () => void;
  /** Immediately commit this single row to the database. The parent
   *  removes the row from the list on success — no more batching. */
  onImmediateAdd: () => void;
  /** True when this row is currently being committed. Drives the
   *  "⏳ Ajout…" spinner on the button. */
  isAdding: boolean;
  /** True when another row is being committed — lock this one to prevent
   *  concurrent applyRouting calls racing against each other. */
  addDisabled: boolean;
  /** True when the same source subject appears on ≥2 rows. Drives the
   *  compact "part of a multi-review dispatch" badge. */
  isMultiPlacement: boolean;
  /** How many rows in the current batch will land in the same new
   *  section (same review + same newSectionName). ≥2 → surfaces a
   *  "N sujets regroupés ici" hint so the user sees the dedup upfront. */
  sameNewSectionCount: number;
}) {
  const { subject, reviewId, newReviewTitle, sectionId, newSectionName, subjectAction, targetSubjectId, skipped, confirmed, mode, sectionMode } = row;
  // Only show inline "required field" error after the user attempted to confirm.
  const [showValidation, setShowValidation] = useState(false);
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

  // ── Validation: surface what's missing before the user can confirm ──
  // Review side :
  //   'create'   → newReviewTitle required
  //   'existing' → reviewId required
  // Section side (sectionMode) :
  //   'new'      → newSectionName required
  //   'existing' → sectionId required
  const missingFields: string[] = [];
  if (mode === 'create') {
    if (!newReviewTitle.trim()) missingFields.push('titre de la nouvelle review');
  } else {
    if (!reviewId) missingFields.push('review');
  }
  if (sectionMode === 'new') {
    if (!newSectionName.trim()) missingFields.push('nom de la nouvelle section');
  } else {
    if (!sectionId) missingFields.push('section');
  }
  const canConfirm = missingFields.length === 0;

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
          {initialIsUpdate ? 'Mise à jour sujet' : 'Nouveau sujet'}
        </span>
        {isMultiSource && (
          <span
            className={`${styles.multiSourceBadge} ${hasContradiction ? styles.multiSourceContradict : ''}`}
            title={consolidation!.chronology ?? undefined}
          >
            {hasContradiction ? '⚠️' : '🔀'} {consolidation!.evidence.length} sources
          </span>
        )}
        {isMultiPlacement && (
          <span
            className={styles.multiPlacementBadge}
            title="Ce sujet est dispatché dans plusieurs reviews"
          >
            📡 Multi-review
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
              className={`${styles.segmentedBtn} ${mode === 'create' ? styles.segmentedBtnActive : ''}`}
              disabled={skipped}
              onClick={() => onUpdate({ mode: 'create', reviewId: null, sectionId: null, sectionMode: 'new' })}
            >
              + Créer une nouvelle review
            </button>
            <button
              type="button"
              className={`${styles.segmentedBtn} ${mode === 'existing' ? styles.segmentedBtnActive : ''}`}
              disabled={skipped || reviews.length === 0}
              onClick={() => onUpdate({ mode: 'existing', reviewId: null, sectionId: null, sectionMode: 'existing' })}
            >
              Sélectionner une review existante
            </button>
          </div>
        </div>
        <div className={styles.routingField}>
          <div className={styles.routingLabelRow}>
            <label>
              Review de destination
              <span className={styles.requiredMark}>*</span>
            </label>
            {mode === 'create' && subject.suggestedNewReviewTitle && (
              <span className={styles.aiHint}>Suggestion IA</span>
            )}
          </div>
          {mode === 'create' ? (
            <input
              type="text"
              placeholder="Titre de la nouvelle review"
              value={newReviewTitle}
              disabled={skipped}
              onChange={e => onUpdate({ newReviewTitle: e.target.value })}
              maxLength={100}
              className={showValidation && !newReviewTitle.trim() ? styles.inputError : ''}
            />
          ) : (
            <CustomDropdown
              value={reviewId ?? ''}
              displayLabel={reviewId ? (reviews.find(r => r.id === reviewId)?.title ?? '—') : 'Sélectionner une review…'}
              disabled={skipped}
              className={showValidation && !reviewId ? styles.dropdownError : ''}
              options={reviews.map(r => ({ value: r.id, label: r.title }))}
              onChange={(val) => {
                // When picking a review, reset the section so the user has
                // to consciously choose one (no sneaky pre-selection).
                onUpdate({ reviewId: val, sectionId: null });
              }}
            />
          )}
        </div>

        <div className={styles.routingField}>
          <div className={styles.routingLabelRow}>
            <label>
              Section
              <span className={styles.requiredMark}>*</span>
            </label>
            {sectionMode === 'new' && subject.suggestedNewSectionName && (
              <span className={styles.aiHint}>Suggestion IA</span>
            )}
            {sameNewSectionCount >= 2 && sectionMode === 'new' && newSectionName.trim() && (
              <span
                className={styles.clusterHint}
                title={`${sameNewSectionCount} sujets seront regroupés dans la même nouvelle section "${newSectionName.trim()}" (dédupliqué au moment de l'import).`}
              >
                📚 {sameNewSectionCount} sujets regroupés
              </span>
            )}
          </div>
          {/* Section-level segmented toggle : only shown when the review is
              existing AND has at least 1 section to pick from. Otherwise
              we either force 'new' (review being created, or review without
              sections) or show a disabled placeholder. */}
          {mode === 'existing' && reviewId && currentReview && currentReview.sections.length > 0 && (
            <div className={styles.segmented} style={{ marginBottom: 6 }}>
              <button
                type="button"
                className={`${styles.segmentedBtn} ${sectionMode === 'new' ? styles.segmentedBtnActive : ''}`}
                disabled={skipped}
                onClick={() => onUpdate({ sectionMode: 'new', sectionId: null })}
              >
                + Créer une nouvelle section
              </button>
              <button
                type="button"
                className={`${styles.segmentedBtn} ${sectionMode === 'existing' ? styles.segmentedBtnActive : ''}`}
                disabled={skipped}
                onClick={() => onUpdate({ sectionMode: 'existing' })}
              >
                Sélectionner une section existante
              </button>
            </div>
          )}
          {(() => {
            // Render decision tree :
            //   1. Review is being created → always "new section" input.
            //   2. No review picked yet    → disabled placeholder dropdown.
            //   3. Review picked, has sections, sectionMode='existing'
            //                              → dropdown of existing sections.
            //   4. Review picked, has sections, sectionMode='new'
            //                              → input with AI suggestion pre-filled.
            //   5. Review picked, no sections → forced "new section" input
            //                                   (with a small hint).
            if (mode === 'create' || !reviewId) {
              if (!reviewId && mode === 'existing') {
                return (
                  <CustomDropdown
                    value=""
                    displayLabel="Sélectionner d'abord une review…"
                    disabled={true}
                    className={showValidation ? styles.dropdownError : ''}
                    options={[]}
                    onChange={() => {}}
                  />
                );
              }
              return (
                <input
                  type="text"
                  placeholder="Nom de la nouvelle section"
                  value={newSectionName}
                  disabled={skipped}
                  onChange={e => onRenameNewSection(e.target.value)}
                  maxLength={80}
                  className={showValidation && !newSectionName.trim() ? styles.inputError : ''}
                />
              );
            }
            // mode === 'existing' + reviewId set from here on.
            const hasExistingSections = !!(currentReview && currentReview.sections.length > 0);
            if (!hasExistingSections) {
              return (
                <>
                  <span className={styles.hint}>Cette review n'a pas encore de section</span>
                  <input
                    type="text"
                    placeholder="Nom de la nouvelle section"
                    value={newSectionName}
                    disabled={skipped}
                    onChange={e => onRenameNewSection(e.target.value)}
                    maxLength={80}
                    className={showValidation && !newSectionName.trim() ? styles.inputError : ''}
                  />
                </>
              );
            }
            if (sectionMode === 'new') {
              return (
                <input
                  type="text"
                  placeholder="Nom de la nouvelle section"
                  value={newSectionName}
                  disabled={skipped}
                  onChange={e => onRenameNewSection(e.target.value)}
                  maxLength={80}
                  className={showValidation && !newSectionName.trim() ? styles.inputError : ''}
                />
              );
            }
            return (
              <CustomDropdown
                value={sectionId ?? ''}
                displayLabel={sectionId ? (currentReview!.sections.find(s => s.id === sectionId)?.name ?? '—') : 'Sélectionner une section…'}
                disabled={skipped}
                className={showValidation && !sectionId ? styles.dropdownError : ''}
                options={currentReview!.sections.map(s => ({ value: s.id, label: s.name }))}
                onChange={(val) => onUpdate({ sectionId: val, subjectAction: 'create', targetSubjectId: null })}
              />
            );
          })()}
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
        {showValidation && !canConfirm && !skipped && (
          <span className={styles.missingFieldsHint}>
            Champ{missingFields.length > 1 ? 's' : ''} requis : {missingFields.join(', ')}
          </span>
        )}
        {/* "Ajouter à une autre review" — clones this row so the subject
            can be dispatched to a second (or third) review. Works whether
            the current row is the AI's original or a user-added copy. */}
        <button
          type="button"
          className={styles.rowActionBtn}
          onClick={onDuplicate}
          title="Ce sujet concerne aussi une autre review — dupliquer la ligne"
        >
          + Ajouter à une autre review
        </button>
        {/* Remove button only on user-created duplicate rows. The original
            AI proposal row uses "Ignorer" to exclude it from the import. */}
        {onRemove && (
          <button
            type="button"
            className={styles.rowActionBtn}
            onClick={onRemove}
            title="Supprimer cette copie"
          >
            Supprimer
          </button>
        )}
        <button
          type="button"
          className={`${styles.rowActionBtn} ${skipped ? styles.rowActionBtnIgnored : ''}`}
          onClick={() => {
            setShowValidation(false);
            onUpdate({ skipped: true, confirmed: false });
          }}
        >
          Ignorer
        </button>
        <button
          type="button"
          className={styles.rowActionBtn}
          disabled={isAdding || addDisabled || skipped}
          onClick={() => {
            if (!canConfirm) {
              setShowValidation(true);
              return;
            }
            setShowValidation(false);
            // Scroll to the next subject card BEFORE the commit — the
            // current row will disappear from the list once the parent
            // receives the applyRouting response.
            if (nextRowKey) {
              setTimeout(() => {
                const nextEl = document.getElementById(`subj-${nextRowKey}`);
                nextEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 120);
            }
            onImmediateAdd();
          }}
        >
          {isAdding ? '⏳ Ajout…' : 'Ajouter'}
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
  className,
}: {
  value: string;
  displayLabel: ReactNode;
  options: Array<{ value: string; label: ReactNode }>;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
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
        className={`${styles.customDropdownBtn} ${className || ''}`}
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
