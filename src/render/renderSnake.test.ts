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

/** Max px-per-ms speed across consecutive frames, given each frame's absolute time. */
function maxSpeedPxPerMs(positions: readonly Point[], frameTimesMs: readonly number[]): number {
  let max = 0;
  for (let i = 1; i < positions.length; i += 1) {
    const dt = frameTimesMs[i]! - frameTimesMs[i - 1]!;
    if (dt <= 0) continue;
    const dx = positions[i]!.x - positions[i - 1]!.x;
    const dy = positions[i]!.y - positions[i - 1]!.y;
    max = Math.max(max, Math.hypot(dx, dy) / dt);
  }
  return max;
}

/** Extracts every distinct absolute frame time (ms) from the shared keyTimes/dur convention. */
function frameTimesMsOf(svg: string): number[] {
  const durMatch = svg.match(/dur="(\d+)ms"/);
  const keyTimesMatch = svg.match(/keyTimes="([^"]+)"/);
  if (!durMatch || !keyTimesMatch) throw new Error("no dur/keyTimes found");
  const totalDurationMs = Number(durMatch[1]);
  return keyTimesMatch[1]!.split(";").map((kt) => Number(kt) * totalDurationMs);
}

/**
 * Asserts that, across the whole rendered loop, no body segment or connector
 * endpoint ever moves faster (px/ms) than the head's own fastest single hop.
 * This is the core property the eaten-cell-fade/distance-timing fix's body
 * segments must satisfy (see project report, "the snake body snaps/teleports").
 */
function expectNoSegmentFasterThanHead(svg: string, bodyLength: number): void {
  const frameTimesMs = frameTimesMsOf(svg);

  const headPositions = parseNodePositions(svg, "wolverine-snake-head");
  const headMaxSpeed = maxSpeedPxPerMs(headPositions, frameTimesMs);
  expect(headMaxSpeed).toBeGreaterThan(0);

  const tolerance = 1e-9;
  for (let segment = 0; segment < bodyLength; segment += 1) {
    const bodyPositions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);
    const bodyMaxSpeed = maxSpeedPxPerMs(bodyPositions, frameTimesMs);
    expect(bodyMaxSpeed).toBeLessThanOrEqual(headMaxSpeed + tolerance);
  }

  for (let i = 0; i < bodyLength; i += 1) {
    // connectors: head->body0, body0->body1, ..., body(n-2)->body(n-1)
    const { from, to } = parseConnectorEndpoints(svg, i);
    expect(maxSpeedPxPerMs(from, frameTimesMs)).toBeLessThanOrEqual(headMaxSpeed + tolerance);
    expect(maxSpeedPxPerMs(to, frameTimesMs)).toBeLessThanOrEqual(headMaxSpeed + tolerance);
  }
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

/**
 * Cumulative hop-frame index of each step's own boundary (its last hop),
 * given each step's own hop count -- mirrors `buildHopFrames`' internal
 * indexing (renderSnake.ts) without needing to export it. `stepBoundary[0]`
 * is frame 0 (the start position); `stepBoundary[s]` for `s >= 1` is the
 * frame at which step `s` finishes moving.
 */
function stepBoundaryFrameIndices(steps: readonly SnakePathStep[]): number[] {
  const indices = [0];
  let cumulativeHops = 0;
  for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
    cumulativeHops += Math.max(1, steps[stepIndex]!.waypoints.length - 1);
    indices.push(cumulativeHops);
  }
  return indices;
}

/**
 * Gap (px), at every step boundary, between a lagged body segment's actual
 * (post-`clampToMaxSpeed`) rendered position and its *ideal* (unclamped)
 * time-shifted target. At step boundary `s`, the ideal target for a segment
 * lagging `stepLag` steps behind the head is exactly the head's own actual
 * position at step boundary `s - stepLag` (or the start position, if that
 * would be before the loop began) -- see `headPositionAtTime`/
 * `laggedPositions` in renderSnake.ts, and the design-decision comment on
 * `clampToMaxSpeed` for why this gap is not always zero.
 */
function gapsAtStepBoundaries(steps: readonly SnakePathStep[], svg: string, stepLag: number): number[] {
  const boundaryFrame = stepBoundaryFrameIndices(steps);
  const headPositions = parseNodePositions(svg, "wolverine-snake-head");
  const bodyPositions = parseNodePositions(svg, `wolverine-snake-body-${stepLag - 1}`);
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  return steps.map((_, stepIndex) => {
    const idealSourceStep = Math.max(stepIndex - stepLag, 0);
    const ideal = headPositions[boundaryFrame[idealSourceStep]!]!;
    const actual = bodyPositions[boundaryFrame[stepIndex]!]!;
    return distance(ideal, actual);
  });
}

function totalDurationOf(svg: string): number {
  const match = svg.match(/dur="(\d+)ms"/);
  if (!match) throw new Error("no dur attribute found");
  return Number(match[1]);
}

/**
 * Reproduces QA's exact repro shape: a long jump (many hops) immediately
 * followed by a very short step. Before the time-shift fix, a lagged body
 * segment replayed the long jump's whole route within the short step's tiny
 * real-time budget, snapping across most of the board in a single frame.
 */
const longJumpThenShortStepSteps: SnakePathStep[] = [
  jumpStep([[0, 0]]),
  jumpStep([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
    [6, 0],
    [7, 0],
    [8, 0],
    [9, 0],
    [10, 0],
  ]), // 10-hop jump
  jumpStep([
    [10, 0],
    [10, 1],
  ]), // 1-hop step immediately after
  jumpStep([
    [10, 1],
    [10, 2],
  ]),
  jumpStep([
    [10, 2],
    [10, 3],
  ]),
];

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
    // Both jump steps span 2 hops each, so the time-shifted lag (see
    // laggedPositions in renderSnake.ts) lines up exactly on frame
    // boundaries and never needs the bounded-speed safety clamp to kick in
    // -- this test is about whole-step lag correctness, not the clamp
    // itself (covered separately below).
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
        [2, 2],
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

  describe("adversarial long-jump-then-short-step timing (QA repro)", () => {
    it("never moves any body segment or connector endpoint faster than the head's own worst single hop", () => {
      const bodyLength = 3;
      const svg = renderSnake(longJumpThenShortStepSteps, bodyLength);
      expectNoSegmentFasterThanHead(svg, bodyLength);
    });
  });

  describe("realistic dense fixture (QA's 53x7 repro scale)", () => {
    it("holds the no-segment-faster-than-head property at full scale with mixed jump lengths", () => {
      // Same shape QA used to find the bug: a large, densely (but not fully)
      // contributed grid, which naturally produces a mix of adjacent 1-hop
      // steps and long multi-hop jumps back to back.
      const grid = buildDensityGrid(53, 7, (w, d) => (w * 3 + d * 7) % 5 !== 0);
      const { steps, bodyLength, totalContributedCells, eatenContributionCount } = solveSnakePath(grid);
      // ~80% density over 53x7 (371 cells) = ~296 contributed cells, matching
      // QA's repro scale; this specific density pattern is a known
      // near-complete (not 100%) coverage case (see solveSnakePath.test.ts),
      // which is irrelevant here -- we only care about the render timing.
      expect(totalContributedCells).toBeGreaterThan(270);
      expect(eatenContributionCount).toBeGreaterThan(270);
      expect(steps.length).toBeGreaterThan(200);

      const svg = renderSnake(steps, bodyLength);
      expectNoSegmentFasterThanHead(svg, bodyLength);
    });
  });

  describe("body-lag bounded-speed \"chase\" trade-off (see clampToMaxSpeed design-decision comment)", () => {
    // Exact per-step-boundary alignment and a hard speed cap are jointly
    // impossible whenever a long jump is immediately followed by an
    // arbitrarily short step (there is provably not enough real time to
    // cover the required ground at the speed limit). The project owner's
    // call was to relax exact-boundary alignment and guarantee bounded-speed
    // "chase" motion instead. These tests pin down exactly what that means:
    // no NaN/backwards positions ever, the gap shrinks whenever slack time
    // is available, and even with zero slack the steady-state error stays
    // bounded rather than diverging.

    it("never produces NaN, undefined, or non-finite positions, even for segments with more lag than the loop has history for", () => {
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

    it("shrinks the gap to the ideal time-shifted target across recovery steps after a hard jump-then-short transition, until fully resynced", () => {
      const steps: SnakePathStep[] = [
        jumpStep([[0, 0]]),
        jumpStep([
          [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0],
        ]), // 10-hop jump
        jumpStep([[10, 0], [10, 1]]), // 1-hop step immediately after -- this is the hard transition where the clamp engages
        // Recovery slack: ordinary 1-hop steps that don't demand another hard
        // catch-up, giving the clamped segment room to close the gap.
        jumpStep([[10, 1], [10, 2]]),
        jumpStep([[10, 2], [10, 3]]),
        jumpStep([[10, 3], [10, 4]]),
        jumpStep([[10, 4], [10, 5]]),
        jumpStep([[10, 5], [10, 6]]),
        jumpStep([[9, 6], [8, 6]]),
        jumpStep([[8, 6], [7, 6]]),
      ];
      const svg = renderSnake(steps, 1);
      const gaps = gapsAtStepBoundaries(steps, svg, 1);

      const hardTransitionIndex = 2;
      // Right after the hard transition, segment 0 is measurably behind its
      // ideal target -- the mathematically-unavoidable gap QA proved.
      expect(gaps[hardTransitionIndex]).toBeGreaterThan(50);

      // Across every recovery step that follows, the gap must never grow or
      // oscillate back up -- only shrink or (once resynced) hold at zero.
      for (let i = hardTransitionIndex; i < gaps.length - 1; i += 1) {
        expect(gaps[i + 1]).toBeLessThanOrEqual(gaps[i]! + 1e-9);
      }
      // It must also make real, strict progress and be fully resynced
      // (within a tight tolerance) before the recovery steps run out.
      expect(gaps.at(-1)!).toBeLessThan(gaps[hardTransitionIndex]!);
      expect(gaps.at(-1)!).toBeLessThan(1e-6);
    });

    it("keeps the steady-state error bounded (not growing cycle over cycle) under a repeating hard jump/short-step pattern with no recovery slack", () => {
      // QA's pathological shape: the jump/short-step hard transition repeats
      // back-to-back, cycle after cycle, with no slack steps in between for
      // the clamp to fully catch up on. This is the case where exact
      // resync is impossible by construction -- what's guaranteed instead is
      // that the offset settles into a stable, bounded steady state rather
      // than growing without limit.
      const steps: SnakePathStep[] = [jumpStep([[0, 0]])];
      let week = 0;
      let day = 0;
      const cycleCount = 8;
      for (let cycle = 0; cycle < cycleCount; cycle += 1) {
        const jumpPath: Array<[number, number]> = [];
        for (let hop = 0; hop <= 10; hop += 1) jumpPath.push([week + hop, day]);
        week += 10;
        steps.push(jumpStep(jumpPath)); // 10-hop jump
        const nextDay = (day + 1) % 7;
        steps.push(jumpStep([[week, day], [week, nextDay]])); // 1-hop step, immediately next -- no slack before the next cycle's jump
        day = nextDay;
      }

      const svg = renderSnake(steps, 1);
      const gaps = gapsAtStepBoundaries(steps, svg, 1);

      // Step index of the "after short step" boundary for cycle c (0-indexed): 2*c + 2.
      const secondCycleGap = gaps[2 * 1 + 2]!;
      const eighthCycleGap = gaps[2 * (cycleCount - 1) + 2]!;

      expect(secondCycleGap).toBeGreaterThan(0); // the hard pattern really does produce a persistent, non-zero offset
      // The offset must be a stable, bounded steady state, not a divergence.
      expect(eighthCycleGap).toBeCloseTo(secondCycleGap, 5);
    });
  });
});
