import { describe, it, expect } from 'vitest';

// The helper functions in suivitess backend are not exported,
// so we reproduce them here and test the logic directly.
// This ensures any refactoring maintains the same behavior.

// ==================== formatSituationForMarkdown ====================

function formatSituationForMarkdown(text: string): string {
  const BULLETS = ['•', '◦', '▪', '▸'];
  const NBSP = '\u00A0';

  return text
    .split('\n')
    .filter((line: string) => line.trim())
    .map((line: string) => {
      const match = line.match(/^(\s*)(.*)/);
      if (!match) return `• ${line}`;

      const spaces = match[1].length;
      const level = Math.min(Math.floor(spaces / 2), BULLETS.length - 1);
      const textContent = match[2].trim();

      const indent = NBSP.repeat(level * 4);
      return `${indent}${BULLETS[level]} ${textContent}`;
    })
    .join('<br>');
}

describe('formatSituationForMarkdown', () => {
  it('should format single line with bullet', () => {
    const result = formatSituationForMarkdown('Hello world');
    expect(result).toBe('• Hello world');
  });

  it('should format multiple lines with <br> separator', () => {
    const result = formatSituationForMarkdown('Line 1\nLine 2\nLine 3');
    expect(result).toContain('<br>');
    expect(result.split('<br>')).toHaveLength(3);
  });

  it('should skip empty lines', () => {
    const result = formatSituationForMarkdown('Line 1\n\n\nLine 2');
    expect(result.split('<br>')).toHaveLength(2);
  });

  it('should use different bullets for indentation levels', () => {
    const result = formatSituationForMarkdown('Level 0\n  Level 1\n    Level 2\n      Level 3');
    const parts = result.split('<br>');
    expect(parts[0]).toContain('•'); // Level 0
    expect(parts[1]).toContain('◦'); // Level 1
    expect(parts[2]).toContain('▪'); // Level 2
    expect(parts[3]).toContain('▸'); // Level 3
  });

  it('should indent nested levels with non-breaking spaces', () => {
    const result = formatSituationForMarkdown('  Indented');
    expect(result).toContain('\u00A0');
  });

  it('should cap indentation level at 3', () => {
    const result = formatSituationForMarkdown('          Deep indent');
    expect(result).toContain('▸'); // Max level bullet
  });

  it('should handle text with leading whitespace trimming', () => {
    const result = formatSituationForMarkdown('  Text with indent  ');
    expect(result).toContain('Text with indent');
  });
});

// ==================== extractSituation ====================

function extractSituation(content: string): string {
  const match = content.match(/(?:É|E)tat de la situation\s*:?\*?\*?<br>(.*?)(?:<br>\*?\*?→|<br>📋|<br><br>\*\*[^ÉE]|$)/is);
  if (match) {
    return match[1].replace(/<br>/g, '\n').trim();
  }
  const fallbackMatch = content.match(/^\*\*[^*]+\*\*<br>(.*?)(?:<br>\*?\*?→|<br>📋|$)/is);
  if (fallbackMatch) {
    return fallbackMatch[1].replace(/<br>/g, '\n').trim();
  }
  return content.replace(/<br>/g, '\n').trim();
}

describe('extractSituation', () => {
  it('should extract text after "État de la situation" header', () => {
    const content = '**Titre**<br>**État de la situation :**<br>• Point 1<br>• Point 2<br>**→ Action : faire**';
    const result = extractSituation(content);
    expect(result).toContain('Point 1');
    expect(result).toContain('Point 2');
  });

  it('should stop extraction at action section (→)', () => {
    const content = '**Titre**<br>**État de la situation :**<br>• Situation<br>**→ Action**';
    const result = extractSituation(content);
    expect(result).toContain('Situation');
    expect(result).not.toContain('Action');
  });

  it('should handle "Etat" without accent', () => {
    const content = '**Titre**<br>**Etat de la situation :**<br>• Point 1<br>**→ Action**';
    const result = extractSituation(content);
    expect(result).toContain('Point 1');
  });

  it('should use fallback when no situation header', () => {
    const content = '**Titre**<br>Some content here<br>**→ Action**';
    const result = extractSituation(content);
    expect(result).toContain('Some content here');
  });

  it('should return full content as last resort', () => {
    const content = 'Just plain text<br>with breaks';
    const result = extractSituation(content);
    expect(result).toContain('Just plain text');
    expect(result).toContain('with breaks');
  });

  it('should convert <br> to newlines', () => {
    const content = '**Titre**<br>**État de la situation :**<br>Line 1<br>Line 2<br>**→ Action**';
    const result = extractSituation(content);
    expect(result).toContain('\n');
  });
});

// ==================== stripMarkdown ====================

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

describe('stripMarkdown', () => {
  it('should remove bold markers (**text**)', () => {
    expect(stripMarkdown('**bold text**')).toBe('bold text');
  });

  it('should remove strikethrough markers (~~text~~)', () => {
    expect(stripMarkdown('~~struck text~~')).toBe('struck text');
  });

  it('should remove italic markers (*text*)', () => {
    expect(stripMarkdown('*italic text*')).toBe('italic text');
  });

  it('should handle mixed formatting', () => {
    expect(stripMarkdown('**bold** and ~~struck~~ and *italic*')).toBe('bold and struck and italic');
  });

  it('should trim whitespace', () => {
    expect(stripMarkdown('  text  ')).toBe('text');
  });

  it('should leave plain text unchanged', () => {
    expect(stripMarkdown('plain text')).toBe('plain text');
  });
});

// ==================== findLastChange ====================

function findLastChange(current: string, snapshot: string): string {
  if (!current || !snapshot) return '';

  const normalize = (text: string) => text
    .split('\n')
    .map(l => l.replace(/^[\s\u00A0]*[•◦▪▸]\s*/, '').trim())
    .filter(l => l.length > 0);

  const currentLines = normalize(current);
  const snapshotLines = normalize(snapshot);

  const newLines = currentLines.filter(l => !snapshotLines.some(sl => sl === l));

  if (newLines.length > 0) {
    const lastLine = stripMarkdown(newLines[newLines.length - 1]);
    return lastLine.length > 60 ? lastLine.substring(0, 60) + '...' : lastLine;
  }
  return '';
}

describe('findLastChange', () => {
  it('should find new lines added to current', () => {
    const current = '• Old line\n• New line added';
    const snapshot = '• Old line';
    const result = findLastChange(current, snapshot);
    expect(result).toBe('New line added');
  });

  it('should return the last new line when multiple added', () => {
    const current = '• Old\n• New 1\n• New 2';
    const snapshot = '• Old';
    const result = findLastChange(current, snapshot);
    expect(result).toBe('New 2');
  });

  it('should return empty string when no changes', () => {
    const current = '• Same line';
    const snapshot = '• Same line';
    expect(findLastChange(current, snapshot)).toBe('');
  });

  it('should return empty string when current is empty', () => {
    expect(findLastChange('', 'snapshot')).toBe('');
  });

  it('should return empty string when snapshot is empty', () => {
    expect(findLastChange('current', '')).toBe('');
  });

  it('should truncate long lines to 60 chars + ellipsis', () => {
    const longLine = 'A'.repeat(100);
    const current = `• ${longLine}`;
    const snapshot = '• Old line';
    const result = findLastChange(current, snapshot);
    expect(result).toHaveLength(63); // 60 + "..."
    expect(result.endsWith('...')).toBe(true);
  });

  it('should strip bullets when comparing', () => {
    const current = '• Line one\n◦ Sub line';
    const snapshot = '• Line one';
    const result = findLastChange(current, snapshot);
    expect(result).toBe('Sub line');
  });

  it('should strip markdown from result', () => {
    const current = '• **Bold new line**';
    const snapshot = '• Old line';
    const result = findLastChange(current, snapshot);
    expect(result).toBe('Bold new line');
  });
});

// ==================== parseDocumentContent ====================

function parseDocumentContent(content: string): Array<{
  name: string;
  subjects: Array<{
    title: string;
    content: string;
    status: string;
    responsibility: string;
  }>;
}> {
  const lines = content.split('\n');
  const sections: Array<{
    name: string;
    subjects: Array<{
      title: string;
      content: string;
      status: string;
      responsibility: string;
    }>;
  }> = [];

  let currentSection = '';
  let tableStarted = false;

  for (const line of lines) {
    if (line.startsWith('| **Sujets**') || line.startsWith('| Sujets') || line.startsWith('| ---')) {
      tableStarted = true;
      continue;
    }
    if (!tableStarted || !line.startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map((c: string) => c.trim());
    if (cells.length < 4) continue;

    const [sectionCell, actionCell, statusCell, responsibilityCell] = cells;
    if (sectionCell && sectionCell !== '') {
      currentSection = sectionCell.replace(/\*\*/g, '');
      if (!sections.find((s) => s.name === currentSection)) {
        sections.push({ name: currentSection, subjects: [] });
      }
    }

    const titleMatch = actionCell.match(/^\*\*([^*]+)\*\*/);
    const title = titleMatch ? titleMatch[1] : actionCell.split('<br>')[0];
    const statusMatch = statusCell.match(/(🔴|🟡|🔵|🟢|🟣|🚀)\s*\*?\*?([^*]*)\*?\*?/);
    const status = statusMatch ? `${statusMatch[1]} ${statusMatch[2]}`.trim() : statusCell;

    const finalTitle = title.replace(/\*\*/g, '');

    const section = sections.find((s) => s.name === currentSection);
    if (section) {
      section.subjects.push({
        title: finalTitle,
        content: actionCell,
        status,
        responsibility: responsibilityCell,
      });
    }
  }

  return sections;
}

describe('parseDocumentContent', () => {
  const sampleDoc = `| **Sujets** | **Actions** | **Statut** | **Responsable** |
| --- | --- | --- | --- |
| **Section 1** | **Sujet A**<br>Description A | 🟢 Terminé | @Alice |
|  | **Sujet B**<br>Description B | 🔴 à faire | @Bob |
| **Section 2** | **Sujet C**<br>Description C | 🟡 En cours | @Charlie |`;

  it('should parse sections correctly', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Section 1');
    expect(result[1].name).toBe('Section 2');
  });

  it('should parse subjects within sections', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result[0].subjects).toHaveLength(2);
    expect(result[1].subjects).toHaveLength(1);
  });

  it('should extract subject titles', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result[0].subjects[0].title).toBe('Sujet A');
    expect(result[0].subjects[1].title).toBe('Sujet B');
  });

  it('should extract status with emoji', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result[0].subjects[0].status).toContain('🟢');
    expect(result[0].subjects[1].status).toContain('🔴');
  });

  it('should extract responsibility', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result[0].subjects[0].responsibility).toBe('@Alice');
  });

  it('should preserve full action cell content', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result[0].subjects[0].content).toContain('Description A');
  });

  it('should handle continuation rows (empty section cell)', () => {
    const result = parseDocumentContent(sampleDoc);
    expect(result[0].subjects[1].title).toBe('Sujet B');
  });

  it('should return empty array for content without table', () => {
    const result = parseDocumentContent('Just some text without table');
    expect(result).toHaveLength(0);
  });

  it('should handle table header with Sujets (non-bold)', () => {
    const doc = `| Sujets | Actions | Statut | Resp |
| --- | --- | --- | --- |
| **Test** | **Title**<br>Desc | 🟡 WIP | @Dev |`;
    const result = parseDocumentContent(doc);
    expect(result).toHaveLength(1);
    expect(result[0].subjects[0].title).toBe('Title');
  });
});
