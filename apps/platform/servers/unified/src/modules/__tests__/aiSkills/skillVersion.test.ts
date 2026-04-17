import { describe, it, expect } from 'vitest';
import { hashContent, shortHash } from '../../aiSkills/skillVersionService.js';

describe('aiSkills.skillVersion.hashContent', () => {
  it('returns a deterministic 64-char hex string', () => {
    const h = hashContent('hello world');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for identical input', () => {
    const a = hashContent('## rule 1\n- first\n- second\n');
    const b = hashContent('## rule 1\n- first\n- second\n');
    expect(a).toBe(b);
  });

  it('changes when any character is altered', () => {
    const a = hashContent('## rule 1');
    const b = hashContent('## rule 2');
    expect(a).not.toBe(b);
  });

  it('is whitespace-sensitive (trailing newline matters)', () => {
    const a = hashContent('content');
    const b = hashContent('content\n');
    expect(a).not.toBe(b);
  });

  it('matches the known SHA-256 of "hello world"', () => {
    // Reference value from any SHA-256 implementation.
    expect(hashContent('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});

describe('aiSkills.skillVersion.shortHash', () => {
  it('returns the 7-char prefix', () => {
    const h = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(shortHash(h)).toBe('abcdef0');
  });
});
