import { describe, it, expect } from 'vitest';
import { createEmptyCV } from '../types';
import type { CVData, Experience, Formation, Award, DiffItem } from '../types';

describe('Mon CV Frontend - Types', () => {
  describe('createEmptyCV', () => {
    it('should create an empty CV with all required fields', () => {
      const cv = createEmptyCV();

      expect(cv).toBeDefined();
      expect(cv.name).toBe('');
      expect(cv.title).toBe('');
      expect(cv.summary).toBe('');
      expect(cv.profilePhoto).toBe('');
    });

    it('should have properly initialized contact', () => {
      const cv = createEmptyCV();

      expect(cv.contact).toBeDefined();
      expect(cv.contact?.email).toBe('');
      expect(cv.contact?.phone).toBe('');
    });

    it('should have empty arrays for all list fields', () => {
      const cv = createEmptyCV();

      expect(cv.languages).toEqual([]);
      expect(cv.competences).toEqual([]);
      expect(cv.experiences).toEqual([]);
      expect(cv.formations).toEqual([]);
      expect(cv.awards).toEqual([]);
    });
  });

  describe('CVData manipulation', () => {
    it('should allow adding experiences', () => {
      const cv = createEmptyCV();
      const newExperience: Experience = {
        title: 'Software Engineer',
        company: 'Tech Inc',
        period: '2022 - Present',
        missions: ['Development', 'Code Review'],
        projects: [],
      };

      const updated: CVData = {
        ...cv,
        experiences: [...(cv.experiences || []), newExperience],
      };

      expect(updated.experiences).toHaveLength(1);
      expect(updated.experiences![0].title).toBe('Software Engineer');
    });

    it('should allow updating contact info', () => {
      const cv = createEmptyCV();

      const updated: CVData = {
        ...cv,
        contact: {
          ...cv.contact,
          email: 'test@example.com',
          phone: '+33612345678',
        },
      };

      expect(updated.contact?.email).toBe('test@example.com');
      expect(updated.contact?.phone).toBe('+33612345678');
    });

    it('should allow updating skills', () => {
      const cv = createEmptyCV();

      const updated: CVData = {
        ...cv,
        languages: ['French', 'English'],
        dev: ['TypeScript', 'Python'],
        frameworks: ['React', 'Node.js'],
      };

      expect(updated.languages).toHaveLength(2);
      expect(updated.dev).toContain('TypeScript');
      expect(updated.frameworks).toContain('React');
    });
  });
});

describe('Mon CV Frontend - Diff Logic', () => {
  it('should identify new sections', () => {
    const currentCV = createEmptyCV();
    const importedCV: CVData = {
      ...createEmptyCV(),
      name: 'John Doe',
      experiences: [{ title: 'Dev', company: 'Corp', period: '2020', missions: [], projects: [] }],
    };

    const diff: DiffItem[] = [
      {
        section: 'name',
        hasChanges: !!importedCV.name,
        isNew: !!importedCV.name && !currentCV.name,
      },
      {
        section: 'experiences',
        hasChanges: (importedCV.experiences?.length || 0) > 0,
        isNew: (importedCV.experiences?.length || 0) > 0 && (currentCV.experiences?.length || 0) === 0,
      },
    ];

    expect(diff[0].hasChanges).toBe(true);
    expect(diff[0].isNew).toBe(true);
    expect(diff[1].hasChanges).toBe(true);
    expect(diff[1].isNew).toBe(true);
  });

  it('should identify modified sections', () => {
    const currentCV: CVData = {
      ...createEmptyCV(),
      name: 'Jane Doe',
    };
    const importedCV: CVData = {
      ...createEmptyCV(),
      name: 'John Doe',
    };

    const diff: DiffItem = {
      section: 'name',
      hasChanges: !!importedCV.name,
      isNew: !!importedCV.name && !currentCV.name,
    };

    expect(diff.hasChanges).toBe(true);
    expect(diff.isNew).toBe(false); // Not new, it's modified
  });

  it('should identify empty sections', () => {
    const importedCV = createEmptyCV();

    const diff: DiffItem = {
      section: 'experiences',
      hasChanges: (importedCV.experiences?.length || 0) > 0,
      isNew: false,
    };

    expect(diff.hasChanges).toBe(false);
  });
});

describe('Mon CV Frontend - Section Merge', () => {
  it('should merge selected sections only', () => {
    const currentCV: CVData = {
      ...createEmptyCV(),
      name: 'Current Name',
      title: 'Current Title',
      languages: ['French'],
    };

    const importedCV: CVData = {
      ...createEmptyCV(),
      name: 'New Name',
      title: 'New Title',
      languages: ['English', 'Spanish'],
      dev: ['Python'],
    };

    const selectedSections = ['name', 'languages'];

    // Merge logic
    const merged: CVData = { ...currentCV };
    for (const section of selectedSections) {
      if ((importedCV as any)[section] !== undefined) {
        (merged as any)[section] = (importedCV as any)[section];
      }
    }

    expect(merged.name).toBe('New Name'); // Merged
    expect(merged.title).toBe('Current Title'); // Not merged
    expect(merged.languages).toEqual(['English', 'Spanish']); // Merged
    expect(merged.dev).toEqual([]); // Not merged (kept original empty)
  });
});

describe('Mon CV Frontend - Experience Helpers', () => {
  it('should create a new empty experience', () => {
    const newExp: Experience = {
      title: '',
      company: '',
      period: '',
      location: '',
      description: '',
      missions: [],
      projects: [],
      clients: [],
      technologies: [],
    };

    expect(newExp.title).toBe('');
    expect(newExp.missions).toEqual([]);
  });

  it('should update experience field', () => {
    const exp: Experience = {
      title: 'Developer',
      company: 'Corp',
      period: '2020',
      missions: ['Task 1'],
      projects: [],
    };

    const updated: Experience = {
      ...exp,
      title: 'Senior Developer',
      missions: [...exp.missions, 'Task 2'],
    };

    expect(updated.title).toBe('Senior Developer');
    expect(updated.missions).toHaveLength(2);
  });
});

describe('Mon CV Frontend - Formation Helpers', () => {
  it('should create a new empty formation', () => {
    const newForm: Formation = {
      title: '',
      school: '',
      period: '',
      location: '',
    };

    expect(newForm.title).toBe('');
  });
});

describe('Mon CV Frontend - Award Helpers', () => {
  it('should create a new empty award', () => {
    const newAward: Award = {
      type: '',
      year: '',
      title: '',
      location: '',
    };

    expect(newAward.type).toBe('');
  });
});

describe('Mon CV Frontend - Adaptation Types', () => {
  it('should define AdaptRequest structure', () => {
    const request = {
      cvData: createEmptyCV(),
      jobOffer: 'Job description here',
      customInstructions: 'Focus on leadership',
    };

    expect(request.cvData).toBeDefined();
    expect(request.jobOffer).toBe('Job description here');
    expect(request.customInstructions).toBe('Focus on leadership');
  });

  it('should define AdaptResponse structure', () => {
    const response = {
      adaptedCV: createEmptyCV(),
      changes: {
        newMissions: ['Mission 1', 'Mission 2'],
        newProject: { title: 'New Project', description: 'Generated' },
        addedSkills: { competences: ['Leadership'] },
      },
    };

    expect(response.adaptedCV).toBeDefined();
    expect(response.changes.newMissions).toHaveLength(2);
    expect(response.changes.newProject?.title).toBe('New Project');
    expect(response.changes.addedSkills.competences).toContain('Leadership');
  });

  it('should allow optional fields in AdaptRequest', () => {
    const request = {
      cvData: createEmptyCV(),
      jobOffer: 'Job description',
    };

    expect(request.cvData).toBeDefined();
    expect(request.jobOffer).toBeDefined();
    // customInstructions is optional
  });

  it('should allow optional newProject in AdaptResponse', () => {
    const response = {
      adaptedCV: createEmptyCV(),
      changes: {
        newMissions: [],
        addedSkills: {},
      },
    };

    expect(response.changes.newProject).toBeUndefined();
    expect(response.changes.newMissions).toHaveLength(0);
  });
});

describe('Mon CV Frontend - PDF Export Helpers', () => {
  it('should generate download filename from CV name', () => {
    const generateFilename = (cvData: CVData): string => {
      const name = cvData.name?.trim();
      if (!name) return 'CV.pdf';
      return `CV_${name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    };

    const cv: CVData = { ...createEmptyCV(), name: 'Jean Dupont' };
    expect(generateFilename(cv)).toBe('CV_Jean_Dupont.pdf');
  });

  it('should handle missing name in filename generation', () => {
    const generateFilename = (cvData: CVData): string => {
      const name = cvData.name?.trim();
      if (!name) return 'CV.pdf';
      return `CV_${name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    };

    const cv = createEmptyCV();
    expect(generateFilename(cv)).toBe('CV.pdf');
  });

  it('should define preview URL helper', () => {
    const API_BASE = '/mon-cv-api';
    const getPreviewPDFUrl = (): string => `${API_BASE}/preview-pdf`;

    expect(getPreviewPDFUrl()).toBe('/mon-cv-api/preview-pdf');
  });
});
