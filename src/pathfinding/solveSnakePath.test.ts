import { describe, expect, it } from "vitest";
import type { ContributionDay, ContributionGrid, ContributionLevel, GridCell } from "../types.js";
import { cellKey } from "../types.js";
import { DEFAULT_SNAKE_BODY_LENGTH, solveSnakePath } from "./solveSnakePath.js";

/**
 * Builds a ContributionGrid from an ASCII layout: one string per row
 * (dayIndex), one character per column (weekIndex). `#` is a contributed
 * cell (count 1, level 1); `.` is empty (count 0, level 0). Rows may have
 * different meaning per test but must all share the same length.
 */
function buildGrid(rows: readonly string[]): ContributionGrid {
  const dayCount = rows.length;
  const weekCount = rows[0]?.length ?? 0;

  const weeks: ContributionDay[][] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const week: ContributionDay[] = [];
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
      const char = rows[dayIndex]?.[weekIndex];
      const isContributed = char === "#";
      week.push({
        date: `week${weekIndex}-day${dayIndex}`,
        count: isContributed ? 1 : 0,
        level: (isContributed ? 1 : 0) as ContributionLevel,
        weekIndex,
        dayIndex,
      });
    }
    weeks.push(week);
  }

  return { weeks, weekCount, dayCount };
}

function contributedCellsOf(grid: ContributionGrid): GridCell[] {
  const cells: GridCell[] = [];
  for (const week of grid.weeks) {
    for (const day of week) {
      if (day.count > 0) cells.push({ weekIndex: day.weekIndex, dayIndex: day.dayIndex });
    }
  }
  return cells;
}

function isAdjacent(a: GridCell, b: GridCell): boolean {
  const dx = Math.abs(a.weekIndex - b.weekIndex);
  const dy = Math.abs(a.dayIndex - b.dayIndex);
  return dx + dy === 1;
}

describe("solveSnakePath - basic correctness", () => {
  it("returns an empty path for a grid with no contributions", () => {
    const grid = buildGrid([".....", "....."]);
    const result = solveSnakePath(grid);

    expect(result.steps).toHaveLength(0);
    expect(result.totalContributedCells).toBe(0);
  });

  it("eats every contributed cell exactly once and marks the final step complete", () => {
    const grid = buildGrid(["#####", "#####", "#####"]);
    const result = solveSnakePath(grid, { bodyLength: 4 });

    const eatenSteps = result.steps.filter((s) => s.ateContribution);
    const eatenKeys = eatenSteps.map((s) => cellKey(s.cell));
    const expectedKeys = contributedCellsOf(grid).map(cellKey).sort();

    expect(new Set(eatenKeys).size).toBe(eatenKeys.length); // no duplicate eats
    expect(eatenKeys.slice().sort()).toEqual(expectedKeys);
    expect(result.totalContributedCells).toBe(expectedKeys.length);

    const last = result.steps.at(-1);
    expect(last?.isLoopComplete).toBe(true);
    expect(result.steps.slice(0, -1).every((s) => !s.isLoopComplete)).toBe(true);
  });

  it("starts from the earliest contributed cell in reading order by default", () => {
    const grid = buildGrid(["..#..", ".....", "..#.."]);
    const result = solveSnakePath(grid);
    // reading order = weekIndex asc, then dayIndex asc -> (2,0) before (2,2)
    expect(result.startCell).toEqual({ weekIndex: 2, dayIndex: 0 });
  });

  it("honors an explicit startCell option", () => {
    const grid = buildGrid(["..#..", ".....", "..#.."]);
    const result = solveSnakePath(grid, { startCell: { weekIndex: 2, dayIndex: 2 } });
    expect(result.startCell).toEqual({ weekIndex: 2, dayIndex: 2 });
    expect(result.steps[0]?.cell).toEqual({ weekIndex: 2, dayIndex: 2 });
  });

  it("flags a step as a jump when the eaten cell is not grid-adjacent to the previous head", () => {
    const grid = buildGrid(["#.......#"]);
    const result = solveSnakePath(grid, { startCell: { weekIndex: 0, dayIndex: 0 } });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.isJump).toBe(true);
    expect(result.steps[1]?.waypoints.length).toBeGreaterThan(2);
  });

  it("does not flag a step as a jump when moving to a directly adjacent cell", () => {
    const grid = buildGrid(["##"]);
    const result = solveSnakePath(grid);
    expect(result.steps[1]?.isJump).toBe(false);
    expect(result.steps[1]?.waypoints).toEqual([
      { weekIndex: 0, dayIndex: 0 },
      { weekIndex: 1, dayIndex: 0 },
    ]);
  });

  it("respects the configured body length (defaults to 10)", () => {
    const grid = buildGrid(["#####"]);
    const withDefault = solveSnakePath(grid);
    expect(withDefault.bodyLength).toBe(DEFAULT_SNAKE_BODY_LENGTH);

    const withCustom = solveSnakePath(grid, { bodyLength: 3 });
    expect(withCustom.bodyLength).toBe(3);
  });

  it("never revisits (re-eats) a cell once it has been eaten", () => {
    const grid = buildGrid(["#.#.#", ".#.#.", "#.#.#"]);
    const result = solveSnakePath(grid, { bodyLength: 5 });
    const eaten = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(eaten).size).toBe(eaten.length);
  });

  it("produces a waypoint route where every consecutive pair of waypoints is grid-adjacent", () => {
    const grid = buildGrid(["#...#", "...#.", "#...#"]);
    const result = solveSnakePath(grid, { bodyLength: 4 });

    for (const step of result.steps) {
      for (let i = 0; i < step.waypoints.length - 1; i += 1) {
        const a = step.waypoints[i]!;
        const b = step.waypoints[i + 1]!;
        expect(isAdjacent(a, b)).toBe(true);
      }
    }
  });
});

describe("solveSnakePath - self-collision safety", () => {
  it("never routes a step through a cell currently occupied by the snake's own body", () => {
    // Dense grid forces lots of nearby-body traffic; body length close to
    // the grid's own width/height maximizes the chance of a naive
    // implementation cutting through itself.
    const grid = buildGrid([
      "#########",
      "#########",
      "#########",
      "#########",
      "#########",
      "#########",
      "#########",
    ]);
    const bodyLength = 10;
    const result = solveSnakePath(grid, { bodyLength });

    // Reconstruct the body window at each tick and confirm the intermediate
    // waypoints of the *next* step never land on a cell that was body at the
    // time of that move (excluding the step's own destination, which becomes
    // body only after the move completes).
    const history: GridCell[] = [];
    for (let i = 0; i < result.steps.length; i += 1) {
      const step = result.steps[i]!;
      const bodyBeforeMove = history.slice(-bodyLength);
      const blocked = new Set(bodyBeforeMove.map(cellKey));

      // every waypoint except the final destination must be free at the time of the move
      for (let w = 0; w < step.waypoints.length - 1; w += 1) {
        const waypoint = step.waypoints[w]!;
        if (w === 0) continue; // waypoint[0] is the previous head position itself
        expect(blocked.has(cellKey(waypoint))).toBe(false);
      }

      history.push(step.cell);
    }
  });
});

describe("solveSnakePath - dead-end fallback", () => {
  it("terminates gracefully (no throw, no hang) when the snake becomes irrecoverably boxed in", () => {
    // A single-row grid is a pure 1D corridor: there is no second dimension
    // to detour through. Contributed cells sit on both sides of the start
    // cell; the left arm's length exactly equals the body length, so once
    // the head reaches the grid's left edge, the entire arm (including the
    // edge cell itself) is still in the body and the head has no legal move
    // left (edge of grid) or right (own body) at all. This is a genuine,
    // hand-verified, unrecoverable trap.
    const grid = buildGrid(["#####.##"]);
    //                       0123456 7  -> arm1 = cols 0-3 (4 cells incl. start), gap col4, arm2 = cols6-7
    const result = solveSnakePath(grid, {
      bodyLength: 4,
      startCell: { weekIndex: 3, dayIndex: 0 },
    });

    // Must not throw and must return within the test timeout (asserted implicitly).
    expect(result.steps.length).toBeGreaterThan(0);
    // Cannot have eaten more than the 4 cells of the reachable left arm.
    const eatenCount = result.steps.filter((s) => s.ateContribution).length;
    expect(eatenCount).toBeLessThan(result.totalContributedCells);
    expect(eatenCount).toBe(4);
  });

  it("recovers from a temporary self-blockage by wandering until the tail clears the way", () => {
    // Two-row grid: a full spine along row 0, plus a single-cell pocket
    // hanging off row 1. The pocket sits deep enough relative to bodyLength
    // that reaching cells on the far side of the spine forces the algorithm
    // off its "planned" greedy order, exercising the reachable-fallback
    // and/or wander logic. What matters is the outcome: full coverage,
    // no throw, no duplicate eats.
    const grid = buildGrid(["###########", ".#.........", "..........."].slice(0, 2));
    const result = solveSnakePath(grid, { bodyLength: 5 });

    const eaten = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(eaten).size).toBe(eaten.length);
    expect(eaten.length).toBe(result.totalContributedCells);
    expect(result.steps.at(-1)?.isLoopComplete).toBe(true);
  });

  it("fully solves an adversarial spiral corridor without exceeding a sane step budget", () => {
    // Single-width spiral corridor carved into a rectangular grid: every
    // contributed cell has at most 2 contributed neighbors, so the tour is
    // forced into a long, winding, mostly non-monotonic order relative to
    // Manhattan distance -- a good adversarial stress test for both 2-opt
    // and the collision-avoidance/fallback machinery.
    const spiral = [
      "###########",
      "#.........#",
      "#.#######.#",
      "#.#.....#.#",
      "#.#.###.#.#",
      "#.#.#...#.#",
      "#.#.#####.#",
      "#.#.......#",
      "#.#########",
      "#..........",
    ];
    const grid = buildGrid(spiral);
    const result = solveSnakePath(grid, { bodyLength: 10 });

    const eaten = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(eaten).size).toBe(eaten.length);
    expect(eaten.length).toBe(result.totalContributedCells);
    expect(result.steps.at(-1)?.isLoopComplete).toBe(true);
    // Sanity budget: even with wandering, ticks shouldn't run away unbounded.
    expect(result.steps.length).toBeLessThan(result.totalContributedCells * 20);
  });

  it("completes within a reasonable time for a full year-sized grid (7x53)", () => {
    const weekCount = 53;
    const dayCount = 7;
    const rows: string[] = [];
    for (let d = 0; d < dayCount; d += 1) {
      let row = "";
      for (let w = 0; w < weekCount; w += 1) {
        // Sparse-ish deterministic pattern, not a trivial dense fill.
        row += (w + d) % 3 === 0 ? "#" : ".";
      }
      rows.push(row);
    }
    const grid = buildGrid(rows);

    const start = Date.now();
    const result = solveSnakePath(grid);
    const elapsedMs = Date.now() - start;

    expect(result.steps.filter((s) => s.ateContribution).length).toBe(result.totalContributedCells);
    expect(elapsedMs).toBeLessThan(5000);
  });

  function buildDensityGrid(weekCount: number, dayCount: number, densityFn: (w: number, d: number) => boolean) {
    const rows: string[] = [];
    for (let d = 0; d < dayCount; d += 1) {
      let row = "";
      for (let w = 0; w < weekCount; w += 1) row += densityFn(w, d) ? "#" : ".";
      rows.push(row);
    }
    return buildGrid(rows);
  }

  it("regression: fully solves a dense full-year grid where an early corner sweep can trap itself", () => {
    // This exact density pattern (every day contributed except every 5th)
    // once caused the snake to sweep into the grid's top-left corner,
    // consume the entire local pocket into its own body, and permanently
    // trap itself after only 8 of 296 cells (see project report). Kept as a
    // regression test for the free-space safety check in isSafeMove.
    const grid = buildDensityGrid(53, 7, (w, d) => (w * 7 + d) % 5 !== 0);
    const result = solveSnakePath(grid, { bodyLength: 10 });
    expect(result.steps.filter((s) => s.ateContribution).length).toBe(result.totalContributedCells);
  });

  it("regression: fully solves a near-100%-density full-year grid where the body can wall off a whole column", () => {
    // With bodyLength (10) comparable to dayCount (7), a serpentine sweep
    // through one column can leave that entire column inside the current
    // body window, acting as a solid wall partway through the board and
    // stranding most remaining cells on the other side. This density
    // pattern (~91% of days contributed) reproduced that failure directly.
    const grid = buildDensityGrid(53, 7, (w, d) => (w + d) % 11 !== 0);
    const result = solveSnakePath(grid, { bodyLength: 10 });
    expect(result.steps.filter((s) => s.ateContribution).length).toBe(result.totalContributedCells);
  });

  it("fully solves a 100%-density full-year grid (theoretical worst case for self-blocking)", () => {
    const grid = buildDensityGrid(53, 7, () => true);
    const result = solveSnakePath(grid, { bodyLength: 10 });
    expect(result.totalContributedCells).toBe(53 * 7);
    expect(result.steps.filter((s) => s.ateContribution).length).toBe(result.totalContributedCells);
  });
});

describe("solveSnakePath - coverage reporting (isFullyCovered / eatenContributionCount)", () => {
  function buildDensityGrid(weekCount: number, dayCount: number, densityFn: (w: number, d: number) => boolean) {
    const rows: string[] = [];
    for (let d = 0; d < dayCount; d += 1) {
      let row = "";
      for (let w = 0; w < weekCount; w += 1) row += densityFn(w, d) ? "#" : ".";
      rows.push(row);
    }
    return buildGrid(rows);
  }

  it("reports full coverage for a normally-solvable board", () => {
    const grid = buildGrid(["#####", "#####", "#####"]);
    const result = solveSnakePath(grid, { bodyLength: 4 });
    expect(result.isFullyCovered).toBe(true);
    expect(result.eatenContributionCount).toBe(result.totalContributedCells);
  });

  it("reports full coverage (trivially) for a grid with no contributions", () => {
    const grid = buildGrid(["....."]);
    const result = solveSnakePath(grid);
    expect(result.isFullyCovered).toBe(true);
    expect(result.eatenContributionCount).toBe(0);
  });

  it("KNOWN LIMITATION: flags isFullyCovered=false (instead of throwing or silently under-reporting) " +
    "when the dead-end fallback's isSafeMove heuristic fails to prevent a trap", () => {
    // Independently discovered during QA review (not one of the two density
    // patterns already covered by the regression tests above): a 53x7 board
    // at ~80% density where the snake sweeps almost the whole board but gets
    // boxed into the last column/corner, leaving 1 of 296 cells uneaten.
    // This demonstrates isSafeMove is a heuristic, not a proof: full 2D
    // coverage on dense real-world-shaped boards is NOT guaranteed by this
    // algorithm. Do not "fix" this test by tweaking the heuristic without a
    // principled redesign (see solveSnakePath.ts isSafeMove doc comment) --
    // its purpose here is to make the residual risk visible and regression-
    // tested, not to assert 100% coverage is achieved.
    const grid = buildDensityGrid(53, 7, (w, d) => (w * 3 + d * 7) % 5 !== 0);
    const result = solveSnakePath(grid, { bodyLength: 10 });

    expect(result.eatenContributionCount).toBeLessThan(result.totalContributedCells);
    expect(result.isFullyCovered).toBe(false);
    // Coverage reporting must stay internally consistent even when incomplete.
    expect(result.steps.filter((s) => s.ateContribution).length).toBe(result.eatenContributionCount);
    expect(result.steps.at(-1)?.isLoopComplete).toBe(false);
  });

  it("KNOWN LIMITATION: the documented 1D-corridor trap is also reported via isFullyCovered", () => {
    const grid = buildGrid(["#####.##"]);
    const result = solveSnakePath(grid, {
      bodyLength: 4,
      startCell: { weekIndex: 3, dayIndex: 0 },
    });
    expect(result.isFullyCovered).toBe(false);
    expect(result.eatenContributionCount).toBe(4);
  });
});

describe("solveSnakePath - opportunistic eating (crediting un-eaten cells a route merely passes over)", () => {
  // This exact 8x6 layout at bodyLength 3 was found by exploring small dense
  // boards for one where a BFS route to the tour's planned target legitimately
  // crosses another still-uneaten contribution cell -- the scenario reported
  // by the project owner (some visually-passed-over cells never faded). It's
  // fully deterministic (no randomness anywhere in the algorithm), so the
  // exact split below is a stable, hand-verified regression fixture rather
  // than a fragile snapshot of incidental behavior.
  const opportunisticGrid = buildGrid([
    ".####.##",
    "##.####.",
    "####.###",
    "#.####.#",
    "###.####",
    ".####.##",
  ]);

  it("splits a route into a separate step for an intermediate cell it opportunistically eats", () => {
    const result = solveSnakePath(opportunisticGrid, { bodyLength: 3 });

    // (5,2) sits on the BFS route the algorithm takes toward its actual
    // planned target (5,3); (5,2) itself hadn't been targeted yet, so it must
    // be credited via its own opportunistic step, not silently skipped.
    const bridgeStepIndex = result.steps.findIndex(
      (s) => s.cell.weekIndex === 5 && s.cell.dayIndex === 2,
    );
    const targetStepIndex = result.steps.findIndex(
      (s) => s.cell.weekIndex === 5 && s.cell.dayIndex === 3,
    );

    expect(bridgeStepIndex).toBeGreaterThan(-1);
    expect(targetStepIndex).toBeGreaterThan(-1);
    // The opportunistically-eaten cell must be its own, earlier step -- not
    // merged into one big jump that only stops at the final target.
    expect(bridgeStepIndex).toBeLessThan(targetStepIndex);

    const bridgeStep = result.steps[bridgeStepIndex]!;
    const targetStep = result.steps[targetStepIndex]!;

    // (a) both show up as their own `ateContribution: true` steps.
    expect(bridgeStep.ateContribution).toBe(true);
    expect(targetStep.ateContribution).toBe(true);
    // The split sub-route for the opportunistic cell ends exactly there...
    expect(bridgeStep.waypoints.at(-1)).toEqual({ weekIndex: 5, dayIndex: 2 });
    // ...and the very next step's waypoints continue from that exact cell,
    // rather than jumping straight from the pre-route head to the target.
    expect(targetStep.waypoints[0]).toEqual({ weekIndex: 5, dayIndex: 2 });
    expect(targetStep.waypoints.at(-1)).toEqual({ weekIndex: 5, dayIndex: 3 });

    // (b) full coverage: every contributed cell -- including the
    // opportunistically-eaten one -- ends up eaten.
    expect(result.eatenContributionCount).toBe(result.totalContributedCells);
    expect(result.isFullyCovered).toBe(true);

    // (c) the route wasn't collapsed into one big jump: splitting it added a
    // genuinely separate step rather than folding the bridge cell's credit
    // into the target step.
    expect(targetStepIndex).toBe(bridgeStepIndex + 1);
  });

  it("never emits a duplicate ateContribution:true step for the same cell", () => {
    const result = solveSnakePath(opportunisticGrid, { bodyLength: 3 });
    const eatenKeys = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(eatenKeys).size).toBe(eatenKeys.length);
  });

  it("keeps the step sequence contiguous across a split (no gaps for the renderer to trip on)", () => {
    const result = solveSnakePath(opportunisticGrid, { bodyLength: 3 });
    for (let i = 0; i < result.steps.length; i += 1) {
      const step = result.steps[i]!;
      const previousCell = i === 0 ? result.startCell : result.steps[i - 1]!.cell;
      expect(step.waypoints[0]).toEqual(previousCell);
    }
  });

  it("realistic scale: every contributed cell ends up eaten on a dense/sparse-mixed 53x7 board", () => {
    // Reuses the same style of fixture as the "completes within a reasonable
    // time" test above -- large enough that opportunistic eating is expected
    // to trigger many times along the way (verified during development), not
    // a specially-contrived edge case.
    const weekCount = 53;
    const dayCount = 7;
    const rows: string[] = [];
    for (let d = 0; d < dayCount; d += 1) {
      let row = "";
      for (let w = 0; w < weekCount; w += 1) {
        row += (w + d) % 3 === 0 ? "#" : ".";
      }
      rows.push(row);
    }
    const grid = buildGrid(rows);

    const result = solveSnakePath(grid);

    expect(result.isFullyCovered).toBe(true);
    expect(result.eatenContributionCount).toBe(result.totalContributedCells);

    const eatenKeys = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(eatenKeys).size).toBe(eatenKeys.length);

    const expectedKeys = contributedCellsOf(grid).map(cellKey).sort();
    expect(eatenKeys.slice().sort()).toEqual(expectedKeys);
  });
});
