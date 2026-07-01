# WolverineCommit.Snake

An animated SVG snake that eats its way through your GitHub contribution graph — themed around [Wolverine](https://github.com/WolverineFx/wolverine), the .NET event-driven application framework.

Instead of just a snake, think of it as a small event-driven system running on your profile:

- **The head is a Command.** Wherever the head moves next, a Command is being dispatched to a Handler.
- **Eating a cell is a Handler processing it.** Each contribution cell is a unit of work waiting to be handled.
- **The body is the message bus.** Fixed-length, dashed connectors between nodes — a trail of messages in flight, not an ever-growing game-of-Snake tail.
- **Eating triggers an Event.** A small amber bubble appears at the eaten cell and travels back toward the tail, like a domain event being published and delivered to a downstream subscriber.

The snake only travels between cells that actually have contributions — empty days are skipped entirely, with the movement tweened smoothly between stops rather than marched across every grid line.

## Usage

Embed the generated SVG directly from the `output` branch:

```markdown
![wolverine-snake](https://raw.githubusercontent.com/MikeYC-Wang/WolverineCommit.Snake/output/dist/wolverine-snake.svg)
```

A GitHub Actions workflow (`.github/workflows/generate-snake.yml`) regenerates the SVG daily at 00:00 UTC, on every push to `main`, and on manual dispatch, then publishes it to the `output` branch so it never pollutes `main`'s history.

## Running locally

```bash
npm install
npm run build
GITHUB_TOKEN=<a token with read:user scope> node dist/index.js --username <github-login> --output dist/wolverine-snake.svg
```

## Development

```bash
npm test        # vitest unit tests, including adversarial pathfinding fixtures
npm run build   # TypeScript -> dist/
```

See `docs/tech-stack.md` and `docs/visual-design.md` for the full design rationale, color codes, and animation timing.

## License

MIT — see [LICENSE](./LICENSE).

## Credit

Inspired by the "GitHub contribution snake" genre of profile widgets popularized by projects like [Platane/snk](https://github.com/Platane/snk) — this project is an independent, from-scratch implementation with its own pathfinding and rendering, not a fork.
