// Streaming variant of analyzeTranscriptionAndRoute — streams the narrated
// <journal>…</journal> to the client while the AI is thinking, then emits the
// fully-validated `AnalysisResult` (summary + subjects with review/section
// routing resolved against the caller's reviews).

import type { Response } from 'express';
import { getAnthropicClient } from '../connectors/aiProvider.js';
import { loadSkill } from '../aiSkills/skillLoader.js';
import { logAnalysis } from '../aiSkills/analysisLogsService.js';
import { ensureSkillVersion } from '../aiSkills/skillVersionService.js';
import { computeCostUsd } from '../aiSkills/pricing.js';
import { logAnthropicUsage } from '../connectors/aiProvider.js';
import { JournalStreamer, extractResultJson } from './journalStreamer.js';
import type {
  ReviewWithSections,
  AnalysisResult,
  AnalyzedSubject,
  ReviewAction,
  SectionAction,
  SubjectAction,
} from './transcriptionRoutingService.js';

const SKILL_SLUG = 'suivitess-route-source-to-review';

type StreamEvent =
  | { type: 'journal-delta'; text: string }
  | { type: 'journal-complete' }
  | { type: 'result'; result: AnalysisResult; availableReviews: unknown[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

function sendEvent(res: Response, event: StreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('terminé') || s.includes('termine') || s.includes('done')) return '🟢 terminé';
  if (s.includes('en cours') || s.includes('progress')) return '🟡 en cours';
  if (s.includes('bloqué') || s.includes('bloque') || s.includes('block')) return '🟣 bloqué';
  return '🔴 à faire';
}

export interface StreamRoutingParams {
  userId: number;
  userEmail?: string | null;
  transcript: string;
  reviews: ReviewWithSections[];
  callMeta: { title: string; date?: string | null; provider: string };
}

export async function streamRouting(res: Response, params: StreamRoutingParams): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const startedAt = Date.now();
  let fullPrompt = '';
  let fullText = '';
  let errorMsg: string | null = null;
  let subjectsForLog: AnalyzedSubject[] = [];
  let skillVersionHash = '';
  let usedModel = '';
  let finalInputTokens = 0;
  let finalOutputTokens = 0;

  try {
    if (!params.transcript.trim()) {
      sendEvent(res, { type: 'result', result: { summary: 'Transcription vide.', subjects: [] }, availableReviews: [] });
      sendEvent(res, { type: 'done' });
      return;
    }

    const skill = await loadSkill(SKILL_SLUG);
    const versionInfo = await ensureSkillVersion(SKILL_SLUG, skill, null);
    skillVersionHash = versionInfo.hash;
    const { client, model } = await getAnthropicClient(params.userId);
    usedModel = model;

    const reviewsJson = params.reviews.map(r => ({
      id: r.id,
      title: r.title,
      description: (r.description ?? '').slice(0, 200),
      sections: r.sections.map(s => ({
        id: s.id,
        name: s.name,
        subjects: s.subjects.slice(0, 20).map(sub => ({
          id: sub.id,
          title: sub.title,
          status: sub.status,
          responsibility: sub.responsibility,
          situationExcerpt: sub.situationExcerpt.slice(0, 200),
        })),
      })),
    }));

    const prompt = `${skill}

---

# Contexte exécutable (généré automatiquement)

# Mode streaming activé

## Transcription sélectionnée
- Source : **${params.callMeta.provider}**
- Titre : ${params.callMeta.title}
- Date : ${params.callMeta.date ?? 'inconnue'}

## Reviews SuiviTess existantes (JSON — avec sections + sujets échantillons)
${JSON.stringify(reviewsJson, null, 2)}

## Contenu de la transcription (tronqué à 30 000 caractères)
\`\`\`
${params.transcript.slice(0, 30000)}
\`\`\`

Applique les règles ci-dessus. Produis d'abord un <journal>…</journal> narré,
puis un <result>…</result> contenant l'objet JSON { "summary", "subjects" }.`;
    fullPrompt = prompt;

    const streamer = new JournalStreamer();
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        fullText += chunk;
        streamer.feed(
          chunk,
          text => sendEvent(res, { type: 'journal-delta', text }),
          () => sendEvent(res, { type: 'journal-complete' }),
        );
      } else {
        const anyEvent = event as { type: string; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } };
        if (anyEvent.type === 'message_start' && anyEvent.message?.usage) {
          finalInputTokens = anyEvent.message.usage.input_tokens ?? 0;
        } else if (anyEvent.type === 'message_delta' && anyEvent.usage) {
          finalOutputTokens = anyEvent.usage.output_tokens ?? 0;
        }
      }
    }
    if (finalInputTokens > 0 || finalOutputTokens > 0) {
      logAnthropicUsage(params.userId, usedModel, { input_tokens: finalInputTokens, output_tokens: finalOutputTokens }, `aiSkills:${SKILL_SLUG}`);
    }

    // ── Resolve the final subjects against the caller's reviews (same
    // validation pipeline as analyzeTranscriptionAndRoute — duplicated here
    // so we avoid changing the existing service's signature). ──
    const raw = extractResultJson(fullText) as { summary?: string; subjects?: unknown[] } | null;
    const reviewsById = new Map(params.reviews.map(r => [r.id, r]));
    const sectionsByReview = new Map(params.reviews.map(r => [r.id, new Set(r.sections.map(s => s.id))]));
    const subjectsBySection = new Map<string, Set<string>>();
    for (const r of params.reviews) {
      for (const s of r.sections) subjectsBySection.set(s.id, new Set(s.subjects.map(x => x.id)));
    }

    const subjects: AnalyzedSubject[] = [];
    for (const rawSubj of ((raw?.subjects ?? []) as Array<Record<string, unknown>>)) {
      const title = String(rawSubj.title || '').slice(0, 100).trim();
      if (!title) continue;
      const situation = String(rawSubj.situation || '').slice(0, 500);
      const status = normalizeStatus(String(rawSubj.status || ''));
      const responsibilityRaw = rawSubj.responsibility;
      const responsibility = typeof responsibilityRaw === 'string' && responsibilityRaw.trim().length > 0
        ? responsibilityRaw.slice(0, 80)
        : null;

      let action: ReviewAction = rawSubj.action === 'new-review' ? 'new-review' : 'existing-review';
      let reviewId: string | null = null;
      let suggestedNewReviewTitle: string | null = null;
      if (action === 'existing-review') {
        const candidate = String(rawSubj.reviewId || '');
        if (reviewsById.has(candidate)) reviewId = candidate;
        else {
          action = 'new-review';
          suggestedNewReviewTitle = String(rawSubj.suggestedNewReviewTitle || '').slice(0, 80) || params.callMeta.title.slice(0, 80) || 'Nouvelle review';
        }
      } else {
        suggestedNewReviewTitle = String(rawSubj.suggestedNewReviewTitle || '').slice(0, 80) || params.callMeta.title.slice(0, 80) || 'Nouvelle review';
      }

      let sectionAction: SectionAction = rawSubj.sectionAction === 'new-section' ? 'new-section' : 'existing-section';
      let sectionId: string | null = null;
      let suggestedNewSectionName: string | null = null;
      if (action === 'new-review') {
        sectionAction = 'new-section';
        suggestedNewSectionName = String(rawSubj.suggestedNewSectionName || '').slice(0, 80) || params.callMeta.title.slice(0, 80) || 'Nouveau point';
      } else if (sectionAction === 'existing-section') {
        const candidate = String(rawSubj.sectionId || '');
        if (reviewId && sectionsByReview.get(reviewId)?.has(candidate)) sectionId = candidate;
        else {
          sectionAction = 'new-section';
          suggestedNewSectionName = String(rawSubj.suggestedNewSectionName || '').slice(0, 80) || params.callMeta.title.slice(0, 80) || 'Nouveau point';
        }
      } else {
        suggestedNewSectionName = String(rawSubj.suggestedNewSectionName || '').slice(0, 80) || params.callMeta.title.slice(0, 80) || 'Nouveau point';
      }

      let subjectAction: SubjectAction = rawSubj.subjectAction === 'update-existing-subject' ? 'update-existing-subject' : 'new-subject';
      let targetSubjectId: string | null = null;
      let updatedSituation: string | null = null;
      let updatedStatus: string | null = null;
      let updatedResponsibility: string | null = null;
      const canUpdate = action === 'existing-review' && sectionAction === 'existing-section' && !!sectionId && subjectsBySection.get(sectionId)?.size;
      if (subjectAction === 'update-existing-subject') {
        const cand = String(rawSubj.targetSubjectId || '');
        if (!canUpdate || !sectionId || !subjectsBySection.get(sectionId)?.has(cand)) {
          subjectAction = 'new-subject';
        } else {
          targetSubjectId = cand;
          updatedSituation = String(rawSubj.updatedSituation || situation || '').slice(0, 500);
          const rs = rawSubj.updatedStatus;
          updatedStatus = typeof rs === 'string' && rs.trim().length > 0 ? normalizeStatus(rs) : null;
          const rr = rawSubj.updatedResponsibility;
          updatedResponsibility = typeof rr === 'string' && rr.trim().length > 0 ? rr.slice(0, 80) : null;
        }
      }

      const confRaw = String(rawSubj.confidence || 'medium').toLowerCase();
      const confidence: 'high' | 'medium' | 'low' =
        confRaw === 'high' || confRaw === 'low' ? confRaw : 'medium';

      subjects.push({
        title, situation, status, responsibility,
        action, reviewId, suggestedNewReviewTitle,
        sectionAction, sectionId, suggestedNewSectionName,
        subjectAction, targetSubjectId, updatedSituation, updatedStatus, updatedResponsibility,
        confidence,
        reasoning: String(rawSubj.reasoning || '').slice(0, 300),
      });
      if (subjects.length >= 15) break;
    }

    const result: AnalysisResult = {
      summary: typeof raw?.summary === 'string' ? raw.summary.slice(0, 500) : `${subjects.length} sujet(s) extrait(s).`,
      subjects,
    };
    subjectsForLog = subjects;

    const availableReviews = params.reviews.map(r => ({
      id: r.id,
      title: r.title,
      sections: r.sections.map(s => ({
        id: s.id, name: s.name,
        subjects: s.subjects.map(sub => ({ id: sub.id, title: sub.title, status: sub.status, situation: sub.situation ?? null })),
      })),
    }));

    sendEvent(res, { type: 'result', result, availableReviews });
    sendEvent(res, { type: 'done' });
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
    sendEvent(res, { type: 'error', message: errorMsg });
  } finally {
    res.end();
    const inputTokens = finalInputTokens;
    const outputTokens = finalOutputTokens;
    await logAnalysis({
      userId: params.userId,
      userEmail: params.userEmail ?? null,
      skillSlug: SKILL_SLUG,
      sourceKind: params.callMeta.provider || 'transcript',
      sourceTitle: params.callMeta.title,
      documentId: null,
      inputContent: params.transcript,
      fullPrompt,
      aiOutputRaw: fullText,
      proposals: subjectsForLog,
      durationMs: Date.now() - startedAt,
      error: errorMsg,
      skillVersionHash: skillVersionHash || null,
      provider: 'anthropic',
      model: usedModel || null,
      inputTokens,
      outputTokens,
      costUsd: computeCostUsd(usedModel, inputTokens, outputTokens),
    });
  }
}
