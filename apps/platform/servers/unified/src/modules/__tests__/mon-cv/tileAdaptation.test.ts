import { describe, it, expect } from 'vitest';
import {
  extractAtomicsFromCV,
  applyTextAtPath,
  buildAdditionAtomic,
  buildSkillsSnapshot,
} from '../../mon-cv/tileAdaptationService.js';
import { computeInitials } from '../../mon-cv/cvTransformService.js';
import type { CVData } from '../../mon-cv/types.js';

const baseCv: CVData = {
  name: 'Test',
  summary: 'Original summary',
  competences: ['React', 'TypeScript'],
  outils: ['Jira'],
  dev: [],
  frameworks: [],
  solutions: [],
  languages: ['Français', 'Anglais'],
  experiences: [
    {
      title: 'Lead Dev',
      company: 'Acme',
      period: '2020-2024',
      description: '',
      missions: ['Pilotage backlog', 'Code review'],
      projects: [{ title: 'Refonte API', description: 'Migration NestJS' }],
    },
  ],
  formations: [],
  awards: [],
  sideProjects: { title: '', description: '', items: [], technologies: [] },
};

describe('mon-cv tileAdaptationService', () => {
  describe('extractAtomicsFromCV', () => {
    it('flattens summary, skills, missions, projects into atomics', () => {
      const atomics = extractAtomicsFromCV(baseCv);
      const paths = atomics.map(a => a.path);
      expect(paths).toContain('summary');
      expect(paths).toContain('competences[0]');
      expect(paths).toContain('competences[1]');
      expect(paths).toContain('outils[0]');
      expect(paths).toContain('languages[0]');
      expect(paths).toContain('experiences[0].title');
      expect(paths).toContain('experiences[0].missions[0]');
      expect(paths).toContain('experiences[0].missions[1]');
      expect(paths).toContain('experiences[0].projects[0].title');
      expect(paths).toContain('experiences[0].projects[0].description');
    });

    it('builds human-readable labels including company name', () => {
      const atomics = extractAtomicsFromCV(baseCv);
      const m0 = atomics.find(a => a.path === 'experiences[0].missions[0]');
      expect(m0?.label).toBe('Acme — Mission #1');
    });

    it('skips empty fields', () => {
      const atomics = extractAtomicsFromCV(baseCv);
      // dev/frameworks/solutions are empty arrays — no tiles for them
      expect(atomics.some(a => a.path.startsWith('dev'))).toBe(false);
      expect(atomics.some(a => a.path.startsWith('frameworks'))).toBe(false);
      // experiences[0].description is empty — no tile
      expect(atomics.some(a => a.path === 'experiences[0].description')).toBe(false);
    });
  });

  describe('applyTextAtPath', () => {
    it('overwrites a top-level scalar', () => {
      const next = applyTextAtPath(baseCv, 'summary', 'Adapted summary');
      expect(next.summary).toBe('Adapted summary');
      // Original untouched
      expect(baseCv.summary).toBe('Original summary');
    });

    it('overwrites a nested mission text', () => {
      const next = applyTextAtPath(baseCv, 'experiences[0].missions[1]', 'Code review systématique');
      expect(next.experiences?.[0].missions[1]).toBe('Code review systématique');
      expect(next.experiences?.[0].missions[0]).toBe('Pilotage backlog'); // unchanged
    });

    it('overwrites a project description', () => {
      const next = applyTextAtPath(baseCv, 'experiences[0].projects[0].description', 'Migration vers NestJS + Fastify');
      expect(next.experiences?.[0].projects[0].description).toBe('Migration vers NestJS + Fastify');
    });

    it('appends to a flat skill array via [*] (aggressive-mode addition)', () => {
      const next = applyTextAtPath(baseCv, 'competences[*]', 'Architecture logicielle');
      expect(next.competences).toEqual(['React', 'TypeScript', 'Architecture logicielle']);
      // Original untouched
      expect(baseCv.competences).toEqual(['React', 'TypeScript']);
    });

    it('appends to an empty bucket via [*]', () => {
      const next = applyTextAtPath(baseCv, 'frameworks[*]', 'GraphQL');
      expect(next.frameworks).toEqual(['GraphQL']);
    });

    it('handles multiple sequential appends without mutating earlier ones', () => {
      const a = applyTextAtPath(baseCv, 'outils[*]', 'Datadog');
      const b = applyTextAtPath(a, 'outils[*]', 'Sentry');
      expect(b.outils).toEqual(['Jira', 'Datadog', 'Sentry']);
    });

    it('no-ops on a path that does not exist', () => {
      const next = applyTextAtPath(baseCv, 'experiences[5].missions[0]', 'X');
      expect(next.experiences).toHaveLength(1);
      expect(next.experiences?.[0].missions).toEqual(['Pilotage backlog', 'Code review']);
    });
  });

  describe('buildAdditionAtomic', () => {
    it('builds a properly-shaped tile for a competences addition', () => {
      const atom = buildAdditionAtomic(
        { bucket: 'competences', proposedText: 'Kubernetes', reasoning: 'Demandé par l\'offre' },
        0,
      );
      expect(atom.id).toBe('addition_competences_0');
      expect(atom.path).toBe('competences[*]');
      expect(atom.kind).toBe('competences_addition');
      expect(atom.originalText).toBe('');
      expect(atom.label).toBe('Ajout suggéré · Compétence : Kubernetes');
    });

    it('disambiguates multiple additions to the same bucket via index', () => {
      const a = buildAdditionAtomic({ bucket: 'frameworks', proposedText: 'GraphQL' }, 0);
      const b = buildAdditionAtomic({ bucket: 'frameworks', proposedText: 'tRPC' }, 1);
      expect(a.id).not.toBe(b.id);
      expect(a.id).toBe('addition_frameworks_0');
      expect(b.id).toBe('addition_frameworks_1');
    });
  });

  describe('buildSkillsSnapshot', () => {
    it('captures every skill bucket from a CV', () => {
      const snap = buildSkillsSnapshot(baseCv);
      expect(snap.competences).toEqual(['React', 'TypeScript']);
      expect(snap.outils).toEqual(['Jira']);
      expect(snap.languages).toEqual(['Français', 'Anglais']);
      expect(snap.dev).toEqual([]);
      expect(snap.frameworks).toEqual([]);
      expect(snap.solutions).toEqual([]);
    });
  });

  describe('computeInitials (ESN anonymisation)', () => {
    it('takes first + last name initials for a 2-token name', () => {
      expect(computeInitials('Maximilien Borne')).toBe('MB');
    });

    it('takes first + LAST initials for a 3-token name (skips middle)', () => {
      expect(computeInitials('Jean Pierre Dupont')).toBe('JD');
    });

    it('falls back to first 2 letters for a single token', () => {
      expect(computeInitials('Alex')).toBe('AL');
    });

    it('returns XX for empty / null / undefined', () => {
      expect(computeInitials('')).toBe('XX');
      expect(computeInitials('   ')).toBe('XX');
      expect(computeInitials(null)).toBe('XX');
      expect(computeInitials(undefined)).toBe('XX');
    });

    it('uppercases lowercase input', () => {
      expect(computeInitials('jean dupont')).toBe('JD');
    });

    it('handles tabs / extra whitespace cleanly', () => {
      expect(computeInitials('  Jean   Dupont  ')).toBe('JD');
    });
  });
});
