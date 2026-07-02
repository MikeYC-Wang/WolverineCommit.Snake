import { describe, expect, it } from "vitest";
import { solveSnakePath, type SnakePathStep } from "../pathfinding/solveSnakePath.js";
import type { ContributionDay, ContributionGrid } from "../types.js";
import { cellCenter } from "./layout.js";
import { ANIMATION_TIMING, SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
import { buildLoopTimeline, computeStepDurationsMs } from "./timeline.js";
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
 * Whether point `p` lies on the closed segment `[a, b]` (within `tolerance`
 * px of perpendicular distance from the infinite line, and within the
 * segment's own extent -- not just anywhere on the line through it).
 */
function isOnSegment(p: Point, a: Point, b: Point, tolerance = 1e-6): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const segLengthSq = abx * abx + aby * aby;
  if (segLengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= tolerance;

  const cross = abx * (p.y - a.y) - aby * (p.x - a.x);
  const segLength = Math.sqrt(segLengthSq);
  if (Math.abs(cross) / segLength > tolerance) return false;

  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / segLengthSq;
  return t >= -1e-9 && t <= 1 + 1e-9;
}

/**
 * Whether `p` lies exactly on *some* consecutive segment of the head's own
 * traveled polyline (`headPositions`) -- the core "never cuts across the
 * grid" guarantee the arc-length reparameterization fix exists to provide.
 */
function isOnHeadPolyline(p: Point, headPositions: readonly Point[], tolerance = 1e-6): boolean {
  for (let i = 1; i < headPositions.length; i += 1) {
    if (isOnSegment(p, headPositions[i - 1]!, headPositions[i]!, tolerance)) return true;
  }
  return false;
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

  describe("body/connector positions stay exactly on the head's own traveled path (arc-length reparameterization)", () => {
    it("keeps every body-segment and connector-endpoint position exactly on the head's polyline, even under heavy clamping", () => {
      const bodyLength = 3;
      const svg = renderSnake(longJumpThenShortStepSteps, bodyLength);
      const headPositions = parseNodePositions(svg, "wolverine-snake-head");

      let checked = 0;
      for (let segment = 0; segment < bodyLength; segment += 1) {
        const positions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);
        for (const p of positions) {
          expect(isOnHeadPolyline(p, headPositions)).toBe(true);
          checked += 1;
        }
      }
      for (let i = 0; i < bodyLength; i += 1) {
        const { from, to } = parseConnectorEndpoints(svg, i);
        for (const p of [...from, ...to]) {
          expect(isOnHeadPolyline(p, headPositions)).toBe(true);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(20); // sanity: this actually exercised many frames, not a vacuous pass
    });

    it("also holds at the realistic dense-fixture scale (mixed jump lengths, ~300 steps)", () => {
      const grid = buildDensityGrid(53, 7, (w, d) => (w * 3 + d * 7) % 5 !== 0);
      const { steps, bodyLength } = solveSnakePath(grid);
      const svg = renderSnake(steps, bodyLength);
      const headPositions = parseNodePositions(svg, "wolverine-snake-head");

      for (let segment = 0; segment < bodyLength; segment += 1) {
        const positions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);
        for (const p of positions) {
          expect(isOnHeadPolyline(p, headPositions)).toBe(true);
        }
      }
    });

    it("proves the on-path test above is meaningful: the pre-fix Euclidean clampToMaxSpeed produced off-path points on this exact fixture", () => {
      // Reconstructs the head's own keyframe timeline (buildHopFrames /
      // waypointPosition / lagDurationMs are all unchanged by this fix, just
      // not exported, so they're reproduced here) and then re-applies the
      // *pre-fix* clamp -- a straight Euclidean line from the segment's
      // previous rendered (x,y) toward the ideal (x,y) target -- to show it
      // lands off the head's polyline on this exact adversarial fixture.
      const steps = longJumpThenShortStepSteps;
      const { stepDurationMs, loopResetPauseMs } = ANIMATION_TIMING;
      const stepDurationsMs = computeStepDurationsMs(steps, stepDurationMs);
      const { absoluteTimesMs, totalDurationMs } = buildLoopTimeline(stepDurationsMs, loopResetPauseMs);

      interface HopFrame {
        timeMs: number;
        stepIndex: number;
        hopIndex: number;
      }
      const hopFrames: HopFrame[] = [{ timeMs: 0, stepIndex: 0, hopIndex: 0 }];
      for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
        const s = steps[stepIndex]!;
        const hopCount = Math.max(1, s.waypoints.length - 1);
        const stepStartMs = absoluteTimesMs[stepIndex - 1]!;
        for (let hopIndex = 1; hopIndex <= hopCount; hopIndex += 1) {
          hopFrames.push({ timeMs: stepStartMs + hopIndex * stepDurationMs, stepIndex, hopIndex });
        }
      }
      const waypointPositionLocal = (stepIndex: number, hopIndex: number): Point => {
        const s = steps[stepIndex]!;
        const waypointIndex = Math.min(hopIndex, s.waypoints.length - 1);
        return cellCenter(s.waypoints[waypointIndex]!);
      };
      const headPositions = hopFrames.map((f) => waypointPositionLocal(f.stepIndex, f.hopIndex));
      const extendedHeadPositions = [...headPositions, headPositions.at(-1)!];
      const headTimelineTimesMs = [...hopFrames.map((f) => f.timeMs), totalDurationMs];

      const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
      let maxHeadHopDistancePx = 0;
      for (let i = 1; i < headPositions.length; i += 1) {
        maxHeadHopDistancePx = Math.max(maxHeadHopDistancePx, distance(headPositions[i - 1]!, headPositions[i]!));
      }

      // Pre-fix `lagDurationMs` (renderSnake.ts) -- untouched by this fix.
      const lagDurationMsLocal = (stepIndex: number, stepLag: number, frameTimeMs: number): number => {
        const startIndex = stepIndex - stepLag;
        if (startIndex >= 0) {
          const endMs = absoluteTimesMs[stepIndex] ?? 0;
          return endMs - absoluteTimesMs[startIndex]!;
        }
        const growthProgress = stepLag > 0 ? stepIndex / stepLag : 1;
        return frameTimeMs * growthProgress;
      };

      // Pre-fix `headPositionAtTime` (renderSnake.ts): binary-search + lerp
      // directly in (x,y) space.
      const legacyHeadPositionAtTime = (timeMs: number): Point => {
        const times = headTimelineTimesMs;
        const positions = extendedHeadPositions;
        const lastIndex = times.length - 1;
        const clampedTime = Math.min(Math.max(timeMs, times[0]!), times[lastIndex]!);
        let low = 0;
        let high = lastIndex;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (times[mid]! < clampedTime) low = mid + 1;
          else high = mid;
        }
        if (low === 0 || times[low] === clampedTime) return positions[low]!;
        const beforeTime = times[low - 1]!;
        const afterTime = times[low]!;
        const before = positions[low - 1]!;
        const after = positions[low]!;
        const span = afterTime - beforeTime;
        const progress = span > 0 ? (clampedTime - beforeTime) / span : 0;
        return { x: before.x + (after.x - before.x) * progress, y: before.y + (after.y - before.y) * progress };
      };

      // Pre-fix `clampToMaxSpeed` (renderSnake.ts, before this fix) -- the
      // actual bug: moves in a straight Euclidean line toward the ideal
      // (x,y) target, with no awareness of the grid the head's route
      // actually followed.
      const legacyClampToMaxSpeed = (positions: readonly Point[], maxDistancePx: number): Point[] => {
        if (positions.length === 0) return [];
        const result: Point[] = [positions[0]!];
        for (let i = 1; i < positions.length; i += 1) {
          const previous = result[i - 1]!;
          const ideal = positions[i]!;
          const d = distance(previous, ideal);
          if (d <= maxDistancePx) {
            result.push(ideal);
          } else {
            const scale = maxDistancePx / d;
            result.push({ x: previous.x + (ideal.x - previous.x) * scale, y: previous.y + (ideal.y - previous.y) * scale });
          }
        }
        return result;
      };

      const stepLag = 1;
      const idealPositions = hopFrames.map((frame) => {
        const lagMs = lagDurationMsLocal(frame.stepIndex, stepLag, frame.timeMs);
        return legacyHeadPositionAtTime(frame.timeMs - lagMs);
      });
      const legacyPositions = legacyClampToMaxSpeed(idealPositions, maxHeadHopDistancePx);

      const offPathPositions = legacyPositions.filter((p) => !isOnHeadPolyline(p, extendedHeadPositions));
      const worstOffset = offPathPositions.length > 0
        ? Math.max(
            ...offPathPositions.map((p) =>
              Math.min(
                ...extendedHeadPositions
                  .slice(1)
                  .map((_, i) => {
                    const a = extendedHeadPositions[i]!;
                    const b = extendedHeadPositions[i + 1]!;
                    const abx = b.x - a.x;
                    const aby = b.y - a.y;
                    const segLenSq = abx * abx + aby * aby;
                    if (segLenSq === 0) return distance(p, a);
                    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / segLenSq));
                    return distance(p, { x: a.x + abx * t, y: a.y + aby * t });
                  }),
              ),
            ),
          )
        : 0;

      // The pre-fix Euclidean clamp really did cut across the grid on this
      // exact fixture: at least one rendered frame lands measurably off the
      // head's own polyline, confirming the new on-path test above is a
      // meaningful regression guard against the reported bug, not a
      // tautology that would pass against any implementation.
      expect(offPathPositions.length).toBeGreaterThan(0);
      expect(worstOffset).toBeGreaterThan(1);
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

  describe("body positions are well-formed and speed-bounded", () => {
    // Body segments are drawn at a fixed arc-length offset behind the head
    // along the head's own path (see `segmentPositions` in renderSnake.ts),
    // so they are monotonic and speed-bounded by construction. This block
    // pins down the remaining well-formedness guarantee: no NaN/undefined/
    // non-finite positions ever, even for segments with more lag than the
    // loop has history for.

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
  });

  describe("growth-phase lag blending (frozen-tail fix on sparse-then-dense grids)", () => {
    // Mirrors a real GitHub calendar where the year opens sparse (a few
    // far-apart contributions, i.e. long jumps) before settling into a dense
    // run. `bodyLength` is chosen so the last segment's growth phase
    // (stepIndex 0..stepLag-1) spans exactly the three sparse jumps below,
    // which is precisely the shape that used to freeze: with the old
    // "clamp startMs to 0" formula, a body segment with stepIndex < stepLag
    // had its lag equal to *all* elapsed time since the loop began, pinning
    // its target to the start cell for the whole sparse region.
    const sparseHopCounts = [25, 30, 22];
    const denseStepCount = 20;
    const stepLag = sparseHopCounts.length; // 3: growth phase == exactly the sparse jumps

    function buildSparseThenDenseSteps(): SnakePathStep[] {
      const steps: SnakePathStep[] = [jumpStep([[0, 0]])];
      let week = 0;
      for (const hopCount of sparseHopCounts) {
        const path: Array<[number, number]> = [];
        for (let hop = 0; hop <= hopCount; hop += 1) path.push([week + hop, 0]);
        week += hopCount;
        steps.push(jumpStep(path));
      }
      for (let i = 1; i <= denseStepCount; i += 1) {
        const fromDay = (i - 1) % 7;
        const toDay = i % 7;
        steps.push(jumpStep([[week, fromDay], [week, toDay]]));
      }
      return steps;
    }

    function distance(a: Point, b: Point): number {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    /** Longest run of consecutive identical positions within `positions`. */
    function longestStaticRun(positions: readonly Point[]): number {
      let longest = 1;
      let current = 1;
      for (let i = 1; i < positions.length; i += 1) {
        if (positions[i]!.x === positions[i - 1]!.x && positions[i]!.y === positions[i - 1]!.y) {
          current += 1;
          longest = Math.max(longest, current);
        } else {
          current = 1;
        }
      }
      return longest;
    }

    it("does not freeze the growing body segment at the start cell through the whole sparse region", () => {
      const steps = buildSparseThenDenseSteps();
      const bodyLength = stepLag;
      const svg = renderSnake(steps, bodyLength);

      const boundaryFrame = stepBoundaryFrameIndices(steps);
      // Every hop-frame belonging to step indices [0, stepLag) is the
      // segment's growth phase -- i.e. everything up to (and including)
      // the last hop of step `stepLag - 1`.
      const growthEndFrame = boundaryFrame[stepLag - 1]!;

      const segment = stepLag - 1; // the last body segment: full growth phase == the 3 sparse jumps
      const positions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);
      const headPositions = parseNodePositions(svg, "wolverine-snake-head");

      const growthPositions = positions.slice(0, growthEndFrame + 1);
      const staticRun = longestStaticRun(growthPositions);

      // Before the fix, the segment sat frozen at the start cell for
      // essentially the entire sparse region (tens of consecutive frames,
      // one per hop of the two ~25-30-hop jumps). With the fixed arc-length
      // spacing model it only rests at the start for the handful of opening
      // hops it takes the head to travel one segment-offset's worth of path,
      // then advances on essentially every hop after that.
      expect(staticRun).toBeLessThan(6);
      expect(growthPositions.length).toBeGreaterThan(40); // sanity: the sparse region really does span this many hop-frames

      // The segment should also track reasonably close to the head
      // throughout the growth phase, rather than being pinned to the
      // start cell (far away from wherever the head currently is).
      const startCell = positions[0]!;
      let framesPinnedToStart = 0;
      for (let i = 1; i <= growthEndFrame; i += 1) {
        if (positions[i]!.x === startCell.x && positions[i]!.y === startCell.y) framesPinnedToStart += 1;
        const distToHead = distance(positions[i]!, headPositions[i]!);
        const distStartToHead = distance(startCell, headPositions[i]!);
        // The segment must never be *farther* from the head than the
        // frozen start cell itself would be -- i.e. it's always at least
        // as "grown in" as the old broken behavior, generally much closer.
        expect(distToHead).toBeLessThanOrEqual(distStartToHead + 1e-9);
      }
      // At most a handful of early frames (near stepIndex 0, where the lag
      // is genuinely still ~0) may legitimately coincide with the start
      // cell -- it must not be the whole sparse region.
      expect(framesPinnedToStart).toBeLessThan(growthEndFrame * 0.5);
    });

    it("keeps the stepIndex === stepLag handoff continuous (no discontinuity beyond the head's own speed cap)", () => {
      const steps = buildSparseThenDenseSteps();
      const bodyLength = stepLag;
      const svg = renderSnake(steps, bodyLength);

      const frameTimesMs = frameTimesMsOf(svg);
      const headPositions = parseNodePositions(svg, "wolverine-snake-head");
      const headMaxSpeed = maxSpeedPxPerMs(headPositions, frameTimesMs);
      expect(headMaxSpeed).toBeGreaterThan(0);

      const segment = stepLag - 1;
      const bodyPositions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);

      const boundaryFrame = stepBoundaryFrameIndices(steps);
      // Last hop-frame of step (stepLag - 1) -- still in the growth branch
      // (stepIndex === stepLag - 1 < stepLag) -- immediately followed by
      // the first hop-frame of step stepLag, where `lagDurationMs` switches
      // over to the exact (already-validated) steady-state formula.
      const lastGrowthFrame = boundaryFrame[stepLag - 1]!;
      const firstExactFrame = lastGrowthFrame + 1;

      const before = bodyPositions[lastGrowthFrame]!;
      const after = bodyPositions[firstExactFrame]!;
      const dt = frameTimesMs[firstExactFrame]! - frameTimesMs[lastGrowthFrame]!;
      const jumpDistancePx = distance(before, after);
      const impliedSpeed = dt > 0 ? jumpDistancePx / dt : 0;

      const tolerance = 1e-9;
      expect(impliedSpeed).toBeLessThanOrEqual(headMaxSpeed + tolerance);
    });

    it("coincides every body segment with the head's own start position at stepIndex 0", () => {
      const steps = buildSparseThenDenseSteps();
      const bodyLength = 6;
      const svg = renderSnake(steps, bodyLength);

      const headPositions = parseNodePositions(svg, "wolverine-snake-head");
      for (let segment = 0; segment < bodyLength; segment += 1) {
        const bodyPositions = parseNodePositions(svg, `wolverine-snake-body-${segment}`);
        expect(bodyPositions[0]).toEqual(headPositions[0]);
      }
    });
  });
});
