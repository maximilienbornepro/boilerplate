import { describe, it, expect } from 'vitest';

// Pure logic tests for the bulk-import flow. The Claude call is covered by
// integration tests; here we validate the payload building and the
// server-side response validation rules.

describe('SuiviTess — bulk transcription routing', () => {
  describe('Payload sanitation', () => {
    // Mirror the sanitation done by the /route-suggestions route before
    // handing items to the AI service.
    const VALID_PROVIDERS = new Set(['fathom', 'otter', 'gmail', 'outlook']);

    function sanitize(items: Array<Record<string, unknown>>): Array<{
      id: string; provider: string; title: string; date: string | null;
    }> {
      return items.slice(0, 50).map(it => ({
        id: String(it.id || ''),
        provider: VALID_PROVIDERS.has(String(it.provider)) ? String(it.provider) : 'fathom',
        title: String(it.title || ''),
        date: (it.date as string | null) ?? null,
      }));
    }

    it('keeps only known providers and defaults the rest to fathom', () => {
      expect(sanitize([{ id: '1', provider: 'weird', title: 't' }])[0].provider).toBe('fathom');
      expect(sanitize([{ id: '1', provider: 'gmail', title: 't' }])[0].provider).toBe('gmail');
    });

    it('caps the payload at 50 items', () => {
      const many = Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, provider: 'fathom', title: 'x' }));
      expect(sanitize(many)).toHaveLength(50);
    });

    it('coerces missing fields to safe defaults', () => {
      const out = sanitize([{ id: 42, provider: 'otter' } as unknown as Record<string, unknown>])[0];
      expect(out.id).toBe('42');
      expect(out.title).toBe('');
      expect(out.date).toBeNull();
    });
  });

  describe('Routing suggestion fallback', () => {
    // Replicates the server-side fallback: if the AI references a docId
    // that does not belong to the user, the item should fall back to
    // "new" with a low-confidence suggestion.
    interface Sug { itemId: string; suggestedAction: 'existing' | 'new'; suggestedDocId: string | null; confidence: string }

    function validate(
      suggestions: Sug[],
      validReviewIds: Set<string>,
      allItemIds: Set<string>,
    ): Sug[] {
      const seen = new Set<string>();
      const out: Sug[] = [];
      for (const s of suggestions) {
        if (!allItemIds.has(s.itemId) || seen.has(s.itemId)) continue;
        seen.add(s.itemId);
        if (s.suggestedAction === 'existing' && (!s.suggestedDocId || !validReviewIds.has(s.suggestedDocId))) {
          out.push({ ...s, suggestedAction: 'new', suggestedDocId: null, confidence: 'low' });
        } else {
          out.push(s);
        }
      }
      // Fill in missing
      for (const id of allItemIds) {
        if (!seen.has(id)) out.push({ itemId: id, suggestedAction: 'new', suggestedDocId: null, confidence: 'low' });
      }
      return out;
    }

    it('rewrites a suggestion with an unknown docId as "new"', () => {
      const result = validate(
        [{ itemId: 'it1', suggestedAction: 'existing', suggestedDocId: 'ghost', confidence: 'high' }],
        new Set(['doc-a']),
        new Set(['it1']),
      );
      expect(result[0].suggestedAction).toBe('new');
      expect(result[0].confidence).toBe('low');
    });

    it('keeps a valid existing suggestion unchanged', () => {
      const result = validate(
        [{ itemId: 'it1', suggestedAction: 'existing', suggestedDocId: 'doc-a', confidence: 'high' }],
        new Set(['doc-a']),
        new Set(['it1']),
      );
      expect(result[0].suggestedAction).toBe('existing');
      expect(result[0].suggestedDocId).toBe('doc-a');
    });

    it('fills in missing items with a "new" fallback so every input gets a suggestion', () => {
      const result = validate([], new Set(), new Set(['a', 'b', 'c']));
      expect(result).toHaveLength(3);
      expect(result.every(r => r.suggestedAction === 'new')).toBe(true);
    });

    it('ignores duplicate suggestions for the same item', () => {
      const result = validate(
        [
          { itemId: 'it1', suggestedAction: 'existing', suggestedDocId: 'doc-a', confidence: 'high' },
          { itemId: 'it1', suggestedAction: 'new', suggestedDocId: null, confidence: 'medium' },
        ],
        new Set(['doc-a']),
        new Set(['it1']),
      );
      expect(result).toHaveLength(1);
      expect(result[0].suggestedAction).toBe('existing');
    });
  });
});
