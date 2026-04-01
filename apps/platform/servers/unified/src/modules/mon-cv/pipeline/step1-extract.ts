import type { CVData } from '../types.js';
import type { CVMap, CVElement } from './types.js';

/**
 * Step 1: Extract CV into indexed elements (CVMap).
 * Pure algorithmic extraction — no LLM call.
 */
export function extractCVMap(cvData: CVData): CVMap {
  const elements: CVElement[] = [];

  // Index title
  if (cvData.title) {
    elements.push({
      id: 'title',
      section: 'title',
      text: cvData.title,
      normalizedText: cvData.title.toLowerCase().trim(),
    });
  }

  // Index summary
  if (cvData.summary) {
    elements.push({
      id: 'summary',
      section: 'summary',
      text: cvData.summary,
      normalizedText: cvData.summary.toLowerCase().trim(),
    });
  }

  // Index each experience's missions, projects, technologies
  (cvData.experiences || []).forEach((exp, expIdx) => {
    const context = `${exp.title} at ${exp.company}`;

    (exp.missions || []).forEach((mission, mIdx) => {
      elements.push({
        id: `exp-${expIdx}-mission-${mIdx}`,
        section: 'mission',
        text: mission,
        normalizedText: mission.toLowerCase().trim(),
        parentContext: context,
        experienceIndex: expIdx,
      });
    });

    (exp.projects || []).forEach((proj, pIdx) => {
      if (proj.title) {
        elements.push({
          id: `exp-${expIdx}-project-${pIdx}`,
          section: 'project',
          text: `${proj.title}${proj.description ? ': ' + proj.description : ''}`,
          normalizedText: `${proj.title} ${proj.description || ''}`.toLowerCase().trim(),
          parentContext: context,
          experienceIndex: expIdx,
        });
      }
    });

    (exp.technologies || []).forEach((tech, tIdx) => {
      elements.push({
        id: `exp-${expIdx}-tech-${tIdx}`,
        section: 'technology',
        text: tech,
        normalizedText: tech.toLowerCase().trim(),
        parentContext: context,
        experienceIndex: expIdx,
      });
    });
  });

  // Index skills by category
  const skillCategories = ['competences', 'outils', 'dev', 'frameworks', 'solutions'] as const;
  for (const cat of skillCategories) {
    ((cvData[cat] as string[] | undefined) || []).forEach((skill, sIdx) => {
      elements.push({
        id: `skill-${cat}-${sIdx}`,
        section: cat,
        text: skill,
        normalizedText: skill.toLowerCase().trim(),
      });
    });
  }

  // Index formations
  (cvData.formations || []).forEach((form, fIdx) => {
    elements.push({
      id: `formation-${fIdx}`,
      section: 'formation',
      text: `${form.title} - ${form.school}`,
      normalizedText: `${form.title} ${form.school}`.toLowerCase().trim(),
    });
  });

  // Detect language by checking common French words in missions
  const allText = elements.map(e => e.normalizedText).join(' ');
  const frenchIndicators = [
    'mise en place', 'gestion', 'développement', 'réalisation',
    'suivi', 'conception', 'pilotage', 'équipe',
  ];
  const frenchCount = frenchIndicators.filter(w => allText.includes(w)).length;
  const language = frenchCount >= 2 ? 'fr' : 'en';

  return {
    elements,
    language,
    experienceCount: (cvData.experiences || []).length,
    totalMissions: elements.filter(e => e.section === 'mission').length,
    totalSkills: elements.filter(e =>
      ['competences', 'outils', 'dev', 'frameworks', 'solutions'].includes(e.section)
    ).length,
  };
}
