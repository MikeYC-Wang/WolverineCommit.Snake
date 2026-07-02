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

describe("solveSnakePath - boustrophedon crawl", () => {
  it("returns an empty path for a grid with no contributions", () => {
    const grid = buildGrid([".....", "....."]);
    const result = solveSnakePath(grid);

    expect(result.steps).toHaveLength(0);
    expect(result.totalContributedCells).toBe(0);
    expect(result.isFullyCovered).toBe(true);
  });

  it("visits every cell in the grid exactly once", () => {
    const grid = buildGrid(["#..#.", ".#.#.", "..#.#"]); // 5 weeks x 3 days = 15 cells
    const result = solveSnakePath(grid);

    expect(result.steps).toHaveLength(15);
    const visited = new Set(result.steps.map((s) => cellKey(s.cell)));
    expect(visited.size).toBe(15);
  });

  it("starts at (0,0) and moves one orthogonally-adjacent cell per step", () => {
    const grid = buildGrid(["#.#", ".#.", "#.#"]);
    const result = solveSnakePath(grid);

    expect(result.startCell).toEqual({ weekIndex: 0, dayIndex: 0 });
    expect(result.steps[0]!.cell).toEqual({ weekIndex: 0, dayIndex: 0 });
    for (let i = 1; i < result.steps.length; i += 1) {
      expect(isAdjacent(result.steps[i - 1]!.cell, result.steps[i]!.cell)).toBe(true);
    }
  });

  it("never lets the head land on a cell its own body currently occupies", () => {
    const grid = buildGrid(["#.#.#.#", ".#.#.#.", "#.#.#.#"]);
    const bodyLength = DEFAULT_SNAKE_BODY_LENGTH;
    const result = solveSnakePath(grid, { bodyLength });

    const body: string[] = [];
    for (const step of result.steps) {
      const key = cellKey(step.cell);
      expect(body).not.toContain(key); // head never enters a body cell
      body.unshift(key);
      if (body.length > bodyLength + 1) body.pop();
    }
  });

  it("eats every contributed cell (isFullyCovered) regardless of how they are scattered", () => {
    const grid = buildGrid(["#....#", ".#..#.", "..##.."]);
    const result = solveSnakePath(grid);

    expect(result.eatenContributionCount).toBe(result.totalContributedCells);
    expect(result.isFullyCovered).toBe(true);
  });

  it("marks ateContribution true exactly on the first visit to each contributed cell and false elsewhere", () => {
    const grid = buildGrid(["#.#", "..."]); // contributions at (0,0) and (2,0)
    const result = solveSnakePath(grid);

    const ateKeys = result.steps.filter((s) => s.ateContribution).map((s) => cellKey(s.cell));
    expect(new Set(ateKeys)).toEqual(new Set([cellKey({ weekIndex: 0, dayIndex: 0 }), cellKey({ weekIndex: 2, dayIndex: 0 })]));
    // No cell is credited as eaten more than once.
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
    const completeFlags = result.steps.map((s) => s.isLoopComplete);
    expect(completeFlags.slice(0, -1).every((f) => f === false)).toBe(true);
    expect(completeFlags.at(-1)).toBe(true);
  });

  it("throws when bodyLength is less than 1", () => {
    const grid = buildGrid(["#.#"]);
    expect(() => solveSnakePath(grid, { bodyLength: 0 })).toThrow();
  });

  it("scales to a full 53x7 calendar with complete coverage and all-adjacent moves", () => {
    const rows: string[] = [];
    for (let d = 0; d < 7; d += 1) {
      let row = "";
      for (let w = 0; w < 53; w += 1) row += (w * 3 + d * 7) % 5 !== 0 ? "#" : ".";
      rows.push(row);
    }
    const grid = buildGrid(rows);
    const result = solveSnakePath(grid);

    expect(result.steps).toHaveLength(53 * 7);
    expect(result.isFullyCovered).toBe(true);
    for (let i = 1; i < result.steps.length; i += 1) {
      expect(isAdjacent(result.steps[i - 1]!.cell, result.steps[i]!.cell)).toBe(true);
    }
  });
});
