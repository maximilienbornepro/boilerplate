// Email service for Outlook (Microsoft Graph) and Gmail (Google API)
// Fetches emails via OAuth tokens stored in email_oauth_tokens table

import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: config.appDatabaseUrl });

// ==================== TYPES ====================

export interface EmailItem {
  id: string;
  subject: string;
  sender: string;
  date: string;
  preview: string;
}

interface StoredToken {
  user_id: number;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
}

// ==================== TOKEN REFRESH ====================

async function refreshOutlookToken(stored: StoredToken): Promise<string | null> {
  if (!stored.refresh_token) return null;
  try {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.outlook.oauth.clientId,
        client_secret: config.outlook.oauth.clientSecret,
        refresh_token: stored.refresh_token,
      }),
    });
    if (!res.ok) { console.error('[Outlook] Refresh failed:', await res.text()); return null; }
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await pool.query(`
      UPDATE email_oauth_tokens SET access_token = $1, refresh_token = COALESCE($2, refresh_token), expires_at = $3, updated_at = NOW()
      WHERE user_id = $4 AND provider = 'outlook'
    `, [data.access_token, data.refresh_token || null, expiresAt, stored.user_id]);
    return data.access_token;
  } catch (err) { console.error('[Outlook] Refresh error:', err); return null; }
}

async function refreshGmailToken(stored: StoredToken): Promise<string | null> {
  if (!stored.refresh_token) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.gmail.oauth.clientId,
        client_secret: config.gmail.oauth.clientSecret,
        refresh_token: stored.refresh_token,
      }),
    });
    if (!res.ok) { console.error('[Gmail] Refresh failed:', await res.text()); return null; }
    const data = await res.json() as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await pool.query(`
      UPDATE email_oauth_tokens SET access_token = $1, expires_at = $2, updated_at = NOW()
      WHERE user_id = $3 AND provider = 'gmail'
    `, [data.access_token, expiresAt, stored.user_id]);
    return data.access_token;
  } catch (err) { console.error('[Gmail] Refresh error:', err); return null; }
}

async function getToken(userId: number, provider: 'outlook' | 'gmail'): Promise<string> {
  const { rows } = await pool.query<StoredToken>(
    'SELECT * FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  if (!rows.length) throw new Error(`${provider} non connecte`);

  const stored = rows[0];
  let accessToken = stored.access_token;

  // Refresh if expired (60s buffer)
  if (new Date(stored.expires_at).getTime() - Date.now() < 60_000) {
    const refreshed = provider === 'outlook'
      ? await refreshOutlookToken(stored)
      : await refreshGmailToken(stored);
    if (!refreshed) throw new Error(`Impossible de rafraichir le token ${provider}`);
    accessToken = refreshed;
  }

  return accessToken;
}

// ==================== OUTLOOK (Microsoft Graph) ====================

export async function listOutlookEmails(userId: number, days: number = 7): Promise<EmailItem[]> {
  const token = await getToken(userId, 'outlook');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$filter=receivedDateTime ge ${since}&$select=id,subject,from,receivedDateTime,bodyPreview&$top=50&$orderby=receivedDateTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Outlook API error: ${res.status}`);

  const data = await res.json() as {
    value: Array<{
      id: string;
      subject: string;
      from: { emailAddress: { name: string; address: string } };
      receivedDateTime: string;
      bodyPreview: string;
    }>;
  };

  return data.value.map(m => ({
    id: m.id,
    subject: m.subject || '(sans objet)',
    sender: m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Inconnu',
    date: m.receivedDateTime,
    preview: m.bodyPreview?.slice(0, 500) || '',
  }));
}

export async function getOutlookEmailBody(userId: number, messageId: string): Promise<string> {
  const token = await getToken(userId, 'outlook');
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=body`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Outlook API error: ${res.status}`);
  const data = await res.json() as { body: { content: string; contentType: string } };

  // Strip HTML tags if HTML content
  if (data.body.contentType === 'html') {
    return data.body.content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return data.body.content || '';
}

// ==================== GMAIL (Google API) ====================

export async function listGmailEmails(userId: number, days: number = 7): Promise<EmailItem[]> {
  const token = await getToken(userId, 'gmail');
  const afterEpoch = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  // List message IDs
  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=after:${afterEpoch}&maxResults=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) throw new Error(`Gmail API error: ${listRes.status}`);
  const listData = await listRes.json() as { messages?: Array<{ id: string }> };

  if (!listData.messages?.length) return [];

  // Fetch metadata for each message (batch — max 50)
  const emails: EmailItem[] = [];
  for (const msg of listData.messages.slice(0, 50)) {
    try {
      const msgRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;
      const msgData = await msgRes.json() as {
        id: string;
        snippet: string;
        payload: { headers: Array<{ name: string; value: string }> };
      };

      const getHeader = (name: string) => msgData.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      emails.push({
        id: msgData.id,
        subject: getHeader('Subject') || '(sans objet)',
        sender: getHeader('From').replace(/<.*>/, '').trim() || 'Inconnu',
        date: getHeader('Date'),
        preview: msgData.snippet?.slice(0, 500) || '',
      });
    } catch { /* skip individual message errors */ }
  }

  return emails;
}

export async function getGmailEmailBody(userId: number, messageId: string): Promise<string> {
  const token = await getToken(userId, 'gmail');
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  const data = await res.json() as {
    payload: {
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    };
  };

  // Find text/plain part
  let bodyData = '';
  if (data.payload.body?.data) {
    bodyData = data.payload.body.data;
  } else if (data.payload.parts) {
    const textPart = data.payload.parts.find(p => p.mimeType === 'text/plain');
    const htmlPart = data.payload.parts.find(p => p.mimeType === 'text/html');
    bodyData = textPart?.body?.data || htmlPart?.body?.data || '';
  }

  if (!bodyData) return '';

  // Decode base64url
  const decoded = Buffer.from(bodyData, 'base64url').toString('utf-8');

  // Strip HTML if needed
  if (decoded.includes('<html') || decoded.includes('<div')) {
    return decoded
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return decoded;
}
