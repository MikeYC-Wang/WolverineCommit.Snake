/**
 * Domain types shared across data fetching, pathfinding, and rendering.
 * Kept in one place so the three layers agree on a single grid coordinate
 * system: `weekIndex` is the column (0 = oldest week), `dayIndex` is the row
 * (0 = Sunday .. 6 = Saturday), matching GitHub's own contribution calendar
 * layout.
 */

/** GitHub's contribution intensity bucket, 0 (none) through 4 (highest). */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionDay {
  readonly date: string;
  readonly count: number;
  readonly level: ContributionLevel;
  readonly weekIndex: number;
  readonly dayIndex: number;
}

export interface ContributionGrid {
  readonly weeks: ReadonlyArray<ReadonlyArray<ContributionDay>>;
  readonly weekCount: number;
  /** Always 7 (Sunday..Saturday), kept explicit for readability at call sites. */
  readonly dayCount: number;
}

/** A single addressable cell in the grid, independent of its contribution data. */
export interface GridCell {
  readonly weekIndex: number;
  readonly dayIndex: number;
}

export function cellKey(cell: GridCell): string {
  return `${cell.weekIndex},${cell.dayIndex}`;
}

export function cellsEqual(a: GridCell, b: GridCell): boolean {
  return a.weekIndex === b.weekIndex && a.dayIndex === b.dayIndex;
}

export function getDay(grid: ContributionGrid, cell: GridCell): ContributionDay {
  const week = grid.weeks[cell.weekIndex];
  const day = week?.[cell.dayIndex];
  if (!day) {
    throw new RangeError(`Cell (${cell.weekIndex}, ${cell.dayIndex}) is out of bounds for grid`);
  }
  return day;
}
