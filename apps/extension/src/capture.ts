import { parseKoshkoProtocolWindowMessageV1 } from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  type CaptureTransportMessage,
} from './messaging/messages';

const CAPTURE_STATE = Symbol.for('koshko.capture.v1');

interface CaptureGlobal extends Window {
  [CAPTURE_STATE]?: { stop: () => void };
}

export type CaptureDelivery = (message: CaptureTransportMessage) => void | Promise<void>;

export function startCapture(deliver: CaptureDelivery): () => void {
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
    let payload: CaptureTransportMessage;
    if (parsed.type === 'signal') {
      payload = { type: PANEL_MESSAGE_CAPTURE, kind: 'signal', signal: parsed.signal, ...metadata };
    } else if (parsed.type === 'error') {
      payload = { type: PANEL_MESSAGE_CAPTURE, kind: 'error', error: parsed.error, ...metadata };
    } else {
      payload = { type: PANEL_MESSAGE_CAPTURE, kind: 'state-mutation', mutation: parsed.mutation, ...metadata };
    }

    try {
      void Promise.resolve(deliver(payload)).catch(() => {});
    } catch {
      // Capture delivery must never break the observed page.
    }
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

export function startChromeCapture(): () => void {
  return startCapture((message) => chrome.runtime.sendMessage(message));
}

function createNavigationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
