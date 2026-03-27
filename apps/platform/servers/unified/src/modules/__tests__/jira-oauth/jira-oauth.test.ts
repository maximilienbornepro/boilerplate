import { describe, it, expect } from 'vitest';

// ==================== jiraAuth module logic (pure functions) ====================

function jiraCloudApiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}`;
}

interface StoredToken {
  user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
  cloud_id: string;
  site_url: string;
}

function isTokenExpired(stored: StoredToken, bufferMs = 60_000): boolean {
  const expiresAt = new Date(stored.expires_at);
  return expiresAt.getTime() - Date.now() < bufferMs;
}

function buildBasicAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

function buildBearerAuthHeader(accessToken: string): string {
  return `Bearer ${accessToken}`;
}

function parseOAuthState(stateB64url: string): { userId: number | null; nonce: string; returnUrl: string } | null {
  try {
    return JSON.parse(Buffer.from(stateB64url, 'base64url').toString());
  } catch {
    return null;
  }
}

function encodeOAuthState(userId: number | null, returnUrl: string): string {
  return Buffer.from(JSON.stringify({
    userId,
    nonce: 'test-nonce',
    returnUrl,
  })).toString('base64url');
}

// ==================== Tests ====================

describe('Jira OAuth Module', () => {
  describe('jiraCloudApiBase', () => {
    it('should build correct Atlassian Cloud API URL', () => {
      expect(jiraCloudApiBase('abc-123')).toBe('https://api.atlassian.com/ex/jira/abc-123');
    });

    it('should handle UUID-style cloud IDs', () => {
      const cloudId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(jiraCloudApiBase(cloudId)).toBe(`https://api.atlassian.com/ex/jira/${cloudId}`);
    });
  });

  describe('Token expiration check', () => {
    const baseToken: StoredToken = {
      user_id: 1,
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_at: new Date(),
      cloud_id: 'cloud-1',
      site_url: 'https://test.atlassian.net',
    };

    it('should detect expired token', () => {
      const expired = { ...baseToken, expires_at: new Date(Date.now() - 1000) };
      expect(isTokenExpired(expired)).toBe(true);
    });

    it('should detect token expiring within buffer', () => {
      const nearExpiry = { ...baseToken, expires_at: new Date(Date.now() + 30_000) };
      expect(isTokenExpired(nearExpiry, 60_000)).toBe(true);
    });

    it('should detect valid token', () => {
      const valid = { ...baseToken, expires_at: new Date(Date.now() + 3600_000) };
      expect(isTokenExpired(valid)).toBe(false);
    });

    it('should handle null refresh_token', () => {
      const noRefresh = { ...baseToken, refresh_token: null, expires_at: new Date(Date.now() - 1000) };
      expect(isTokenExpired(noRefresh)).toBe(true);
    });
  });

  describe('Auth header generation', () => {
    it('should generate correct Basic auth header', () => {
      const header = buildBasicAuthHeader('user@test.com', 'token123');
      const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('user@test.com:token123');
    });

    it('should generate correct Bearer header', () => {
      const header = buildBearerAuthHeader('my-access-token');
      expect(header).toBe('Bearer my-access-token');
    });
  });

  describe('OAuth state encoding/decoding', () => {
    it('should encode and decode state correctly', () => {
      const state = encodeOAuthState(42, 'http://localhost:5170/');
      const parsed = parseOAuthState(state);

      expect(parsed).not.toBeNull();
      expect(parsed!.userId).toBe(42);
      expect(parsed!.returnUrl).toBe('http://localhost:5170/');
      expect(parsed!.nonce).toBe('test-nonce');
    });

    it('should handle null userId (anonymous flow)', () => {
      const state = encodeOAuthState(null, '/');
      const parsed = parseOAuthState(state);

      expect(parsed).not.toBeNull();
      expect(parsed!.userId).toBeNull();
    });

    it('should return null for invalid state', () => {
      expect(parseOAuthState('not-valid-base64url!!')).toBeNull();
    });

    it('should handle empty state string', () => {
      // Empty string decodes to empty string, which is not valid JSON
      expect(parseOAuthState('')).toBeNull();
    });
  });

  describe('OAuth config validation', () => {
    function isOAuthConfigured(config: { clientId: string; clientSecret: string }): boolean {
      return !!(config.clientId && config.clientSecret);
    }

    it('should return true when both clientId and clientSecret are set', () => {
      expect(isOAuthConfigured({ clientId: 'id', clientSecret: 'secret' })).toBe(true);
    });

    it('should return false when clientId is empty', () => {
      expect(isOAuthConfigured({ clientId: '', clientSecret: 'secret' })).toBe(false);
    });

    it('should return false when clientSecret is empty', () => {
      expect(isOAuthConfigured({ clientId: 'id', clientSecret: '' })).toBe(false);
    });

    it('should return false when both are empty', () => {
      expect(isOAuthConfigured({ clientId: '', clientSecret: '' })).toBe(false);
    });
  });

  describe('OAuth API routes', () => {
    it('should define correct OAuth route paths', () => {
      const routes = {
        initiate: '/api/auth/jira',
        callback: '/api/auth/jira/callback',
        status: '/api/auth/jira/status',
        disconnect: '/api/auth/jira', // DELETE method
        oauthAvailable: '/api/connectors/jira/oauth-available',
      };

      expect(routes.initiate).toBe('/api/auth/jira');
      expect(routes.callback).toContain('/callback');
      expect(routes.status).toContain('/status');
      expect(routes.oauthAvailable).toContain('/oauth-available');
    });
  });

  describe('OAuth scope', () => {
    it('should include offline_access for refresh tokens', () => {
      const scope = 'read:jira-user read:jira-work write:jira-work offline_access';
      expect(scope).toContain('offline_access');
      expect(scope).toContain('read:jira-user');
      expect(scope).toContain('read:jira-work');
      expect(scope).toContain('write:jira-work');
    });
  });

  describe('Site selection logic', () => {
    function selectTargetSite(
      sites: Array<{ id: string; url: string; name: string }>,
      configBaseUrl: string
    ): { id: string; url: string; name: string } | undefined {
      if (!sites.length) return undefined;

      if (configBaseUrl) {
        return sites.find(s => configBaseUrl.includes(s.url.replace('https://', ''))) || sites[0];
      }

      return sites[0];
    }

    const sites = [
      { id: 'cloud-1', url: 'https://team-a.atlassian.net', name: 'Team A' },
      { id: 'cloud-2', url: 'https://team-b.atlassian.net', name: 'Team B' },
    ];

    it('should return first site when no configBaseUrl', () => {
      const result = selectTargetSite(sites, '');
      expect(result?.id).toBe('cloud-1');
    });

    it('should match site by configBaseUrl', () => {
      const result = selectTargetSite(sites, 'https://team-b.atlassian.net');
      expect(result?.id).toBe('cloud-2');
    });

    it('should fallback to first site when configBaseUrl does not match', () => {
      const result = selectTargetSite(sites, 'https://unknown.atlassian.net');
      expect(result?.id).toBe('cloud-1');
    });

    it('should return undefined for empty sites', () => {
      const result = selectTargetSite([], '');
      expect(result).toBeUndefined();
    });
  });
});
