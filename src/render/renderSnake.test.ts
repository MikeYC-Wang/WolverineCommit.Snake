import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
import { renderSnake } from "./renderSnake.js";

function step(weekIndex: number, dayIndex: number, overrides: Partial<SnakePathStep> = {}): SnakePathStep {
  return {
    cell: { weekIndex, dayIndex },
    waypoints: [{ weekIndex, dayIndex }],
    isJump: false,
    ateContribution: true,
    isLoopComplete: false,
    ...overrides,
  };
}

describe("renderSnake", () => {
  it("returns an empty string when there are no steps", () => {
    expect(renderSnake([], 10)).toBe("");
  });

  it("renders a head group, one body group per segment, and connector lines", () => {
    const steps = [step(0, 0), step(1, 0), step(2, 0, { isLoopComplete: true })];
    const svg = renderSnake(steps, 3);

    expect(svg).toContain('id="wolverine-snake-head"');
    expect(svg).toContain(`fill="${SNAKE_HEAD_FILL}"`);
    expect(svg).toContain(`stroke="${SNAKE_HEAD_BORDER}"`);
    for (let i = 0; i < 3; i += 1) {
      expect(svg).toContain(`id="wolverine-snake-body-${i}"`);
    }
    expect(svg).toContain(`fill="${SNAKE_BODY_FILL}"`);
    expect((svg.match(/<line/g) ?? []).length).toBe(3); // head->body0, body0->body1, body1->body2
  });

  it("emits every animation with the same total duration so all nodes stay in sync", () => {
    const steps = [step(0, 0), step(3, 2)];
    const svg = renderSnake(steps, 2);
    const durations = [...svg.matchAll(/dur="(\d+)ms"/g)].map((m) => m[1]);
    expect(new Set(durations).size).toBe(1);
  });
});
