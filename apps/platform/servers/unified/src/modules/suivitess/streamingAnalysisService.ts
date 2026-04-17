// Streaming analysis for the "Analyser et fusionner" wizard.
// Streams the `<journal>` portion of the AI response to the client as the
// model writes it, so the user sees — in real time — what's being considered,
// ignored, matched, etc. Once the stream is done we parse `<result>` and
// return the proposals.
//
// Uses the shared editable skill `suivitess-import-source-into-document`
// which includes a "Mode streaming activé" section describing the journal
// format.

import type { Response } from 'express';
import { getAnthropicClient, logAnthropicUsage } from '../connectors/aiProvider.js';
import { loadSkill } from '../aiSkills/skillLoader.js';
import { logAnalysis } from '../aiSkills/analysisLogsService.js';
import { ensureSkillVersion } from '../aiSkills/skillVersionService.js';
import { computeCostUsd } from '../aiSkills/pricing.js';
import { JournalStreamer, extractResultJson } from './journalStreamer.js';
import type { DocumentWithSections } from './dbService.js';

const SKILL_SLUG = 'suivitess-import-source-into-document';

export type StreamSource = 'transcript' | 'outlook' | 'gmail' | 'slack';

interface StreamParams {
  userId: number;
  userEmail?: string | null;
  doc: DocumentWithSections;
  sourceKind: StreamSource;
  sourceTitle: string;
  content: string;
}

/** Single frame sent to the browser over SSE. */
type StreamEvent =
  | { type: 'journal-delta'; text: string }
  | { type: 'journal-complete' }
  | { type: 'proposals'; proposals: Array<Record<string, unknown>> }
  | { type: 'done' }
  | { type: 'error'; message: string };

function sendEvent(res: Response, event: StreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function extractProposals(fullText: string): Array<Record<string, unknown>> {
  const parsed = extractResultJson(fullText);
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { proposals?: unknown }).proposals)) {
    return (parsed as { proposals: Array<Record<string, unknown>> }).proposals;
  }
  return [];
}

export async function streamAnalysis(res: Response, params: StreamParams): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx : disable proxy buffering
  res.flushHeaders();

  const startedAt = Date.now();
  let fullPrompt = '';
  let fullText = '';
  let proposalsForLog: Array<Record<string, unknown>> = [];
  let logError: string | null = null;
  let skillVersionHash = '';
  let usedModel = '';
  let finalInputTokens = 0;
  let finalOutputTokens = 0;

  try {
    const skill = await loadSkill(SKILL_SLUG);
    const versionInfo = await ensureSkillVersion(SKILL_SLUG, skill, null);
    skillVersionHash = versionInfo.hash;
    const { client, model } = await getAnthropicClient(params.userId);
    usedModel = model;

    const existingContext = params.doc.sections.map(s => {
      const subjectsText = s.subjects.map(sub =>
        `  - [id:${sub.id}] [${sub.status}] "${sub.title}" (responsable: ${sub.responsibility || '-'})\n    Situation: ${sub.situation || '(vide)'}`
      ).join('\n');
      return `Section [id:${s.id}] "${s.name}":\n${subjectsText || '  (vide)'}`;
    }).join('\n\n');

    const sourceLabel =
      params.sourceKind === 'transcript' ? 'transcription de call'
      : params.sourceKind === 'slack' ? 'messages Slack'
      : 'email';

    const prompt = `${skill}

---

# Contexte exécutable

# Mode streaming activé

## Source
- Type : ${sourceLabel}
- Titre : ${params.sourceTitle}

## Document existant (avec IDs)
${existingContext || '(aucun sujet existant)'}

## Contenu brut de la source (tronqué à 30 000 caractères)
${params.content.slice(0, 30000)}

Applique les règles ci-dessus et produis d'abord un <journal>…</journal> narré,
puis un <result>…</result> contenant le JSON des propositions.`;

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
        // Collect usage from message_start (input_tokens) and message_delta
        // (output_tokens). Cast because the SDK's discriminated union types
        // don't surface usage on all variants.
        const anyEvent = event as { type: string; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } };
        if (anyEvent.type === 'message_start' && anyEvent.message?.usage) {
          finalInputTokens = anyEvent.message.usage.input_tokens ?? 0;
        } else if (anyEvent.type === 'message_delta' && anyEvent.usage) {
          finalOutputTokens = anyEvent.usage.output_tokens ?? 0;
        }
      }
    }

    const proposals = extractProposals(fullText).map((p, i) => ({ ...p, id: i }));
    proposalsForLog = proposals;
    if (finalInputTokens > 0 || finalOutputTokens > 0) {
      logAnthropicUsage(params.userId, usedModel, { input_tokens: finalInputTokens, output_tokens: finalOutputTokens }, `aiSkills:${SKILL_SLUG}`);
    }
    sendEvent(res, { type: 'proposals', proposals });
    sendEvent(res, { type: 'done' });
  } catch (err) {
    logError = err instanceof Error ? err.message : 'Erreur inconnue';
    sendEvent(res, { type: 'error', message: logError });
  } finally {
    res.end();
    // Best-effort logging — never throws.
    const inputTokens = finalInputTokens;
    const outputTokens = finalOutputTokens;
    await logAnalysis({
      userId: params.userId,
      userEmail: params.userEmail ?? null,
      skillSlug: SKILL_SLUG,
      sourceKind: params.sourceKind,
      sourceTitle: params.sourceTitle,
      documentId: params.doc.id,
      inputContent: params.content,
      fullPrompt,
      aiOutputRaw: fullText,
      proposals: proposalsForLog,
      durationMs: Date.now() - startedAt,
      error: logError,
      skillVersionHash: skillVersionHash || null,
      provider: 'anthropic',
      model: usedModel || null,
      inputTokens,
      outputTokens,
      costUsd: computeCostUsd(usedModel, inputTokens, outputTokens),
    });
  }
}
