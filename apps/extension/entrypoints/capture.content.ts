import { defineContentScript } from 'wxt/sandbox';
import { injectScript } from 'wxt/client';
import { startCapture } from '../src/capture';
import { startUserEventTracking } from '../src/user-event-capture';

export default defineContentScript({
  // Runtime registration supplies the granted origins. WXT's development
  // reloader still expects this field to be an array.
  matches: [],
  allFrames: true,
  runAt: 'document_start',
  registration: 'runtime',
  main() {
    startCapture();
    void startUserEventTracking();
    void injectScript('/console-capture.js').catch(() => {});
  },
});
