export interface FreeRect {
  col0: number;
  row0: number;
  cols: number;
  rows: number;
}
export interface GridCell {
  col: number;
  row: number;
}
/** Optional work counters for the full-size SL5 complexity proof; no clock or test-only branch. */
export interface FreeRectWork {
  visits: number;
  pushes: number;
  pops: number;
}

/** Histogram/stack maximum in O(cols × rows); the caller marks only fresh AVAILABLE cells true. */
export function maxFreeRect(
  cols: number,
  rows: number,
  available: (col: number, row: number) => boolean,
  mustContain?: GridCell,
  work?: FreeRectWork,
): FreeRect | null {
  if (![cols, rows].every((n) => Number.isInteger(n) && n >= 1 && n <= 255))
    throw new RangeError('Grid dimensions must be integers from 1 to 255');
  if (
    mustContain &&
    (!Number.isInteger(mustContain.col) ||
      !Number.isInteger(mustContain.row) ||
      mustContain.col < 0 ||
      mustContain.col >= cols ||
      mustContain.row < 0 ||
      mustContain.row >= rows)
  )
    throw new RangeError('Required cell must be in the grid');
  const heights = new Uint16Array(cols);
  if (work) work.visits = work.pushes = work.pops = 0;
  const stack: { start: number; height: number }[] = [];
  let best: FreeRect | null = null;
  function consider(col0: number, row0: number, width: number, height: number): void {
    if (
      mustContain &&
      (mustContain.col < col0 ||
        mustContain.col >= col0 + width ||
        mustContain.row < row0 ||
        mustContain.row >= row0 + height)
    )
      return;
    const area = width * height;
    const previous = best ? best.cols * best.rows : 0;
    // Stable ties: topmost, then leftmost, then widest. No dependence on stack traversal order.
    if (
      area > previous ||
      (area === previous &&
        best &&
        (row0 < best.row0 ||
          (row0 === best.row0 && (col0 < best.col0 || (col0 === best.col0 && width > best.cols)))))
    )
      best = { col0, row0, cols: width, rows: height };
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (work) work.visits++;
      heights[col] = available(col, row) ? heights[col]! + 1 : 0;
    }
    stack.length = 0;
    for (let col = 0; col <= cols; col++) {
      const height = col === cols ? 0 : heights[col]!;
      if (work) work.visits++;
      let start = col;
      while (stack.length && stack[stack.length - 1]!.height > height) {
        const previous = stack.pop()!;
        if (work) work.pops++;
        consider(previous.start, row + 1 - previous.height, col - previous.start, previous.height);
        start = previous.start;
      }
      if (height > 0 && (!stack.length || stack[stack.length - 1]!.height < height)) {
        if (work) work.pushes++;
        stack.push({ start, height });
      }
    }
  }
  return best;
}
