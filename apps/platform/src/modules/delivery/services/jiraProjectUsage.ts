/**
 * Tracks per-user Jira project usage frequency in localStorage so the most
 * frequently used projects appear at the top of project pickers across modals.
 *
 * Storage: a JSON map { [projectKey]: { count, lastUsed } } under STORAGE_KEY.
 * Sort: count DESC, then lastUsed DESC, then alphabetical by name (fallback).
 */

const STORAGE_KEY = 'boilerplate.jira.projectUsage.v1';
/** Cap stored entries to avoid unbounded growth. */
const MAX_ENTRIES = 50;

interface UsageEntry {
  count: number;
  lastUsed: number;
}

type UsageMap = Record<string, UsageEntry>;

function readUsage(): UsageMap {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UsageMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeUsage(map: UsageMap): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    // Trim to MAX_ENTRIES, keeping the most recently used.
    const entries = Object.entries(map).sort(
      (a, b) => b[1].lastUsed - a[1].lastUsed,
    );
    const trimmed: UsageMap = {};
    for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded, ignore */
  }
}

/** Increment the usage counter for a Jira project. Call after a successful selection. */
export function recordJiraProjectUsage(projectKey: string): void {
  if (!projectKey) return;
  const map = readUsage();
  const prev = map[projectKey];
  map[projectKey] = {
    count: (prev?.count ?? 0) + 1,
    lastUsed: Date.now(),
  };
  writeUsage(map);
}

/**
 * Sort projects so the most-used appear first.
 * Pure function — does not mutate the input array.
 */
export function sortJiraProjectsByUsage<T extends { key: string; name?: string }>(projects: T[]): T[] {
  const map = readUsage();
  return [...projects].sort((a, b) => {
    const ua = map[a.key];
    const ub = map[b.key];
    const ca = ua?.count ?? 0;
    const cb = ub?.count ?? 0;
    if (ca !== cb) return cb - ca;
    const la = ua?.lastUsed ?? 0;
    const lb = ub?.lastUsed ?? 0;
    if (la !== lb) return lb - la;
    return (a.name ?? a.key).localeCompare(b.name ?? b.key);
  });
}
