import type { ContributionGrid } from "../types.js";
import { CONTRIBUTION_LEVEL_COLORS } from "./theme.js";
import { CELL_SIZE_PX, cellTopLeft } from "./layout.js";

const CELL_CORNER_RADIUS_PX = 2;

/**
 * Renders the static background grid: one `<rect>` per calendar cell, using
 * GitHub's dark contribution palette. This layer never animates; the snake
 * and event bubbles are drawn on top of it in later stages of the pipeline.
 */
export function renderGrid(grid: ContributionGrid): string {
  const rects: string[] = [];

  for (const week of grid.weeks) {
    for (const day of week) {
      const { x, y } = cellTopLeft({ weekIndex: day.weekIndex, dayIndex: day.dayIndex });
      const fill = CONTRIBUTION_LEVEL_COLORS[day.level];
      rects.push(
        `<rect x="${x}" y="${y}" width="${CELL_SIZE_PX}" height="${CELL_SIZE_PX}" ` +
          `rx="${CELL_CORNER_RADIUS_PX}" ry="${CELL_CORNER_RADIUS_PX}" fill="${fill}" ` +
          `data-date="${day.date}" data-count="${day.count}"/>`,
      );
    }
  }

  return `<g id="wolverine-snake-grid">${rects.join("")}</g>`;
}
