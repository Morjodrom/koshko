import { parseKoshkoProtocolWindowMessageV1 } from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  type CaptureTransportMessage,
} from './shared';

const CAPTURE_STATE = Symbol.for('koshko.capture.v1');

interface CaptureGlobal extends Window {
  [CAPTURE_STATE]?: { stop: () => void };
}

export function startCapture(): () => void {
  const captureGlobal = window as CaptureGlobal;
  const existing = captureGlobal[CAPTURE_STATE];
  if (existing) {
    return existing.stop;
  }

  const navigationId = createNavigationId();

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window) {
      return;
    }

    const parsed = parseKoshkoProtocolWindowMessageV1(event.data);
    if (!parsed) {
      return;
    }

    const metadata = {
      observedAt: Date.now(),
      navigationId,
      frameUrl: location.href,
      frameOrigin: location.origin,
    };
    const payload: CaptureTransportMessage = parsed.type === 'signal'
      ? { type: PANEL_MESSAGE_CAPTURE, kind: 'signal', signal: parsed.signal, ...metadata }
      : { type: PANEL_MESSAGE_CAPTURE, kind: 'state-mutation', mutation: parsed.mutation, ...metadata };

    void chrome.runtime.sendMessage(payload).catch(() => {});
  };
  window.addEventListener('message', onMessage);

  let stopped = false;
  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    window.removeEventListener('message', onMessage);
    if (captureGlobal[CAPTURE_STATE]?.stop === stop) {
      delete captureGlobal[CAPTURE_STATE];
    }
  };
  captureGlobal[CAPTURE_STATE] = { stop };
  return stop;
}

function createNavigationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
