import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import {
  runSanityCheck, applySanityMoves, fetchTasksForBoard, fetchPositionsForBoard,
  type ColumnPlan, type AnalyzedTask, type ProposedAddition, type BoardAnalysis, type TaskPosition,
  type SanityAdditionPayload,
} from '../../services/api';
import type { Task } from '../../types';
import styles from './SanityCheckModal.module.css';

interface Props {
  boardId: string;
  onClose: () => void;
  onApplied: () => void;
  onToast?: (toast: { type: 'success' | 'error' | 'warning'; message: string }) => void;
}

type ViewMode = 'list' | 'grid' | 'compare';

/** Keys used in the selection set — prefixes disambiguate tasks vs additions. */
const taskKey = (id: string) => `t:${id}`;
const additionKey = (externalKey: string) => `a:${externalKey}`;

export function SanityCheckModal({ boardId, onClose, onApplied, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [analysis, setAnalysis] = useState<BoardAnalysis | null>(null);
  const [columns, setColumns] = useState<ColumnPlan[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [positions, setPositions] = useState<TaskPosition[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      runSanityCheck(boardId),
      fetchTasksForBoard(boardId).catch(() => [] as Task[]),
      fetchPositionsForBoard(boardId).catch(() => [] as TaskPosition[]),
    ])
      .then(([res, t, p]) => {
        setSummary(res.summary);
        setAnalysis(res.analysis);
        setColumns(res.columns);
        const ids = new Set<string>();
        for (const c of res.columns) {
          for (const tk of c.tasks) ids.add(taskKey(tk.taskId));
          for (const ad of c.additions) ids.add(additionKey(ad.externalKey));
        }
        setSelected(ids);
        setTasks(t);
        setPositions(p);
      })
      .catch((err: Error) => {
        setError(err.message || 'Analyse échouée');
      })
      .finally(() => setLoading(false));
  }, [boardId]);

  const allTasks: AnalyzedTask[] = useMemo(
    () => columns.flatMap(c => c.tasks),
    [columns],
  );

  const allAdditions: ProposedAddition[] = useMemo(
    () => columns.flatMap(c => c.additions),
    [columns],
  );

  const totalProposals = allTasks.length + allAdditions.length;

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === totalProposals) {
      setSelected(new Set());
    } else {
      const all = new Set<string>();
      for (const t of allTasks) all.add(taskKey(t.taskId));
      for (const a of allAdditions) all.add(additionKey(a.externalKey));
      setSelected(all);
    }
  };

  const handleApply = async () => {
    const moves = allTasks
      .filter(t => selected.has(taskKey(t.taskId)))
      .map(t => ({
        taskId: t.taskId,
        startCol: t.recommended.startCol,
        endCol: t.recommended.endCol,
        row: t.recommended.row,
      }));
    const additionsPayload: SanityAdditionPayload[] = allAdditions
      .filter(a => selected.has(additionKey(a.externalKey)))
      .map(a => ({
        externalKey: a.externalKey,
        source: a.source,
        summary: a.summary,
        status: a.status,
        storyPoints: a.storyPoints,
        estimatedDays: a.estimatedDays,
        assignee: a.assignee,
        iterationName: a.iterationName,
        version: a.version,
        startCol: a.recommended.startCol,
        endCol: a.recommended.endCol,
        row: a.recommended.row,
      }));
    if (moves.length === 0 && additionsPayload.length === 0) return;

    setApplying(true);
    try {
      const res = await applySanityMoves(boardId, moves, additionsPayload);
      const parts: string[] = [];
      if (res.movesApplied) parts.push(`${res.movesApplied} déplacement${res.movesApplied > 1 ? 's' : ''}`);
      if (res.additionsApplied) parts.push(`${res.additionsApplied} ajout${res.additionsApplied > 1 ? 's' : ''}`);
      onToast?.({ type: 'success', message: parts.join(' · ') + ' appliqués' });
      onApplied();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Échec de l\'application';
      setError(message);
      onToast?.({ type: 'error', message });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal title="✨ Vérification IA du board" onClose={onClose} size="xl">
      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>
            <LoadingSpinner message="L'IA analyse votre board…" />
          </div>
        ) : error ? (
          <div className={styles.error}>
            <strong>Analyse impossible</strong>
            <p>{error}</p>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        ) : columns.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Tout semble bien positionné ✓</p>
            <p className={styles.emptyHint}>{summary || 'L\'IA n\'a détecté aucun ajustement nécessaire sur ce board.'}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>D'accord</Button>
            </div>
          </div>
        ) : (
          <>
            {analysis && <AnalysisPanel summary={summary} analysis={analysis} />}

            <div className={styles.toolbar}>
              <div className={styles.viewSwitcher}>
                <button
                  type="button"
                  className={`${styles.viewBtn} ${view === 'list' ? styles.viewBtnActive : ''}`}
                  onClick={() => setView('list')}
                >
                  Plan détaillé
                </button>
                <button
                  type="button"
                  className={`${styles.viewBtn} ${view === 'grid' ? styles.viewBtnActive : ''}`}
                  onClick={() => setView('grid')}
                >
                  Aperçu grille
                </button>
                <button
                  type="button"
                  className={`${styles.viewBtn} ${view === 'compare' ? styles.viewBtnActive : ''}`}
                  onClick={() => setView('compare')}
                  title="Comparaison avant / après"
                >
                  Comparaison
                </button>
              </div>
              <div className={styles.toolbarRight}>
                <button type="button" className={styles.linkBtn} onClick={toggleAll}>
                  {selected.size === totalProposals ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
                <span className={styles.counter}>
                  {selected.size} / {totalProposals} sélectionnée{totalProposals > 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {view === 'grid' && (
              <GridPreview
                tasks={tasks}
                positions={positions}
                recommendations={allTasks}
                additions={allAdditions}
                selectedIds={selected}
              />
            )}

            {view === 'compare' && (
              <ComparePreview
                tasks={tasks}
                positions={positions}
                recommendations={allTasks}
                additions={allAdditions}
                selectedIds={selected}
              />
            )}

            {view === 'list' && (
              <div className={styles.columnList}>
                {allAdditions.length > 0 && (
                  <div className={styles.additionsBanner}>
                    <strong>{allAdditions.length}</strong> ticket{allAdditions.length > 1 ? 's' : ''} présent{allAdditions.length > 1 ? 's' : ''} dans l'itération active {allAdditions.length > 1 ? 'sont absents' : 'est absent'} du board et {allAdditions.length > 1 ? 'seront ajoutés' : 'sera ajouté'} (vert ci-dessous).
                  </div>
                )}
                {columns.map(col => (
                  <ColumnSection
                    key={col.col}
                    column={col}
                    selected={selected}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose} disabled={applying}>Annuler</Button>
              <Button variant="primary" onClick={handleApply} disabled={applying || selected.size === 0}>
                {applying ? 'Application…' : `Appliquer la sélection (${selected.size})`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ==================== Analysis panel ====================

function AnalysisPanel({ summary, analysis }: { summary: string; analysis: BoardAnalysis }) {
  const statusEntries = Object.entries(analysis.byStatus).sort((a, b) => b[1] - a[1]);
  const versionEntries = analysis.versions;
  // Collapsed by default — the summary line carries the essential signal
  // and users asked for the stats grid not to crowd the proposals view.
  // Persist the preference so it sticks across modal opens.
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('delivery:sanity:analysis-expanded') === '1'; }
    catch { return false; }
  });
  const toggle = () => {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem('delivery:sanity:analysis-expanded', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className={styles.analysis}>
      <button
        type="button"
        className={styles.analysisToggle}
        onClick={toggle}
        aria-expanded={expanded}
        title={expanded ? 'Masquer les détails de l\'analyse' : 'Voir les détails de l\'analyse'}
      >
        <span className={styles.analysisChevron}>{expanded ? '▼' : '▶'}</span>
        <span className={styles.analysisSummary}>{summary}</span>
        {!expanded && (
          <span className={styles.analysisQuickStats}>
            {analysis.totalJiraTasks} tickets · {analysis.missingFromBoard} à ajouter
          </span>
        )}
      </button>
      {expanded && (
        <div className={styles.analysisStats}>
          <div className={styles.statGroup}>
            <div className={styles.statLabel}>Total analysé</div>
            <div className={styles.statValue}>{analysis.totalJiraTasks}</div>
          </div>
          <div className={styles.statGroup}>
            <div className={styles.statLabel}>Par statut</div>
            <div className={styles.statChips}>
              {statusEntries.map(([status, count]) => (
                <span key={status} className={styles.chip}>
                  {status} <strong>{count}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className={styles.statGroup}>
            <div className={styles.statLabel}>Tickets incomplets</div>
            <div className={styles.statChips}>
              <span className={styles.chip}>Sans estimation <strong>{analysis.missingEstimation}</strong></span>
              <span className={styles.chip}>Sans description <strong>{analysis.missingDescription}</strong></span>
            </div>
          </div>
          {analysis.missingFromBoard > 0 && (
            <div className={styles.statGroup}>
              <div className={styles.statLabel}>Dans le sprint, hors board</div>
              <div className={styles.statChips}>
                <span className={`${styles.chip} ${styles.chipHighlight}`}>
                  <strong>{analysis.missingFromBoard}</strong> ticket{analysis.missingFromBoard > 1 ? 's' : ''} à ajouter
                </span>
              </div>
            </div>
          )}
          {versionEntries.length > 0 && (
            <div className={styles.statGroup}>
              <div className={styles.statLabel}>Versions cibles détectées</div>
              <div className={styles.statChips}>
                {versionEntries.map(v => (
                  <span key={v.name} className={`${styles.chip} ${styles[`chipVersion_${v.category}`]}`}>
                    {v.name}
                    <span className={styles.chipCat}>{categoryLabel(v.category)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case 'next':  return 'prochaine';
    case 'later': return 'suivante';
    case 'past':  return 'passée';
    default:      return 'sans date';
  }
}

// ==================== Column section ====================

function ColumnSection({
  column,
  selected,
  onToggle,
}: {
  column: ColumnPlan;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const total = column.tasks.length + column.additions.length;
  return (
    <section className={styles.columnSection}>
      <header className={styles.columnHeader}>
        <div className={styles.columnTitle}>
          <span className={styles.columnIndex}>S{column.col + 1}</span>
          <span className={styles.columnLabel}>{column.label}</span>
          <span className={styles.columnTaskCount}>
            {total} {total > 1 ? 'entrées' : 'entrée'}
            {column.additions.length > 0 ? ` (${column.additions.length} ajout${column.additions.length > 1 ? 's' : ''})` : ''}
          </span>
        </div>
        <p className={styles.columnStrategy}>{column.strategy}</p>
      </header>
      <div className={styles.columnTasks}>
        {column.tasks.map(t => (
          <TaskCard
            key={`t-${t.taskId}`}
            task={t}
            selected={selected.has(taskKey(t.taskId))}
            onToggle={() => onToggle(taskKey(t.taskId))}
          />
        ))}
        {column.additions.map(a => (
          <AdditionCard
            key={`a-${a.externalKey}`}
            addition={a}
            selected={selected.has(additionKey(a.externalKey))}
            onToggle={() => onToggle(additionKey(a.externalKey))}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({
  task, selected, onToggle,
}: {
  task: AnalyzedTask;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`${styles.taskCard} ${selected ? styles.taskCardSelected : ''}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <div className={styles.taskBody}>
        <div className={styles.taskTop}>
          <span className={styles.taskTitle}>{task.taskTitle}</span>
          <span className={styles.taskMeta}>
            <StatusBadge status={task.status} />
            {task.version && (
              <span className={`${styles.versionTag} ${styles[`versionTag_${task.versionCategory}`]}`}>
                {task.version}
              </span>
            )}
            <span className={`${styles.qualityDot} ${task.hasEstimation ? styles.qualityOk : styles.qualityMissing}`} title={task.hasEstimation ? 'Estimation présente' : 'Sans estimation'}>
              est.
            </span>
            <span className={`${styles.qualityDot} ${task.hasDescription ? styles.qualityOk : styles.qualityMissing}`} title={task.hasDescription ? 'Description présente' : 'Sans description'}>
              desc.
            </span>
          </span>
        </div>
        <p className={styles.taskReasoning}>{task.reasoning}</p>
        <div className={styles.taskMove}>
          <span className={styles.movePos}>S{task.current.startCol + 1} · L{task.current.row + 1}</span>
          <span className={styles.moveArrow}>→</span>
          <span className={`${styles.movePos} ${styles.movePosNew}`}>S{task.recommended.startCol + 1} · L{task.recommended.row + 1}</span>
        </div>
      </div>
    </label>
  );
}

function AdditionCard({
  addition, selected, onToggle,
}: {
  addition: ProposedAddition;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`${styles.taskCard} ${styles.additionCard} ${selected ? styles.additionCardSelected : ''}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <div className={styles.taskBody}>
        <div className={styles.taskTop}>
          <span className={styles.taskTitle}>
            <span className={styles.additionBadge}>+ Ajouter</span>
            <span className={styles.sourceBadge}>{addition.source}</span>
            [{addition.externalKey}] {addition.summary}
          </span>
          <span className={styles.taskMeta}>
            <StatusBadge status={addition.status} />
            {addition.version && (
              <span className={`${styles.versionTag} ${styles[`versionTag_${addition.versionCategory}`]}`}>
                {addition.version}
              </span>
            )}
            <span className={`${styles.qualityDot} ${addition.hasEstimation ? styles.qualityOk : styles.qualityMissing}`}>est.</span>
            <span className={`${styles.qualityDot} ${addition.hasDescription ? styles.qualityOk : styles.qualityMissing}`}>desc.</span>
          </span>
        </div>
        <p className={styles.taskReasoning}>{addition.reasoning}</p>
        <div className={styles.taskMove}>
          <span className={styles.movePos}>absent du board</span>
          <span className={styles.moveArrow}>→</span>
          <span className={`${styles.movePos} ${styles.movePosNew}`}>S{addition.recommended.startCol + 1} · L{addition.recommended.row + 1}</span>
        </div>
      </div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let cls = styles.statusNeutral;
  if (lower.includes('progress') || lower.includes('en cours')) cls = styles.statusProgress;
  else if (lower.includes('done') || lower.includes('terminé') || lower.includes('termine')) cls = styles.statusDone;
  else if (lower.includes('block')) cls = styles.statusBlocked;
  else if (lower.includes('todo') || lower.includes('à faire') || lower.includes('a faire')) cls = styles.statusTodo;
  return <span className={`${styles.statusBadge} ${cls}`}>{status}</span>;
}

// ==================== Grid preview ====================

interface GridPreviewProps {
  tasks: Task[];
  positions: TaskPosition[];
  recommendations: AnalyzedTask[];
  additions: ProposedAddition[];
  selectedIds: Set<string>;
}

// Shared sizing logic — computes how many cols/rows the grid needs given
// all placements (current + recommended + additions).
function useGridSize(
  positions: TaskPosition[],
  recommendations: AnalyzedTask[],
  additions: ProposedAddition[],
) {
  return useMemo(() => {
    let maxCol = 4;
    let maxRow = 0;
    for (const p of positions) {
      if (p.endCol > maxCol) maxCol = p.endCol;
      if (p.row > maxRow) maxRow = p.row;
    }
    for (const r of recommendations) {
      if (r.recommended.endCol > maxCol) maxCol = r.recommended.endCol;
      if (r.recommended.row > maxRow) maxRow = r.recommended.row;
      if (r.current.endCol > maxCol) maxCol = r.current.endCol;
      if (r.current.row > maxRow) maxRow = r.current.row;
    }
    for (const a of additions) {
      if (a.recommended.endCol > maxCol) maxCol = a.recommended.endCol;
      if (a.recommended.row > maxRow) maxRow = a.recommended.row;
    }
    return { cols: Math.max(4, maxCol), rows: Math.max(2, maxRow + 1) };
  }, [positions, recommendations, additions]);
}

/** Render a `gridTask` block with the full title revealed on hover via a
 *  floating label that doesn't get clipped by the cell's `overflow: hidden`.
 *  Falls back to native `title=` attribute when the pointer lingers. */
function GridTask({
  startCol, endCol, row,
  label, fullTitle, tooltipSuffix,
  className,
}: {
  startCol: number; endCol: number; row: number;
  label: string;
  fullTitle: string;
  tooltipSuffix?: string;
  className: string;
}) {
  const [hover, setHover] = useState(false);
  const span = Math.max(1, endCol - startCol);
  return (
    <div
      className={`${styles.gridTask} ${className} ${hover ? styles.gridTaskHover : ''}`}
      style={{ gridColumn: `${startCol + 2} / span ${span}`, gridRow: row + 2 }}
      title={tooltipSuffix ? `${fullTitle}\n${tooltipSuffix}` : fullTitle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={styles.gridTaskLabel}>{label}</span>
      {hover && (
        <div className={styles.gridTaskTooltip} role="tooltip">
          <strong>{fullTitle}</strong>
          {tooltipSuffix && <div className={styles.gridTaskTooltipSub}>{tooltipSuffix}</div>}
        </div>
      )}
    </div>
  );
}

function GridLegend({ showAdditions, showMoves }: { showAdditions: boolean; showMoves: boolean }) {
  return (
    <div className={styles.gridLegend}>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.legendDotStatic}`} /> Tâche non déplacée
      </span>
      {showMoves && (
        <>
          <span className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotGhost}`} /> Position actuelle (à déplacer)
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotNew}`} /> Nouvelle position proposée
          </span>
        </>
      )}
      {showAdditions && (
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.legendDotAddition}`} /> Nouveau ticket à ajouter
        </span>
      )}
    </div>
  );
}

function shortenTitle(s: string, max = 22) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function GridPreview({ tasks, positions, recommendations, additions, selectedIds }: GridPreviewProps) {
  const positionByTaskId = useMemo(
    () => new Map(positions.map(p => [p.taskId, p])),
    [positions],
  );

  const { cols, rows } = useGridSize(positions, recommendations, additions);

  const recoByTaskId = useMemo(
    () => new Map(recommendations.map(r => [r.taskId, r])),
    [recommendations],
  );

  return (
    <div className={styles.gridWrapper}>
      <GridLegend showAdditions={additions.length > 0} showMoves />

      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `48px repeat(${cols}, minmax(56px, 1fr))`,
          gridTemplateRows: `24px repeat(${rows}, 34px)`,
        }}
      >
        <div className={`${styles.gridCell} ${styles.gridHeader}`} />
        {Array.from({ length: cols }).map((_, c) => (
          <div key={`ch-${c}`} className={`${styles.gridCell} ${styles.gridHeader}`}>
            S{c + 1}
          </div>
        ))}

        {Array.from({ length: rows }).map((_, r) => (
          <div key={`rh-${r}`} className={`${styles.gridCell} ${styles.gridRowHeader}`}>
            L{r + 1}
          </div>
        ))}
        {Array.from({ length: rows }).map((_, r) => (
          Array.from({ length: cols }).map((_, c) => (
            <div
              key={`bg-${r}-${c}`}
              className={styles.gridCell}
              style={{ gridColumn: c + 2, gridRow: r + 2 }}
            />
          ))
        ))}

        {tasks
          .filter(t => t.source === 'jira')
          .map(task => {
            const pos = positionByTaskId.get(task.id);
            if (!pos) return null;
            const reco = recoByTaskId.get(task.id);
            const isSelectedMove = !!reco && selectedIds.has(task.id);

            return (
              <div key={`task-${task.id}`} style={{ display: 'contents' }}>
                <GridTask
                  startCol={pos.startCol} endCol={pos.endCol} row={pos.row}
                  label={shortenTitle(task.title)}
                  fullTitle={task.title}
                  className={
                    isSelectedMove
                      ? styles.gridTaskGhost
                      : reco
                        ? styles.gridTaskGhostDim
                        : styles.gridTaskStatic
                  }
                />

                {reco && isSelectedMove && (
                  <GridTask
                    startCol={reco.recommended.startCol}
                    endCol={reco.recommended.endCol}
                    row={reco.recommended.row}
                    label={shortenTitle(task.title)}
                    fullTitle={task.title}
                    tooltipSuffix={`→ déplacement proposé · ${reco.reasoning}`}
                    className={styles.gridTaskNew}
                  />
                )}
              </div>
            );
          })}

        {/* Additions — rendered in green so they stand out from moves */}
        {additions.map(addition => {
          const label = `+ ${shortenTitle(`[${addition.externalKey}] ${addition.summary}`, 20)}`;
          const fullTitle = `[${addition.externalKey}] ${addition.summary}`;
          return (
            <GridTask
              key={`add-${addition.externalKey}`}
              startCol={addition.recommended.startCol}
              endCol={addition.recommended.endCol}
              row={addition.recommended.row}
              label={label}
              fullTitle={fullTitle}
              tooltipSuffix={`+ Ajout · ${addition.status}${addition.version ? ' · ' + addition.version : ''}\n${addition.reasoning}`}
              className={styles.gridTaskAddition}
            />
          );
        })}
      </div>
    </div>
  );
}

// ==================== Compare preview (avant/après) ====================

interface ComparePreviewProps {
  tasks: Task[];
  positions: TaskPosition[];
  recommendations: AnalyzedTask[];
  additions: ProposedAddition[];
  selectedIds: Set<string>;
}

/** Side-by-side grid rendering the board before vs after the proposed
 *  plan (moves + additions) would be applied. Unselected proposals are
 *  treated as "not applied" in the AFTER view. */
function ComparePreview({
  tasks, positions, recommendations, additions, selectedIds,
}: ComparePreviewProps) {
  const { cols, rows } = useGridSize(positions, recommendations, additions);

  const jiraTasks = useMemo(() => tasks.filter(t => t.source === 'jira'), [tasks]);

  const recoByTaskId = useMemo(
    () => new Map(recommendations.map(r => [r.taskId, r])),
    [recommendations],
  );

  const positionByTaskId = useMemo(
    () => new Map(positions.map(p => [p.taskId, p])),
    [positions],
  );

  return (
    <div className={styles.compareWrapper}>
      <GridLegend showAdditions={additions.length > 0} showMoves={false} />
      <div className={styles.compareGrids}>
        <CompareSide
          label="Avant"
          sublabel={`${jiraTasks.length} ticket${jiraTasks.length > 1 ? 's' : ''}`}
          cols={cols} rows={rows}
          renderTasks={() => (
            <>
              {jiraTasks.map(task => {
                const pos = positionByTaskId.get(task.id);
                if (!pos) return null;
                return (
                  <GridTask
                    key={`before-${task.id}`}
                    startCol={pos.startCol} endCol={pos.endCol} row={pos.row}
                    label={shortenTitle(task.title)}
                    fullTitle={task.title}
                    className={styles.gridTaskStatic}
                  />
                );
              })}
            </>
          )}
        />

        <CompareSide
          label="Après"
          sublabel={(() => {
            const movesApplied = recommendations.filter(r => selectedIds.has(`t:${r.taskId}`)).length;
            const addsApplied = additions.filter(a => selectedIds.has(`a:${a.externalKey}`)).length;
            return `${movesApplied} dépl. · ${addsApplied} ajout${addsApplied > 1 ? 's' : ''}`;
          })()}
          cols={cols} rows={rows}
          renderTasks={() => (
            <>
              {jiraTasks.map(task => {
                const pos = positionByTaskId.get(task.id);
                if (!pos) return null;
                const reco = recoByTaskId.get(task.id);
                const applied = !!reco && selectedIds.has(`t:${task.id}`);
                const target = applied && reco
                  ? reco.recommended
                  : { startCol: pos.startCol, endCol: pos.endCol, row: pos.row };
                return (
                  <GridTask
                    key={`after-${task.id}`}
                    startCol={target.startCol} endCol={target.endCol} row={target.row}
                    label={shortenTitle(task.title)}
                    fullTitle={task.title}
                    tooltipSuffix={applied ? `déplacé · ${reco!.reasoning}` : undefined}
                    className={applied ? styles.gridTaskNew : styles.gridTaskStatic}
                  />
                );
              })}
              {additions.filter(a => selectedIds.has(`a:${a.externalKey}`)).map(addition => (
                <GridTask
                  key={`after-add-${addition.externalKey}`}
                  startCol={addition.recommended.startCol}
                  endCol={addition.recommended.endCol}
                  row={addition.recommended.row}
                  label={`+ ${shortenTitle(`[${addition.externalKey}] ${addition.summary}`, 20)}`}
                  fullTitle={`[${addition.externalKey}] ${addition.summary}`}
                  tooltipSuffix={`+ Nouveau · ${addition.status}\n${addition.reasoning}`}
                  className={styles.gridTaskAddition}
                />
              ))}
            </>
          )}
        />
      </div>
    </div>
  );
}

function CompareSide({
  label, sublabel, cols, rows, renderTasks,
}: {
  label: string;
  sublabel: string;
  cols: number;
  rows: number;
  renderTasks: () => ReactNode;
}) {
  return (
    <div className={styles.compareSide}>
      <div className={styles.compareSideHeader}>
        <span className={styles.compareSideLabel}>{label}</span>
        <span className={styles.compareSideSub}>{sublabel}</span>
      </div>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `36px repeat(${cols}, minmax(44px, 1fr))`,
          gridTemplateRows: `22px repeat(${rows}, 30px)`,
          minWidth: 0,
        }}
      >
        <div className={`${styles.gridCell} ${styles.gridHeader}`} />
        {Array.from({ length: cols }).map((_, c) => (
          <div key={`ch-${c}`} className={`${styles.gridCell} ${styles.gridHeader}`}>
            S{c + 1}
          </div>
        ))}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`rh-${r}`} className={`${styles.gridCell} ${styles.gridRowHeader}`}>
            L{r + 1}
          </div>
        ))}
        {Array.from({ length: rows }).map((_, r) => (
          Array.from({ length: cols }).map((_, c) => (
            <div
              key={`bg-${r}-${c}`}
              className={styles.gridCell}
              style={{ gridColumn: c + 2, gridRow: r + 2 }}
            />
          ))
        ))}
        {renderTasks()}
      </div>
    </div>
  );
}
