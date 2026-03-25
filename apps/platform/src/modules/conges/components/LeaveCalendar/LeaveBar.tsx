import { useMemo } from 'react';
import type { Leave } from '../../types';
import styles from './LeaveBar.module.css';

interface LeaveBarProps {
  leave: Leave;
  color: string;
  chartStartDate: string;
  columnWidth: number;
  onClick: (leave: Leave) => void;
}

function getDayOffset(date: string, chartStart: string): number {
  const d = new Date(date);
  const s = new Date(chartStart);
  return Math.floor((d.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

const PERIOD_LABELS: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Apres-midi',
  full: '',
};

export function LeaveBar({ leave, color, chartStartDate, columnWidth, onClick }: LeaveBarProps) {
  const position = useMemo(() => {
    const startOffset = getDayOffset(leave.startDate, chartStartDate);
    const endOffset = getDayOffset(leave.endDate, chartStartDate);
    const daySpan = endOffset - startOffset + 1;

    let left = startOffset * columnWidth;
    let width = daySpan * columnWidth;

    if (leave.startPeriod === 'afternoon') {
      left += columnWidth / 2;
      width -= columnWidth / 2;
    }
    if (leave.endPeriod === 'morning') {
      width -= columnWidth / 2;
    }

    return { left, width: Math.max(width, 4) };
  }, [leave, chartStartDate, columnWidth]);

  const title = [
    leave.reason,
    leave.startPeriod !== 'full' ? `Debut: ${PERIOD_LABELS[leave.startPeriod]}` : null,
    leave.endPeriod !== 'full' ? `Fin: ${PERIOD_LABELS[leave.endPeriod]}` : null,
  ].filter(Boolean).join(' | ') || 'Conge';

  return (
    <div
      className={styles.bar}
      style={{
        left: position.left,
        width: position.width,
        backgroundColor: color,
      }}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(leave);
      }}
    >
      {position.width > 60 && (
        <span className={styles.label}>
          {leave.reason || 'Conge'}
        </span>
      )}
    </div>
  );
}
