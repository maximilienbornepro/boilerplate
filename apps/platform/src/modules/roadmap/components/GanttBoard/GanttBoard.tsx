import { useState, useMemo, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { Task, Dependency, ViewMode, Planning, Marker } from '../../types';
import { generateTimeColumns, getColumnWidth, parseDate, getExtendedDateRange, calculateTaskPosition, getMonthGroups, getTotalWidth, calculatePixelOffset } from '../../utils/dateUtils';
import { buildTaskHierarchy, flattenHierarchy, hasParentChildRelationship } from '../../utils/taskUtils';
import { TaskBar } from './TaskBar';
import { TodayMarker } from './TodayMarker';
import { DependencyLines } from './DependencyLines';
import { MarkerLine } from './MarkerLine';
import { useDependencyDraw } from '../../hooks/useDependencyDraw';
import styles from './GanttBoard.module.css';

interface GanttBoardProps {
  planning: Planning;
  tasks: Task[];
  dependencies: Dependency[];
  viewMode: ViewMode;
  markers?: Marker[];
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTaskClick: (task: Task) => void;
  onTaskDelete: (taskId: string) => void;
  onAddTask: () => void;
  onAddChildTask: (parentId: string) => void;
  onCreateDependency: (fromTaskId: string, toTaskId: string) => void;
  onDeleteDependency: (dependencyId: string) => void;
  onMarkerUpdate?: (markerId: string, data: Partial<{ name: string; markerDate: string; color: string; taskId: string | null }>) => void;
  onMarkerDelete?: (markerId: string) => void;
  onAddMarker?: () => void;
  readOnly?: boolean;
  autoHeight?: boolean;
  focusedTaskId?: string | null;
  scrollToTodayTrigger?: number;
}

export interface GanttBoardHandle {
  scrollToToday: () => void;
}

const ROW_HEIGHT = 80;

export const GanttBoard = forwardRef<GanttBoardHandle, GanttBoardProps>(function GanttBoard({
  planning,
  tasks,
  dependencies,
  viewMode,
  markers,
  onTaskUpdate,
  onTaskClick,
  onTaskDelete,
  onAddTask,
  onAddChildTask,
  onCreateDependency,
  onDeleteDependency,
  onMarkerUpdate,
  onMarkerDelete,
  onAddMarker,
  readOnly,
  autoHeight,
  focusedTaskId,
}: GanttBoardProps, ref) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [scrollOffset, setScrollOffset] = useState(0);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [contentAreaWidth, setContentAreaWidth] = useState(0);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const handleScroll = () => setScrollOffset(content.scrollLeft);
    content.addEventListener('scroll', handleScroll);
    return () => content.removeEventListener('scroll', handleScroll);
  }, []);

  // Measure scroll-area width for year-view dynamic column sizing
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setContentAreaWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { chartStartDate, chartEndDate } = useMemo(() => {
    const planningStart = parseDate(planning.startDate);
    const planningEnd = parseDate(planning.endDate);
    const { start, end } = getExtendedDateRange(planningStart, planningEnd, viewMode);
    return { chartStartDate: start, chartEndDate: end };
  }, [planning.startDate, planning.endDate, viewMode]);

  const columns = useMemo(() => generateTimeColumns(chartStartDate, chartEndDate, viewMode), [chartStartDate, chartEndDate, viewMode]);
  const columnWidth = getColumnWidth(viewMode);

  // Year view: size each day to fill the available width exactly (no horizontal scroll)
  const yearDayWidth = useMemo(() => {
    if (viewMode !== 'year' || columns.length === 0 || contentAreaWidth <= 250) return columnWidth;
    return Math.max(1, (contentAreaWidth - 250) / columns.length);
  }, [viewMode, columns.length, contentAreaWidth, columnWidth]);

  const effectiveColumnWidth = viewMode === 'year' ? yearDayWidth : columnWidth;

  // For year view, stamp each column with its dynamic width so all downstream functions use it
  const effectiveColumns = useMemo(() => {
    if (viewMode !== 'year') return columns;
    return columns.map(col => ({ ...col, width: yearDayWidth }));
  }, [columns, viewMode, yearDayWidth]);

  const monthGroups = useMemo(() => getMonthGroups(effectiveColumns, viewMode), [effectiveColumns, viewMode]);
  const totalWidth = viewMode === 'year' && contentAreaWidth > 250
    ? contentAreaWidth - 250
    : getTotalWidth(columns, columnWidth);

  const scrollToTodayFn = useCallback((smooth = true) => {
    const content = contentRef.current;
    if (!content) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const left = calculatePixelOffset(startOfMonth, effectiveColumns, effectiveColumnWidth);
    content.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'instant' });
  }, [effectiveColumns, effectiveColumnWidth]);

  useImperativeHandle(ref, () => ({ scrollToToday: scrollToTodayFn }), [scrollToTodayFn]);

  // Scroll to start of current month on initial mount — instant, no visible jump
  useEffect(() => {
    let raf: number;
    const run = () => { raf = requestAnimationFrame(() => scrollToTodayFn(false)); };
    run();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hierarchy = useMemo(() => buildTaskHierarchy(tasks), [tasks]);
  const flatTasks = useMemo(() => flattenHierarchy(hierarchy, collapsedIds), [hierarchy, collapsedIds]);

  const getAncestorIds = useCallback((taskId: string): string[] => {
    const ancestors: string[] = [];
    let currentTask = tasks.find(t => t.id === taskId);
    while (currentTask?.parentId) {
      ancestors.push(currentTask.parentId);
      currentTask = tasks.find(t => t.id === currentTask!.parentId);
    }
    return ancestors;
  }, [tasks]);

  useEffect(() => {
    if (!focusedTaskId) return;
    const ancestorIds = getAncestorIds(focusedTaskId);
    if (ancestorIds.length === 0) return;
    setCollapsedIds(prev => {
      const next = new Set(prev);
      let changed = false;
      ancestorIds.forEach(id => { if (next.has(id)) { next.delete(id); changed = true; } });
      return changed ? next : prev;
    });
  }, [focusedTaskId, getAncestorIds]);

  const hasInitialScrollRef = useRef(false);

  useEffect(() => { hasInitialScrollRef.current = false; }, [chartStartDate, chartEndDate, viewMode, columnWidth]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    if (focusedTaskId) {
      const focusedTask = tasks.find(t => t.id === focusedTaskId);
      if (focusedTask) {
        const timeoutId = setTimeout(() => {
          const taskRow = content.querySelector(`[data-task-id="${focusedTaskId}"]`);
          if (taskRow) {
            taskRow.scrollIntoView({ block: 'center', behavior: 'auto' });
            const taskStart = parseDate(focusedTask.startDate);
            const { left } = calculateTaskPosition(taskStart, taskStart, chartStartDate, effectiveColumnWidth, viewMode, effectiveColumns);
            content.scrollLeft = Math.max(0, left + 250 - content.clientWidth / 2);
          }
        }, 100);
        hasInitialScrollRef.current = true;
        return () => clearTimeout(timeoutId);
      }
    }

    if (hasInitialScrollRef.current) return;
    hasInitialScrollRef.current = true;

    const today = new Date();
    if (today < chartStartDate || today > chartEndDate) return;
    const todayStr = today.toISOString().split('T')[0];
    const todayDate = parseDate(todayStr);
    const left = calculatePixelOffset(todayDate, effectiveColumns, effectiveColumnWidth);
    content.scrollLeft = Math.max(0, left + 250 - content.clientWidth / 2);
  }, [chartStartDate, chartEndDate, viewMode, effectiveColumnWidth, focusedTaskId, tasks, flatTasks, effectiveColumns]);

  const taskIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    flatTasks.forEach((item, index) => map.set(item.task.id, index));
    return map;
  }, [flatTasks]);

  // Top-level parent tasks with row indices (for marker snapping)
  const topLevelTaskRows = useMemo(() => {
    return flatTasks
      .map((item, index) => ({ task: item.task, rowIndex: index }))
      .filter(item => item.task.parentId === null);
  }, [flatTasks]);

  const handleCreateDep = useCallback((fromTaskId: string, toTaskId: string) => {
    if (hasParentChildRelationship(tasks, fromTaskId, toTaskId)) return;
    onCreateDependency(fromTaskId, toTaskId);
  }, [onCreateDependency, tasks]);

  const { isDrawing, fromTaskId, mousePosition, startDrawing, updateMousePosition, endDrawing, cancelDrawing } = useDependencyDraw(handleCreateDep);

  useEffect(() => {
    if (!isDrawing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const content = contentRef.current;
      if (!content) return;
      // Get contentInner position (SVG lives there, below the sticky header)
      const innerEl = content.querySelector(`.${styles.contentInner}`) as HTMLElement;
      if (!innerEl) return;
      const innerRect = innerEl.getBoundingClientRect();
      const x = e.clientX - innerRect.left;
      const y = e.clientY - innerRect.top;
      updateMousePosition(x, y);
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isDrawing, updateMousePosition]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && isDrawing) cancelDrawing(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, cancelDrawing]);

  const handleToggleCollapse = (taskId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  const handleTaskMove = (taskId: string, newStart: string, newEnd: string) => { onTaskUpdate(taskId, { startDate: newStart, endDate: newEnd }); };
  const handleTaskResize = (taskId: string, newStart: string, newEnd: string) => { onTaskUpdate(taskId, { startDate: newStart, endDate: newEnd }); };
  const handleNameChange = (taskId: string, name: string) => { onTaskUpdate(taskId, { name }); };

  // Find the root ancestor's color for a given task/parent
  const getRootColor = useCallback((taskId: string): string => {
    let current = tasks.find(t => t.id === taskId);
    while (current?.parentId) {
      current = tasks.find(t => t.id === current!.parentId);
    }
    return current?.color ?? '';
  }, [tasks]);

  const getDescIds = useCallback((parentId: string): string[] => {
    const children = tasks.filter(t => t.parentId === parentId);
    return children.flatMap(c => [c.id, ...getDescIds(c.id)]);
  }, [tasks]);

  const handleParentChange = useCallback((taskId: string, newParentId: string | null) => {
    const movedTask = tasks.find(t => t.id === taskId);
    if (!movedTask) return;

    const updates: Partial<Task> = { parentId: newParentId };

    if (newParentId !== null) {
      // Becoming a child: inherit root ancestor's color
      const rootColor = getRootColor(newParentId);
      if (rootColor && rootColor !== movedTask.color) {
        updates.color = rootColor;
      }
    }

    onTaskUpdate(taskId, updates);

    // Cascade color to all descendants
    if (updates.color) {
      getDescIds(taskId).forEach(id => onTaskUpdate(id, { color: updates.color! }));
    }
  }, [tasks, onTaskUpdate, getRootColor, getDescIds]);

  const handleReorder = useCallback((taskId: string, targetTaskId: string, position: 'above' | 'below') => {
    const targetTask = tasks.find(t => t.id === targetTaskId);
    if (!targetTask) return;
    const movedTask = tasks.find(t => t.id === taskId);
    if (!movedTask) return;

    const newParentId = targetTask.parentId || null;
    const siblings = tasks.filter(t => (t.parentId || null) === newParentId && t.id !== taskId).sort((a, b) => a.sortOrder - b.sortOrder);
    const targetIndex = siblings.findIndex(t => t.id === targetTaskId);
    if (targetIndex === -1) return;
    const insertIndex = position === 'above' ? targetIndex : targetIndex + 1;
    siblings.splice(insertIndex, 0, movedTask);

    // Determine if parent changed and if we need a color sync
    const parentChanged = (movedTask.parentId || null) !== newParentId;
    let newColor: string | undefined;
    if (parentChanged && newParentId !== null) {
      const rootColor = getRootColor(newParentId);
      if (rootColor && rootColor !== movedTask.color) newColor = rootColor;
    }

    siblings.forEach((t, i) => {
      if (t.id === taskId) {
        const updates: Partial<Task> = { parentId: newParentId, sortOrder: i };
        if (newColor) updates.color = newColor;
        onTaskUpdate(taskId, updates);
      } else if (t.sortOrder !== i) {
        onTaskUpdate(t.id, { sortOrder: i });
      }
    });

    // Cascade color to descendants of moved task
    if (newColor) {
      const color = newColor;
      getDescIds(taskId).forEach(id => onTaskUpdate(id, { color }));
    }
  }, [tasks, onTaskUpdate, getRootColor, getDescIds]);

  return (
    <div className={`${styles.container} ${autoHeight ? styles.autoHeight : ''}`}>
      <div ref={contentRef} className={`${styles.content} ${autoHeight ? styles.autoHeight : ''}`} onClick={() => { if (isDrawing) endDrawing(null); }}>
        {/* Header inside scroll container — taskNameHeader is sticky */}
        <div className={`${styles.header} ${viewMode === 'year' ? styles.yearView : ''}`} style={{ width: totalWidth + 250, minWidth: totalWidth + 250 }}>
          <div className={styles.taskNameHeader}>Taches</div>
          <div className={styles.timelineHeader}>
            <div className={`${styles.monthRow} ${viewMode === 'year' ? styles.yearView : ''}`}>
              {monthGroups.map((g, i) => {
                const cellWidth = g.width ?? g.colSpan * effectiveColumnWidth;
                return (
                  <div key={i} className={styles.monthCell} style={{ width: cellWidth, minWidth: cellWidth }}>
                    {g.label}
                  </div>
                );
              })}
            </div>
            {viewMode !== 'year' && (
              <div className={styles.dayRow}>
                {effectiveColumns.map((col, i) => {
                  const colW = col.width ?? effectiveColumnWidth;
                  return (
                    <div key={i} className={`${styles.dayCell} ${col.isWeekend ? styles.weekend : ''} ${col.isHoliday ? styles.holiday : ''} ${col.isToday ? styles.today : ''} ${col.isWeekStart && viewMode !== 'month' ? styles.weekStart : ''}`} style={{ width: colW, minWidth: colW }}>
                      {col.label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={styles.contentInner} style={{ width: totalWidth + 250, minWidth: totalWidth + 250 }}>
          <div className={styles.grid}>
            <div className={styles.taskNameColumn} />
            {(() => {
              let pixelLeft = 0;
              return effectiveColumns.map((col, index) => {
                const colW = col.width ?? effectiveColumnWidth;
                const left = pixelLeft;
                pixelLeft += colW;
                return (
                  <div key={index} className={`${styles.gridColumn} ${viewMode === 'year' ? styles.yearViewCol : ''} ${col.isWeekend ? styles.weekend : ''} ${col.isHoliday ? styles.holiday : ''} ${col.isToday ? styles.today : ''} ${col.isWeekStart && viewMode !== 'month' ? styles.weekStart : ''}`} style={{ left: 250 + left, width: colW }} />
                );
              });
            })()}
          </div>

          <div className={styles.tasks}>
            {draggedTaskId && (
              <div className={styles.rootDropZone} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={(e) => { e.preventDefault(); const id = draggedTaskId || e.dataTransfer.getData('text/plain'); if (id) handleParentChange(id, null); }}>
                <span>Deposer ici pour retirer le parent</span>
              </div>
            )}
            {flatTasks.map(({ task, level, ancestorIsLast }) => {
              const parentTask = task.parentId ? tasks.find(t => t.id === task.parentId) : null;
              const rootColor = task.parentId ? getRootColor(task.parentId) : undefined;
              return (
                <TaskBar
                  key={task.id}
                  task={task}
                  level={level}
                  ancestorIsLast={ancestorIsLast}
                  parentName={parentTask?.name}
                  parentColor={rootColor || parentTask?.color}
                  chartStartDate={chartStartDate}
                  viewMode={viewMode}
                  columns={effectiveColumns}
                  hasChildren={!!(task.children && task.children.length > 0)}
                  isCollapsed={collapsedIds.has(task.id)}
                  onMove={handleTaskMove}
                  onResize={handleTaskResize}
                  onNameChange={handleNameChange}
                  onClick={onTaskClick}
                  onDelete={onTaskDelete}
                  onAddChild={onAddChildTask}
                  onToggleCollapse={handleToggleCollapse}
                  onStartDependency={readOnly ? undefined : startDrawing}
                  onEndDependency={readOnly ? undefined : endDrawing}
                  isDrawingDependency={isDrawing}
                  onParentChange={handleParentChange}
                  onReorder={handleReorder}
                  draggedTaskId={draggedTaskId}
                  onDragStart={setDraggedTaskId}
                  onDragEnd={() => setDraggedTaskId(null)}
                  readOnly={readOnly}
                  isFocused={focusedTaskId === task.id}
                />
              );
            })}

            {!readOnly && (
              <>
                <div className={styles.addTaskRow}>
                  <button className={styles.addTaskButton} onClick={onAddTask}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Ajouter une tâche
                  </button>
                </div>
                {onAddMarker && (
                  <div className={styles.addTaskRow}>
                    <button className={styles.addFaiButton} onClick={onAddMarker}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Marqueur
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <DependencyLines
            dependencies={dependencies}
            tasks={tasks}
            taskIndexMap={taskIndexMap}
            chartStartDate={chartStartDate}
            viewMode={viewMode}
            onDelete={onDeleteDependency}
            isDrawing={isDrawing}
            fromTaskId={fromTaskId}
            mousePosition={mousePosition}
          />

          <TodayMarker chartStartDate={chartStartDate} chartEndDate={chartEndDate} viewMode={viewMode} columns={effectiveColumns} />

          {/* Markers */}
          {markers?.map(m => (
            <MarkerLine
              key={m.id}
              marker={m}
              chartStartDate={chartStartDate}
              chartEndDate={chartEndDate}
              viewMode={viewMode}
              onUpdate={onMarkerUpdate}
              onDelete={onMarkerDelete}
              readOnly={readOnly}
              topLevelTaskRows={topLevelTaskRows}
              rowHeight={ROW_HEIGHT}
            />
          ))}
        </div>
      </div>

      {isDrawing && (
        <div className={styles.drawingOverlay}>
          Cliquez sur une tâche pour créer la dépendance (Échap pour annuler)
        </div>
      )}
    </div>
  );
});
