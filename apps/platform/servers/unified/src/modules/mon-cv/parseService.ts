import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import type { CVData } from './types.js';

// Dynamic import for pdf-parse (CommonJS module)
let pdfParse: any;
async function getPdfParse() {
  if (!pdfParse) {
    pdfParse = (await import('pdf-parse')).default;
  }
  return pdfParse;
}

// Check API key at module load
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[Mon-CV] WARNING: ANTHROPIC_API_KEY not set - CV parsing will fail');
}

const anthropic = new Anthropic();

const CV_PARSE_PROMPT = `Analyse ce CV et extrait les informations dans le format JSON suivant.
Retourne UNIQUEMENT le JSON, sans markdown ni explication.

{
  "name": "Nom complet",
  "title": "Titre professionnel",
  "summary": "Resume professionnel",
  "contact": {
    "address": "Adresse",
    "city": "Ville",
    "email": "Email",
    "phone": "Telephone"
  },
  "languages": ["Francais", "Anglais"],
  "competences": ["Competence 1", "Competence 2"],
  "outils": ["Outil 1", "Outil 2"],
  "dev": ["JavaScript", "Python"],
  "frameworks": ["React", "Node.js"],
  "solutions": ["AWS", "Docker"],
  "experiences": [
    {
      "title": "Titre du poste",
      "company": "Entreprise",
      "period": "2020 - Present",
      "location": "Paris",
      "description": "Description du poste",
      "missions": ["Mission 1", "Mission 2"],
      "projects": [
        {
          "title": "Nom du projet",
          "description": "Description du projet"
        }
      ],
      "clients": ["Client 1"],
      "technologies": ["Tech 1", "Tech 2"]
    }
  ],
  "formations": [
    {
      "title": "Diplome",
      "school": "Ecole",
      "period": "2015 - 2020",
      "location": "Paris"
    }
  ],
  "awards": [
    {
      "type": "Type",
      "year": "2023",
      "title": "Titre",
      "location": "Lieu"
    }
  ],
  "sideProjects": {
    "title": "Projets personnels",
    "description": "Description",
    "items": [
      {
        "category": "Open Source",
        "projects": ["Projet 1", "Projet 2"]
      }
    ],
    "technologies": ["Tech 1"]
  }
}

Regles:
- Extrait uniquement les informations presentes dans le CV
- Laisse les champs vides si l'information n'est pas disponible
- Pour les tableaux vides, utilise []
- Assure-toi que le JSON est valide
- IMPORTANT pour les projets: chaque projet distinct doit etre une entree separee dans le tableau "projects". Si tu vois plusieurs projets listes (separes par des virgules, tirets, ou sur des lignes differentes), cree une entree pour CHAQUE projet avec son titre et sa description.
- IMPORTANT pour les missions: chaque mission/responsabilite distincte doit etre une entree separee dans le tableau "missions".`;

export async function parseCV(buffer: Buffer, type: 'pdf' | 'docx'): Promise<CVData> {
  let text: string;

  if (type === 'pdf') {
    const pdf = await getPdfParse();
    const data = await pdf(buffer);
    text = data.text;

    // If very little text extracted, it might be a scanned PDF - use vision parsing
    if (text.trim().length < 100) {
      return parseCVWithVision(buffer);
    }
  } else {
    // DOCX
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  }

  return parseCVWithText(text);
}

export async function parseCVWithText(text: string): Promise<CVData> {
  try {
    console.log('[Mon-CV] Calling Anthropic API for CV parsing...');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${CV_PARSE_PROMPT}\n\nContenu du CV:\n${text}`,
        },
      ],
    });
    console.log('[Mon-CV] API response received');

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Reponse inattendue de l\'IA');
    }

    // Try to parse the JSON response
    let jsonText = content.text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.slice(7);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.slice(0, -3);
    }

    const parsed = JSON.parse(jsonText.trim());
    return validateAndCleanCVData(parsed);
  } catch (err: any) {
    console.error('[Mon-CV] CV parsing failed:', err.message);
    if (err.status) {
      console.error('[Mon-CV] API status:', err.status);
    }
    throw new Error('Impossible d\'analyser le CV');
  }
}

// Vision-based PDF parsing for scanned PDFs using Claude's document type
async function parseCVWithVision(buffer: Buffer): Promise<CVData> {
  const base64 = buffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf' as const,
              data: base64,
            },
          },
          {
            type: 'text',
            text: CV_PARSE_PROMPT,
          },
        ],
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Reponse inattendue de l\'IA');
  }

  try {
    let jsonText = content.text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.slice(7);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.slice(0, -3);
    }

    const parsed = JSON.parse(jsonText.trim());
    return validateAndCleanCVData(parsed);
  } catch (err) {
    console.error('[Mon-CV] Failed to parse AI vision response:', content.text);
    throw new Error('Impossible d\'analyser le CV');
  }
}

function validateAndCleanCVData(data: any): CVData {
  return {
    name: data.name || '',
    title: data.title || '',
    summary: data.summary || '',
    profilePhoto: data.profilePhoto || '',
    contact: {
      address: data.contact?.address || '',
      city: data.contact?.city || '',
      email: data.contact?.email || '',
      phone: data.contact?.phone || '',
    },
    languages: Array.isArray(data.languages) ? data.languages : [],
    competences: Array.isArray(data.competences) ? data.competences : [],
    outils: Array.isArray(data.outils) ? data.outils : [],
    dev: Array.isArray(data.dev) ? data.dev : [],
    frameworks: Array.isArray(data.frameworks) ? data.frameworks : [],
    solutions: Array.isArray(data.solutions) ? data.solutions : [],
    experiences: Array.isArray(data.experiences) ? data.experiences.map((exp: any) => ({
      title: exp.title || '',
      company: exp.company || '',
      period: exp.period || '',
      location: exp.location || '',
      description: exp.description || '',
      missions: Array.isArray(exp.missions) ? exp.missions : [],
      projects: Array.isArray(exp.projects) ? exp.projects.map((p: any) => ({
        title: p.title || '',
        description: p.description || '',
        screenshots: Array.isArray(p.screenshots) ? p.screenshots : [],
      })) : [],
      clients: Array.isArray(exp.clients) ? exp.clients : [],
      technologies: Array.isArray(exp.technologies) ? exp.technologies : [],
      logo: exp.logo || '',
    })) : [],
    formations: Array.isArray(data.formations) ? data.formations.map((f: any) => ({
      title: f.title || '',
      school: f.school || '',
      period: f.period || '',
      location: f.location || '',
    })) : [],
    awards: Array.isArray(data.awards) ? data.awards.map((a: any) => ({
      type: a.type || '',
      year: a.year || '',
      title: a.title || '',
      location: a.location || '',
    })) : [],
    sideProjects: data.sideProjects ? {
      title: data.sideProjects.title || '',
      description: data.sideProjects.description || '',
      items: Array.isArray(data.sideProjects.items) ? data.sideProjects.items.map((i: any) => ({
        category: i.category || '',
        projects: Array.isArray(i.projects) ? i.projects : [],
      })) : [],
      technologies: Array.isArray(data.sideProjects.technologies) ? data.sideProjects.technologies : [],
    } : {
      title: '',
      description: '',
      items: [],
      technologies: [],
    },
  };
}
