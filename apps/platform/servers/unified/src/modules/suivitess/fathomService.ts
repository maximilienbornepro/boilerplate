/**
 * Fathom integration service for SuiviTess.
 * Fetches recent call recordings + transcriptions from the Fathom API
 * and allows importing them as subjects in a SuiviTess document section.
 *
 * API docs: https://developers.fathom.ai/quickstart
 * Auth: API key via X-Api-Key header
 * Base URL: https://api.fathom.ai/external/v1
 */

import { getConnector } from '../connectors/dbService.js';

const FATHOM_BASE_URL = 'https://api.fathom.ai/external/v1';

export interface FathomCall {
  id: string;
  title: string;
  date: string;           // ISO timestamp
  duration?: number;       // seconds
  url?: string;            // link to Fathom recording
}

export interface FathomTranscriptEntry {
  speaker: string;
  text: string;
  timestamp?: number;
}

export interface FathomCallWithTranscript extends FathomCall {
  transcript: FathomTranscriptEntry[];
}

/**
 * Get the Fathom API key for a user (from connectors config).
 */
async function getFathomApiKey(userId: number): Promise<string> {
  const connector = await getConnector(userId, 'fathom');
  if (!connector?.config?.apiKey) {
    throw new Error('Fathom non configuré. Ajoutez votre clé API dans Réglages > Connecteurs.');
  }
  return connector.config.apiKey as string;
}

/**
 * Fetch recent calls from Fathom (last 30 days by default).
 */
export async function listFathomCalls(userId: number, days: number = 30): Promise<FathomCall[]> {
  const apiKey = await getFathomApiKey(userId);

  const since = new Date();
  since.setDate(since.getDate() - days);
  const createdAfter = since.toISOString();

  const url = `${FATHOM_BASE_URL}/meetings?created_after=${encodeURIComponent(createdAfter)}`;

  const response = await fetch(url, {
    headers: {
      'X-Api-Key': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fathom API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    items?: Array<{
      recording_id?: number;
      title?: string;
      meeting_title?: string;
      created_at?: string;
      recording_start_time?: string;
      recording_end_time?: string;
      url?: string;
      share_url?: string;
    }>;
  };

  const items = data.items || [];

  return items.map(m => {
    const start = m.recording_start_time ? new Date(m.recording_start_time).getTime() : 0;
    const end = m.recording_end_time ? new Date(m.recording_end_time).getTime() : 0;
    return {
      id: String(m.recording_id || ''),
      title: m.title || m.meeting_title || 'Sans titre',
      date: m.created_at || m.recording_start_time || '',
      duration: start && end ? Math.round((end - start) / 1000) : undefined,
      url: m.url || m.share_url,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetch the transcript for a specific call.
 */
export async function getFathomTranscript(userId: number, recordingId: string): Promise<FathomTranscriptEntry[]> {
  const apiKey = await getFathomApiKey(userId);

  const url = `${FATHOM_BASE_URL}/recordings/${recordingId}/transcript`;

  const response = await fetch(url, {
    headers: {
      'X-Api-Key': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fathom API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    transcript?: Array<{
      speaker?: string | { display_name?: string; matched_calendar_invitee_email?: string };
      text?: string;
      timestamp?: string | number;
    }>;
  };

  return (data.transcript || []).map(entry => {
    // speaker can be a string or an object { display_name, ... }
    let speakerName = 'Inconnu';
    if (typeof entry.speaker === 'string') {
      speakerName = entry.speaker;
    } else if (entry.speaker?.display_name) {
      speakerName = entry.speaker.display_name;
    }

    return {
      speaker: speakerName,
      text: entry.text || '',
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : undefined,
    };
  });
}
