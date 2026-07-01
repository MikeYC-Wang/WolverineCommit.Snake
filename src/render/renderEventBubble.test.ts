import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import type { ContributionDay, ContributionGrid, ContributionLevel } from "../types.js";
import { EVENT_BUBBLE_FILL, EVENT_BUBBLE_RADIUS_BY_LEVEL } from "./theme.js";
import { renderEventBubble } from "./renderEventBubble.js";

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

describe("renderEventBubble", () => {
  it("returns an empty string when there are no steps", () => {
    const grid = gridWithLevels([1]);
    expect(renderEventBubble(grid, [], 10)).toBe("");
  });

  it("renders one bubble per eaten (non-wander) step, sized by contribution level", () => {
    const grid = gridWithLevels([1, 4]);
    const steps = [step(0), step(1)];
    const svg = renderEventBubble(grid, steps, 10);

    expect((svg.match(/<circle/g) ?? []).length).toBe(2);
    expect(svg).toContain(`fill="${EVENT_BUBBLE_FILL}"`);
    expect(svg).toContain(`r="${EVENT_BUBBLE_RADIUS_BY_LEVEL[1]}"`);
    expect(svg).toContain(`r="${EVENT_BUBBLE_RADIUS_BY_LEVEL[4]}"`);
  });

  it("does not render a bubble for wander steps that ate nothing", () => {
    const grid = gridWithLevels([1, 1]);
    const steps = [step(0), step(1, { ateContribution: false })];
    const svg = renderEventBubble(grid, steps, 10);
    expect((svg.match(/<circle/g) ?? []).length).toBe(1);
  });
});
