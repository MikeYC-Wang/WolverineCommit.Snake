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
 * retrace. Steps before index 0 don't exist, so the sum is naturally
 * truncated (not padded) once it runs past the start of the loop -- see
 * `headPositionAtTime`'s clamping for why that's the correct behavior rather
 * than an approximation.
 */
function lagDurationMs(absoluteTimesMs: readonly number[], stepIndex: number, stepLag: number): number {
  const endMs = absoluteTimesMs[stepIndex] ?? 0;
  const startIndex = stepIndex - stepLag;
  const startMs = startIndex >= 0 ? absoluteTimesMs[startIndex]! : 0;
  return endMs - startMs;
}

/**
 * Linearly interpolates the head's own position at an arbitrary absolute
 * `timeMs`, given the head's full (monotonic) hop-keyframe timeline. This is
 * the crux of the fix for body segments snapping (see module docs on
 * `laggedPositions`): rather than replaying a *different* step's waypoints
 * at the *current* step's fractional progress (which desyncs badly whenever
 * the two steps have very different hop counts), we read the lagged
 * position directly off the head's own continuous trajectory, evaluated
 * `stepLag`-steps'-worth of real time in the past. `timeMs` before the first
 * keyframe (i.e. before the loop even started) clamps to the start position,
 * which is exactly the "not enough history yet" case at the top of a loop.
 */
function headPositionAtTime(times: readonly number[], positions: readonly Point[], timeMs: number): Point {
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
  return {
    x: before.x + (after.x - before.x) * progress,
    y: before.y + (after.y - before.y) * progress,
  };
}

/** Straight-line distance between two points. */
function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
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
 * Caps each frame-to-frame movement in `positions` to at most `maxDistancePx`
 * (moving as far as allowed toward the original position, rather than
 * discarding the frame entirely), so a sequence built from time-shifted
 * samples (see `laggedPositions`) can never move faster than the head's own
 * worst single hop even when the *ideal* time-shifted position would require
 * covering many hops within a single frame (e.g. a long jump immediately
 * followed by a very short step -- the exact shape QA's repro exercises).
 * Any distance this trims off is naturally caught up on subsequent frames,
 * since the ideal target keeps advancing independently of how far behind the
 * clamped trail currently sits.
 */
function clampToMaxSpeed(positions: readonly Point[], maxDistancePx: number): Point[] {
  if (positions.length === 0) return [];
  const result: Point[] = [positions[0]!];
  for (let i = 1; i < positions.length; i += 1) {
    const previous = result[i - 1]!;
    const ideal = positions[i]!;
    const distance = distanceBetween(previous, ideal);
    if (distance <= maxDistancePx) {
      result.push(ideal);
    } else {
      const scale = maxDistancePx / distance;
      result.push({
        x: previous.x + (ideal.x - previous.x) * scale,
        y: previous.y + (ideal.y - previous.y) * scale,
      });
    }
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

  /**
   * Position sequence of the body segment trailing `stepLag` *steps* (not
   * hops) behind the head -- matching solveSnakePath's actual body-occupancy
   * model, where each segment sits on a previously-*eaten* cell rather than a
   * mid-route waypoint. Rather than replaying the shifted step's own
   * waypoints at the current step's fractional hop-progress (the old
   * approach, which desyncs badly whenever the shifted and current steps
   * have very different hop counts -- see project report, "the snake body
   * snaps/teleports"), this reads the segment's position directly off the
   * head's own trajectory at (this frame's time minus the real duration of
   * the `stepLag` most recent steps). That keeps the segment's motion an
   * exact, undistorted echo of however the head actually moved, just shifted
   * later in time. `clampToMaxSpeed` is a safety net for the rare case where
   * the ideal time-shifted target would itself require covering more ground
   * than the head's worst single hop within one frame (e.g. a long jump
   * immediately followed by a very short step): it caps the segment's
   * per-frame travel instead of letting it snap, and any shortfall is made up
   * on subsequent frames as the ideal target keeps advancing.
   */
  function laggedPositions(stepLag: number): Point[] {
    const idealPositions = hopFrames.map((frame) => {
      const lagMs = lagDurationMs(absoluteTimesMs, frame.stepIndex, stepLag);
      const targetTimeMs = frame.timeMs - lagMs;
      return headPositionAtTime(headTimelineTimesMs, extendedHeadPositions, targetTimeMs);
    });
    const clamped = clampToMaxSpeed(idealPositions, maxHeadHopDistancePx);
    return [...clamped, clamped.at(-1)!];
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
