/**
 * Otter.ai integration service for SuiviTess.
 * Fetches recent call recordings + transcriptions from the Otter.ai API.
 *
 * Note: Otter's official public API is in beta (Enterprise only).
 * This implementation uses the documented REST endpoints.
 * Auth: API key via Authorization: Bearer header.
 * Base URL: https://api.otter.ai/v1 (may vary — configurable via connector baseUrl)
 *
 * Sources:
 *   - https://help.otter.ai/hc/en-us/articles/4412365535895
 *   - https://helpdesk.tryotter.com/hc/en-us/articles/22694653065107
 */

import { getConnector } from '../connectors/dbService.js';

const DEFAULT_OTTER_BASE_URL = 'https://api.otter.ai/v1';

export interface OtterCall {
  id: string;
  title: string;
  date: string;
  duration?: number;
  url?: string;
}

export interface OtterTranscriptEntry {
  speaker: string;
  text: string;
  timestamp?: number;
}

async function getOtterConfig(userId: number): Promise<{ apiKey: string; baseUrl: string }> {
  const connector = await getConnector(userId, 'otter');
  if (!connector?.isActive || !connector.config?.apiKey) {
    throw new Error('Otter.ai non configuré. Ajoutez votre clé API dans Réglages > Connecteurs.');
  }
  return {
    apiKey: connector.config.apiKey as string,
    baseUrl: (connector.config.baseUrl as string) || DEFAULT_OTTER_BASE_URL,
  };
}

/**
 * Fetch recent conversations from Otter.ai.
 */
export async function listOtterCalls(userId: number, days: number = 30): Promise<OtterCall[]> {
  const { apiKey, baseUrl } = await getOtterConfig(userId);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const url = `${baseUrl}/conversations?created_after=${since.toISOString()}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Otter API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    conversations?: Array<{
      id?: string;
      title?: string;
      created_at?: string;
      duration?: number;
    }>;
  };

  return (data.conversations || []).map(c => ({
    id: c.id || '',
    title: c.title || 'Sans titre',
    date: c.created_at || '',
    duration: c.duration,
  })).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetch the transcript for a specific Otter conversation.
 */
export async function getOtterTranscript(userId: number, conversationId: string): Promise<OtterTranscriptEntry[]> {
  const { apiKey, baseUrl } = await getOtterConfig(userId);

  const url = `${baseUrl}/conversations/${conversationId}/transcript`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Otter API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    transcript?: Array<{
      speaker?: string;
      text?: string;
      start_time?: number;
    }>;
  };

  return (data.transcript || []).map(entry => ({
    speaker: entry.speaker || 'Inconnu',
    text: entry.text || '',
    timestamp: entry.start_time,
  }));
}
