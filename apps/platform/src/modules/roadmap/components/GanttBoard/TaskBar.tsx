import { useRef, useState } from 'react';
import type { Task, ViewMode, TimeColumn } from '../../types';
import { useDragTask } from '../../hooks/useDragTask';
import { useResizeTask } from '../../hooks/useResizeTask';
import { calculateTaskPosition, parseDate, getColumnWidth } from '../../utils/dateUtils';
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
}

const ROW_HEIGHT = 80;
const INDENT_SIZE = 24;

export function TaskBar({
  task, level, ancestorIsLast = [], parentName, chartStartDate, viewMode, hasChildren, isCollapsed,
  onMove, onResize, onNameChange, onClick, onDelete, onAddChild, onToggleCollapse,
  onStartDependency, onEndDependency, isDrawingDependency,
  onParentChange, onReorder, draggedTaskId, onDragStart, onDragEnd, readOnly, isFocused,
  columns, parentColor,
}: TaskBarProps) {
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
    if (readOnly) return;
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

  return (
    <div className={`${styles.taskRow} ${isResizing ? styles.dragging : ''} ${isDragging ? styles.isDragging : ''} ${isFocused ? styles.focused : ''}`} style={{ height: ROW_HEIGHT, borderBottom: `1px solid ${parentColor ?? task.color}40` }} data-task-id={task.id}>
      <div
        className={[styles.taskName, isDragOver && styles.dragOver, dropPosition === 'above' && styles.dropAbove, dropPosition === 'below' && styles.dropBelow, dropPosition === 'child' && styles.dropChild].filter(Boolean).join(' ')}
        draggable={!isEditing && !readOnly}
        onDragStart={readOnly ? undefined : handleDragStartHierarchy}
        onDragEnd={readOnly ? undefined : handleDragEndHierarchy}
        onDragOver={readOnly ? undefined : handleDragOver}
        onDragLeave={readOnly ? undefined : handleDragLeave}
        onDrop={readOnly ? undefined : handleDrop}
      >
        {level > 0 && (
          <div className={styles.indentGuides} style={{ width: level * INDENT_SIZE }}>
            {Array.from({ length: level }).map((_, i) => {
              const isLastAtLevel = ancestorIsLast[i + 1] ?? false;
              const isCurrentLevel = i === level - 1;
              const classes = [styles.indentLine];
              if (isLastAtLevel && !isCurrentLevel) classes.push(styles.indentLineHidden);
              if (isLastAtLevel && isCurrentLevel) classes.push(styles.indentLineHalf);
              if (isCurrentLevel) classes.push(styles.indentLineCurrent);
              return <div key={i} className={classes.join(' ')} />;
            })}
          </div>
        )}

        {hasChildren && onToggleCollapse && (
          <button className={styles.collapseButton} style={{ color: parentColor ?? task.color }} onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}><path d="M7 10l5 5 5-5z" /></svg>
          </button>
        )}

        {isEditing ? (
          <input ref={inputRef} type="text" className={styles.nameInput} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={handleKeyDown} autoFocus />
        ) : (
          <span className={`${styles.nameText} ${level < 2 ? styles.parentName : ''}`} title="Double-cliquer pour modifier" onDoubleClick={startEditing}>{task.name}</span>
        )}

        {dropPosition === 'child' && <span className={styles.dropChildLabel}>→ Enfant</span>}

        {!readOnly && (
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
        className={`${styles.taskBar} ${isDrawingDependency ? styles.drawingTarget : ''} ${level === 0 ? styles.parentBar : level === 1 ? styles.subParentBar : styles.childBar}`}
        style={{
          left: 250 + left,
          width: Math.max(finalWidth, 20),
          backgroundColor: level < 2 ? task.color : 'transparent',
          borderColor: level < 2 ? 'transparent' : (parentColor ?? task.color),
          color: level < 2 ? 'white' : (parentColor ?? task.color),
          transform: resizeTranslateX !== 0 ? `translateX(${resizeTranslateX}px)` : 'none',
          cursor: readOnly ? 'default' : undefined,
        }}
        onMouseDown={readOnly ? undefined : handleMouseDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {!readOnly && <div className={`${styles.resizeHandle} ${styles.left}`} data-resize-handle onMouseDown={(e) => handleResizeStart(e, 'left')} />}
        <div className={styles.barContent}>
          {task.progress > 0 && <div className={styles.progressBar} style={{ width: `${task.progress}%` }} />}
          {viewMode !== 'quarter' && viewMode !== 'year' && (
            <span className={styles.barLabel}>
              {task.name}
            </span>
          )}
        </div>
        {!readOnly && <div className={`${styles.resizeHandle} ${styles.right}`} data-resize-handle onMouseDown={(e) => handleResizeStart(e, 'right')} />}
        {!readOnly && onStartDependency && (
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
