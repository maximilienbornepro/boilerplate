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
