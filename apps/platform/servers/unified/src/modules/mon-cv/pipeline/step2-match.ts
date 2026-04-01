import Anthropic from '@anthropic-ai/sdk';
import type { CVData } from '../types.js';
import type { JobAnalysis, AtsScore } from '../adaptService.js';
import { analyzeJobOffer, scoreCV } from '../adaptService.js';
import type { CVMap, CVElement, MatchAnalysis, SynonymPair } from './types.js';

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Step 2: Analyze matches between CV and job offer.
 * 2 LLM calls: reuse analyzeJobOffer + new synonym detection.
 */
export async function analyzeMatches(
  cvMap: CVMap,
  jobOffer: string,
  cvData: CVData
): Promise<MatchAnalysis> {
  // Step 2a: Analyze job offer (reuse existing)
  const jobAnalysis = await analyzeJobOffer(jobOffer);

  // Step 2b: Algorithmic exact matching
  const exactMatches: string[] = [];
  const unmatchedKeywords: string[] = [];

  for (const keyword of jobAnalysis.requiredKeywords) {
    const kwNorm = keyword.toLowerCase().trim();
    const found = cvMap.elements.some(el => el.normalizedText.includes(kwNorm));
    if (found) {
      exactMatches.push(keyword);
    } else {
      unmatchedKeywords.push(keyword);
    }
  }

  // Step 2c: LLM synonym detection (only for unmatched keywords)
  let synonyms: SynonymPair[] = [];
  if (unmatchedKeywords.length > 0) {
    synonyms = await detectSynonyms(cvMap.elements, unmatchedKeywords, jobAnalysis);
  }

  // Step 2d: Calculate ATS score before
  const scoreBefore = scoreCV(cvData, jobAnalysis);

  // Gaps = keywords that are neither exact match nor synonym
  const synonymOfferTerms = new Set(synonyms.map(s => s.offerTerm.toLowerCase()));
  const gaps = unmatchedKeywords.filter(kw => !synonymOfferTerms.has(kw.toLowerCase()));

  return { jobAnalysis, exactMatches, synonyms, gaps, scoreBefore };
}

/**
 * Detect synonyms between CV elements and unmatched job keywords using LLM.
 */
async function detectSynonyms(
  elements: CVElement[],
  unmatchedKeywords: string[],
  _jobAnalysis: JobAnalysis
): Promise<SynonymPair[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  // Build context: only elements that could contain synonyms
  const relevantElements = elements.filter(el =>
    ['title', 'summary', 'mission', 'project', 'competences', 'outils', 'dev', 'frameworks', 'solutions'].includes(el.section)
  );

  const cvPhrases = relevantElements.map(el => `[${el.id}] ${el.text}`).join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are an ATS expert. Identify SYNONYMS and PARAPHRASES between CV content and job offer keywords.

A synonym means the CV uses a DIFFERENT WORD/PHRASE that means the SAME THING as the job offer keyword.
Example: CV says "pilotage de projet" but offer requires "gestion de projet" → synonym pair.
Example: CV says "React.js" but offer requires "React" → synonym pair.
Example: CV says "agile" and offer requires "agile" → NOT a synonym (exact match).

CV content (with element IDs):
${cvPhrases}

Unmatched job offer keywords (NOT found verbatim in CV):
${unmatchedKeywords.map(k => `- "${k}"`).join('\n')}

For each unmatched keyword, find if ANY CV element contains a synonym/paraphrase.
Only report REAL synonyms with high confidence. Do NOT force matches.

Return ONLY valid JSON:
{
  "synonyms": [
    {
      "cvTerm": "the exact phrase in the CV",
      "offerTerm": "the exact keyword from the offer",
      "elementIds": ["element-id-1", "element-id-2"],
      "confidence": 0.85
    }
  ]
}

If no synonyms found, return: { "synonyms": [] }`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.synonyms || []).filter((s: SynonymPair) =>
      s.confidence >= 0.6 && s.cvTerm && s.offerTerm && s.elementIds?.length > 0
    );
  } catch {
    return [];
  }
}
