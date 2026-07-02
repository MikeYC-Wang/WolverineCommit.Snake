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

  // Body nodes trail the head one *eaten cell* behind per segment, matching
  // solveSnakePath's own collision-free occupancy model: when the head sits on
  // eaten cell `j`, body segment `k` sits on eaten cell `j - k`. Those are the
  // exact cells the pathfinder guarantees the head never re-enters, so the head
  // can never overlap its own body -- a "correct" snake. (Drawing the body
  // along the head's raw pixel path instead makes it overlap the head wherever
  // a jump route doubles back on itself, which it frequently does.) A body node
  // only changes direction at a step boundary, so it needs just one keyframe
  // per step rather than one per hop -- a smaller, cheaper timeline that also
  // tweens straight between consecutive eaten cells.
  const eatenCenters = steps.map((step) => cellCenter(step.cell));
  const stepKeyTimes = absoluteTimesMs.map((t) => t / totalDurationMs);
  stepKeyTimes[stepKeyTimes.length - 1] = 1; // guard against floating-point drift

  function bodyStepPositions(segmentIndex: number): Point[] {
    const positions = eatenCenters.map((_, stepIndex) => eatenCenters[Math.max(0, stepIndex - segmentIndex)]!);
    positions.push(positions.at(-1)!); // hold frame during the loop-reset pause
    return positions;
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
    bodySegmentPositions.push(bodyStepPositions(segment + 1));
  }

  const bodyGroups = bodySegmentPositions
    .map(
      (positions, segment) => `
    <g id="wolverine-snake-body-${segment}">
      ${translateAnimation(positions, stepKeyTimes, totalDurationMs)}
      <rect x="${-BODY_SIZE_PX / 2}" y="${-BODY_SIZE_PX / 2}" width="${BODY_SIZE_PX}" height="${BODY_SIZE_PX}" rx="${BODY_CORNER_RADIUS_PX}" ry="${BODY_CORNER_RADIUS_PX}" fill="${SNAKE_BODY_FILL}"/>
    </g>`,
    )
    .join("");

  // A connector joins two nodes that can live on different timelines: the head
  // animates on the per-hop timeline, body nodes on the coarser per-step one.
  // SMIL lets each endpoint's <animate> carry its own keyTimes, so a
  // connector's head end and body end are driven independently.
  const connectorNodes: Array<{ positions: readonly Point[]; keyTimes: readonly number[] }> = [
    { positions: extendedHeadPositions, keyTimes },
    ...bodySegmentPositions.map((positions) => ({ positions, keyTimes: stepKeyTimes })),
  ];
  const connectors = connectorNodes
    .slice(0, -1)
    .map((fromNode, index) => {
      const toNode = connectorNodes[index + 1]!;
      const x1 = animateAttribute(
        "x1",
        fromNode.positions.map((p) => `${p.x}`),
        fromNode.keyTimes,
        totalDurationMs,
      );
      const y1 = animateAttribute(
        "y1",
        fromNode.positions.map((p) => `${p.y}`),
        fromNode.keyTimes,
        totalDurationMs,
      );
      const x2 = animateAttribute(
        "x2",
        toNode.positions.map((p) => `${p.x}`),
        toNode.keyTimes,
        totalDurationMs,
      );
      const y2 = animateAttribute(
        "y2",
        toNode.positions.map((p) => `${p.y}`),
        toNode.keyTimes,
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
