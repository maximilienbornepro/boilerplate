/**
 * Workflow-status → CSS color used by virtual delivery overlay rows.
 * Shared between `TaskBar` (renders the status dot and bar fill) and
 * `deliveryVirtualRow` (sets the Task color so the bar matches the dot).
 *
 * Values are CSS custom properties from the shared design system — the
 * EXACT same ones used by the delivery module (see
 * `apps/platform/src/modules/delivery/components/TaskBlock.module.css`).
 * Using the same vars guarantees pixel-perfect match in both light and
 * dark themes without any hex duplication.
 *
 * Delivery statuses come straight from `delivery_tasks.status`:
 *   'todo' | 'in_progress' | 'done' | 'blocked'
 *
 * Note: `--gray-500` is referenced by delivery but not defined in the
 * shared theme — it falls back to `--text-muted`, matching delivery's
 * actual rendering.
 */
export const STATUS_DOT_COLORS: Record<string, string> = {
  todo: 'var(--gray-500, var(--text-muted))',
  in_progress: 'var(--info)',
  done: 'var(--success)',
  blocked: 'var(--error)',
};

/** Fallback used when a status is missing or unknown. */
export const STATUS_DOT_FALLBACK = 'var(--text-muted)';

/**
 * Resolve a CSS color for a given status, falling back to a neutral muted
 * color for unknown / missing values. Pure — safe to call from rendering
 * code. The returned string can be used in inline styles:
 *   `style={{ background: getStatusColor(task.status) }}`
 */
export function getStatusColor(status: string | null | undefined): string {
  if (!status) return STATUS_DOT_FALLBACK;
  return STATUS_DOT_COLORS[status] ?? STATUS_DOT_FALLBACK;
}

/**
 * Normalize a raw delivery/Jira status string (e.g. "Terminé", "En Cours",
 * "Abandonné", "À faire") into the 3-bucket simple status used by the
 * roadmap overlay color map. Mirrors delivery's own `mapSimpleStatus`
 * helper so the colors match pixel-for-pixel on both modules.
 *
 * See `apps/platform/src/modules/delivery/utils/jiraUtils.ts`.
 */
const TODO_STATUSES = new Set([
  'backlog', 'to do', 'todo', 'a faire', 'à faire', 'open', 'new',
  'selected for development',
]);
const DONE_STATUSES = new Set([
  'done', 'termine', 'terminé', 'closed', 'resolved', 'in test', 'en test',
  'verified', 'verifie', 'vérifié', 'livraison', 'en livraison',
]);

export function normalizeStatus(status: string | null | undefined): 'todo' | 'in_progress' | 'done' {
  if (!status) return 'todo';
  const lower = status.toLowerCase().trim();
  if (DONE_STATUSES.has(lower)) return 'done';
  if (TODO_STATUSES.has(lower)) return 'todo';
  return 'in_progress';
}
