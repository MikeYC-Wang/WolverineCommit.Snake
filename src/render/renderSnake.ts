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
import { buildLoopTimeline, unwrapAngles } from "./timeline.js";

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
 * Renders the animated snake: a head (Command, with a rotating direction
 * arrow) trailed by `bodyLength` body nodes (message-bus segments), connected
 * by dashed connector lines. Movement between contributed cells is tweened
 * smoothly (see visual-design.md 2.3) rather than following grid lines, which
 * is why every node's position is driven by a single SMIL `translate`
 * animation interpolating directly between cell centers.
 */
export function renderSnake(steps: readonly SnakePathStep[], bodyLength: number): string {
  if (steps.length === 0) return "";

  const { stepDurationMs, loopResetPauseMs } = ANIMATION_TIMING;
  const { keyTimes, totalDurationMs } = buildLoopTimeline(steps.length, stepDurationMs, loopResetPauseMs);

  const headPositions = steps.map((step) => cellCenter(step.cell));
  const extendedHeadPositions = [...headPositions, headPositions.at(-1)!];

  const rawAngles = headPositions.map((position, index) => {
    const previous = headPositions[Math.max(0, index - 1)]!;
    return pointsEqual(previous, position) ? 0 : angleBetween(previous, position);
  });
  if (rawAngles.length > 0) rawAngles[0] = rawAngles[1] ?? 0;
  const headAngles = unwrapAngles(rawAngles);
  const extendedHeadAngles = [...headAngles, headAngles.at(-1) ?? 0];

  /** Position sequence of the body segment trailing `lag` steps behind the head. */
  function laggedPositions(lag: number): Point[] {
    return extendedHeadPositions.map((_, index) => extendedHeadPositions[Math.max(0, index - lag)]!);
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
