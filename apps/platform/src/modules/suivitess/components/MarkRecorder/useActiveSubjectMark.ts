// Lightweight hook that tracks the user's currently-active subject
// mark on a given suivitess document. Used by both the per-subject
// 🎙️ buttons (so they can render an "active" visual state) and the
// document-level sticky banner.
//
// Strategy : single fetch on mount + opt-in refresh after a click.
// We don't poll — the active mark only changes when this very page
// triggers it, so a stale value is acceptable. A "marksUpdated"
// CustomEvent is dispatched on window so any consumer (other
// SubjectReview cards, the banner) refreshes in sync.

import { useCallback, useEffect, useState } from 'react';
import {
  getActiveSubjectMark,
  setSubjectMark,
  type SubjectMark,
} from '../../services/api';

const EVENT_NAME = 'suivitess:mark-updated';

export interface ActiveMarkController {
  /** Most recent mark on this (user, doc). Null when never clicked
   *  OR when the latest click was an explicit "stop". */
  active: SubjectMark | null;
  /** Currently fetching the initial state. */
  loading: boolean;
  /** Whether the latest click is an "active" mark (subject_id != null).
   *  When the latest mark is a "stop", `active.subjectId === null`
   *  and this is false — useful for the banner show/hide. */
  isCurrentlyMarking: boolean;
  /** Click handler: set or unset the active subject. Pass `null` to
   *  record an explicit stop. Updates local state + broadcasts. */
  setMark: (subjectId: string | null) => Promise<void>;
}

export function useActiveSubjectMark(documentId: string | null): ActiveMarkController {
  const [active, setActive] = useState<SubjectMark | null>(null);
  const [loading, setLoading] = useState<boolean>(!!documentId);

  const refresh = useCallback(async () => {
    if (!documentId) return;
    try {
      const fresh = await getActiveSubjectMark(documentId);
      setActive(fresh);
    } catch {
      // Marks layer is best-effort — silent failure keeps the rest of
      // the document working without surfacing a loud error.
    }
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;
    if (!documentId) {
      setLoading(false);
      setActive(null);
      return;
    }
    setLoading(true);
    getActiveSubjectMark(documentId)
      .then(m => { if (!cancelled) setActive(m); })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    const onUpdated = () => { void refresh(); };
    window.addEventListener(EVENT_NAME, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT_NAME, onUpdated);
    };
  }, [documentId, refresh]);

  const setMark = useCallback(async (subjectId: string | null) => {
    if (!documentId) return;
    try {
      const fresh = await setSubjectMark(documentId, subjectId);
      setActive(fresh);
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
    } catch {
      // Surface no toast here — the caller can do it. Marks layer is
      // strictly additive : if it fails, the rest of the doc keeps
      // working unaffected.
    }
  }, [documentId]);

  const isCurrentlyMarking = active != null && active.subjectId != null;

  return { active, loading, isCurrentlyMarking, setMark };
}
