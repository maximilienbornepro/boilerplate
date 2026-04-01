import Anthropic from '@anthropic-ai/sdk';
import type { CVData } from '../types.js';
import { scoreCV } from '../adaptService.js';
import type { CVMap, MatchAnalysis, TermReplacement, OptimizationResult } from './types.js';

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Step 3: Optimize content by applying term replacements.
 * 1 LLM call: grammatically correct term replacement.
 */
export async function optimizeContent(
  cvData: CVData,
  cvMap: CVMap,
  matchAnalysis: MatchAnalysis
): Promise<OptimizationResult> {
  const { synonyms, jobAnalysis, gaps } = matchAnalysis;

  // If no synonyms to replace, skip LLM call
  if (synonyms.length === 0) {
    const scoreAfter = scoreCV(cvData, jobAnalysis);
    return {
      replacements: [],
      scoreAfter,
      remainingGaps: gaps,
    };
  }

  // Build replacement instructions for LLM
  const replacementTasks = synonyms.map(syn => {
    const element = cvMap.elements.find(el => syn.elementIds.includes(el.id));
    return {
      elementId: syn.elementIds[0],
      section: element?.section || 'mission',
      fullText: element?.text || '',
      cvTerm: syn.cvTerm,
      offerTerm: syn.offerTerm,
      confidence: syn.confidence,
    };
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a CV editor. For each text below, replace the CV term with the job offer term while maintaining PERFECT grammar (gender agreements, articles, prepositions).

RULES:
- Replace ONLY the specified term, keep the rest of the sentence IDENTICAL
- Adjust articles and agreements if needed (e.g., "le pilotage" -> "la gestion")
- If the replacement would break the sentence grammatically, adjust minimally
- Do NOT add, remove, or restructure anything else
- The CV language is: ${cvMap.language === 'fr' ? 'French' : 'English'}

Replacements to make:
${replacementTasks.map((t, i) => `
${i + 1}. Element [${t.elementId}]
   Full text: "${t.fullText}"
   Replace: "${t.cvTerm}" -> "${t.offerTerm}"
`).join('')}

${jobAnalysis.exactJobTitle && cvData.title && !cvData.title.toLowerCase().includes(jobAnalysis.exactJobTitle.toLowerCase()) ? `
Also propose a title change:
Current title: "${cvData.title}"
Job offer title: "${jobAnalysis.exactJobTitle}"
Propose a new CV title that includes the exact job title from the offer.
` : ''}

Return ONLY valid JSON:
{
  "replacements": [
    {
      "elementId": "exp-0-mission-2",
      "originalText": "full original text",
      "replacedText": "full text with replacement applied",
      "cvTerm": "old term",
      "offerTerm": "new term"
    }
  ],
  "titleChange": {
    "original": "current title",
    "proposed": "new title with exact job title",
    "reason": "brief explanation"
  }
}

If no title change needed, set titleChange to null.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { replacements: [], scoreAfter: scoreCV(cvData, jobAnalysis), remainingGaps: gaps };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Build replacements with section info and confidence from synonym detection
    const replacements: TermReplacement[] = (parsed.replacements || []).map((r: any) => {
      const task = replacementTasks.find(t => t.elementId === r.elementId);
      return {
        elementId: r.elementId,
        section: task?.section || 'mission',
        originalText: r.originalText,
        replacedText: r.replacedText,
        cvTerm: r.cvTerm,
        offerTerm: r.offerTerm,
        confidence: task?.confidence || 0.7,
      };
    });

    // Apply replacements to CV and calculate new score
    const optimizedCV = applyReplacements(cvData, replacements, parsed.titleChange);
    const scoreAfter = scoreCV(optimizedCV, jobAnalysis);

    return {
      replacements,
      titleChange: parsed.titleChange || undefined,
      scoreAfter,
      remainingGaps: gaps,
    };
  } catch {
    return { replacements: [], scoreAfter: scoreCV(cvData, jobAnalysis), remainingGaps: gaps };
  }
}

/**
 * Apply term replacements to a deep clone of the CV.
 */
export function applyReplacements(
  cvData: CVData,
  replacements: TermReplacement[],
  titleChange?: { original: string; proposed: string } | null
): CVData {
  const cv: CVData = JSON.parse(JSON.stringify(cvData));

  for (const rep of replacements) {
    // Parse element ID to find the right field
    if (rep.elementId === 'title' && cv.title) {
      cv.title = rep.replacedText;
    } else if (rep.elementId === 'summary' && cv.summary) {
      cv.summary = rep.replacedText;
    } else if (rep.elementId.startsWith('exp-')) {
      const parts = rep.elementId.split('-');
      const expIdx = parseInt(parts[1], 10);
      const type = parts[2]; // 'mission', 'project', 'tech'
      const itemIdx = parseInt(parts[3], 10);

      if (cv.experiences?.[expIdx]) {
        if (type === 'mission' && cv.experiences[expIdx].missions?.[itemIdx] !== undefined) {
          cv.experiences[expIdx].missions[itemIdx] = rep.replacedText;
        } else if (type === 'project' && cv.experiences[expIdx].projects?.[itemIdx]) {
          // Split back title:description if needed
          const colonIdx = rep.replacedText.indexOf(': ');
          if (colonIdx > 0) {
            cv.experiences[expIdx].projects[itemIdx].title = rep.replacedText.substring(0, colonIdx);
            cv.experiences[expIdx].projects[itemIdx].description = rep.replacedText.substring(colonIdx + 2);
          } else {
            cv.experiences[expIdx].projects[itemIdx].title = rep.replacedText;
          }
        }
      }
    } else if (rep.elementId.startsWith('skill-')) {
      const parts = rep.elementId.split('-');
      const cat = parts[1] as keyof CVData;
      const skillIdx = parseInt(parts[2], 10);
      const arr = cv[cat] as string[] | undefined;
      if (arr?.[skillIdx] !== undefined) {
        arr[skillIdx] = rep.replacedText;
      }
    }
  }

  // Apply title change if proposed
  if (titleChange?.proposed && cv.title) {
    cv.title = titleChange.proposed;
  }

  return cv;
}
