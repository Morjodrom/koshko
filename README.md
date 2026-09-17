# Koshko Inspector

> **Pre-release.** A local Chrome/Chromium DevTools inspector for frontend
> application flows.

The source repository is public, but the npm packages are **not published
yet**. They are prepared for a future public release from this monorepo.

Koshko captures explicit `koshko` signals, browser JavaScript errors, and
optional state mutations from an inspected page and permitted frames. Use it to
debug frontend flows, inspect actor-to-actor events, and review state changes
without adding a backend, telemetry, or remote export.

## Capabilities

- Validates, normalizes, and redacts captured payloads.
- Captures `console.error`, uncaught errors, and unhandled promise rejections.
- Supports per-origin permissions, including cross-origin frames.
- Pauses, clears, and exports captured signals as JSONL.
- Keeps captured data in local DevTools-session memory.
- Provides `@koshko/emitter` and an optional development-only Nano Stores
  adapter for application instrumentation.

## DevTools tabs

| Tab | Use |
| --- | --- |
| **Timeline** | Actor lanes with explicit source-to-target links, timestamps, errors, and expandable event details. |
| **Log** | Chronological signals, errors, and state mutations; filter by type or actor and search visible data. |
| **Global State** | Reconstructed JSON state with snapshot history, live/pinned selection, search, and copy support. |
| **AI Log** | Local, prompt-ready trace of relevant entries and state. Select an 8k, 16k, 32k, 64k, or full context budget and copy it to the clipboard. |

Koshko does not send AI Log content to an external service.

## Technical stack

| Area | Technology |
| --- | --- |
| Extension | WXT, Manifest V3, Chrome/Chromium DevTools APIs |
| Panel | React 19, TypeScript, `@xyflow/react`, `json-edit-react` |
| Protocol | `@koshko/protocol`, `@koshko/emitter`, optional `@koshko/nanostores` |
| Demo | Vite, Nano Stores |
| Tooling | tsup, Vitest, strict TypeScript |

## Packages

| Package | Purpose | Status |
| --- | --- | --- |
| `@koshko/protocol` | Public message types, validation, normalization, and state helpers. | Pre-publication |
| `@koshko/emitter` | State-library-neutral page-side signal and state transport. | Pre-publication |
| `@koshko/nanostores` | Optional development-only Nano Stores adapter. | Pre-publication |

Until the first registry release, use the local tarball workflow in the
[package distribution guide](docs/package-distribution.md). Do not assume
these package names can be installed from npm yet.

## Local development

Requirements: Node.js/npm and Chrome or Chromium with Developer mode. The
supported local toolchain is Node.js `^22.11 || ^24 || >=26` and npm
`>=10.9.0` (CI currently uses Node.js 24).

```bash
npm ci
```

Start the demo and extension in separate terminals:

```bash
npm run dev:demo
npm run dev:extension
```

The demo runs at `http://127.0.0.1:5173`. The unpacked extension is written to:

```text
apps/extension/.output/chrome-mv3-dev/chrome-mv3/
```

Load it in `chrome://extensions`:

1. Enable **Developer mode**.
2. Click **Load unpacked** and select the directory above.
3. Open the demo, DevTools, and the **Koshko** panel.
4. Grant `http://127.0.0.1:5173` access when prompted.

For another application, grant its origin and add development-only instrumentation
with `@koshko/emitter`. See the [integration guide](docs/integration-guide.md)
and [integration architecture](docs/integrations.md).

## Local build and checks

```bash
npm run build:packages
npm exec --workspace=@koshko/extension -- wxt build --browser chrome
npm run pack:packages
npm test
npm run typecheck
```

The extension build uses the same unpacked output directory. Package tarballs
are written to ignored `artifacts/`; see
[package distribution](docs/package-distribution.md).

## Layout

- `apps/extension/` — extension, DevTools panel, and Options page.
- `examples/neutral-demo/` — Vite demo.
- `packages/protocol/` — wire types, validation, normalization, and schema.
- `packages/emitter/` — page-side emitter.
- `packages/nanostores/` — optional Nano Stores adapter.
- `docs/` — integration and package documentation.

## Scope

Koshko reads explicit `koshko` messages, selected JavaScript failures, state
mutations, and raw `window.postMessage` traffic delivered to permitted inspected
frames. Raw messages are shown as diagnostic evidence; Koshko does not infer
application semantics from them. It does not record the DOM, capture network
traffic, replay actions, or upload captured data. Keep instrumentation behind a
compile-time development flag so it is excluded from production bundles.

Raw message payloads can contain private application data. Koshko applies
bounded serialization and sensitive-key redaction before display, AI copy, or
export, but applications should still avoid placing credentials or secrets in
browser messages.
