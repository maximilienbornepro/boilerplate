// SuiviTess — AI analysis of a single transcription.
// Extracts subjects from the transcript (same idea as the per-document
// TranscriptionWizard) and adds ONE extra step : for each subject, decide
// which existing review (or which new review) should host it, and inside
// that review which section should receive it.
//
// Rules live in transcription-routing-skill.md and are reloaded from disk
// on every call so edits take effect without a redeploy.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getAnthropicClient } from '../connectors/aiProvider.js';

const SKILL_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'transcription-routing-skill.md');
})();

async function loadSkill(): Promise<string> {
  try {
    return await readFile(SKILL_PATH, 'utf-8');
  } catch {
    return 'Tu es un assistant d\'archivage. Réponds en JSON strict.';
  }
}

// ============ Types ============

export type ReviewAction = 'existing-review' | 'new-review';
export type SectionAction = 'existing-section' | 'new-section';

export interface ReviewWithSections {
  id: string;
  title: string;
  description: string | null;
  sections: Array<{
    id: string;
    name: string;
    /** Up to 5 recent subject titles, to help the AI match by theme. */
    sampleSubjectTitles: string[];
  }>;
}

export interface AnalyzedSubject {
  title: string;
  situation: string;
  status: string;
  responsibility: string | null;
  action: ReviewAction;
  reviewId: string | null;
  suggestedNewReviewTitle: string | null;
  sectionAction: SectionAction;
  sectionId: string | null;
  suggestedNewSectionName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface AnalysisResult {
  summary: string;
  subjects: AnalyzedSubject[];
}

// ============ Entry point ============

export async function analyzeTranscriptionAndRoute(
  userId: number,
  transcript: string,
  reviews: ReviewWithSections[],
  callMeta: { title: string; date?: string | null; provider: string },
): Promise<AnalysisResult> {
  if (!transcript.trim()) {
    return { summary: 'Transcription vide.', subjects: [] };
  }

  const skill = await loadSkill();
  const { client, model } = await getAnthropicClient(userId);

  const reviewsJson = reviews.map(r => ({
    id: r.id,
    title: r.title,
    description: (r.description ?? '').slice(0, 200),
    sections: r.sections.map(s => ({
      id: s.id,
      name: s.name,
      sampleSubjects: s.sampleSubjectTitles.slice(0, 5),
    })),
  }));

  const prompt = `${skill}

---

# Contexte exécutable (généré automatiquement)

## Transcription sélectionnée
- Source : **${callMeta.provider}**
- Titre : ${callMeta.title}
- Date : ${callMeta.date ?? 'inconnue'}

## Reviews SuiviTess existantes (JSON — avec sections + sujets échantillons)
${JSON.stringify(reviewsJson, null, 2)}

## Contenu de la transcription (tronqué à 30 000 caractères)
\`\`\`
${transcript.slice(0, 30000)}
\`\`\`

Applique les règles ci-dessus et réponds uniquement en JSON.`;

  const aiResponse = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = aiResponse.content.find(b => b.type === 'text')?.type === 'text'
    ? (aiResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string }).text
    : '';

  let parsed: { summary?: string; subjects?: unknown[] } = {};
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* fallthrough */
  }

  const reviewsById = new Map(reviews.map(r => [r.id, r]));
  const sectionsByReview = new Map(reviews.map(r => [r.id, new Set(r.sections.map(s => s.id))]));
  const subjects: AnalyzedSubject[] = [];

  for (const raw of (parsed.subjects || []) as Array<Record<string, unknown>>) {
    const title = String(raw.title || '').slice(0, 100).trim();
    if (!title) continue;

    const situation = String(raw.situation || '').slice(0, 500);
    const status = normalizeStatus(String(raw.status || ''));
    const responsibilityRaw = raw.responsibility;
    const responsibility = typeof responsibilityRaw === 'string' && responsibilityRaw.trim().length > 0
      ? responsibilityRaw.slice(0, 80)
      : null;

    // --- Review routing ---
    let action: ReviewAction = raw.action === 'new-review' ? 'new-review' : 'existing-review';
    let reviewId: string | null = null;
    let suggestedNewReviewTitle: string | null = null;

    if (action === 'existing-review') {
      const candidate = String(raw.reviewId || '');
      if (reviewsById.has(candidate)) {
        reviewId = candidate;
      } else {
        action = 'new-review';
        suggestedNewReviewTitle = String(raw.suggestedNewReviewTitle || '').slice(0, 80)
          || callMeta.title.slice(0, 80)
          || 'Nouvelle review';
      }
    } else {
      suggestedNewReviewTitle = String(raw.suggestedNewReviewTitle || '').slice(0, 80)
        || callMeta.title.slice(0, 80)
        || 'Nouvelle review';
    }

    // --- Section routing ---
    let sectionAction: SectionAction = raw.sectionAction === 'new-section' ? 'new-section' : 'existing-section';
    let sectionId: string | null = null;
    let suggestedNewSectionName: string | null = null;

    if (action === 'new-review') {
      // Can't reference sections of a review that does not exist yet.
      sectionAction = 'new-section';
      suggestedNewSectionName = String(raw.suggestedNewSectionName || '').slice(0, 80)
        || callMeta.title.slice(0, 80)
        || 'Nouveau point';
    } else {
      if (sectionAction === 'existing-section') {
        const candidate = String(raw.sectionId || '');
        if (reviewId && sectionsByReview.get(reviewId)?.has(candidate)) {
          sectionId = candidate;
        } else {
          sectionAction = 'new-section';
          suggestedNewSectionName = String(raw.suggestedNewSectionName || '').slice(0, 80)
            || callMeta.title.slice(0, 80)
            || 'Nouveau point';
        }
      } else {
        suggestedNewSectionName = String(raw.suggestedNewSectionName || '').slice(0, 80)
          || callMeta.title.slice(0, 80)
          || 'Nouveau point';
      }
    }

    const confidenceRaw = String(raw.confidence || 'medium').toLowerCase();
    const confidence: 'high' | 'medium' | 'low' =
      confidenceRaw === 'high' || confidenceRaw === 'low' ? confidenceRaw : 'medium';

    subjects.push({
      title,
      situation,
      status,
      responsibility,
      action,
      reviewId,
      suggestedNewReviewTitle,
      sectionAction,
      sectionId,
      suggestedNewSectionName,
      confidence,
      reasoning: String(raw.reasoning || '').slice(0, 300),
    });

    if (subjects.length >= 15) break;
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : `${subjects.length} sujet(s) extrait(s).`,
    subjects,
  };
}

// ============ Helpers ============

function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('terminé') || s.includes('termine') || s.includes('done')) return '🟢 terminé';
  if (s.includes('en cours') || s.includes('progress')) return '🟡 en cours';
  if (s.includes('bloqué') || s.includes('bloque') || s.includes('block')) return '🟣 bloqué';
  return '🔴 à faire';
}
