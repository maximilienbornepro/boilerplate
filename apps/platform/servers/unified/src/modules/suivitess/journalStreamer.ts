// Parses a streamed AI response token-by-token, emitting only the text that
// falls between `<journal>` and `</journal>`. Never emits a partial tag — we
// hold back up to 10 chars before each emit so `</jour…` never leaks.
//
// Used by both the per-document import stream and the listing-page routing
// stream (same editing pattern in the two flows).

export class JournalStreamer {
  private buffer = '';
  private insideJournal = false;
  private doneSignalled = false;

  feed(chunk: string, emit: (text: string) => void, onJournalDone: () => void): void {
    this.buffer += chunk;

    while (true) {
      if (!this.insideJournal) {
        const open = this.buffer.indexOf('<journal>');
        if (open === -1) {
          if (this.buffer.length > 64) this.buffer = this.buffer.slice(-64);
          return;
        }
        this.buffer = this.buffer.slice(open + '<journal>'.length);
        this.insideJournal = true;
      }

      const close = this.buffer.indexOf('</journal>');
      if (close === -1) {
        const safeLen = Math.max(0, this.buffer.length - 10);
        if (safeLen > 0) {
          emit(this.buffer.slice(0, safeLen));
          this.buffer = this.buffer.slice(safeLen);
        }
        return;
      }

      if (close > 0) emit(this.buffer.slice(0, close));
      this.buffer = this.buffer.slice(close + '</journal>'.length);
      this.insideJournal = false;
      if (!this.doneSignalled) {
        this.doneSignalled = true;
        onJournalDone();
      }
    }
  }
}

/** Extracts the `<result>…</result>` payload from a full AI response — falls
 *  back to the first JSON array or object in the text. */
export function extractResultJson(fullText: string): unknown {
  const resultMatch = fullText.match(/<result>([\s\S]*?)<\/result>/);
  const source = resultMatch ? resultMatch[1] : fullText;

  const arrayMatch = source.match(/\[[\s\S]*\]/);
  const objectMatch = source.match(/\{[\s\S]*\}/);

  // Prefer whichever occurs first, try to parse both.
  const candidates: string[] = [];
  if (arrayMatch && objectMatch) {
    if ((arrayMatch.index ?? 0) < (objectMatch.index ?? 0)) {
      candidates.push(arrayMatch[0], objectMatch[0]);
    } else {
      candidates.push(objectMatch[0], arrayMatch[0]);
    }
  } else if (arrayMatch) {
    candidates.push(arrayMatch[0]);
  } else if (objectMatch) {
    candidates.push(objectMatch[0]);
  }

  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  return null;
}
