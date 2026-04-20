import { useEffect, useState } from 'react';
import { Modal, LoadingSpinner } from '@boilerplate/shared/components';
import { fetchLayoutRules } from '../../services/api';
import styles from './LayoutRulesModal.module.css';

interface Props {
  onClose: () => void;
}

/**
 * Displays the hand-maintained `layout-rules.md` catalog that describes
 * the deterministic placement rules applied by the delivery layout
 * engine. The catalog is the human-facing view ; the TypeScript code in
 * `deliveryLayoutEngine.ts` remains the source of truth.
 *
 * Rendering is a lightweight in-house markdown formatter — enough for
 * headings / tables / paragraphs / code spans without pulling a full
 * markdown dependency into the frontend bundle.
 */
export function LayoutRulesModal({ onClose }: Props) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLayoutRules()
      .then(md => { if (!cancelled) setContent(md); })
      .catch((err: Error) => { if (!cancelled) setError(err.message || 'Chargement impossible'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Modal title="🧩 Règles de placement — Delivery" onClose={onClose} size="xl">
      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}><LoadingSpinner message="Chargement des règles…" /></div>
        ) : error ? (
          <div className={styles.error}>
            <strong>Erreur</strong>
            <p>{error}</p>
          </div>
        ) : (
          <article className={styles.doc}>
            <MarkdownRenderer source={content} />
          </article>
        )}
      </div>
    </Modal>
  );
}

// ========= Markdown renderer (minimal, no deps) =========

/**
 * Very small markdown-to-React renderer — handles headings (##, ###),
 * paragraphs, tables (pipe syntax), blockquotes, unordered lists,
 * ordered lists, and inline code/bold/italic. Deliberately does NOT
 * interpret HTML nor images — this is controlled internal content.
 */
function MarkdownRenderer({ source }: { source: string }) {
  const blocks = splitBlocks(source);
  return <>{blocks.map((b, i) => renderBlock(b, i))}</>;
}

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' };

function splitBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Horizontal rule
    if (/^---+\s*$/.test(line)) { blocks.push({ kind: 'hr' }); i++; continue; }
    // Blank line
    if (!line.trim()) { i++; continue; }
    // Heading
    const h1 = /^# (.+)$/.exec(line); if (h1) { blocks.push({ kind: 'h1', text: h1[1] }); i++; continue; }
    const h2 = /^## (.+)$/.exec(line); if (h2) { blocks.push({ kind: 'h2', text: h2[1] }); i++; continue; }
    const h3 = /^### (.+)$/.exec(line); if (h3) { blocks.push({ kind: 'h3', text: h3[1] }); i++; continue; }
    // Blockquote (> ...)
    if (/^>\s*/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s*/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', text: buf.join(' ').trim() });
      continue;
    }
    // Table (pipe)
    if (line.includes('|') && i + 1 < lines.length && /\|\s*[-:]+/.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    // Paragraph (consecutive non-empty, non-special lines)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#|>|\d+\.|[-*])\s/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !lines[i].includes('|')
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'p', text: buf.join(' ') });
  }
  return blocks;
}

function splitTableRow(line: string): string[] {
  // Drop leading / trailing pipes then split.
  return line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

function renderBlock(block: Block, key: number): JSX.Element {
  switch (block.kind) {
    case 'h1': return <h1 key={key} className={styles.h1}>{inline(block.text)}</h1>;
    case 'h2': return <h2 key={key} className={styles.h2}>{inline(block.text)}</h2>;
    case 'h3': return <h3 key={key} className={styles.h3}>{inline(block.text)}</h3>;
    case 'p':  return <p key={key} className={styles.p}>{inline(block.text)}</p>;
    case 'quote': return <blockquote key={key} className={styles.quote}>{inline(block.text)}</blockquote>;
    case 'ul': return <ul key={key} className={styles.ul}>{block.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
    case 'ol': return <ol key={key} className={styles.ol}>{block.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
    case 'hr': return <hr key={key} className={styles.hr} />;
    case 'table':
      return (
        <div key={key} className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>{block.headers.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, j) => (
                <tr key={j}>{row.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Inline formatting: **bold**, *italic*, `code`. Anything else is text. */
function inline(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(<span key={key++}>{text.slice(lastIdx, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key++} className={styles.code}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) out.push(<span key={key++}>{text.slice(lastIdx)}</span>);
  return out;
}
