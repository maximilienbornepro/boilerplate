import { useMemo } from 'react';
import type { Sprint, Task, Release } from '../types';
import { Card, Button } from '@boilerplate/shared/components';
import { BoardRow } from './BoardRow';
import { SprintColumn } from './SprintColumn';
import { ReleaseMarker } from './ReleaseMarker';
import { TodayMarker } from './TodayMarker';
import { extractJiraKey } from '../utils/jiraUtils';
import styles from './BoardDelivery.module.css';

interface BoardDeliveryProps {
  sprints: Sprint[];
  tasks: Task[];
  releases: Release[];
  boardLabel: string;
  readOnly?: boolean;
  showReleaseMarkers?: boolean;
  /** Number of grid columns. Dynamic based on board type/duration.
   *  Agile: durationWeeks (1 col = 1 week). Calendaire: 4 (always). */
  totalCols?: number;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete?: (taskId: string) => void;
  onTaskResize?: (taskId: string, newStartCol: number, newEndCol: number) => void;
  onTaskMove?: (taskId: string, newStartCol: number, newRow: number) => void;
  onNestTask?: (childId: string, containerId: string) => void;
  onUnnestTask?: (childId: string) => void;
  jiraBaseUrl?: string | null;
  /** Manual overrides for container → project assignment (taskId → projectKey). */
  containerProjectMap?: Record<string, string>;
  /** List of all detected Jira project keys (for the container project picker). */
  availableProjects?: string[];
  /** Called when the user reassigns a container to a different project row. */
  onContainerProjectChange?: (taskId: string, project: string) => void;
  /** Called when the user clicks "+ Tâche" in the empty state. */
  onAddTask?: () => void;
}

/** Vertical pitch between rows on the board grid. Tasks are positioned at
 *  `top: row * ROW_HEIGHT` so this also controls the gap between tasks.
 *  Set to tile min-height (80) + 4px gutter so consecutive rows snap
 *  cleanly without inter-row visual overlap when dragging. */
const ROW_HEIGHT = 84;
/** Fallback column count when totalCols prop is not provided (legacy). */
const DEFAULT_TOTAL_COLS = 6;

/**
 * Extract the Jira project key from a task. For containers (manual tasks),
 * uses the first child's project. Returns null if no Jira key found.
 */
function getTaskProject(task: Task): string | null {
  // Standalone Jira task
  const key = extractJiraKey(task.title);
  if (key) return key.split('-')[0];
  // Container → check first child
  if (task.children && task.children.length > 0) {
    for (const child of task.children) {
      const childKey = extractJiraKey(child.title);
      if (childKey) return childKey.split('-')[0];
    }
  }
  return null;
}

export function BoardDelivery({
  sprints,
  tasks,
  releases,
  boardLabel,
  readOnly = false,
  showReleaseMarkers = true,
  totalCols = DEFAULT_TOTAL_COLS,
  onTaskUpdate,
  onTaskDelete,
  onTaskResize,
  onTaskMove,
  onNestTask,
  onUnnestTask,
  jiraBaseUrl,
  containerProjectMap = {},
  availableProjects = [],
  onContainerProjectChange,
  onAddTask,
}: BoardDeliveryProps) {
  // Group tasks by Jira project. Each project gets its own BoardRow.
  // Containers (manual tasks) check the override map first, then fall
  // back to their first child's project. Orphan containers go into the
  // first project alphabetically.
  const taskGroups = useMemo(() => {
    // First pass: collect all project keys to know the fallback target.
    const allProjects = new Set<string>();
    for (const task of tasks) {
      const p = getTaskProject(task);
      if (p) allProjects.add(p);
    }
    const sortedProjects = Array.from(allProjects).sort();
    const fallbackProject = sortedProjects[0] ?? 'Tâches';

    // Second pass: group tasks by project.
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      // Manual override takes priority (set via drag-and-drop between rows).
      const override = containerProjectMap[task.id];
      const project = override ?? getTaskProject(task) ?? fallbackProject;
      const group = groups.get(project) ?? [];
      group.push(task);
      groups.set(project, group);
    }

    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks, containerProjectMap]);

  if (tasks.length === 0 && !readOnly && onAddTask) {
    return (
      <div className={styles.emptyWrapper}>
        <Card className={styles.emptyCard}>
          <div className={styles.emptyContent}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <p className={styles.emptyTitle}>Aucune tâche</p>
            <p className={styles.emptyHint}>Créer votre première tâche pour commencer</p>
            <Button variant="primary" onClick={onAddTask}>
              + Nouvelle tâche
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      <div className={styles.sprintHeader}>
        <div className={styles.platformLabel}></div>
        {sprints.map((sprint) => (
          <SprintColumn key={sprint.id} sprint={sprint} />
        ))}
      </div>

      <div className={styles.boardContent}>
        {/* Release Markers + Today Marker */}
        {showReleaseMarkers && (
          <div className={styles.markerLayer}>
            <TodayMarker sprints={sprints} totalCols={totalCols} />
            {releases.map((release) => (
              <ReleaseMarker
                key={release.id}
                release={release}
                sprints={sprints}
                totalCols={totalCols}
              />
            ))}
          </div>
        )}

        {taskGroups.map(([label, groupTasks]) => (
          <BoardRow
            key={label}
            label={label}
            tasks={groupTasks}
            totalCols={totalCols}
            rowHeight={ROW_HEIGHT}
            readOnly={readOnly}
            sprints={sprints}
            onTaskUpdate={onTaskUpdate}
            onTaskDelete={onTaskDelete}
            onTaskResize={onTaskResize}
            onTaskMove={onTaskMove}
            onNestTask={onNestTask}
            onUnnestTask={onUnnestTask}
            jiraBaseUrl={jiraBaseUrl}
            onContainerDrop={onContainerProjectChange
              ? (taskId) => onContainerProjectChange(taskId, label)
              : undefined
            }
            onProjectDrop={onContainerProjectChange}
          />
        ))}
      </div>
    </div>
  );
}
