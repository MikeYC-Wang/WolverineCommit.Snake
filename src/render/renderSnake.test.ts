import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { cellCenter } from "./layout.js";
import { SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
import { renderSnake } from "./renderSnake.js";

/** Builds a straight run of adjacent single-hop steps along a row of cells. */
function adjacentSteps(count: number): SnakePathStep[] {
  const steps: SnakePathStep[] = [];
  for (let i = 0; i < count; i += 1) {
    const cell = { weekIndex: i, dayIndex: 0 };
    steps.push({
      cell,
      waypoints: i === 0 ? [cell] : [{ weekIndex: i - 1, dayIndex: 0 }, cell],
      isJump: false,
      ateContribution: true,
      isLoopComplete: i === count - 1,
    });
  }
  return steps;
}

describe("renderSnake", () => {
  it("returns an empty string when there are no steps", () => {
    expect(renderSnake([], 10)).toBe("");
  });

  it("renders one shared route path, one head, and one group per body segment", () => {
    const bodyLength = 4;
    const svg = renderSnake(adjacentSteps(8), bodyLength);

    expect(svg).toContain('id="wolverine-snake-route"');
    expect(svg).toContain('id="wolverine-snake-head"');
    expect(svg).toContain(`fill="${SNAKE_HEAD_FILL}"`);
    expect(svg).toContain(`stroke="${SNAKE_HEAD_BORDER}"`);
    // One body rect per segment (fill = body color), plus the head has none of that fill.
    expect((svg.match(new RegExp(`fill="${SNAKE_BODY_FILL}"`, "g")) ?? []).length).toBe(bodyLength);
    // One animateMotion per node: bodyLength body segments + 1 head.
    expect((svg.match(/<animateMotion/g) ?? []).length).toBe(bodyLength + 1);
  });

  it("traces the shared route path through every cell centre in order", () => {
    const steps = adjacentSteps(4);
    const svg = renderSnake(steps, 2);

    const match = svg.match(/id="wolverine-snake-route" d="([^"]+)"/);
    expect(match).not.toBeNull();
    const d = match![1]!;
    for (let i = 0; i < steps.length; i += 1) {
      const p = cellCenter(steps[i]!.cell);
      expect(d).toContain(`${i === 0 ? "M" : "L"} ${p.x} ${p.y}`);
    }
  });

  it("drives every node along the shared route via animateMotion with an mpath reference", () => {
    const svg = renderSnake(adjacentSteps(6), 3);

    expect(svg).toContain("<animateMotion");
    expect(svg).toContain('href="#wolverine-snake-route"');
    expect(svg).toContain('xlink:href="#wolverine-snake-route"');
    // Only the head auto-rotates (its direction arrow); body squares do not.
    expect((svg.match(/rotate="auto"/g) ?? []).length).toBe(1);
  });

  it("keeps every animation on a single shared duration so the snake stays in sync with the grid", () => {
    const svg = renderSnake(adjacentSteps(6), 3);
    const durations = [...svg.matchAll(/dur="(\d+)ms"/g)].map((m) => m[1]);
    expect(durations.length).toBeGreaterThan(0);
    expect(new Set(durations).size).toBe(1);
  });

  it("renders a static head (no animation) for a single-cell path", () => {
    const svg = renderSnake(adjacentSteps(1), 10);
    expect(svg).toContain('id="wolverine-snake-head"');
    expect(svg).not.toContain("<animateMotion");
  });

  it("trails each body segment a fixed number of cells behind (later segments end further back)", () => {
    // On a long straight run, body segment k finishes at path fraction
    // 1 - k*cellFraction, so its animateMotion end keyPoint strictly decreases
    // as k grows -- i.e. deeper segments sit further back.
    const svg = renderSnake(adjacentSteps(21), 5); // cellFraction = 1/20 = 0.05
    const endPoints = [...svg.matchAll(/keyPoints="0;0;([\d.]+);[\d.]+"/g)].map((m) => Number(m[1]));
    expect(endPoints.length).toBe(5);
    // Rendered furthest-first, so the parsed sequence is strictly increasing.
    for (let i = 1; i < endPoints.length; i += 1) {
      expect(endPoints[i]).toBeGreaterThan(endPoints[i - 1]!);
    }
  });
});
