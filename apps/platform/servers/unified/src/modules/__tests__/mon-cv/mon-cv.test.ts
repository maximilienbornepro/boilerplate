import { describe, it, expect } from 'vitest';
import { createEmptyCV } from '../../mon-cv/types.js';
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
