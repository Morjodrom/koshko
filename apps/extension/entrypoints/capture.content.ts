import { defineContentScript } from 'wxt/sandbox';
import { startCapture } from '../src/capture';

export default defineContentScript({
  allFrames: true,
  runAt: 'document_start',
  registration: 'runtime',
  main() {
    startCapture();
  },
});
