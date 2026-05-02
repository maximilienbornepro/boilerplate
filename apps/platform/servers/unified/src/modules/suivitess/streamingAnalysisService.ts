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
import { sanitizeProposedTitle } from './titleSanitizer.js';
import { normalizeTitleForCompare } from './proposalDedup.js';

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
  let list: Array<Record<string, unknown>>;
  if (Array.isArray(parsed)) list = parsed as Array<Record<string, unknown>>;
  else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { proposals?: unknown }).proposals)) {
    list = (parsed as { proposals: Array<Record<string, unknown>> }).proposals;
  } else {
    list = [];
  }
  // Defensive cleanup on AI-proposed titles. We only touch fields that
  // the LLM authored : `title` (create_subject + nested in create_section)
  // and `sectionName` ONLY when paired with `action: "create_section"`
  // (i.e. a freshly-proposed section name, not a reference to an existing
  // one). For `action: "enrich"`, `subjectTitle` and `sectionName` echo
  // the document's existing values and must not be reformatted.
  const cleaned = list.map(p => {
    const next: Record<string, unknown> = { ...p };
    if (p.action === 'create_subject' && typeof p.title === 'string') {
      next.title = sanitizeProposedTitle(p.title);
    }
    if (p.action === 'create_section') {
      if (typeof p.sectionName === 'string') {
        next.sectionName = sanitizeProposedTitle(p.sectionName);
      }
      if (Array.isArray(p.subjects)) {
        next.subjects = (p.subjects as Array<Record<string, unknown>>).map(s => ({
          ...s,
          title: typeof s.title === 'string' ? sanitizeProposedTitle(s.title) : s.title,
        }));
      }
    }
    return next;
  });
  return dedupRawProposals(cleaned);
}

/** Code-level dedup for the legacy streaming path. Mirrors
 *  `dedupNearDuplicateDocumentProposals` but operates on the raw
 *  proposal shape that this skill emits (Record<string, unknown>).
 *  Only touches `create_subject` and `create_section` proposals — and
 *  only their AI-authored fields. `enrich` proposals reference existing
 *  subjects and pass through untouched. */
function dedupRawProposals(list: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  // Pass 1 : dedup create_subject by normalized title.
  const subjectGroups = new Map<string, Array<Record<string, unknown>>>();
  const passthrough: Array<Record<string, unknown>> = [];
  for (const p of list) {
    if (p.action !== 'create_subject') {
      passthrough.push(p);
      continue;
    }
    const key = normalizeTitleForCompare(typeof p.title === 'string' ? p.title : '');
    if (!key) {
      passthrough.push(p);
      continue;
    }
    const bucket = subjectGroups.get(key);
    if (bucket) bucket.push(p);
    else subjectGroups.set(key, [p]);
  }
  const afterPass1: Array<Record<string, unknown>> = [...passthrough];
  let merges = 0;
  for (const bucket of subjectGroups.values()) {
    if (bucket.length === 1) { afterPass1.push(bucket[0]); continue; }
    const survivor = { ...bucket[0] };
    const sits = bucket.map(b => typeof b.situation === 'string' ? b.situation.trim() : '').filter(Boolean);
    survivor.situation = Array.from(new Set(sits)).join('\n');
    survivor.reason = `${typeof survivor.reason === 'string' ? survivor.reason : ''} (fusionné avec ${bucket.length - 1} proposition(s) au titre quasi-identique)`.trim();
    afterPass1.push(survivor);
    merges += bucket.length - 1;
  }

  // Pass 2 : dedup create_section by normalized sectionName, merging their subjects[].
  const sectionGroups = new Map<string, Array<Record<string, unknown>>>();
  const otherProposals: Array<Record<string, unknown>> = [];
  for (const p of afterPass1) {
    if (p.action !== 'create_section') { otherProposals.push(p); continue; }
    const key = normalizeTitleForCompare(typeof p.sectionName === 'string' ? p.sectionName : '');
    if (!key) { otherProposals.push(p); continue; }
    const bucket = sectionGroups.get(key);
    if (bucket) bucket.push(p);
    else sectionGroups.set(key, [p]);
  }
  const result: Array<Record<string, unknown>> = [...otherProposals];
  for (const bucket of sectionGroups.values()) {
    if (bucket.length === 1) { result.push(bucket[0]); continue; }
    const survivor = { ...bucket[0] };
    const seen = new Set<string>();
    const allSubjects: Array<Record<string, unknown>> = [];
    for (const sec of bucket) {
      const subs = Array.isArray(sec.subjects) ? sec.subjects as Array<Record<string, unknown>> : [];
      for (const s of subs) {
        const k = normalizeTitleForCompare(typeof s.title === 'string' ? s.title : '');
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        allSubjects.push(s);
      }
    }
    survivor.subjects = allSubjects;
    survivor.reason = `${typeof survivor.reason === 'string' ? survivor.reason : ''} (fusionné avec ${bucket.length - 1} section(s) au nom quasi-identique)`.trim();
    result.push(survivor);
    merges += bucket.length - 1;
  }

  if (merges > 0) {
    // eslint-disable-next-line no-console
    console.log(`[streamingAnalysisService] dedup → merged ${merges} near-duplicate proposal(s)`);
  }
  return result;
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
