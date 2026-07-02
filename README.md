# WolverineCommit.Snake

An animated SVG snake that eats its way through your GitHub contribution graph — themed around [Wolverine](https://github.com/WolverineFx/wolverine), the .NET event-driven application framework.

Instead of just a snake, think of it as a small event-driven system running on your profile:

- **The head is a Command.** Wherever the head moves next, a Command is being dispatched to a Handler.
- **Eating a cell is a Handler processing it.** Each contribution cell is a unit of work waiting to be handled.
- **The body is the message bus.** A fixed-length trail of body segments follows the head — messages in flight on the bus, not an ever-growing game-of-Snake tail.
- **Eating a cell marks it handled.** As the head passes over a contribution it fades out, like a domain event being consumed by its handler.

The snake crawls the contribution grid one cell at a time — a true, contiguous Snake that can never overlap its own body or detach from it — hunting toward your commits and eating each one as it reaches it.

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
