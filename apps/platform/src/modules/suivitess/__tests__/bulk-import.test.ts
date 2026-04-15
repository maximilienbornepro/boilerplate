import { describe, it, expect } from 'vitest';

// Pure-logic tests for the bulk import modal flow.
// We don't mount React here — we validate the state transitions that
// the modal relies on : destination switching, new-title deduplication,
// and the "existing" shortcut that keeps multiple items headed to the
// same freshly-created review in a single create call.

type Action = 'existing' | 'new' | 'skip';

interface Destination { action: Action; docId: string | null; newTitle: string | null }
interface Item { id: string; title: string }

describe('Bulk transcription import — destination state', () => {
  function initial(items: Item[]): Record<string, Destination> {
    const out: Record<string, Destination> = {};
    for (const it of items) {
      out[it.id] = { action: 'new', docId: null, newTitle: it.title.slice(0, 80) };
    }
    return out;
  }

  it('starts every item with a "new" destination', () => {
    const state = initial([{ id: 'a', title: 'Hebdo Tech' }]);
    expect(state.a.action).toBe('new');
    expect(state.a.newTitle).toBe('Hebdo Tech');
  });

  it('switching an item to "existing" clears the new-title', () => {
    const state = initial([{ id: 'a', title: 'Hebdo Tech' }]);
    state.a = { action: 'existing', docId: 'doc-1', newTitle: null };
    expect(state.a.action).toBe('existing');
    expect(state.a.docId).toBe('doc-1');
    expect(state.a.newTitle).toBeNull();
  });

  it('switching an item to "skip" nullifies both fields', () => {
    const state = initial([{ id: 'a', title: 'Hebdo Tech' }]);
    state.a = { action: 'skip', docId: null, newTitle: null };
    expect(state.a.action).toBe('skip');
  });
});

describe('Bulk transcription import — apply payload', () => {
  // Simulate the per-row work the modal does at apply time.
  interface Row { id: string; dest: Destination; title: string }

  async function simulateApply(
    rows: Row[],
    createFn: (title: string) => Promise<string>,
    importFn: (docId: string, callId: string) => Promise<void>,
  ) {
    const createdByTitle = new Map<string, string>();
    const results: Array<{ id: string; ok: boolean }> = [];
    for (const r of rows) {
      if (r.dest.action === 'skip') continue;
      let target = r.dest.docId;
      if (r.dest.action === 'new') {
        const t = (r.dest.newTitle || r.title).trim();
        target = createdByTitle.get(t) ?? await createFn(t);
        createdByTitle.set(t, target);
      }
      try {
        await importFn(target!, r.id);
        results.push({ id: r.id, ok: true });
      } catch {
        results.push({ id: r.id, ok: false });
      }
    }
    return { results, createdReviews: createdByTitle.size };
  }

  it('skips items marked "skip"', async () => {
    const rows: Row[] = [
      { id: '1', title: 'A', dest: { action: 'skip', docId: null, newTitle: null } },
      { id: '2', title: 'B', dest: { action: 'existing', docId: 'doc-x', newTitle: null } },
    ];
    const imports: Array<[string, string]> = [];
    const { results } = await simulateApply(
      rows,
      async t => `new-${t}`,
      async (d, c) => { imports.push([d, c]); },
    );
    expect(results).toHaveLength(1);
    expect(imports).toEqual([['doc-x', '2']]);
  });

  it('deduplicates creation when several items target the same new title', async () => {
    const rows: Row[] = [
      { id: '1', title: 'X', dest: { action: 'new', docId: null, newTitle: 'Hebdo Tech' } },
      { id: '2', title: 'Y', dest: { action: 'new', docId: null, newTitle: 'Hebdo Tech' } },
    ];
    let createCount = 0;
    const imports: Array<[string, string]> = [];
    const { results, createdReviews } = await simulateApply(
      rows,
      async () => { createCount++; return `review-${createCount}`; },
      async (d, c) => { imports.push([d, c]); },
    );
    expect(createCount).toBe(1);
    expect(createdReviews).toBe(1);
    expect(imports[0][0]).toBe(imports[1][0]);
    expect(results.every(r => r.ok)).toBe(true);
  });

  it('keeps per-item errors independent', async () => {
    const rows: Row[] = [
      { id: '1', title: 'X', dest: { action: 'existing', docId: 'doc-a', newTitle: null } },
      { id: '2', title: 'Y', dest: { action: 'existing', docId: 'doc-b', newTitle: null } },
    ];
    const { results } = await simulateApply(
      rows,
      async t => `new-${t}`,
      async (d) => { if (d === 'doc-b') throw new Error('boom'); },
    );
    expect(results.find(r => r.id === '1')!.ok).toBe(true);
    expect(results.find(r => r.id === '2')!.ok).toBe(false);
  });
});
