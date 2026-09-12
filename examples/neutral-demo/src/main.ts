import { startCapture, startConsoleCapture } from '../../../apps/extension/src/embedded';
import { createEmbeddedObservationHost } from './embedded-host';

const host = createEmbeddedObservationHost();
startCapture(host.captureTop);
startConsoleCapture();
window.addEventListener('pagehide', () => host.dispose(), { once: true });

void import('./main-app');
