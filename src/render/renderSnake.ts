import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { cellCenter } from "./layout.js";
import {
  ANIMATION_TIMING,
  SNAKE_BODY_CONNECTOR_COLOR,
  SNAKE_BODY_CONNECTOR_OPACITY,
  SNAKE_BODY_FILL,
  SNAKE_HEAD_BORDER,
  SNAKE_HEAD_FILL,
} from "./theme.js";
import { buildLoopTimeline, computeStepDurationsMs, unwrapAngles } from "./timeline.js";

const HEAD_SIZE_PX = 9;
const HEAD_CORNER_RADIUS_PX = 2;
const BODY_SIZE_PX = 6;
const BODY_CORNER_RADIUS_PX = 1.5;

/** Small triangular arrow, pointing "right" (0deg) by default, rotated per-frame to face the direction of travel. */
const ARROW_PATH = "M 3.5 0 L -1.5 -2.5 L -1.5 2.5 Z";

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * One sub-frame of the head's travel within a step's own route. `stepIndex`
 * identifies which `SnakePathStep` this hop belongs to; `hopIndex`/`hopCount`
 * locate it within that step's `waypoints` (hop 0 is the step's starting
 * cell, hop `hopCount` is its destination cell). Exposing this per-hop
 * structure (rather than one frame per step) is what lets the head, body
 * segments, and connectors all move through/near intermediate empty cells
 * instead of cutting a straight line to the final destination.
 */
interface HopFrame {
  readonly timeMs: number;
  readonly stepIndex: number;
  readonly hopIndex: number;
  readonly hopCount: number;
}

function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function angleBetween(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function animateAttribute(
  attributeName: string,
  values: readonly string[],
  keyTimes: readonly number[],
  totalDurationMs: number,
): string {
  return (
    `<animate attributeName="${attributeName}" values="${values.join(";")}" ` +
    `keyTimes="${keyTimes.join(";")}" dur="${totalDurationMs}ms" ` +
    `repeatCount="indefinite" calcMode="linear"/>`
  );
}

function translateAnimation(positions: readonly Point[], keyTimes: readonly number[], totalDurationMs: number): string {
  const values = positions.map((p) => `${p.x},${p.y}`);
  return (
    `<animateTransform attributeName="transform" type="translate" values="${values.join(";")}" ` +
    `keyTimes="${keyTimes.join(";")}" dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear"/>`
  );
}

function rotateAnimation(anglesDeg: readonly number[], keyTimes: readonly number[], totalDurationMs: number): string {
  const values = anglesDeg.map((a) => `${a.toFixed(1)}`);
  return (
    `<animateTransform attributeName="transform" type="rotate" values="${values.join(";")}" ` +
    `keyTimes="${keyTimes.join(";")}" dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear"/>`
  );
}

/**
 * Expands `steps` into one sub-frame per grid-adjacent hop along each step's
 * `waypoints` route (see solveSnakePath.ts), instead of one frame per step.
 * Every hop is budgeted exactly `baseStepDurationMs` -- the same per-hop
 * price `computeStepDurationsMs` uses to size the shared timeline -- so a
 * 1-cell step and a 20-cell jump both move across the board at the same
 * on-screen speed, and a jump visibly passes through its intermediate empty
 * cells instead of cutting a straight line across the board in a fixed
 * 200ms window (see project report, "the snake teleports"). Step 0 (the
 * starting cell) has no previous head to travel from, so it contributes a
 * single zero-duration frame.
 */
function buildHopFrames(
  steps: readonly SnakePathStep[],
  absoluteTimesMs: readonly number[],
  baseStepDurationMs: number,
): HopFrame[] {
  const frames: HopFrame[] = [{ timeMs: 0, stepIndex: 0, hopIndex: 0, hopCount: 0 }];
  for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex]!;
    const hopCount = Math.max(1, step.waypoints.length - 1);
    const stepStartMs = absoluteTimesMs[stepIndex - 1]!;
    for (let hopIndex = 1; hopIndex <= hopCount; hopIndex += 1) {
      frames.push({ timeMs: stepStartMs + hopIndex * baseStepDurationMs, stepIndex, hopIndex, hopCount });
    }
  }
  return frames;
}

/** Cell-center position at a given (stepIndex, hopIndex) into that step's own `waypoints`. */
function waypointPosition(steps: readonly SnakePathStep[], stepIndex: number, hopIndex: number): Point {
  const step = steps[stepIndex]!;
  const waypointIndex = Math.min(hopIndex, step.waypoints.length - 1);
  return cellCenter(step.waypoints[waypointIndex]!);
}

/**
 * Real elapsed duration (ms) of the `stepLag` steps immediately preceding
 * (and including) `stepIndex`, i.e. the amount of real time the head spent
 * covering the same ground a `stepLag`-behind body segment must eventually
 * retrace. `frameTimeMs` is the hop-frame's own absolute time (always
 * `<= absoluteTimesMs[stepIndex]`), needed for the growth-phase blend below.
 *
 * Once `stepIndex >= stepLag` there's a real, exact answer: the timestamp
 * `stepLag` steps back genuinely exists in `absoluteTimesMs`, so this is
 * just `endMs - startMs`.
 *
 * Before that (`stepIndex < stepLag`), this segment hasn't accumulated
 * `stepLag` steps of real history yet -- it's still in its "growth phase",
 * the classic snake-starts-short-and-grows-as-it-eats look. The naive fix
 * (clamping the missing `startMs` to `0`, i.e. "step -1 happened at the very
 * start of the loop") makes the lag equal to *all* elapsed time since the
 * loop began, which pins this segment's target to the loop's start cell for
 * its *entire* growth phase. On a real GitHub grid where the year opens
 * sparse, the first `stepLag` eaten cells can be spread across a huge span
 * of the board -- i.e. a huge span of real time -- so that growth phase
 * isn't a quick blip, it's a long, visibly frozen dashed tail (see project
 * report).
 *
 * The fix blends the lag itself from `0` at `stepIndex === 0` (where the
 * segment must exactly coincide with the head -- the whole snake really is
 * a single point at the very top of the loop) up towards a fraction of its
 * full value by the time growth completes, using
 * `lag = frameTimeMs^2 / (2 * referenceMs)`, where `referenceMs` is the
 * absolute time at which this segment's growth phase ends (`stepIndex ===
 * stepLag`) -- i.e. `lag` grows *quadratically*, not linearly, in
 * `frameTimeMs`.
 *
 * That specific shape is what makes the resulting *target* time
 * (`frameTimeMs - lag`, what `headArcLengthAtTime`/`headPositionAtTime`
 * actually samples) provably monotonic non-decreasing across the *entire*
 * growth phase -- including across step boundaries, where an earlier version
 * of this blend (scaling linearly by `stepIndex / stepLag`, re-evaluated
 * fresh at each step's own elapsed time) could dip backward: that version
 * kept the lag safely below `frameTimeMs` *within* a step, but the fraction
 * itself jumped upward at each new step's very first hop while `frameTimeMs`
 * had barely advanced, so the lag could jump up *faster* than real time was
 * passing, pulling the target backward for a stretch. Since this fix went in
 * (see arc-length reparameterization commit), the rendered arc-length is
 * *never* allowed to decrease (see `clampArcLengthToMaxSpeed`), so a
 * backward-dipping target no longer just nudges the position back slightly
 * -- it freezes the segment in place until real time catches back up past
 * the dip, reintroducing a real (if shorter-lived) version of the frozen-tail
 * bug this whole function exists to prevent.
 *
 * The quadratic instead guarantees `d(target)/d(frameTimeMs) = 1 -
 * frameTimeMs/referenceMs > 0` for every `frameTimeMs` in the growth phase
 * (which by definition never reaches `referenceMs`), with no special-casing
 * needed at step boundaries: the formula depends only on the frame's own
 * absolute time, not on which step it belongs to, so there's nothing to
 * jump. At `stepIndex === 0`, `frameTimeMs` is `0`, so the lag is `0`
 * regardless -- matching the required "segment coincides with head" state at
 * the very top of the loop. `referenceMs` itself is read from
 * `absoluteTimesMs[stepLag]` where available; if `stepLag` reaches past the
 * end of the loop (more body segments than steps -- see the "more lag than
 * history" test), it falls back to the loop's own total duration, which
 * keeps the growth phase (and thus this formula) in effect for the entire
 * loop, exactly as intended for a segment that never accumulates `stepLag`
 * steps of real history within one loop iteration.
 */
function lagDurationMs(
  absoluteTimesMs: readonly number[],
  stepIndex: number,
  stepLag: number,
  frameTimeMs: number,
): number {
  const startIndex = stepIndex - stepLag;
  if (startIndex >= 0) {
    const endMs = absoluteTimesMs[stepIndex] ?? 0;
    return endMs - absoluteTimesMs[startIndex]!;
  }

  const referenceMs = absoluteTimesMs[stepLag] ?? absoluteTimesMs.at(-1) ?? 0;
  if (referenceMs <= 0) return 0;
  const growthProgress = frameTimeMs / (2 * referenceMs);
  return frameTimeMs * growthProgress;
}

/**
 * Generic keyframe lookup: given a monotonic non-decreasing `keys` array
 * (e.g. absolute times, or cumulative arc-length) and a parallel `values`
 * array, binary-searches for the bounding pair of keyframes surrounding
 * `key` and linearly interpolates between their values in proportion to how
 * far `key` falls between the two bounding keys. `key` outside the array's
 * range clamps to the nearest end, so a lookup before the loop even started
 * (or past its very end) resolves to the start/end value instead of
 * extrapolating.
 *
 * Every keyframe lookup in this module -- time -> position, time ->
 * arc-length, and arc-length -> position -- is structurally this same
 * search-and-lerp operation over a different pair of parallel arrays, so
 * they all share this one implementation (see `headPositionAtTime`,
 * `headArcLengthAtTime`, `headPositionAtArcLength` below).
 */
function interpolateAlongKeyframes<T>(
  keys: readonly number[],
  values: readonly T[],
  key: number,
  lerp: (before: T, after: T, progress: number) => T,
): T {
  const lastIndex = keys.length - 1;
  const clampedKey = Math.min(Math.max(key, keys[0]!), keys[lastIndex]!);

  let low = 0;
  let high = lastIndex;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (keys[mid]! < clampedKey) low = mid + 1;
    else high = mid;
  }
  if (low === 0 || keys[low] === clampedKey) return values[low]!;

  const beforeKey = keys[low - 1]!;
  const afterKey = keys[low]!;
  const before = values[low - 1]!;
  const after = values[low]!;
  const span = afterKey - beforeKey;
  const progress = span > 0 ? (clampedKey - beforeKey) / span : 0;
  return lerp(before, after, progress);
}

function lerpPoint(before: Point, after: Point, progress: number): Point {
  return {
    x: before.x + (after.x - before.x) * progress,
    y: before.y + (after.y - before.y) * progress,
  };
}

function lerpNumber(before: number, after: number, progress: number): number {
  return before + (after - before) * progress;
}

/**
 * Linearly interpolates the head's own position at an arbitrary absolute
 * `timeMs`, given the head's full (monotonic) hop-keyframe timeline. `timeMs`
 * before the first keyframe (i.e. before the loop even started) clamps to
 * the start position, which is exactly the "not enough history yet" case at
 * the top of a loop.
 */
function headPositionAtTime(times: readonly number[], positions: readonly Point[], timeMs: number): Point {
  return interpolateAlongKeyframes(times, positions, timeMs, lerpPoint);
}

/**
 * Linearly interpolates the head's own *cumulative arc-length* (how far
 * along its own path it has traveled, in px -- see `buildCumulativeArcLength`)
 * at an arbitrary absolute `timeMs`. This is the arc-length twin of
 * `headPositionAtTime`, used so a lagged body segment's "ideal target" can be
 * expressed as a 1D distance-along-path instead of a raw (x,y) point (see
 * module docs on `laggedPositions` for why that distinction is the whole
 * point of this fix).
 */
function headArcLengthAtTime(times: readonly number[], arcLengths: readonly number[], timeMs: number): number {
  return interpolateAlongKeyframes(times, arcLengths, timeMs, lerpNumber);
}

/**
 * Inverse of `buildCumulativeArcLength`: given a target arc-length `s`
 * (a distance traveled along the head's own path, in px), finds the pair of
 * consecutive head keyframes whose cumulative arc-length brackets `s` and
 * linearly interpolates the (x,y) position between them, proportional to how
 * far `s` falls between their arc-length values. Because the interpolation is
 * always between two *consecutive* keyframes on the head's actual route,
 * every value this can return lies exactly on one of the head's own traveled
 * segments -- never a Euclidean shortcut through cells the head's route never
 * touched. `s` outside `[0, totalArcLength]` clamps to the start/end position.
 */
function headPositionAtArcLength(arcLengths: readonly number[], positions: readonly Point[], targetArcLength: number): Point {
  return interpolateAlongKeyframes(arcLengths, positions, targetArcLength, lerpPoint);
}

/** Straight-line distance between two points. */
function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Cumulative distance traveled (px), one entry per head keyframe, parallel to
 * `positions` -- `arcLength[0]` is `0`, `arcLength[i]` is the total
 * straight-line distance covered walking
 * `positions[0] -> positions[1] -> ... -> positions[i]`. This is the "1D
 * odometer reading" for the head's own path: any value in
 * `[0, arcLength.at(-1)]` maps, via `headPositionAtArcLength`, to a point that
 * lies exactly on one of the head's own traveled segments.
 */
function buildCumulativeArcLength(positions: readonly Point[]): number[] {
  const arcLengths: number[] = [0];
  for (let i = 1; i < positions.length; i += 1) {
    arcLengths.push(arcLengths[i - 1]! + distanceBetween(positions[i - 1]!, positions[i]!));
  }
  return arcLengths;
}

/**
 * The head's own worst per-frame travel distance (px), used as the hard
 * speed ceiling every body segment/connector endpoint must respect (see
 * module docs on `laggedPositions`). Every hop the head takes lands on an
 * orthogonally-adjacent grid cell, but horizontal and vertical cell strides
 * can differ, so this is measured empirically off the head's own keyframes
 * rather than assumed to be a single constant.
 */
function maxConsecutiveDistance(positions: readonly Point[]): number {
  let max = 0;
  for (let i = 1; i < positions.length; i += 1) {
    max = Math.max(max, distanceBetween(positions[i - 1]!, positions[i]!));
  }
  return max;
}

/**
 * Caps each frame-to-frame *advance in arc-length* (how far a body segment is
 * currently drawn along the head's own path, see `buildCumulativeArcLength`)
 * to at most `maxAdvancePerFramePx`, and never lets the rendered arc-length
 * decrease -- a trailing segment can't move backward along the path it's
 * chasing. Any distance this trims off is made up as fast as the speed cap
 * allows on subsequent frames, since the ideal arc-length target keeps
 * advancing independently of how far behind the clamped trail currently sits.
 *
 * This replaces an earlier version of this clamp that operated on raw (x,y)
 * positions, moving in a straight Euclidean line toward the ideal target
 * whenever it was farther than `maxDistancePx` away. That straight line was
 * not constrained to the grid at all: it could (and, per the reported bug,
 * visibly did) cut diagonally across cells the head's actual route never
 * touched, especially while "catching up" after a long jump -- exactly when
 * this clamp engages most. Clamping the *arc-length* scalar instead means
 * every intermediate value, once converted back to (x,y) via
 * `headPositionAtArcLength`, is guaranteed to fall exactly on the head's own
 * polyline path: catching up now means walking the same route faster, never
 * shortcutting across unrelated grid space.
 *
 * ## Design decision: bounded-speed "chase" motion, not exact-boundary alignment
 *
 * A hard speed cap and "body segment k sits exactly on the cell the head
 * occupied k steps ago, at *every* step boundary" are mathematically
 * incompatible whenever a long jump is immediately followed by an
 * arbitrarily short step: the short step's real-time budget can be smaller
 * than what covering the jump-sized gap at the head's own top speed would
 * require, so there is provably not enough time to be both exactly-on-target
 * and speed-capped at that boundary. QA proved this isn't a rare edge case --
 * a minimal 3-step repro (a 10-hop jump followed by a 1-hop step, bodyLength
 * 1) lands segment 0 up to 126px (9 grid cells) away from the "exact
 * k-steps-ago" position, and sampling that same invariant across a realistic
 * 53x7/296-step fixture found mismatches at 169/430 (39%) of sampled step
 * boundaries across lags 1-10. A repeating long-jump/short-step pattern with
 * no recovery slack between cycles was also shown to *not* self-correct: the
 * same offset recurs identically cycle over cycle. (These findings were made
 * against the raw-(x,y) version of this clamp, but the same real-time
 * argument applies verbatim to the arc-length version: the amount of *path
 * distance* to cover doesn't change, only how the catch-up motion is drawn.)
 *
 * The project owner's call, given that tension: relax the exact-boundary
 * requirement and render body segments as bounded-speed "chase" motion
 * instead -- the same organic, never-snapping trailing-segment look common
 * to follow-the-leader "snake" animations, rather than teleporting or
 * rigid-exact alignment. This only affects how body segments are *drawn*;
 * `solveSnakePath.ts`'s grid-based occupancy/self-collision model is exact in
 * its own abstract coordinate space and is untouched by this trade-off.
 *
 * What IS guaranteed instead (see the corresponding tests in
 * renderSnake.test.ts):
 *   1. Speed bound: no segment/connector endpoint ever exceeds the head's
 *      own fastest observed px/ms (this function).
 *   2. No NaN/undefined/backwards-time positions, ever -- including before a
 *      segment has enough history for a real lagged target yet (see
 *      `headPositionAtTime`'s clamping).
 *   3. Convergence under slack: whenever a segment falls behind and the
 *      steps that follow don't immediately demand another hard catch-up, the
 *      gap to its ideal (unclamped) time-shifted target shrinks frame over
 *      frame until it's fully resynced.
 *   4. Bounded worst case: even under a pathological repeating hard
 *      jump/short-step pattern with *no* recovery slack at all, the
 *      steady-state error stays bounded rather than growing cycle over
 *      cycle -- it settles into a stable offset, not a divergence.
 *   5. On-path: every rendered position lies exactly on one of the head's own
 *      traveled path segments (this function operates on arc-length, and the
 *      final (x,y) is always produced via `headPositionAtArcLength`).
 * What is explicitly NOT guaranteed: exact pixel/cell alignment at every
 * single step boundary under adversarial (mismatched-hop-count) adjacent
 * steps.
 */
function clampArcLengthToMaxSpeed(idealArcLengths: readonly number[], maxAdvancePerFramePx: number): number[] {
  if (idealArcLengths.length === 0) return [];
  const result: number[] = [idealArcLengths[0]!];
  for (let i = 1; i < idealArcLengths.length; i += 1) {
    const previous = result[i - 1]!;
    const ideal = idealArcLengths[i]!;
    const capped = Math.min(ideal, previous + maxAdvancePerFramePx);
    result.push(Math.max(previous, capped)); // monotonic: never walk backward along the path
  }
  return result;
}

/**
 * Renders the animated snake: a head (Command, with a rotating direction
 * arrow) trailed by `bodyLength` body nodes (message-bus segments), connected
 * by dashed connector lines. Movement between contributed cells is tweened
 * smoothly (see visual-design.md 2.3) rather than following grid lines, which
 * is why every node's position is driven by a single SMIL `translate`
 * animation interpolating through each step's waypoint route rather than
 * jumping directly between cell centers.
 */
export function renderSnake(steps: readonly SnakePathStep[], bodyLength: number): string {
  if (steps.length === 0) return "";

  const { stepDurationMs, loopResetPauseMs } = ANIMATION_TIMING;
  const stepDurationsMs = computeStepDurationsMs(steps, stepDurationMs);
  const { absoluteTimesMs, totalDurationMs } = buildLoopTimeline(stepDurationsMs, loopResetPauseMs);

  const hopFrames = buildHopFrames(steps, absoluteTimesMs, stepDurationMs);
  const keyTimes = [...hopFrames.map((frame) => frame.timeMs), totalDurationMs].map((t) => t / totalDurationMs);
  keyTimes[keyTimes.length - 1] = 1; // guard against floating point drift

  const headPositions = hopFrames.map((frame) => waypointPosition(steps, frame.stepIndex, frame.hopIndex));
  const extendedHeadPositions = [...headPositions, headPositions.at(-1)!];

  const rawAngles = headPositions.map((position, index) => {
    const previous = headPositions[Math.max(0, index - 1)]!;
    return pointsEqual(previous, position) ? 0 : angleBetween(previous, position);
  });
  if (rawAngles.length > 0) rawAngles[0] = rawAngles[1] ?? 0;
  const headAngles = unwrapAngles(rawAngles);
  const extendedHeadAngles = [...headAngles, headAngles.at(-1) ?? 0];

  // The head's own continuous keyframe timeline: every hop frame's absolute
  // time paired with the head's position at that instant, plus the trailing
  // hold-frame time/position so time-shift lookups never fall outside the
  // range covered by `headPositionAtTime`.
  const headTimelineTimesMs = [...hopFrames.map((frame) => frame.timeMs), totalDurationMs];
  const maxHeadHopDistancePx = maxConsecutiveDistance(headPositions);

  // The head's own path expressed as a 1D "odometer reading" (px traveled)
  // parallel to `extendedHeadPositions`/`headTimelineTimesMs`. Every body
  // segment's position is derived by walking *this* array rather than ever
  // computing a raw (x,y) target directly, which is what guarantees a
  // clamped/catching-up segment stays exactly on the head's own route (see
  // `clampArcLengthToMaxSpeed` and `headPositionAtArcLength`).
  const headCumulativeArcLength = buildCumulativeArcLength(extendedHeadPositions);

  /**
   * Position sequence of the body segment trailing `stepLag` *steps* (not
   * hops) behind the head -- matching solveSnakePath's actual body-occupancy
   * model, where each segment sits on a previously-*eaten* cell rather than a
   * mid-route waypoint. Rather than replaying the shifted step's own
   * waypoints at the current step's fractional hop-progress (the old
   * approach, which desyncs badly whenever the shifted and current steps
   * have very different hop counts -- see project report, "the snake body
   * snaps/teleports"), this reads the segment's *ideal arc-length* directly
   * off the head's own trajectory at (this frame's time minus the real
   * duration of the `stepLag` most recent steps) -- an exact, undistorted
   * echo of how far along its own path the head had traveled at that instant,
   * just shifted later in time.
   *
   * The position actually rendered is not that ideal target directly, but
   * `clampArcLengthToMaxSpeed`'s output converted back to (x,y) via
   * `headPositionAtArcLength`. `clampArcLengthToMaxSpeed` caps the segment's
   * per-frame arc-length advance whenever the ideal time-shifted target would
   * itself require covering more path distance than the head's worst single
   * hop within one frame (e.g. a long jump immediately followed by a very
   * short step -- not a rare case; see the design-decision note on
   * `clampArcLengthToMaxSpeed` for how often this actually happens and
   * exactly what is and isn't guaranteed as a result). Because the clamp
   * operates on the arc-length scalar -- and gets converted back to (x,y)
   * only at the very end, via `headPositionAtArcLength` -- the "catching up"
   * motion is always *along the head's own route*, never a Euclidean
   * shortcut through cells the head's path never touched. The growth-phase
   * blend inside `lagDurationMs` (see its own doc comments) still governs how
   * much lag, in *time*, this segment has before it has accumulated
   * `stepLag` steps of real history; projecting that blended lag through
   * `headArcLengthAtTime` carries the same guarantees into arc-length space
   * for free -- at `stepIndex === 0` the lag is exactly `0`, so the ideal
   * arc-length target is exactly `0` (the head's own start position), and it
   * blends smoothly up to the full steady-state lag as `stepIndex` approaches
   * `stepLag`.
   */
  function laggedPositions(stepLag: number): Point[] {
    // `lagDurationMs`'s growth-phase blend scales its lag by *this step's*
    // elapsed time (see its own doc comments) rather than a running total,
    // which is what keeps it from ever reintroducing a multi-hop freeze
    // *within* a step -- but across a step *boundary*, `stepIndex` jumps to a
    // strictly larger value, shrinking the `(1 - stepIndex/stepLag)` factor
    // applied to a `frameTimeMs` that has only grown by one hop's worth. When
    // a step's own total duration is large (exactly the sparse-jump shape
    // this growth phase exists for), that shrink can outpace the growth,
    // making the *reference time* -- and so the arc-length read off it --
    // dip backward for a few frames right at the boundary. `headArcLengthAtTime`
    // (a monotonic function of time) would faithfully reproduce that dip, and
    // since the rendered arc-length is contractually never allowed to
    // decrease (see `clampArcLengthToMaxSpeed`), a dip would freeze the
    // segment until real time caught back up past it -- reintroducing
    // exactly the frozen-tail bug this growth-phase blend exists to fix, just
    // at every growth-phase step boundary instead of at the loop's start.
    // Clamping the *reference time itself* to be monotonic non-decreasing
    // (never re-reading an earlier instant than a previous frame already
    // did) prevents the dip at the source, before it ever reaches the
    // arc-length domain.
    let lastTargetTimeMs = -Infinity;
    const idealArcLengths = hopFrames.map((frame) => {
      const lagMs = lagDurationMs(absoluteTimesMs, frame.stepIndex, stepLag, frame.timeMs);
      const targetTimeMs = Math.max(lastTargetTimeMs, frame.timeMs - lagMs);
      lastTargetTimeMs = targetTimeMs;
      return headArcLengthAtTime(headTimelineTimesMs, headCumulativeArcLength, targetTimeMs);
    });
    const clampedArcLengths = clampArcLengthToMaxSpeed(idealArcLengths, maxHeadHopDistancePx);
    const positions = clampedArcLengths.map((arcLength) =>
      headPositionAtArcLength(headCumulativeArcLength, extendedHeadPositions, arcLength),
    );
    return [...positions, positions.at(-1)!];
  }

  const headGroup = `
    <g id="wolverine-snake-head">
      ${translateAnimation(extendedHeadPositions, keyTimes, totalDurationMs)}
      <rect x="${-HEAD_SIZE_PX / 2}" y="${-HEAD_SIZE_PX / 2}" width="${HEAD_SIZE_PX}" height="${HEAD_SIZE_PX}" rx="${HEAD_CORNER_RADIUS_PX}" ry="${HEAD_CORNER_RADIUS_PX}" fill="${SNAKE_HEAD_FILL}" stroke="${SNAKE_HEAD_BORDER}" stroke-width="1.5"/>
      <path d="${ARROW_PATH}" fill="${SNAKE_HEAD_BORDER}">
        ${rotateAnimation(extendedHeadAngles, keyTimes, totalDurationMs)}
      </path>
    </g>`;

  const bodySegmentPositions: Point[][] = [];
  for (let segment = 0; segment < bodyLength; segment += 1) {
    bodySegmentPositions.push(laggedPositions(segment + 1));
  }

  const bodyGroups = bodySegmentPositions
    .map(
      (positions, segment) => `
    <g id="wolverine-snake-body-${segment}">
      ${translateAnimation(positions, keyTimes, totalDurationMs)}
      <rect x="${-BODY_SIZE_PX / 2}" y="${-BODY_SIZE_PX / 2}" width="${BODY_SIZE_PX}" height="${BODY_SIZE_PX}" rx="${BODY_CORNER_RADIUS_PX}" ry="${BODY_CORNER_RADIUS_PX}" fill="${SNAKE_BODY_FILL}"/>
    </g>`,
    )
    .join("");

  const connectorChain: Point[][] = [extendedHeadPositions, ...bodySegmentPositions];
  const connectors = connectorChain
    .slice(0, -1)
    .map((fromPositions, index) => {
      const toPositions = connectorChain[index + 1]!;
      const x1 = animateAttribute(
        "x1",
        fromPositions.map((p) => `${p.x}`),
        keyTimes,
        totalDurationMs,
      );
      const y1 = animateAttribute(
        "y1",
        fromPositions.map((p) => `${p.y}`),
        keyTimes,
        totalDurationMs,
      );
      const x2 = animateAttribute(
        "x2",
        toPositions.map((p) => `${p.x}`),
        keyTimes,
        totalDurationMs,
      );
      const y2 = animateAttribute(
        "y2",
        toPositions.map((p) => `${p.y}`),
        keyTimes,
        totalDurationMs,
      );
      return (
        `<line stroke="${SNAKE_BODY_CONNECTOR_COLOR}" stroke-opacity="${SNAKE_BODY_CONNECTOR_OPACITY}" ` +
        `stroke-width="1" stroke-dasharray="2,2">${x1}${y1}${x2}${y2}</line>`
      );
    })
    .join("");

  return `<g id="wolverine-snake">${connectors}${bodyGroups}${headGroup}</g>`;
}
