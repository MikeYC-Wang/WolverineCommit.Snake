#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchContributions } from "./data/fetchContributions.js";
import { DEFAULT_SNAKE_BODY_LENGTH, solveSnakePath } from "./pathfinding/solveSnakePath.js";
import { svgDimensionsFor } from "./render/layout.js";
import { renderEventBubble } from "./render/renderEventBubble.js";
import { renderGrid } from "./render/renderGrid.js";
import { renderSnake } from "./render/renderSnake.js";

const DEFAULT_OUTPUT_PATH = "dist/wolverine-snake.svg";

interface CliArgs {
  readonly username: string;
  readonly output: string;
  readonly bodyLength: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let username: string | undefined;
  let output = DEFAULT_OUTPUT_PATH;
  let bodyLength = DEFAULT_SNAKE_BODY_LENGTH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--username") {
      username = argv[i + 1];
      i += 1;
    } else if (arg === "--output") {
      output = argv[i + 1] ?? output;
      i += 1;
    } else if (arg === "--body-length") {
      const raw = argv[i + 1];
      bodyLength = raw ? Number(raw) : bodyLength;
      i += 1;
    }
  }

  username = username ?? process.env.GITHUB_REPOSITORY_OWNER;
  if (!username) {
    throw new Error(
      "Missing GitHub username: pass --username <login> or set GITHUB_REPOSITORY_OWNER.",
    );
  }
  if (!Number.isFinite(bodyLength) || bodyLength < 1) {
    throw new Error("--body-length must be a positive integer.");
  }

  return { username, output, bodyLength };
}

function renderSvgDocument(
  width: number,
  height: number,
  gridMarkup: string,
  bubbleMarkup: string,
  snakeMarkup: string,
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    gridMarkup,
    bubbleMarkup,
    snakeMarkup,
    `</svg>`,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required to query the GitHub GraphQL API.");
  }

  const grid = await fetchContributions({ username: args.username, githubToken });
  const solution = solveSnakePath(grid, { bodyLength: args.bodyLength });
  const { width, height } = svgDimensionsFor(grid);

  const svg = renderSvgDocument(
    width,
    height,
    renderGrid(grid),
    renderEventBubble(grid, solution.steps, solution.bodyLength),
    renderSnake(solution.steps, solution.bodyLength),
  );

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, svg, "utf8");

  console.log(
    `Wrote ${args.output} (${solution.totalContributedCells} contributed cells, ${solution.steps.length} steps).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
