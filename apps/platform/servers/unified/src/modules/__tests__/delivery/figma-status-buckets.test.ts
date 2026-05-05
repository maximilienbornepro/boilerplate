import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../../delivery/figmaExport.js';

// Status buckets used by the "Copier pour Figma" SVG export. The
// rules diverge from the frontend's mapSimpleStatus on purpose :
// review states count as done in the Figma copy because, from the
// planning board's perspective, anything in review is already out
// of the team's hands.

describe('delivery — figmaExport.normalizeStatus', () => {
  describe('review states bucket as DONE (Figma export rule)', () => {
    const reviewVariants = [
      'Revue', 'revue', 'REVUE',
      'En revue', 'en revue',
      'Review', 'review',
      'In Review', 'in review',
      'Code Review', 'code review',
      'En relecture', 'Relecture', 'relecture',
      'PR Review', 'awaiting review',
    ];
    for (const v of reviewVariants) {
      it(`"${v}" → done`, () => {
        expect(normalizeStatus(v)).toBe('done');
      });
    }
  });

  describe('classic done states still bucket as DONE', () => {
    const doneVariants = ['Done', 'done', 'Terminé', 'Closed', 'Resolved', 'En test', 'En livraison', 'Vérifié'];
    for (const v of doneVariants) {
      it(`"${v}" → done`, () => {
        expect(normalizeStatus(v)).toBe('done');
      });
    }
  });

  describe('todo states bucket as TODO', () => {
    const todoVariants = ['Backlog', 'To Do', 'À faire', 'Open', 'New', 'Selected for development'];
    for (const v of todoVariants) {
      it(`"${v}" → todo`, () => {
        expect(normalizeStatus(v)).toBe('todo');
      });
    }
  });

  describe('everything else falls back to in_progress', () => {
    it('"In Progress" → in_progress', () => {
      expect(normalizeStatus('In Progress')).toBe('in_progress');
    });
    it('"En cours" → in_progress', () => {
      expect(normalizeStatus('En cours')).toBe('in_progress');
    });
    it('unknown status → in_progress', () => {
      expect(normalizeStatus('Quelque chose de bizarre')).toBe('in_progress');
    });
  });

  describe('null / empty handling', () => {
    it('null → todo', () => {
      expect(normalizeStatus(null)).toBe('todo');
    });
    it('undefined → todo', () => {
      expect(normalizeStatus(undefined)).toBe('todo');
    });
    it('empty string → todo', () => {
      expect(normalizeStatus('')).toBe('todo');
    });
    it('whitespace → todo', () => {
      expect(normalizeStatus('   ')).toBe('todo');
    });
  });
});
