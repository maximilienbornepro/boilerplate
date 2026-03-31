import { useMemo, useRef, useEffect, useState } from 'react';
import type { Member, Leave, ViewMode } from '../../types';
import { LeaveBar } from './LeaveBar';
import styles from './LeaveCalendar.module.css';

interface LeaveCalendarProps {
  members: Member[];
  leaves: Leave[];
  startDate: string;
  endDate: string;
  viewMode: ViewMode;
  currentUserId?: number;
  onLeaveClick: (leave: Leave) => void;
  scrollToTodayTrigger?: number;
}

const COLUMN_WIDTHS: Record<string, number> = {
  month: 28,
  quarter: 10,
};

const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const ROW_HEIGHT = 56;
const NAME_COL_WIDTH = 200;

interface DayColumn {
  date: string;
  day: number;
  month: number;
  isWeekend: boolean;
  isToday: boolean;
}

interface MonthGroup {
  label: string;
  startIndex: number;
  span: number;
}

function generateColumns(start: string, end: string): DayColumn[] {
  const cols: DayColumn[] = [];
  const today = new Date().toISOString().split('T')[0];
  const current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const dow = current.getDay();
    cols.push({
      date: dateStr,
      day: current.getDate(),
      month: current.getMonth(),
      isWeekend: dow === 0 || dow === 6,
      isToday: dateStr === today,
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

export function LeaveCalendar({
  members,
  leaves,
  startDate,
  endDate,
  viewMode,
  currentUserId,
  onLeaveClick,
  scrollToTodayTrigger,
}: LeaveCalendarProps) {
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const nameScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width for dynamic year column sizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => generateColumns(startDate, endDate), [startDate, endDate]);

  const colWidth = useMemo(() => {
    if (viewMode === 'year' && containerWidth > 0 && columns.length > 0) {
      const availableWidth = containerWidth - NAME_COL_WIDTH;
      return Math.max(3, Math.floor(availableWidth / columns.length));
    }
    return COLUMN_WIDTHS[viewMode] || 3;
  }, [viewMode, containerWidth, columns.length]);

  const monthGroups = useMemo(() => getMonthGroups(columns), [columns]);
  const totalWidth = columns.length * colWidth;
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

  // Scroll to today on mount + when trigger changes
  useEffect(() => {
    if (todayIndex < 0) return;
    const grid = gridScrollRef.current;
    if (!grid) return;

    const todayOffset = todayIndex * colWidth;
    const containerWidth = grid.clientWidth;
    grid.scrollLeft = Math.max(0, todayOffset - containerWidth / 2);
  }, [todayIndex, colWidth, scrollToTodayTrigger]);

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
                {columns.map((col, i) => (
                  <div
                    key={i}
                    className={`${styles.dayLabel} ${col.isWeekend ? styles.dayWeekend : ''} ${col.isToday ? styles.dayToday : ''}`}
                    style={{ left: i * colWidth, width: colWidth }}
                  >
                    {viewMode === 'month' ? col.day : ''}
                  </div>
                ))}
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
                  className={`${styles.gridCol} ${col.isWeekend ? styles.weekend : ''}`}
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
                <div key={member.id} className={styles.gridRow} style={{ height: ROW_HEIGHT }}>
                  {memberLeaves.map((leave) => (
                    <LeaveBar
                      key={leave.id}
                      leave={leave}
                      color={member.color}
                      chartStartDate={startDate}
                      columnWidth={colWidth}
                      onClick={onLeaveClick}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
