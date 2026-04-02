/**
 * Position data used for row tracking calculations.
 */
interface PositionLike {
  startCol: number;
  endCol?: number;
  row: number;
  rowSpan?: number;
}

/**
 * Build a row tracker for placing new tasks without saved positions.
 * Accounts for rowSpan so containers don't get overlapped.
 */
export function buildRowTracker(positions: Iterable<PositionLike>): Record<number, number> {
  const maxSavedRowByCol: Record<number, number> = { 0: -1, 2: -1, 4: -1 };

  for (const p of positions) {
    const col = p.startCol;
    const endRow = p.row + (p.rowSpan || 1) - 1;
    if (col in maxSavedRowByCol) {
      maxSavedRowByCol[col] = Math.max(maxSavedRowByCol[col], endRow);
    }
  }

  return {
    0: maxSavedRowByCol[0] + 1,
    2: maxSavedRowByCol[2] + 1,
    4: maxSavedRowByCol[4] + 1,
  };
}

/**
 * Bounding box for collision detection.
 */
interface BoundingBox {
  id?: string;
  startCol: number;
  endCol: number;
  row: number;
  rowSpan: number;
}

/**
 * Check if two task bounding boxes overlap.
 */
export function tasksOverlap(a: BoundingBox, b: BoundingBox): boolean {
  const hOverlap = a.startCol < b.endCol && b.startCol < a.endCol;
  const vOverlap = a.row < (b.row + b.rowSpan) && b.row < (a.row + a.rowSpan);
  return hOverlap && vOverlap;
}

/**
 * Resolve collisions after a task is placed.
 * Pushes overlapping tasks down. Returns updated positions.
 * Max 10 iterations to prevent infinite loops.
 */
export function resolveCollisions(
  positions: BoundingBox[],
  movedId: string,
): BoundingBox[] {
  const result = positions.map(p => ({ ...p }));
  const moved = result.find(p => p.id === movedId);
  if (!moved) return result;

  for (let iter = 0; iter < 10; iter++) {
    let hasCollision = false;
    for (const other of result) {
      if (other.id === movedId) continue;
      if (tasksOverlap(moved, other)) {
        other.row = moved.row + moved.rowSpan;
        hasCollision = true;
      }
    }
    if (!hasCollision) break;

    // Check chain reactions — pushed task might now overlap another
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (result[i].id === result[j].id) continue;
        if (tasksOverlap(result[i], result[j])) {
          // Push the lower one further down
          const lower = result[i].row >= result[j].row ? result[i] : result[j];
          const upper = lower === result[i] ? result[j] : result[i];
          lower.row = upper.row + upper.rowSpan;
          hasCollision = true;
        }
      }
    }
    if (!hasCollision) break;
  }

  return result;
}
