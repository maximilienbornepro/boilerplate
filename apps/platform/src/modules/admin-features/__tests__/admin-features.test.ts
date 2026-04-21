import { describe, it, expect } from 'vitest';

/** The grouping + pretty-label helpers are pure string transformations
 *  exercised against every toggle key we seed server-side, so we can
 *  test them without importing React (which would pull vite-css). */

function groupOf(key: string): 'Connecteurs' | 'Modules' | 'Intégrations' | 'Autres' {
  if (key.startsWith('connector_')) return 'Connecteurs';
  if (key.startsWith('module_')) return 'Modules';
  if (key.startsWith('integration_')) return 'Intégrations';
  return 'Autres';
}

function prettyLabel(key: string): string {
  const stripped = key
    .replace(/^connector_/, '')
    .replace(/^module_/, '')
    .replace(/^integration_/, '')
    .replace(/_enabled$/, '')
    .replace(/_/g, ' ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

describe('admin-features helpers', () => {
  it('groups connector keys under Connecteurs', () => {
    expect(groupOf('connector_gmail_enabled')).toBe('Connecteurs');
    expect(groupOf('connector_jira_enabled')).toBe('Connecteurs');
  });

  it('groups module keys under Modules', () => {
    expect(groupOf('module_suivitess_enabled')).toBe('Modules');
    expect(groupOf('module_roadmap_enabled')).toBe('Modules');
  });

  it('groups integration keys under Intégrations', () => {
    expect(groupOf('integration_roadmap_suivitess')).toBe('Intégrations');
  });

  it('falls back to Autres for unknown prefixes', () => {
    expect(groupOf('credits_enabled')).toBe('Autres');
    expect(groupOf('feature_flag_xyz')).toBe('Autres');
  });

  it('produces a readable label from a key', () => {
    expect(prettyLabel('connector_gmail_enabled')).toBe('Gmail');
    expect(prettyLabel('module_suivitess_enabled')).toBe('Suivitess');
    expect(prettyLabel('connector_teams_recorder_enabled')).toBe('Teams recorder');
    expect(prettyLabel('integration_roadmap_suivitess')).toBe('Roadmap suivitess');
  });
});
