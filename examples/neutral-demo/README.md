# Neutral demo

Development-only, local Vite fixture for manual Koshko Dev Tools checks and scenario regression tests.

## Run

```bash
npm run dev:demo
```

## Scenarios

The page creates four actor types: **User**, **Host application**, **Client SDK**, and two **Widget** instances (`embedded` and `processing`). Every top-level button click creates a fresh correlation ID.

- **Successful flow** covers user → host, host → SDK, SDK/host → both widgets, internal widget events, and successful widget → host replies.
- **Failure and recovery** covers warning/error severity, host and widget self-targeted messages, and a caused-by chain through retry and recovery.
- **Metadata-rich flow** covers nested details, tags, context, correlations, causes, and diagnostics from both widget instances.

The in-page log is only a local aid; Koshko captures the signals independently from the top page and each iframe. The widget button can also emit a local metadata-rich flow.

## Install in Google Chrome or Chromium-based browsers

1. Start the demo: `npm run dev:demo`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `apps/extension/.output/chrome-mv3-dev/chrome-mv3`.
6. Open the extension's **Options** page and grant `http://127.0.0.1:5173`.
7. Open or reload the demo at `http://127.0.0.1:5173`.
8. Open Chrome DevTools, select **Koshko Dev Tools**, then run each scenario.

No production build is provided and no data leaves the browser.
