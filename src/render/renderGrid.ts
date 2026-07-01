import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { cellKey, type ContributionGrid } from "../types.js";
import { ANIMATION_TIMING, CONTRIBUTION_LEVEL_COLORS } from "./theme.js";
import { CELL_SIZE_PX, cellTopLeft } from "./layout.js";
import { buildLoopTimeline, computeStepDurationsMs } from "./timeline.js";

const CELL_CORNER_RADIUS_PX = 2;

function animateFill(values: readonly string[], keyTimes: readonly number[], totalDurationMs: number): string {
  return (
    `<animate attributeName="fill" values="${values.join(";")}" ` +
    `keyTimes="${keyTimes.join(";")}" dur="${totalDurationMs}ms" repeatCount="indefinite" calcMode="linear"/>`
  );
}

/**
 * Builds a fill-color keyframe track that stays at `originalColor` until the
 * cell is eaten (`eatenAtMs`), fades to `eatenColor` over `fadeMs` so the
 * "consumption" reads as a clear, perceptible event rather than an instant
 * swap, holds `eatenColor` for the rest of the loop, then fades back to
 * `originalColor` in the `fadeMs` immediately before the loop-reset pause
 * ends -- matching tech-stack.md 3.1's "跑完所有 contribution 格子後,重置回
 * 起始點,所有已吃格子恢復原狀" (cells revert to their original appearance
 * once the loop resets). The revert lands exactly on the shared timeline's
 * final keyframe, so the very next loop iteration starts from the same
 * (original) value with no visual pop.
 */
function buildFillKeyframes(
  originalColor: string,
  eatenColor: string,
  eatenAtMs: number,
  totalDurationMs: number,
  fadeMs: number,
): { keyTimes: number[]; values: string[] } {
  const fadeToEatenEndMs = eatenAtMs + fadeMs;
  const fadeToOriginalStartMs = totalDurationMs - fadeMs;

  const rawTimes = [0, eatenAtMs, fadeToEatenEndMs, fadeToOriginalStartMs, totalDurationMs];
  const rawValues = [originalColor, originalColor, eatenColor, eatenColor, originalColor];

  // Clamp + dedupe so keyTimes stay within [0, totalDurationMs] and strictly
  // increasing, which SMIL requires (mirrors renderEventBubble's
  // buildOpacitySpike, which has the same clamping need).
  const keyTimes: number[] = [];
  const values: string[] = [];
  for (let i = 0; i < rawTimes.length; i += 1) {
    const clamped = Math.min(totalDurationMs, Math.max(0, rawTimes[i]!));
    const fraction = totalDurationMs > 0 ? clamped / totalDurationMs : 0;
    if (keyTimes.length > 0 && fraction <= keyTimes.at(-1)!) continue;
    keyTimes.push(fraction);
    values.push(rawValues[i]!);
  }
  // Guarantee the loop always ends back on `originalColor`, even if the
  // fade-in and fade-out windows are close enough together (relative to
  // `totalDurationMs`) that `fadeToOriginalStartMs`'s keyframe above got
  // deduped away for landing at the same fraction as `fadeToEatenEndMs`.
  // Without this, whichever raw keyframe happens to claim fraction 1 wins,
  // which could leave the cell stuck on `eatenColor` at the loop seam (a
  // visible "pop" back to `originalColor` at the start of the next loop
  // instead of a smooth revert).
  if (keyTimes.at(-1)! === 1) {
    values[values.length - 1] = originalColor;
  } else {
    keyTimes.push(1);
    values.push(originalColor);
  }
  return { keyTimes, values };
}

/**
 * Renders the background grid: one `<rect>` per calendar cell, using
 * GitHub's dark contribution palette as its resting color. When `steps` is
 * supplied, cells the snake eats also get a color-fade `<animate>` timed to
 * the shared loop timeline (see timeline.ts) so eating a cell is a visible
 * state change rather than a silent no-op -- the project owner's "eaten
 * cells don't look eaten" report. Cells the snake never eats (including
 * every level-0 cell, which never gets eaten) stay fully static, as before.
 */
export function renderGrid(grid: ContributionGrid, steps: readonly SnakePathStep[] = []): string {
  const { stepDurationMs, loopResetPauseMs, cellEatenFadeMs } = ANIMATION_TIMING;

  let eatenAtMsByCell: ReadonlyMap<string, number> | null = null;
  let totalDurationMs = 0;
  if (steps.length > 0) {
    const stepDurationsMs = computeStepDurationsMs(steps, stepDurationMs);
    const timeline = buildLoopTimeline(stepDurationsMs, loopResetPauseMs);
    totalDurationMs = timeline.totalDurationMs;

    const eatenAtMs = new Map<string, number>();
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]!;
      if (!step.ateContribution) continue;
      const key = cellKey(step.cell);
      if (!eatenAtMs.has(key)) eatenAtMs.set(key, timeline.absoluteTimesMs[index]!);
    }
    eatenAtMsByCell = eatenAtMs;
  }

  const rects: string[] = [];

  for (const week of grid.weeks) {
    for (const day of week) {
      const cell = { weekIndex: day.weekIndex, dayIndex: day.dayIndex };
      const { x, y } = cellTopLeft(cell);
      const originalFill = CONTRIBUTION_LEVEL_COLORS[day.level];
      const eatenAtMs = eatenAtMsByCell?.get(cellKey(cell));

      const attrs =
        `x="${x}" y="${y}" width="${CELL_SIZE_PX}" height="${CELL_SIZE_PX}" ` +
        `rx="${CELL_CORNER_RADIUS_PX}" ry="${CELL_CORNER_RADIUS_PX}" fill="${originalFill}" ` +
        `data-date="${day.date}" data-count="${day.count}"`;

      if (eatenAtMs === undefined) {
        rects.push(`<rect ${attrs}/>`);
        continue;
      }

      const { keyTimes, values } = buildFillKeyframes(
        originalFill,
        CONTRIBUTION_LEVEL_COLORS[0],
        eatenAtMs,
        totalDurationMs,
        cellEatenFadeMs,
      );
      rects.push(`<rect ${attrs}>${animateFill(values, keyTimes, totalDurationMs)}</rect>`);
    }
  }

  return `<g id="wolverine-snake-grid">${rects.join("")}</g>`;
}
