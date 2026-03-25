import { useMemo } from 'react';
import type { ViewMode } from '../../types';
import { getColumnWidth, getDaysBetween, getBusinessDaysBetween, isSameDay } from '../../utils/dateUtils';

interface TodayMarkerProps {
  chartStartDate: Date;
  viewMode: ViewMode;
  totalHeight: number;
}

export function TodayMarker({ chartStartDate, viewMode, totalHeight }: TodayMarkerProps) {
  const columnWidth = getColumnWidth(viewMode);

  const leftPosition = useMemo(() => {
    const today = new Date();
    if (today < chartStartDate) return null;

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
  }, [chartStartDate, viewMode, columnWidth]);

  if (leftPosition === null) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: leftPosition,
        width: 2,
        height: totalHeight,
        background: 'var(--accent-primary)',
        opacity: 0.7,
        transform: 'translateX(-1px)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
