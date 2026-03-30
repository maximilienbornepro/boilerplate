import { useState, useEffect } from 'react';

/**
 * Hook to read platform-level feature flags.
 * Fetches from /api/platform/settings/public (authenticated).
 * Returns a record of { flagKey: boolean }.
 */
export function usePlatformSettings(): Record<string, boolean> {
  const [settings, setSettings] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/platform/settings/public', { credentials: 'include' })
      .then(r => {
        if (!r.ok) return {};
        return r.json();
      })
      .then((data: Record<string, boolean>) => setSettings(data))
      .catch(() => {/* silently fail — modules degrade gracefully */});
  }, []);

  return settings;
}
