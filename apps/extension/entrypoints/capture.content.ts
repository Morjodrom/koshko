import { defineContentScript } from 'wxt/sandbox';
import { injectScript } from 'wxt/client';
import { startCapture } from '../src/capture';

export default defineContentScript({
  // Runtime registration supplies the granted origins. WXT's development
  // reloader still expects this field to be an array.
  matches: [],
  allFrames: true,
  runAt: 'document_start',
  registration: 'runtime',
  main() {
    startCapture();
    void injectScript('/console-capture.js').catch(() => {});
  },
});
