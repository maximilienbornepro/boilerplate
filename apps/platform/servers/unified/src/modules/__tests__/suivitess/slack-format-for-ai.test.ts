import { describe, it, expect } from 'vitest';
import { formatSlackMessagesForAI } from '../../suivitess/slackCollectorService.js';

// The AI used to receive Slack messages as a flat chronological stream,
// which meant thread replies were interleaved with main-channel
// messages and looked like disjoint non-sequiturs. The new formatter
// groups replies under their parent (indented with ↪). These tests
// pin that contract.

describe('suivitess · formatSlackMessagesForAI', () => {
  it('indents thread replies under their parent', () => {
    const out = formatSlackMessagesForAI([
      { messageTs: '100.0', threadTs: null, senderName: 'Alice', text: 'bug en prod sur Orange' },
      { messageTs: '101.0', threadTs: '100.0', senderName: 'Bob', text: 'je regarde' },
      { messageTs: '102.0', threadTs: '100.0', senderName: 'Alice', text: 'voilà le log' },
      { messageTs: '200.0', threadTs: null, senderName: 'Carl', text: 'meeting demain ?' },
    ]);
    expect(out).toBe(
      '[Alice]: bug en prod sur Orange\n' +
      '  ↪ [Bob]: je regarde\n' +
      '  ↪ [Alice]: voilà le log\n' +
      '[Carl]: meeting demain ?',
    );
  });

  it('sorts top-level messages chronologically even when input is shuffled', () => {
    const out = formatSlackMessagesForAI([
      { messageTs: '200.0', threadTs: null, senderName: 'Carl', text: 'B' },
      { messageTs: '100.0', threadTs: null, senderName: 'Alice', text: 'A' },
    ]);
    expect(out).toBe('[Alice]: A\n[Carl]: B');
  });

  it('treats a parent message with thread_ts === ts as top-level (not a reply of itself)', () => {
    // Slack returns thread parents with thread_ts equal to ts once
    // the thread has any reply. Without this special-case, the
    // formatter would route the parent under itself and lose it.
    const out = formatSlackMessagesForAI([
      { messageTs: '100.0', threadTs: '100.0', senderName: 'Alice', text: 'parent' },
      { messageTs: '101.0', threadTs: '100.0', senderName: 'Bob', text: 'reply' },
    ]);
    expect(out).toBe('[Alice]: parent\n  ↪ [Bob]: reply');
  });

  it('hoists orphan replies whose parent is missing from the window to top-level', () => {
    // The parent's ts is older than `oldest` so conversations.history
    // dropped it ; we still have the replies in DB. Hoist them so the
    // AI sees the content at all (better than silently losing it).
    const out = formatSlackMessagesForAI([
      { messageTs: '101.0', threadTs: '90.0', senderName: 'Bob', text: 'orphan reply' },
      { messageTs: '200.0', threadTs: null, senderName: 'Carl', text: 'main flow' },
    ]);
    expect(out).toBe('[Bob]: orphan reply\n[Carl]: main flow');
  });

  it('falls back to "Inconnu" when senderName is null', () => {
    const out = formatSlackMessagesForAI([
      { messageTs: '100.0', threadTs: null, senderName: null, text: 'who am I' },
    ]);
    expect(out).toBe('[Inconnu]: who am I');
  });

  it('returns "" on empty input', () => {
    expect(formatSlackMessagesForAI([])).toBe('');
  });
});
