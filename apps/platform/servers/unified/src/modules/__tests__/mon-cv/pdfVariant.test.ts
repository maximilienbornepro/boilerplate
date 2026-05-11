// Variant rendering : the "simple" version of a CV must strip the
// per-experience Projets sub-block but keep missions, technologies,
// side-projects, formations and awards untouched. The "complete"
// version (default) keeps everything exactly as before — guards
// against accidental regression of the legacy rendering.

import { describe, it, expect } from 'vitest';
import { generateCVHTML, variantToOptions } from '../../mon-cv/pdfService.js';
import type { CVData } from '../../mon-cv/types.js';

const CV: CVData = {
  name: 'Jane Doe',
  title: 'Tech Lead',
  email: null,
  phone: null,
  location: null,
  linkedin: null,
  github: null,
  website: null,
  profilePhoto: null,
  summary: 'Resume',
  experiences: [
    {
      title: 'Tech Lead',
      company: 'Acme',
      location: 'Paris',
      period: '2024 — present',
      description: 'Lead the platform team',
      missions: ['Mission alpha', 'Mission beta'],
      projects: [
        { title: 'Project ONE', description: 'Project ONE description' },
        { title: 'Project TWO', description: 'Project TWO description' },
      ],
      technologies: ['React', 'Node'],
      logo: null,
    },
  ],
  formations: [],
  skillCategories: [],
  languages: [],
  sideProjects: {
    title: 'Side Projects',
    description: 'desc',
    items: [{ category: 'Cat A', projects: ['Side ONE', 'Side TWO'] }],
    technologies: ['Rust'],
  },
  awards: [],
} as unknown as CVData;

describe('mon-cv generateCVHTML — variants', () => {
  it('default (complete) renders missions AND per-experience projects', () => {
    const html = generateCVHTML(CV);
    expect(html).toContain('Mission alpha');
    expect(html).toContain('Project ONE');
    expect(html).toContain('Project TWO');
    // Section header for per-experience projects
    expect(html).toMatch(/<div class="projects">[\s\S]*<h4>Projets<\/h4>/);
  });

  it('simple variant strips the per-experience Projets sub-block', () => {
    const html = generateCVHTML(CV, { simple: true });
    expect(html).toContain('Mission alpha');           // missions kept
    expect(html).toContain('Mission beta');
    expect(html).not.toContain('Project ONE');         // per-exp projects removed
    expect(html).not.toContain('Project TWO');
    expect(html).not.toMatch(/<div class="projects">[\s\S]*<h4>Projets<\/h4>/);
    // Sanity : technologies, side-projects and the rest survive.
    expect(html).toContain('React');
    expect(html).toContain('Side ONE');
    expect(html).toContain('Side Projects');
  });

  it('variantToOptions maps the API string to the render flag', () => {
    expect(variantToOptions('simple')).toEqual({ simple: true });
    expect(variantToOptions('complete')).toEqual({ simple: false });
    expect(variantToOptions(undefined)).toEqual({ simple: false });
  });
});
