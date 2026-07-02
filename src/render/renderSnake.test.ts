import { describe, expect, it } from "vitest";
import { solveSnakePath, type SnakePathStep } from "../pathfinding/solveSnakePath.js";
import type { ContributionDay, ContributionGrid } from "../types.js";
import { cellCenter } from "./layout.js";
import { ANIMATION_TIMING, SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
import { renderSnake } from "./renderSnake.js";

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Parses a node group's `translate` animation into a per-frame position array. */
function parseNodePositions(svg: string, nodeId: string): Point[] {
  const match = svg.match(
    new RegExp(`id="${nodeId}">\\s*<animateTransform attributeName="transform" type="translate" values="([^"]+)"`),
  );
  if (!match) throw new Error(`no translate animation found for #${nodeId}`);
  return match[1]!.split(";").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x!, y: y! };
  });
}

/** Number of keyframes in a node's `translate` animation. */
function parseKeyframeCount(svg: string, nodeId: string): number {
  const match = svg.match(
    new RegExp(`id="${nodeId}">\\s*<animateTransform attributeName="transform" type="translate" values="[^"]+" keyTimes="([^"]+)"`),
  );
  if (!match) throw new Error(`no keyTimes found for #${nodeId}`);
  return match[1]!.split(";").length;
}

/** Parses a `<line ...>` element's animated x1/y1/x2/y2 into per-frame endpoint arrays. */
function parseConnectorEndpoints(svg: string, lineIndex: number): { from: Point[]; to: Point[] } {
  const lines = [...svg.matchAll(/<line[^>]*>.*?<\/line>/gs)];
  const line = lines[lineIndex]?.[0];
  if (!line) throw new Error(`no <line> at index ${lineIndex}`);
  const parseValues = (attr: string): number[] => {
    const match = line.match(new RegExp(`attributeName="${attr}"[^>]*values="([^"]+)"`));
    if (!match) throw new Error(`no ${attr} animation found`);
    return match[1]!.split(";").map(Number);
  };
  const x1 = parseValues("x1");
  const y1 = parseValues("y1");
  const x2 = parseValues("x2");
  const y2 = parseValues("y2");
  const from = x1.map((x, i) => ({ x, y: y1[i]! }));
  const to = x2.map((x, i) => ({ x, y: y2[i]! }));
  return { from, to };
}

function totalDurationOf(svg: string): number {
  const match = svg.match(/dur="(\d+)ms"/);
  if (!match) throw new Error("no dur attribute found");
  return Number(match[1]);
}

/** Builds a dense weekCount x dayCount grid where `densityFn` decides which cells are contributed. */
function buildDensityGrid(
  weekCount: number,
  dayCount: number,
  densityFn: (weekIndex: number, dayIndex: number) => boolean,
): ContributionGrid {
  const weeks: ContributionDay[][] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const week: ContributionDay[] = [];
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
      const contributed = densityFn(weekIndex, dayIndex);
      week.push({
        date: `${weekIndex}-${dayIndex}`,
        count: contributed ? 1 : 0,
        level: contributed ? 1 : 0,
        weekIndex,
        dayIndex,
      });
    }
    weeks.push(week);
  }
  return { weeks, weekCount, dayCount };
}

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

/** A long jump immediately followed by very short steps -- a timing edge case worth exercising. */
const longJumpThenShortStepSteps: SnakePathStep[] = [
  jumpStep([[0, 0]]),
  jumpStep([
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0],
  ]),
  jumpStep([[10, 0], [10, 1]]),
  jumpStep([[10, 1], [10, 2]]),
  jumpStep([[10, 2], [10, 3]]),
];

const c = (weekIndex: number, dayIndex: number): Point => cellCenter({ weekIndex, dayIndex });

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
    const steps = [jumpStep([[0, 0]]), jumpStep([[0, 0], [1, 0]])];
    const svg = renderSnake(steps, 2);
    const expectedTotal = ANIMATION_TIMING.stepDurationMs + ANIMATION_TIMING.loopResetPauseMs;
    expect(totalDurationOf(svg)).toBe(expectedTotal);
  });

  it("gives a multi-waypoint jump step proportionally more total travel time than a single-cell step", () => {
    const singleCellSteps = [jumpStep([[0, 0]]), jumpStep([[0, 0], [1, 0]])];
    const jumpSteps = [jumpStep([[0, 0]]), jumpStep([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])];

    const singleCellTotal = totalDurationOf(renderSnake(singleCellSteps, 2));
    const jumpTotal = totalDurationOf(renderSnake(jumpSteps, 2));

    // The jump route has 4 hops vs. 1 hop for the adjacent step: 3 extra hops
    // worth of stepDurationMs, and nothing else about the timeline changes.
    expect(jumpTotal - singleCellTotal).toBe(3 * ANIMATION_TIMING.stepDurationMs);
  });

  it("moves the head through intermediate waypoint cells during a jump rather than straight to the destination", () => {
    const steps = [jumpStep([[0, 0]]), jumpStep([[0, 0], [1, 0], [2, 0], [3, 0]])];
    const svg = renderSnake(steps, 1);

    const values = parseNodePositions(svg, "wolverine-snake-head").map((p) => `${p.x},${p.y}`);
    expect(values).toContain(`${c(1, 0).x},${c(1, 0).y}`);
    expect(values).toContain(`${c(2, 0).x},${c(2, 0).y}`);
  });

  describe("body follows the head through the pathfinder's collision-free eaten cells", () => {
    it("places each body segment on the eaten cell that many steps behind the head", () => {
      const steps = [step(0, 0), step(1, 0), step(2, 0), step(3, 0, { isLoopComplete: true })];
      const svg = renderSnake(steps, 2);

      // Frames are the four step boundaries plus one trailing loop-reset hold.
      // body-0 trails the head by one eaten cell, body-1 by two; before it has
      // that many eaten cells behind it, a segment rests on the start cell.
      expect(parseNodePositions(svg, "wolverine-snake-body-0")).toEqual([
        c(0, 0), c(0, 0), c(1, 0), c(2, 0), c(2, 0),
      ]);
      expect(parseNodePositions(svg, "wolverine-snake-body-1")).toEqual([
        c(0, 0), c(0, 0), c(0, 0), c(1, 0), c(1, 0),
      ]);
    });

    it("starts every body segment coincident with the head's start cell (grows out of a point)", () => {
      const steps = [step(0, 0), step(1, 0), step(2, 0), step(3, 0, { isLoopComplete: true })];
      const svg = renderSnake(steps, 4);
      const headStart = parseNodePositions(svg, "wolverine-snake-head")[0];
      for (let segment = 0; segment < 4; segment += 1) {
        expect(parseNodePositions(svg, `wolverine-snake-body-${segment}`)[0]).toEqual(headStart);
      }
    });

    it("animates body nodes on a per-step timeline (fewer keyframes than the head when the path jumps)", () => {
      // A single 4-hop jump: the head needs a keyframe per hop, but a body node
      // only turns at step boundaries, so it needs far fewer keyframes.
      const steps = [jumpStep([[0, 0]]), jumpStep([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])];
      const svg = renderSnake(steps, 1);
      expect(parseKeyframeCount(svg, "wolverine-snake-body-0")).toBeLessThan(
        parseKeyframeCount(svg, "wolverine-snake-head"),
      );
    });

    it("never renders the head on top of a non-adjacent body node (honors the collision-free tour)", () => {
      // A fully-contributed grid yields a clean boustrophedon tour over
      // distinct cells, so every body node sits on a cell the head does not
      // currently occupy -- the head can never overlap its own body.
      const grid = buildDensityGrid(20, 7, () => true);
      const { steps, bodyLength } = solveSnakePath(grid);
      const svg = renderSnake(steps, bodyLength);

      const headAtBoundary = steps.map((s) => cellCenter(s.cell));
      const body2 = parseNodePositions(svg, "wolverine-snake-body-2"); // 3rd segment: clearly non-adjacent
      for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
        if (stepIndex - 3 < 0) continue; // segment is still growing out of the start cell
        const head = headAtBoundary[stepIndex]!;
        const body = body2[stepIndex]!;
        expect(Math.hypot(head.x - body.x, head.y - body.y)).toBeGreaterThan(0);
      }
    });
  });

  it("never produces NaN, undefined, or non-finite positions, even with more segments than steps", () => {
    const bodyLength = 20; // deliberately more segments than there are steps
    const svg = renderSnake(longJumpThenShortStepSteps, bodyLength);

    for (let segment = 0; segment < bodyLength; segment += 1) {
      const positions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);
      expect(positions.length).toBeGreaterThan(0);
      for (const p of positions) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
    for (let i = 0; i < bodyLength; i += 1) {
      const { from, to } = parseConnectorEndpoints(svg, i);
      for (const p of [...from, ...to]) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});
