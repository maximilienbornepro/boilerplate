import { describe, it, expect } from 'vitest';

// Test SuiVitess document parsing and subject management logic

describe('suivitess module', () => {
  describe('document ID generation from title', () => {
    function generateDocId(title: string): string {
      return title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    it('should convert title to kebab-case', () => {
      expect(generateDocId('Comité de Suivi')).toBe('comite-de-suivi');
    });

    it('should handle accented characters', () => {
      expect(generateDocId('Réunion équipe')).toBe('reunion-equipe');
    });

    it('should handle special characters', () => {
      expect(generateDocId('Suivi (v2) - Production')).toBe('suivi-v2-production');
    });

    it('should trim hyphens', () => {
      expect(generateDocId('  Test  ')).toBe('test');
    });
  });

  describe('status emoji parsing', () => {
    function parseStatus(statusCell: string): { emoji: string; text: string } | null {
      const match = statusCell.match(/(🔴|🟡|🔵|🟢|🟣|🚀)\s*\*?\*?([^*]*)\*?\*?/);
      if (!match) return null;
      return { emoji: match[1], text: match[2].trim() };
    }

    it('should parse red status', () => {
      const result = parseStatus('🔴 à faire');
      expect(result?.emoji).toBe('🔴');
      expect(result?.text).toBe('à faire');
    });

    it('should parse green status', () => {
      const result = parseStatus('🟢 Terminé');
      expect(result?.emoji).toBe('🟢');
      expect(result?.text).toBe('Terminé');
    });

    it('should parse yellow status', () => {
      const result = parseStatus('🟡 En cours');
      expect(result?.emoji).toBe('🟡');
      expect(result?.text).toBe('En cours');
    });

    it('should parse rocket status', () => {
      const result = parseStatus('🚀 Lancé');
      expect(result?.emoji).toBe('🚀');
      expect(result?.text).toBe('Lancé');
    });

    it('should handle bold status text', () => {
      const result = parseStatus('🟡 **En cours**');
      expect(result?.text).toBe('En cours');
    });

    it('should return null for no emoji', () => {
      expect(parseStatus('In Progress')).toBeNull();
    });
  });

  describe('subject title extraction', () => {
    function extractTitle(actionCell: string): string {
      const match = actionCell.match(/^\*\*([^*]+)\*\*/);
      if (match) return match[1];
      return actionCell.split('<br>')[0];
    }

    it('should extract bold title', () => {
      expect(extractTitle('**Mon Sujet**<br>Description')).toBe('Mon Sujet');
    });

    it('should fall back to first line if no bold', () => {
      expect(extractTitle('Simple title<br>Description')).toBe('Simple title');
    });

    it('should handle title without description', () => {
      expect(extractTitle('**Title Only**')).toBe('Title Only');
    });
  });

  describe('section parsing from table rows', () => {
    function parseSectionFromRow(line: string): string | null {
      if (!line.startsWith('|')) return null;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 1) return null;
      const sectionCell = cells[0].replace(/\*\*/g, '').trim();
      return sectionCell || null;
    }

    it('should extract section name from bold cell', () => {
      expect(parseSectionFromRow('| **Infrastructure** | Action | Status | Resp |')).toBe('Infrastructure');
    });

    it('should return null for empty section cell (continuation row)', () => {
      expect(parseSectionFromRow('|  | Action | Status | Resp |')).toBeNull();
    });

    it('should return null for non-table line', () => {
      expect(parseSectionFromRow('Regular text')).toBeNull();
    });
  });
});
