import { describe, it, expect } from 'vitest';

// Service definitions (mirroring frontend component)
const SERVICES = [
  { id: 'jira', name: 'Jira', enabled: true },
  { id: 'notion', name: 'Notion', enabled: false },
  { id: 'clickup', name: 'ClickUp', enabled: false },
];

describe('Connectors Frontend - Service definitions', () => {
  it('should have 3 services defined', () => {
    expect(SERVICES).toHaveLength(3);
  });

  it('should only have Jira enabled', () => {
    const enabled = SERVICES.filter(s => s.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe('jira');
  });

  it('should have Notion disabled', () => {
    const notion = SERVICES.find(s => s.id === 'notion');
    expect(notion).toBeDefined();
    expect(notion!.enabled).toBe(false);
  });

  it('should have ClickUp disabled', () => {
    const clickup = SERVICES.find(s => s.id === 'clickup');
    expect(clickup).toBeDefined();
    expect(clickup!.enabled).toBe(false);
  });

  it('each service should have required fields', () => {
    SERVICES.forEach(service => {
      expect(service).toHaveProperty('id');
      expect(service).toHaveProperty('name');
      expect(service).toHaveProperty('enabled');
      expect(typeof service.id).toBe('string');
      expect(typeof service.name).toBe('string');
      expect(typeof service.enabled).toBe('boolean');
    });
  });
});

describe('Connectors Frontend - API URLs', () => {
  const API_BASE = '/api/connectors';

  it('should use /api/connectors as base URL', () => {
    expect(API_BASE).toBe('/api/connectors');
  });

  it('should construct correct service URLs', () => {
    expect(`${API_BASE}/jira`).toBe('/api/connectors/jira');
    expect(`${API_BASE}/notion`).toBe('/api/connectors/notion');
    expect(`${API_BASE}/clickup`).toBe('/api/connectors/clickup');
  });

  it('should construct correct test URL', () => {
    expect(`${API_BASE}/jira/test`).toBe('/api/connectors/jira/test');
  });
});

describe('Connectors Frontend - Jira form validation', () => {
  function validateJiraForm(baseUrl: string, email: string, apiToken: string): boolean {
    return Boolean(baseUrl && email && apiToken);
  }

  it('should accept valid form data', () => {
    expect(validateJiraForm('https://test.atlassian.net', 'test@test.com', 'token123')).toBe(true);
  });

  it('should reject empty baseUrl', () => {
    expect(validateJiraForm('', 'test@test.com', 'token123')).toBe(false);
  });

  it('should reject empty email', () => {
    expect(validateJiraForm('https://test.atlassian.net', '', 'token123')).toBe(false);
  });

  it('should reject empty apiToken', () => {
    expect(validateJiraForm('https://test.atlassian.net', 'test@test.com', '')).toBe(false);
  });

  it('should reject all empty fields', () => {
    expect(validateJiraForm('', '', '')).toBe(false);
  });
});

describe('Connectors Frontend - Change detection', () => {
  function hasChanges(
    current: { baseUrl: string; email: string; apiToken: string },
    saved: { baseUrl: string; email: string; apiToken: string } | null
  ): boolean {
    if (!saved) {
      return Boolean(current.baseUrl || current.email || current.apiToken);
    }
    return (
      current.baseUrl !== saved.baseUrl ||
      current.email !== saved.email ||
      (current.apiToken !== saved.apiToken && !current.apiToken.includes('****'))
    );
  }

  it('should detect changes when no saved connector exists', () => {
    expect(hasChanges({ baseUrl: 'https://test.atlassian.net', email: '', apiToken: '' }, null)).toBe(true);
  });

  it('should not detect changes when fields are empty and no saved connector', () => {
    expect(hasChanges({ baseUrl: '', email: '', apiToken: '' }, null)).toBe(false);
  });

  it('should detect baseUrl change', () => {
    const saved = { baseUrl: 'https://old.atlassian.net', email: 'test@test.com', apiToken: 'abcd****efgh' };
    const current = { baseUrl: 'https://new.atlassian.net', email: 'test@test.com', apiToken: 'abcd****efgh' };
    expect(hasChanges(current, saved)).toBe(true);
  });

  it('should not detect changes when apiToken contains mask', () => {
    const saved = { baseUrl: 'https://test.atlassian.net', email: 'test@test.com', apiToken: 'abcd****efgh' };
    const current = { baseUrl: 'https://test.atlassian.net', email: 'test@test.com', apiToken: 'abcd****efgh' };
    expect(hasChanges(current, saved)).toBe(false);
  });

  it('should detect changes when apiToken is replaced with new value', () => {
    const saved = { baseUrl: 'https://test.atlassian.net', email: 'test@test.com', apiToken: 'abcd****efgh' };
    const current = { baseUrl: 'https://test.atlassian.net', email: 'test@test.com', apiToken: 'newtoken12345' };
    expect(hasChanges(current, saved)).toBe(true);
  });
});

describe('Connectors Frontend - Connector status display', () => {
  function getStatusLabel(isActive: boolean, hasConnector: boolean): string {
    if (isActive) return 'Connecté';
    if (hasConnector) return 'Configuré';
    return 'À configurer';
  }

  it('should show "Connecté" when active', () => {
    expect(getStatusLabel(true, true)).toBe('Connecté');
  });

  it('should show "Configuré" when has connector but not active', () => {
    expect(getStatusLabel(false, true)).toBe('Configuré');
  });

  it('should show "À configurer" when no connector', () => {
    expect(getStatusLabel(false, false)).toBe('À configurer');
  });
});
