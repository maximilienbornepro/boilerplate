// Analyzes SuiviTess subjects and suggests which ones need a ticket (Jira/Notion/Roadmap)

import { getAnthropicClient } from '../connectors/aiProvider.js';

export interface TicketSuggestion {
  subjectId: string;
  subjectTitle: string;
  needsAction: boolean;
  reason: string;
  suggestedTitle: string;
  suggestedDescription: string;
}

interface SubjectInput {
  id: string;
  title: string;
  situation: string | null;
  status: string;
  responsibility: string | null;
}

export async function analyzeSubjectsForTickets(
  userId: number,
  subjects: SubjectInput[],
): Promise<TicketSuggestion[]> {
  if (subjects.length === 0) return [];

  const { client, model } = await getAnthropicClient(userId);

  const subjectsList = subjects.map(s =>
    `[id:${s.id}] "${s.title}" — ${s.status}${s.responsibility ? ` (responsable: ${s.responsibility})` : ''}\n  Situation: ${s.situation || '(vide)'}`
  ).join('\n\n');

  const aiResponse = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Tu es un assistant de gestion de projet. Analyse ces sujets de suivi de reunion et determine pour chacun s'il necessite une action concrete (ticket, planning, etc.).

## Regle
Identifie les sujets qui necessitent une action concrete a tracker (bug, feature, tache, livrable, milestone, etc.). Ignore les sujets purement informatifs, deja terminés, ou trop vagues.

L'utilisateur decidera lui-meme dans quel outil le tracker (Jira, Roadmap, etc.) — tu n'as pas a le suggerer.

## Sujets a analyser
${subjectsList}

## Format de reponse (JSON uniquement)
{
  "suggestions": [
    {
      "subjectId": "uuid",
      "needsAction": true,
      "reason": "Pourquoi ce sujet necessite une action",
      "suggestedTitle": "Titre clair, concis, actionnable",
      "suggestedDescription": "Description detaillee reprenant la situation"
    }
  ]
}

Ne retourne que les sujets necessitant une action. Maximum 15 suggestions.`,
    }],
  });

  const text = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
  let suggestions: Array<{
    subjectId: string;
    needsAction?: boolean;
    reason?: string;
    suggestedTitle?: string;
    suggestedDescription?: string;
  }> = [];
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      suggestions = parsed.suggestions || [];
    }
  } catch {
    /* parse error */
  }

  // Enrich with subject title from input
  const subjectMap = new Map(subjects.map(s => [s.id, s.title]));
  return suggestions
    .filter(s => s.needsAction)
    .map(s => ({
      subjectId: s.subjectId,
      subjectTitle: subjectMap.get(s.subjectId) || '',
      needsAction: true,
      reason: s.reason || '',
      suggestedTitle: s.suggestedTitle || subjectMap.get(s.subjectId) || '',
      suggestedDescription: s.suggestedDescription || '',
    }));
}
