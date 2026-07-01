import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { buildLoopTimeline, computeStepDurationsMs, unwrapAngles } from "./timeline.js";

function step(waypointCount: number, overrides: Partial<SnakePathStep> = {}): SnakePathStep {
  const waypoints = Array.from({ length: waypointCount }, (_, i) => ({ weekIndex: i, dayIndex: 0 }));
  return {
    cell: waypoints.at(-1)!,
    waypoints,
    isJump: waypointCount > 2,
    ateContribution: true,
    isLoopComplete: false,
    ...overrides,
  };
}

describe("computeStepDurationsMs", () => {
  it("costs step 0 (the starting cell) nothing, regardless of its own waypoints", () => {
    const steps = [step(1), step(2)];
    expect(computeStepDurationsMs(steps, 200)[0]).toBe(0);
  });

  it("prices an adjacent single-cell step (2 waypoints, 1 hop) at exactly the base duration", () => {
    const steps = [step(1), step(2)];
    expect(computeStepDurationsMs(steps, 200)).toEqual([0, 200]);
  });

  it("prices a multi-waypoint jump proportionally to its hop count", () => {
    // 5 waypoints = 4 grid-adjacent hops.
    const steps = [step(1), step(5)];
    expect(computeStepDurationsMs(steps, 200)).toEqual([0, 800]);
  });

  it("never produces a zero-duration travel step even if waypoints is degenerately short", () => {
    const steps = [step(1), step(1)];
    expect(computeStepDurationsMs(steps, 200)[1]).toBe(200);
  });
});

describe("buildLoopTimeline", () => {
  it("accumulates absolute times from per-step durations and appends a trailing pause hold frame", () => {
    const timeline = buildLoopTimeline([0, 200, 800], 1500);
    expect(timeline.absoluteTimesMs).toEqual([0, 200, 1000, 2500]);
    expect(timeline.totalDurationMs).toBe(2500);
    expect(timeline.keyTimes.at(-1)).toBe(1);
  });

  it("scales total duration correctly for a mix of adjacent and jump steps vs. all-adjacent steps", () => {
    const allAdjacentDurations = computeStepDurationsMs([step(1), step(2), step(2)], 200);
    const withOneJumpDurations = computeStepDurationsMs([step(1), step(2), step(5)], 200);

    const allAdjacentTimeline = buildLoopTimeline(allAdjacentDurations, 1500);
    const withJumpTimeline = buildLoopTimeline(withOneJumpDurations, 1500);

    // The jump variant replaces a 1-hop (200ms) step with a 4-hop (800ms) step,
    // a difference of exactly 3 base-step-durations (600ms), and nothing else changes.
    expect(withJumpTimeline.totalDurationMs - allAdjacentTimeline.totalDurationMs).toBe(600);
  });

  it("keeps keyTimes strictly increasing and normalized to [0, 1]", () => {
    const durations = computeStepDurationsMs([step(1), step(2), step(6)], 200);
    const timeline = buildLoopTimeline(durations, 1500);

    for (let i = 1; i < timeline.keyTimes.length; i += 1) {
      expect(timeline.keyTimes[i]!).toBeGreaterThan(timeline.keyTimes[i - 1]!);
    }
    expect(timeline.keyTimes[0]).toBe(0);
    expect(timeline.keyTimes.at(-1)).toBe(1);
  });
});

describe("unwrapAngles", () => {
  it("returns an empty array for an empty input", () => {
    expect(unwrapAngles([])).toEqual([]);
  });

  it("keeps consecutive angles within 180 degrees of each other", () => {
    const unwrapped = unwrapAngles([170, -170, 170]);
    for (let i = 1; i < unwrapped.length; i += 1) {
      expect(Math.abs(unwrapped[i]! - unwrapped[i - 1]!)).toBeLessThanOrEqual(180);
    }
  });
});
