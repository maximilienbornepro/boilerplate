import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Pure-logic test of the Synthétiser button's fetch contract.
 *
 * We don't render `SubjectReview` here (no jsdom in the test
 * environment) — we re-implement the handler verbatim so the URL
 * shape, method, credentials mode, and result handling are pinned
 * by tests. If the component handler drifts away from this shape
 * the route handler stops being reachable from the UI.
 */

interface FetchInit {
  method?: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  body?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchFn = (input: string, init?: FetchInit) => Promise<FetchResponse>;

async function handleSynthesize(
  subjectId: string,
  fetchFn: FetchFn,
  setSituation: (s: string) => void,
  setSynthesizing: (s: boolean) => void,
  onError: (msg: string) => void,
): Promise<void> {
  setSynthesizing(true);
  try {
    const res = await fetchFn(`/suivitess-api/subjects/${subjectId}/synthesize-situation`, {
      method: 'POST', credentials: 'include',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Erreur de synthèse');
    }
    const data = (await res.json()) as { situation?: string };
    if (data.situation) setSituation(data.situation);
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Erreur de synthèse');
  } finally {
    setSynthesizing(false);
  }
}

describe('Synthétiser button — fetch contract', () => {
  let situation = '';
  let synthesizing = false;
  let lastError: string | null = null;

  beforeEach(() => {
    situation = '';
    synthesizing = false;
    lastError = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the correct endpoint with credentials and updates situation on success', async () => {
    const fetchFn = vi.fn<FetchFn>(async (url, init) => {
      expect(url).toBe('/suivitess-api/subjects/abc-123/synthesize-situation');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      return {
        ok: true,
        status: 200,
        json: async () => ({ situation: 'Cleaned up text.\nProchaines étapes :\n  Step 1.' }),
      };
    });

    await handleSynthesize(
      'abc-123',
      fetchFn,
      (s) => { situation = s; },
      (s) => { synthesizing = s; },
      (msg) => { lastError = msg; },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(situation).toBe('Cleaned up text.\nProchaines étapes :\n  Step 1.');
    expect(synthesizing).toBe(false);
    expect(lastError).toBeNull();
  });

  it('surfaces the server error message when the response is not OK', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Réponse IA invalide — situation inchangée' }),
    }));

    await handleSynthesize(
      'abc-123',
      fetchFn,
      (s) => { situation = s; },
      (s) => { synthesizing = s; },
      (msg) => { lastError = msg; },
    );

    expect(lastError).toBe('Réponse IA invalide — situation inchangée');
    expect(situation).toBe(''); // unchanged
    expect(synthesizing).toBe(false);
  });

  it('falls back to a generic error message when the body is unparseable', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    }));

    await handleSynthesize(
      'abc-123',
      fetchFn,
      (s) => { situation = s; },
      (s) => { synthesizing = s; },
      (msg) => { lastError = msg; },
    );

    expect(lastError).toBe('Erreur de synthèse');
    expect(synthesizing).toBe(false);
  });

  it('toggles the synthesizing flag around the call (loading state)', async () => {
    const seen: boolean[] = [];
    const fetchFn = vi.fn<FetchFn>(async () => {
      seen.push(synthesizing);
      return { ok: true, status: 200, json: async () => ({ situation: 'x' }) };
    });

    await handleSynthesize(
      'abc-123',
      fetchFn,
      (s) => { situation = s; },
      (s) => { synthesizing = s; seen.push(s); },
      (msg) => { lastError = msg; },
    );

    // First: setSynthesizing(true) → seen=[true]
    // Inside fetchFn: synthesizing===true → seen=[true, true]
    // Finally: setSynthesizing(false) → seen=[true, true, false]
    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
  });
});
