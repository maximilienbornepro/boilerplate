import type { CVData } from '../types.js';
import type { JobAnalysis, AtsScore } from '../adaptService.js';

export interface CVElement {
  id: string;                    // "exp-0-mission-2", "skill-dev-3", "title"
  section: CVSection;
  text: string;
  normalizedText: string;        // lowercase trimmed
  parentContext?: string;        // "Senior Dev at Acme" for missions
  experienceIndex?: number;      // which experience this belongs to
}

export type CVSection =
  | 'title' | 'summary'
  | 'mission' | 'project' | 'technology'
  | 'competences' | 'outils' | 'dev' | 'frameworks' | 'solutions'
  | 'formation';

export interface CVMap {
  elements: CVElement[];
  language: 'fr' | 'en';
  experienceCount: number;
  totalMissions: number;
  totalSkills: number;
}

export interface SynonymPair {
  cvTerm: string;
  offerTerm: string;
  elementIds: string[];
  confidence: number;
}

export interface MatchAnalysis {
  jobAnalysis: JobAnalysis;
  exactMatches: string[];        // keywords found verbatim
  synonyms: SynonymPair[];
  gaps: string[];                // keywords with no match
  scoreBefore: AtsScore;
}

export interface TermReplacement {
  elementId: string;
  section: CVSection;
  originalText: string;
  replacedText: string;
  cvTerm: string;
  offerTerm: string;
  confidence: number;
}

export interface OptimizationResult {
  replacements: TermReplacement[];
  titleChange?: { original: string; proposed: string; reason: string };
  scoreAfter: AtsScore;
  remainingGaps: string[];
}

export interface PipelineStepStatus {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'error';
  durationMs?: number;
  error?: string;
}

export interface PipelineResult {
  cvMap: CVMap;
  matchAnalysis: MatchAnalysis;
  optimization: OptimizationResult;
  adaptedCV: CVData;
  steps: PipelineStepStatus[];
  totalDurationMs: number;
}
