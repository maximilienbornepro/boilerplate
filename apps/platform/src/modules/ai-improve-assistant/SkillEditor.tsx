import { useEffect, useMemo, useRef, useState, type ChangeEvent, type UIEvent } from 'react';
import styles from './SkillEditor.module.css';

// Rich editor for a markdown skill prompt. 3 modes :
//  - `edit`    : textarea with line numbers + outline navigation
//  - `preview` : home-made markdown renderer (no dep)
//  - `diff`    : line-level comparison with a reference (e.g. v1 "current")
//
// The outline is computed from ## / ### / #### lines and shows an ✎ marker
// next to sections that differ from the reference. Click a section to jump
// the textarea caret + scroll to that line.

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Optional reference content — enables diff view + "edited" marker in outline. */
  refContent?: string | null;
  refLabel?: string;
  disabled?: boolean;
  /** Minimum container height in pixels (textarea grows). Default 340. */
  minHeight?: number;
}

type Mode = 'edit' | 'preview' | 'diff';

interface OutlineItem {
  line: number;            // 0-based line index
  level: number;           // 2..4 (for ##, ###, ####)
  text: string;
  edited: boolean;         // differs from refContent
}

export default function SkillEditor({
  value, onChange, refContent, refLabel = 'v1', disabled, minHeight = 340,
}: Props) {
  const [mode, setMode] = useState<Mode>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const lines = useMemo(() => value.split('\n'), [value]);
  const refLines = useMemo(() => (refContent ?? '').split('\n'), [refContent]);

  // ── Outline parsing ──
  const outline = useMemo<OutlineItem[]>(() => {
    const items: OutlineItem[] = [];
    lines.forEach((line, idx) => {
      const m = /^(#{2,4})\s+(.+)$/.exec(line);
      if (!m) return;
      const level = m[1].length;
      const text = m[2].trim();
      // Mark as edited if the same "section path" doesn't exist identically
      // in the reference. Cheap heuristic : same line number, different text
      // → edited; or line doesn't exist in ref → edited.
      const refLine = refLines[idx];
      const edited = refContent != null && refLine !== line;
      items.push({ line: idx, level, text, edited });
    });
    return items;
  }, [lines, refLines, refContent]);

  // ── Stats ──
  const tokens = Math.ceil(value.length / 4);  // rough approx
  const refTokens = refContent ? Math.ceil(refContent.length / 4) : null;
  const tokenDelta = refTokens != null ? tokens - refTokens : null;

  // ── Scroll sync : line numbers follow the textarea scroll ──
  const handleTextareaScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
    }
  };

  // ── Click on outline : scroll to the section in the active mode ──
  // In edit  : move caret + scroll textarea.
  // In preview: scroll to the rendered <h2/3/4> tagged with data-skill-line.
  // In diff   : scroll to the diff row tagged with data-skill-line.
  const jumpTo = (lineIdx: number) => {
    if (mode === 'preview' || mode === 'diff') {
      requestAnimationFrame(() => {
        const el = mainRef.current?.querySelector(
          `[data-skill-line="${lineIdx}"]`,
        ) as HTMLElement | null;
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
      return;
    }
    // edit mode
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      // Compute character offset of that line in `value`.
      let offset = 0;
      for (let i = 0; i < lineIdx && i < lines.length; i++) {
        offset += lines[i].length + 1;
      }
      ta.focus();
      ta.setSelectionRange(offset, offset);
      // Scroll : estimate via lineHeight.
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight || '20') || 20;
      ta.scrollTop = Math.max(0, lineIdx * lineHeight - 80);
      if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = ta.scrollTop;
    });
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value);

  return (
    <div className={styles.root} style={{ minHeight }}>
      <div className={styles.toolbar}>
        <div className={styles.modeTabs}>
          <button type="button" className={`${styles.tab} ${mode === 'edit' ? styles.tabActive : ''}`} onClick={() => setMode('edit')}>✎ Éditer</button>
          <button type="button" className={`${styles.tab} ${mode === 'preview' ? styles.tabActive : ''}`} onClick={() => setMode('preview')}>👁 Aperçu</button>
          {refContent != null && (
            <button type="button" className={`${styles.tab} ${mode === 'diff' ? styles.tabActive : ''}`} onClick={() => setMode('diff')}>🔀 Diff vs {refLabel}</button>
          )}
        </div>
        <div className={styles.spacer} />
        <span className={styles.stat}>
          <span className={styles.statStrong}>{tokens.toLocaleString()}</span> tokens
          {tokenDelta != null && tokenDelta !== 0 && (
            <span style={{ marginLeft: 4, color: tokenDelta > 0 ? 'var(--warning, #ff9800)' : 'var(--success, #4caf50)' }}>
              ({tokenDelta > 0 ? '+' : ''}{tokenDelta})
            </span>
          )}
        </span>
        <span className={styles.stat} style={{ marginLeft: 8 }}>{lines.length} lignes</span>
        <span className={styles.stat} style={{ marginLeft: 8 }}>{value.length.toLocaleString()} chars</span>
      </div>

      <div className={styles.body}>
        <aside className={styles.outline}>
          {outline.length === 0 ? (
            <div className={styles.outlineEmpty}>
              Pas de sections (## / ###). Ajoute des titres markdown pour voir un outline.
            </div>
          ) : (
            outline.map(item => (
              <button
                key={`${item.line}-${item.text}`}
                type="button"
                className={`${styles.outlineItem} ${styles[`lvl${item.level}`] ?? ''}`}
                onClick={() => jumpTo(item.line)}
                title={`L.${item.line + 1}${item.edited ? ' — modifié' : ''}`}
              >
                {item.text}
                {item.edited && <span className={styles.editedMark}>✎</span>}
              </button>
            ))
          )}
        </aside>

        <main className={styles.main} ref={mainRef}>
          {mode === 'edit' && (
            <div className={styles.editWrap}>
              <pre ref={lineNumbersRef} className={styles.lineNumbers} aria-hidden>
                {lines.map((_, i) => `${i + 1}\n`).join('')}
              </pre>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={value}
                onChange={handleChange}
                onScroll={handleTextareaScroll}
                spellCheck={false}
                disabled={disabled}
                style={{ minHeight }}
              />
            </div>
          )}

          {mode === 'preview' && <MarkdownPreview source={value} />}

          {mode === 'diff' && refContent != null && (
            <DiffView original={refContent} current={value} refLabel={refLabel} />
          )}
        </main>
      </div>
    </div>
  );
}

// ── Minimal markdown renderer ───────────────────────────────────────────

function MarkdownPreview({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={styles.preview}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

type Block =
  | { kind: 'h'; level: number; text: string; line: number }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lang?: string; content: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' };

function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++; continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'h', level: h[1].length, text: h[2].trim(), line: i });
      i++; continue;
    }

    // Code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]); i++;
      }
      blocks.push({ kind: 'code', lang, content: codeLines.join('\n') });
      i++; continue;
    }

    // Blockquote (single-line)
    if (/^>\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, '')); i++;
      }
      blocks.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph (accumulate until blank line / block trigger)
    const pLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}|```|>\s|\s*[-*•]\s|\s*\d+\.\s|---+|\*\*\*+)/.test(lines[i])) {
      pLines.push(lines[i]); i++;
    }
    if (pLines.length) blocks.push({ kind: 'p', text: pLines.join(' ') });
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  // Order matters : code first (greedy), then bold, italic, link.
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  const patterns: Array<{
    regex: RegExp;
    render: (m: RegExpMatchArray, k: number) => React.ReactNode;
  }> = [
    { regex: /`([^`\n]+)`/, render: (m, k) => <code key={k}>{m[1]}</code> },
    { regex: /\*\*([^*\n]+)\*\*/, render: (m, k) => <strong key={k}>{m[1]}</strong> },
    { regex: /\*([^*\n]+)\*/, render: (m, k) => <em key={k}>{m[1]}</em> },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/, render: (m, k) => <a key={k} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a> },
  ];

  while (rest.length > 0) {
    let bestIndex = -1;
    let bestMatch: RegExpMatchArray | null = null;
    let bestRender: typeof patterns[number]['render'] | null = null;
    for (const p of patterns) {
      const m = p.regex.exec(rest);
      if (!m) continue;
      if (bestIndex === -1 || (m.index ?? 0) < bestIndex) {
        bestIndex = m.index ?? 0;
        bestMatch = m;
        bestRender = p.render;
      }
    }
    if (!bestMatch || bestIndex === -1) {
      nodes.push(rest);
      break;
    }
    if (bestIndex > 0) nodes.push(rest.slice(0, bestIndex));
    nodes.push(bestRender!(bestMatch, key++));
    rest = rest.slice(bestIndex + bestMatch[0].length);
  }

  return nodes;
}

function renderBlock(block: Block, i: number): React.ReactNode {
  switch (block.kind) {
    case 'h': {
      const Tag = (`h${Math.min(block.level, 4)}`) as 'h1' | 'h2' | 'h3' | 'h4';
      return <Tag key={i} data-skill-line={block.line}>{renderInline(block.text)}</Tag>;
    }
    case 'p':
      return <p key={i}>{renderInline(block.text)}</p>;
    case 'ul':
      return <ul key={i}>{block.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
    case 'ol':
      return <ol key={i}>{block.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
    case 'code':
      return <pre key={i}><code>{block.content}</code></pre>;
    case 'quote':
      return <blockquote key={i}>{renderInline(block.text)}</blockquote>;
    case 'hr':
      return <hr key={i} />;
  }
}

// ── Line-level diff ────────────────────────────────────────────────────
//
// Simplified diff algorithm : find the longest common subsequence (LCS) of
// lines between original and current, then emit unchanged / added / deleted
// markers. Not optimal for huge files but fine for skills under a few
// thousand lines.

type DiffEntry =
  | { kind: 'same'; line: string; aLine: number; bLine: number }
  | { kind: 'add'; line: string; bLine: number }
  | { kind: 'del'; line: string; aLine: number };

function computeDiff(a: string[], b: string[]): DiffEntry[] {
  // Build LCS DP table.
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Backtrack.
  const out: DiffEntry[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', line: a[i], aLine: i, bLine: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: 'del', line: a[i], aLine: i }); i++; }
    else { out.push({ kind: 'add', line: b[j], bLine: j }); j++; }
  }
  while (i < n) { out.push({ kind: 'del', line: a[i], aLine: i }); i++; }
  while (j < m) { out.push({ kind: 'add', line: b[j], bLine: j }); j++; }
  return out;
}

// Compacts a diff by collapsing long runs of identical lines into a single
// "… N lignes inchangées …" marker, keeping `contextSize` surrounding lines
// around each change (same behaviour as `git diff` / unified diff hunks).
type DiffDisplayEntry =
  | { kind: 'entry'; entry: DiffEntry }
  | { kind: 'collapsed'; count: number };

function compactDiff(diff: DiffEntry[], contextSize = 2): DiffDisplayEntry[] {
  // First, find the indexes of the changed lines.
  const changedIdx: number[] = [];
  diff.forEach((d, i) => { if (d.kind !== 'same') changedIdx.push(i); });
  if (changedIdx.length === 0) return [];

  // Build a set of indexes to keep : every change + `contextSize` lines on
  // each side.
  const keep = new Set<number>();
  for (const idx of changedIdx) {
    for (let k = Math.max(0, idx - contextSize); k <= Math.min(diff.length - 1, idx + contextSize); k++) {
      keep.add(k);
    }
  }

  // Walk the diff and emit entries for kept indexes, collapse the rest.
  const out: DiffDisplayEntry[] = [];
  let runHidden = 0;
  for (let i = 0; i < diff.length; i++) {
    if (keep.has(i)) {
      if (runHidden > 0) { out.push({ kind: 'collapsed', count: runHidden }); runHidden = 0; }
      out.push({ kind: 'entry', entry: diff[i] });
    } else {
      runHidden++;
    }
  }
  if (runHidden > 0) out.push({ kind: 'collapsed', count: runHidden });
  return out;
}

function DiffView({ original, current, refLabel }: { original: string; current: string; refLabel: string }) {
  const diff = useMemo(() => computeDiff(original.split('\n'), current.split('\n')), [original, current]);
  const added = diff.filter(d => d.kind === 'add').length;
  const deleted = diff.filter(d => d.kind === 'del').length;

  const [compact, setCompact] = useState(true);
  const firstChangeRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the first change when the view mounts or when the
  // compact toggle flips (the DOM just changed).
  useEffect(() => {
    if (!firstChangeRef.current) return;
    // Use requestAnimationFrame so the element is already laid out.
    requestAnimationFrame(() => {
      firstChangeRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      // Offset a bit so the header stays visible.
      const main = firstChangeRef.current?.closest(`.${styles.main}`) as HTMLElement | null;
      if (main) main.scrollTop = Math.max(0, main.scrollTop - 20);
    });
  }, [compact, diff]);

  if (added === 0 && deleted === 0) {
    return (
      <div className={styles.diffEmpty}>
        Identique à {refLabel} — aucune différence à afficher.
      </div>
    );
  }

  const rendered = compact ? compactDiff(diff, 2) : diff.map(e => ({ kind: 'entry' as const, entry: e }));
  let firstChangeAssigned = false;

  return (
    <div className={styles.diff}>
      <div
        style={{
          padding: '6px 12px', fontSize: 11, color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0,
          background: 'var(--bg-primary)', zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}
      >
        <span>
          <span style={{ color: 'var(--success, #4caf50)' }}>+{added}</span>
          {' / '}
          <span style={{ color: 'var(--error, #f44336)' }}>−{deleted}</span>
          {' — '}comparaison avec <strong>{refLabel}</strong>
        </span>
        <button
          type="button"
          onClick={() => setCompact(c => !c)}
          style={{
            padding: '2px 8px', fontSize: 11, fontFamily: 'var(--font-mono)',
            background: 'transparent', color: 'var(--accent-primary)',
            border: '1px solid var(--accent-primary)', borderRadius: 2, cursor: 'pointer',
          }}
        >
          {compact ? '👁 Tout afficher' : '✂ Compact (hunks)'}
        </button>
      </div>
      {rendered.map((row, i) => {
        if (row.kind === 'collapsed') {
          return (
            <div key={`c-${i}`} style={{
              padding: '4px 12px', fontSize: 11, color: 'var(--text-secondary)',
              background: 'var(--bg-secondary, rgba(128,128,128,0.06))',
              borderTop: '1px dashed var(--border-color)',
              borderBottom: '1px dashed var(--border-color)',
              textAlign: 'center', fontStyle: 'italic',
            }}>
              … {row.count} ligne{row.count > 1 ? 's' : ''} inchangée{row.count > 1 ? 's' : ''} …
            </div>
          );
        }
        const d = row.entry;
        const isFirstChange = !firstChangeAssigned && d.kind !== 'same';
        if (isFirstChange) firstChangeAssigned = true;
        // `bLine` is the line index in the current (editable) document —
        // that's what the outline uses, so we expose it for jumpTo().
        const skillLine = d.kind === 'del' ? undefined : (d as { bLine: number }).bLine;
        return (
          <div
            key={i}
            ref={isFirstChange ? firstChangeRef : undefined}
            data-skill-line={skillLine}
            className={`${styles.diffLine} ${d.kind === 'add' ? styles.diffLineAdd : d.kind === 'del' ? styles.diffLineDel : ''}`}
          >
            <span className={`${styles.diffMark} ${d.kind === 'add' ? styles.diffMarkAdd : d.kind === 'del' ? styles.diffMarkDel : ''}`}>
              {d.kind === 'add' ? '+' : d.kind === 'del' ? '−' : ''}
            </span>
            <span className={styles.diffMark} style={{ fontSize: 10 }}>
              {d.kind === 'del' ? (d.aLine + 1) : d.kind === 'add' ? (d.bLine + 1) : ((d as { aLine: number }).aLine + 1)}
            </span>
            <span className={styles.diffPadding}>{d.line || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}
