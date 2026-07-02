import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { cellCenter } from "./layout.js";
import {
  ANIMATION_TIMING,
  SNAKE_BODY_CONNECTOR_COLOR,
  SNAKE_BODY_FILL,
  SNAKE_HEAD_BORDER,
  SNAKE_HEAD_FILL,
} from "./theme.js";
import { buildLoopTimeline, computeStepDurationsMs } from "./timeline.js";

const HEAD_SIZE_PX = 9;
const HEAD_CORNER_RADIUS_PX = 2;
const BODY_SIZE_PX = 7;
const BODY_CORNER_RADIUS_PX = 2;

/** Small triangular arrow pointing "right" (0deg); animateMotion rotate=auto turns it to face travel. */
const ARROW_PATH = "M 3.5 0 L -1.5 -2.5 L -1.5 2.5 Z";

const ROUTE_ID = "wolverine-snake-route";

interface Point {
  readonly x: number;
  readonly y: number;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function roundPx(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * animateMotion for the node that trails the head by `segmentIndex` cells
 * (0 = the head itself). Every node follows the *same* shared route path but
 * is time-shifted so it sits `segmentIndex` cells behind: it holds at the
 * start cell until the head has advanced that far (the snake grows out of a
 * point), then trails at the head's own pace, then holds at the end through
 * the loop-reset pause. Referencing one shared `<mpath>` keeps every node's
 * markup tiny regardless of how long the route is.
 */
function nodeMotion(
  segmentIndex: number,
  cellFraction: number,
  moveFraction: number,
  totalDurationMs: number,
): string {
  let keyPoints: string;
  let keyTimes: string;

  if (segmentIndex === 0) {
    keyPoints = "0;1;1";
    keyTimes = `0;${round(moveFraction)};1`;
  } else {
    const endFraction = Math.max(0, 1 - segmentIndex * cellFraction);
    if (endFraction <= 0) {
      // Body longer than the whole route (tiny grid): this node just sits at the start cell.
      keyPoints = "0;0";
      keyTimes = "0;1";
    } else {
      const departFraction = Math.min(moveFraction, segmentIndex * cellFraction * moveFraction);
      keyPoints = `0;0;${round(endFraction)};${round(endFraction)}`;
      keyTimes = `0;${round(departFraction)};${round(moveFraction)};1`;
    }
  }

  const rotate = segmentIndex === 0 ? ' rotate="auto"' : "";
  return (
    `<animateMotion dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear" ` +
    `keyPoints="${keyPoints}" keyTimes="${keyTimes}"${rotate}>` +
    `<mpath href="#${ROUTE_ID}" xlink:href="#${ROUTE_ID}"/></animateMotion>`
  );
}

function bodyNode(segmentIndex: number, cellFraction: number, moveFraction: number, totalDurationMs: number): string {
  return (
    `<g>${nodeMotion(segmentIndex, cellFraction, moveFraction, totalDurationMs)}` +
    `<rect x="${-BODY_SIZE_PX / 2}" y="${-BODY_SIZE_PX / 2}" width="${BODY_SIZE_PX}" height="${BODY_SIZE_PX}" ` +
    `rx="${BODY_CORNER_RADIUS_PX}" ry="${BODY_CORNER_RADIUS_PX}" fill="${SNAKE_BODY_FILL}" ` +
    `stroke="${SNAKE_BODY_CONNECTOR_COLOR}" stroke-width="1"/></g>`
  );
}

function headNode(cellFraction: number, moveFraction: number, totalDurationMs: number): string {
  return (
    `<g id="wolverine-snake-head">${nodeMotion(0, cellFraction, moveFraction, totalDurationMs)}` +
    `<rect x="${-HEAD_SIZE_PX / 2}" y="${-HEAD_SIZE_PX / 2}" width="${HEAD_SIZE_PX}" height="${HEAD_SIZE_PX}" ` +
    `rx="${HEAD_CORNER_RADIUS_PX}" ry="${HEAD_CORNER_RADIUS_PX}" fill="${SNAKE_HEAD_FILL}" ` +
    `stroke="${SNAKE_HEAD_BORDER}" stroke-width="1.5"/>` +
    `<path d="${ARROW_PATH}" fill="${SNAKE_HEAD_BORDER}"/></g>`
  );
}

/**
 * Renders the snake as a true, contiguous "Snake": a head plus `bodyLength`
 * trailing body squares, each a tiny group driven by `<animateMotion>` along
 * one shared route path (see solveSnakePath). Because every node just follows
 * the head's own path, time-shifted a fixed number of cells back, the body can
 * never detach from the head, never overlap it, and never tangle -- and the
 * markup stays a few KB with cheap transform-based motion (no per-frame path
 * re-rasterisation), which is what keeps it smooth. The head's arrow uses
 * `rotate="auto"` so it always faces the direction of travel.
 */
export function renderSnake(steps: readonly SnakePathStep[], bodyLength: number): string {
  if (steps.length === 0) return "";

  const centers = steps.map((step) => cellCenter(step.cell));

  // A single-cell path can't drive animateMotion; render a static head.
  if (centers.length < 2) {
    const p = centers[0]!;
    return (
      `<g id="wolverine-snake"><g id="wolverine-snake-head" transform="translate(${roundPx(p.x)},${roundPx(p.y)})">` +
      `<rect x="${-HEAD_SIZE_PX / 2}" y="${-HEAD_SIZE_PX / 2}" width="${HEAD_SIZE_PX}" height="${HEAD_SIZE_PX}" ` +
      `rx="${HEAD_CORNER_RADIUS_PX}" ry="${HEAD_CORNER_RADIUS_PX}" fill="${SNAKE_HEAD_FILL}" ` +
      `stroke="${SNAKE_HEAD_BORDER}" stroke-width="1.5"/>` +
      `<path d="${ARROW_PATH}" fill="${SNAKE_HEAD_BORDER}"/></g></g>`
    );
  }

  const { stepDurationMs, loopResetPauseMs } = ANIMATION_TIMING;
  const stepDurationsMs = computeStepDurationsMs(steps, stepDurationMs);
  const { absoluteTimesMs, totalDurationMs } = buildLoopTimeline(stepDurationsMs, loopResetPauseMs);

  const moveEndMs = absoluteTimesMs[absoluteTimesMs.length - 2] ?? 0;
  const moveFraction = totalDurationMs > 0 ? Math.min(1, moveEndMs / totalDurationMs) : 1;
  const cellFraction = 1 / (centers.length - 1);

  const routeD = centers.map((p, i) => `${i === 0 ? "M" : "L"} ${roundPx(p.x)} ${roundPx(p.y)}`).join(" ");
  const route = `<path id="${ROUTE_ID}" d="${routeD}" fill="none" stroke="none"/>`;

  // Furthest body segment first so the head (drawn last) sits on top.
  const bodyNodes: string[] = [];
  for (let segment = bodyLength; segment >= 1; segment -= 1) {
    bodyNodes.push(bodyNode(segment, cellFraction, moveFraction, totalDurationMs));
  }

  return `<g id="wolverine-snake">${route}${bodyNodes.join("")}${headNode(cellFraction, moveFraction, totalDurationMs)}</g>`;
}
