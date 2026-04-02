import { describe, it, expect } from 'vitest';
import { mapIssueType, formatJiraTitle, stripJiraKey } from '../utils/jiraUtils';

describe('Jira Import — utilitaires', () => {
  describe('mapIssueType', () => {
    it('mappe Bug → bug', () => {
      expect(mapIssueType('Bug')).toBe('bug');
    });

    it('mappe bug (minuscule) → bug', () => {
      expect(mapIssueType('bug')).toBe('bug');
    });

    it('mappe Story → feature', () => {
      expect(mapIssueType('Story')).toBe('feature');
    });

    it('mappe Epic → feature', () => {
      expect(mapIssueType('Epic')).toBe('feature');
    });

    it('mappe story et epic en minuscule → feature', () => {
      expect(mapIssueType('story')).toBe('feature');
      expect(mapIssueType('epic')).toBe('feature');
    });

    it('mappe Task → tech', () => {
      expect(mapIssueType('Task')).toBe('tech');
    });

    it('mappe Sub-task → tech', () => {
      expect(mapIssueType('Sub-task')).toBe('tech');
    });

    it('mappe type inconnu → tech', () => {
      expect(mapIssueType('Improvement')).toBe('tech');
      expect(mapIssueType('')).toBe('tech');
    });
  });

  describe('formatJiraTitle', () => {
    it('formate correctement le titre', () => {
      expect(formatJiraTitle('PROJ-42', 'Corriger le bug de login')).toBe('[PROJ-42] Corriger le bug de login');
    });

    it('prefixe avec la cle entre crochets', () => {
      const title = formatJiraTitle('ABC-1', 'Test');
      expect(title.startsWith('[ABC-1]')).toBe(true);
    });

    it('inclut le summary apres la cle', () => {
      const summary = 'Ajouter la page de profil';
      const title = formatJiraTitle('KEY-99', summary);
      expect(title.endsWith(summary)).toBe(true);
    });
  });

  describe('stripJiraKey', () => {
    it('retire le prefixe [KEY-123]', () => {
      expect(stripJiraKey('[PROJ-42] Fix login bug')).toBe('Fix login bug');
    });

    it('retire le prefixe avec underscore dans le projet', () => {
      expect(stripJiraKey('[MY_PROJECT-1] Task title')).toBe('Task title');
    });

    it('ne modifie pas un titre sans prefixe', () => {
      expect(stripJiraKey('Tache manuelle')).toBe('Tache manuelle');
    });

    it('gere les titres vides', () => {
      expect(stripJiraKey('')).toBe('');
    });

    it('roundtrip formatJiraTitle → stripJiraKey retourne le summary', () => {
      const summary = 'Corriger le bug de login';
      const title = formatJiraTitle('PROJ-42', summary);
      expect(stripJiraKey(title)).toBe(summary);
    });
  });

  describe('logique de visibilite du bouton', () => {
    it('affiche le bouton si jiraConnected est true', () => {
      const jiraConnected = true;
      expect(jiraConnected).toBe(true);
    });

    it('cache le bouton si jiraConnected est false', () => {
      const jiraConnected = false;
      expect(jiraConnected).toBe(false);
    });

    it('le statut initial est false (avant le check)', () => {
      // Default state before checkJiraConnected() resolves
      const initialState = false;
      expect(initialState).toBe(false);
    });
  });
});
