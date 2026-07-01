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

export function buildLoopTimeline(
  stepCount: number,
  stepDurationMs: number,
  loopResetPauseMs: number,
): LoopTimeline {
  const absoluteTimesMs: number[] = [];
  for (let step = 0; step < stepCount; step += 1) {
    absoluteTimesMs.push(step * stepDurationMs);
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
