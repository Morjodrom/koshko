# Neutral demo

Development-only, disposable Vite demo for Actor Flow.

## Run

```bash
npm run dev:demo
```

## What it shows

- One top page with a `Run flow` button.
- Exactly two iframe instances of the same `frame.html` page.
- The top page emits User → Host and Host → Widget signals, then asks both frames to emit Widget → Host signals.
- Each frame has a button to emit a manual widget event.

## Install in Google Chrome or Chromium-based browsers

1. Start the demo: `npm run dev:demo`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `apps/extension/.output/chrome-mv3-dev/chrome-mv3`.
6. Open the extension's **Options** page and grant `http://127.0.0.1:5173`.
7. Open or reload the demo at `http://127.0.0.1:5173`.
8. Open Chrome DevTools, select **Actor Flow**, then use the page controls to emit signals.

## Notes

- This is a temporary prototype.
- It intentionally uses only static HTML pages and minimal styling.
- No production build is provided.
