import { cellKey, cellsEqual, type ContributionGrid, type GridCell } from "../types.js";

/**
 * Draft default from visual-design.md 2.2 / tech-stack.md 3.1: the snake's
 * *body* (i.e. excluding the head, which is a visually distinct "Command"
 * element per visual-design.md 2.1) holds 10 trailing segments. For
 * self-collision purposes the head itself also occupies a cell, so the total
 * number of cells the snake blocks at once is `bodyLength + 1`.
 */
export const DEFAULT_SNAKE_BODY_LENGTH = 10;

/**
 * Hard safety cap on total simulation ticks (greedy moves + dead-end "wander"
 * moves combined), expressed as a multiple of the grid size. This exists so a
 * bug in the dead-end fallback fails loudly (a thrown error surfaced in CI)
 * instead of hanging the process forever. In practice, well-behaved runs need
 * far fewer ticks than this cap.
 */
const SAFETY_MULTIPLIER = 50;

export interface SnakePathStep {
  /** The cell the snake's head occupies after this step. */
  readonly cell: GridCell;
  /**
   * The internal grid route (inclusive of both endpoints) used to verify this
   * move was legal (i.e. didn't cross the snake's own body). Only cells
   * `waypoints[0]` (previous head) and the last entry (== `cell`) carry any
   * visual meaning: the renderer tweens smoothly between them. Intermediate
   * cells are exposed for testing/debugging self-collision logic and are
   * never individually rendered or "visited" by the snake.
   */
  readonly waypoints: readonly GridCell[];
  /** True when `cell` is not orthogonally adjacent to the previous head position. */
  readonly isJump: boolean;
  /**
   * True when this step eats a contribution cell. False only for "wander"
   * steps emitted by the dead-end fallback, which move the head to free up
   * body space without eating anything.
   */
  readonly ateContribution: boolean;
  /** True on the final step of the loop, once every contributed cell has been eaten. */
  readonly isLoopComplete: boolean;
}

export interface SolveSnakePathOptions {
  /** Fixed body length; see visual-design.md 2.2. Defaults to {@link DEFAULT_SNAKE_BODY_LENGTH}. */
  readonly bodyLength?: number;
  /** Cell to start the loop from. Defaults to the earliest contributed cell in reading order. */
  readonly startCell?: GridCell;
}

export interface SolveSnakePathResult {
  readonly steps: readonly SnakePathStep[];
  readonly startCell: GridCell;
  readonly bodyLength: number;
  readonly totalContributedCells: number;
}

function neighborsOf(cell: GridCell, grid: ContributionGrid): GridCell[] {
  const candidates: GridCell[] = [
    { weekIndex: cell.weekIndex - 1, dayIndex: cell.dayIndex },
    { weekIndex: cell.weekIndex + 1, dayIndex: cell.dayIndex },
    { weekIndex: cell.weekIndex, dayIndex: cell.dayIndex - 1 },
    { weekIndex: cell.weekIndex, dayIndex: cell.dayIndex + 1 },
  ];
  return candidates.filter(
    (c) =>
      c.weekIndex >= 0 &&
      c.weekIndex < grid.weekCount &&
      c.dayIndex >= 0 &&
      c.dayIndex < grid.dayCount,
  );
}

function manhattanDistance(a: GridCell, b: GridCell): number {
  return Math.abs(a.weekIndex - b.weekIndex) + Math.abs(a.dayIndex - b.dayIndex);
}

/**
 * Shortest grid path between two cells, avoiding `blocked` cells (the snake's
 * current body), via BFS (equivalent to A* on an unweighted grid). Returns
 * `null` if `target` is unreachable. `start` is never treated as blocked,
 * since the snake is always free to move away from where it currently is.
 */
function bfsPath(
  start: GridCell,
  target: GridCell,
  blocked: ReadonlySet<string>,
  grid: ContributionGrid,
): GridCell[] | null {
  if (cellsEqual(start, target)) {
    return [start];
  }

  const cameFrom = new Map<string, GridCell>();
  const visited = new Set<string>([cellKey(start)]);
  const queue: GridCell[] = [start];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (!current) break;

    for (const neighbor of neighborsOf(current, grid)) {
      const key = cellKey(neighbor);
      if (visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      cameFrom.set(key, current);

      if (cellsEqual(neighbor, target)) {
        return reconstructPath(cameFrom, start, neighbor);
      }
      queue.push(neighbor);
    }
  }
  return null;
}

function reconstructPath(
  cameFrom: ReadonlyMap<string, GridCell>,
  start: GridCell,
  target: GridCell,
): GridCell[] {
  const path: GridCell[] = [target];
  let current = target;
  while (!cellsEqual(current, start)) {
    const previous = cameFrom.get(cellKey(current));
    if (!previous) {
      throw new Error("Path reconstruction failed: broken predecessor chain.");
    }
    path.push(previous);
    current = previous;
  }
  return path.reverse();
}

/** Count of cells reachable from `start` without crossing `blocked`, capped at `limit` for speed. */
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
    const current = queue[head];
    head += 1;
    if (!current) break;
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

/** Greedy nearest-neighbor initial tour ordering over contributed cells (Manhattan distance). */
function buildGreedyTour(cells: readonly GridCell[], start: GridCell): GridCell[] {
  const remaining = new Set(cells.map((c) => cellKey(c)));
  const byKey = new Map(cells.map((c) => [cellKey(c), c] as const));
  remaining.delete(cellKey(start));

  const tour: GridCell[] = [start];
  let current = start;

  while (remaining.size > 0) {
    let nearestKey: string | null = null;
    let nearestDistance = Infinity;
    for (const key of remaining) {
      const candidate = byKey.get(key);
      if (!candidate) continue;
      const distance = manhattanDistance(current, candidate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestKey = key;
      }
    }
    if (nearestKey === null) break;
    const next = byKey.get(nearestKey);
    if (!next) break;
    tour.push(next);
    remaining.delete(nearestKey);
    current = next;
  }

  return tour;
}

function tourLength(tour: readonly GridCell[]): number {
  let total = 0;
  for (let i = 0; i < tour.length - 1; i += 1) {
    const a = tour[i];
    const b = tour[i + 1];
    if (a && b) total += manhattanDistance(a, b);
  }
  return total;
}

/**
 * 2-opt local search: repeatedly reverse a sub-segment of the tour when doing
 * so shortens the total Manhattan length. The tour's first element (the fixed
 * start cell) is never moved. Bounded to a small number of full passes so
 * runtime stays well within CI budgets even at ~371 contributed cells.
 */
function apply2Opt(tour: GridCell[], maxPasses = 15): GridCell[] {
  const result = tour.slice();
  const n = result.length;
  if (n < 4) return result;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;

    for (let i = 1; i < n - 2; i += 1) {
      for (let j = i + 1; j < n - 1; j += 1) {
        const a = result[i - 1];
        const b = result[i];
        const c = result[j];
        const d = result[j + 1];
        if (!a || !b || !c || !d) continue;

        const currentCost = manhattanDistance(a, b) + manhattanDistance(c, d);
        const swappedCost = manhattanDistance(a, c) + manhattanDistance(b, d);

        if (swappedCost < currentCost) {
          reverseSegment(result, i, j);
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return result;
}

function reverseSegment(tour: GridCell[], from: number, to: number): void {
  let left = from;
  let right = to;
  while (left < right) {
    const temp = tour[left]!;
    tour[left] = tour[right]!;
    tour[right] = temp;
    left += 1;
    right -= 1;
  }
}

/**
 * Or-opt pass: try relocating single cells to a better position in the tour.
 * Complements 2-opt by fixing single-node detours that segment-reversal alone
 * cannot smooth out.
 */
function applyOrOpt(tour: GridCell[], maxPasses = 5): GridCell[] {
  let result = tour.slice();
  const n = result.length;
  if (n < 4) return result;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;

    for (let i = 1; i < result.length - 1; i += 1) {
      const prev = result[i - 1];
      const node = result[i];
      const next = result[i + 1];
      if (!prev || !node || !next) continue;

      const removalGain =
        manhattanDistance(prev, node) + manhattanDistance(node, next) - manhattanDistance(prev, next);
      if (removalGain <= 0) continue;

      let bestJ = -1;
      let bestInsertionCost = Infinity;
      for (let j = 0; j < result.length - 1; j += 1) {
        if (j === i - 1 || j === i) continue;
        const left = result[j];
        const right = result[j + 1];
        if (!left || !right) continue;
        const insertionCost =
          manhattanDistance(left, node) + manhattanDistance(node, right) - manhattanDistance(left, right);
        if (insertionCost < bestInsertionCost) {
          bestInsertionCost = insertionCost;
          bestJ = j;
        }
      }

      if (bestJ >= 0 && bestInsertionCost < removalGain) {
        const withoutNode = result.filter((_, idx) => idx !== i);
        const insertAt = bestJ > i ? bestJ : bestJ + 1;
        withoutNode.splice(insertAt, 0, node);
        result = withoutNode;
        improved = true;
        break;
      }
    }

    if (!improved) break;
  }

  return result;
}

/**
 * Free-space "safety" check used to steer target selection *away* from moves
 * that would immediately trap the snake, rather than only reacting after the
 * fact. Real dense contribution calendars have narrow 1-2 column pockets
 * near the grid's edges (and sometimes mid-board, wherever the tour happens
 * to sweep a whole column top-to-bottom); a pure nearest-neighbor tour can
 * walk the whole body into one of those pockets and seal itself in before
 * the reactive dead-end fallback ever gets a chance to help. Requiring that
 * a candidate move leaves at least `bodyLength + 1` reachable free cells
 * catches the vast majority of these cases before they happen.
 *
 * This is a deliberately cheap, *approximate* one-ply lookahead rather than a
 * full guarantee -- an exact check (e.g. "every other remaining cell must
 * stay reachable") sounds stricter but is actually too strict in practice:
 * on a fixed-length body, cells regularly become *temporarily* unreachable
 * (they reopen once the tail slides past) and an exact check can't tell that
 * apart from a permanent trap, causing it to reject nearly every move. See
 * solveSnakePath.test.ts and the project report for known residual risk.
 */
function isSafeMove(
  candidate: GridCell,
  body: readonly GridCell[],
  bodyLength: number,
  grid: ContributionGrid,
): boolean {
  const hypotheticalBody = [candidate, ...body];
  if (hypotheticalBody.length > bodyLength + 1) hypotheticalBody.pop();
  const hypotheticalBlocked = new Set(hypotheticalBody.map((c) => cellKey(c)));

  const totalCells = grid.weekCount * grid.dayCount;
  const requiredFreeCells = Math.min((bodyLength + 1) * 2, totalCells - hypotheticalBlocked.size);
  if (requiredFreeCells <= 0) return true;

  const reachable = reachableFreeCellCount(candidate, hypotheticalBlocked, grid, requiredFreeCells);
  return reachable >= requiredFreeCells;
}

/**
 * Picks the neighbor cell (from `start`) that opens up the most reachable
 * free space, used by the dead-end fallback to decide which direction to
 * "wander" toward while waiting for the tail to shrink and free up cells.
 */
function pickWanderNeighbor(
  start: GridCell,
  blocked: ReadonlySet<string>,
  grid: ContributionGrid,
): GridCell | null {
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

/**
 * Plans and simulates a single full loop of the snake eating every
 * contributed cell in `grid`.
 *
 * Algorithm (see tech-stack.md section 3):
 * 1. Greedy nearest-neighbor tour over contributed cells (Manhattan distance).
 * 2. 2-opt + Or-opt local optimization to shorten/smooth the tour.
 * 3. Step-by-step simulation of the optimized tour using BFS to find a legal,
 *    self-collision-free route for each move. If the planned next cell is
 *    unreachable, fall back to the nearest reachable unvisited cell; if
 *    *nothing* unvisited is reachable (the snake has trapped itself), the
 *    snake "wanders" one free cell at a time toward open space until its own
 *    tail shrinks enough to reopen a path (see `pickWanderNeighbor`).
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
      if (day.count > 0) {
        contributedCells.push({ weekIndex: day.weekIndex, dayIndex: day.dayIndex });
      }
    }
  }

  if (contributedCells.length === 0) {
    const fallbackStart = options.startCell ?? { weekIndex: 0, dayIndex: 0 };
    return {
      steps: [],
      startCell: fallbackStart,
      bodyLength,
      totalContributedCells: 0,
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

  const greedyTour = buildGreedyTour(contributedCells, startCell);
  const optimizedTour = applyOrOpt(apply2Opt(greedyTour));

  // 2-opt/Or-opt can only improve a metric that ignores dynamic obstacles; if
  // either pass ever regresses the tour (shouldn't happen, but cheap to
  // guard), keep the simpler greedy tour instead.
  const plannedTour = tourLength(optimizedTour) <= tourLength(greedyTour) ? optimizedTour : greedyTour;

  const steps = simulateTour(grid, plannedTour, bodyLength);

  return {
    steps,
    startCell,
    bodyLength,
    totalContributedCells: contributedCells.length,
  };
}

function simulateTour(
  grid: ContributionGrid,
  plannedTour: readonly GridCell[],
  bodyLength: number,
): SnakePathStep[] {
  const totalCells = grid.weekCount * grid.dayCount;
  const safetyCap = Math.max(totalCells * SAFETY_MULTIPLIER, 1000);

  const startCell = plannedTour[0];
  if (!startCell) return [];

  const body: GridCell[] = [startCell]; // index 0 = head, last = tail
  const visited = new Set<string>([cellKey(startCell)]);
  const steps: SnakePathStep[] = [
    {
      cell: startCell,
      waypoints: [startCell],
      isJump: false,
      ateContribution: true,
      isLoopComplete: plannedTour.length === 1,
    },
  ];

  // Remaining planned targets, in optimized order; we may reorder/skip around
  // within this list when the dead-end fallback kicks in.
  const remaining: GridCell[] = plannedTour.slice(1);

  let ticks = 0;

  while (remaining.length > 0) {
    ticks += 1;
    if (ticks > safetyCap) {
      throw new Error(
        `solveSnakePath: exceeded safety cap of ${safetyCap} ticks. This indicates a bug in ` +
          "the dead-end fallback rather than a genuinely unsolvable board.",
      );
    }

    const head = body[0];
    if (!head) break;
    const blocked = new Set(body.map((c) => cellKey(c)));

    // Keys of every currently-unvisited target, used by isSafeMove to check
    // "does eating this candidate strand any *other* remaining cell?". We
    // temporarily remove a candidate's own key before checking it (it's
    // about to be eaten, so it shouldn't count as something that must stay
    // reachable) and restore it immediately after.
    const preferredTarget = remaining[0];
    let route: GridCell[] | null =
      preferredTarget && isSafeMove(preferredTarget, body, bodyLength, grid)
        ? bfsPath(head, preferredTarget, blocked, grid)
        : null;
    let targetIndex = route ? 0 : -1;

    if (!route) {
      // Preferred next target unreachable (or unsafe): search all remaining
      // unvisited cells for the nearest one that is both reachable right now
      // and doesn't immediately trap the snake. If none is fully "safe",
      // fall back to the nearest merely-reachable one so progress never
      // stalls on the safety heuristic alone.
      let bestSafeRoute: GridCell[] | null = null;
      let bestSafeIndex = -1;
      let bestSafeLength = Infinity;

      let bestAnyRoute: GridCell[] | null = null;
      let bestAnyIndex = -1;
      let bestAnyLength = Infinity;

      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        if (!candidate) continue;
        const candidateRoute = bfsPath(head, candidate, blocked, grid);
        if (!candidateRoute) continue;

        if (candidateRoute.length < bestAnyLength) {
          bestAnyRoute = candidateRoute;
          bestAnyLength = candidateRoute.length;
          bestAnyIndex = i;
        }
        if (candidateRoute.length < bestSafeLength && isSafeMove(candidate, body, bodyLength, grid)) {
          bestSafeRoute = candidateRoute;
          bestSafeLength = candidateRoute.length;
          bestSafeIndex = i;
        }
      }

      route = bestSafeRoute ?? bestAnyRoute;
      targetIndex = bestSafeRoute ? bestSafeIndex : bestAnyIndex;
    }

    if (route && targetIndex >= 0) {
      const target = remaining[targetIndex];
      if (!target) break;
      remaining.splice(targetIndex, 1);
      visited.add(cellKey(target));

      body.unshift(target);
      if (body.length > bodyLength + 1) body.pop();

      steps.push({
        cell: target,
        waypoints: route,
        isJump: route.length > 2,
        ateContribution: true,
        isLoopComplete: remaining.length === 0,
      });
      continue;
    }

    // Dead-end fallback: nothing unvisited is reachable right now. Wander one
    // free cell at a time (this shrinks the tail on every move, same as a
    // normal move would) until the tail has retreated enough to reopen a
    // route to some unvisited cell.
    const wanderTarget = pickWanderNeighbor(head, blocked, grid);
    if (!wanderTarget) {
      // Completely boxed in with no free neighbor at all. Nothing more we can
      // legally do; stop the loop early rather than throwing, so a caller
      // still gets a usable (if incomplete) animation.
      break;
    }

    body.unshift(wanderTarget);
    if (body.length > bodyLength + 1) body.pop();

    steps.push({
      cell: wanderTarget,
      waypoints: [head, wanderTarget],
      isJump: false,
      ateContribution: false,
      isLoopComplete: false,
    });
  }

  return steps;
}
