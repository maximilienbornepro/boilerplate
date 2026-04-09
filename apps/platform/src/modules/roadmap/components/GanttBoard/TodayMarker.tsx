import { useMemo } from 'react';
import type { ViewMode, TimeColumn } from '../../types';
import { getColumnWidth, getDaysBetween, getBusinessDaysBetween, calculatePixelOffset } from '../../utils/dateUtils';

interface TodayMarkerProps {
  chartStartDate: Date;
  chartEndDate?: Date;
  viewMode: ViewMode;
  totalHeight?: number;
  columns?: TimeColumn[];
}

export function TodayMarker({ chartStartDate, viewMode, columns, totalHeight }: TodayMarkerProps) {
  const columnWidth = getColumnWidth(viewMode);

  const leftPosition = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < chartStartDate) return null;

    if (viewMode === 'month' && columns && columns.length > 0) {
      return calculatePixelOffset(today, columns, columnWidth);
    }

    let offset: number;
    if (viewMode === 'month') {
      offset = getBusinessDaysBetween(chartStartDate, today);
    } else if (viewMode === 'quarter') {
      offset = getDaysBetween(chartStartDate, today) / 7;
    } else {
      offset = (today.getFullYear() - chartStartDate.getFullYear()) * 12 +
        (today.getMonth() - chartStartDate.getMonth()) +
        (today.getDate() - 1) / 30;
    }

    return offset * columnWidth;
  }, [chartStartDate, viewMode, columnWidth, columns]);

  if (leftPosition === null) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 250 + leftPosition + columnWidth / 2,
        width: 2,
        height: totalHeight ? `${totalHeight}px` : '100%',
        background: 'var(--accent-primary)',
        opacity: 0.7,
        transform: 'translateX(-1px)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
