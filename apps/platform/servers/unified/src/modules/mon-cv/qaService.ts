// Q&A grounded answer generation for a CV adaptation.
//
// Single-shot call : (adaptedCv + jobOffer + jobAnalysis + question)
// → answer in 1st person, based ONLY on the CV adapted content. The
// answer is logged through runSkill() so it shows up in /ai-logs.

import { runSkill } from '../aiSkills/runSkill.js';
import type { CVData } from './types.js';
import type { JobAnalysis } from './adaptService.js';

export interface AnswerQuestionInput {
  jobOffer: string;
  adaptedCv: CVData;
  jobAnalysis: JobAnalysis;
  question: string;
}

export async function generateAnswer(
  input: AnswerQuestionInput,
  userId: number,
  userEmail: string | null = null,
): Promise<{ answer: string; logId: number | null }> {
  // Prompt context — keep the JSON small (~30k chars max for a
  // dense CV) so we stay well under the model window.
  const json = JSON.stringify(input, null, 2);
  const clipped = json.length > 60000 ? json.slice(0, 60000) : json;

  const run = await runSkill({
    slug: 'mon-cv-answer-question',
    userId,
    userEmail,
    buildContext: () => `## Contexte\n\n\`\`\`json\n${clipped}\n\`\`\`\n\nRenvoie UNIQUEMENT un objet JSON \`{ "answer": "…" }\`. Aucun markdown, aucun préambule.`,
    inputContent: clipped,
    sourceKind: 'cv',
    sourceTitle: `Q&A : ${input.question.slice(0, 60)}${input.question.length > 60 ? '…' : ''}`,
    // Answer is multi-paragraph but bounded — 2k tokens is enough
    // for 5 dense paragraphs.
    maxTokens: 2000,
  });

  const parsed = parseJsonObject<{ answer?: string }>(run.outputText);
  const answer = (parsed?.answer ?? '').trim();
  if (!answer) {
    // The model occasionally drops the JSON wrapper and emits the
    // raw text — accept that as a fallback.
    const fallback = run.outputText.trim();
    if (fallback) return { answer: fallback, logId: run.logId };
    throw new Error(
      `[mon-cv answer-question] Skill returned empty/unparseable output (logId=${run.logId}). Raw (first 1k):\n${run.outputText.slice(0, 1000)}`,
    );
  }
  return { answer, logId: run.logId };
}

function parseJsonObject<T>(raw: string): T | null {
  const candidates: string[] = [];
  candidates.push(raw.trim());
  candidates.push(stripMarkdownFences(raw));
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c) as T; } catch { /* try next */ }
  }
  return null;
}

function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  return s;
}

/** A small helper for the route layer : merge the freshly-generated
 *  answer into the existing questions array, identified by id. */
export function applyAnswerToQuestions<T extends { id: string; question: string; answer: string; generatedAt?: string; aiLogId?: number | null }>(
  questions: T[],
  questionId: string,
  answer: string,
  aiLogId: number | null,
): T[] {
  return questions.map(q =>
    q.id === questionId
      ? { ...q, answer, generatedAt: new Date().toISOString(), aiLogId }
      : q,
  );
}
