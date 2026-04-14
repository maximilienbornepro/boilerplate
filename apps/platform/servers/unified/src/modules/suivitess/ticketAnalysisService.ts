// Analyzes SuiviTess subjects and suggests which ones need a ticket (Jira/Notion/Roadmap)

import { getAnthropicClient } from '../connectors/aiProvider.js';

export interface TicketSuggestion {
  subjectId: string;
  subjectTitle: string;
  needsAction: boolean;
  suggestedService: 'jira' | 'notion' | 'roadmap' | null;
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
      content: `Tu es un assistant de gestion de projet. Analyse ces sujets de suivi de reunion et determine pour chacun s'il necessite la creation d'un ticket externe.

## Regles de decision
- **Jira** : bug technique, feature a developper, tache d'ingenierie, probleme technique a tracer
- **Notion** : documentation a creer, reference a stocker, note a partager, knowledge base
- **Roadmap** : milestone, livrable avec echeance, jalon projet, planning strategique
- **null** : sujet informatif, deja traite (statut terminé), trop vague, pas d'action concrete

## Sujets a analyser
${subjectsList}

## Format de reponse (JSON uniquement)
{
  "suggestions": [
    {
      "subjectId": "uuid",
      "needsAction": true,
      "suggestedService": "jira",
      "reason": "Bug technique a corriger en priorite",
      "suggestedTitle": "Titre clair pour le ticket",
      "suggestedDescription": "Description detaillee reprenant la situation"
    }
  ]
}

Ne retourne que les sujets necessitant une action (ignore les sujets terminés ou trop vagues). Maximum 10 suggestions.`,
    }],
  });

  const text = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
  let suggestions: Array<{
    subjectId: string;
    needsAction?: boolean;
    suggestedService?: 'jira' | 'notion' | 'roadmap' | null;
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
    .filter(s => s.needsAction && s.suggestedService)
    .map(s => ({
      subjectId: s.subjectId,
      subjectTitle: subjectMap.get(s.subjectId) || '',
      needsAction: true,
      suggestedService: s.suggestedService ?? null,
      reason: s.reason || '',
      suggestedTitle: s.suggestedTitle || subjectMap.get(s.subjectId) || '',
      suggestedDescription: s.suggestedDescription || '',
    }));
}
