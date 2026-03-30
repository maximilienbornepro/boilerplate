import Anthropic from '@anthropic-ai/sdk';
import type { CVData, Experience, Project } from './types.js';

const MODEL = 'claude-sonnet-4-20250514';

// Types for adaptation
export interface AdaptRequest {
  cvData: CVData;
  jobOffer: string;
  customInstructions?: string;
}

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

export interface ModifyRequest {
  cvData: CVData;
  modificationRequest: string;
}

export interface ModifyResponse {
  modifiedCV: CVData;
}

// Job offer analysis result (ATS-aware)
export interface JobAnalysis {
  requiredKeywords: string[];   // exact tokens after "requis/indispensable/obligatoire" — weight ×3
  preferredKeywords: string[];  // exact tokens after "souhaité/apprécié/un plus" — weight ×1
  exactJobTitle: string;        // exact job title from offer — maximum weight
  technologies: string[];
  keyResponsibilities: string[];
  domain: string;
  atsHint: 'workday' | 'taleo' | 'sap' | 'unknown';
}

// Initialize Anthropic client
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return new Anthropic({ apiKey });
}

/**
 * Normalize text for ATS token matching (lowercase, trim)
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Check if a keyword appears in a text block (substring, case-insensitive)
 */
function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword || !text) return false;
  return normalizeText(text).includes(normalizeText(keyword));
}

/**
 * Extract all text from the experience section of CV
 * (title, missions, project descriptions, technologies)
 */
function extractExperienceText(cvData: CVData): string {
  const parts: string[] = [];

  if (cvData.title) parts.push(cvData.title);

  for (const exp of cvData.experiences || []) {
    if (exp.title) parts.push(exp.title);
    for (const mission of exp.missions || []) {
      parts.push(mission);
    }
    for (const project of exp.projects || []) {
      if (project.title) parts.push(project.title);
      if (project.description) parts.push(project.description);
    }
    for (const tech of exp.technologies || []) {
      parts.push(tech);
    }
  }

  return parts.join(' ');
}

/**
 * Extract all text from the skills sections of CV
 * (competences, outils, dev, frameworks, solutions)
 */
function extractSkillsText(cvData: CVData): string {
  const parts: string[] = [
    ...(cvData.competences || []),
    ...(cvData.outils || []),
    ...(cvData.dev || []),
    ...(cvData.frameworks || []),
    ...(cvData.solutions || []),
  ];
  return parts.join(' ');
}

/**
 * Calculate ATS score for a CV against a job analysis.
 *
 * Algorithm (de-facto Jobscan model):
 *   overall = 0.5 × keywordMatch + 0.3 × sectionCoverage + 0.2 × (titleMatch ? 100 : 0)
 */
export function scoreCV(cvData: CVData, jobAnalysis: JobAnalysis): AtsScore {
  const { requiredKeywords, exactJobTitle } = jobAnalysis;

  const experienceText = extractExperienceText(cvData);
  const skillsText = extractSkillsText(cvData);
  const cvTitleNorm = normalizeText(cvData.title || '');
  const jobTitleNorm = normalizeText(exactJobTitle || '');

  const requiredFound: string[] = [];
  const requiredMissing: string[] = [];
  const multiSectionKeywords: string[] = [];
  const singleSectionKeywords: string[] = [];

  for (const keyword of requiredKeywords) {
    const inExperience = containsKeyword(experienceText, keyword);
    const inSkills = containsKeyword(skillsText, keyword);

    if (inExperience || inSkills) {
      requiredFound.push(keyword);
      if (inExperience && inSkills) {
        multiSectionKeywords.push(keyword);
      } else {
        singleSectionKeywords.push(keyword);
      }
    } else {
      requiredMissing.push(keyword);
    }
  }

  const total = requiredKeywords.length;
  const keywordMatch = total > 0 ? Math.round((requiredFound.length / total) * 100) : 100;
  const sectionCoverage =
    total > 0 ? Math.round((multiSectionKeywords.length / total) * 100) : 100;

  // Title match: CV title contains job title or is very similar (both directions)
  const titleMatch =
    jobTitleNorm.length > 0 &&
    (cvTitleNorm === jobTitleNorm ||
      cvTitleNorm.includes(jobTitleNorm) ||
      jobTitleNorm.includes(cvTitleNorm));

  const overall = Math.round(
    0.5 * keywordMatch + 0.3 * sectionCoverage + 0.2 * (titleMatch ? 100 : 0)
  );

  return {
    overall,
    keywordMatch,
    sectionCoverage,
    titleMatch,
    breakdown: {
      requiredFound,
      requiredMissing,
      multiSectionKeywords,
      singleSectionKeywords,
    },
  };
}

/**
 * Analyze job offer to extract ATS-relevant requirements (exact tokens, not synonyms)
 */
export async function analyzeJobOffer(jobOffer: string): Promise<JobAnalysis> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are an ATS (Applicant Tracking System) expert. Analyze this job offer and extract key information for ATS optimization. Return ONLY valid JSON.

CRITICAL ATS RULES:
- Extract EXACT tokens/phrases as written in the offer — do NOT paraphrase or use synonyms
- ATS systems do token-exact matching: "gestion de projet" ≠ "pilotage de projet"
- Separate REQUIRED keywords (introduced by: "requis", "indispensable", "obligatoire", "impératif", "must have", "required", "exigé") from PREFERRED keywords (introduced by: "souhaité", "apprécié", "un plus", "idéalement", "nice to have", "preferred", "souhaitable")
- When not explicitly categorized, use context: "minimum X ans d'expérience en Y" → Y is required
- Extract the EXACT job title as written at the top of the offer (heaviest ATS token)
- Detect the ATS platform if explicitly mentioned: "Workday" → "workday", "Taleo" → "taleo", "SAP SuccessFactors" → "sap". If not mentioned → "unknown"

Job offer:
${jobOffer}

Return JSON with this EXACT structure:
{
  "requiredKeywords": ["exact token 1", "exact token 2"],
  "preferredKeywords": ["exact token 1", "exact token 2"],
  "exactJobTitle": "exact job title from the offer",
  "technologies": ["tech1", "tech2"],
  "keyResponsibilities": ["responsibility1", "responsibility2"],
  "domain": "brief domain description",
  "atsHint": "workday"
}

Note: atsHint must be exactly one of: "workday", "taleo", "sap", "unknown"`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse job analysis response');
  }

  return JSON.parse(jsonMatch[0]) as JobAnalysis;
}

/**
 * Generate 1-2 new missions relevant to the job offer (ATS-aware, exact tokens)
 */
export async function generateMissions(
  currentExperience: Experience,
  jobAnalysis: JobAnalysis,
  customInstructions?: string
): Promise<string[]> {
  const client = getAnthropicClient();

  const atsStyleGuide =
    jobAnalysis.atsHint === 'workday'
      ? 'WORKDAY ATS: Extremely literal token matching. Use the exact phrases from the job offer verbatim — no paraphrasing at all.'
      : jobAnalysis.atsHint === 'taleo'
        ? 'TALEO ATS: Moderately flexible. Use exact tokens but minor variations (plurals, conjugations) are tolerated.'
        : jobAnalysis.atsHint === 'sap'
          ? 'SAP SUCCESSFACTORS ATS: Very strict token matching. Copy exact phrases character-for-character — no paraphrasing whatsoever.'
          : 'Standard ATS: Use exact tokens from the job offer. Synonyms are not counted.';

  const prompt = `You are an ATS optimization expert. Generate 1-2 NEW professional missions for a CV that will maximize ATS scoring.

${atsStyleGuide}

CRITICAL ATS RULES:
1. Use EXACT tokens from the job offer — NEVER use synonyms
   Example: if offer says "gestion de projet", write "gestion de projet" — NOT "pilotage de projet"
2. Required keywords MUST appear as PROOF (contextualized actions), NOT as declarations
   ✓ "Mise en place d'un processus de gestion de projet Agile pour une équipe de 8 développeurs"
   ✗ "Compétences en gestion de projet"
3. If a required keyword is already in the skills section, ALSO include it in a mission
   → This passes the ATS 2-section frequency threshold (keyword counted once per section, max)
4. Mission format: action verb + context + measurable result (when possible)
5. Keep the same language as existing missions

Job requirements:
- Exact job title: ${jobAnalysis.exactJobTitle}
- REQUIRED keywords (weight ×3 in ATS): ${jobAnalysis.requiredKeywords.join(', ')}
- Preferred keywords: ${jobAnalysis.preferredKeywords.join(', ')}
- Technologies: ${jobAnalysis.technologies.join(', ')}
- Key responsibilities: ${jobAnalysis.keyResponsibilities.join(', ')}
- Domain: ${jobAnalysis.domain}

Current experience:
- Title: ${currentExperience.title}
- Company: ${currentExperience.company}
- Current missions: ${currentExperience.missions.join('; ')}

${customInstructions ? `Custom instructions: ${customInstructions}` : ''}

RULES:
- Generate 1-2 NEW missions ONLY
- Missions must be realistic and plausible in the context of this experience
- Do NOT repeat existing missions
- Required keywords MUST appear verbatim in at least one mission

Return ONLY a JSON array of strings, no explanations:
["Mission 1", "Mission 2"]`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  return JSON.parse(jsonMatch[0]) as string[];
}

/**
 * Generate 1 new project inspired by side projects (ATS-aware)
 */
export async function generateProject(
  sideProjects: CVData['sideProjects'],
  jobAnalysis: JobAnalysis,
  customInstructions?: string
): Promise<Project | null> {
  const client = getAnthropicClient();

  const sideProjectsContext =
    sideProjects?.items?.map(item => `${item.category}: ${item.projects.join(', ')}`).join('\n') ||
    'No side projects';

  const prompt = `Generate 1 NEW project for a professional CV, inspired by these side projects and optimized for ATS scoring.

CRITICAL ATS RULES:
- Use exact tokens from the job offer (required keywords verbatim in the description)
- Project description should contextualize required keywords as achievements

Job requirements:
- Exact job title: ${jobAnalysis.exactJobTitle}
- Required keywords (use verbatim): ${jobAnalysis.requiredKeywords.join(', ')}
- Technologies: ${jobAnalysis.technologies.join(', ')}
- Domain: ${jobAnalysis.domain}

Side projects for inspiration:
${sideProjectsContext}
Technologies used: ${sideProjects?.technologies?.join(', ') || 'N/A'}

${customInstructions ? `Custom instructions: ${customInstructions}` : ''}

RULES:
- Create a professional project (not a personal side project)
- Incorporate required keywords verbatim in the description
- Must be realistic and achievable
- Keep the same language as the job offer

Return ONLY valid JSON:
{
  "title": "Project title",
  "description": "Brief description of the project and impact"
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  return JSON.parse(jsonMatch[0]) as Project;
}

/**
 * Add relevant skills (max 1 per category), ATS-aware — prioritizes required keywords
 */
export async function addRelevantSkills(
  currentSkills: {
    competences?: string[];
    outils?: string[];
    dev?: string[];
    frameworks?: string[];
    solutions?: string[];
  },
  jobAnalysis: JobAnalysis
): Promise<Record<string, string[]>> {
  const client = getAnthropicClient();

  const prompt = `You are an ATS expert. Suggest skills to add to each CV category to maximize ATS scoring. Maximum 1 skill per category. Only suggest skills NOT already present.

CRITICAL ATS RULES:
1. PRIORITIZE adding required keywords that are missing from ALL sections (experience + skills)
2. Use EXACT tokens from the job offer — no paraphrasing, no synonyms
3. If a required keyword fits a category, add it with the EXACT wording from the offer
4. Required keywords get weight ×3 in ATS — prioritize them over preferred ones

Job requirements:
- Exact job title: "${jobAnalysis.exactJobTitle}"
- REQUIRED keywords (weight ×3): ${jobAnalysis.requiredKeywords.join(', ')}
- Preferred keywords: ${jobAnalysis.preferredKeywords.join(', ')}
- Technologies: ${jobAnalysis.technologies.join(', ')}

Current skills:
- Competences: ${currentSkills.competences?.join(', ') || 'none'}
- Outils: ${currentSkills.outils?.join(', ') || 'none'}
- Dev: ${currentSkills.dev?.join(', ') || 'none'}
- Frameworks: ${currentSkills.frameworks?.join(', ') || 'none'}
- Solutions: ${currentSkills.solutions?.join(', ') || 'none'}

RULES:
- Maximum 1 new skill per category
- ONLY suggest skills NOT already in the list (exact or near-exact match check)
- Use EXACT tokens from the job offer
- Prioritize required keywords over preferred keywords
- Empty array if no relevant skill to add for that category

Return ONLY valid JSON:
{
  "competences": [],
  "outils": [],
  "dev": [],
  "frameworks": [],
  "solutions": []
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {};
  }

  const suggestions = JSON.parse(jsonMatch[0]) as Record<string, string[]>;

  // Validate: max 1 per category, not already present
  const result: Record<string, string[]> = {};
  const categories = ['competences', 'outils', 'dev', 'frameworks', 'solutions'] as const;

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
}

/**
 * Main function: Adapt CV to job offer (ATS-aware, with before/after ATS scoring)
 */
export async function adaptCV(request: AdaptRequest): Promise<AdaptResponse> {
  const { cvData, jobOffer, customInstructions } = request;

  // Step 1: Analyze job offer (ATS-aware — exact tokens, required vs preferred)
  const jobAnalysis = await analyzeJobOffer(jobOffer);

  // Step 2: Calculate ATS score BEFORE adaptation
  const scoreBefore = scoreCV(cvData, jobAnalysis);

  // Step 3: Generate new missions for first experience
  const newMissions: string[] = [];
  let newProject: Project | undefined;
  const adaptedCV: CVData = JSON.parse(JSON.stringify(cvData)); // Deep clone

  if (adaptedCV.experiences && adaptedCV.experiences.length > 0) {
    const firstExp = adaptedCV.experiences[0];

    // Generate ATS-optimized missions
    const missions = await generateMissions(firstExp, jobAnalysis, customInstructions);
    newMissions.push(...missions);
    firstExp.missions = [...firstExp.missions, ...missions];

    // Generate ATS-optimized project
    const project = await generateProject(cvData.sideProjects, jobAnalysis, customInstructions);
    if (project) {
      newProject = project;
      firstExp.projects = [project, ...firstExp.projects];
    }
  }

  // Step 4: Add relevant skills (prioritizing required keywords)
  const addedSkills = await addRelevantSkills(
    {
      competences: cvData.competences,
      outils: cvData.outils,
      dev: cvData.dev,
      frameworks: cvData.frameworks,
      solutions: cvData.solutions,
    },
    jobAnalysis
  );

  // Apply new skills to adapted CV
  for (const [cat, skills] of Object.entries(addedSkills)) {
    const key = cat as keyof CVData;
    const existing = (adaptedCV[key] as string[]) || [];
    (adaptedCV[key] as string[]) = [...existing, ...skills];
  }

  // Step 5: Calculate ATS score AFTER adaptation
  const scoreAfter = scoreCV(adaptedCV, jobAnalysis);

  return {
    adaptedCV,
    changes: {
      newMissions,
      newProject,
      addedSkills,
    },
    atsScore: {
      before: scoreBefore,
      after: scoreAfter,
    },
    jobAnalysis,
  };
}

// Improvement result (applying recommendations to existing adapted CV)
export interface ImprovementResult {
  additionalMissions: string[];               // new missions targeting gap keywords
  additionalSkills: Record<string, string[]>; // new skills for gap keywords
  titleChange?: string;                       // new CV title if job title mismatch detected
  termReplacements: Array<{ find: string; replaceWith: string }>; // synonym → exact token substitutions
  scoreAfter: AtsScore;                       // recalculated score after applying all improvements
}

// ATS recommendation types
export interface AtsRecommendationItem {
  priority: 'critique' | 'important' | 'bonus';
  type: 'add' | 'replace' | 'repeat';
  action: string;
  example: string;
  keywords: string[];
  termToFind?: string;
  termToReplace?: string;
}

export interface AtsRecommendations {
  recommendations: AtsRecommendationItem[];
  currentScore: AtsScore;
  promptUsed: string;
}

/**
 * Apply targeted improvements to an already-adapted CV.
 * Focuses ONLY on the remaining ATS gaps (missing keywords, single-section keywords).
 * Does NOT duplicate existing missions or skills.
 */
export async function applyImprovements(
  cvData: CVData,
  jobOffer: string
): Promise<ImprovementResult> {
  const client = getAnthropicClient();

  // Step 1: analyze job offer (reuse existing function)
  const jobAnalysis = await analyzeJobOffer(jobOffer);

  // Step 2: score current (already adapted) CV to find remaining gaps
  const score = scoreCV(cvData, jobAnalysis);
  const { breakdown } = score;

  // Extract current experience and skills text to avoid duplication
  const existingMissions =
    cvData.experiences?.flatMap(e => e.missions || []).join('\n') || '';
  const existingSkills = [
    ...(cvData.competences || []),
    ...(cvData.outils || []),
    ...(cvData.dev || []),
    ...(cvData.frameworks || []),
    ...(cvData.solutions || []),
  ].join(', ');

  const firstExpTitle = cvData.experiences?.[0]?.title || '';
  const firstExpCompany = cvData.experiences?.[0]?.company || '';
  const titleMismatch = !score.titleMatch;

  // If already optimal (no gaps and title matches), return empty result
  if (
    breakdown.requiredMissing.length === 0 &&
    breakdown.singleSectionKeywords.length === 0 &&
    !titleMismatch
  ) {
    return { additionalMissions: [], additionalSkills: {}, termReplacements: [], scoreAfter: score };
  }

  const prompt = `Tu es un expert en optimisation ATS. Le CV a déjà été partiellement adapté à une offre d'emploi. Génère du contenu ADDITIONNEL ciblé pour combler les gaps ATS restants et corriger le titre si nécessaire.

═══ GAPS ACTUELS ═══
Mots-clés requis MANQUANTS (rejet automatique ATS) : ${breakdown.requiredMissing.join(', ') || 'aucun'}
Mots-clés en 1 seule section (besoin 2-section frequency) : ${breakdown.singleSectionKeywords.join(', ') || 'aucun'}
Écart de titre : ${titleMismatch ? `OUI — titre CV : "${cvData.title}" / titre exact de l'offre : "${jobAnalysis.exactJobTitle}"` : 'NON — titre correspond'}

═══ CONTENU EXISTANT (NE PAS RÉPÉTER) ═══
Titre CV actuel : ${cvData.title || '(non renseigné)'}
Missions existantes :
${existingMissions.substring(0, 800) || '(aucune)'}
Compétences existantes : ${existingSkills || '(aucune)'}

═══ CONTEXTE ═══
Rôle actuel : ${firstExpTitle} chez ${firstExpCompany}
Titre exact de l'offre : ${jobAnalysis.exactJobTitle}
Domaine : ${jobAnalysis.domain}
Mots-clés requis : ${jobAnalysis.requiredKeywords.join(', ')}

═══ RÈGLES CRITIQUES ═══
1. additionalMissions : 0 à 2 NOUVELLES missions UNIQUEMENT pour les gap keywords — utilise le TOKEN EXACT du gap verbatim
2. NE JAMAIS répéter ou paraphraser les missions existantes
3. Les missions doivent être réalistes dans le contexte de "${firstExpTitle}" chez "${firstExpCompany}"
4. Pour les mots-clés en 1 seule section (déjà dans skills) → écrire une mission qui prouve la compétence (pas juste la déclarer)
5. additionalSkills : UNIQUEMENT les mots-clés manquants dans la section skills — tokens exacts du gap
6. Maximum 1 skill par catégorie
7. Garder la même langue que les missions existantes
8. titleChange : si l'écart de titre est OUI → retourner le titre exact de l'offre ; si NON → retourner null
9. termReplacements : scanner les missions existantes ci-dessus pour trouver des synonymes/paraphrases des mots-clés requis et recommander leurs remplacements exacts dans tout le CV

Retourne UNIQUEMENT du JSON valide :
{
  "additionalMissions": ["mission ciblant le gap keyword 1"],
  "additionalSkills": {
    "competences": [],
    "outils": [],
    "dev": [],
    "frameworks": [],
    "solutions": []
  },
  "titleChange": null,
  "termReplacements": [
    { "find": "pilotage de projet", "replaceWith": "gestion de projet" }
  ]
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { additionalMissions: [], additionalSkills: {}, termReplacements: [], scoreAfter: score };
  }

  const raw = JSON.parse(jsonMatch[0]) as {
    additionalMissions: string[];
    additionalSkills: Record<string, string[]>;
    titleChange: string | null;
    termReplacements: Array<{ find: string; replaceWith: string }>;
  };

  const termReplacements = Array.isArray(raw.termReplacements) ? raw.termReplacements : [];

  // Build the improved CV to calculate the new score
  const improvedCV: CVData = JSON.parse(JSON.stringify(cvData));

  // Apply title change
  if (raw.titleChange) {
    improvedCV.title = raw.titleChange;
  }

  // Apply term replacements to all missions across all experiences
  if (termReplacements.length > 0) {
    for (const exp of improvedCV.experiences || []) {
      exp.missions = exp.missions.map(m => {
        let updated = m;
        for (const { find, replaceWith } of termReplacements) {
          updated = updated.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceWith);
        }
        return updated;
      });
    }
  }

  if (improvedCV.experiences && improvedCV.experiences.length > 0) {
    improvedCV.experiences[0].missions = [
      ...improvedCV.experiences[0].missions,
      ...(raw.additionalMissions || []),
    ];
  }

  const categories = ['competences', 'outils', 'dev', 'frameworks', 'solutions'] as const;
  const filteredSkills: Record<string, string[]> = {};
  for (const cat of categories) {
    const suggested = raw.additionalSkills?.[cat] || [];
    const current = (cvData[cat] as string[]) || [];
    const newSkills = suggested
      .filter(s => !current.map(c => c.toLowerCase()).includes(s.toLowerCase()))
      .slice(0, 1);
    if (newSkills.length > 0) {
      filteredSkills[cat] = newSkills;
      const key = cat as keyof CVData;
      const existing = (improvedCV[key] as string[]) || [];
      (improvedCV[key] as string[]) = [...existing, ...newSkills];
    }
  }

  const scoreAfter = scoreCV(improvedCV, jobAnalysis);

  return {
    additionalMissions: raw.additionalMissions || [],
    additionalSkills: filteredSkills,
    titleChange: raw.titleChange || undefined,
    termReplacements,
    scoreAfter,
  };
}

/**
 * Generate ATS improvement recommendations for a CV against a job offer.
 * Reuses analyzeJobOffer + scoreCV (no generation), then asks Claude for
 * 3-5 specific, actionable recommendations.
 */
export async function recommendImprovements(
  cvData: CVData,
  jobOffer: string
): Promise<AtsRecommendations> {
  const client = getAnthropicClient();

  // Step 1: analyze job offer (reuse existing function)
  const jobAnalysis = await analyzeJobOffer(jobOffer);

  // Step 2: score current CV
  const score = scoreCV(cvData, jobAnalysis);
  const { breakdown } = score;
  const total = breakdown.requiredFound.length + breakdown.requiredMissing.length;

  // Extract full CV text for synonym detection across the entire document
  const currentMissionsText = (cvData.experiences || [])
    .flatMap(e => [
      e.title,
      ...(e.missions || []),
      ...(e.projects || []).map(p => `${p.title} ${p.description || ''}`),
      ...(e.technologies || []),
    ])
    .filter(Boolean)
    .join('\n');

  const currentSkillsText = [
    ...(cvData.competences || []),
    ...(cvData.outils || []),
    ...(cvData.dev || []),
    ...(cvData.frameworks || []),
    ...(cvData.solutions || []),
  ].join(', ');

  const prompt = `Tu es un expert en optimisation ATS (Applicant Tracking System). Analyse ce CV par rapport à l'offre d'emploi et génère 3-5 recommandations SPÉCIFIQUES et ACTIONNABLES.

Tu peux recommander TROIS types d'actions :
- TYPE "add"     → Ajouter un mot-clé complètement absent dans une section
- TYPE "replace" → Remplacer un synonyme/paraphrase existant par le TOKEN EXACT de l'offre dans TOUT le CV
- TYPE "repeat"  → Répéter un mot-clé déjà présent dans une section vers une 2ème section

⚠️  REPLACE EST L'ACTION LA PLUS IMPORTANTE :
Les ATS font du matching token-exact. "pilotage de projet" et "gestion de projet" sont DIFFÉRENTS pour un ATS.
Si le CV contient une paraphrase d'un mot-clé requis → recommande TOUJOURS de le remplacer dans TOUT le CV.

═══ ANALYSE ATS ACTUELLE ═══
Score global : ${score.overall}/100
- Correspondance mots-clés : ${score.keywordMatch}% (${breakdown.requiredFound.length}/${total} mots-clés requis trouvés)
- Couverture sections : ${score.sectionCoverage}% (mots-clés présents dans expériences ET compétences)
- Correspondance titre : ${score.titleMatch ? `✓ correspond ("${cvData.title}")` : `✗ écart — CV : "${cvData.title}" / Offre : "${jobAnalysis.exactJobTitle}"`}

Mots-clés requis MANQUANTS (rejet automatique ATS) : ${breakdown.requiredMissing.join(', ') || 'aucun'}
Mots-clés en 1 seule section (besoin 2-section frequency) : ${breakdown.singleSectionKeywords.join(', ') || 'aucun'}
Mots-clés préférés (bonus) : ${jobAnalysis.preferredKeywords.slice(0, 5).join(', ') || 'aucun'}

═══ CONTENU COMPLET DU CV (scanner pour détecter les synonymes à remplacer) ═══
Titre CV : ${cvData.title || '(non renseigné)'}
Résumé : ${(cvData.summary || '(non renseigné)').substring(0, 400)}
Missions & projets :
${currentMissionsText.substring(0, 1500) || '(aucune mission)'}
Compétences : ${currentSkillsText || '(aucune compétence)'}

═══ MOTS-CLÉS REQUIS PAR L'OFFRE ═══
${jobAnalysis.requiredKeywords.join(', ') || '(aucun)'}

═══ RÈGLES DE GÉNÉRATION ═══
Priorité "critique" = mots-clés requis manquants → action "add" ou "replace"
Priorité "important" = mot-clé dans 1 seule section → action "repeat" (ou "replace" si synonyme détecté dans le CV)
Priorité "bonus"    = écart de titre, mots-clés préférés, style

Pour type "replace" :
  • Scanne TOUT le contenu CV ci-dessus pour trouver des synonymes/paraphrases des mots-clés requis
  • termToFind    : le terme EXACT tel qu'il apparaît dans le CV (copie mot-pour-mot)
  • termToReplace : le token EXACT de l'offre d'emploi (copie mot-pour-mot)
  • action        : préciser dans quelle(s) section(s) effectuer le remplacement

Pour type "add" :
  • Préciser la section cible et le texte exact à ajouter

Pour type "repeat" :
  • Indiquer le mot-clé à répéter et la section cible (ex: "ajouter dans les compétences, déjà dans les missions")

Si le score est déjà 100, retourner 1 recommandation bonus sur le style ou la formulation.

Retourne UNIQUEMENT du JSON valide :
{
  "recommendations": [
    {
      "priority": "critique",
      "type": "replace",
      "action": "Remplacer 'pilotage de projet' par 'gestion de projet' dans toutes les missions et le titre",
      "example": "pilotage de projet → gestion de projet",
      "keywords": ["gestion de projet"],
      "termToFind": "pilotage de projet",
      "termToReplace": "gestion de projet"
    },
    {
      "priority": "critique",
      "type": "add",
      "action": "Ajouter 'reporting' dans les compétences",
      "example": "Compétences → reporting",
      "keywords": ["reporting"]
    },
    {
      "priority": "important",
      "type": "repeat",
      "action": "Répéter 'agile' dans une mission (déjà présent dans les compétences)",
      "example": "Mission → '...en méthodologie agile...'",
      "keywords": ["agile"]
    }
  ]
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed: { recommendations: AtsRecommendationItem[] } = jsonMatch
    ? (JSON.parse(jsonMatch[0]) as { recommendations: AtsRecommendationItem[] })
    : { recommendations: [] };

  return { ...parsed, currentScore: score, promptUsed: prompt };
}

/**
 * Modify CV with custom request
 */
export async function modifyCV(request: ModifyRequest): Promise<ModifyResponse> {
  const { cvData, modificationRequest } = request;
  const client = getAnthropicClient();

  const prompt = `Modify this CV according to the user's request. Return the COMPLETE modified CV as JSON.

Current CV:
${JSON.stringify(cvData, null, 2)}

Modification request:
${modificationRequest}

RULES:
- Apply the modification as requested
- Keep all other fields unchanged
- Return the COMPLETE CV structure
- Return ONLY valid JSON, no explanations

Return the modified CV JSON:`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse modification response');
  }

  const modifiedCV = JSON.parse(jsonMatch[0]) as CVData;

  return { modifiedCV };
}
