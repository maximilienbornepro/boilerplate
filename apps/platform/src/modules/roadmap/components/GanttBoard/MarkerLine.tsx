import { useState, useRef, useEffect, useMemo } from 'react';
import type { ViewMode, Marker, Task, TimeColumn } from '../../types';
import { calculateTaskPosition, getColumnWidth, parseDate } from '../../utils/dateUtils';
import { TASK_COLORS } from '../../utils/taskUtils';
import { useDragMarker } from '../../hooks/useDragMarker';
import styles from './MarkerLine.module.css';

interface TopLevelTaskRow {
  task: Task;
  rowIndex: number;
}

interface MarkerLineProps {
  marker: Marker;
  chartStartDate: Date;
  chartEndDate: Date;
  viewMode: ViewMode;
  onUpdate?: (markerId: string, data: Partial<{ name: string; markerDate: string; color: string; taskId: string | null }>) => void;
  onDelete?: (markerId: string) => void;
  readOnly?: boolean;
  topLevelTaskRows?: TopLevelTaskRow[];
  rowHeight?: number;
  /**
   * Cumulative y offsets for all flat rows (length = N+1). When provided,
   * the badge uses `rowOffsets[rowIndex]` instead of `rowIndex * rowHeight`
   * to account for variable row heights.
   */
  rowOffsets?: number[];
  /** Max height in px — if provided, the vertical line stops at this height */
  maxHeight?: number;
  /** Effective columns used by the Gantt (with dynamic widths stamped for year view) */
  columns?: TimeColumn[];
  /** Effective column width (dynamic in year view) */
  effectiveColumnWidth?: number;
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export function MarkerLine({
  marker, chartStartDate, chartEndDate, viewMode, onUpdate, onDelete, readOnly, topLevelTaskRows, rowHeight = 64, rowOffsets, maxHeight, columns, effectiveColumnWidth,
}: MarkerLineProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(marker.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const columnWidth = effectiveColumnWidth ?? getColumnWidth(viewMode);

  const { markerRef, handleMouseDown } = useDragMarker({
    markerId: marker.id,
    markerDate: marker.markerDate,
    chartStartDate,
    chartEndDate,
    viewMode,
    onMove: (id, newDate, taskId) => {
      onUpdate?.(id, { markerDate: newDate, taskId });
    },
    topLevelTaskRows,
    rowHeight,
    currentTaskId: marker.taskId,
    columns,
    effectiveColumnWidth: columnWidth,
  });

  const markerDate = parseDate(marker.markerDate);
  if (markerDate < chartStartDate || markerDate > chartEndDate) return null;

  const { left } = calculateTaskPosition(markerDate, markerDate, chartStartDate, columnWidth, viewMode, columns);
  const finalPosition = 250 + left;

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setEditName(marker.name);
    setIsEditing(true);
  };

  const handleNameSave = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== marker.name) onUpdate?.(marker.id, { name: trimmed });
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNameSave();
    else if (e.key === 'Escape') setIsEditing(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.(marker.id);
  };

  const handleColorChange = (e: React.MouseEvent, color: string) => {
    e.preventDefault();
    e.stopPropagation();
    onUpdate?.(marker.id, { color });
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Find snapped task row for vertical badge positioning
  const snappedRow = useMemo(() => {
    if (!marker.taskId || !topLevelTaskRows) return null;
    return topLevelTaskRows.find(r => r.task.id === marker.taskId) ?? null;
  }, [marker.taskId, topLevelTaskRows]);

  const badgeTop =
    snappedRow !== null
      ? (rowOffsets ? rowOffsets[snappedRow.rowIndex] : snappedRow.rowIndex * rowHeight) + 4
      : undefined;

  return (
    <div
      ref={markerRef}
      className={styles.marker}
      style={{
        left: finalPosition,
        ...(maxHeight !== undefined ? { height: maxHeight, bottom: 'auto' } : {}),
      }}
    >
      <div className={styles.line} style={{ backgroundImage: `linear-gradient(180deg, ${marker.color} 0%, ${marker.color} 50%, transparent 50%, transparent 100%)` }} />
      <div
        className={`${styles.badge} ${readOnly ? styles.badgeReadOnly : ''}`}
        onMouseDown={readOnly ? undefined : handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{ background: marker.color, ...(badgeTop !== undefined ? { top: badgeTop } : {}) }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            className={styles.nameInput}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className={styles.badgeContent}>
              <span className={styles.name}>{marker.name}</span>
              <span className={styles.date}>{formatDateLabel(marker.markerDate)}</span>
            </div>
            {!readOnly && (
              <button className={styles.deleteBtn} onClick={handleDelete} onMouseDown={(e) => e.stopPropagation()} title="Supprimer le marqueur">
                &times;
              </button>
            )}
          </>
        )}
        {!readOnly && (
          <div className={styles.colorPicker} onMouseDown={(e) => e.stopPropagation()}>
            {TASK_COLORS.map((color) => (
              <button
                key={color}
                className={`${styles.colorDot} ${marker.color === color ? styles.colorDotSelected : ''}`}
                style={{ backgroundColor: color }}
                onClick={(e) => handleColorChange(e, color)}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
