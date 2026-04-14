/**
 * Fathom integration service for SuiviTess.
 * Fetches recent call recordings + transcriptions from the Fathom API
 * and allows importing them as subjects in a SuiviTess document section.
 *
 * API docs: https://developers.fathom.ai/quickstart
 * Auth: API key via X-Api-Key header
 * Base URL: https://api.fathom.ai/external/v1
 */

import pg from 'pg';
import { config } from '../../config.js';
import { getConnector } from '../connectors/dbService.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: config.appDatabaseUrl });

const FATHOM_BASE_URL = 'https://api.fathom.ai/external/v1';

interface StoredToken {
  user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
}

async function refreshFathomToken(stored: StoredToken): Promise<string | null> {
  if (!stored.refresh_token) return null;
  try {
    const res = await fetch('https://fathom.video/external/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.fathom.oauth.clientId,
        client_secret: config.fathom.oauth.clientSecret,
        refresh_token: stored.refresh_token,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    await pool.query(`
      UPDATE email_oauth_tokens SET access_token = $1, refresh_token = COALESCE($2, refresh_token), expires_at = $3, updated_at = NOW()
      WHERE user_id = $4 AND provider = 'fathom'
    `, [data.access_token, data.refresh_token || null, expiresAt, stored.user_id]);
    return data.access_token;
  } catch { return null; }
}

/**
 * Returns auth headers for Fathom — prefers OAuth bearer token, falls back to API key.
 */
async function getFathomAuthHeaders(userId: number): Promise<Record<string, string>> {
  // Try OAuth first
  const { rows } = await pool.query<StoredToken>(
    `SELECT * FROM email_oauth_tokens WHERE user_id = $1 AND provider = 'fathom'`,
    [userId]
  );
  if (rows.length > 0) {
    let token = rows[0].access_token;
    if (new Date(rows[0].expires_at).getTime() - Date.now() < 60_000) {
      const refreshed = await refreshFathomToken(rows[0]);
      if (refreshed) token = refreshed;
    }
    return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }
  // Fallback to API key
  const connector = await getConnector(userId, 'fathom');
  if (!connector?.config?.apiKey) {
    throw new Error('Fathom non configuré. Connectez-vous via OAuth ou ajoutez votre clé API dans Réglages > Connecteurs.');
  }
  return { 'X-Api-Key': connector.config.apiKey as string, Accept: 'application/json' };
}

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
 * Fetch recent calls from Fathom (last 30 days by default).
 */
export async function listFathomCalls(userId: number, days: number = 30): Promise<FathomCall[]> {
  const headers = await getFathomAuthHeaders(userId);

  const since = new Date();
  since.setDate(since.getDate() - days);
  const createdAfter = since.toISOString();

  const url = `${FATHOM_BASE_URL}/meetings?created_after=${encodeURIComponent(createdAfter)}`;

  const response = await fetch(url, { headers });

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
  const headers = await getFathomAuthHeaders(userId);

  const url = `${FATHOM_BASE_URL}/recordings/${recordingId}/transcript`;

  const response = await fetch(url, { headers });

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
