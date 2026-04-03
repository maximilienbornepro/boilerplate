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
  return title.replace(/^\[[A-Z][A-Z0-9_]+-\d+\]\s*/, '');
}

/**
 * Extracts the Jira key from a title formatted as "[PROJ-123] Summary".
 */
export function extractJiraKey(title: string): string | null {
  const match = title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\]/);
  return match ? match[1] : null;
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
