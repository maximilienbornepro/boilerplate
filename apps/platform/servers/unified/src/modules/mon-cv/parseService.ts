import mammoth from 'mammoth';
import type { CVData } from './types.js';
import { getAnthropicClient } from '../connectors/aiProvider.js';

// pdf-parse@2.x exports a PDFParse class (not a function like v1.x)
import { PDFParse } from 'pdf-parse';

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text ?? '';
}

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

REGLE ABSOLUE — VERBATIM, AUCUNE REFORMULATION :
- Recopie le texte du CV TEL QUEL, mot pour mot, en preservant la
  ponctuation, la casse, les accents, les majuscules, les chiffres et
  l'ordre exact des phrases.
- N'INVENTE jamais d'information qui n'est pas explicitement dans le
  CV (pas de synonymes, pas de paraphrase, pas de "completion" basee
  sur ce que tu sais du metier ou de l'entreprise).
- NE REFORMULE rien : ni les missions, ni les descriptions, ni les
  intitules de poste, ni les noms de projets. Si une mission dit
  "Pilotage du backlog produit", tu ecris "Pilotage du backlog
  produit", pas "Gestion du backlog" ni "Animation du backlog".
- NE REGROUPE pas plusieurs missions en une seule, NE SPLIT pas une
  mission en deux. Une ligne dans le CV = une entree dans missions.
- NE TRADUIS pas, NE CORRIGE pas l'orthographe. Si le CV contient une
  faute, tu la conserves.

Decoupage (uniquement de la separation, pas de reformulation) :
- IMPORTANT pour les projets : chaque projet distinct doit etre une
  entree separee dans le tableau "projects". Si tu vois plusieurs
  projets listes (separes par des virgules, tirets, ou sur des lignes
  differentes), cree une entree pour CHAQUE projet en recopiant son
  titre et sa description tels quels.
- IMPORTANT pour les missions : chaque mission/responsabilite
  distincte doit etre une entree separee dans le tableau "missions".
  Recopie chaque ligne telle qu'elle apparait dans le CV.

REGLE CRITIQUE — RATTACHEMENT MISSIONS / PROJETS A LA BONNE EXPERIENCE :
- Chaque mission, chaque projet, chaque responsabilite doit etre
  rattache(e) a l'experience (entreprise + poste + periode) sous
  laquelle il/elle apparait visuellement dans le CV. Une mission n'est
  JAMAIS deplacee vers une autre experience.
- Si une experience contient des elements qui pourraient sembler
  appartenir a une autre (ex : un nom de client, un budget, un outil
  cite), tu les laisses dans l'experience d'origine. Ce n'est PAS a
  toi de re-attribuer les blocs.
- En cas de doute (texte ambigu, mise en page complexe), tu reproduis
  fidelement la structure visuelle du document : meme si une
  experience est courte (1 ou 2 missions) ou tres longue (10+),
  l'attribution doit refleter ce que voit le lecteur du CV original.
- VERIFIE avant de renvoyer : la PREMIERE experience listee dans le
  CV doit recevoir SES PROPRES missions/projets, pas ceux de la
  deuxieme.`;

export async function parseCV(buffer: Buffer, type: 'pdf' | 'docx'): Promise<CVData> {
  // For PDFs we ALWAYS use vision-based parsing : `pdf-parse` flattens
  // a multi-column / sidebar layout into raw text, which causes Claude
  // to misattribute missions to the wrong experience block (a real
  // bug observed on a 2-column CV — France.TV missions ended up under
  // the next employer). Vision mode preserves the visual structure
  // and is reliable enough that we no longer try the cheaper text
  // path first.
  if (type === 'pdf') {
    return parseCVWithVision(buffer);
  }

  // DOCX → mammoth gives a clean linear extraction, the text path is
  // safe here.
  const result = await mammoth.extractRawText({ buffer });
  return parseCVWithText(result.value);
}

export async function parseCVWithText(text: string, userId: number = 1): Promise<CVData> {
  try {
    const { client, model } = await getAnthropicClient(userId);
    console.log('[Mon-CV] Calling Anthropic API for CV parsing...');
    const response = await client.messages.create({
      model,
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
export async function parseCVWithVision(buffer: Buffer, userId: number = 1): Promise<CVData> {
  const { client, model } = await getAnthropicClient(userId);
  const base64 = buffer.toString('base64');

  const response = await client.messages.create({
    model,
    // 8k was tight for dense multi-experience CVs (truncation observed
    // mid-array). 16k is safer ; the JSON output stays small relative
    // to a 200k context model.
    max_tokens: 16000,
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
