export type DeliveryTaskType = 'feature' | 'tech' | 'bug';

/**
 * Maps a Jira issue type name to a delivery task type.
 * Bug → bug
 * Story/Epic → feature
 * Everything else → tech
 */
export function mapIssueType(issueType: string): DeliveryTaskType {
  const lower = issueType.toLowerCase();
  if (lower === 'bug') return 'bug';
  if (lower === 'story' || lower === 'epic') return 'feature';
  return 'tech';
}

/**
 * Formats a Jira issue as a delivery task title.
 * ex: "[PROJ-42] Fix login bug"
 */
export function formatJiraTitle(key: string, summary: string): string {
  return `[${key}] ${summary}`;
}

/**
 * Strips the Jira key prefix from a title.
 * ex: "[PROJ-42] Fix login bug" → "Fix login bug"
 * Returns the original title if no prefix found.
 */
export function stripJiraKey(title: string): string {
  // Remove bracketed format: [KEY-123] Summary
  const stripped = title.replace(/^\[[A-Z][A-Z0-9_]+-\d+\]\s*/, '');
  if (stripped !== title) return stripped;
  // Remove bare format: KEY-123 — Summary  or  KEY-123 Summary
  return title.replace(/^[A-Z][A-Z0-9_]+-\d+\s*[—–\-]\s*/, '')
              .replace(/^[A-Z][A-Z0-9_]+-\d+\s+/, '');
}

/**
 * Extracts the Jira key from a title formatted as "[PROJ-123] Summary".
 */
/**
 * Extracts a Jira / external key from a task title.
 * Supports two formats:
 *   - "[KEY-123] Summary"   → "KEY-123"  (boilerplate import format)
 *   - "KEY-123 — Summary"   → "KEY-123"  (delivery-process legacy format)
 *   - "KEY-123"              → "KEY-123"  (key-only)
 */
export function extractJiraKey(title: string): string | null {
  // Try bracketed format first : [KEY-123]
  const bracketed = title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\]/);
  if (bracketed) return bracketed[1];
  // Then try bare format : KEY-123 at the start of the string
  const bare = title.match(/^([A-Z][A-Z0-9_]+-\d+)\b/);
  return bare ? bare[1] : null;
}

/**
 * Builds the Jira browse URL for a given key and base URL.
 */
export function buildJiraUrl(baseUrl: string, key: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/browse/${key}`;
}

/**
 * Simplified status for display in container chips.
 */
export type SimpleStatus = 'todo' | 'in_progress' | 'done';

const TODO_STATUSES = ['backlog', 'to do', 'todo', 'a faire', 'à faire', 'open', 'new', 'selected for development'];
const DONE_STATUSES = ['done', 'termine', 'terminé', 'closed', 'resolved', 'in test', 'en test', 'verified', 'verifie', 'vérifié', 'livraison', 'en livraison'];

/**
 * Maps a raw Jira/task status string to one of 3 simple statuses.
 */
export function mapSimpleStatus(status: string | undefined | null): SimpleStatus {
  if (!status) return 'todo';
  const lower = status.toLowerCase().trim();
  if (DONE_STATUSES.includes(lower)) return 'done';
  if (TODO_STATUSES.includes(lower)) return 'todo';
  return 'in_progress';
}
