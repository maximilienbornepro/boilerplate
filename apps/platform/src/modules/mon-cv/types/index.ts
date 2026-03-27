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
