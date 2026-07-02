import { cellKey, type ContributionGrid, type GridCell } from "../types.js";

/**
 * Fixed number of trailing body segments (excluding the head). The snake is a
 * classic, contiguous follow-the-leader chain: at any moment it occupies
 * `bodyLength + 1` orthogonally-adjacent cells and moves exactly one cell per
 * step.
 */
export const DEFAULT_SNAKE_BODY_LENGTH = 10;

export interface SnakePathStep {
  /** The cell the snake's head occupies after this step. */
  readonly cell: GridCell;
  /**
   * The one-hop route into `cell`: `[previousHead, cell]` for every step
   * except the very first (just `[startCell]`). Every move is to an
   * orthogonally-adjacent cell, so this always describes a single grid hop --
   * kept in this shape so the shared timeline (see timeline.ts) bills every
   * step exactly one base step-duration.
   */
  readonly waypoints: readonly GridCell[];
  /** Always false: the crawling snake only ever moves between adjacent cells. */
  readonly isJump: boolean;
  /**
   * True when this step lands the head on a contributed cell that hasn't been
   * eaten yet. False for the empty cells the snake sweeps across between
   * contributions.
   */
  readonly ateContribution: boolean;
  /** True on the final step, once the whole grid has been swept. */
  readonly isLoopComplete: boolean;
}

export interface SolveSnakePathOptions {
  /** Fixed body length; see visual-design.md 2.2. Defaults to {@link DEFAULT_SNAKE_BODY_LENGTH}. */
  readonly bodyLength?: number;
  /** Cell to start the sweep from. Ignored by the boustrophedon sweep, which always starts at (0,0). */
  readonly startCell?: GridCell;
}

export interface SolveSnakePathResult {
  readonly steps: readonly SnakePathStep[];
  readonly startCell: GridCell;
  readonly bodyLength: number;
  readonly totalContributedCells: number;
  /** Count of distinct contributed cells actually eaten across `steps`. */
  readonly eatenContributionCount: number;
  /**
   * Always `true` for the boustrophedon sweep: it visits every grid cell
   * exactly once, so it necessarily eats every contribution. Kept on the
   * result so callers (and tests) can still assert full coverage explicitly.
   */
  readonly isFullyCovered: boolean;
}

/**
 * Boustrophedon ("ox-turning") Hamiltonian sweep over the whole grid: down
 * column 0, up column 1, down column 2, and so on. Consecutive cells are
 * always orthogonally adjacent (including at each column turn), and every cell
 * appears exactly once.
 *
 * This is what makes the snake a *correct* contiguous Snake with no special
 * cases: because the head visits a brand-new cell every step and never
 * revisits one, the fixed-length body (the last `bodyLength + 1` visited
 * cells) can never contain the head's next cell -- so the head can never
 * overlap its body, the body can never detach (every step is one adjacent
 * cell), and the snake can never trap itself. Sweeping every cell also
 * guarantees every contribution is eaten, regardless of how the contributions
 * are scattered.
 */
function boustrophedonSweep(grid: ContributionGrid): GridCell[] {
  const path: GridCell[] = [];
  for (let weekIndex = 0; weekIndex < grid.weekCount; weekIndex += 1) {
    if (weekIndex % 2 === 0) {
      for (let dayIndex = 0; dayIndex < grid.dayCount; dayIndex += 1) {
        path.push({ weekIndex, dayIndex });
      }
    } else {
      for (let dayIndex = grid.dayCount - 1; dayIndex >= 0; dayIndex -= 1) {
        path.push({ weekIndex, dayIndex });
      }
    }
  }
  return path;
}

/**
 * Plans and simulates one full loop of the snake crawling the grid as a true,
 * contiguous "Snake" -- one orthogonally-adjacent cell per step -- eating
 * every contributed cell it sweeps over. See {@link boustrophedonSweep} for
 * why this can never overlap its own body, detach, or trap itself.
 */
export function solveSnakePath(
  grid: ContributionGrid,
  options: SolveSnakePathOptions = {},
): SolveSnakePathResult {
  const bodyLength = options.bodyLength ?? DEFAULT_SNAKE_BODY_LENGTH;
  if (bodyLength < 1) {
    throw new Error("bodyLength must be at least 1.");
  }

  const contributedKeys = new Set<string>();
  for (const week of grid.weeks) {
    for (const day of week) {
      if (day.count > 0) contributedKeys.add(cellKey({ weekIndex: day.weekIndex, dayIndex: day.dayIndex }));
    }
  }
  const totalContributedCells = contributedKeys.size;

  const path = boustrophedonSweep(grid);
  if (path.length === 0 || totalContributedCells === 0) {
    const fallbackStart = options.startCell ?? path[0] ?? { weekIndex: 0, dayIndex: 0 };
    return {
      steps: [],
      startCell: fallbackStart,
      bodyLength,
      totalContributedCells,
      eatenContributionCount: 0,
      isFullyCovered: true,
    };
  }

  const startCell = path[0]!;
  const eaten = new Set<string>();
  const steps: SnakePathStep[] = [];

  for (let index = 0; index < path.length; index += 1) {
    const cell = path[index]!;
    const key = cellKey(cell);
    const ate = contributedKeys.has(key) && !eaten.has(key);
    if (ate) eaten.add(key);

    steps.push({
      cell,
      waypoints: index === 0 ? [cell] : [path[index - 1]!, cell],
      isJump: false,
      ateContribution: ate,
      isLoopComplete: index === path.length - 1,
    });
  }

  return {
    steps,
    startCell,
    bodyLength,
    totalContributedCells,
    eatenContributionCount: eaten.size,
    isFullyCovered: eaten.size === totalContributedCells,
  };
}
