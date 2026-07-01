import type { ContributionLevel } from "../types.js";

/**
 * Color constants. These hex codes are copied verbatim from
 * `docs/visual-design.md` section 3 ("色彩計畫：方案 A：深藍 + 琥珀金") and
 * must not be approximated or adjusted without updating that doc first.
 *
 * The one addition not spelled out in the doc is `CONTRIBUTION_LEVEL_COLORS[0]`
 * (the empty-cell background color): the doc only lists the four non-zero
 * GitHub green levels and says to "keep GitHub's dark contribution palette
 * unchanged," so level 0 uses GitHub's own official dark-theme empty-cell
 * color (`#161b22`) to stay faithful to that instruction.
 */
export const CONTRIBUTION_LEVEL_COLORS: Readonly<Record<ContributionLevel, string>> = {
  0: "#161b22",
  1: "#0e4429",
  2: "#006d32",
  3: "#26a641",
  4: "#39d353",
};

export const SNAKE_HEAD_FILL = "#1B2A4A";
export const SNAKE_HEAD_BORDER = "#F5A623";

export const SNAKE_BODY_FILL = "#24345C";
export const SNAKE_BODY_CONNECTOR_COLOR = "#F5A623";
export const SNAKE_BODY_CONNECTOR_OPACITY = 0.4;

export const EVENT_BUBBLE_FILL = "#FFB000";
export const EVENT_CONNECTOR_COLOR = "#FFB000";
export const EVENT_CONNECTOR_OPACITY = 0.35;

/** Animation timing constants, all in milliseconds. Source: visual-design.md section 5. */
export const ANIMATION_TIMING = {
  /** Time for the snake's head to travel from one contributed cell to the next. */
  stepDurationMs: 200,
  eventBubble: {
    fadeInMs: 100,
    holdMs: 200,
    connectorTravelMs: 300,
    /** Overlaps with the tail end of the connector travel window. */
    fadeOutMs: 200,
    totalMs: 600,
  },
  /** Pause after a full loop completes, before the snake resets to its start cell. */
  loopResetPauseMs: 1500,
} as const;

/** Minimum/maximum bubble radius (px), scaled by contribution level 1-4. See visual-design.md 2.3. */
export const EVENT_BUBBLE_RADIUS_BY_LEVEL: Readonly<Record<ContributionLevel, number>> = {
  0: 0,
  1: 2.5,
  2: 3.25,
  3: 4,
  4: 5,
};

/** Minimum/maximum bubble opacity, scaled by contribution level 1-4. See visual-design.md 2.3. */
export const EVENT_BUBBLE_OPACITY_BY_LEVEL: Readonly<Record<ContributionLevel, number>> = {
  0: 0,
  1: 0.65,
  2: 0.78,
  3: 0.9,
  4: 1,
};
