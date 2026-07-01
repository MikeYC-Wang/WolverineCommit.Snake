import { describe, expect, it } from "vitest";
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
});
