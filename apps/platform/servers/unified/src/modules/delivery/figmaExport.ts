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

/** Children rendered inside a container SVG. Mirrors the chip metadata
 *  rendered by the React TaskBlock so the Figma export looks like the
 *  on-screen container (title + total days + stacked chips). */
export interface ContainerChildForFigma {
  jiraKey: string;
  title: string;
  status: string;
  storyPoints: number | null;
}

/**
 * Render a "container" task (a manual parent that groups N child Jira
 * tickets, e.g. the "Anomalie" container) as a Figma-paste-ready SVG.
 * Differs from `generateTaskSvg` in that children are visually nested
 * inside the box as chips — so the Figma node mirrors the on-screen
 * container 1:1 instead of a flat card.
 *
 * Layout (per chip row, top→bottom) :
 *   [statusDot]  [jiraKey badge]  [title]  [storyPoints]
 *
 * Container box height grows with `children.length`. Capped at
 * MAX_VISIBLE_CHIPS to keep the export from blowing up on huge
 * containers — the same cap used in the React component.
 */
const MAX_VISIBLE_CHIPS = 12;
const CHIP_HEIGHT = 36;
const CHIP_GAP = 6;

export function generateContainerSvg(
  task: TaskForFigma,
  children: ContainerChildForFigma[],
): string {
  const colSpan = task.colSpan || 1;
  const width = colSpan * COLUMN_WIDTH - COLUMN_GAP;
  const padding = 20;

  const visibleChildren = children.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = Math.max(0, children.length - MAX_VISIBLE_CHIPS);

  // Header row (title + total days) ~ 56px, optional "and N more" line,
  // then one row per visible chip + bottom padding.
  const headerHeight = 56;
  const moreHintHeight = hiddenCount > 0 ? 24 : 0;
  const chipsTotal = visibleChildren.length * (CHIP_HEIGHT + CHIP_GAP);
  const height = Math.max(120, headerHeight + chipsTotal + moreHintHeight + padding);

  const totalDays = children.reduce((sum, c) => {
    // We only export storyPoints today — `estimatedDays` is not in the
    // child shape produced by the route. Treat 1 SP ≈ 1 day for the
    // visual badge (same heuristic the React component uses).
    return sum + (c.storyPoints ?? 0);
  }, 0);

  // Header
  let header = `<text x="${padding}" y="${padding + 22}" font-size="20" font-weight="700" fill="#1f2937" font-family="system-ui, sans-serif">${escapeXml(task.title)}</text>`;
  if (totalDays > 0) {
    const txt = `${totalDays}j`;
    const w = txt.length * 11 + 18;
    header += `<rect x="${width - padding - w}" y="${padding}" width="${w}" height="28" rx="6" fill="#0ea5e9"/>`;
    header += `<text x="${width - padding - w / 2}" y="${padding + 20}" font-size="14" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">${txt}</text>`;
  }

  // Stacked child chips
  const chipParts: string[] = [];
  visibleChildren.forEach((c, i) => {
    const y = headerHeight + i * (CHIP_HEIGHT + CHIP_GAP);
    const statusColor = STATUS_COLORS[c.status] || '#6b7280';
    const projectKey = c.jiraKey?.split('-')[0] || '';
    const colors = PROJECT_FIGMA_COLORS[projectKey] || PROJECT_FIGMA_COLORS.TVSMART;

    // Chip background
    chipParts.push(`<rect x="${padding}" y="${y}" width="${width - 2 * padding}" height="${CHIP_HEIGHT}" rx="6" fill="#ffffff" stroke="rgba(0,0,0,0.08)"/>`);

    // Status dot (left)
    let cursorX = padding + 12;
    chipParts.push(`<circle cx="${cursorX}" cy="${y + CHIP_HEIGHT / 2}" r="5" fill="${statusColor}"/>`);
    cursorX += 14;

    // Jira key badge
    if (c.jiraKey) {
      const kw = c.jiraKey.length * 8 + 12;
      chipParts.push(`<rect x="${cursorX}" y="${y + 8}" width="${kw}" height="20" rx="4" fill="${colors.badge}"/>`);
      chipParts.push(`<text x="${cursorX + kw / 2}" y="${y + 22}" font-size="12" font-weight="700" fill="${colors.badgeText}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(c.jiraKey)}</text>`);
      cursorX += kw + 8;
    }

    // Story points pill on the right
    let titleEndX = width - padding - 8;
    if (c.storyPoints != null) {
      const sp = `${c.storyPoints}`;
      const spw = sp.length * 9 + 14;
      chipParts.push(`<rect x="${width - padding - 8 - spw}" y="${y + 8}" width="${spw}" height="20" rx="10" fill="#eef2ff"/>`);
      chipParts.push(`<text x="${width - padding - 8 - spw / 2}" y="${y + 22}" font-size="12" font-weight="600" fill="#4338ca" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(sp)}</text>`);
      titleEndX = width - padding - 8 - spw - 10;
    }

    // Title (truncated to fit)
    const availPx = Math.max(40, titleEndX - cursorX);
    const charsAvail = Math.floor(availPx / 7.5);
    const truncated = c.title.length > charsAvail
      ? c.title.slice(0, Math.max(0, charsAvail - 1)) + '…'
      : c.title;
    chipParts.push(`<text x="${cursorX}" y="${y + 22}" font-size="13" fill="#1f2937" font-family="system-ui, sans-serif">${escapeXml(truncated)}</text>`);
  });

  // "+N de plus" hint when chips were capped
  let moreHint = '';
  if (hiddenCount > 0) {
    const y = headerHeight + visibleChildren.length * (CHIP_HEIGHT + CHIP_GAP) + 4;
    moreHint = `<text x="${padding}" y="${y + 14}" font-size="12" fill="#6b7280" font-style="italic" font-family="system-ui, sans-serif">+${hiddenCount} ticket${hiddenCount > 1 ? 's' : ''} non affiché${hiddenCount > 1 ? 's' : ''}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="14" fill="#f9fafb" stroke="#9ca3af" stroke-width="2" stroke-dasharray="6,4"/>
  ${header}
  ${chipParts.join('\n  ')}
  ${moreHint}
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
