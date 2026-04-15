// SuiviTess — AI-powered routing of calls / emails to existing reviews.
// Given a batch of source items (Fathom / Otter transcripts or Gmail /
// Outlook emails) and the list of existing reviews, asks Claude to decide
// which review is the best destination for each item — or to propose a
// new review title when nothing matches.
//
// Rules live in transcription-routing-skill.md and are reloaded from disk
// on every call, so the skill file can be tuned without a redeploy.

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

export type SourceProvider = 'fathom' | 'otter' | 'gmail' | 'outlook';

export interface SourceItem {
  id: string;
  provider: SourceProvider;
  title: string;
  date: string | null;
  participants?: string[];
  preview?: string;
}

export interface ExistingReview {
  id: string;
  title: string;
  description: string | null;
}

export type RoutingAction = 'existing' | 'new';

export interface RoutingSuggestion {
  itemId: string;
  suggestedAction: RoutingAction;
  suggestedDocId: string | null;
  suggestedNewTitle: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface RoutingResult {
  summary: string;
  suggestions: RoutingSuggestion[];
}

// ============ Entry point ============

/**
 * Ask Claude to route each source item to either an existing review or a
 * newly-proposed review title. Validates the response so no invalid
 * `suggestedDocId` leaks through and so every input item gets exactly one
 * suggestion (unmatched items are filled in with a `"new"` fallback).
 */
export async function suggestRouting(
  userId: number,
  items: SourceItem[],
  existingReviews: ExistingReview[],
): Promise<RoutingResult> {
  if (items.length === 0) {
    return { summary: 'Aucun item à router.', suggestions: [] };
  }

  const skill = await loadSkill();
  const { client, model } = await getAnthropicClient(userId);

  const itemsJson = items.map(i => ({
    id: i.id,
    provider: i.provider,
    title: i.title,
    date: i.date,
    participants: i.participants ?? [],
    preview: (i.preview ?? '').slice(0, 300),
  }));

  const reviewsJson = existingReviews.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description ?? '',
  }));

  const prompt = `${skill}

---

# Contexte exécutable (généré automatiquement)

## Reviews SuiviTess existantes (JSON)
${JSON.stringify(reviewsJson, null, 2)}

## Items à ranger (JSON)
${JSON.stringify(itemsJson, null, 2)}

Applique les règles ci-dessus et réponds uniquement en JSON.`;

  const aiResponse = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = aiResponse.content.find(b => b.type === 'text')?.type === 'text'
    ? (aiResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string }).text
    : '';

  let parsed: { summary?: string; suggestions?: unknown[] } = {};
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* fallthrough to fallback */
  }

  const reviewIds = new Set(existingReviews.map(r => r.id));
  const byItemId = new Map<string, RoutingSuggestion>();

  for (const rawRaw of (parsed.suggestions || []) as Array<Record<string, unknown>>) {
    const itemId = String(rawRaw.itemId || '');
    if (!itemId) continue;
    if (byItemId.has(itemId)) continue;
    if (!items.some(i => i.id === itemId)) continue;

    const action: RoutingAction = rawRaw.suggestedAction === 'new' ? 'new' : 'existing';
    let suggestedDocId: string | null = null;
    let suggestedNewTitle: string | null = null;

    if (action === 'existing') {
      const candidate = String(rawRaw.suggestedDocId || '');
      if (reviewIds.has(candidate)) {
        suggestedDocId = candidate;
      } else {
        // invalid docId → fall back to "new" with the item title as placeholder
        suggestedNewTitle = String(rawRaw.suggestedNewTitle || '').slice(0, 80)
          || deriveTitle(items.find(i => i.id === itemId));
        byItemId.set(itemId, {
          itemId,
          suggestedAction: 'new',
          suggestedDocId: null,
          suggestedNewTitle,
          confidence: 'low',
          reasoning: 'Destination proposée invalide — nouvelle review suggérée par défaut.',
        });
        continue;
      }
    } else {
      suggestedNewTitle = String(rawRaw.suggestedNewTitle || '').slice(0, 80)
        || deriveTitle(items.find(i => i.id === itemId));
    }

    const confidenceRaw = String(rawRaw.confidence || 'medium').toLowerCase();
    const confidence: 'high' | 'medium' | 'low' =
      confidenceRaw === 'high' || confidenceRaw === 'low' ? confidenceRaw : 'medium';

    byItemId.set(itemId, {
      itemId,
      suggestedAction: action,
      suggestedDocId,
      suggestedNewTitle,
      confidence,
      reasoning: String(rawRaw.reasoning || '').slice(0, 300),
    });
  }

  // Fill in missing items with a "new" fallback so the caller always gets
  // a suggestion per requested item.
  const suggestions: RoutingSuggestion[] = [];
  for (const i of items) {
    const s = byItemId.get(i.id);
    if (s) { suggestions.push(s); continue; }
    suggestions.push({
      itemId: i.id,
      suggestedAction: 'new',
      suggestedDocId: null,
      suggestedNewTitle: deriveTitle(i),
      confidence: 'low',
      reasoning: 'Aucune suggestion IA — proposition par défaut.',
    });
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : `${suggestions.length} item(s) routé(s).`,
    suggestions,
  };
}

function deriveTitle(item?: SourceItem): string {
  if (!item) return 'Nouvelle review';
  const clean = item.title.trim() || `${item.provider} — import`;
  return clean.slice(0, 80);
}
