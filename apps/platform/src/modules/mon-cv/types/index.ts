// Screenshot for projects
export interface Screenshot {
  image: string; // base64
  caption?: string;
}

// Project within an experience
export interface Project {
  title: string;
  description?: string;
  screenshots?: Screenshot[];
}

// Professional experience
export interface Experience {
  title: string;
  company: string;
  period: string;
  location?: string;
  description?: string;
  missions: string[];
  projects: Project[];
  clients?: string[];
  technologies?: string[];
  logo?: string; // base64 or logo ID reference
}

// Education/Formation
export interface Formation {
  title: string;
  school: string;
  period: string;
  location?: string;
}

// Award/Distinction
export interface Award {
  type: string;
  year: string;
  title: string;
  location?: string;
}

// Side project item (category of projects)
export interface SideProjectItem {
  category: string;
  projects: string[];
}

// Side projects section
export interface SideProjects {
  title?: string;
  description?: string;
  items: SideProjectItem[];
  technologies?: string[];
}

// Contact information
export interface Contact {
  address?: string;
  city?: string;
  email?: string;
  phone?: string;
}

// Complete CV data model
export interface CVData {
  // Basic info
  name?: string;
  title?: string;
  summary?: string;
  profilePhoto?: string; // base64

  // Contact
  contact?: Contact;

  // Skills by category
  languages?: string[];
  competences?: string[];
  outils?: string[];
  dev?: string[];
  frameworks?: string[];
  solutions?: string[];

  // Professional content
  experiences?: Experience[];
  formations?: Formation[];
  awards?: Award[];
  sideProjects?: SideProjects;
}

// CV record
export interface CV {
  id: number;
  userId: number;
  name: string;
  cvData: CVData;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// CV list item (without full data)
export interface CVListItem {
  id: number;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Logo record
export interface CVLogo {
  id: number;
  companyName: string;
  mimeType: string;
  createdAt: string;
}

// Import preview diff item
export interface DiffItem {
  section: string;
  hasChanges: boolean;
  isNew: boolean;
}

// Import preview result
export interface ImportPreviewResult {
  parsed: CVData;
  diff: DiffItem[];
}

// Processed image result
export interface ProcessedImage {
  image: string;
  mimeType: string;
  width: number;
  height: number;
}

// ============ Adaptation Types ============

// Job offer analysis (extracted by AI, cached for client-side scoring)
export interface JobAnalysis {
  requiredKeywords: string[];
  preferredKeywords: string[];
  exactJobTitle: string;
  technologies: string[];
  keyResponsibilities: string[];
  domain: string;
  atsHint: 'workday' | 'taleo' | 'sap' | 'unknown';
}

// ATS score breakdown (de-facto Jobscan model)
export interface AtsScore {
  overall: number;          // 0-100, weighted final score
  keywordMatch: number;     // % required keywords found anywhere in CV
  sectionCoverage: number;  // % required keywords found in 2+ distinct sections
  titleMatch: boolean;      // CV title matches exact job title (token-exact)
  breakdown: {
    requiredFound: string[];
    requiredMissing: string[];
    multiSectionKeywords: string[];  // present in experience AND skills
    singleSectionKeywords: string[]; // present in only one section
  };
}

// Request to adapt CV to job offer
export interface AdaptRequest {
  cvData: CVData;
  jobOffer: string;
  customInstructions?: string;
}

// Response from CV adaptation
export interface AdaptResponse {
  adaptedCV: CVData;
  changes: {
    newMissions: string[];
    newProject?: Project;
    addedSkills: Record<string, string[]>;
  };
  atsScore: {
    before: AtsScore;
    after: AtsScore;
  };
  jobAnalysis: JobAnalysis;
}

// Improvement result (second-pass targeted generation)
export interface ImprovementResult {
  additionalMissions: string[];
  additionalSkills: Record<string, string[]>;
  titleChange?: string;                                           // nouveau titre si écart avec l'offre
  termReplacements: Array<{ find: string; replaceWith: string }>; // synonymes → tokens exacts
  scoreAfter: AtsScore;
}

// ATS recommendation item
export interface AtsRecommendationItem {
  priority: 'critique' | 'important' | 'bonus';
  type: 'add' | 'replace' | 'repeat';  // add=ajouter, replace=remplacer synonyme, repeat=répéter 2ème section
  action: string;         // ex: "Remplacer 'pilotage de projet' par 'gestion de projet' dans tout le CV"
  example: string;        // ex: "pilotage de projet → gestion de projet"
  keywords: string[];     // mots-clés couverts par cette recommandation
  termToFind?: string;    // pour type="replace" : terme exact à trouver dans le CV
  termToReplace?: string; // pour type="replace" : token exact de l'offre à substituer
}

// ATS recommendations response
export interface AtsRecommendations {
  recommendations: AtsRecommendationItem[];
  currentScore: AtsScore;  // score computed at time of analysis (reflects current CV state)
  promptUsed: string;      // prompt exact envoyé à Claude (affiché dans l'UI pour transparence)
}

// ============ Adaptation History Types ============

// Full adaptation record (for detail view)
export interface CVAdaptation {
  id: number;
  cvId: number;
  userId: number;
  jobOffer: string;
  adaptedCv: CVData;
  changes: {
    newMissions: string[];
    newProject?: Project;
    addedSkills: Record<string, string[]>;
  };
  atsBefore: AtsScore;
  atsAfter: AtsScore;
  jobAnalysis: JobAnalysis;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

// Lightweight adaptation record (for list view)
export interface CVAdaptationListItem {
  id: number;
  cvId: number;
  name: string | null;
  jobOfferPreview: string;
  atsAfterOverall: number;
  missionsAdded: number;
  createdAt: string;
}

// Request to modify adapted CV
export interface ModifyRequest {
  cvData: CVData;
  modificationRequest: string;
}

// Response from CV modification
export interface ModifyResponse {
  modifiedCV: CVData;
}

// Empty CV template
export function createEmptyCV(): CVData {
  return {
    name: '',
    title: '',
    summary: '',
    profilePhoto: '',
    contact: {
      address: '',
      city: '',
      email: '',
      phone: '',
    },
    languages: [],
    competences: [],
    outils: [],
    dev: [],
    frameworks: [],
    solutions: [],
    experiences: [],
    formations: [],
    awards: [],
    sideProjects: {
      title: '',
      description: '',
      items: [],
      technologies: [],
    },
  };
}
