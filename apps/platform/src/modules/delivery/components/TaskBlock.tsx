import { useState, useRef, useCallback } from 'react';
import type { Task } from '../types';
import styles from './TaskBlock.module.css';

// Map status to display label and CSS class
const getStatusInfo = (status?: string): { label: string; className: string } | null => {
  if (!status) return null;

  switch (status) {
    case 'in_progress':
      return { label: 'En cours', className: styles.statusEnCours };
    case 'blocked':
      return { label: 'Bloque', className: styles.statusBloque };
    case 'todo':
      return { label: 'A faire', className: styles.statusAFaire };
    case 'done':
      return { label: 'Done', className: styles.statusDone };
    default:
      return { label: status, className: styles.statusAFaire };
  }
};

const getTaskColor = (task: Task): string => {
  if (task.type === 'tech') return 'var(--task-tech, var(--indigo-200))';
  if (task.type === 'bug') return 'var(--task-bug, var(--red-200))';
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
}

export function TaskBlock({ task, totalCols, rowHeight, readOnly = false, onUpdate, onDelete, onResize, onMove }: TaskBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startColRef = useRef({ start: 0, end: 0 });
  const startRowRef = useRef(0);

  const startCol = task.startCol ?? 0;
  const endCol = task.endCol ?? startCol + 1;
  const row = task.row ?? 0;
  const taskWidth = endCol - startCol;
  // Add horizontal gap between tasks (3px on each side)
  const gap = 3;
  const widthPercent = (taskWidth / totalCols) * 100;
  const leftPercent = (startCol / totalCols) * 100;

  const statusInfo = getStatusInfo(task.status);

  const handleHideTask = useCallback(() => {
    setShowMenu(false);
    setShowConfirmDialog(true);
  }, []);

  const handleConfirmHide = useCallback(() => {
    setShowConfirmDialog(false);
    if (onDelete) {
      onDelete(task.id);
    }
  }, [onDelete, task.id]);

  const handleCancelHide = useCallback(() => {
    setShowConfirmDialog(false);
  }, []);

  const handleTaskDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('a') || target.closest('input') || target.closest(`.${styles.resizeHandle}`)) {
      return;
    }

    if (isDragging || isResizing || isEditing) {
      return;
    }

    e.stopPropagation();
    setShowMenu(!showMenu);
  }, [isDragging, isResizing, isEditing, showMenu]);

  const handleRename = useCallback(() => {
    setShowMenu(false);
    setIsEditing(true);
    setEditedTitle(task.title);
  }, [task.title]);

  const handleSaveTitle = () => {
    if (editedTitle.trim() && editedTitle !== task.title && onUpdate) {
      onUpdate(task.id, { title: editedTitle.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setEditedTitle(task.title);
      setIsEditing(false);
    }
  };

  const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'left' | 'right') => {
    if (readOnly || !onResize) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(direction);
    startXRef.current = e.clientX;
    startColRef.current = { start: startCol, end: endCol };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!blockRef.current?.parentElement) return;

      const parentWidth = blockRef.current.parentElement.offsetWidth;
      const colWidth = parentWidth / totalCols;
      const deltaX = moveEvent.clientX - startXRef.current;
      const deltaCols = Math.round(deltaX / colWidth);

      if (direction === 'right') {
        const newEndCol = Math.max(startColRef.current.start + 1, Math.min(totalCols, startColRef.current.end + deltaCols));
        if (newEndCol !== endCol) {
          onResize(task.id, startColRef.current.start, newEndCol);
        }
      } else {
        const newStartCol = Math.max(0, Math.min(startColRef.current.end - 1, startColRef.current.start + deltaCols));
        if (newStartCol !== startCol) {
          onResize(task.id, newStartCol, startColRef.current.end);
        }
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

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isEditing || isResizing || readOnly || !onMove) return;

    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.resizeHandle}`) || target.closest(`.${styles.deleteBtn}`)) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startColRef.current = { start: startCol, end: endCol };
    startRowRef.current = row;
    setDragOffset({ x: 0, y: 0 });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startXRef.current;
      const deltaY = moveEvent.clientY - startYRef.current;
      setDragOffset({ x: deltaX, y: deltaY });
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (!blockRef.current?.parentElement) return;

      const parentWidth = blockRef.current.parentElement.offsetWidth;
      const colWidth = parentWidth / totalCols;

      const deltaX = upEvent.clientX - startXRef.current;
      const deltaY = upEvent.clientY - startYRef.current;

      const deltaCols = Math.round(deltaX / colWidth);
      const deltaRows = Math.round(deltaY / rowHeight);

      const newStartCol = Math.max(0, Math.min(totalCols - taskWidth, startColRef.current.start + deltaCols));
      const newRow = Math.max(0, startRowRef.current + deltaRows);

      if (newStartCol !== startCol || newRow !== row) {
        onMove(task.id, newStartCol, newRow);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [isEditing, isResizing, readOnly, startCol, endCol, row, totalCols, rowHeight, task.id, taskWidth, onMove]);

  return (
    <div
      ref={blockRef}
      className={`${styles.taskBlock} ${isResizing ? styles.resizing : ''} ${isDragging ? styles.dragging : ''}`}
      style={{
        left: `calc(${leftPercent}% + ${gap}px)`,
        width: `calc(${widthPercent}% - ${gap * 2}px)`,
        top: `${20 + row * rowHeight}px`,
        background: getTaskColor(task),
        transform: isDragging ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
      }}
      onMouseLeave={() => setShowMenu(false)}
      onDoubleClick={handleTaskDoubleClick}
      onMouseDown={handleDragStart}
    >
      {/* Left resize handle */}
      {!readOnly && (
        <div
          className={`${styles.resizeHandle} ${styles.resizeLeft}`}
          onMouseDown={(e) => handleResizeStart(e, 'left')}
        />
      )}

      {/* Content */}
      <div className={styles.content}>
        {/* Estimated Days */}
        {task.estimatedDays && (
          <span className={styles.daysBadge}>{task.estimatedDays}j</span>
        )}

        {task.type === 'tech' && (
          <span className={styles.techBadge}>TECH</span>
        )}
        {task.type === 'bug' && (
          <span className={styles.bugBadge}>BUG</span>
        )}

        <span className={styles.taskTitle}>{task.title}</span>
      </div>

      {/* Status badge - top right */}
      {statusInfo && (
        <span
          className={`${styles.statusBadge} ${statusInfo.className}`}
          title={`Statut: ${task.status}`}
        >
          {statusInfo.label}
        </span>
      )}

      {/* Assignee badge */}
      {task.assignee && (
        <span className={styles.assigneeBadge} title={`Assignee: ${task.assignee}`}>
          {task.assignee.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
        </span>
      )}

      {/* Context menu */}
      {showMenu && !isEditing && !isDragging && (
        <div className={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          <div className={styles.contextMenuInner}>
            {!readOnly && onUpdate && (
              <button
                className={styles.menuItem}
                onClick={handleRename}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className={styles.menuIcon}>&#9998;</span>
                <span>Renommer</span>
              </button>
            )}
            {!readOnly && onDelete && (
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={handleHideTask}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className={styles.menuIcon}>&#128064;</span>
                <span>Masquer</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirmDialog && (
        <div className={styles.confirmOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.confirmDialog}>
            <p className={styles.confirmText}>Masquer cette tache ?</p>
            <p className={styles.confirmSubtext}>Elle pourra etre restauree depuis le menu</p>
            <div className={styles.confirmButtons}>
              <button
                className={styles.confirmCancel}
                onClick={handleCancelHide}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Annuler
              </button>
              <button
                className={styles.confirmOk}
                onClick={handleConfirmHide}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Masquer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {isEditing && (
        <div className={styles.confirmOverlay} onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}>
          <div className={styles.renameDialog} onClick={(e) => e.stopPropagation()}>
            <p className={styles.renameTitle}>Renommer la tache</p>
            <input
              type="text"
              className={styles.renameInput}
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              autoFocus
            />
            <div className={styles.renameButtons}>
              <button
                className={styles.renameCancel}
                onClick={() => { setEditedTitle(task.title); setIsEditing(false); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Annuler
              </button>
              <button
                className={styles.renameSave}
                onClick={handleSaveTitle}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right resize handle */}
      {!readOnly && (
        <div
          className={`${styles.resizeHandle} ${styles.resizeRight}`}
          onMouseDown={(e) => handleResizeStart(e, 'right')}
        />
      )}
    </div>
  );
}
