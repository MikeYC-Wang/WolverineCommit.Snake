import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import type { ContributionDay, ContributionGrid, ContributionLevel } from "../types.js";
import { CONTRIBUTION_LEVEL_COLORS } from "./theme.js";
import { renderGrid } from "./renderGrid.js";

function gridWithLevels(levels: ContributionLevel[]): ContributionGrid {
  const week: ContributionDay[] = levels.map((level, dayIndex) => ({
    date: `2026-01-0${dayIndex + 1}`,
    count: level,
    level,
    weekIndex: 0,
    dayIndex,
  }));
  return { weeks: [week], weekCount: 1, dayCount: levels.length };
}

function step(dayIndex: number, overrides: Partial<SnakePathStep> = {}): SnakePathStep {
  return {
    cell: { weekIndex: 0, dayIndex },
    waypoints: [{ weekIndex: 0, dayIndex }],
    isJump: false,
    ateContribution: true,
    isLoopComplete: false,
    ...overrides,
  };
}

/** Extracts the `<rect ...>...</rect>` markup for a specific cell, by its `data-date`. */
function rectFor(svg: string, date: string): string {
  // Non-greedy throughout: attribute spans must stop at the *first* place the
  // alternation can match, otherwise a self-closing `<rect .../>` greedily
  // swallows its own trailing "/" and falls through to matching all the way
  // to some *later* rect's "</rect>" instead of its own "/>".
  const pattern = new RegExp(`<rect[^>]*?data-date="${date}"[^>]*?(?:/>|>[\\s\\S]*?</rect>)`);
  const match = svg.match(pattern);
  if (!match) throw new Error(`no rect found for date ${date}`);
  return match[0];
}

describe("renderGrid", () => {
  it("renders exactly one rect per cell", () => {
    const grid = gridWithLevels([0, 1, 2, 3, 4]);
    const svg = renderGrid(grid);
    expect((svg.match(/<rect/g) ?? []).length).toBe(5);
  });

  it("uses the exact hex codes from theme.ts for each contribution level", () => {
    const grid = gridWithLevels([0, 1, 2, 3, 4]);
    const svg = renderGrid(grid);
    for (const level of [0, 1, 2, 3, 4] as ContributionLevel[]) {
      expect(svg).toContain(`fill="${CONTRIBUTION_LEVEL_COLORS[level]}"`);
    }
  });

  it("does not animate any cell when no steps are supplied (default behavior unchanged)", () => {
    const grid = gridWithLevels([1, 2]);
    const svg = renderGrid(grid);
    expect(svg).not.toContain("<animate");
  });

  it("gives a cell that gets eaten an animated fill transition timed to when the snake reaches it", () => {
    const grid = gridWithLevels([1, 4]);
    const steps = [step(0), step(1)];
    const svg = renderGrid(grid, steps);

    const eatenRect = rectFor(svg, "2026-01-02"); // dayIndex 1, eaten at step index 1
    expect(eatenRect).toContain('<animate attributeName="fill"');

    const valuesMatch = eatenRect.match(/values="([^"]+)"/);
    const keyTimesMatch = eatenRect.match(/keyTimes="([^"]+)"/);
    expect(valuesMatch).not.toBeNull();
    expect(keyTimesMatch).not.toBeNull();

    const values = valuesMatch![1]!.split(";");
    const keyTimes = keyTimesMatch![1]!.split(";").map(Number);

    // Starts at its original (level 4) color...
    expect(values[0]).toBe(CONTRIBUTION_LEVEL_COLORS[4]);
    // ...fades to the empty-cell color once eaten...
    expect(values).toContain(CONTRIBUTION_LEVEL_COLORS[0]);
    // ...and keyTimes are strictly increasing, ending exactly at 1.
    for (let i = 1; i < keyTimes.length; i += 1) {
      expect(keyTimes[i]!).toBeGreaterThan(keyTimes[i - 1]!);
    }
    expect(keyTimes.at(-1)).toBe(1);
  });

  it("leaves a cell that is never eaten fully static", () => {
    const grid = gridWithLevels([1, 4]);
    // Only dayIndex 0 gets eaten; dayIndex 1 (level 4) never appears in steps.
    const steps = [step(0)];
    const svg = renderGrid(grid, steps);

    const uneatenRect = rectFor(svg, "2026-01-02");
    expect(uneatenRect).not.toContain("<animate");
    expect(uneatenRect).toContain(`fill="${CONTRIBUTION_LEVEL_COLORS[4]}"`);
  });

  it("does not animate a level-0 (never contributed) cell even if steps are supplied", () => {
    const grid = gridWithLevels([0, 1]);
    const steps = [step(1)];
    const svg = renderGrid(grid, steps);

    const emptyRect = rectFor(svg, "2026-01-01");
    expect(emptyRect).not.toContain("<animate");
  });

  it("returns every eaten cell to its original color value by the final (loop-reset) keyframe", () => {
    const levels: ContributionLevel[] = [1, 2, 3, 4];
    const grid = gridWithLevels(levels);
    const steps = [step(0), step(1), step(2), step(3)];
    const svg = renderGrid(grid, steps);

    levels.forEach((level, dayIndex) => {
      const date = `2026-01-0${dayIndex + 1}`;
      const rect = rectFor(svg, date);
      const valuesMatch = rect.match(/values="([^"]+)"/);
      expect(valuesMatch).not.toBeNull();
      const values = valuesMatch![1]!.split(";");
      expect(values.at(-1)).toBe(CONTRIBUTION_LEVEL_COLORS[level]);
    });
  });
});
