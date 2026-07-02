import { describe, expect, it } from "vitest";
import type { SnakePathStep } from "../pathfinding/solveSnakePath.js";
import { cellCenter } from "./layout.js";
import { SNAKE_BODY_FILL, SNAKE_HEAD_BORDER, SNAKE_HEAD_FILL } from "./theme.js";
import { renderSnake } from "./renderSnake.js";

/** Builds a straight run of adjacent single-hop steps along a row of cells. */
function adjacentSteps(count: number): SnakePathStep[] {
  const steps: SnakePathStep[] = [];
  for (let i = 0; i < count; i += 1) {
    const cell = { weekIndex: i, dayIndex: 0 };
    steps.push({
      cell,
      waypoints: i === 0 ? [cell] : [{ weekIndex: i - 1, dayIndex: 0 }, cell],
      isJump: false,
      ateContribution: true,
      isLoopComplete: i === count - 1,
    });
  }
  return steps;
}

describe("renderSnake", () => {
  it("returns an empty string when there are no steps", () => {
    expect(renderSnake([], 10)).toBe("");
  });

  it("renders a single body path plus a head group (no per-node/per-connector blowup)", () => {
    const svg = renderSnake(adjacentSteps(5), 3);

    expect((svg.match(/<path /g) ?? []).length).toBe(2); // body route path + head arrow path
    expect(svg).toContain('id="wolverine-snake-route"');
    expect(svg).toContain('id="wolverine-snake-head"');
    expect(svg).toContain(`stroke="${SNAKE_BODY_FILL}"`);
    expect(svg).toContain(`fill="${SNAKE_HEAD_FILL}"`);
    expect(svg).toContain(`stroke="${SNAKE_HEAD_BORDER}"`);
    // Exactly one animation for the body (dashoffset) -- the head uses animateMotion, not <animate>.
    expect((svg.match(/<animate /g) ?? []).length).toBe(1);
  });

  it("traces the route path through every cell centre in order", () => {
    const steps = adjacentSteps(4);
    const svg = renderSnake(steps, 2);

    const match = svg.match(/id="wolverine-snake-route" d="([^"]+)"/);
    expect(match).not.toBeNull();
    const d = match![1]!;
    for (let i = 0; i < steps.length; i += 1) {
      const p = cellCenter(steps[i]!.cell);
      expect(d).toContain(`${i === 0 ? "M" : "L"} ${p.x} ${p.y}`);
    }
  });

  it("drives the head along the route via animateMotion with rotate=auto and an mpath reference", () => {
    const svg = renderSnake(adjacentSteps(4), 2);

    expect(svg).toContain("<animateMotion");
    expect(svg).toContain('rotate="auto"');
    expect(svg).toContain('href="#wolverine-snake-route"');
    expect(svg).toContain('xlink:href="#wolverine-snake-route"');
  });

  it("glides a fixed-length body window: dashoffset starts hidden at the start and ends at the tail", () => {
    const steps = adjacentSteps(11); // 10 hops -> route length 10 * stride
    const bodyLength = 4;
    const svg = renderSnake(steps, bodyLength);

    const match = svg.match(/attributeName="stroke-dashoffset" values="([^"]+)"/);
    expect(match).not.toBeNull();
    const [start, mid, end] = match![1]!.split(";").map(Number);

    // The body window is bodyLength cells long; it starts fully hidden before
    // the start (offset = +window) and finishes at the end (offset =
    // window - routeLength, negative), then holds there through the pause.
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(0);
    expect(mid).toBe(end); // holds at the tail during the reset pause
    expect(start! - end!).toBeGreaterThan(0);
  });

  it("keeps every animation on a single shared duration so the snake stays in sync with grid + bubbles", () => {
    const svg = renderSnake(adjacentSteps(6), 3);
    const durations = [...svg.matchAll(/dur="(\d+)ms"/g)].map((m) => m[1]);
    expect(durations.length).toBeGreaterThan(0);
    expect(new Set(durations).size).toBe(1);
  });

  it("uses compact markup that does not grow with body length", () => {
    const short = renderSnake(adjacentSteps(40), 2);
    const long = renderSnake(adjacentSteps(40), 20);
    // Body length only changes a couple of numbers (dash window), never the
    // element count -- the old renderer added a group + connector per segment.
    expect((short.match(/<(path|g|animate|animateMotion)/g) ?? []).length).toBe(
      (long.match(/<(path|g|animate|animateMotion)/g) ?? []).length,
    );
  });
});
