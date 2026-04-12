/**
 * suggestionsService.ts — post-call AI processing.
 * Compares Teams transcript with suivitess document content and generates suggestions via Claude.
 */

import * as db from './dbService.js';
import { getAnthropicClient } from '../connectors/aiProvider.js';
const MAX_TRANSCRIPT_CHARS = 50_000;
const MAX_SUGGESTIONS = 20;

interface RawSuggestion {
  type: 'new-subject' | 'update-situation' | 'new-section';
  targetSectionId?: string | null;
  targetSubjectId?: string | null;
  proposedTitle?: string | null;
  proposedSituation?: string | null;
  rationale: string;
}

export async function generateSuggestions(
  userId: number,
  documentId: string,
  recordingId: number,
  transcript: db.CaptionEntry[]
): Promise<void> {
  if (transcript.length < 5) {
    console.log('[Suggestions] Not enough captions, skipping AI generation');
    return;
  }

  // Build transcript text
  const transcriptText = buildTranscriptText(transcript).slice(0, MAX_TRANSCRIPT_CHARS);

  // Load current document content
  const doc = await db.getDocumentWithSections(documentId);
  if (!doc) return;

  const documentText = buildDocumentText(doc);

  // Build prompt
  const prompt = buildPrompt(doc.title, documentText, transcriptText);

  // Call Claude (resolved from user's connector config or env var fallback)
  const { client, model } = await getAnthropicClient(userId);
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { type: 'text'; text: string }).text)
    .join('');

  // Parse JSON suggestions
  const suggestions = parseSuggestions(responseText);

  // Persist suggestions (max 20)
  const toSave = suggestions.slice(0, MAX_SUGGESTIONS);
  for (const s of toSave) {
    await db.createSuggestion(recordingId, documentId, {
      type: s.type,
      targetSectionId: s.targetSectionId ?? null,
      targetSubjectId: s.targetSubjectId ?? null,
      proposedTitle: s.proposedTitle ?? null,
      proposedSituation: s.proposedSituation ?? null,
      rationale: s.rationale,
    });
  }

  console.log(`[Suggestions] Generated ${toSave.length} suggestions for document ${documentId}`);
}

function buildTranscriptText(transcript: db.CaptionEntry[]): string {
  return transcript
    .map((c) => {
      const mins = Math.floor(c.timestamp / 60000);
      const secs = Math.floor((c.timestamp % 60000) / 1000);
      return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}] ${c.speaker}: ${c.text}`;
    })
    .join('\n');
}

function buildDocumentText(doc: any): string {
  if (!doc.sections || doc.sections.length === 0) return '(aucune note prise)';

  return doc.sections
    .map((section: any) => {
      const subjects = (section.subjects || [])
        .map((s: any) => `  - ${s.title}${s.situation ? ': ' + s.situation : ''}`)
        .join('\n');
      return `## ${section.name}\n${subjects || '  (aucun sujet)'}`;
    })
    .join('\n\n');
}

function buildPrompt(title: string, documentText: string, transcriptText: string): string {
  return `Tu es un assistant qui aide à compléter des notes de réunion.

L'utilisateur a pris des notes dans un document intitulé "${title}" pendant une réunion Teams.
Voici les notes actuelles du document :

<notes>
${documentText}
</notes>

Voici la transcription complète de la réunion :

<transcription>
${transcriptText}
</transcription>

Analyse la transcription et compare-la avec les notes. Génère une liste de suggestions pour compléter les notes.

Règles :
- Propose uniquement ce qui manque dans les notes et qui apparaît clairement dans la transcription
- Ne propose pas de doublons avec ce qui est déjà dans les notes
- Maximum ${MAX_SUGGESTIONS} suggestions
- Chaque suggestion doit avoir un rationale clair en français expliquant pourquoi elle est utile
- Pour les suggestions de type "update-situation", utilise le targetSubjectId si le sujet existe déjà

Types de suggestions :
- "new-subject" : un sujet discuté qui n'est pas dans les notes
- "update-situation" : une information à ajouter à un sujet existant
- "new-section" : une thématique entière non couverte

Réponds UNIQUEMENT avec un tableau JSON valide de suggestions, sans texte avant ou après :

[
  {
    "type": "new-subject",
    "targetSectionId": null,
    "proposedTitle": "Titre du sujet",
    "proposedSituation": "Description de la décision ou information",
    "rationale": "Ce point a été discuté à [00:05] mais n'apparaît pas dans les notes"
  },
  {
    "type": "update-situation",
    "targetSubjectId": null,
    "proposedSituation": "Information à ajouter",
    "rationale": "Complément mentionné à [00:12]"
  }
]`;
}

function parseSuggestions(text: string): RawSuggestion[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: any) =>
        typeof s === 'object' &&
        s !== null &&
        ['new-subject', 'update-situation', 'new-section'].includes(s.type) &&
        typeof s.rationale === 'string'
    );
  } catch {
    return [];
  }
}

// Accept a suggestion: apply it to the document
export async function acceptSuggestion(suggestion: db.Suggestion, documentId: string): Promise<void> {
  switch (suggestion.type) {
    case 'new-section': {
      const title = suggestion.proposedTitle || 'Nouvelle section';
      const section = await db.createSection(documentId, title);
      if (suggestion.proposedSituation) {
        await db.createSubject(section.id, title, suggestion.proposedSituation, '📋 transcription', null);
      }
      break;
    }

    case 'new-subject': {
      // Find best target section — use targetSectionId or last section
      let sectionId = suggestion.targetSectionId;
      if (!sectionId) {
        const doc = await db.getDocumentWithSections(documentId);
        const sections = doc?.sections || [];
        sectionId = sections[sections.length - 1]?.id ?? null;
      }
      if (!sectionId) {
        // Create a default section
        const section = await db.createSection(documentId, 'Transcription Teams');
        sectionId = section.id;
      }
      await db.createSubject(
        sectionId,
        suggestion.proposedTitle || 'Sujet',
        suggestion.proposedSituation || null,
        '📋 transcription',
        null
      );
      break;
    }

    case 'update-situation': {
      if (suggestion.targetSubjectId && suggestion.proposedSituation) {
        const subject = await db.getSubjectWithDocId(suggestion.targetSubjectId);
        if (subject) {
          const updatedSituation = subject.situation
            ? `${subject.situation}\n\n${suggestion.proposedSituation}`
            : suggestion.proposedSituation;
          await db.pool.query(
            'UPDATE suivitess_subjects SET situation = $1 WHERE id = $2',
            [updatedSituation, suggestion.targetSubjectId]
          );
        }
      }
      break;
    }
  }
}
