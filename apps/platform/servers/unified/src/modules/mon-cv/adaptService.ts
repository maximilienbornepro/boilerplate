import Anthropic from '@anthropic-ai/sdk';
import type { CVData, Experience, Project } from './types.js';

const MODEL = 'claude-sonnet-4-20250514';

// Types for adaptation
export interface AdaptRequest {
  cvData: CVData;
  jobOffer: string;
  customInstructions?: string;
}

export interface AdaptResponse {
  adaptedCV: CVData;
  changes: {
    newMissions: string[];
    newProject?: Project;
    addedSkills: Record<string, string[]>;
  };
}

export interface ModifyRequest {
  cvData: CVData;
  modificationRequest: string;
}

export interface ModifyResponse {
  modifiedCV: CVData;
}

// Job offer analysis result
interface JobAnalysis {
  requiredSkills: string[];
  preferredSkills: string[];
  keyResponsibilities: string[];
  technologies: string[];
  domain: string;
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
 * Analyze job offer to extract requirements
 */
export async function analyzeJobOffer(jobOffer: string): Promise<JobAnalysis> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Analyze this job offer and extract key information. Return ONLY valid JSON.

Job offer:
${jobOffer}

Return JSON with this structure:
{
  "requiredSkills": ["skill1", "skill2"],
  "preferredSkills": ["skill1", "skill2"],
  "keyResponsibilities": ["responsibility1", "responsibility2"],
  "technologies": ["tech1", "tech2"],
  "domain": "brief domain description"
}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse job analysis response');
  }

  return JSON.parse(jsonMatch[0]) as JobAnalysis;
}

/**
 * Generate 1-2 new missions relevant to the job offer
 */
export async function generateMissions(
  currentExperience: Experience,
  jobAnalysis: JobAnalysis,
  customInstructions?: string
): Promise<string[]> {
  const client = getAnthropicClient();

  const prompt = `Based on this job analysis and the current experience, generate 1-2 NEW missions that would be relevant.

Job requirements:
- Required skills: ${jobAnalysis.requiredSkills.join(', ')}
- Technologies: ${jobAnalysis.technologies.join(', ')}
- Key responsibilities: ${jobAnalysis.keyResponsibilities.join(', ')}
- Domain: ${jobAnalysis.domain}

Current experience:
- Title: ${currentExperience.title}
- Company: ${currentExperience.company}
- Current missions: ${currentExperience.missions.join('; ')}

${customInstructions ? `Custom instructions: ${customInstructions}` : ''}

RULES:
- Generate 1-2 new missions ONLY
- Missions should be realistic and match the experience context
- They should address key requirements from the job offer
- Keep the same style/tone as existing missions
- Do NOT repeat existing missions

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
 * Generate 1 new project inspired by side projects
 */
export async function generateProject(
  sideProjects: CVData['sideProjects'],
  jobAnalysis: JobAnalysis,
  customInstructions?: string
): Promise<Project | null> {
  const client = getAnthropicClient();

  const sideProjectsContext = sideProjects?.items
    ?.map(item => `${item.category}: ${item.projects.join(', ')}`)
    .join('\n') || 'No side projects';

  const prompt = `Generate 1 NEW project for a professional experience, inspired by these side projects and tailored to the job requirements.

Side projects for inspiration:
${sideProjectsContext}
Technologies used: ${sideProjects?.technologies?.join(', ') || 'N/A'}

Job requirements:
- Required skills: ${jobAnalysis.requiredSkills.join(', ')}
- Technologies: ${jobAnalysis.technologies.join(', ')}
- Domain: ${jobAnalysis.domain}

${customInstructions ? `Custom instructions: ${customInstructions}` : ''}

RULES:
- Create a professional project (not a personal side project)
- Inspired by the side projects but adapted for corporate context
- Should address job requirements
- Keep it realistic and achievable

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
 * Add relevant skills (max 1 per category)
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

  const prompt = `Based on job requirements, suggest skills to add to each category. Maximum 1 skill per category. Only suggest skills NOT already present.

Job requirements:
- Required skills: ${jobAnalysis.requiredSkills.join(', ')}
- Technologies: ${jobAnalysis.technologies.join(', ')}

Current skills:
- Competences: ${currentSkills.competences?.join(', ') || 'none'}
- Outils: ${currentSkills.outils?.join(', ') || 'none'}
- Dev: ${currentSkills.dev?.join(', ') || 'none'}
- Frameworks: ${currentSkills.frameworks?.join(', ') || 'none'}
- Solutions: ${currentSkills.solutions?.join(', ') || 'none'}

RULES:
- Maximum 1 new skill per category
- ONLY suggest skills NOT already in the list
- Only suggest if truly relevant to job
- Empty array if no relevant skill to add

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
 * Main function: Adapt CV to job offer
 */
export async function adaptCV(request: AdaptRequest): Promise<AdaptResponse> {
  const { cvData, jobOffer, customInstructions } = request;

  // Step 1: Analyze job offer
  const jobAnalysis = await analyzeJobOffer(jobOffer);

  // Step 2: Generate new missions for first experience
  const newMissions: string[] = [];
  let newProject: Project | undefined;
  const adaptedCV: CVData = JSON.parse(JSON.stringify(cvData)); // Deep clone

  if (adaptedCV.experiences && adaptedCV.experiences.length > 0) {
    const firstExp = adaptedCV.experiences[0];

    // Generate missions
    const missions = await generateMissions(firstExp, jobAnalysis, customInstructions);
    newMissions.push(...missions);
    firstExp.missions = [...firstExp.missions, ...missions];

    // Generate project
    const project = await generateProject(cvData.sideProjects, jobAnalysis, customInstructions);
    if (project) {
      newProject = project;
      firstExp.projects = [project, ...firstExp.projects];
    }
  }

  // Step 3: Add relevant skills
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

  // Apply new skills
  for (const [cat, skills] of Object.entries(addedSkills)) {
    const key = cat as keyof CVData;
    const existing = (adaptedCV[key] as string[]) || [];
    (adaptedCV[key] as string[]) = [...existing, ...skills];
  }

  return {
    adaptedCV,
    changes: {
      newMissions,
      newProject,
      addedSkills,
    },
  };
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
