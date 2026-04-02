import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { Member, Leave, ViewMode } from '../../types';
import { LeaveBar } from './LeaveBar';
import { isHoliday, getDateRangeWarnings } from '../../utils/holidays';
import styles from './LeaveCalendar.module.css';

interface LeaveCalendarProps {
  members: Member[];
  leaves: Leave[];
  startDate: string;
  endDate: string;
  viewMode: ViewMode;
  currentUserId?: number;
  isAdmin?: boolean;
  onLeaveClick: (leave: Leave) => void;
  onLeaveMove?: (leave: Leave, newStartDate: string, newEndDate: string, warnings: string[]) => void;
  onLeaveResize?: (leave: Leave, newStartDate: string, newEndDate: string, warnings: string[]) => void;
  scrollToTodayTrigger?: number;
}

const COLUMN_WIDTHS: Record<string, number> = {
  month: 28,
  quarter: 10,
};

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const ROW_HEIGHT = 72;
const NAME_COL_WIDTH = 200;

interface DayColumn {
  date: string;
  day: number;
  month: number;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
  isWeekStart: boolean;
  weekNumber: number;
}

interface MonthGroup {
  label: string;
  startIndex: number;
  span: number;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function generateColumns(start: string, end: string): DayColumn[] {
  const cols: DayColumn[] = [];
  const todayLocal = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();
  const current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dow = current.getDay();
    cols.push({
      date: dateStr,
      day: current.getDate(),
      month: current.getMonth(),
      isWeekend: dow === 0 || dow === 6,
      isHoliday: isHoliday(dateStr),
      isToday: dateStr === todayLocal,
      isWeekStart: dow === 1,
      weekNumber: getWeekNumber(current),
    });
    current.setDate(current.getDate() + 1);
  }
  return cols;
}

function getMonthGroups(columns: DayColumn[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let currentMonth = -1;

  for (let i = 0; i < columns.length; i++) {
    if (columns[i].month !== currentMonth) {
      groups.push({ label: MONTH_NAMES[columns[i].month], startIndex: i, span: 1 });
      currentMonth = columns[i].month;
    } else {
      groups[groups.length - 1].span++;
    }
  }
  return groups;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  // Use local date parts to avoid UTC offset shifting the date (e.g. UTC+1/+2)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function LeaveCalendar({
  members,
  leaves,
  startDate,
  endDate,
  viewMode,
  currentUserId,
  isAdmin = false,
  onLeaveClick,
  onLeaveMove,
  onLeaveResize,
  scrollToTodayTrigger,
}: LeaveCalendarProps) {
  // Drag state
  const dragRef = useRef<{ leave: Leave; grabDayOffset: number } | null>(null);

  // Resize state
  type ResizeState = { leave: Leave; side: 'left' | 'right'; startClientX: number; origStart: string; origEnd: string };
  const resizeRef = useRef<ResizeState | null>(null);
  const [resizePreview, setResizePreview] = useState<{ leaveId: string; startDate: string; endDate: string } | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const nameScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridScrollWidth, setGridScrollWidth] = useState(0);

  // Measure the grid scroll area directly for accurate year-view column sizing
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGridScrollWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => generateColumns(startDate, endDate), [startDate, endDate]);

  const colWidth = useMemo(() => {
    if (viewMode === 'year' && gridScrollWidth > 0 && columns.length > 0) {
      // Use exact fractional width so all columns together fill gridScrollWidth precisely
      return Math.max(2, gridScrollWidth / columns.length);
    }
    return COLUMN_WIDTHS[viewMode] || 3;
  }, [viewMode, gridScrollWidth, columns.length]);

  const monthGroups = useMemo(() => getMonthGroups(columns), [columns]);
  // For year view, force totalWidth = gridScrollWidth to guarantee full-width (no rounding gap)
  const totalWidth = viewMode === 'year' && gridScrollWidth > 0
    ? gridScrollWidth
    : columns.length * colWidth;
  const todayIndex = columns.findIndex((c) => c.isToday);

  const leavesByMember = useMemo(() => {
    const map = new Map<number, Leave[]>();
    for (const leave of leaves) {
      const list = map.get(leave.memberId) || [];
      list.push(leave);
      map.set(leave.memberId, list);
    }
    return map;
  }, [leaves]);

  // Sync scrolls: grid → header + name column
  useEffect(() => {
    const grid = gridScrollRef.current;
    if (!grid) return;

    const onScroll = () => {
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = grid.scrollLeft;
      }
      if (nameScrollRef.current) {
        nameScrollRef.current.scrollTop = grid.scrollTop;
      }
    };
    grid.addEventListener('scroll', onScroll);
    return () => grid.removeEventListener('scroll', onScroll);
  }, []);

  // Resize mouse handlers (global, so drag outside the bar still works)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { leave, side, startClientX, origStart, origEnd } = resizeRef.current;
      const deltaPx = e.clientX - startClientX;
      const deltaDays = Math.round(deltaPx / colWidth);
      if (deltaDays === 0) return;

      let newStart = origStart;
      let newEnd = origEnd;

      if (side === 'left') {
        const candidate = addDays(origStart, deltaDays);
        // Can't go past end date (min 1 day)
        if (candidate < origEnd) newStart = candidate;
        else newStart = addDays(origEnd, -1);
      } else {
        const candidate = addDays(origEnd, deltaDays);
        // Can't go before start date (min 1 day)
        if (candidate > origStart) newEnd = candidate;
        else newEnd = addDays(origStart, 1);
      }

      setResizePreview({ leaveId: leave.id, startDate: newStart, endDate: newEnd });
    };

    const onMouseUp = () => {
      const state = resizeRef.current;
      resizeRef.current = null;
      if (!state || !onLeaveResize) { setResizePreview(null); return; }
      setResizePreview(prev => {
        if (prev) {
          const warnings = getDateRangeWarnings(prev.startDate, prev.endDate);
          onLeaveResize(state.leave, prev.startDate, prev.endDate, warnings);
        }
        return null;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [colWidth, resizePreview, onLeaveResize]);

  // Helper: pixel offset of the 1st day of the current month
  const getStartOfMonthOffset = useCallback(() => {
    const today = new Date();
    const startOfMonthDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const idx = columns.findIndex(c => c.date === startOfMonthDate);
    return Math.max(0, (idx >= 0 ? idx : Math.max(0, todayIndex)) * colWidth);
  }, [columns, colWidth, todayIndex]);

  // Initial mount: instant scroll to 1st of current month (no visible jump)
  useEffect(() => {
    let raf: number;
    raf = requestAnimationFrame(() => {
      const grid = gridScrollRef.current;
      if (!grid) return;
      grid.scrollTo({ left: getStartOfMonthOffset(), behavior: 'instant' });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aujourd'hui button: smooth scroll to 1st of current month
  useEffect(() => {
    if (!scrollToTodayTrigger) return;
    const grid = gridScrollRef.current;
    if (!grid) return;
    grid.scrollTo({ left: getStartOfMonthOffset(), behavior: 'smooth' });
  }, [scrollToTodayTrigger, getStartOfMonthOffset]);

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Header */}
      <div className={styles.headerArea}>
        <div className={styles.nameColHeader}>Membres</div>
        <div className={styles.headerScroll} ref={headerScrollRef}>
          <div className={styles.headerInner} style={{ width: totalWidth }}>
            {/* Month row */}
            <div className={styles.monthRow}>
              {monthGroups.map((g, i) => (
                <div
                  key={i}
                  className={styles.monthLabel}
                  style={{ left: g.startIndex * colWidth, width: g.span * colWidth }}
                >
                  {g.span * colWidth > 30 ? g.label : ''}
                </div>
              ))}
            </div>
            {/* Day row */}
            {viewMode !== 'year' && (
              <div className={styles.dayRow}>
                {viewMode === 'quarter'
                  ? columns.map((col, i) => col.isWeekStart ? (
                      <div
                        key={i}
                        className={styles.weekLabel}
                        style={{ left: i * colWidth, width: Math.min(7, columns.length - i) * colWidth }}
                      >
                        S{col.weekNumber}
                      </div>
                    ) : null)
                  : columns.map((col, i) => (
                      <div
                        key={i}
                        className={`${styles.dayLabel} ${col.isWeekend ? styles.dayWeekend : ''} ${col.isHoliday ? styles.dayHoliday : ''} ${col.isToday ? styles.dayToday : ''}`}
                        style={{ left: i * colWidth, width: colWidth }}
                        title={col.isHoliday ? 'Jour férié' : undefined}
                      >
                        {col.day}
                      </div>
                    ))
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className={styles.bodyArea}>
        {/* Fixed name column */}
        <div className={styles.nameColumn} ref={nameScrollRef}>
          {members.map((m) => (
            <div key={m.id} className={`${styles.nameCell} ${m.id === currentUserId ? styles.currentUser : ''}`} style={{ height: ROW_HEIGHT }}>
              <span className={styles.dot} style={{ backgroundColor: m.color }} />
              <span className={styles.memberName}>{m.email}</span>
            </div>
          ))}
        </div>

        {/* Scrollable grid */}
        <div className={styles.gridScroll} ref={gridScrollRef}>
          <div className={styles.gridInner} style={{ width: totalWidth }}>
            {/* Background grid columns */}
            <div className={styles.gridBackground}>
              {columns.map((col, i) => (
                <div
                  key={i}
                  className={`${styles.gridCol} ${viewMode === 'year' ? styles.yearViewCol : ''} ${viewMode === 'quarter' ? styles.quarterViewCol : ''} ${col.isWeekend && viewMode !== 'year' ? styles.weekend : ''} ${col.isHoliday && viewMode !== 'year' ? styles.holiday : ''} ${(col.isWeekStart && viewMode === 'year') || (col.isWeekStart && viewMode === 'quarter') ? styles.weekStart : ''}`}
                  style={{ left: i * colWidth, width: colWidth }}
                />
              ))}
            </div>

            {/* Today marker */}
            {todayIndex >= 0 && (
              <div className={styles.todayMarker} style={{ left: todayIndex * colWidth + colWidth / 2 }}>
                <div className={styles.todayLine} />
              </div>
            )}

            {/* Rows */}
            {members.map((member) => {
              const memberLeaves = leavesByMember.get(member.id) || [];
              return (
                <div
                  key={member.id}
                  className={styles.gridRow}
                  style={{ height: ROW_HEIGHT }}
                  onDragOver={(e) => { if (dragRef.current) e.preventDefault(); }}
                  onDrop={(e) => {
                    if (!dragRef.current || !onLeaveMove) return;
                    e.preventDefault();
                    const { leave, grabDayOffset } = dragRef.current;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    // getBoundingClientRect().left already accounts for scroll offset — no need to add scrollLeft
                    const dropX = e.clientX - rect.left;
                    const dropDayIndex = Math.floor(dropX / colWidth);
                    const newStartIndex = dropDayIndex - grabDayOffset;
                    const duration =
                      Math.floor((new Date(leave.endDate).getTime() - new Date(leave.startDate).getTime()) / (1000 * 60 * 60 * 24));
                    const newStart = addDays(startDate, newStartIndex);
                    const newEnd = addDays(newStart, duration);
                    const warnings = getDateRangeWarnings(newStart, newEnd);
                    dragRef.current = null;
                    onLeaveMove(leave, newStart, newEnd, warnings);
                  }}
                >
                  {memberLeaves.map((leave) => {
                    const canDrag = isAdmin || leave.memberId === currentUserId;
                    const preview = resizePreview?.leaveId === leave.id ? resizePreview : null;
                    return (
                      <LeaveBar
                        key={leave.id}
                        leave={leave}
                        color={member.color}
                        chartStartDate={startDate}
                        columnWidth={colWidth}
                        isDraggable={canDrag}
                        previewStart={preview?.startDate}
                        previewEnd={preview?.endDate}
                        onClick={onLeaveClick}
                        onDragStart={(_e, l, grabDayOffset) => {
                          dragRef.current = { leave: l, grabDayOffset };
                        }}
                        onResizeStart={(_e, l, side) => {
                          resizeRef.current = {
                            leave: l,
                            side,
                            startClientX: _e.clientX,
                            origStart: l.startDate,
                            origEnd: l.endDate,
                          };
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
