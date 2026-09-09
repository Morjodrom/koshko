# Koshko Inspector prototype

Disposable Chrome/Chromium-only prototype for inspecting `koshko` window messages emitted by instrumented pages.

## First MVP requirements

- Chrome/Chromium only.
- Capture only explicit `koshko` window messages.
- Validate and redact payloads before they reach the panel.
- Show four focused views in DevTools:
  - Timeline
  - Log
  - Global State
  - AI Log
- Keep everything in-memory and easy to throw away later.
- No search, import, analytics, remote code, or production packaging.
- Local demo is dev-only: two static HTML pages served by Vite.

## Repo layout

- `apps/extension/` — WXT MV3 DevTools extension
- `examples/neutral-demo/` — minimal Vite demo with two pages
- `packages/protocol/` — protocol validation and normalization
- `packages/emitter/` — tiny page-side emitter helper
- `packages/nanostores/` — optional, development-only Nano Stores adapter

The extension depends only on `packages/protocol/`. State-library adapters stay
in separate packages so adding support for another state manager does not grow
the extension or couple its release cycle to that library. See
[`docs/integrations.md`](docs/integrations.md) for the integration architecture
and consumer setup. Tarball maintainers should also follow
[`docs/package-distribution.md`](docs/package-distribution.md).

## Run locally

### 1) Start the demo site

```bash
npm run dev:demo
```

This starts Vite on `http://127.0.0.1:5173`.

### 2) Start the extension dev server

```bash
npm run dev:extension
```

WXT will build a dev-only Chrome extension output under
`apps/extension/.output/chrome-mv3-dev/chrome-mv3/`.

## Simplest Chrome install steps

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated folder:
   - `apps/extension/.output/chrome-mv3-dev/chrome-mv3`
5. Open the extension’s **Options** page.
6. Enter the origin you want to inspect and grant it.
   - For the local demo, use `http://127.0.0.1:5173`
   - For a real product, use that product’s origin
7. Reload the target tab.
8. Open DevTools on that tab.
9. Select the **Koshko** panel.
10. Click **Run flow** in the demo page or trigger the instrumented product actions.

## How to inspect a real web product

1. Add the product’s origin in the extension Options page.
2. Grant permission.
3. Reload the product tab.
4. Open DevTools and select **Koshko**.
5. Trigger the app action that emits `koshko` messages.
6. Read the Timeline or Log panel, or open **AI Log** to copy a compact diagnostic trace into an LLM chat.

The AI Log combines chronological signals, state mutations, and the latest reconstructed state in a prompt-ready text capsule. Choose an approximate 8k, 16k, or 32k token budget to retain the newest coherent suffix, or choose Full log. Token counts are conservative estimates and vary by model. Koshko does not send the trace to a remote service; **Copy for AI** only writes it to the local clipboard.

Important: the extension cannot infer app semantics or discover module-local
store instances by itself. A real product must emit messages with the shared
`@koshko/emitter` helper, or explicitly register selected Nano Stores with the
development-only `@koshko/nanostores` adapter.

## Notes

- The demo has **no production build**. It is meant to be transient.
- The extension keeps state only in memory.
- The panel is intentionally plain and minimal.
