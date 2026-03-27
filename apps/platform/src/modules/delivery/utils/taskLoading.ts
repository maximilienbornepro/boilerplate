/**
 * Position data used for row tracking calculations.
 */
interface PositionLike {
  startCol: number;
  row: number;
}

/**
 * Build a row tracker for placing new tasks without saved positions.
 * Returns a mutable record mapping column index to the next available row.
 *
 * Scans through all saved positions to find the maximum row per column,
 * then starts new tasks on the row after the highest saved position.
 *
 * @param positions - Array or iterable of saved position objects
 * @returns Record mapping column (0, 2, 4) to the next free row index
 */
export function buildRowTracker(positions: Iterable<PositionLike>): Record<number, number> {
  const maxSavedRowByCol: Record<number, number> = { 0: -1, 2: -1, 4: -1 };

  for (const p of positions) {
    const col = p.startCol;
    if (col in maxSavedRowByCol) {
      maxSavedRowByCol[col] = Math.max(maxSavedRowByCol[col], p.row);
    }
  }

  return {
    0: maxSavedRowByCol[0] + 1,
    2: maxSavedRowByCol[2] + 1,
    4: maxSavedRowByCol[4] + 1,
  };
}
