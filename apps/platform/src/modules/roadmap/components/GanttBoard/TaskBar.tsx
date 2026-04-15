import { useRef, useState } from 'react';
import type { Task, ViewMode, TimeColumn } from '../../types';
import { useDragTask } from '../../hooks/useDragTask';
import { useResizeTask } from '../../hooks/useResizeTask';
import { calculateTaskPosition, parseDate, getColumnWidth } from '../../utils/dateUtils';
import { getStatusColor } from '../../utils/statusColors';
import { VIRTUAL_DELIVERY_PARENT_ID } from '../../utils/deliveryVirtualRow';
import { ConfirmModal } from '@boilerplate/shared/components';
import styles from './TaskBar.module.css';

interface TaskBarProps {
  task: Task;
  level: number;
  ancestorIsLast?: boolean[];
  parentName?: string;
  chartStartDate: Date;
  viewMode: ViewMode;
  hasChildren: boolean;
  isCollapsed?: boolean;
  /** Row height in px — variable to support compact virtual delivery leaves. */
  rowHeight?: number;
  onMove: (taskId: string, newStart: string, newEnd: string) => void;
  onResize: (taskId: string, newStart: string, newEnd: string) => void;
  onNameChange: (taskId: string, name: string) => void;
  onClick: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onAddChild: (parentId: string) => void;
  onToggleCollapse?: (taskId: string) => void;
  onStartDependency?: (taskId: string) => void;
  onEndDependency?: (taskId: string) => void;
  isDrawingDependency?: boolean;
  onParentChange?: (taskId: string, newParentId: string | null) => void;
  onReorder?: (taskId: string, targetTaskId: string, position: 'above' | 'below') => void;
  draggedTaskId?: string | null;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
  readOnly?: boolean;
  isFocused?: boolean;
  columns?: TimeColumn[];
  parentColor?: string;
  onNameClick?: (task: Task) => void;
}

const DEFAULT_ROW_HEIGHT = 80;
const INDENT_SIZE = 24;
/** Indent per level on compact rows. Half the normal indent to keep the
 *  name visible on deeply nested virtual overlays. Must match
 *  `.indentLineCompact` width in TaskBar.module.css. */
const COMPACT_INDENT_SIZE = 14;

export function TaskBar({
  task, level, ancestorIsLast = [], parentName, chartStartDate, viewMode, hasChildren, isCollapsed,
  rowHeight = DEFAULT_ROW_HEIGHT,
  onMove, onResize, onNameChange, onClick, onDelete, onAddChild, onToggleCollapse,
  onStartDependency, onEndDependency, isDrawingDependency,
  onParentChange, onReorder, draggedTaskId, onDragStart, onDragEnd, readOnly, isFocused,
  columns, parentColor, onNameClick,
}: TaskBarProps) {
  // A task can opt out of editing via its own `readOnly` flag (e.g. virtual
  // delivery overlay rows), independently of the global GanttBoard prop.
  const effectiveReadOnly = readOnly || task.readOnly === true;
  // Compact mode: thin row with a minimal 4px bar and a single-line name.
  // Used for virtual delivery leaves so hundreds of tickets fit on screen.
  const isCompact = task.compact === true;
  const [showHoverCard, setShowHoverCard] = useState(false);
  // Section header: the top-level virtual "Delivery" row. Rendered as a
  // visually distinct group header (no timeline bar, tinted background,
  // uppercase label) so users can tell it's a grouping, not a task.
  const isDeliverySectionHeader = task.id === VIRTUAL_DELIVERY_PARENT_ID;
  const columnWidth = getColumnWidth(viewMode);
  const taskStart = parseDate(task.startDate);
  const taskEnd = parseDate(task.endDate);
  const { left, width } = calculateTaskPosition(taskStart, taskEnd, chartStartDate, columnWidth, viewMode, columns);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropPosition, setDropPosition] = useState<'above' | 'child' | 'below' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const justInteractedRef = useRef(false);

  const { taskBarRef, handleMouseDown } = useDragTask({
    taskId: task.id, startDate: task.startDate, endDate: task.endDate, chartStartDate, viewMode, columns,
    onMove: (id, s, e) => { justInteractedRef.current = true; onMove(id, s, e); setTimeout(() => { justInteractedRef.current = false; }, 200); },
  });

  const { isResizing, leftOffset, widthOffset, handleResizeStart } = useResizeTask({
    taskId: task.id, startDate: task.startDate, endDate: task.endDate, chartStartDate, viewMode, columns,
    onResize: (id, s, e) => { justInteractedRef.current = true; onResize(id, s, e); setTimeout(() => { justInteractedRef.current = false; }, 200); },
  });

  const resizeTranslateX = isResizing ? leftOffset : 0;
  const finalWidth = width + (isResizing ? widthOffset : 0);

  const handleClick = (e: React.MouseEvent) => {
    if (isDrawingDependency && onEndDependency) { e.stopPropagation(); onEndDependency(task.id); return; }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (justInteractedRef.current) return;
    onClick(task);
  };

  const startEditing = (e: React.MouseEvent) => {
    if (effectiveReadOnly) return;
    e.stopPropagation();
    setEditValue(task.name);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const saveEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.name) onNameChange(task.id, trimmed);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit();
    else if (e.key === 'Escape') { setIsEditing(false); setEditValue(task.name); }
  };

  // Hierarchy drag & drop
  const handleDragStartHierarchy = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => onDragStart?.(task.id), 0);
  };

  const handleDragEndHierarchy = () => { setIsDragOver(false); setDropPosition(null); onDragEnd?.(); };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!e.dataTransfer.types.includes('text/plain') || draggedTaskId === task.id) return;
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    if (y < height * 0.3) setDropPosition('above');
    else if (y > height * 0.7) setDropPosition('below');
    else setDropPosition('child');
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); setDropPosition(null); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const draggedId = draggedTaskId || e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== task.id && dropPosition) {
      if (dropPosition === 'child') onParentChange?.(draggedId, task.id);
      else if (onReorder) onReorder(draggedId, task.id, dropPosition);
    }
    setIsDragOver(false); setDropPosition(null);
  };

  const isDragging = draggedTaskId === task.id;

  // Compact task name styles — single line with ellipsis, smaller font.
  const compactNameStyle: React.CSSProperties | undefined = isCompact
    ? {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontSize: '0.75rem',
        lineHeight: `${rowHeight - 4}px`,
        display: 'inline-block',
        maxWidth: '100%',
      }
    : undefined;

  // Compact bar: a thin horizontal line centered in the row.
  const compactBarHeight = 4;

  return (
    <div
      className={`${styles.taskRow} ${isResizing ? styles.dragging : ''} ${isDragging ? styles.isDragging : ''} ${isFocused ? styles.focused : ''} ${isDeliverySectionHeader ? styles.deliverySectionHeader : ''}`}
      style={{
        height: rowHeight,
        borderBottom: isDeliverySectionHeader
          ? '2px solid var(--border-color)'
          : `1px solid ${parentColor ?? task.color}${isCompact ? '20' : '40'}`,
      }}
      data-task-id={task.id}
    >
      <div
        className={[styles.taskName, isDragOver && styles.dragOver, dropPosition === 'above' && styles.dropAbove, dropPosition === 'below' && styles.dropBelow, dropPosition === 'child' && styles.dropChild].filter(Boolean).join(' ')}
        style={isCompact ? { padding: '0 8px 0 8px', height: rowHeight, overflow: 'hidden' } : undefined}
        draggable={!isEditing && !effectiveReadOnly}
        onDragStart={effectiveReadOnly ? undefined : handleDragStartHierarchy}
        onDragEnd={effectiveReadOnly ? undefined : handleDragEndHierarchy}
        onDragOver={effectiveReadOnly ? undefined : handleDragOver}
        onDragLeave={effectiveReadOnly ? undefined : handleDragLeave}
        onDrop={effectiveReadOnly ? undefined : handleDrop}
      >
        {level > 0 && (
          <div
            className={styles.indentGuides}
            style={{ width: level * (isCompact ? COMPACT_INDENT_SIZE : INDENT_SIZE), '--indent-color': parentColor || task.color || 'var(--text-muted)' } as React.CSSProperties}
          >
            {Array.from({ length: level }).map((_, i) => {
              const isLastAtLevel = ancestorIsLast[i + 1] ?? false;
              const isCurrentLevel = i === level - 1;
              const classes = [styles.indentLine];
              if (isCompact) classes.push(styles.indentLineCompact);
              if (isLastAtLevel && !isCurrentLevel) classes.push(styles.indentLineHidden);
              if (isLastAtLevel && isCurrentLevel) classes.push(styles.indentLineHalf);
              if (isCurrentLevel) classes.push(styles.indentLineCurrent);
              return <div key={i} className={classes.join(' ')} />;
            })}
          </div>
        )}

        {hasChildren && onToggleCollapse && (
          <button
            className={styles.collapseButton}
            style={{
              color: parentColor ?? task.color,
              ...(isCompact ? { width: 16, height: 16, padding: 0, flexShrink: 0 } : undefined),
            }}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
            title={isCollapsed ? 'Déplier' : 'Replier'}
          >
            <svg width={isCompact ? 10 : 14} height={isCompact ? 10 : 14} viewBox="0 0 24 24" fill="currentColor" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}><path d="M7 10l5 5 5-5z" /></svg>
          </button>
        )}

        {/* Status pill — small visual cue for delivery-overlay tasks (and others
            carrying a status). Color from normalized status (todo/in_progress/done). */}
        {task.status && !isCompact && (
          <span
            className={styles.hoverCardStatus}
            style={{
              background: getStatusColor(task.status),
              fontSize: '9px',
              padding: '1px 6px',
              borderRadius: '3px',
              marginRight: '4px',
              color: '#fff',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              flexShrink: 0,
            }}
            title={`Statut : ${task.status}`}
          >
            {task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'En cours' : task.status === 'blocked' ? 'Bloqué' : 'À faire'}
          </span>
        )}

        {isEditing ? (
          <input ref={inputRef} type="text" className={styles.nameInput} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={handleKeyDown} autoFocus />
        ) : (
          <span
            className={`${styles.nameText} ${level < 2 ? styles.parentName : ''}`}
            style={{ ...compactNameStyle, cursor: 'pointer' }}
            title={isCompact ? task.name : 'Cliquer pour voir · Double-cliquer pour modifier'}
            onClick={(e) => { e.stopPropagation(); onNameClick?.(task); }}
            onDoubleClick={startEditing}
          >
            {task.name}
          </span>
        )}

        {dropPosition === 'child' && <span className={styles.dropChildLabel}>→ Enfant</span>}

        {!effectiveReadOnly && !isCompact && (
          <div className={styles.actionButtons}>
            <button className={styles.addChildButton} onClick={(e) => { e.stopPropagation(); onAddChild(task.id); }} title="Ajouter une sous-tâche">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <button className={styles.deleteButton} onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }} title="Supprimer la tâche">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          </div>
        )}
      </div>

      <div
        ref={taskBarRef}
        className={`${styles.taskBar} ${isDrawingDependency ? styles.drawingTarget : ''} ${level === 0 ? styles.parentBar : level === 1 ? styles.subParentBar : styles.childBar} ${isCompact ? styles.compact : ''}`}
        style={{
          left: 250 + left,
          width: Math.max(finalWidth, 20),
          backgroundColor: isCompact ? undefined : (level < 2 ? task.color : 'transparent'),
          borderColor: isCompact ? undefined : (level < 2 ? 'transparent' : (parentColor ?? task.color)),
          color: level < 2 ? 'white' : (parentColor ?? task.color),
          transform: resizeTranslateX !== 0 ? `translateX(${resizeTranslateX}px)` : 'none',
          cursor: effectiveReadOnly ? 'default' : undefined,
          opacity: task.isVirtual && !isCompact ? 0.9 : undefined,
          borderStyle: task.isVirtual && !isCompact ? 'dashed' : undefined,
          // Compact mode: override height/top so the bar is a thin horizontal line.
          // `--compact-bar-color` is consumed by the .compact CSS class to beat
          // the `!important` from .childBar without fighting specificity inline.
          ['--compact-bar-color' as string]: isCompact ? task.color : undefined,
          height: isCompact ? compactBarHeight : undefined,
          top: isCompact ? (rowHeight - compactBarHeight) / 2 : undefined,
          borderRadius: isCompact ? 2 : undefined,
        }}
        onMouseDown={effectiveReadOnly ? undefined : handleMouseDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={isCompact && task.isVirtual ? () => setShowHoverCard(true) : undefined}
        onMouseLeave={isCompact && task.isVirtual ? () => setShowHoverCard(false) : undefined}
      >
        {!effectiveReadOnly && !isCompact && <div className={`${styles.resizeHandle} ${styles.left}`} data-resize-handle onMouseDown={(e) => handleResizeStart(e, 'left')} />}
        {!isCompact && (
          <div className={styles.barContent}>
            {task.progress > 0 && <div className={styles.progressBar} style={{ width: `${task.progress}%` }} />}
            {viewMode !== 'quarter' && viewMode !== 'year' && (
              <span className={styles.barLabel}>
                {task.name}
              </span>
            )}
          </div>
        )}

        {/* Jira hover card — shown on compact delivery overlay bars */}
        {showHoverCard && isCompact && task.isVirtual && (
          <div className={styles.hoverCard}>
            <div className={styles.hoverCardHeader}>
              {task.jiraKey && (
                <span className={styles.hoverCardKey} style={{ background: task.color }}>{task.jiraKey}</span>
              )}
              {task.status && (
                <span className={styles.hoverCardStatus} style={{ background: getStatusColor(task.status) }}>
                  {task.status === 'done' ? 'Terminé' : task.status === 'in_progress' ? 'En cours' : 'À faire'}
                </span>
              )}
            </div>
            <div className={styles.hoverCardTitle}>{task.name}</div>
            <div className={styles.hoverCardMeta}>
              {task.boardName && <span>{task.boardName}</span>}
              <span>{task.startDate} → {task.endDate}</span>
              {task.source && <span>{task.source === 'jira' ? 'Jira' : 'Manuel'}</span>}
            </div>
          </div>
        )}
        {!effectiveReadOnly && !isCompact && <div className={`${styles.resizeHandle} ${styles.right}`} data-resize-handle onMouseDown={(e) => handleResizeStart(e, 'right')} />}
        {!effectiveReadOnly && !isCompact && onStartDependency && (
          <div className={styles.dependencyHandle} data-dependency-handle onClick={(e) => { e.stopPropagation(); onStartDependency(task.id); }} title="Créer une dépendance">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmModal
          title="Supprimer la tâche"
          message={hasChildren ? `Êtes-vous sûr de vouloir supprimer "${task.name}" et toutes ses sous-tâches ?` : `Êtes-vous sûr de vouloir supprimer "${task.name}" ?`}
          onConfirm={() => { onDelete(task.id); setShowDeleteConfirm(false); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
