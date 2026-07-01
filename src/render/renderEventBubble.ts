import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { getDay, type ContributionGrid } from "../types.js";
import { cellCenter } from "./layout.js";
import {
  ANIMATION_TIMING,
  EVENT_BUBBLE_FILL,
  EVENT_BUBBLE_OPACITY_BY_LEVEL,
  EVENT_BUBBLE_RADIUS_BY_LEVEL,
  EVENT_CONNECTOR_COLOR,
  EVENT_CONNECTOR_OPACITY,
} from "./theme.js";
import { buildLoopTimeline, computeStepDurationsMs } from "./timeline.js";

interface Point {
  readonly x: number;
  readonly y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Builds an opacity keyframe track that is 0 everywhere except a single
 * fade-in/hold/fade-out spike anchored at `spikeStartMs`, expressed as
 * fractions of the shared `totalDurationMs` loop. This lets every bubble
 * share one global timeline (see timeline.ts) while only being visible
 * during its own ~600ms event window (visual-design.md section 5).
 */
function buildOpacitySpike(
  spikeStartMs: number,
  totalDurationMs: number,
  peakOpacity: number,
): { keyTimes: number[]; values: number[] } {
  const { fadeInMs, holdMs, fadeOutMs } = ANIMATION_TIMING.eventBubble;
  const fadeInEndMs = spikeStartMs + fadeInMs;
  const holdEndMs = fadeInEndMs + holdMs;
  const fadeOutEndMs = holdEndMs + fadeOutMs;

  const rawTimes = [0, spikeStartMs, fadeInEndMs, holdEndMs, fadeOutEndMs, totalDurationMs];
  const rawValues = [0, 0, peakOpacity, peakOpacity, 0, 0];

  // Clamp + dedupe so keyTimes stay within [0, totalDurationMs] and strictly
  // increasing, which SMIL requires.
  const keyTimes: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < rawTimes.length; i += 1) {
    const clamped = Math.min(totalDurationMs, Math.max(0, rawTimes[i]!));
    const fraction = clamped / totalDurationMs;
    if (keyTimes.length > 0 && fraction <= keyTimes.at(-1)!) continue;
    keyTimes.push(fraction);
    values.push(rawValues[i]!);
  }
  if (keyTimes.at(-1)! < 1) {
    keyTimes.push(1);
    values.push(0);
  }
  return { keyTimes, values };
}

function animateOpacity(keyTimes: readonly number[], values: readonly number[], totalDurationMs: number): string {
  return (
    `<animate attributeName="opacity" values="${values.join(";")}" ` +
    `keyTimes="${keyTimes.join(";")}" dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear"/>`
  );
}

/**
 * Renders one "Event bubble" per eaten cell: a small circle sized/brightened
 * by the cell's contribution level, plus a connector line animating toward
 * the tail position at the moment of eating (visual-design.md 2.3 / 5).
 * Wander steps (see solveSnakePath dead-end fallback) don't eat anything and
 * so never spawn a bubble.
 */
export function renderEventBubble(
  grid: ContributionGrid,
  steps: readonly SnakePathStep[],
  bodyLength: number,
): string {
  if (steps.length === 0) return "";

  const { stepDurationMs, loopResetPauseMs, eventBubble } = ANIMATION_TIMING;
  const stepDurationsMs = computeStepDurationsMs(steps, stepDurationMs);
  const { absoluteTimesMs, totalDurationMs } = buildLoopTimeline(stepDurationsMs, loopResetPauseMs);

  const headPositions = steps.map((step) => cellCenter(step.cell));

  const elements: string[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (!step.ateContribution) continue;

    const level = getDay(grid, step.cell).level;
    if (level === 0) continue; // defensive: eaten cells are always > 0 contributions

    const radius = EVENT_BUBBLE_RADIUS_BY_LEVEL[level];
    const peakOpacity = EVENT_BUBBLE_OPACITY_BY_LEVEL[level];
    const bubbleCenter = headPositions[index]!;

    const tailIndex = Math.max(0, index - bodyLength);
    const tailPosition = headPositions[tailIndex]!;

    const spikeStartMs = absoluteTimesMs[index]!;
    const { keyTimes, values } = buildOpacitySpike(spikeStartMs, totalDurationMs, peakOpacity);

    elements.push(
      `<circle cx="${bubbleCenter.x}" cy="${bubbleCenter.y}" r="${radius}" fill="${EVENT_BUBBLE_FILL}" opacity="0">` +
        animateOpacity(keyTimes, values, totalDurationMs) +
        `</circle>`,
    );

    // Connector: animates its far end from the bubble toward the tail over
    // the "connector travel" window, and fades out with the bubble.
    const travelStartMs = spikeStartMs + eventBubble.fadeInMs + eventBubble.holdMs;
    const travelEndMs = travelStartMs + eventBubble.connectorTravelMs;
    const connectorLength = distance(bubbleCenter, tailPosition);
    if (connectorLength > 0) {
      const dashKeyTimes = [
        0,
        Math.min(1, travelStartMs / totalDurationMs),
        Math.min(1, travelEndMs / totalDurationMs),
        1,
      ];
      const dashValues = [connectorLength, connectorLength, 0, 0];
      elements.push(
        `<line x1="${bubbleCenter.x}" y1="${bubbleCenter.y}" x2="${tailPosition.x}" y2="${tailPosition.y}" ` +
          `stroke="${EVENT_CONNECTOR_COLOR}" stroke-opacity="${EVENT_CONNECTOR_OPACITY}" stroke-width="1" ` +
          `stroke-dasharray="${connectorLength}" opacity="0">` +
          animateOpacity(keyTimes, values, totalDurationMs) +
          `<animate attributeName="stroke-dashoffset" values="${dashValues.join(";")}" ` +
          `keyTimes="${dashKeyTimes.join(";")}" dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear"/>` +
          `</line>`,
      );
    }
  }

  return `<g id="wolverine-event-bubbles">${elements.join("")}</g>`;
}
