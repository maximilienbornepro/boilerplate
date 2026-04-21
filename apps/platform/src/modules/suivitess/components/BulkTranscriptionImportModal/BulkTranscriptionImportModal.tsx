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
  /** Append text regenerated on demand when the user overrides the IA's
   *  routing in the wizard (e.g. picks a different target subject).
   *  Populated via the /generate-append-text endpoint. Null means "use
   *  subject.updatedSituation as-is". Populated string overrides. */
  overrideUpdatedSituation?: string | null;
  /** Fresh "situation" composed on demand when the user overrides an
   *  update-proposed row into a create-new one (the IA's original
   *  subject.situation is empty for updates). Null means "use the
   *  IA's original subject.situation". */
  overrideSituation?: string | null;
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

  // ── Single-tile focus mode ──
  // The routing phase shows ONE subject tile at a time instead of the full
  // list. `currentKey` points to the row currently displayed. Auto-advances
  // when the current row is committed or skipped (both paths remove the row
  // from `rows`). `totalAtStart` captures the initial subject count so the
  // progress indicator "Sujet 3/12" stays stable as rows disappear.
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [totalAtStart, setTotalAtStart] = useState(0);
  /** Subjects the user marked as "Ignorer" — tracked so the progress bar
   *  can tell done-committed from done-skipped. Reset when a new analyze
   *  starts. */
  const [skippedCount, setSkippedCount] = useState(0);

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
    // Reset single-tile navigation state for the replay run.
    setCurrentKey(null);
    setSkippedCount(0);
    setCumulativeApplied({
      importedSubjects: 0,
      updatedSubjects: 0,
      createdReviews: 0,
      createdSections: 0,
      touchedReviewIds: new Set(),
    });
    try {
      const res = await api.replayRun(t2LogId);
      setReplayedFromLogId(res.replayedFromLogId);
      setLastLogId(res.logId ?? null);
      setSummary(res.summary);
      setAvailableReviews(res.availableReviews);
      const initialRows = buildRowsFromSubjects(res.subjects);
      setRows(initialRows);
      setConsolidationByRow(res.subjects.map(() => null));
      setTotalAtStart(initialRows.length);
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

  // ── Single-tile focus : always keep `currentKey` pointing to a valid
  // pending row. Auto-advances when the current one is removed (committed
  // or skipped) by falling back to the first pending row. Runs after
  // every displayRows change, so navigation is driven by the data — no
  // manual "advance" calls needed anywhere. ──
  useEffect(() => {
    if (phase !== 'routing') return;
    if (displayRows.length === 0) {
      if (currentKey !== null) setCurrentKey(null);
      return;
    }
    const stillExists = currentKey && displayRows.some(({ r }) => r.key === currentKey);
    if (!stillExists) {
      setCurrentKey(displayRows[0].r.key);
    }
  }, [phase, displayRows, currentKey]);

  /** Remove a row AND count it as "ignored" so the progress indicator
   *  distinguishes a skipped subject from a committed one. Used by the
   *  "Ignorer" button on every tile. */
  const handleSkipRow = (rowKey: string) => {
    setSkippedCount(c => c + 1);
    setRows(prev => prev.filter(r => r.key !== rowKey));
  };

  /** Jump navigation used by the progress dots — picks an arbitrary
   *  pending row as the next focus without committing or skipping
   *  anything. */
  const handleJumpTo = (rowKey: string) => {
    if (displayRows.some(({ r }) => r.key === rowKey)) {
      setCurrentKey(rowKey);
    }
  };

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
    // Reset single-tile navigation state for the new run.
    setCurrentKey(null);
    setSkippedCount(0);
    setCumulativeApplied({
      importedSubjects: 0,
      updatedSubjects: 0,
      createdReviews: 0,
      createdSections: 0,
      touchedReviewIds: new Set(),
    });
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
        const initialRows = buildRowsFromSubjects(res.subjects);
        setRows(initialRows);
        setConsolidationByRow(res.subjects.map(() => null));
        setTotalAtStart(initialRows.length);
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
        const initialRows = buildRowsFromSubjects(res.subjects);
        setRows(initialRows);
        setConsolidationByRow(res.consolidationByProposal ?? res.subjects.map(() => null));
        setTotalAtStart(initialRows.length);
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
      // For user-overridden update → create paths the IA's original
      // `situation` is empty — use the on-demand composed text
      // stored on the row instead.
      situation: r.overrideSituation ?? r.subject.situation,
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
      // Prefer the frontend-regenerated append (user overrode the IA's
      // target) over the original subject.updatedSituation.
      updatedSituation: isUpdate
        ? (r.overrideUpdatedSituation ?? r.subject.updatedSituation ?? r.subject.situation)
        : null,
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
   *  field labels (empty = complete). Also catches stale IA refs (ids
   *  that don't resolve against availableReviews) — those must go
   *  through the wizard so the user picks a valid target. */
  const getMissingFields = (r: Row): string[] => {
    const missing: string[] = [];
    const reviewObj = r.reviewId ? availableReviews.find(rv => rv.id === r.reviewId) ?? null : null;
    const sectionObj = reviewObj && r.sectionId ? reviewObj.sections.find(s => s.id === r.sectionId) ?? null : null;
    if (r.sectionMode === 'existing') {
      if (!r.reviewId) missing.push('review');
      else if (!reviewObj) missing.push('review (référence invalide)');
      else if (!r.sectionId && !r.newSectionName.trim()) missing.push('section');
      else if (r.sectionId && !sectionObj) missing.push('section (référence invalide)');
    } else {
      if (!r.reviewId && !r.newReviewTitle.trim()) missing.push('titre de la nouvelle review');
      if (r.reviewId && !reviewObj) missing.push('review (référence invalide)');
      if (!r.newSectionName.trim()) missing.push('nom de la nouvelle section');
    }
    if (r.subjectAction === 'update') {
      if (!r.targetSubjectId) missing.push('sujet cible');
      else if (sectionObj && !sectionObj.subjects.find(s => s.id === r.targetSubjectId)) {
        missing.push('sujet cible (référence invalide)');
      }
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

        {phase === 'routing' && (() => {
          // Single-tile focus mode : we present ONE subject at a time with
          // a compact progress header + a mini dot nav + a single detailed
          // tile. Clicking "Ajouter" commits the tile to DB and the next
          // one slides in automatically (handled by the useEffect on
          // displayRows / currentKey).
          const currentEntry = currentKey ? displayRows.find(({ r }) => r.key === currentKey) ?? null : null;
          const currentRow = currentEntry?.r ?? null;
          const currentDisplayIdx = currentEntry
            ? displayRows.findIndex(({ r }) => r.key === currentEntry.r.key)
            : -1;
          const doneCount = cumulativeApplied.importedSubjects + cumulativeApplied.updatedSubjects;
          // 1-based position "Sujet X/Y" — based on how many have been
          // processed (committed OR skipped) + 1 for the current one.
          const currentPosition = doneCount + skippedCount + 1;
          const displayTotal = Math.max(totalAtStart, doneCount + skippedCount + displayRows.length);

          // Nav helpers — pick the previous/next pending row in
          // `displayRows` order.
          const prevKey = currentDisplayIdx > 0 ? displayRows[currentDisplayIdx - 1].r.key : null;
          const nextKey = currentDisplayIdx >= 0 && currentDisplayIdx < displayRows.length - 1
            ? displayRows[currentDisplayIdx + 1].r.key
            : null;

          return (
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

            {displayRows.length === 0 ? (
              // ── Done state : all subjects processed (or nothing to process) ──
              doneCount + skippedCount > 0 ? (
                <div className={styles.tileDone}>
                  <p className={styles.tileDoneTitle}>✓ Tous les sujets ont été traités</p>
                  <p className={styles.tileDoneStats}>
                    {doneCount > 0 && (
                      <>
                        <strong>{cumulativeApplied.importedSubjects}</strong> créé{cumulativeApplied.importedSubjects > 1 ? 's' : ''}
                        {cumulativeApplied.updatedSubjects > 0 && <> · <strong>{cumulativeApplied.updatedSubjects}</strong> mis à jour</>}
                      </>
                    )}
                    {skippedCount > 0 && <> · <strong>{skippedCount}</strong> ignoré{skippedCount > 1 ? 's' : ''}</>}
                  </p>
                </div>
              ) : (
                <p className={styles.emptyHint}>L'IA n'a identifié aucun sujet digne d'un suivi dans ce contenu.</p>
              )
            ) : (
              <>
                {/* ── Progress header : position + cumulative counters + dot nav ── */}
                <div className={styles.tileProgress}>
                  <div className={styles.tileProgressHeader}>
                    <strong className={styles.tileProgressPos}>Sujet {currentPosition} sur {displayTotal}</strong>
                    <span className={styles.tileProgressStats}>
                      {doneCount > 0 && (
                        <span className={styles.tileProgressDone}>
                          ✓ {doneCount} importé{doneCount > 1 ? 's' : ''}
                        </span>
                      )}
                      {skippedCount > 0 && (
                        <span className={styles.tileProgressSkipped}>
                          — {skippedCount} ignoré{skippedCount > 1 ? 's' : ''}
                        </span>
                      )}
                      <span className={styles.tileProgressLeft}>
                        {displayRows.length} restant{displayRows.length > 1 ? 's' : ''}
                      </span>
                    </span>
                  </div>
                  {/* Prev/Next arrows + clickable dots all in one row.
                      Replaces the old bottom bar — navigation is now
                      attached to the progress indicator where the user
                      already looks for "where am I in the flow". */}
                  <div className={styles.tileDotsRow} role="tablist" aria-label="Navigation entre sujets">
                    <button
                      type="button"
                      className={styles.tileNavArrow}
                      onClick={() => prevKey && handleJumpTo(prevKey)}
                      disabled={!prevKey || !!addingRowKey}
                      title={prevKey ? 'Sujet précédent' : 'Aucun sujet précédent'}
                      aria-label="Sujet précédent"
                    >
                      ←
                    </button>
                    <div className={styles.tileDots}>
                      {displayRows.map(({ r }, idx) => (
                        <button
                          key={r.key}
                          type="button"
                          role="tab"
                          aria-selected={r.key === currentKey}
                          className={`${styles.tileDot} ${r.key === currentKey ? styles.tileDotCurrent : ''}`}
                          onClick={() => handleJumpTo(r.key)}
                          title={`${idx + 1}. ${r.subject.title}`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className={styles.tileNavArrow}
                      onClick={() => nextKey && handleJumpTo(nextKey)}
                      disabled={!nextKey || !!addingRowKey}
                      title={nextKey ? 'Sujet suivant (sans l\'importer)' : 'Aucun sujet suivant'}
                      aria-label="Sujet suivant"
                    >
                      →
                    </button>
                  </div>
                </div>

                {/* Breadcrumb "Mise à jour › ✓ Review › ✓ Section" above
                    the tile was removed — the same info is already in
                    the AI decision card inside the tile. Avoids
                    displaying the routing twice. */}

                {/* ── The detailed editor for the current tile (ONE) ── */}
                {currentRow && (() => {
                  const r = currentRow;
                  const origIdx = rows.findIndex(x => x.key === r.key);
                  const isCopyRow = r.key.includes('-copy-');
                  const sameTitleCount = rows.filter(x => x.subject.title === r.subject.title).length;
                  const sectionClusterKey = !r.sectionId && r.newSectionName.trim().length > 0
                    ? `${r.reviewId ?? r.newReviewTitle ?? ''}::${r.newSectionName.trim()}`
                    : null;
                  const sameSectionCount = sectionClusterKey
                    ? rows.filter(x => !x.skipped && !x.sectionId && x.newSectionName.trim() &&
                        `${x.reviewId ?? x.newReviewTitle ?? ''}::${x.newSectionName.trim()}` === sectionClusterKey
                      ).length
                    : 0;
                  return (
                    <div className={styles.subjectsList}>
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
                        onSkip={() => handleSkipRow(r.key)}
                        isAdding={addingRowKey === r.key}
                        addDisabled={!!addingRowKey && addingRowKey !== r.key}
                        isMultiPlacement={sameTitleCount >= 2}
                        sameNewSectionCount={sameSectionCount}
                        nextRowKey={null}
                      />
                    </div>
                  );
                })()}
              </>
            )}

            {/* "Terminer" CTA only shown in the all-done state so the
                cumulative tally gets flushed to `onDone`. Regular nav
                (Précédent / Suivant) is integrated into the progress
                header above. Cancel is handled by the modal's own close
                button — no redundant bottom bar here. */}
            {displayRows.length === 0 && doneCount > 0 && (
              <div className={styles.actions}>
                <Button variant="primary" onClick={handleApply}>
                  Terminer ({doneCount} sujet{doneCount > 1 ? 's' : ''})
                </Button>
              </div>
            )}
          </>
          );
        })()}

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
  onDuplicate, onRemove, onImmediateAdd, onSkip, isAdding, addDisabled,
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
  /** Skip this row : removes it from the list and increments the parent's
   *  `skippedCount` so the progress indicator reflects "ignored" vs
   *  "imported" accurately. */
  onSkip: () => void;
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
  const { subject, reviewId, newReviewTitle, sectionId, newSectionName, subjectAction, targetSubjectId, skipped, mode, sectionMode } = row;
  // Only show inline "required field" error after the user attempted to confirm.
  const [showValidation, setShowValidation] = useState(false);
  /** Progressive-disclosure wizard step. `null` means the form is
   *  collapsed — the user only sees the AI decision card + the big
   *  "Importer" / "Je ne suis pas d'accord" CTAs. Once they disagree,
   *  we walk them through review → section → subject one field at a
   *  time, each step pre-selecting the AI's choice + letting them
   *  change it. This avoids overwhelming the user with a 3-field form
   *  they often don't need to touch. */
  const [editStep, setEditStep] = useState<null | 'review' | 'section' | 'subject'>(null);
  // When a fresh tile is mounted we always want the form collapsed —
  // the AI's proposal is the default. The parent drives this via
  // re-mounting on row change (currentKey change).

  /** Loading state while the append-situation skill is running on the
   *  backend. Blocks the CTAs so the user can't import a half-baked
   *  update. */
  const [generatingAppend, setGeneratingAppend] = useState(false);
  /** Remembers the target for which we already generated an append —
   *  prevents re-firing the skill when the user re-opens the wizard or
   *  triggers a re-render that doesn't change the target. */
  const generatedForTargetRef = useRef<string | null>(null);

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

  /** Auto-generate a fresh "situation" (compose-situation skill) when
   *  the user overrides an update-proposed row into a create-new one —
   *  the IA's original subject.situation is empty for updates so
   *  there'd be no preview to show without this regeneration. Runs
   *  once per row (guarded by a ref). */
  const composedForRowRef = useRef<boolean>(false);
  useEffect(() => {
    if (subjectAction !== 'create') {
      composedForRowRef.current = false;
      return;
    }
    // Nothing to generate if the IA already produced a situation
    // (this was a native "create" proposal from the start).
    if (subject.situation && subject.situation.trim().length > 0) return;
    // Already composed once for this row — don't re-fire.
    if (composedForRowRef.current) return;
    if (row.overrideSituation != null) return;

    composedForRowRef.current = true;
    setGeneratingAppend(true);
    api.generateComposeText({
      title: subject.title,
      rawQuotes: subject.sourceRawQuotes ?? [],
    })
      .then(res => {
        onUpdate({ overrideSituation: res.situation ?? '' });
      })
      .catch(err => {
        console.warn('[generateComposeText] failed:', err);
      })
      .finally(() => setGeneratingAppend(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectAction, subject.title]);

  /** Auto-generate a fresh append text whenever the user picks an
   *  existing target subject that's different from the IA's original
   *  proposal (or when the IA proposed "create" and the user overrides
   *  to "update"). Runs the append-situation skill server-side + feeds
   *  the result back into the row so the preview + the final import
   *  payload both reflect the regenerated content. The CTA is blocked
   *  while this is in flight. */
  useEffect(() => {
    if (subjectAction !== 'update' || !targetSubjectId) {
      generatedForTargetRef.current = null;
      return;
    }
    // Nothing to regenerate if the target is still the IA's original
    // AND the IA already produced an updatedSituation for it.
    const aiOriginalTarget = subject.targetSubjectId;
    const aiOriginalAppend = subject.updatedSituation;
    if (targetSubjectId === aiOriginalTarget && aiOriginalAppend && row.overrideUpdatedSituation == null) {
      generatedForTargetRef.current = targetSubjectId;
      return;
    }
    // Already generated for this exact target — no re-fire.
    if (generatedForTargetRef.current === targetSubjectId) return;

    const target = currentSection?.subjects.find(s => s.id === targetSubjectId);
    if (!target) return;
    generatedForTargetRef.current = targetSubjectId;
    setGeneratingAppend(true);
    api.generateAppendText({
      existingSituation: target.situation ?? '',
      rawQuotes: subject.sourceRawQuotes ?? [],
      subjectTitle: target.title,
    })
      .then(res => {
        onUpdate({ overrideUpdatedSituation: res.appendText ?? '' });
      })
      .catch(err => {
        console.warn('[generateAppendText] failed:', err);
      })
      .finally(() => setGeneratingAppend(false));
  // Ran on target / action change — not on row.overrideUpdatedSituation
  // or render-only props, otherwise the effect would loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSubjectId, subjectAction, currentSection?.id]);

  // ── Validation: surface what's missing before the user can confirm ──
  // Review side :
  //   'create'   → newReviewTitle required
  //   'existing' → reviewId required AND must resolve in `reviews`
  // Section side (sectionMode) :
  //   'new'      → newSectionName required
  //   'existing' → sectionId required AND must resolve in currentReview
  // Subject side :
  //   'update'   → targetSubjectId required AND must resolve
  // Resolvability checks guard against stale IA proposals that picked
  // IDs which disappeared from the snapshot — those would silently be
  // sent to apply-routing and either fail server-side or create
  // corrupted links. Force the user through the wizard to fix.
  const missingFields: string[] = [];
  if (mode === 'create') {
    if (!newReviewTitle.trim()) missingFields.push('titre de la nouvelle review');
  } else {
    if (!reviewId) missingFields.push('review');
    else if (!currentReview) missingFields.push('review (référence invalide)');
  }
  if (sectionMode === 'new') {
    if (!newSectionName.trim()) missingFields.push('nom de la nouvelle section');
  } else {
    if (!sectionId) missingFields.push('section');
    else if (mode === 'existing' && !currentSection) missingFields.push('section (référence invalide)');
  }
  if (subjectAction === 'update') {
    if (!targetSubjectId) missingFields.push('sujet cible');
    else if (currentSection && !currentSection.subjects.find(s => s.id === targetSubjectId)) {
      missingFields.push('sujet cible (référence invalide)');
    }
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

      {/* Decision statement : reads the row's CURRENT state (not the
          AI's original proposal) so the text stays in sync with the
          user's wizard edits. When the user overrides the IA's choice,
          the sentence + badge (MISE À JOUR / CRÉATION) update live.
          The original IA reasoning is still shown at the bottom as
          context ("why the IA picked this route"). */}
      {(() => {
        // Current user-visible choices — driven entirely by the row's
        // live state, which the wizard mutates.
        const currentIsUpdate = subjectAction === 'update' && !!targetSubjectId;
        const currentReviewLabel = reviewId
          ? (reviews.find(rv => rv.id === reviewId)?.title ?? reviewId)
          : (newReviewTitle || subject.suggestedNewReviewTitle || 'nouvelle review');
        const currentReviewIsExisting = mode === 'existing' && !!reviewId;
        // Fallback section name lookup : when the AI picked a section
        // id that isn't in the current availableReviews snapshot (stale
        // frontend state, or the section was created after the snapshot
        // was taken), try to find the section by scanning ALL sections
        // across ALL reviews. Last resort : show a readable label
        // instead of a raw UUID.
        const resolvedSectionName = sectionMode === 'existing' && sectionId
          ? (currentSection?.name
              ?? reviews.flatMap(rv => rv.sections).find(sec => sec.id === sectionId)?.name
              ?? 'section inconnue')
          : null;
        const currentSectionLabel = sectionMode === 'existing' && sectionId
          ? resolvedSectionName!
          : (newSectionName || subject.suggestedNewSectionName || 'nouvelle section');
        const currentSectionIsExisting = sectionMode === 'existing' && !!sectionId;
        // Resolve the target subject title — with a global fallback
        // when the local currentSection lookup fails (stale snapshot
        // case). Prevents the UI from rendering "(cible non résolue)"
        // when the target actually exists somewhere reachable.
        const currentTargetSubjectTitle = currentIsUpdate
          ? (currentSection?.subjects.find(s => s.id === targetSubjectId)?.title
              ?? reviews.flatMap(rv => rv.sections.flatMap(sec => sec.subjects))
                  .find(sub => sub.id === targetSubjectId)?.title
              ?? null)
          : null;
        // Diff indicator : show a small "✎ modifié" badge if the current
        // choice diverges from the AI's original proposal.
        const userChangedRoute =
          (mode === 'create') !== (subject.action !== 'existing-review')
          || (mode === 'existing' && subject.action === 'existing-review' && reviewId !== subject.reviewId)
          || (sectionMode === 'new') !== (subject.sectionAction !== 'existing-section')
          || (sectionMode === 'existing' && subject.sectionAction === 'existing-section' && sectionId !== subject.sectionId)
          || (subjectAction === 'update') !== (subject.subjectAction === 'update-existing-subject')
          || (subjectAction === 'update' && targetSubjectId !== subject.targetSubjectId);
        return (
          <div className={`${styles.aiDecisionCard} ${currentIsUpdate ? styles.aiDecisionCardUpdate : styles.aiDecisionCardCreate}`}>
            {/* Natural-language sentence read left-to-right in the same
                order as the wizard steps : Review → Section → Subject.
                Pills keep the "existant vs nouveau" color signal. */}
            <p className={styles.aiDecisionStatement}>
              Dans la {currentReviewIsExisting ? 'review existante' : <strong>nouvelle review</strong>}{' '}
              <strong className={currentReviewIsExisting ? styles.aiDecisionPillExisting : styles.aiDecisionPillNew}>« {currentReviewLabel} »</strong>
              , {currentSectionIsExisting ? 'section existante' : <strong>nouvelle section</strong>}{' '}
              <strong className={currentSectionIsExisting ? styles.aiDecisionPillExisting : styles.aiDecisionPillNew}>« {currentSectionLabel} »</strong>
              ,{' '}
              <strong className={styles.aiDecisionStatementLead}>
                {currentIsUpdate ? 'MISE À JOUR' : 'CRÉATION'}
              </strong>{' '}
              {currentIsUpdate ? (
                currentTargetSubjectTitle ? (
                  <>
                    du sujet existant{' '}
                    <strong className={styles.aiDecisionTargetSubject}>« {currentTargetSubjectTitle} »</strong>
                  </>
                ) : (
                  <>d'un sujet existant <em>(cible non résolue — à choisir ci-dessous)</em></>
                )
              ) : (
                <>
                  d'un nouveau sujet{' '}
                  <strong className={styles.aiDecisionTargetSubject}>« {subject.title} »</strong>
                </>
              )}
              .
              {userChangedRoute && (
                <span className={styles.aiDecisionModifiedBadge} title="Tu as modifié la proposition de l'IA">✎ modifié</span>
              )}
            </p>
            {subject.reasoning && (
              <p className={styles.aiDecisionReason}>
                <strong className={styles.aiDecisionReasonLead}>RAISON IA :</strong> {subject.reasoning}
              </p>
            )}
            {/* État de situation du sujet cible — affiché directement
                dans la decision card (pas seulement dans le wizard)
                quand on est en mode mise à jour. Permet à l'utilisateur
                de voir sans cliquer quoi que ce soit à quoi le nouveau
                contenu va se greffer. */}
            {/* Preview of the NEW subject's situation — shown right in
                the decision card (not only inside the wizard) so the
                user sees the full content that will be persisted even
                when the form is collapsed. Falls back on the on-demand
                composed situation when the IA didn't provide one
                (happens for user-overridden update → create rows). */}
            {!currentIsUpdate && (() => {
              const composedSituation = row.overrideSituation ?? subject.situation ?? '';
              if (!composedSituation.trim() && !generatingAppend) return null;
              const lines = composedSituation.split('\n').filter(l => l.trim().length > 0);
              const renderLine = (text: string) => {
                const parts = text.split(/(~~[^~]+~~)/g);
                return parts.map((p, i) => p.startsWith('~~') && p.endsWith('~~')
                  ? <s key={i} className={styles.situationPreviewStrike}>{p.slice(2, -2)}</s>
                  : <span key={i}>{p}</span>);
              };
              return (
                <div className={styles.aiDecisionTargetSituation}>
                  <div className={styles.aiDecisionTargetSituationLabel}>
                    📝 État de situation du nouveau sujet
                    {subject.status && <span className={styles.aiDecisionTargetSituationCount}> · statut : {subject.status}</span>}
                    {subject.responsibility && <span className={styles.aiDecisionTargetSituationCount}> · resp : {subject.responsibility}</span>}
                    {generatingAppend && <span className={styles.situationPreviewGenerating}> · ⏳ IA en cours…</span>}
                  </div>
                  <div className={styles.aiDecisionTargetSituationBody}>
                    {generatingAppend && lines.length === 0 ? (
                      <div className={styles.aiDecisionTargetSituationPendingAppend}>
                        ⏳ L'IA compose l'état de situation à partir des extraits sources…
                      </div>
                    ) : lines.map((l, i) => (
                      <div key={`new-subj-${i}`} className={styles.aiDecisionTargetSituationAddedLine}>
                        <span className={styles.aiDecisionTargetSituationAddedBullet}>+</span>
                        {renderLine(l)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {currentIsUpdate && currentTargetSubjectTitle && (() => {
              // Prefer the in-section target; fall back to a global
              // lookup when the section snapshot is stale.
              const target = currentSection?.subjects.find(s => s.id === targetSubjectId)
                ?? reviews.flatMap(rv => rv.sections.flatMap(sec => sec.subjects))
                    .find(sub => sub.id === targetSubjectId);
              if (!target) return null;
              const existing = (target.situation ?? '').split('\n').filter(l => l.trim().length > 0);
              const lastLines = existing.slice(-4);
              // Append source : prefer the frontend-regenerated text,
              // else the IA's original updatedSituation. Don't fall
              // back to subject.situation here — that's the full
              // composed text for a "create" path, not an append.
              const appendSource = row.overrideUpdatedSituation ?? subject.updatedSituation ?? '';
              const newLines = appendSource.split('\n').filter(l => l.trim().length > 0);
              const renderLine = (text: string) => {
                const parts = text.split(/(~~[^~]+~~)/g);
                return parts.map((p, i) => p.startsWith('~~') && p.endsWith('~~')
                  ? <s key={i} className={styles.situationPreviewStrike}>{p.slice(2, -2)}</s>
                  : <span key={i}>{p}</span>);
              };
              return (
                <div className={styles.aiDecisionTargetSituation}>
                  <div className={styles.aiDecisionTargetSituationLabel}>
                    📄 État de situation actuel du sujet cible
                    {existing.length > 4 && <span className={styles.aiDecisionTargetSituationCount}> · {existing.length} lignes (4 dernières)</span>}
                    {generatingAppend && <span className={styles.situationPreviewGenerating}> · ⏳ IA en cours…</span>}
                  </div>
                  <div className={styles.aiDecisionTargetSituationBody}>
                    {lastLines.length > 0 ? lastLines.map((l, i) => (
                      <div key={`ex-${i}`} className={styles.aiDecisionTargetSituationLine}>{renderLine(l)}</div>
                    )) : (
                      <div className={styles.aiDecisionTargetSituationEmpty}>(situation actuelle vide)</div>
                    )}

                    {/* Explicit "+" marker + highlighted new lines so
                        the user sees exactly which part is the append
                        vs the historical lines. */}
                    {generatingAppend ? (
                      <div className={styles.aiDecisionTargetSituationPendingAppend}>
                        ⏳ L'IA rédige l'ajout adapté au sujet existant…
                      </div>
                    ) : newLines.length > 0 ? (
                      <>
                        <div className={styles.aiDecisionTargetSituationAddedSep}>
                          + ajout ({newLines.length} ligne{newLines.length > 1 ? 's' : ''})
                        </div>
                        {newLines.map((l, i) => (
                          <div key={`new-${i}`} className={styles.aiDecisionTargetSituationAddedLine}>
                            <span className={styles.aiDecisionTargetSituationAddedBullet}>+</span>
                            {renderLine(l)}
                          </div>
                        ))}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ── Progressive-disclosure wizard ──
          By default the form is hidden and the user sees only the AI
          decision card + the big CTAs below. Clicking "Je ne suis pas
          d'accord" opens the wizard at step 1 (review). Each step
          pre-selects the AI's proposal and lets the user override, then
          "Valider l'étape" advances to the next one. On the final step,
          the primary button triggers the immediate-add. */}
      {editStep !== null && (() => {
        // All 3 steps are always part of the wizard now — the subject
        // step lets the user pick an existing subject to append to even
        // when the AI proposed a fresh one, and it also surfaces the
        // "aucun sujet existant" case explicitly so the user always
        // sees what will happen.
        const steps: Array<'review' | 'section' | 'subject'> = ['review', 'section', 'subject'];
        const stepIdx = steps.indexOf(editStep);
        const stepNumber = stepIdx + 1;
        const stepLabel = editStep === 'review' ? 'Review' : editStep === 'section' ? 'Section' : 'Sujet';
        return (
          <div className={styles.wizardBreadcrumb}>
            <span className={styles.wizardStepBadge}>
              Étape {stepNumber} sur {steps.length}
            </span>
            <span className={styles.wizardStepLabel}>{stepLabel}</span>
            <button
              type="button"
              className={styles.wizardCancelBtn}
              onClick={() => { setEditStep(null); setShowValidation(false); }}
              title="Revenir à la proposition IA (abandonner les modifications en cours)"
            >
              ✕ Annuler mes modifications
            </button>
          </div>
        );
      })()}

      {/* Locked summary : when we're past review/section step, show the
          previously-chosen values as read-only info at the top of the
          form so the user stays oriented. */}
      {editStep === 'section' && (
        <div className={styles.wizardLockedInfo}>
          <span className={styles.wizardLockedLabel}>Review choisie :</span>
          <strong>{mode === 'create' ? (newReviewTitle || 'Nouvelle review (sans titre)') : (reviews.find(r => r.id === reviewId)?.title ?? '—')}</strong>
          <button
            type="button"
            className={styles.wizardLockedBack}
            onClick={() => setEditStep('review')}
          >
            Modifier
          </button>
        </div>
      )}
      {editStep === 'subject' && (
        <div className={styles.wizardLockedInfo}>
          <span className={styles.wizardLockedLabel}>Review :</span>
          <strong>{mode === 'create' ? (newReviewTitle || 'Nouvelle review (sans titre)') : (reviews.find(r => r.id === reviewId)?.title ?? '—')}</strong>
          <span className={styles.wizardLockedSep}>›</span>
          <span className={styles.wizardLockedLabel}>Section :</span>
          <strong>{sectionMode === 'new' ? (newSectionName || 'Nouvelle section (sans nom)') : (currentSection?.name ?? '—')}</strong>
          <button
            type="button"
            className={styles.wizardLockedBack}
            onClick={() => setEditStep('section')}
          >
            Modifier
          </button>
        </div>
      )}

      <div className={styles.routing} style={{ display: editStep === null ? 'none' : undefined }}>
        {/* ── REVIEW STEP ──
            Single unified dropdown : "+ Créer une nouvelle review" is
            the first option, followed by existing reviews. Picking
            "+ Créer…" switches the row to create-mode and surfaces an
            inline text input for the new title. No more segmented
            toggle — one decision, one dropdown. */}
        {editStep === 'review' && (
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
          <CustomDropdown
            value={mode === 'create' ? '__new__' : (reviewId ?? '')}
            displayLabel={
              mode === 'create'
                ? <span className={styles.dropdownNewOption}>+ Créer « {newReviewTitle || subject.suggestedNewReviewTitle || 'nouvelle review'} »</span>
                : reviewId ? (reviews.find(r => r.id === reviewId)?.title ?? '—') : 'Sélectionner une review…'
            }
            disabled={skipped}
            className={showValidation && !reviewId && !newReviewTitle.trim() ? styles.dropdownError : ''}
            options={[
              {
                value: '__new__',
                label: (
                  <span className={styles.dropdownNewOption}>
                    + Créer une nouvelle review{subject.suggestedNewReviewTitle && <em className={styles.dropdownNewHint}> « {subject.suggestedNewReviewTitle} »</em>}
                  </span>
                ),
              },
              ...(reviews.length > 0 ? [{ value: '__sep__', label: 'Reviews existantes' }] : []),
              ...reviews.map(r => ({ value: r.id, label: r.title })),
            ]}
            onChange={(val) => {
              if (val === '__new__') {
                // Already in create-mode → no-op so we don't wipe an
                // edited `newReviewTitle` or a just-chosen sectionMode.
                if (mode === 'create') return;
                onUpdate({
                  mode: 'create',
                  reviewId: null,
                  sectionId: null,
                  sectionMode: 'new',
                  newReviewTitle: newReviewTitle || subject.suggestedNewReviewTitle || 'Nouvelle review',
                });
              } else {
                // Re-picking the SAME review → no-op, otherwise we'd
                // wipe the AI-picked sectionId and force the user to
                // re-choose a section they never wanted to change.
                if (mode === 'existing' && reviewId === val) return;
                onUpdate({ mode: 'existing', reviewId: val, sectionId: null, sectionMode: 'existing' });
              }
            }}
          />
        </div>
        )}

        {/* ── SECTION STEP ──
            Single dropdown : "+ Créer une nouvelle section (nom suggéré)"
            at top, then existing sections of the chosen review. When
            the review is itself new, only the "+ Créer" option shows
            (no existing sections to pick from yet). Same UX as the
            review step — no more segmented toggle. */}
        {editStep === 'section' && (() => {
          const hasExistingSections = mode === 'existing' && !!currentReview && currentReview.sections.length > 0;
          const suggestedSectionName = newSectionName || subject.suggestedNewSectionName || 'nouvelle section';
          return (
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
              <CustomDropdown
                value={sectionMode === 'new' ? '__new__' : (sectionId ?? '')}
                displayLabel={
                  sectionMode === 'new'
                    ? <span className={styles.dropdownNewOption}>+ Créer « {suggestedSectionName} »</span>
                    : sectionId
                      ? (currentReview?.sections.find(s => s.id === sectionId)?.name ?? '—')
                      : 'Sélectionner une section…'
                }
                disabled={skipped}
                className={showValidation && !sectionId && !newSectionName.trim() ? styles.dropdownError : ''}
                options={[
                  {
                    value: '__new__',
                    label: (
                      <span className={styles.dropdownNewOption}>
                        + Créer une nouvelle section{subject.suggestedNewSectionName && <em className={styles.dropdownNewHint}> « {subject.suggestedNewSectionName} »</em>}
                      </span>
                    ),
                  },
                  ...(hasExistingSections ? [{ value: '__sep__', label: 'Sections existantes' }] : []),
                  ...(hasExistingSections ? currentReview!.sections.map(s => ({ value: s.id, label: s.name })) : []),
                ]}
                onChange={(val) => {
                  if (val === '__new__') {
                    onUpdate({
                      sectionMode: 'new',
                      sectionId: null,
                      subjectAction: 'create',
                      targetSubjectId: null,
                    });
                    if (!newSectionName.trim() && subject.suggestedNewSectionName) {
                      onRenameNewSection(subject.suggestedNewSectionName);
                    }
                  } else {
                    onUpdate({ sectionMode: 'existing', sectionId: val, subjectAction: 'create', targetSubjectId: null });
                  }
                }}
              />
            </div>
          );
        })()}

        {/* ── SUBJECT STEP ──
            Always rendered. Single dropdown with "+ Créer un nouveau
            sujet" at top, then existing subjects of the chosen section
            shown as "Ajouter comme état de situation à : <titre>" — the
            user can ALWAYS choose to attach the new content to an
            existing subject even when the AI proposed a fresh one. */}
        {editStep === 'subject' && (
          <div className={`${styles.routingField} ${styles.routingFieldFull}`}>
            <label>
              Action sur le sujet
              <span className={styles.requiredMark}>*</span>
            </label>
            <CustomDropdown
              value={subjectAction === 'update' ? (targetSubjectId ?? '') : '__new__'}
              displayLabel={
                subjectAction === 'update' && targetSubjectId
                  ? <>Ajouter comme état de situation à : <strong>{currentSection?.subjects.find(s => s.id === targetSubjectId)?.title ?? '—'}</strong></>
                  : <span className={styles.dropdownNewOption}>+ Créer un nouveau sujet « {subject.title} »</span>
              }
              disabled={skipped}
              className={showValidation && subjectAction === 'update' && !targetSubjectId ? styles.dropdownError : ''}
              options={[
                {
                  value: '__new__',
                  label: (
                    <span className={styles.dropdownNewOption}>
                      + Créer un nouveau sujet <em className={styles.dropdownNewHint}>« {subject.title} »</em>
                    </span>
                  ),
                },
                ...(currentSection && currentSection.subjects.length > 0
                  ? [{ value: '__sep__', label: 'Ou ajouter comme état de situation à un sujet existant' }]
                  : []),
                ...(currentSection?.subjects.map(s => ({ value: s.id, label: s.title })) ?? []),
              ]}
              onChange={(val) => {
                if (val === '__new__') {
                  onUpdate({ subjectAction: 'create', targetSubjectId: null });
                } else {
                  onUpdate({ subjectAction: 'update', targetSubjectId: val });
                }
              }}
            />
            {(!currentSection || currentSection.subjects.length === 0) && (
              <span className={styles.hint}>
                Aucun sujet existant dans cette section — le sujet sera créé comme nouveau.
              </span>
            )}

            {/* Preview for the "create new subject" path : shows the
                état de situation that will become the subject's initial
                `situation` on import. Falls back to the on-demand
                composed text when the IA didn't provide one
                (user-overridden update → create path). */}
            {subjectAction === 'create' && (() => {
              const effectiveSituation = row.overrideSituation ?? subject.situation ?? '';
              if (!effectiveSituation.trim() && !generatingAppend) return null;
              const lines = effectiveSituation.split('\n').filter(l => l.trim().length > 0);
              const renderLine = (text: string) => {
                const parts = text.split(/(~~[^~]+~~)/g);
                return parts.map((p, i) => p.startsWith('~~') && p.endsWith('~~')
                  ? <s key={i} className={styles.situationPreviewStrike}>{p.slice(2, -2)}</s>
                  : <span key={i}>{p}</span>);
              };
              return (
                <div className={styles.situationPreview}>
                  <div className={styles.situationPreviewLabel}>
                    Aperçu du nouveau sujet qui sera créé
                    {generatingAppend && <span className={styles.situationPreviewGenerating}> · ⏳ IA en cours…</span>}
                  </div>
                  <div className={styles.situationPreviewBody}>
                    <div className={styles.situationPreviewNewSubjectTitle}>
                      <strong>« {subject.title} »</strong>
                      <span className={styles.situationPreviewNewSubjectStatus}>
                        · statut : {subject.status}
                      </span>
                      {subject.responsibility && (
                        <span className={styles.situationPreviewNewSubjectResp}>
                          · resp : {subject.responsibility}
                        </span>
                      )}
                    </div>
                    <div className={styles.situationPreviewSep}>───── état de situation ─────</div>
                    {generatingAppend && lines.length === 0 ? (
                      <div className={styles.situationPreviewGeneratingBlock}>
                        ⏳ L'IA compose l'état de situation à partir des extraits sources…
                      </div>
                    ) : lines.map((l, i) => (
                      <div key={`cs-${i}`} className={styles.situationPreviewNew}>{renderLine(l)}</div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Wizard preview of the full situation after import. Only
                rendered when there's actually an append to preview
                (newLines.length > 0) OR the IA is currently generating
                one — otherwise the block would just echo the existing
                situation which is pointless (the decision card above
                already shows it). */}
            {subjectAction === 'update' && targetSubjectId && currentSection && (() => {
              const target = currentSection.subjects.find(s => s.id === targetSubjectId);
              if (!target) return null;
              // Prefer the frontend-regenerated append when available.
              const appendSource = row.overrideUpdatedSituation
                ?? subject.updatedSituation
                ?? '';
              const newLines = appendSource.split('\n').filter(l => l.trim().length > 0);
              // Nothing new AND not currently generating → skip the
              // whole block. Showing "existing lines then (aucun nouveau
              // contenu)" was noise.
              if (newLines.length === 0 && !generatingAppend) return null;
              const existing = (target.situation ?? '').split('\n').filter(l => l.trim().length > 0);
              const lastLines = existing.slice(-4);
              const renderLine = (text: string) => {
                const parts = text.split(/(~~[^~]+~~)/g);
                return parts.map((p, i) => p.startsWith('~~') && p.endsWith('~~')
                  ? <s key={i} className={styles.situationPreviewStrike}>{p.slice(2, -2)}</s>
                  : <span key={i}>{p}</span>);
              };
              return (
                <div className={styles.situationPreview}>
                  <div className={styles.situationPreviewLabel}>
                    Aperçu de la situation après import
                    {generatingAppend && <span className={styles.situationPreviewGenerating}> · ⏳ IA en cours…</span>}
                  </div>
                  <div className={styles.situationPreviewBody}>
                    {existing.length > 4 && (
                      <div className={styles.situationPreviewEllipsis}>
                        … ({existing.length - 4} ligne{existing.length - 4 > 1 ? 's' : ''} plus haut)
                      </div>
                    )}
                    {lastLines.length > 0 ? lastLines.map((l, i) => (
                      <div key={`ex-${i}`} className={styles.situationPreviewExisting}>{renderLine(l)}</div>
                    )) : (
                      <div className={styles.situationPreviewEmpty}>(situation actuelle vide)</div>
                    )}
                    <div className={styles.situationPreviewSep}>───── ajout ci-dessous ─────</div>
                    {generatingAppend ? (
                      <div className={styles.situationPreviewGeneratingBlock}>
                        ⏳ L'IA analyse le sujet existant et adapte le texte d'ajout…
                      </div>
                    ) : newLines.map((l, i) => (
                      <div key={`new-${i}`} className={styles.situationPreviewNew}>{renderLine(l)}</div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <div className={styles.rowActions}>
        {showValidation && !canConfirm && !skipped && (
          <span className={styles.missingFieldsHint}>
            Champ{missingFields.length > 1 ? 's' : ''} requis : {missingFields.join(', ')}
          </span>
        )}

        {editStep === null ? (
          // ── COLLAPSED VIEW ── Default state : user hasn't opened
          // the wizard. Big CTAs accept the AI proposal as-is, skip
          // the subject, or open the wizard to edit. Duplicate-to-
          // another-review has been moved into the wizard's review
          // step (via the "+ Créer" dropdown option); it's no longer
          // a top-level button.
          <>
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
              className={styles.rowActionBtn}
              disabled={isAdding || addDisabled || generatingAppend}
              onClick={() => { setShowValidation(false); onSkip(); }}
              title="Passer ce sujet sans l'importer"
            >
              Ignorer
            </button>
            <button
              type="button"
              className={`${styles.rowActionBtn} ${styles.rowActionBtnDisagree}`}
              disabled={generatingAppend}
              onClick={() => setEditStep('review')}
              title="Ajuster la review / la section / le sujet avant d'importer"
            >
              ⚠ Je ne suis pas d'accord
            </button>
            <button
              type="button"
              className={`${styles.rowActionBtn} ${styles.rowActionBtnPrimary}`}
              disabled={isAdding || addDisabled || skipped || generatingAppend}
              onClick={() => {
                if (!canConfirm) {
                  // Open the wizard at the FIRST step that actually
                  // needs fixing — no sense forcing the user to re-
                  // confirm a valid review just because the section
                  // is broken. Computed from the same rules as
                  // `missingFields` for consistency.
                  const reviewBroken =
                    (mode === 'create' && !newReviewTitle.trim())
                    || (mode === 'existing' && (!reviewId || !currentReview));
                  const sectionBroken =
                    (sectionMode === 'new' && !newSectionName.trim())
                    || (sectionMode === 'existing' && (!sectionId || (mode === 'existing' && !currentSection)));
                  const firstBrokenStep: 'review' | 'section' | 'subject' =
                    reviewBroken ? 'review'
                    : sectionBroken ? 'section'
                    : 'subject';
                  setEditStep(firstBrokenStep);
                  setShowValidation(true);
                  return;
                }
                onImmediateAdd();
              }}
              title={
                generatingAppend
                  ? 'L\'IA analyse le sujet existant et adapte le texte d\'ajout…'
                  : canConfirm
                    ? 'Importer ce sujet en base avec la proposition de l\'IA'
                    : 'Compléter les champs requis avant d\'importer'
              }
            >
              {generatingAppend
                ? '⏳ IA en train d\'adapter l\'ajout…'
                : isAdding
                  ? '⏳ Import en cours…'
                  : '✓ Importer et passer au suivant'}
            </button>
          </>
        ) : (
          // ── WIZARD VIEW ── User is stepping through review → section
          // → subject. Each step validates its own field(s) before
          // advancing. Final step imports.
          (() => {
            // Subject step is always present now — even without any
            // existing subjects, the user needs an explicit
            // confirmation that a new subject will be created.
            const isLastStep = editStep === 'subject';
            // Per-step validation : block "Valider" until the current
            // step's fields are filled in.
            const reviewStepValid = mode === 'create' ? !!newReviewTitle.trim() : !!reviewId;
            const sectionStepValid = sectionMode === 'new'
              ? !!newSectionName.trim()
              : !!sectionId;
            const subjectStepValid = subjectAction !== 'update' || !!targetSubjectId;
            const currentStepValid =
              editStep === 'review' ? reviewStepValid
              : editStep === 'section' ? sectionStepValid
              : subjectStepValid;
            const goPrev = () => {
              setShowValidation(false);
              if (editStep === 'section') setEditStep('review');
              else if (editStep === 'subject') setEditStep('section');
              else { setEditStep(null); }
            };
            const goNext = () => {
              if (!currentStepValid) { setShowValidation(true); return; }
              setShowValidation(false);
              if (isLastStep) {
                // Final validation covers EVERY field (not just the
                // current one) to be safe before persisting.
                if (!canConfirm) { setShowValidation(true); return; }
                onImmediateAdd();
                return;
              }
              if (editStep === 'review') setEditStep('section');
              else if (editStep === 'section') setEditStep('subject');
            };
            return (
              <>
                <button
                  type="button"
                  className={styles.rowActionBtn}
                  onClick={goPrev}
                  title={editStep === 'review' ? 'Fermer le formulaire et revenir à la proposition IA' : 'Revenir à l\'étape précédente'}
                >
                  ← {editStep === 'review' ? 'Annuler' : 'Précédent'}
                </button>
                <button
                  type="button"
                  className={`${styles.rowActionBtn} ${styles.rowActionBtnPrimary}`}
                  disabled={isAdding || addDisabled || skipped || generatingAppend}
                  onClick={goNext}
                  title={
                    generatingAppend
                      ? 'L\'IA adapte le texte d\'ajout au sujet existant — patiente une seconde…'
                      : isLastStep
                        ? 'Importer ce sujet avec tes choix'
                        : 'Valider ce choix et passer à l\'étape suivante'
                  }
                >
                  {generatingAppend
                    ? '⏳ IA en train d\'adapter l\'ajout…'
                    : isAdding
                      ? '⏳ Import en cours…'
                      : isLastStep
                        ? '✓ Valider et importer'
                        : `Valider et continuer →`}
                </button>
              </>
            );
          })()
        )}
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
    // Close the dropdown on scroll — BUT ignore scrolls that happen
    // inside our own menu (so the internal option list remains
    // scrollable). We use `Node.contains(target)` which returns true
    // when the node is the target itself, so scrolling the menu's
    // own overflow container is correctly treated as "inside".
    const scrollHandler = (e: Event) => {
      const target = e.target as Node | null;
      const menu = ref.current?.querySelector('[role="menu"]');
      if (menu && target && (menu === target || menu.contains(target))) return;
      // Also ignore events fired on Document itself during menu
      // scroll (some browsers bubble a document-level scroll while
      // the actual scrolling happens on the menu container).
      if (target === document || target instanceof Document) return;
      setOpen(false);
    };
    // Prevent wheel-over-menu from bubbling up to the modal container
    // and making the whole modal scroll (which would then trigger our
    // close handler). The menu already has `overflowY: auto` +
    // `overscrollBehavior: contain` so its own scroll is preserved.
    const wheelHandler = (e: WheelEvent) => {
      const menu = ref.current?.querySelector('[role="menu"]') as HTMLElement | null;
      if (!menu) return;
      const target = e.target as Node | null;
      if (!target || !(menu === target || menu.contains(target))) return;
      // We're inside the menu — stop the wheel event from reaching
      // ancestor scroll containers. The menu will scroll itself.
      const atTop = menu.scrollTop === 0 && e.deltaY < 0;
      const atBottom = menu.scrollTop + menu.clientHeight >= menu.scrollHeight && e.deltaY > 0;
      if (!atTop && !atBottom) {
        e.stopPropagation();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('scroll', scrollHandler, true);
    document.addEventListener('wheel', wheelHandler, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('scroll', scrollHandler, true);
      document.removeEventListener('wheel', wheelHandler, true);
    };
  }, [open]);

  // Auto-disable when only one option is available (nothing to choose from)
  // Count *selectable* options — separators ("__sep__") are decorative
  // and shouldn't count toward "only one option left". Previously the
  // dropdown was auto-disabled when there was a single option, which
  // broke the new "+ Créer …" flow where the dropdown legitimately
  // has only the create option (e.g. when the parent review is itself
  // being created and has no existing sections yet).
  const selectableCount = options.filter(o => o.value !== '__sep__').length;
  const effectiveDisabled = disabled || selectableCount === 0;

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
        <div
          className="suivitess-exports-menu"
          role="menu"
          /* Larger max-height + explicit scroll behaviour so every
             section is reachable when a review has many of them. The
             previous 240px cap was silently truncating long lists
             because the scrollbar wasn't obvious. */
          style={{ width: '100%', maxHeight: 360, overflowY: 'auto', overscrollBehavior: 'contain' }}
        >
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
