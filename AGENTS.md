# Repository Guidelines

## Project Structure & Module Organization

This is an npm-workspaces TypeScript prototype. Keep shared behavior in `packages/` and runnable code in `apps/` or `examples/`:

- `apps/extension/` contains the WXT Manifest V3 extension. Browser entry points live in `entrypoints/`; implementation, UI, styles, and tests live in `src/`.
- `packages/protocol/` owns signal types, validation, and normalization.
- `packages/emitter/` exposes the page-side `koshko` emitter.
- `packages/nanostores/` is the optional development-only Nano Stores adapter.
- `examples/neutral-demo/` is the Vite test page used for manual extension checks.
- `koshko-inspector-requirements.md` records requirements. Do not commit generated `.output/`, `.wxt/`, `dist/`, or `coverage/` directories.

## Build, Test, and Development Commands

Run commands from the repository root:

- `npm ci` installs the exact dependency versions from `package-lock.json`.
- `npm run dev:demo` serves the demo at `http://127.0.0.1:5173`.
- `npm run dev:extension` starts WXT and writes the unpacked Chrome extension under `apps/extension/.output/chrome-mv3-dev/chrome-mv3/`.
- `npm run build:packages` builds the protocol, emitter, and Nano Stores packages in dependency order.
- `npm run build:apps` builds the neutral demo and Chrome extension; generated output appears under `examples/neutral-demo/dist/` and `apps/extension/.output/`.
- `npm run pack:packages` builds those packages and writes pilot tarballs under `artifacts/`.
- `npm run smoke:packages` installs the packed tarballs into a temporary offline consumer project and verifies their public runtime imports; run `npm run pack:packages` first.
- `npm test` builds the packages, then runs every workspace's Vitest suite.
- `npm run typecheck` builds the packages, then runs strict TypeScript checks across workspaces. The checks use `--noEmit`, but the prerequisite package build recreates ignored `dist/` output.

For a focused check, use `npm test --workspace=@koshko/protocol`.

CI uses Node.js 24 and runs `npm ci`, `npm test`, `npm run typecheck`,
`npm run build:apps`, `npm run pack:packages`, and
`npm run smoke:packages`, in that order. Use this sequence for full CI parity.

## Versioning

The canonical Koshko Inspector extension version is the `version` field in
`apps/extension/package.json`; WXT exposes it in the extension manifest. Bump
that version only when the extension deliverable or its build behavior changes.
Package-only, documentation, test, and repository-metadata commits do not
require an extension version bump.

The public package versions and changelogs are managed by Changesets. The
current Changesets configuration keeps `@koshko/protocol`, `@koshko/emitter`,
and `@koshko/nanostores` in one fixed, lockstep release group. Use the root
commands `npm run changeset`, `npm run version:packages`, and
`npm run release:packages` for package releases. Use semantic versioning when
choosing versions and keep `package-lock.json` synchronized with dependency
changes.

## Coding Style & Naming Conventions

Use ES modules and strict TypeScript. Follow the existing style: two-space indentation, single quotes, semicolons, trailing commas in multiline structures, and explicit return types on exported APIs. Use `PascalCase` for classes, interfaces, and types; `camelCase` for functions and variables; and uppercase constants such as `CHANNEL`. Validate untrusted window-message data before use. No formatter or linter is configured, so match nearby code and run type checking.

## Testing Guidelines

Vitest runs in the Node environment. Place tests beside their implementation as `*.test.ts`; organize them with descriptive `describe` and behavior-focused `it` blocks. Add tests for validation failures, normalization/redaction, ordering, navigation resets, and emitter transport. Run `npm test` and `npm run typecheck` before submitting changes. Manually load the generated extension in Chrome when changing permissions, entry points, or panel UI.

## Commit & Pull Request Guidelines

The repository history uses short, imperative, scoped subjects such as
`extension: add opt-in user event tracking`, `packages: prepare public monorepo
releases`, and `docs: refresh product README`. Follow that convention. Pull
requests should explain the behavior change, list automated and manual checks,
and link the relevant issue or requirement. Include screenshots for
panel/options UI changes and call out any manifest permission or data-handling
changes.

## Security & Privacy

Preserve the prototype's local-only, in-memory model. Request the narrowest host permissions possible, never add remote-code execution, and ensure payloads are validated and redacted before they reach extension views or exports.
