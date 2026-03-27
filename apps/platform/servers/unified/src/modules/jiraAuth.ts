/**
 * Jira OAuth 2.0 token manager.
 *
 * Provides `getJiraContext(userId?)` which returns the appropriate auth context:
 * - If user has a valid OAuth token → Bearer (Atlassian Cloud API)
 * - If OAuth token is expired → refresh automatically, then Bearer
 * - If user has no OAuth token → fallback to Basic auth from user_connectors
 *
 * Also exposes `jiraCloudApiBase(cloudId)` for building API URLs with OAuth.
 */

import pg from 'pg';
import { config } from '../config.js';

// ==================== Pool (shared app DB) ====================

let pool: pg.Pool;

export function initJiraAuth(sharedPool: pg.Pool) {
  pool = sharedPool;
}

// ==================== Types ====================

export interface JiraHeaders {
  Authorization: string;
  Accept: string;
  'Content-Type': string;
}

export interface JiraContext {
  headers: JiraHeaders;
  /** Base URL for Jira REST API calls */
  baseUrl: string;
  /** Whether this context uses OAuth (true) or Basic fallback (false) */
  isOAuth: boolean;
}

interface StoredToken {
  user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
  cloud_id: string;
  site_url: string;
}

// ==================== URL Helpers ====================

/**
 * Build base URL for Jira REST API calls using OAuth (Atlassian Cloud).
 * ex: https://api.atlassian.com/ex/jira/<cloud_id>
 */
export function jiraCloudApiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}`;
}

// ==================== Token Refresh ====================

async function refreshAccessToken(stored: StoredToken): Promise<string | null> {
  if (!stored.refresh_token) return null;

  try {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'refresh_token',
        client_id:     config.jira.oauth.clientId,
        client_secret: config.jira.oauth.clientSecret,
        refresh_token: stored.refresh_token,
      }),
    });

    if (!response.ok) {
      console.error('[jira-oauth] Refresh failed:', await response.text());
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Persist refreshed tokens
    await pool.query(`
      UPDATE jira_tokens SET
        access_token  = $1,
        refresh_token = COALESCE($2, refresh_token),
        expires_at    = $3,
        updated_at    = NOW()
      WHERE user_id = $4
    `, [data.access_token, data.refresh_token || null, expiresAt, stored.user_id]);

    console.log(`[jira-oauth] Token refreshed for user ${stored.user_id}`);
    return data.access_token;
  } catch (err) {
    console.error('[jira-oauth] Refresh error:', err);
    return null;
  }
}

// ==================== Main API ====================

/**
 * Get Jira auth context for a user.
 * Falls back to Basic auth from user_connectors if user has no OAuth token.
 */
export async function getJiraContext(userId?: number): Promise<JiraContext | null> {
  // Try OAuth token if userId provided
  if (userId) {
    const result = await pool.query<StoredToken>(
      'SELECT * FROM jira_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length > 0) {
      const stored = result.rows[0];
      let accessToken = stored.access_token;

      // Refresh if expired (with 60s buffer)
      const expiresAt = new Date(stored.expires_at);
      if (expiresAt.getTime() - Date.now() < 60_000) {
        const refreshed = await refreshAccessToken(stored);
        if (refreshed) {
          accessToken = refreshed;
        } else {
          console.warn(`[jira-oauth] Refresh failed for user ${userId}, falling back to Basic auth`);
          return buildBasicContext(userId);
        }
      }

      return {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        baseUrl: jiraCloudApiBase(stored.cloud_id),
        isOAuth: true,
      };
    }
  }

  // Fallback: Basic auth from user_connectors
  return buildBasicContext(userId);
}

/**
 * Get just the Jira headers (convenience wrapper).
 */
export async function getJiraHeaders(userId?: number): Promise<JiraHeaders | null> {
  const ctx = await getJiraContext(userId);
  return ctx ? ctx.headers : null;
}

/**
 * Get stored token info for a user (for status checks).
 */
export async function getUserJiraToken(userId: number): Promise<StoredToken | null> {
  const result = await pool.query<StoredToken>(
    'SELECT * FROM jira_tokens WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

// ==================== Helpers ====================

async function buildBasicContext(userId?: number): Promise<JiraContext | null> {
  if (userId) {
    const result = await pool.query(
      "SELECT config FROM user_connectors WHERE user_id = $1 AND service = 'jira'",
      [userId]
    );

    if (result.rows.length > 0) {
      const cfg = result.rows[0].config as { baseUrl: string; email: string; apiToken: string };
      if (cfg.baseUrl && cfg.email && cfg.apiToken) {
        const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
        return {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          baseUrl: cfg.baseUrl,
          isOAuth: false,
        };
      }
    }
  }

  return null;
}
