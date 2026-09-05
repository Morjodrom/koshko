# Repository Guidelines

## Project Structure & Module Organization

This is an npm-workspaces TypeScript prototype. Keep shared behavior in `packages/` and runnable code in `apps/` or `examples/`:

- `apps/extension/` contains the WXT Manifest V3 extension. Browser entry points live in `entrypoints/`; implementation, UI, styles, and tests live in `src/`.
- `packages/protocol/` owns signal types, validation, and normalization.
- `packages/emitter/` exposes the page-side `koshko` emitter.
- `examples/neutral-demo/` is the Vite test page used for manual extension checks.
- `koshko-devtools-requirements.md` records requirements. Do not commit generated `.output/`, `.wxt/`, `dist/`, or `coverage/` directories.

## Build, Test, and Development Commands

Run commands from the repository root:

- `npm ci` installs the exact dependency versions from `package-lock.json`.
- `npm run dev:demo` serves the demo at `http://127.0.0.1:5173`.
- `npm run dev:extension` starts WXT and writes the unpacked Chrome extension under `apps/extension/.output/chrome-mv3-dev/chrome-mv3/`.
- `npm test` runs every workspace's Vitest suite.
- `npm run typecheck` runs strict TypeScript checks across workspaces without emitting files.

For a focused check, use `npm test --workspace=@koshko/protocol`.

## Coding Style & Naming Conventions

Use ES modules and strict TypeScript. Follow the existing style: two-space indentation, single quotes, semicolons, trailing commas in multiline structures, and explicit return types on exported APIs. Use `PascalCase` for classes, interfaces, and types; `camelCase` for functions and variables; and uppercase constants such as `CHANNEL`. Validate untrusted window-message data before use. No formatter or linter is configured, so match nearby code and run type checking.

## Testing Guidelines

Vitest runs in the Node environment. Place tests beside their implementation as `*.test.ts`; organize them with descriptive `describe` and behavior-focused `it` blocks. Add tests for validation failures, normalization/redaction, ordering, navigation resets, and emitter transport. Run `npm test` and `npm run typecheck` before submitting changes. Manually load the generated extension in Chrome when changing permissions, entry points, or panel UI.

## Commit & Pull Request Guidelines

This checkout has no readable VCS history, so no established commit convention can be inferred. Use short, imperative, scoped subjects (for example, `protocol: reject malformed actor references`). Pull requests should explain the behavior change, list automated and manual checks, and link the relevant issue or requirement. Include screenshots for panel/options UI changes and call out any manifest permission or data-handling changes.

## Security & Privacy

Preserve the prototype's local-only, in-memory model. Request the narrowest host permissions possible, never add remote-code execution, and ensure payloads are validated and redacted before they reach extension views or exports.
