import { startCapture, startConsoleCapture } from '../../../apps/extension/src/embedded';
import { postFrameCapture } from './embedded-host';
import { getConfiguredParentOrigin } from './parent-origin';

const parentOrigin = getConfiguredParentOrigin();
startCapture((capture) => postFrameCapture(capture, parentOrigin));
startConsoleCapture();
void import('./frame-app');
