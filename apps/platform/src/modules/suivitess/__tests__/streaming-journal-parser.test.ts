import { describe, it, expect } from 'vitest';

// Pure re-implementation of the SSE frame reader used in TranscriptionWizard.
// The wizard itself depends on React/DOM APIs not available in our node-env
// tests — this mirrors the byte-level logic so we can lock down behaviour.

interface Event { type: string; [k: string]: unknown }

function parseSseFrames(chunks: string[]): { events: Event[] } {
  const events: Event[] = [];
  let buf = '';
  for (const chunk of chunks) {
    buf += chunk;
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      if (!frame.startsWith('data: ')) continue;
      try { events.push(JSON.parse(frame.slice(6))); }
      catch { /* skip */ }
    }
  }
  return { events };
}

describe('TranscriptionWizard SSE frame reader', () => {
  it('parses a single frame split across 3 chunks', () => {
    const chunks = [
      'data: {"type":"jou',
      'rnal-delta","text":"🔎 Lecture"',
      '}\n\n',
    ];
    expect(parseSseFrames(chunks).events).toEqual([
      { type: 'journal-delta', text: '🔎 Lecture' },
    ]);
  });

  it('parses multiple frames in a single chunk', () => {
    const chunks = [
      'data: {"type":"journal-delta","text":"a"}\n\ndata: {"type":"journal-complete"}\n\n',
    ];
    expect(parseSseFrames(chunks).events).toEqual([
      { type: 'journal-delta', text: 'a' },
      { type: 'journal-complete' },
    ]);
  });

  it('skips non-data lines and malformed frames', () => {
    const chunks = [
      ': heartbeat\n\n',
      'data: not-json\n\n',
      'data: {"type":"done"}\n\n',
    ];
    expect(parseSseFrames(chunks).events).toEqual([{ type: 'done' }]);
  });

  it('handles the full journal → proposals → done sequence', () => {
    const chunks = [
      'data: {"type":"journal-delta","text":"hello"}\n\n',
      'data: {"type":"journal-complete"}\n\n',
      'data: {"type":"proposals","proposals":[{"id":0,"action":"enrich"}]}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    expect(parseSseFrames(chunks).events.map(e => e.type)).toEqual([
      'journal-delta', 'journal-complete', 'proposals', 'done',
    ]);
  });
});
