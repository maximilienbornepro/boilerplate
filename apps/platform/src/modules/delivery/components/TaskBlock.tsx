import { useState, useRef, useCallback } from 'react';
import type { Task } from '../types';
import { stripJiraKey, mapSimpleStatus, extractJiraKey, buildJiraUrl } from '../utils/jiraUtils';
import type { SimpleStatus } from '../utils/jiraUtils';
import styles from './TaskBlock.module.css';

const STATUS_DOT_COLORS: Record<SimpleStatus, string> = {
  todo: 'var(--gray-500)',
  in_progress: 'var(--info)',
  done: 'var(--success)',
};

// Max chips visible in a container before showing the "+N" indicator
const MAX_VISIBLE_CHIPS = 3;

const getStatusInfo = (status?: string): { label: string; className: string } | null => {
  if (!status) return null;
  switch (status) {
    case 'in_progress': return { label: 'En cours', className: styles.statusEnCours };
    case 'blocked':     return { label: 'Bloque',   className: styles.statusBloque };
    case 'todo':        return { label: 'A faire',  className: styles.statusAFaire };
    case 'done':        return { label: 'Done',     className: styles.statusDone };
    default:            return { label: status,     className: styles.statusAFaire };
  }
};

// Per-project card background colors (dark theme friendly)
const PROJECT_CARD_COLORS: Record<string, string> = {
  TVSMART: '#1e3a5f',   // dark blue
  TVFREE:  '#2d2d2d',   // dark gray
  TVORA:   '#4a2c10',   // dark orange
  TVSFR:   '#4a1010',   // dark red
  TVFIRE:  '#4a3d10',   // dark yellow
  PLAYERW: '#2d1a4a',   // dark purple
  TVAPI:   '#0a3d3d',   // dark cyan
  TVAPPS:  '#0a3d2d',   // dark teal
};

const PROJECT_BADGE_COLORS: Record<string, string> = {
  TVSMART: '#3b82f6', TVFREE: '#6b7280', TVORA: '#f97316',
  TVSFR: '#dc2626', TVFIRE: '#eab308', PLAYERW: '#8b5cf6',
  TVAPI: '#06b6d4', TVAPPS: '#14b8a6',
};

const getTaskColor = (task: Task): string => {
  // For Jira tasks, use project-based color
  if (task.source === 'jira') {
    const key = extractJiraKey(task.title);
    if (key) {
      const project = key.split('-')[0];
      return PROJECT_CARD_COLORS[project] || '#1a1a2e';
    }
  }
  if (task.type === 'tech')      return 'var(--task-tech, var(--indigo-200))';
  if (task.type === 'bug')       return 'var(--task-bug, var(--red-200))';
  if (task.type === 'milestone') return 'var(--task-milestone, var(--amber-200))';
  return 'var(--task-default, var(--purple-200))';
};

interface TaskBlockProps {
  task: Task;
  totalCols: number;
  rowHeight: number;
  readOnly?: boolean;
  onUpdate?: (taskId: string, updates: Partial<Task>) => void;
  onDelete?: (taskId: string) => void;
  onResize?: (taskId: string, newStartCol: number, newEndCol: number) => void;
  onMove?: (taskId: string, newStartCol: number, newRow: number) => void;
  onNestTask?: (childId: string, containerId: string) => void;
  onUnnest?: (childId: string) => void;
  jiraBaseUrl?: string | null;
  /** Called when a container is dragged and released over a different
   *  project row label (detected via elementsFromPoint on mouseup). */
  onProjectDrop?: (taskId: string, project: string) => void;
}

export function TaskBlock({
  task, totalCols, rowHeight, readOnly = false,
  onUpdate, onDelete, onResize, onMove, onNestTask, onUnnest, jiraBaseUrl, onProjectDrop,
}: TaskBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [editedDescription, setEditedDescription] = useState(task.description ?? '');
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showHiddenChips, setShowHiddenChips] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startColRef = useRef({ start: 0, end: 0 });
  const startRowRef = useRef(0);

  const isContainer = task.source === 'manual';
  const startCol = task.startCol ?? 0;
  const endCol = task.endCol ?? startCol + 1;
  const row = task.row ?? 0;
  const taskWidth = endCol - startCol;
  const gap = 3;
  const widthPercent = (taskWidth / totalCols) * 100;
  const leftPercent = (startCol / totalCols) * 100;
  const children = task.children ?? [];
  const visibleChips = children.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = children.length - MAX_VISIBLE_CHIPS;

  const statusInfo = getStatusInfo(task.status);

  // ── Context menu handlers ──
  const handleHideTask = useCallback(() => {
    setShowMenu(false);
    setShowConfirmDialog(true);
  }, []);

  const handleConfirmHide = useCallback(() => {
    setShowConfirmDialog(false);
    onDelete?.(task.id);
  }, [onDelete, task.id]);

  const handleCancelHide = useCallback(() => setShowConfirmDialog(false), []);

  // ── Double-click behaviour ──
  const handleTaskDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('a') || target.closest('input') || target.closest(`.${styles.resizeHandle}`) || target.closest(`.${styles.childChip}`)) return;
    if (isDragging || isResizing) return;

    e.stopPropagation();

    if (isContainer) {
      // Container: open edit modal directly
      setEditedTitle(task.title);
      setEditedDescription(task.description ?? '');
      setIsEditing(true);
    } else {
      // Regular task: toggle context menu
      setShowMenu(!showMenu);
    }
  }, [isDragging, isResizing, isContainer, showMenu, task.title, task.description]);

  const handleSaveEdit = () => {
    if (onUpdate) {
      const updates: Partial<Task> = {};
      if (editedTitle.trim() && editedTitle.trim() !== task.title) updates.title = editedTitle.trim();
      if (editedDescription !== (task.description ?? '')) updates.description = editedDescription || null;
      if (Object.keys(updates).length > 0) onUpdate(task.id, updates);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveEdit();
    else if (e.key === 'Escape') setIsEditing(false);
  };

  // ── Resize ──
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'left' | 'right') => {
    if (readOnly || !onResize) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(direction);
    startXRef.current = e.clientX;
    startColRef.current = { start: startCol, end: endCol };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!blockRef.current?.parentElement) return;
      const colWidth = blockRef.current.parentElement.offsetWidth / totalCols;
      const deltaCols = Math.round((moveEvent.clientX - startXRef.current) / colWidth);
      if (direction === 'right') {
        const newEndCol = Math.max(startColRef.current.start + 1, Math.min(totalCols, startColRef.current.end + deltaCols));
        if (newEndCol !== endCol) onResize(task.id, startColRef.current.start, newEndCol);
      } else {
        const newStartCol = Math.max(0, Math.min(startColRef.current.end - 1, startColRef.current.start + deltaCols));
        if (newStartCol !== startCol) onResize(task.id, newStartCol, startColRef.current.end);
      }
    };
    const handleMouseUp = () => {
      setIsResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [readOnly, startCol, endCol, totalCols, task.id, onResize]);

  // ── Drag ──
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isEditing || isResizing || readOnly) return;
    if (!onMove && !onNestTask) return;
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.resizeHandle}`) || target.closest(`.${styles.deleteBtn}`) || target.closest(`.${styles.childChip}`)) return;

    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startColRef.current = { start: startCol, end: endCol };
    startRowRef.current = row;

    let dragStarted = false;
    let currentHighlightEl: Element | null = null;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startXRef.current;
      const dy = moveEvent.clientY - startYRef.current;

      if (!dragStarted) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        dragStarted = true;
        moveEvent.preventDefault();
        setIsDragging(true);
        setDragOffset({ x: 0, y: 0 });
      }

      setDragOffset({ x: moveEvent.clientX - startXRef.current, y: moveEvent.clientY - startYRef.current });

      if (task.source === 'jira' && onNestTask) {
        const elements = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
        let newHighlightEl: Element | null = null;
        for (const el of elements) {
          if (blockRef.current?.contains(el) || el === blockRef.current) continue;
          const container = el.closest('[data-container-id]') as Element | null;
          if (container) { newHighlightEl = container; break; }
        }
        if (newHighlightEl !== currentHighlightEl) {
          if (currentHighlightEl) currentHighlightEl.removeAttribute('data-drop-active');
          currentHighlightEl = newHighlightEl;
          if (currentHighlightEl) currentHighlightEl.setAttribute('data-drop-active', 'true');
        }
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      if (currentHighlightEl) { currentHighlightEl.removeAttribute('data-drop-active'); currentHighlightEl = null; }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (!dragStarted) return;

      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });

      // Check for container drop (Jira tasks only)
      if (task.source === 'jira' && onNestTask) {
        const elements = document.elementsFromPoint(upEvent.clientX, upEvent.clientY);
        for (const el of elements) {
          if (blockRef.current?.contains(el) || el === blockRef.current) continue;
          const container = el.closest('[data-container-id]') as Element | null;
          if (container) {
            const containerId = container.getAttribute('data-container-id');
            if (containerId) { onNestTask(task.id, containerId); return; }
          }
        }
      }

      // Cross-row move for containers: check if the cursor landed on a
      // project row label. We check bounding rects directly instead of
      // elementsFromPoint because data-project sits on .rowLabel (sibling
      // of .timeline, not ancestor), so closest() from timeline children
      // would never find it.
      if (isContainer && onProjectDrop) {
        const labels = document.querySelectorAll('[data-project]');
        for (const label of labels) {
          const rect = label.getBoundingClientRect();
          if (
            upEvent.clientX >= rect.left && upEvent.clientX <= rect.right &&
            upEvent.clientY >= rect.top && upEvent.clientY <= rect.bottom
          ) {
            const targetProject = label.getAttribute('data-project');
            if (targetProject) {
              onProjectDrop(task.id, targetProject);
              return;
            }
          }
        }
      }

      // Normal move (within the same row)
      if (!blockRef.current?.parentElement || !onMove) return;
      const colWidth = blockRef.current.parentElement.offsetWidth / totalCols;
      const deltaCols = Math.round((upEvent.clientX - startXRef.current) / colWidth);
      const deltaRows = Math.round((upEvent.clientY - startYRef.current) / rowHeight);
      const newStartCol = Math.max(0, Math.min(totalCols - taskWidth, startColRef.current.start + deltaCols));
      const newRow = Math.max(0, startRowRef.current + deltaRows);
      if (newStartCol !== startCol || newRow !== row) onMove(task.id, newStartCol, newRow);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [isEditing, isResizing, readOnly, startCol, endCol, row, totalCols, rowHeight, task.id, task.source, taskWidth, onMove, onNestTask, isContainer, onProjectDrop]);

  // ── Styles ──
  const blockStyle: React.CSSProperties = {
    left: `calc(${leftPercent}% + ${gap}px)`,
    width: `calc(${widthPercent}% - ${gap * 2}px)`,
    top: `${20 + row * rowHeight}px`,
    transform: isDragging ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
  };

  if (isContainer) {
    // Dynamic height: the container grows to fit its title, optional
    // description, and up to 3 chips (+ the "•••" more indicator when
    // there are 4+ children). CSS `.containerBlock { min-height: ... }`
    // floors the size so an empty container stays usable.
    blockStyle.height = 'auto';
  } else {
    blockStyle.background = getTaskColor(task);
  }

  return (
    <div
      ref={blockRef}
      className={[
        styles.taskBlock,
        isContainer ? styles.containerBlock : '',
        isResizing ? styles.resizing : '',
        isDragging ? styles.dragging : '',
      ].filter(Boolean).join(' ')}
      data-container-id={isContainer ? task.id : undefined}
      style={blockStyle}
      onMouseLeave={() => setShowMenu(false)}
      onDoubleClick={handleTaskDoubleClick}
      onMouseDown={handleDragStart}
    >
      {/* Left resize handle */}
      {!readOnly && (
        <div className={`${styles.resizeHandle} ${styles.resizeLeft}`} onMouseDown={(e) => handleResizeStart(e, 'left')} />
      )}

      {/* ── Container content ── */}
      {isContainer ? (
        <div className={styles.containerContent}>
          <div className={styles.containerHeader}>
            <span className={styles.containerTitle}>{task.title}</span>
            {(() => {
              const totalDays = children.reduce((sum, c) => sum + (c.estimatedDays || 0), 0);
              return totalDays > 0 ? (
                <span className={styles.containerDaysBadge}>{totalDays}j</span>
              ) : null;
            })()}
          </div>

          {task.description && (
            <p className={styles.containerDescription}>{task.description}</p>
          )}

          {children.length > 0 ? (
            <div className={styles.childChipList}>
              {visibleChips.map(child => {
                const jiraKey = extractJiraKey(child.title);
                const chipUrl = jiraKey && jiraBaseUrl ? buildJiraUrl(jiraBaseUrl, jiraKey) : null;
                return (
                  <div key={child.id} className={styles.childChip}>
                    <span className={styles.statusDot} style={{ background: STATUS_DOT_COLORS[mapSimpleStatus(child.status)] }} title={child.status ?? ''} />
                    {chipUrl ? (
                      <a href={chipUrl} target="_blank" rel="noopener noreferrer" className={styles.childChipLink} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                        {stripJiraKey(child.title)}
                      </a>
                    ) : (
                      <span className={styles.childChipTitle}>{stripJiraKey(child.title)}</span>
                    )}
                    {!readOnly && onUnnest && (
                      <button className={styles.childChipRemove} onClick={(e) => { e.stopPropagation(); onUnnest(child.id); }} onMouseDown={(e) => e.stopPropagation()} title="Retirer du conteneur">×</button>
                    )}
                    {child.storyPoints != null && (
                      <span className={styles.chipPoints}>{child.storyPoints}</span>
                    )}
                  </div>
                );
              })}
              {hiddenCount > 0 && (
                <div className={styles.moreChipsIndicator} onMouseEnter={() => setShowHiddenChips(true)} onMouseLeave={() => setShowHiddenChips(false)} onMouseDown={(e) => e.stopPropagation()}>
                  <span>•••</span>
                  <span className={styles.moreChipsCount}>+{hiddenCount}</span>
                  {showHiddenChips && (
                    <div className={styles.hiddenChipsTooltip} onMouseEnter={() => setShowHiddenChips(true)} onMouseLeave={() => setShowHiddenChips(false)} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      <div className={styles.hiddenChipsTooltipInner}>
                        {children.slice(MAX_VISIBLE_CHIPS).map(child => {
                          const jiraKey = extractJiraKey(child.title);
                          const chipUrl = jiraKey && jiraBaseUrl ? buildJiraUrl(jiraBaseUrl, jiraKey) : null;
                          return (
                            <div key={child.id} className={styles.tooltipChip}>
                              <span className={styles.statusDot} style={{ background: STATUS_DOT_COLORS[mapSimpleStatus(child.status)] }} />
                              {chipUrl ? (
                                <a href={chipUrl} target="_blank" rel="noopener noreferrer" className={styles.tooltipChipLink} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                                  {stripJiraKey(child.title)}
                                </a>
                              ) : (
                                <span className={styles.tooltipChipTitle}>{stripJiraKey(child.title)}</span>
                              )}
                              {child.storyPoints != null && (
                                <span className={styles.chipPoints}>{child.storyPoints}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.containerEmpty}>Glisser des tickets Jira ici</div>
          )}
        </div>
      ) : (
        /* ── Regular task content ── */
        <div className={styles.content}>
          <div className={styles.badgeRow}>
            {(() => {
              const jiraKey = extractJiraKey(task.title);
              const project = jiraKey?.split('-')[0];
              const badgeColor = project ? PROJECT_BADGE_COLORS[project] || '#6b7280' : undefined;
              if (!jiraKey) return null;
              const jiraUrl = jiraKey && jiraBaseUrl ? buildJiraUrl(jiraBaseUrl, jiraKey) : null;
              return jiraUrl ? (
                <a
                  href={jiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.jiraKeyBadge}
                  style={{ background: badgeColor }}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
                >
                  {jiraKey}
                </a>
              ) : (
                <span className={styles.jiraKeyBadge} style={{ background: badgeColor }}>{jiraKey}</span>
              );
            })()}
            {task.estimatedDays && <span className={styles.daysBadge}>{task.estimatedDays}j</span>}
            {task.type === 'tech' && <span className={styles.techBadge}>TECH</span>}
            {task.type === 'bug'  && <span className={styles.bugBadge}>BUG</span>}
          </div>
          <span className={styles.taskTitle}>{stripJiraKey(task.title)}</span>
          {task.description && task.source === 'jira' && /^\d+\.\d+/.test(task.description) && (
            <span className={styles.versionBadge}>{task.description}</span>
          )}
        </div>
      )}

      {/* Status badge — regular tasks only */}
      {!isContainer && statusInfo && (
        <span className={`${styles.statusBadge} ${statusInfo.className}`} title={`Statut: ${task.status}`}>
          {statusInfo.label}
        </span>
      )}

      {/* Assignee badge — regular tasks only */}
      {!isContainer && task.assignee && (
        <span className={styles.assigneeBadge} title={`Assignee: ${task.assignee}`}>
          {task.assignee.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
        </span>
      )}

      {/* Context menu — regular tasks only */}
      {!isContainer && showMenu && !isDragging && (
        <div className={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          <div className={styles.contextMenuInner}>
            {!readOnly && onUpdate && (
              <button className={styles.menuItem} onClick={() => { setShowMenu(false); setEditedTitle(task.title); setIsEditing(true); }} onMouseDown={(e) => e.stopPropagation()}>
                <span className={styles.menuIcon}>&#9998;</span>
                <span>Renommer</span>
              </button>
            )}
            {!readOnly && onDelete && (
              <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={handleHideTask} onMouseDown={(e) => e.stopPropagation()}>
                <span className={styles.menuIcon}>&#128064;</span>
                <span>Masquer</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hide confirmation */}
      {showConfirmDialog && (
        <div className={styles.confirmOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.confirmDialog}>
            <p className={styles.confirmText}>Masquer cette tâche ?</p>
            <p className={styles.confirmSubtext}>Elle pourra être restaurée depuis le menu</p>
            <div className={styles.confirmButtons}>
              <button className={styles.confirmCancel} onClick={handleCancelHide} onMouseDown={(e) => e.stopPropagation()}>Annuler</button>
              <button className={styles.confirmOk} onClick={handleConfirmHide} onMouseDown={(e) => e.stopPropagation()}>Masquer</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal — containers & regular tasks */}
      {isEditing && (
        <div className={styles.confirmOverlay} onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}>
          <div className={styles.editDialog} onClick={(e) => e.stopPropagation()}>
            <p className={styles.editDialogTitle}>{isContainer ? 'Modifier le dossier' : 'Renommer la tâche'}</p>

            <label className={styles.editLabel}>Titre</label>
            <input
              type="text"
              className={styles.renameInput}
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              autoFocus
            />

            {isContainer && (
              <>
                <label className={styles.editLabel}>Description <span className={styles.editLabelOptional}>(optionnel)</span></label>
                <input
                  type="text"
                  className={styles.renameInput}
                  placeholder="Une ligne de contexte..."
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </>
            )}

            <div className={styles.renameButtons}>
              <button className={styles.renameCancel} onClick={() => setIsEditing(false)} onMouseDown={(e) => e.stopPropagation()}>
                Annuler
              </button>
              <button className={styles.renameSave} onClick={handleSaveEdit} onMouseDown={(e) => e.stopPropagation()}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right resize handle */}
      {!readOnly && (
        <div className={`${styles.resizeHandle} ${styles.resizeRight}`} onMouseDown={(e) => handleResizeStart(e, 'right')} />
      )}
    </div>
  );
}
