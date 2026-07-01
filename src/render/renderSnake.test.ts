import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { cellCenter } from "./layout.js";
import { ANIMATION_TIMING, SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
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

/** Builds a step whose route passes through every cell in `path` (inclusive of both endpoints). */
function jumpStep(path: ReadonlyArray<readonly [number, number]>, overrides: Partial<SnakePathStep> = {}): SnakePathStep {
  const waypoints = path.map(([weekIndex, dayIndex]) => ({ weekIndex, dayIndex }));
  return {
    cell: waypoints.at(-1)!,
    waypoints,
    isJump: waypoints.length > 2,
    ateContribution: true,
    isLoopComplete: false,
    ...overrides,
  };
}

function totalDurationOf(svg: string): number {
  const match = svg.match(/dur="(\d+)ms"/);
  if (!match) throw new Error("no dur attribute found");
  return Number(match[1]);
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

  it("gives an adjacent single-cell step exactly one base stepDurationMs worth of total travel time", () => {
    const steps = [
      jumpStep([[0, 0]]),
      jumpStep([
        [0, 0],
        [1, 0],
      ]),
    ];
    const svg = renderSnake(steps, 2);
    // total = 1 hop * stepDurationMs + loopResetPauseMs, no jumps involved.
    const expectedTotal = ANIMATION_TIMING.stepDurationMs + ANIMATION_TIMING.loopResetPauseMs;
    expect(totalDurationOf(svg)).toBe(expectedTotal);
  });

  it("gives a multi-waypoint jump step proportionally more total travel time than a single-cell step", () => {
    const singleCellSteps = [
      jumpStep([[0, 0]]),
      jumpStep([
        [0, 0],
        [1, 0],
      ]),
    ];
    const jumpSteps = [
      jumpStep([[0, 0]]),
      jumpStep([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ]),
    ];

    const singleCellTotal = totalDurationOf(renderSnake(singleCellSteps, 2));
    const jumpTotal = totalDurationOf(renderSnake(jumpSteps, 2));

    // The jump route has 4 hops vs. 1 hop for the adjacent step: 3 extra
    // hops worth of stepDurationMs, and nothing else about the timeline changes.
    expect(jumpTotal - singleCellTotal).toBe(3 * ANIMATION_TIMING.stepDurationMs);
  });

  it("moves the head through intermediate waypoint cells during a jump rather than straight to the destination", () => {
    const steps = [
      jumpStep([[0, 0]]),
      jumpStep([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ]),
    ];
    const svg = renderSnake(steps, 1);

    const headTransform = svg.match(
      /id="wolverine-snake-head">\s*<animateTransform attributeName="transform" type="translate" values="([^"]+)"/,
    );
    expect(headTransform).not.toBeNull();
    const values = headTransform![1]!.split(";");

    const midCell = cellCenter({ weekIndex: 1, dayIndex: 0 });
    const laterCell = cellCenter({ weekIndex: 2, dayIndex: 0 });
    expect(values).toContain(`${midCell.x},${midCell.y}`);
    expect(values).toContain(`${laterCell.x},${laterCell.y}`);
  });

  it("keeps a body segment lagging behind by whole steps rather than snapping onto the head's route", () => {
    const steps = [
      jumpStep([[0, 0]]),
      jumpStep([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
      jumpStep([
        [2, 0],
        [2, 1],
      ]),
    ];
    const svg = renderSnake(steps, 1);

    const bodyTransform = svg.match(
      /id="wolverine-snake-body-0">\s*<animateTransform attributeName="transform" type="translate" values="([^"]+)"/,
    );
    expect(bodyTransform).not.toBeNull();
    const values = bodyTransform![1]!.split(";");

    // Body segment 0 (lag = 1 step) starts at the very first cell (start position, before it has anything to lag behind).
    const startCell = cellCenter({ weekIndex: 0, dayIndex: 0 });
    expect(values[0]).toBe(`${startCell.x},${startCell.y}`);
    // It must eventually reach the head's own step-1 destination (once the head has moved on to step 2).
    const step1Destination = cellCenter({ weekIndex: 2, dayIndex: 0 });
    expect(values).toContain(`${step1Destination.x},${step1Destination.y}`);
  });
});
