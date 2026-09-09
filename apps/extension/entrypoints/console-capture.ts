import { defineUnlistedScript } from 'wxt/sandbox';
import { startConsoleCapture } from '../src/console-capture';

export default defineUnlistedScript(() => {
  startConsoleCapture();
});
