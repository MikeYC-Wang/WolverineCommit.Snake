import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";

/**
 * Shared SMIL timeline math used by both renderSnake and renderEventBubble so
 * their `<animate>` elements stay in lockstep: every animated element in the
 * document uses the *same* `dur` and `repeatCount="indefinite"`, differing
 * only in their own `values`/`keyTimes`. That keeps everything perfectly
 * synchronized without needing SMIL's more fragile syncbase (`id.begin+…`)
 * references.
 */

export interface LoopTimeline {
  /** Absolute time (ms) of each step, plus one trailing "hold" frame for the loop-reset pause. */
  readonly absoluteTimesMs: readonly number[];
  /** `absoluteTimesMs` normalized to the [0, 1] range expected by SMIL `keyTimes`. */
  readonly keyTimes: readonly number[];
  /** Total duration of one full loop, including the trailing pause, in milliseconds. */
  readonly totalDurationMs: number;
}

/**
 * Per-step travel duration in ms, proportional to how many grid-adjacent
 * hops that step's actual route spans (`SnakePathStep.waypoints`), instead of
 * a single flat duration for every step. Without this, a 1-cell move and a
 * 20-cell jump animated in the same fixed window, which read as the snake
 * "teleporting" across long jumps (see project report). Index 0 is the
 * starting position -- there is no previous head to travel from, so it
 * always costs 0ms.
 */
export function computeStepDurationsMs(
  steps: readonly SnakePathStep[],
  baseStepDurationMs: number,
): number[] {
  return steps.map((step, index) => {
    if (index === 0) return 0;
    const hopCount = Math.max(1, step.waypoints.length - 1);
    return baseStepDurationMs * hopCount;
  });
}

/**
 * Builds the shared loop timeline from each step's own travel duration
 * (see {@link computeStepDurationsMs}) rather than a single flat
 * per-step duration, so steps that cover more ground get proportionally
 * more of the timeline instead of all steps racing across in equal time.
 */
export function buildLoopTimeline(
  stepDurationsMs: readonly number[],
  loopResetPauseMs: number,
): LoopTimeline {
  const absoluteTimesMs: number[] = [];
  let cumulativeMs = 0;
  for (const durationMs of stepDurationsMs) {
    cumulativeMs += durationMs;
    absoluteTimesMs.push(cumulativeMs);
  }
  const lastMoveTimeMs = absoluteTimesMs.at(-1) ?? 0;
  const pauseEndTimeMs = lastMoveTimeMs + loopResetPauseMs;
  absoluteTimesMs.push(pauseEndTimeMs); // extra "hold" frame during the reset pause

  const totalDurationMs = pauseEndTimeMs > 0 ? pauseEndTimeMs : 1;
  const keyTimes = absoluteTimesMs.map((t) => t / totalDurationMs);
  keyTimes[keyTimes.length - 1] = 1; // guard against floating point drift

  return { absoluteTimesMs, keyTimes, totalDurationMs };
}

/**
 * Unwraps a sequence of angles (degrees) so consecutive values never differ
 * by more than 180 degrees, which keeps SMIL's linear rotate interpolation
 * turning the visually "short way" instead of spinning the long way around
 * whenever the raw atan2 angle crosses the +/-180 boundary.
 */
export function unwrapAngles(anglesDeg: readonly number[]): number[] {
  if (anglesDeg.length === 0) return [];
  const unwrapped: number[] = [anglesDeg[0]!];
  for (let i = 1; i < anglesDeg.length; i += 1) {
    const previous = unwrapped[i - 1]!;
    let current = anglesDeg[i]!;
    while (current - previous > 180) current -= 360;
    while (current - previous < -180) current += 360;
    unwrapped.push(current);
  }
  return unwrapped;
}
