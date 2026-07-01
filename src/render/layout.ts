import type { ContributionGrid, GridCell } from "../types.js";

/** Pixel size of a single contribution cell, matching GitHub's own graph proportions. */
export const CELL_SIZE_PX = 11;
export const CELL_GAP_PX = 3;
export const CELL_STRIDE_PX = CELL_SIZE_PX + CELL_GAP_PX;

export const GRID_MARGIN_PX = 20;

export interface SvgDimensions {
  readonly width: number;
  readonly height: number;
}

export function svgDimensionsFor(grid: ContributionGrid): SvgDimensions {
  const width = GRID_MARGIN_PX * 2 + grid.weekCount * CELL_STRIDE_PX - CELL_GAP_PX;
  const height = GRID_MARGIN_PX * 2 + grid.dayCount * CELL_STRIDE_PX - CELL_GAP_PX;
  return { width, height };
}

/** Top-left pixel coordinate of a cell's square. */
export function cellTopLeft(cell: GridCell): { x: number; y: number } {
  return {
    x: GRID_MARGIN_PX + cell.weekIndex * CELL_STRIDE_PX,
    y: GRID_MARGIN_PX + cell.dayIndex * CELL_STRIDE_PX,
  };
}

/** Pixel coordinate of a cell's center, used to position the snake and event bubbles. */
export function cellCenter(cell: GridCell): { x: number; y: number } {
  const topLeft = cellTopLeft(cell);
  return { x: topLeft.x + CELL_SIZE_PX / 2, y: topLeft.y + CELL_SIZE_PX / 2 };
}
