# Koshko Dev Tools prototype

Disposable Chrome/Chromium-only prototype for inspecting `koshko` window messages emitted by instrumented pages.

## First MVP requirements

- Chrome/Chromium only.
- Capture only explicit `koshko` window messages.
- Validate and redact payloads before they reach the panel.
- Show three simple views in DevTools:
  - Timeline
  - Log
  - Global State
- Keep everything in-memory and easy to throw away later.
- No search, import, analytics, remote code, or production packaging.
- Local demo is dev-only: two static HTML pages served by Vite.

## Repo layout

- `apps/extension/` — WXT MV3 DevTools extension
- `examples/neutral-demo/` — minimal Vite demo with two pages
- `packages/protocol/` — protocol validation and normalization
- `packages/emitter/` — tiny page-side emitter helper
- `packages/nanostores/` — Nano Stores state bridge for Global State

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
6. Read the Timeline or Log panel.

Important: the extension cannot infer app semantics by itself. A real product must emit messages with the shared `@koshko/emitter` helper, or register Nano Stores with `@koshko/nanostores` when that state manager is used.

## Notes

- The demo has **no production build**. It is meant to be transient.
- The extension keeps state only in memory.
- The panel is intentionally plain and minimal.
