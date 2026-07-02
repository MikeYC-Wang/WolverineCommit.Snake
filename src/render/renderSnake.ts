import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { CELL_STRIDE_PX, cellCenter } from "./layout.js";
import { ANIMATION_TIMING, SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
import { buildLoopTimeline, computeStepDurationsMs } from "./timeline.js";

const HEAD_SIZE_PX = 9;
const HEAD_CORNER_RADIUS_PX = 2;
/** Body stroke thickness -- a little under a full cell so it reads as a snake body sitting on the grid. */
const BODY_STROKE_PX = 7;

/** Small triangular arrow pointing "right" (0deg); `rotate="auto"` turns it to face the direction of travel. */
const ARROW_PATH = "M 3.5 0 L -1.5 -2.5 L -1.5 2.5 Z";

const ROUTE_ID = "wolverine-snake-route";

interface Point {
  readonly x: number;
  readonly y: number;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Builds the SVG path data (`M ... L ...`) tracing the head through every cell centre in order. */
function buildRoutePath(centers: readonly Point[]): string {
  return centers
    .map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`)
    .join(" ");
}

function pathLengthPx(centers: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < centers.length; i += 1) {
    total += Math.hypot(centers[i]!.x - centers[i - 1]!.x, centers[i]!.y - centers[i - 1]!.y);
  }
  return total;
}

/**
 * Renders the snake as a true, contiguous "Snake" gliding along the grid sweep
 * (see solveSnakePath's boustrophedon path):
 *
 *   - The **body** is a single fixed-length rounded stroke that slides along
 *     the sweep path via one animated `stroke-dashoffset`. Because it is
 *     literally a moving window *on the head's own path*, it can never detach
 *     from the head, never overlap it, and never tangle -- and it costs just
 *     one `<path>` plus one `<animate>`, no matter how long the path is (the
 *     old per-node/per-keyframe renderer ballooned to hundreds of KB; this is
 *     a few KB), which is what makes the animation smooth instead of janky.
 *   - The **head** (a Command box with a direction arrow) rides the same path
 *     with `<animateMotion rotate="auto">`, so the arrow always faces the way
 *     it is travelling with zero per-step rotation keyframes.
 *
 * Both share one `dur` and the same move-then-hold `keyTimes`, so they stay in
 * lockstep with the grid-fade and event-bubble layers (see timeline.ts): the
 * snake sweeps the whole grid over the move window, then holds at the end
 * during the loop-reset pause while the eaten cells fade back.
 */
export function renderSnake(steps: readonly SnakePathStep[], bodyLength: number): string {
  if (steps.length === 0) return "";

  const { stepDurationMs, loopResetPauseMs } = ANIMATION_TIMING;
  const stepDurationsMs = computeStepDurationsMs(steps, stepDurationMs);
  const { absoluteTimesMs, totalDurationMs } = buildLoopTimeline(stepDurationsMs, loopResetPauseMs);

  const centers = steps.map((step) => cellCenter(step.cell));
  const routePath = buildRoutePath(centers);

  // The head reaches the last cell at `moveEndMs`; the remaining time up to
  // `totalDurationMs` is the loop-reset hold (the snake pauses at the end
  // while the grid fades back). Both fractions drive the same keyTimes.
  const moveEndMs = absoluteTimesMs[absoluteTimesMs.length - 2] ?? 0;
  const moveFraction = totalDurationMs > 0 ? Math.min(1, moveEndMs / totalDurationMs) : 1;

  const routeLengthPx = pathLengthPx(centers);
  const bodyWindowPx = Math.min(bodyLength * CELL_STRIDE_PX, routeLengthPx);

  // Move a `bodyWindowPx`-long dash from "just about to enter at the start"
  // (offset = bodyWindowPx, nothing visible yet -> the snake grows out of its
  // start cell) to "sitting at the very end" (offset = bodyWindowPx -
  // routeLengthPx), then hold there through the reset pause.
  const dashStart = round(bodyWindowPx);
  const dashEnd = round(bodyWindowPx - routeLengthPx);
  const bodyAnimate =
    `<animate attributeName="stroke-dashoffset" values="${dashStart};${dashEnd};${dashEnd}" ` +
    `keyTimes="0;${moveFraction};1" dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear"/>`;

  const body =
    `<path id="${ROUTE_ID}" d="${routePath}" fill="none" stroke="${SNAKE_BODY_FILL}" ` +
    `stroke-width="${BODY_STROKE_PX}" stroke-linecap="round" stroke-linejoin="round" ` +
    `stroke-dasharray="${round(bodyWindowPx)} ${round(routeLengthPx)}" stroke-dashoffset="${dashStart}">` +
    `${bodyAnimate}</path>`;

  const headMotion =
    `<animateMotion dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear" ` +
    `keyPoints="0;1;1" keyTimes="0;${moveFraction};1" rotate="auto">` +
    `<mpath href="#${ROUTE_ID}" xlink:href="#${ROUTE_ID}"/></animateMotion>`;

  const head =
    `<g id="wolverine-snake-head">${headMotion}` +
    `<rect x="${-HEAD_SIZE_PX / 2}" y="${-HEAD_SIZE_PX / 2}" width="${HEAD_SIZE_PX}" height="${HEAD_SIZE_PX}" ` +
    `rx="${HEAD_CORNER_RADIUS_PX}" ry="${HEAD_CORNER_RADIUS_PX}" fill="${SNAKE_HEAD_FILL}" ` +
    `stroke="${SNAKE_HEAD_BORDER}" stroke-width="1.5"/>` +
    `<path d="${ARROW_PATH}" fill="${SNAKE_HEAD_BORDER}"/></g>`;

  return `<g id="wolverine-snake">${body}${head}</g>`;
}
