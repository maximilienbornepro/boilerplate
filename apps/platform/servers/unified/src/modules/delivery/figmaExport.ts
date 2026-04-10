/**
 * Figma export utilities for the delivery module.
 * Generates SVG cards for tasks and MEP markers that the Figma plugin
 * imports as nodes on the canvas. Migrated from delivery-process/figmaRoutes.ts
 * and adapted for the per-board duration model (agile + calendaire).
 */

// ── Project colors (matches delivery-process shared constants) ────────

export const PROJECT_FIGMA_COLORS: Record<string, { bg: string; badge: string; badgeText: string }> = {
  TVSMART: { bg: '#dbeafe', badge: '#3b82f6', badgeText: '#fff' },
  TVFREE:  { bg: '#f3f4f6', badge: '#1f2937', badgeText: '#fff' },
  TVORA:   { bg: '#ffedd5', badge: '#f97316', badgeText: '#fff' },
  TVSFR:   { bg: '#fee2e2', badge: '#dc2626', badgeText: '#fff' },
  TVFIRE:  { bg: '#fef9c3', badge: '#eab308', badgeText: '#000' },
};

export const STATUS_COLORS: Record<string, string> = {
  todo: '#6b7280',
  in_progress: '#3b82f6',
  done: '#059669',
  blocked: '#dc2626',
};

const STATUS_LABELS_FR: Record<string, string> = {
  todo: 'À FAIRE',
  in_progress: 'EN COURS',
  done: 'TERMINÉ',
  blocked: 'BLOQUÉ',
};

// ── Layout constants (must match code.js in the Figma plugin) ─────────

export const COLUMN_WIDTH = 560;
export const COLUMN_GAP = 140;

// ── SVG helpers ───────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface TaskForFigma {
  jiraKey: string;
  title: string;
  status: string;
  version: string | null;
  estimatedDays: number | null;
  colSpan: number;
}

export function generateTaskSvg(task: TaskForFigma): string {
  const colSpan = task.colSpan || 1;
  const width = colSpan * COLUMN_WIDTH - COLUMN_GAP;
  const height = 180;
  const padding = 20;

  const projectKey = task.jiraKey?.split('-')[0] || 'TVSMART';
  const colors = PROJECT_FIGMA_COLORS[projectKey] || PROJECT_FIGMA_COLORS.TVSMART;

  let badgeX = padding;
  const badgeY = padding + 24;
  const badges: string[] = [];

  // JIRA Key badge
  if (task.jiraKey) {
    const textWidth = task.jiraKey.length * 12 + 24;
    badges.push(`<rect x="${badgeX}" y="${badgeY - 20}" width="${textWidth}" height="32" rx="6" fill="${colors.badge}"/>`);
    badges.push(`<text x="${badgeX + textWidth / 2}" y="${badgeY}" font-size="18" font-weight="700" fill="${colors.badgeText}" text-anchor="middle" font-family="system-ui, sans-serif">${task.jiraKey}</text>`);
    badgeX += textWidth + 8;
  }

  // Estimated days badge
  if (task.estimatedDays) {
    const text = `${task.estimatedDays}j`;
    const textWidth = text.length * 12 + 24;
    badges.push(`<rect x="${badgeX}" y="${badgeY - 20}" width="${textWidth}" height="32" rx="6" fill="#0ea5e9"/>`);
    badges.push(`<text x="${badgeX + textWidth / 2}" y="${badgeY}" font-size="18" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">${text}</text>`);
  }

  // Status badge (top right)
  let statusBadge = '';
  if (task.status) {
    const statusColor = STATUS_COLORS[task.status] || '#6b7280';
    const statusLabel = STATUS_LABELS_FR[task.status] || task.status.toUpperCase();
    const statusWidth = statusLabel.length * 10 + 24;
    statusBadge = `<rect x="${width - padding - statusWidth}" y="${padding}" width="${statusWidth}" height="28" rx="6" fill="${statusColor}"/><text x="${width - padding - statusWidth / 2}" y="${padding + 20}" font-size="16" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">${statusLabel}</text>`;
  }

  // Version badge (bottom right)
  let versionBadge = '';
  if (task.version) {
    const versionWidth = task.version.length * 10 + 24;
    versionBadge = `<rect x="${width - padding - versionWidth}" y="${height - padding - 28}" width="${versionWidth}" height="28" rx="6" fill="#10b981"/><text x="${width - padding - versionWidth / 2}" y="${height - padding - 8}" font-size="16" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">${task.version}</text>`;
  }

  // Title with word wrap
  const maxCharsPerLine = Math.floor((width - 2 * padding) / 14);
  const words = task.title.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  const titleLines = lines
    .slice(0, 3)
    .map((line, i) =>
      `<tspan x="${padding}" dy="${i === 0 ? 0 : 28}">${escapeXml(line)}${i === 2 && lines.length > 3 ? '...' : ''}</tspan>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="12" fill="${colors.bg}" stroke="rgba(0,0,0,0.1)" stroke-width="2"/>
  ${badges.join('\n  ')}
  <text x="${padding}" y="${badgeY + 44}" font-size="22" font-weight="500" fill="#1f2937" font-family="system-ui, sans-serif">${titleLines}</text>
  ${statusBadge}
  ${versionBadge}
</svg>`;
}

export function generateMepMarkerSvg(version: string, date: string): string {
  const width = 120;
  const height = 60;
  const lineHeight = 1000;

  const formattedDate = date ? (() => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
  })() : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + lineHeight}" viewBox="0 0 ${width} ${height + lineHeight}">
  <line x1="${width / 2}" y1="0" x2="${width / 2}" y2="${height + lineHeight}" stroke="#ef4444" stroke-width="3" stroke-dasharray="8,4"/>
  <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ef4444"/>
  <text x="${width / 2}" y="24" font-size="14" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(version)}</text>
  <text x="${width / 2}" y="46" font-size="12" fill="#fecaca" text-anchor="middle" font-family="system-ui, sans-serif">${formattedDate}</text>
</svg>`;
}

/**
 * Normalize a raw Jira status string to a simple bucket.
 * Mirrors mapSimpleStatus from delivery utils.
 */
export function normalizeStatus(status: string | null | undefined): string {
  if (!status) return 'todo';
  const lower = status.toLowerCase().trim();
  const done = ['done', 'termine', 'terminé', 'closed', 'resolved', 'in test', 'en test', 'verified', 'verifie', 'vérifié', 'livraison', 'en livraison'];
  const todo = ['backlog', 'to do', 'todo', 'a faire', 'à faire', 'open', 'new', 'selected for development'];
  if (done.includes(lower)) return 'done';
  if (todo.includes(lower)) return 'todo';
  return 'in_progress';
}
