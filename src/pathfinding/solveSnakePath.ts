import { cellKey, cellsEqual, type ContributionGrid, type GridCell } from "../types.js";

/**
 * Fixed number of trailing body segments (excluding the head). The snake is a
 * classic, contiguous follow-the-leader chain: at any moment it occupies
 * `bodyLength + 1` orthogonally-adjacent cells and moves exactly one cell per
 * step.
 */
export const DEFAULT_SNAKE_BODY_LENGTH = 10;

/** Hard runaway guard, as a multiple of the grid's cell count. */
const SAFETY_MULTIPLIER = 50;

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
   * eaten yet. False for the empty cells the snake crosses between
   * contributions.
   */
  readonly ateContribution: boolean;
  /** True on the final step, once every contributed cell has been eaten. */
  readonly isLoopComplete: boolean;
}

export interface SolveSnakePathOptions {
  /** Fixed body length; see visual-design.md 2.2. Defaults to {@link DEFAULT_SNAKE_BODY_LENGTH}. */
  readonly bodyLength?: number;
  /** Cell to start the crawl from. Defaults to the earliest contributed cell in reading order. */
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
   * True iff every contributed cell was eaten. The hunt visits contributions
   * in a left-to-right sweep order (so it progresses across the board rather
   * than coiling into itself) and, if it ever leaves a cell unreached, the
   * whole plan falls back to a guaranteed full boustrophedon sweep -- so this
   * is effectively always `true`. Callers should still check it.
   */
  readonly isFullyCovered: boolean;
}

function neighborsOf(cell: GridCell, grid: ContributionGrid): GridCell[] {
  const candidates: GridCell[] = [
    { weekIndex: cell.weekIndex - 1, dayIndex: cell.dayIndex },
    { weekIndex: cell.weekIndex + 1, dayIndex: cell.dayIndex },
    { weekIndex: cell.weekIndex, dayIndex: cell.dayIndex - 1 },
    { weekIndex: cell.weekIndex, dayIndex: cell.dayIndex + 1 },
  ];
  return candidates.filter(
    (c) => c.weekIndex >= 0 && c.weekIndex < grid.weekCount && c.dayIndex >= 0 && c.dayIndex < grid.dayCount,
  );
}

/** Shortest grid path from `start` to `target` avoiding `blocked`, or `null` if unreachable. `start` is never blocked. */
function bfsPath(
  start: GridCell,
  target: GridCell,
  blocked: ReadonlySet<string>,
  grid: ContributionGrid,
): GridCell[] | null {
  if (cellsEqual(start, target)) return [start];

  const cameFrom = new Map<string, GridCell>();
  const visited = new Set<string>([cellKey(start)]);
  const queue: GridCell[] = [start];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    for (const neighbor of neighborsOf(current, grid)) {
      const key = cellKey(neighbor);
      if (visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      cameFrom.set(key, current);
      if (cellsEqual(neighbor, target)) return reconstructPath(cameFrom, start, neighbor);
      queue.push(neighbor);
    }
  }
  return null;
}

function reconstructPath(cameFrom: ReadonlyMap<string, GridCell>, start: GridCell, target: GridCell): GridCell[] {
  const path: GridCell[] = [target];
  let current = target;
  while (!cellsEqual(current, start)) {
    const previous = cameFrom.get(cellKey(current));
    if (!previous) throw new Error("Path reconstruction failed: broken predecessor chain.");
    path.push(previous);
    current = previous;
  }
  return path.reverse();
}

/** Count of cells reachable from `start` without crossing `blocked`, capped at `limit`. */
function reachableFreeCellCount(
  start: GridCell,
  blocked: ReadonlySet<string>,
  grid: ContributionGrid,
  limit: number,
): number {
  const visited = new Set<string>([cellKey(start)]);
  const queue: GridCell[] = [start];
  let head = 0;
  let count = 0;
  while (head < queue.length && count < limit) {
    const current = queue[head]!;
    head += 1;
    count += 1;
    for (const neighbor of neighborsOf(current, grid)) {
      const key = cellKey(neighbor);
      if (visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      queue.push(neighbor);
    }
  }
  return count;
}

/** Picks the free neighbour of `start` that opens up the most reachable space (used to escape dead ends). */
function pickWanderNeighbor(start: GridCell, blocked: ReadonlySet<string>, grid: ContributionGrid): GridCell | null {
  const candidates = neighborsOf(start, grid).filter((c) => !blocked.has(cellKey(c)));
  if (candidates.length === 0) return null;
  let best: GridCell | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = reachableFreeCellCount(candidate, blocked, grid, grid.weekCount * grid.dayCount);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Contribution cells in a left-to-right serpentine order (down even columns, up odd ones). */
function sweepOrder(cells: readonly GridCell[]): GridCell[] {
  return [...cells].sort((a, b) => {
    if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
    return a.weekIndex % 2 === 0 ? a.dayIndex - b.dayIndex : b.dayIndex - a.dayIndex;
  });
}

/**
 * Hunts contributions in {@link sweepOrder}: for each target still uneaten, BFS
 * a route from the head (avoiding the body, minus the tail that vacates) and
 * walk it cell by cell, eating any contribution crossed on the way. Because
 * targets are consumed left-to-right the head keeps advancing across the board
 * instead of coiling back into itself, which is what keeps a fixed-length
 * snake from trapping itself. Returns `null` if it still gets stuck (extremely
 * rare) so the caller can fall back to a guaranteed sweep.
 */
function crawlHunt(
  grid: ContributionGrid,
  contributedCells: readonly GridCell[],
  startCell: GridCell,
  bodyLength: number,
): SnakePathStep[] | null {
  const totalCells = grid.weekCount * grid.dayCount;
  const safetyCap = Math.max(totalCells * SAFETY_MULTIPLIER, 1000);

  const remaining = new Set(contributedCells.map((c) => cellKey(c)));
  const body: GridCell[] = [startCell];
  const steps: SnakePathStep[] = [];
  let ticks = 0;

  const advance = (from: GridCell, to: GridCell): void => {
    body.unshift(to);
    if (body.length > bodyLength + 1) body.pop();
    const ate = remaining.delete(cellKey(to));
    steps.push({ cell: to, waypoints: [from, to], isJump: false, ateContribution: ate, isLoopComplete: remaining.size === 0 });
    ticks += 1;
  };

  remaining.delete(cellKey(startCell));
  steps.push({
    cell: startCell,
    waypoints: [startCell],
    isJump: false,
    ateContribution: contributedCells.some((c) => cellsEqual(c, startCell)),
    isLoopComplete: remaining.size === 0,
  });

  for (const target of sweepOrder(contributedCells)) {
    let guard = 0;
    while (remaining.has(cellKey(target))) {
      if (ticks > safetyCap) return null;
      if (guard > totalCells * 2) return null; // couldn't reach this target -- bail to fallback
      guard += 1;

      const head = body[0]!;
      const blocked = new Set(body.slice(0, -1).map((c) => cellKey(c)));
      const route = bfsPath(head, target, blocked, grid);

      if (route && route.length >= 2) {
        for (let i = 1; i < route.length; i += 1) {
          advance(route[i - 1]!, route[i]!);
          if (!remaining.has(cellKey(target))) break;
        }
        continue;
      }

      const wander = pickWanderNeighbor(head, blocked, grid);
      if (!wander) return null; // sealed in
      advance(head, wander);
    }
  }

  return remaining.size === 0 ? steps : null;
}

/**
 * Boustrophedon Hamiltonian sweep over the whole grid: a guaranteed-coverage
 * fallback for the rare board the hunt can't fully clear. Visits every cell
 * exactly once in adjacent moves, so it can never trap or self-overlap.
 */
function boustrophedonSweep(
  grid: ContributionGrid,
  contributedKeys: ReadonlySet<string>,
  bodyLength: number,
): SnakePathStep[] {
  void bodyLength;
  const cells: GridCell[] = [];
  for (let weekIndex = 0; weekIndex < grid.weekCount; weekIndex += 1) {
    if (weekIndex % 2 === 0) {
      for (let dayIndex = 0; dayIndex < grid.dayCount; dayIndex += 1) cells.push({ weekIndex, dayIndex });
    } else {
      for (let dayIndex = grid.dayCount - 1; dayIndex >= 0; dayIndex -= 1) cells.push({ weekIndex, dayIndex });
    }
  }

  const eaten = new Set<string>();
  return cells.map((cell, index) => {
    const key = cellKey(cell);
    const ate = contributedKeys.has(key) && !eaten.has(key);
    if (ate) eaten.add(key);
    return {
      cell,
      waypoints: index === 0 ? [cell] : [cells[index - 1]!, cell],
      isJump: false,
      ateContribution: ate,
      isLoopComplete: index === cells.length - 1,
    };
  });
}

/**
 * Plans and simulates one loop of the snake crawling the grid as a true,
 * contiguous "Snake" -- one orthogonally-adjacent cell per step. It hunts
 * contributions in a left-to-right sweep order (so it visibly goes after the
 * commits) and falls back to a full guaranteed sweep on the rare board it
 * can't fully clear. Either way the head can never overlap its body and the
 * body never detaches from it.
 */
export function solveSnakePath(
  grid: ContributionGrid,
  options: SolveSnakePathOptions = {},
): SolveSnakePathResult {
  const bodyLength = options.bodyLength ?? DEFAULT_SNAKE_BODY_LENGTH;
  if (bodyLength < 1) {
    throw new Error("bodyLength must be at least 1.");
  }

  const contributedCells: GridCell[] = [];
  for (const week of grid.weeks) {
    for (const day of week) {
      if (day.count > 0) contributedCells.push({ weekIndex: day.weekIndex, dayIndex: day.dayIndex });
    }
  }
  const totalContributedCells = contributedCells.length;

  if (totalContributedCells === 0) {
    const fallbackStart = options.startCell ?? { weekIndex: 0, dayIndex: 0 };
    return {
      steps: [],
      startCell: fallbackStart,
      bodyLength,
      totalContributedCells: 0,
      eatenContributionCount: 0,
      isFullyCovered: true,
    };
  }

  const startCell =
    options.startCell ??
    contributedCells.reduce((earliest, cell) =>
      cell.weekIndex < earliest.weekIndex ||
      (cell.weekIndex === earliest.weekIndex && cell.dayIndex < earliest.dayIndex)
        ? cell
        : earliest,
    );

  const contributedKeys = new Set(contributedCells.map((c) => cellKey(c)));

  const hunted = crawlHunt(grid, contributedCells, startCell, bodyLength);
  const steps = hunted ?? boustrophedonSweep(grid, contributedKeys, bodyLength);

  const eatenKeys = new Set<string>();
  for (const step of steps) {
    if (step.ateContribution) eatenKeys.add(cellKey(step.cell));
  }

  return {
    steps,
    startCell: steps[0]?.cell ?? startCell,
    bodyLength,
    totalContributedCells,
    eatenContributionCount: eatenKeys.size,
    isFullyCovered: eatenKeys.size === totalContributedCells,
  };
}
