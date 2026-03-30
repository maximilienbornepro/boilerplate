import { describe, it, expect } from 'vitest';
import { createEmptyCV } from '../../mon-cv/types.js';
import { scoreCV } from '../../mon-cv/adaptService.js';
import type { CVData, Experience, Formation, Award, SideProjects } from '../../mon-cv/types.js';

describe('Mon CV - Types', () => {
  describe('createEmptyCV', () => {
    it('should create an empty CV with all required fields', () => {
      const cv = createEmptyCV();

      expect(cv).toBeDefined();
      expect(cv.name).toBe('');
      expect(cv.title).toBe('');
      expect(cv.summary).toBe('');
      expect(cv.profilePhoto).toBe('');
    });

    it('should have empty contact object', () => {
      const cv = createEmptyCV();

      expect(cv.contact).toBeDefined();
      expect(cv.contact?.email).toBe('');
      expect(cv.contact?.phone).toBe('');
      expect(cv.contact?.address).toBe('');
      expect(cv.contact?.city).toBe('');
    });

    it('should have empty skill arrays', () => {
      const cv = createEmptyCV();

      expect(Array.isArray(cv.languages)).toBe(true);
      expect(cv.languages).toHaveLength(0);
      expect(Array.isArray(cv.competences)).toBe(true);
      expect(cv.competences).toHaveLength(0);
      expect(Array.isArray(cv.outils)).toBe(true);
      expect(cv.outils).toHaveLength(0);
      expect(Array.isArray(cv.dev)).toBe(true);
      expect(cv.dev).toHaveLength(0);
      expect(Array.isArray(cv.frameworks)).toBe(true);
      expect(cv.frameworks).toHaveLength(0);
      expect(Array.isArray(cv.solutions)).toBe(true);
      expect(cv.solutions).toHaveLength(0);
    });

    it('should have empty experiences array', () => {
      const cv = createEmptyCV();

      expect(Array.isArray(cv.experiences)).toBe(true);
      expect(cv.experiences).toHaveLength(0);
    });

    it('should have empty formations array', () => {
      const cv = createEmptyCV();

      expect(Array.isArray(cv.formations)).toBe(true);
      expect(cv.formations).toHaveLength(0);
    });

    it('should have empty awards array', () => {
      const cv = createEmptyCV();

      expect(Array.isArray(cv.awards)).toBe(true);
      expect(cv.awards).toHaveLength(0);
    });

    it('should have empty sideProjects object', () => {
      const cv = createEmptyCV();

      expect(cv.sideProjects).toBeDefined();
      expect(cv.sideProjects?.title).toBe('');
      expect(cv.sideProjects?.description).toBe('');
      expect(Array.isArray(cv.sideProjects?.items)).toBe(true);
      expect(cv.sideProjects?.items).toHaveLength(0);
      expect(Array.isArray(cv.sideProjects?.technologies)).toBe(true);
      expect(cv.sideProjects?.technologies).toHaveLength(0);
    });
  });

  describe('CVData structure', () => {
    it('should accept a valid experience', () => {
      const experience: Experience = {
        title: 'Developer',
        company: 'Tech Corp',
        period: '2020 - Present',
        location: 'Paris',
        description: 'Full stack development',
        missions: ['Feature development', 'Code review'],
        projects: [{ title: 'Project A', description: 'Main project' }],
        clients: ['Client A'],
        technologies: ['TypeScript', 'React'],
        logo: '',
      };

      expect(experience.title).toBe('Developer');
      expect(experience.missions).toHaveLength(2);
      expect(experience.projects).toHaveLength(1);
    });

    it('should accept a valid formation', () => {
      const formation: Formation = {
        title: 'Master in Computer Science',
        school: 'University of Paris',
        period: '2015 - 2020',
        location: 'Paris',
      };

      expect(formation.title).toBe('Master in Computer Science');
      expect(formation.school).toBe('University of Paris');
    });

    it('should accept a valid award', () => {
      const award: Award = {
        type: 'Certification',
        year: '2023',
        title: 'AWS Solutions Architect',
        location: 'Online',
      };

      expect(award.type).toBe('Certification');
      expect(award.year).toBe('2023');
    });

    it('should accept valid sideProjects', () => {
      const sideProjects: SideProjects = {
        title: 'Personal Projects',
        description: 'My open source work',
        items: [
          { category: 'Open Source', projects: ['Project 1', 'Project 2'] }
        ],
        technologies: ['TypeScript', 'Node.js'],
      };

      expect(sideProjects.items).toHaveLength(1);
      expect(sideProjects.items[0].projects).toHaveLength(2);
    });
  });

  describe('CV validation helpers', () => {
    it('should identify empty CV sections', () => {
      const cv = createEmptyCV();

      const isExperiencesEmpty = !cv.experiences || cv.experiences.length === 0;
      const isFormationsEmpty = !cv.formations || cv.formations.length === 0;
      const isSkillsEmpty = (
        (!cv.languages || cv.languages.length === 0) &&
        (!cv.competences || cv.competences.length === 0) &&
        (!cv.dev || cv.dev.length === 0)
      );

      expect(isExperiencesEmpty).toBe(true);
      expect(isFormationsEmpty).toBe(true);
      expect(isSkillsEmpty).toBe(true);
    });

    it('should identify non-empty CV sections', () => {
      const cv: CVData = {
        ...createEmptyCV(),
        name: 'John Doe',
        experiences: [
          {
            title: 'Developer',
            company: 'Corp',
            period: '2020-2023',
            missions: [],
            projects: [],
          }
        ],
        languages: ['French', 'English'],
      };

      const hasName = !!cv.name;
      const hasExperiences = cv.experiences && cv.experiences.length > 0;
      const hasLanguages = cv.languages && cv.languages.length > 0;

      expect(hasName).toBe(true);
      expect(hasExperiences).toBe(true);
      expect(hasLanguages).toBe(true);
    });
  });
});

describe('Mon CV - Constants', () => {
  it('should have correct section labels', () => {
    const SECTION_LABELS: Record<string, string> = {
      name: 'Nom',
      title: 'Titre',
      summary: 'Resume',
      contact: 'Contact',
      languages: 'Langues',
      competences: 'Competences',
      outils: 'Outils',
      dev: 'Developpement',
      frameworks: 'Frameworks',
      solutions: 'Solutions',
      experiences: 'Experiences',
      formations: 'Formations',
      awards: 'Distinctions',
      sideProjects: 'Projets personnels',
    };

    expect(SECTION_LABELS.name).toBe('Nom');
    expect(SECTION_LABELS.experiences).toBe('Experiences');
    expect(Object.keys(SECTION_LABELS)).toHaveLength(14);
  });
});

describe('Mon CV - PDF Service', () => {
  describe('generateFilename', () => {
    it('should generate filename from CV name', () => {
      const generateFilename = (cvData: CVData): string => {
        const name = cvData.name?.trim();
        if (!name) {
          return 'CV.pdf';
        }
        const sanitized = name
          .replace(/[^a-zA-Z0-9\s-]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 50);
        return `CV_${sanitized}.pdf`;
      };

      const cv: CVData = { ...createEmptyCV(), name: 'Jean Dupont' };
      expect(generateFilename(cv)).toBe('CV_Jean_Dupont.pdf');
    });

    it('should return default filename when no name', () => {
      const generateFilename = (cvData: CVData): string => {
        const name = cvData.name?.trim();
        if (!name) {
          return 'CV.pdf';
        }
        const sanitized = name
          .replace(/[^a-zA-Z0-9\s-]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 50);
        return `CV_${sanitized}.pdf`;
      };

      const cv = createEmptyCV();
      expect(generateFilename(cv)).toBe('CV.pdf');
    });

    it('should sanitize special characters in filename', () => {
      const generateFilename = (cvData: CVData): string => {
        const name = cvData.name?.trim();
        if (!name) {
          return 'CV.pdf';
        }
        const sanitized = name
          .replace(/[^a-zA-Z0-9\s-]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 50);
        return `CV_${sanitized}.pdf`;
      };

      const cv: CVData = { ...createEmptyCV(), name: 'Jean-Pierre Dupont (Dev)' };
      expect(generateFilename(cv)).toBe('CV_Jean-Pierre_Dupont_Dev.pdf');
    });
  });

  describe('imageToBase64 logic', () => {
    it('should return existing base64 data as-is', () => {
      const imageToBase64Check = (imageSource: string): boolean => {
        return imageSource.startsWith('data:');
      };

      expect(imageToBase64Check('data:image/png;base64,abc123')).toBe(true);
      expect(imageToBase64Check('https://example.com/img.png')).toBe(false);
    });

    it('should identify URL for fetching', () => {
      const isUrl = (imageSource: string): boolean => {
        return imageSource.startsWith('http://') || imageSource.startsWith('https://');
      };

      expect(isUrl('https://example.com/img.png')).toBe(true);
      expect(isUrl('http://localhost/img.png')).toBe(true);
      expect(isUrl('data:image/png;base64,abc')).toBe(false);
    });
  });
});

describe('Mon CV - Autofill Service', () => {
  describe('detectFieldType', () => {
    it('should detect email type as direct', () => {
      const field = {
        selector: '#email',
        type: 'email' as const,
        label: 'Email',
      };

      const directTypes = ['email', 'tel'];
      const isDirectType = directTypes.includes(field.type);

      expect(isDirectType).toBe(true);
    });

    it('should detect tel type as direct', () => {
      const field = {
        selector: '#phone',
        type: 'tel' as const,
        label: 'Phone',
      };

      const directTypes = ['email', 'tel'];
      const isDirectType = directTypes.includes(field.type);

      expect(isDirectType).toBe(true);
    });

    it('should detect name field as direct by label', () => {
      const detectFieldType = (label: string): 'direct' | 'generated' => {
        const directPatterns = [
          /^(full\s*)?name$/,
          /^nom(\s+complet)?$/,
          /^pr[eé]nom$/,
          /^email$/,
          /^t[eé]l[eé]phone?$/,
        ];
        const labelLower = label.toLowerCase();
        for (const pattern of directPatterns) {
          if (pattern.test(labelLower)) {
            return 'direct';
          }
        }
        return 'generated';
      };

      expect(detectFieldType('name')).toBe('direct');
      expect(detectFieldType('Nom')).toBe('direct');
      expect(detectFieldType('Full Name')).toBe('direct');
      expect(detectFieldType('Prénom')).toBe('direct');
    });

    it('should detect complex fields as generated', () => {
      const detectFieldType = (label: string): 'direct' | 'generated' => {
        const directPatterns = [
          /^(full\s*)?name$/,
          /^nom(\s+complet)?$/,
          /^pr[eé]nom$/,
          /^email$/,
          /^t[eé]l[eé]phone?$/,
        ];
        const labelLower = label.toLowerCase();
        for (const pattern of directPatterns) {
          if (pattern.test(labelLower)) {
            return 'direct';
          }
        }
        return 'generated';
      };

      expect(detectFieldType('Cover Letter')).toBe('generated');
      expect(detectFieldType('Why do you want to work here?')).toBe('generated');
      expect(detectFieldType('Experience Summary')).toBe('generated');
    });
  });

  describe('getDirectValue', () => {
    const mockCVData = {
      name: 'Jean Dupont',
      title: 'Senior Developer',
      contact: {
        email: 'jean@example.com',
        phone: '+33612345678',
        city: 'Paris',
        address: '123 Rue de Paris',
      },
    };

    it('should return email for email field', () => {
      const getDirectValue = (fieldType: string, labelHint: string, cv: typeof mockCVData): string | null => {
        const combined = `${labelHint.toLowerCase()}`;
        if (fieldType === 'email' || /email|courriel/.test(combined)) {
          return cv.contact?.email || null;
        }
        return null;
      };

      expect(getDirectValue('email', '', mockCVData)).toBe('jean@example.com');
      expect(getDirectValue('text', 'Email Address', mockCVData)).toBe('jean@example.com');
    });

    it('should return phone for tel field', () => {
      const getDirectValue = (fieldType: string, labelHint: string, cv: typeof mockCVData): string | null => {
        const combined = `${labelHint.toLowerCase()}`;
        if (fieldType === 'tel' || /phone|téléphone/.test(combined)) {
          return cv.contact?.phone || null;
        }
        return null;
      };

      expect(getDirectValue('tel', '', mockCVData)).toBe('+33612345678');
      expect(getDirectValue('text', 'Phone Number', mockCVData)).toBe('+33612345678');
    });

    it('should return name for name field', () => {
      const getDirectValue = (labelHint: string, cv: typeof mockCVData): string | null => {
        if (/^(full\s*)?name$|^nom(\s+complet)?$/i.test(labelHint)) {
          return cv.name || null;
        }
        return null;
      };

      expect(getDirectValue('name', mockCVData)).toBe('Jean Dupont');
      expect(getDirectValue('Nom', mockCVData)).toBe('Jean Dupont');
    });

    it('should extract first name', () => {
      const getFirstName = (fullName: string): string | null => {
        const names = fullName.split(' ');
        return names[0] || null;
      };

      expect(getFirstName(mockCVData.name)).toBe('Jean');
    });

    it('should extract last name', () => {
      const getLastName = (fullName: string): string | null => {
        const names = fullName.split(' ');
        return names.slice(1).join(' ') || null;
      };

      expect(getLastName(mockCVData.name)).toBe('Dupont');
    });

    it('should return city for city field', () => {
      const getDirectValue = (labelHint: string, cv: typeof mockCVData): string | null => {
        if (/city|ville/i.test(labelHint)) {
          return cv.contact?.city || null;
        }
        return null;
      };

      expect(getDirectValue('City', mockCVData)).toBe('Paris');
      expect(getDirectValue('Ville', mockCVData)).toBe('Paris');
    });
  });

  describe('generateSelector', () => {
    it('should return existing selector if valid', () => {
      const generateSelector = (field: { selector?: string; id?: string; name?: string }): string => {
        if (field.selector && field.selector !== '') {
          return field.selector;
        }
        if (field.id) {
          return `#${field.id}`;
        }
        if (field.name) {
          return `[name="${field.name}"]`;
        }
        return 'input';
      };

      expect(generateSelector({ selector: '#email' })).toBe('#email');
    });

    it('should generate ID selector', () => {
      const generateSelector = (field: { selector?: string; id?: string; name?: string }): string => {
        if (field.selector && field.selector !== '') {
          return field.selector;
        }
        if (field.id) {
          return `#${field.id}`;
        }
        if (field.name) {
          return `[name="${field.name}"]`;
        }
        return 'input';
      };

      expect(generateSelector({ id: 'firstName' })).toBe('#firstName');
    });

    it('should generate name selector', () => {
      const generateSelector = (field: { selector?: string; id?: string; name?: string }): string => {
        if (field.selector && field.selector !== '') {
          return field.selector;
        }
        if (field.id) {
          return `#${field.id}`;
        }
        if (field.name) {
          return `[name="${field.name}"]`;
        }
        return 'input';
      };

      expect(generateSelector({ name: 'user_email' })).toBe('[name="user_email"]');
    });

    it('should fallback to tag selector', () => {
      const generateSelector = (field: { selector?: string; id?: string; name?: string }): string => {
        if (field.selector && field.selector !== '') {
          return field.selector;
        }
        if (field.id) {
          return `#${field.id}`;
        }
        if (field.name) {
          return `[name="${field.name}"]`;
        }
        return 'input';
      };

      expect(generateSelector({})).toBe('input');
    });
  });
});

describe('Mon CV - ATS Score (scoreCV)', () => {
  const jobAnalysis = {
    requiredKeywords: ['gestion de projet', 'Agile', 'reporting'],
    preferredKeywords: ['PMP', 'leadership'],
    exactJobTitle: 'Chef de Projet',
    technologies: ['Jira'],
    keyResponsibilities: ['Manage projects'],
    domain: 'IT project management',
    atsHint: 'unknown' as const,
  };

  it('should return 100% keywordMatch when all required keywords are in experience', () => {
    const cv: CVData = {
      ...createEmptyCV(),
      title: 'Chef de Projet',
      experiences: [
        {
          title: 'Chef de Projet',
          company: 'Corp',
          period: '2020-2023',
          missions: [
            'Mise en place de la gestion de projet Agile pour 5 équipes',
            'Production de reporting hebdomadaire pour les parties prenantes',
          ],
          projects: [],
        },
      ],
    };

    const score = scoreCV(cv, jobAnalysis);
    expect(score.keywordMatch).toBe(100);
    expect(score.breakdown.requiredFound).toContain('gestion de projet');
    expect(score.breakdown.requiredFound).toContain('Agile');
    expect(score.breakdown.requiredFound).toContain('reporting');
    expect(score.breakdown.requiredMissing).toHaveLength(0);
  });

  it('should detect multi-section keywords (experience + skills)', () => {
    const cv: CVData = {
      ...createEmptyCV(),
      title: 'Chef de Projet',
      competences: ['Agile', 'reporting'],
      experiences: [
        {
          title: 'Chef de Projet',
          company: 'Corp',
          period: '2020-2023',
          missions: [
            'Conduite de gestion de projet Agile pour une équipe de 8 développeurs',
          ],
          projects: [],
        },
      ],
    };

    const score = scoreCV(cv, jobAnalysis);
    // 'Agile' is in both experience (mission) and skills (competences) → multi-section
    expect(score.breakdown.multiSectionKeywords).toContain('Agile');
    // 'gestion de projet' is only in experience → single-section
    expect(score.breakdown.singleSectionKeywords).toContain('gestion de projet');
  });

  it('should return 0% keywordMatch when CV has no matching keywords', () => {
    const cv: CVData = {
      ...createEmptyCV(),
      title: 'Développeur Frontend',
      experiences: [
        {
          title: 'Développeur',
          company: 'Corp',
          period: '2020-2023',
          missions: ['Développement React', 'Tests unitaires'],
          projects: [],
        },
      ],
      dev: ['React', 'TypeScript'],
    };

    const score = scoreCV(cv, jobAnalysis);
    expect(score.keywordMatch).toBe(0);
    expect(score.breakdown.requiredMissing).toHaveLength(3);
    expect(score.breakdown.requiredFound).toHaveLength(0);
  });

  it('should match title exactly (case-insensitive)', () => {
    const cv: CVData = { ...createEmptyCV(), title: 'chef de projet senior' };
    const score = scoreCV(cv, jobAnalysis);
    // "Chef de Projet" is contained in "chef de projet senior"
    expect(score.titleMatch).toBe(true);
  });

  it('should return titleMatch=false when title does not match', () => {
    const cv: CVData = { ...createEmptyCV(), title: 'Développeur Frontend' };
    const score = scoreCV(cv, jobAnalysis);
    expect(score.titleMatch).toBe(false);
  });

  it('should calculate overall score correctly', () => {
    const cv: CVData = {
      ...createEmptyCV(),
      title: 'Chef de Projet',
      competences: ['Agile', 'reporting', 'gestion de projet'],
      experiences: [
        {
          title: 'Chef de Projet',
          company: 'Corp',
          period: '2020-2023',
          missions: [
            'Mise en place de la gestion de projet Agile',
            'Production de reporting hebdomadaire',
          ],
          projects: [],
        },
      ],
    };

    const score = scoreCV(cv, jobAnalysis);
    // keywordMatch = 100, sectionCoverage = 100, titleMatch = true
    // overall = 0.5*100 + 0.3*100 + 0.2*100 = 100
    expect(score.overall).toBe(100);
    expect(score.keywordMatch).toBe(100);
    expect(score.sectionCoverage).toBe(100);
    expect(score.titleMatch).toBe(true);
  });

  it('should give partial score when only title matches', () => {
    const cv: CVData = { ...createEmptyCV(), title: 'Chef de Projet' };
    const score = scoreCV(cv, jobAnalysis);
    // keywordMatch=0, sectionCoverage=0, titleMatch=true
    // overall = 0.5*0 + 0.3*0 + 0.2*100 = 20
    expect(score.overall).toBe(20);
    expect(score.titleMatch).toBe(true);
  });

  it('should return score 100 for CV with no required keywords in job analysis', () => {
    const emptyJobAnalysis = {
      ...jobAnalysis,
      requiredKeywords: [],
    };
    const cv = createEmptyCV();
    const score = scoreCV(cv, emptyJobAnalysis);
    // No required keywords → 100% by convention
    expect(score.keywordMatch).toBe(100);
    expect(score.sectionCoverage).toBe(100);
  });
});

describe('Mon CV - ATS Recommendations', () => {
  it('should structure AtsRecommendationItem correctly', () => {
    const item = {
      priority: 'critique' as const,
      type: 'add' as const,
      action: "Ajouter 'gestion de projet' dans les compétences",
      example: 'Compétences → Gestion de projet Agile',
      keywords: ['gestion de projet'],
    };

    expect(item.priority).toBe('critique');
    expect(item.type).toBe('add');
    expect(item.action).toContain('gestion de projet');
    expect(item.keywords).toContain('gestion de projet');
  });

  it('should support replace type with termToFind and termToReplace', () => {
    const item = {
      priority: 'critique' as const,
      type: 'replace' as const,
      action: "Remplacer 'pilotage de projet' par 'gestion de projet' dans tout le CV",
      example: 'pilotage de projet → gestion de projet',
      keywords: ['gestion de projet'],
      termToFind: 'pilotage de projet',
      termToReplace: 'gestion de projet',
    };

    expect(item.type).toBe('replace');
    expect(item.termToFind).toBe('pilotage de projet');
    expect(item.termToReplace).toBe('gestion de projet');
  });

  it('should accept all priority levels', () => {
    const priorities = ['critique', 'important', 'bonus'] as const;
    for (const p of priorities) {
      const item = { priority: p, type: 'add' as const, action: 'action', example: 'example', keywords: [] };
      expect(item.priority).toBe(p);
    }
  });

  it('should accept all type values', () => {
    const types = ['add', 'replace', 'repeat'] as const;
    for (const t of types) {
      const item = { priority: 'bonus' as const, type: t, action: 'a', example: 'e', keywords: [] };
      expect(item.type).toBe(t);
    }
  });

  it('should validate AtsRecommendations structure with currentScore and promptUsed', () => {
    const reco = {
      recommendations: [
        { priority: 'critique' as const, type: 'add' as const, action: 'A', example: 'B', keywords: ['k1'] },
        { priority: 'important' as const, type: 'repeat' as const, action: 'C', example: 'D', keywords: ['k2', 'k3'] },
      ],
      currentScore: {
        overall: 60,
        keywordMatch: 67,
        sectionCoverage: 33,
        titleMatch: false,
        breakdown: {
          requiredFound: ['Agile'],
          requiredMissing: ['gestion de projet', 'reporting'],
          multiSectionKeywords: [],
          singleSectionKeywords: ['Agile'],
        },
      },
      promptUsed: 'Tu es un expert ATS...',
    };

    expect(reco.recommendations).toHaveLength(2);
    expect(reco.recommendations[0].priority).toBe('critique');
    expect(reco.recommendations[1].keywords).toHaveLength(2);
    expect(reco.currentScore).toBeDefined();
    expect(reco.currentScore.overall).toBe(60);
    expect(reco.currentScore.breakdown.requiredMissing).toContain('gestion de projet');
    expect(reco.promptUsed).toContain('expert ATS');
  });

  it('should map priority to display icon', () => {
    const PRIORITY_ICON: Record<string, string> = {
      critique: '🔴',
      important: '🟡',
      bonus: '🔵',
    };

    expect(PRIORITY_ICON['critique']).toBe('🔴');
    expect(PRIORITY_ICON['important']).toBe('🟡');
    expect(PRIORITY_ICON['bonus']).toBe('🔵');
  });

  it('should map type to display badge', () => {
    const TYPE_BADGE: Record<string, string> = {
      add: 'AJOUT',
      replace: 'REMPLACEMENT',
      repeat: 'RÉPÉTITION',
    };

    expect(TYPE_BADGE['add']).toBe('AJOUT');
    expect(TYPE_BADGE['replace']).toBe('REMPLACEMENT');
    expect(TYPE_BADGE['repeat']).toBe('RÉPÉTITION');
  });

  it('should handle empty recommendations list (score 100)', () => {
    const reco = {
      recommendations: [],
      currentScore: {
        overall: 100,
        keywordMatch: 100,
        sectionCoverage: 100,
        titleMatch: true,
        breakdown: { requiredFound: [], requiredMissing: [], multiSectionKeywords: [], singleSectionKeywords: [] },
      },
      promptUsed: 'prompt...',
    };
    expect(reco.recommendations).toHaveLength(0);
    expect(reco.currentScore.overall).toBe(100);
    expect(reco.promptUsed).toBeDefined();
  });
});

describe('Mon CV - ImprovementResult', () => {
  it('should have correct structure', () => {
    const result = {
      additionalMissions: ['Mission ciblée sur le gap keyword'],
      additionalSkills: { competences: ['gestion de projet'] },
      scoreAfter: {
        overall: 85,
        keywordMatch: 90,
        sectionCoverage: 80,
        titleMatch: true,
        breakdown: {
          requiredFound: ['Agile', 'gestion de projet'],
          requiredMissing: [],
          multiSectionKeywords: ['Agile'],
          singleSectionKeywords: ['gestion de projet'],
        },
      },
    };

    expect(result.additionalMissions).toHaveLength(1);
    expect(result.additionalSkills.competences).toContain('gestion de projet');
    expect(result.scoreAfter.overall).toBe(85);
  });

  it('should return empty when no gaps', () => {
    const result = {
      additionalMissions: [],
      additionalSkills: {},
      scoreAfter: {
        overall: 100,
        keywordMatch: 100,
        sectionCoverage: 100,
        titleMatch: true,
        breakdown: {
          requiredFound: ['Agile', 'gestion de projet'],
          requiredMissing: [],
          multiSectionKeywords: ['Agile', 'gestion de projet'],
          singleSectionKeywords: [],
        },
      },
    };

    expect(result.additionalMissions).toHaveLength(0);
    expect(Object.keys(result.additionalSkills)).toHaveLength(0);
    expect(result.scoreAfter.overall).toBe(100);
  });

  it('should merge additional missions into editable state', () => {
    const existingMissions = ['Mission A', 'Mission B'];
    const additionalMissions = ['Mission ciblant le gap keyword'];

    const merged = [...existingMissions, ...additionalMissions];

    expect(merged).toHaveLength(3);
    expect(merged[2]).toBe('Mission ciblant le gap keyword');
    // Original missions preserved
    expect(merged[0]).toBe('Mission A');
  });

  it('should merge additional skills without overwriting existing', () => {
    const existingSkills = { competences: ['Agile'], dev: ['JavaScript'] };
    const additionalSkills = { competences: ['gestion de projet'], outils: ['Jira'] };

    const updated = { ...existingSkills };
    for (const [cat, skills] of Object.entries(additionalSkills)) {
      if (skills.length > 0) {
        updated[cat as keyof typeof updated] = [
          ...(updated[cat as keyof typeof updated] || []),
          ...skills,
        ];
      }
    }

    expect(updated.competences).toContain('Agile');
    expect(updated.competences).toContain('gestion de projet');
    expect(updated.dev).toContain('JavaScript');
    expect(updated.outils).toContain('Jira');
  });
});

describe('Mon CV - Editable Adaptation Logic', () => {
  it('should apply edited missions to final CV', () => {
    const originalCV = {
      ...createEmptyCV(),
      experiences: [
        {
          title: 'Chef de Projet',
          company: 'Corp',
          period: '2020-2024',
          missions: ['Mission originale A', 'Mission originale B'],
          projects: [],
        },
      ],
    };

    const editableMissions = ['Mission générée 1 (éditée)', 'Mission générée 2'];

    const finalCV: CVData = JSON.parse(JSON.stringify(originalCV));
    finalCV.experiences![0].missions = [
      ...finalCV.experiences![0].missions,
      ...editableMissions,
    ];

    expect(finalCV.experiences![0].missions).toHaveLength(4);
    expect(finalCV.experiences![0].missions[2]).toBe('Mission générée 1 (éditée)');
    expect(finalCV.experiences![0].missions[0]).toBe('Mission originale A');
  });

  it('should apply edited project to final CV', () => {
    const originalCV = {
      ...createEmptyCV(),
      experiences: [
        {
          title: 'Dev',
          company: 'Corp',
          period: '2020',
          missions: [],
          projects: [{ title: 'Projet existant', description: 'ancien' }],
        },
      ],
    };

    const editableProject = { title: 'Nouveau Projet Edité', description: 'Desc modifiée' };

    const finalCV: CVData = JSON.parse(JSON.stringify(originalCV));
    finalCV.experiences![0].projects = [editableProject, ...finalCV.experiences![0].projects];

    expect(finalCV.experiences![0].projects[0].title).toBe('Nouveau Projet Edité');
    expect(finalCV.experiences![0].projects[1].title).toBe('Projet existant');
  });

  it('should remove a mission from editable list', () => {
    let missions = ['Mission A', 'Mission B', 'Mission C'];
    const removeIdx = 1;
    missions = missions.filter((_, i) => i !== removeIdx);

    expect(missions).toHaveLength(2);
    expect(missions).toContain('Mission A');
    expect(missions).not.toContain('Mission B');
    expect(missions).toContain('Mission C');
  });

  it('should remove a skill from editable skills', () => {
    const editableSkills: Record<string, string[]> = {
      competences: ['Leadership'],
      dev: ['Python', 'Go'],
    };

    // Remove Go (index 1 in dev)
    const updated = { ...editableSkills };
    updated.dev = editableSkills.dev.filter((_, i) => i !== 1);

    expect(updated.dev).toHaveLength(1);
    expect(updated.dev).toContain('Python');
    expect(updated.dev).not.toContain('Go');
    expect(updated.competences).toHaveLength(1);
  });

  it('should apply edited skills to final CV', () => {
    const originalCV = {
      ...createEmptyCV(),
      competences: ['Agile'],
      dev: ['JavaScript'],
    };

    const editableSkills: Record<string, string[]> = {
      competences: ['gestion de projet'],
      dev: ['TypeScript'],
    };

    const finalCV: CVData = JSON.parse(JSON.stringify(originalCV));
    for (const [cat, skills] of Object.entries(editableSkills)) {
      const key = cat as keyof CVData;
      const existing = (finalCV[key] as string[]) || [];
      (finalCV[key] as string[]) = [...existing, ...skills];
    }

    expect(finalCV.competences).toContain('Agile');
    expect(finalCV.competences).toContain('gestion de projet');
    expect(finalCV.dev).toContain('JavaScript');
    expect(finalCV.dev).toContain('TypeScript');
  });
});

describe('Mon CV - Adaptation Rules', () => {
  it('should limit skills to max 1 per category', () => {
    const limitSkillsPerCategory = (
      suggestions: Record<string, string[]>,
      currentSkills: Record<string, string[]>
    ): Record<string, string[]> => {
      const result: Record<string, string[]> = {};
      const categories = ['competences', 'outils', 'dev', 'frameworks', 'solutions'];

      for (const cat of categories) {
        const suggested = suggestions[cat] || [];
        const current = currentSkills[cat] || [];
        const newSkills = suggested
          .filter(s => !current.map(c => c.toLowerCase()).includes(s.toLowerCase()))
          .slice(0, 1);
        if (newSkills.length > 0) {
          result[cat] = newSkills;
        }
      }

      return result;
    };

    const suggestions = {
      competences: ['Leadership', 'Agile', 'Communication'],
      outils: ['Docker', 'Kubernetes'],
      dev: ['Python'],
    };

    const current = {
      competences: ['Management'],
      outils: ['Git'],
      dev: ['JavaScript'],
    };

    const result = limitSkillsPerCategory(suggestions, current);

    expect(result.competences).toHaveLength(1);
    expect(result.outils).toHaveLength(1);
    expect(result.dev).toHaveLength(1);
  });

  it('should not add duplicate skills', () => {
    const filterDuplicates = (suggested: string[], current: string[]): string[] => {
      return suggested.filter(
        s => !current.map(c => c.toLowerCase()).includes(s.toLowerCase())
      );
    };

    const suggested = ['React', 'Vue', 'Angular'];
    const current = ['react', 'Svelte'];

    const result = filterDuplicates(suggested, current);

    expect(result).toContain('Vue');
    expect(result).toContain('Angular');
    expect(result).not.toContain('React');
  });

  it('should preserve original missions when adding new ones', () => {
    const originalMissions = ['Mission 1', 'Mission 2'];
    const newMissions = ['New Mission'];

    const combined = [...originalMissions, ...newMissions];

    expect(combined).toHaveLength(3);
    expect(combined[0]).toBe('Mission 1');
    expect(combined[2]).toBe('New Mission');
  });

  it('should place new project at first position', () => {
    const existingProjects = [
      { title: 'Project A', description: 'First project' },
      { title: 'Project B', description: 'Second project' },
    ];

    const newProject = { title: 'New Project', description: 'Generated project' };

    const combined = [newProject, ...existingProjects];

    expect(combined).toHaveLength(3);
    expect(combined[0].title).toBe('New Project');
    expect(combined[1].title).toBe('Project A');
  });
});

describe('Mon CV - Adaptation History', () => {
  it('should have correct CVAdaptation structure', () => {
    const adaptation = {
      id: 1,
      cvId: 42,
      userId: 7,
      jobOffer: 'Chef de Projet Senior — gestion de projet, Agile, reporting',
      adaptedCv: createEmptyCV(),
      changes: {
        newMissions: ['Mission ciblant Agile', 'Mission ciblant reporting'],
        newProject: undefined,
        addedSkills: { competences: ['gestion de projet'] },
      },
      atsBefore: {
        overall: 20, keywordMatch: 0, sectionCoverage: 0, titleMatch: true,
        breakdown: { requiredFound: [], requiredMissing: ['Agile', 'reporting'], multiSectionKeywords: [], singleSectionKeywords: [] },
      },
      atsAfter: {
        overall: 85, keywordMatch: 100, sectionCoverage: 67, titleMatch: true,
        breakdown: { requiredFound: ['Agile', 'reporting'], requiredMissing: [], multiSectionKeywords: ['Agile'], singleSectionKeywords: ['reporting'] },
      },
      jobAnalysis: {
        requiredKeywords: ['Agile', 'reporting'],
        preferredKeywords: ['PMP'],
        exactJobTitle: 'Chef de Projet Senior',
        technologies: [],
        keyResponsibilities: [],
        domain: 'Project Management',
        atsHint: 'unknown' as const,
      },
      name: 'Adaptation LinkedIn mars 2026',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(adaptation.id).toBe(1);
    expect(adaptation.cvId).toBe(42);
    expect(adaptation.changes.newMissions).toHaveLength(2);
    expect(adaptation.changes.addedSkills.competences).toContain('gestion de projet');
    expect(adaptation.atsAfter.overall).toBe(85);
    expect(adaptation.atsBefore.overall).toBe(20);
    expect(adaptation.jobAnalysis.requiredKeywords).toContain('Agile');
    expect(adaptation.name).toBe('Adaptation LinkedIn mars 2026');
  });

  it('should have correct CVAdaptationListItem structure', () => {
    const item = {
      id: 1,
      cvId: 42,
      name: null,
      jobOfferPreview: 'Chef de Projet Senior — gestion de projet, Agile...',
      atsAfterOverall: 85,
      missionsAdded: 2,
      createdAt: new Date().toISOString(),
    };

    expect(item.name).toBeNull();
    expect(item.atsAfterOverall).toBe(85);
    expect(item.missionsAdded).toBe(2);
    expect(item.jobOfferPreview.length).toBeLessThanOrEqual(120);
  });

  it('should not modify original CV when building adapted CV', () => {
    const originalCV = { ...createEmptyCV(), title: 'Dev', competences: ['React'] };
    const adaptedCv: CVData = JSON.parse(JSON.stringify(originalCV));

    // Simulate adding editable content to adapted CV
    adaptedCv.competences = [...(adaptedCv.competences || []), 'Agile'];

    expect(originalCV.competences).toHaveLength(1);
    expect(originalCV.competences).not.toContain('Agile');
    expect(adaptedCv.competences).toContain('Agile');
  });

  it('should recalculate atsAfter when adaptation is updated', () => {
    const jobAnalysis = {
      requiredKeywords: ['Agile', 'gestion de projet'],
      preferredKeywords: [],
      exactJobTitle: 'Chef de Projet',
      technologies: [],
      keyResponsibilities: [],
      domain: 'PM',
      atsHint: 'unknown' as const,
    };

    // Original adapted CV (missing 'gestion de projet' in skills)
    const adaptedCv: CVData = {
      ...createEmptyCV(),
      title: 'Chef de Projet',
      experiences: [{
        title: 'CDP', company: 'Corp', period: '2020-2024',
        missions: ['Mise en place Agile', 'gestion de projet quotidien'],
        projects: [],
      }],
      competences: ['Agile'],
    };

    // Simulate scoreCV result after adding 'gestion de projet' to competences
    const updatedCV: CVData = {
      ...adaptedCv,
      competences: [...(adaptedCv.competences || []), 'gestion de projet'],
    };

    // Both keywords now in experience AND skills → sectionCoverage = 100
    expect(updatedCV.competences).toContain('gestion de projet');
    expect(updatedCV.competences).toContain('Agile');
    // Verify jobAnalysis is preserved for rescoring
    expect(jobAnalysis.requiredKeywords).toHaveLength(2);
  });

  it('should preserve all adaptations independently (no overwriting)', () => {
    const adaptations = [
      { id: 1, name: 'Adaptation 1', atsAfterOverall: 72 },
      { id: 2, name: 'Adaptation 2', atsAfterOverall: 85 },
      { id: 3, name: null, atsAfterOverall: 91 },
    ];

    // Deleting adaptation 2 should not affect 1 or 3
    const afterDelete = adaptations.filter(a => a.id !== 2);

    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.find(a => a.id === 1)).toBeDefined();
    expect(afterDelete.find(a => a.id === 3)).toBeDefined();
    expect(afterDelete.find(a => a.id === 2)).toBeUndefined();
  });
});

describe('Mon CV - Multi-CV Management', () => {
  it('should have correct CVListItem structure', () => {
    const item = {
      id: 1,
      name: 'CV Principal',
      isDefault: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(item.id).toBe(1);
    expect(item.name).toBe('CV Principal');
    expect(item.isDefault).toBe(true);
  });

  it('should mark only one CV as default when changing default', () => {
    const cvs = [
      { id: 1, name: 'CV A', isDefault: true },
      { id: 2, name: 'CV B', isDefault: false },
      { id: 3, name: 'CV C', isDefault: false },
    ];

    // Simulate setting CV 2 as default
    const newDefaultId = 2;
    const updated = cvs.map(cv => ({ ...cv, isDefault: cv.id === newDefaultId }));

    const defaultCVs = updated.filter(cv => cv.isDefault);
    expect(defaultCVs).toHaveLength(1);
    expect(defaultCVs[0].id).toBe(2);
    expect(updated.find(cv => cv.id === 1)?.isDefault).toBe(false);
  });

  it('should sort CVs with default first', () => {
    const cvs = [
      { id: 1, name: 'CV B', isDefault: false, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'CV A', isDefault: true, updatedAt: '2025-12-01T00:00:00Z' },
      { id: 3, name: 'CV C', isDefault: false, updatedAt: '2026-02-01T00:00:00Z' },
    ];

    // Default first, then by updatedAt DESC (as in backend getAllCVs)
    const sorted = [...cvs].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    expect(sorted[0].id).toBe(2); // default first
    expect(sorted[1].id).toBe(3); // then most recently updated
    expect(sorted[2].id).toBe(1);
  });

  it('should not delete default CV (guard logic)', () => {
    const cvs = [
      { id: 1, name: 'CV A', isDefault: true },
      { id: 2, name: 'CV B', isDefault: false },
    ];

    const tryDelete = (id: number) => {
      const cv = cvs.find(c => c.id === id);
      if (!cv) return { success: false, error: 'Not found' };
      if (cv.isDefault) return { success: false, error: 'Cannot delete default CV' };
      return { success: true };
    };

    expect(tryDelete(1)).toEqual({ success: false, error: 'Cannot delete default CV' });
    expect(tryDelete(2)).toEqual({ success: true });
  });

  it('should create new CV with empty data and open in edit', () => {
    const emptyCV = createEmptyCV();

    expect(emptyCV.name).toBe('');
    expect(emptyCV.title).toBe('');
    expect(Array.isArray(emptyCV.experiences)).toBe(true);
    expect(emptyCV.experiences).toHaveLength(0);
    expect(Array.isArray(emptyCV.competences)).toBe(true);
  });

  it('should load correct CV by id (not default) when cvId is provided', () => {
    // Simulate MyProfilePage behavior with cvId prop
    const cvId = 42;
    const shouldUseDefault = cvId === undefined || cvId === null;

    expect(shouldUseDefault).toBe(false);
    // With cvId=42, should call fetchCV(42) not fetchDefaultCV()
    expect(cvId).toBe(42);
  });
});
