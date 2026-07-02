import { describe, expect, it } from "vitest";
import type { ContributionDay, ContributionGrid, ContributionLevel, GridCell } from "../types.js";
import { cellKey } from "../types.js";
import { DEFAULT_SNAKE_BODY_LENGTH, solveSnakePath } from "./solveSnakePath.js";

/**
 * Builds a ContributionGrid from an ASCII layout: one string per row
 * (dayIndex), one character per column (weekIndex). `#` is a contributed cell
 * (count 1, level 1); `.` is empty. All rows must share the same length.
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

function isAdjacent(a: GridCell, b: GridCell): boolean {
  return Math.abs(a.weekIndex - b.weekIndex) + Math.abs(a.dayIndex - b.dayIndex) === 1;
}

/**
 * Replays the body occupancy and asserts the head never lands on a cell that
 * another body segment still occupies (moving onto the tail cell it is
 * vacating is legal). Returns the number of genuine self-overlaps.
 */
function selfOverlaps(steps: readonly { cell: GridCell }[], bodyLength: number): number {
  let overlaps = 0;
  const body: string[] = [];
  for (const step of steps) {
    const key = cellKey(step.cell);
    const willPop = body.length === bodyLength + 1;
    const stillOccupied = willPop ? body.slice(0, -1) : body;
    if (stillOccupied.includes(key)) overlaps += 1;
    body.unshift(key);
    if (body.length > bodyLength + 1) body.pop();
  }
  return overlaps;
}

describe("solveSnakePath - contiguous hunting crawl", () => {
  it("returns an empty path for a grid with no contributions", () => {
    const grid = buildGrid([".....", "....."]);
    const result = solveSnakePath(grid);

    expect(result.steps).toHaveLength(0);
    expect(result.totalContributedCells).toBe(0);
    expect(result.isFullyCovered).toBe(true);
  });

  it("starts on the earliest contributed cell in reading order", () => {
    const grid = buildGrid([".#.#.", "#...#", "..#.."]); // earliest contributed is (0,1)
    const result = solveSnakePath(grid);
    expect(result.startCell).toEqual({ weekIndex: 0, dayIndex: 1 });
    expect(result.steps[0]!.cell).toEqual({ weekIndex: 0, dayIndex: 1 });
  });

  it("moves exactly one orthogonally-adjacent cell per step", () => {
    const grid = buildGrid(["#.#.#", ".#.#.", "#.#.#"]);
    const result = solveSnakePath(grid);
    for (let i = 1; i < result.steps.length; i += 1) {
      expect(isAdjacent(result.steps[i - 1]!.cell, result.steps[i]!.cell)).toBe(true);
    }
  });

  it("never lets the head overlap its own body", () => {
    const grid = buildGrid(["#.#.#.#", ".#.#.#.", "#.#.#.#", ".#.#.#."]);
    const bodyLength = DEFAULT_SNAKE_BODY_LENGTH;
    const result = solveSnakePath(grid, { bodyLength });
    expect(selfOverlaps(result.steps, bodyLength)).toBe(0);
  });

  it("eats every contributed cell (isFullyCovered)", () => {
    const grid = buildGrid(["#....#", ".#..#.", "..##.."]);
    const result = solveSnakePath(grid);
    expect(result.eatenContributionCount).toBe(result.totalContributedCells);
    expect(result.isFullyCovered).toBe(true);
  });

  it("credits each contributed cell as eaten exactly once, and never an empty cell", () => {
    const grid = buildGrid(["#.#", "..."]);
    const result = solveSnakePath(grid);
    const ateKeys = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(ateKeys)).toEqual(
      new Set([cellKey({ weekIndex: 0, dayIndex: 0 }), cellKey({ weekIndex: 2, dayIndex: 0 })]),
    );
    expect(ateKeys.length).toBe(new Set(ateKeys).size);
  });

  it("never marks a step as a jump (every move is a single adjacent hop)", () => {
    const grid = buildGrid(["#.#", ".#.", "#.#"]);
    const result = solveSnakePath(grid);
    for (const step of result.steps) {
      expect(step.isJump).toBe(false);
      expect(step.waypoints.length).toBeLessThanOrEqual(2);
    }
  });

  it("sets isLoopComplete only on the final step", () => {
    const grid = buildGrid(["#.#", ".#."]);
    const result = solveSnakePath(grid);
    const flags = result.steps.map((s) => s.isLoopComplete);
    expect(flags.slice(0, -1).every((f) => f === false)).toBe(true);
    expect(flags.at(-1)).toBe(true);
  });

  it("throws when bodyLength is less than 1", () => {
    expect(() => solveSnakePath(buildGrid(["#.#"]), { bodyLength: 0 })).toThrow();
  });

  it("covers a dense 53x7 calendar fully with all-adjacent, non-overlapping moves", () => {
    const rows: string[] = [];
    for (let d = 0; d < 7; d += 1) {
      let row = "";
      for (let w = 0; w < 53; w += 1) row += (w * 3 + d * 7) % 5 !== 0 ? "#" : ".";
      rows.push(row);
    }
    const grid = buildGrid(rows);
    const result = solveSnakePath(grid);

    expect(result.isFullyCovered).toBe(true);
    expect(selfOverlaps(result.steps, result.bodyLength)).toBe(0);
    for (let i = 1; i < result.steps.length; i += 1) {
      expect(isAdjacent(result.steps[i - 1]!.cell, result.steps[i]!.cell)).toBe(true);
    }
  });

  it("covers a sparse, scattered calendar fully", () => {
    const rows: string[] = [];
    for (let d = 0; d < 7; d += 1) {
      let row = "";
      for (let w = 0; w < 53; w += 1) row += (w * 7 + d * 3) % 11 === 0 ? "#" : ".";
      rows.push(row);
    }
    const result = solveSnakePath(buildGrid(rows));
    expect(result.isFullyCovered).toBe(true);
  });
});
