import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { CELL_STRIDE_PX, cellCenter } from "./layout.js";
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

/**
 * Gap (px) between consecutive body segments, measured along the head's own
 * traveled path. One grid cell-stride keeps the body reading as a tight,
 * evenly-spaced trailing line -- the classic "snake" look -- regardless of
 * how far apart the contributed cells the head is jumping between happen to
 * be.
 */
const SEGMENT_SPACING_PX = CELL_STRIDE_PX;

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
 * Generic keyframe lookup: given a monotonic non-decreasing `keys` array
 * (e.g. absolute times, or cumulative arc-length) and a parallel `values`
 * array, binary-searches for the bounding pair of keyframes surrounding
 * `key` and linearly interpolates between their values in proportion to how
 * far `key` falls between the two bounding keys. `key` outside the array's
 * range clamps to the nearest end, so a lookup before the loop even started
 * (or past its very end) resolves to the start/end value instead of
 * extrapolating.
 *
 * Every keyframe lookup in this module is structurally this same
 * search-and-lerp operation over a different pair of parallel arrays, so
 * they share this one implementation (see `headPositionAtArcLength` below).
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

  // The head's own path expressed as a 1D "odometer reading" (px traveled),
  // parallel to `extendedHeadPositions`. Every body segment is positioned by
  // sampling this array at a fixed arc-length offset behind the head, which
  // keeps the body a tight, evenly-spaced trailing line that always follows
  // the head's exact route.
  const headCumulativeArcLength = buildCumulativeArcLength(extendedHeadPositions);

  /**
   * Positions of the body segment sitting a fixed distance behind the head.
   *
   * `segmentIndex` is 1-based (1 == the segment right behind the head). The
   * segment is drawn `segmentIndex * SEGMENT_SPACING_PX` *along the head's own
   * traveled path* behind the head's current arc-length position, then
   * converted back to (x,y) via `headPositionAtArcLength` -- so it always
   * lies exactly on the head's route, never a Euclidean shortcut through
   * cells the head never crossed.
   *
   * Because every segment's target arc-length is just the head's own
   * (monotonic non-decreasing) arc-length minus a constant, clamped at 0, the
   * result is monotonic by construction: no segment ever moves backward, and
   * every segment advances at exactly the head's own speed once it has any
   * path behind it. That means no speed clamp is needed and nothing ever
   * freezes mid-loop -- the two behaviors that used to make the body bunch up
   * and stutter. Near the loop's start the offset target is negative and
   * clamps to 0 (the start cell), giving the natural "grows out from a point"
   * look for the first few hops before the body reaches full extension.
   */
  function segmentPositions(segmentIndex: number): Point[] {
    const arcOffsetPx = segmentIndex * SEGMENT_SPACING_PX;
    return headCumulativeArcLength.map((headArcLength) =>
      headPositionAtArcLength(headCumulativeArcLength, extendedHeadPositions, headArcLength - arcOffsetPx),
    );
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
    bodySegmentPositions.push(segmentPositions(segment + 1));
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
