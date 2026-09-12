# Neutral demo

Development-only, local Vite fixture for manual Koshko Inspector checks,
scenario regression tests, and embedded-inspector Playwright coverage.

## Run

```bash
npm run dev:demo
```

The page includes the same Inspector UI in a resizable right-hand iframe dock.
The top page and both registered widget iframes send locally captured signals,
state mutations, and browser errors through a validated, same-origin bridge.
The dock can be collapsed and becomes a full-width section on narrow screens.
It is a test fixture, not an embeddable production API.

## Embedded E2E

```bash
npm run test:e2e
```

The embedded suite uses ordinary Playwright locators against the inspector
iframe. The optional Chromium-only MV3 coexistence smoke is intentionally
separate because it builds and loads the real unpacked extension:

```bash
npm run test:e2e:extension
```

## Scenarios

The page creates four actor types: **User**, **Host application**, **Client SDK**, and two **Widget** instances (`embedded` and `processing`). Every top-level button click creates a fresh correlation ID.

- **Successful flow** covers user → host, host → SDK, SDK/host → both widgets, internal widget events, and successful widget → host replies.
- **Failure and recovery** covers warning/error severity, host and widget self-targeted messages, and a caused-by chain through retry and recovery.
- **Metadata-rich flow** covers nested details, tags, context, correlations, causes, and diagnostics from both widget instances.

The in-page log is only a local aid; Koshko captures the signals independently from the top page and each iframe. The widget button can also emit a local metadata-rich flow.

## Large global state fixture

Use the **Generate large state** controls to add a reproducible fixture under the
`largeFixture` branch in Koshko Global State. Choose a maximum depth from 2 to 5
and between 1 and 10 root objects. The same pair of inputs always produces the
same nested arrays, objects, numbers, booleans, short strings, and long string.
Generating it again replaces only `largeFixture`; the other demo state remains.

## Nano Stores bridge

The page also registers two Nano Stores with `@koshko/nanostores` during
development:

- `counter` is an atom with increment and reset actions;
- `profile` is a map with name and visit-count mutations.

Use the **Nano Stores** controls to mutate them. Their local values are shown on the page, while Koshko Global State contains them under the `nanostores` branch alongside the existing manually controlled `demo` branch:

```json
{
  "demo": { "message": "Added from the neutral demo", "count": 1 },
  "nanostores": {
    "counter": 1,
    "profile": { "name": "Ada", "visits": 1 }
  }
}
```

The optional bridge and console logger live in `src/devtools.ts`. The main
entry dynamically imports that module behind `import.meta.env.DEV`, mirroring
the recommended integration pattern for real products. Both packages are
development dependencies; `nanostores` remains the application's ordinary
runtime dependency.

## Install in Google Chrome or Chromium-based browsers

1. Start the demo: `npm run dev:demo`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `apps/extension/.output/chrome-mv3-dev/chrome-mv3`.
6. Open the extension's **Options** page and grant `http://127.0.0.1:5173`.
7. Open or reload the demo at `http://127.0.0.1:5173`.
8. Open Chrome DevTools, select **Koshko Inspector**, then run each scenario.

No captured data leaves the browser.
