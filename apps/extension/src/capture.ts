import { parseKoshkoProtocolWindowMessageV1 } from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  type CaptureTransportMessage,
} from './messaging/messages';
import { normalizePostMessageData, type PostMessageSource } from './post-message';

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
  let sequence = 0;

  const onMessage = (event: MessageEvent): void => {
    try {
      const observedAt = Date.now();
      const raw = {
        type: PANEL_MESSAGE_CAPTURE,
        kind: 'post-message' as const,
        id: createMessageId(),
        sequence: ++sequence,
        observedAt,
        origin: typeof event.origin === 'string' ? event.origin : '',
        source: classifySource(event.source),
        data: normalizePostMessageData(event.data),
        navigationId,
        frameUrl: location.href,
        frameOrigin: location.origin,
      };
      void chrome.runtime.sendMessage(raw).catch(() => {});

      if (raw.source !== 'self') return;
      const parsed = parseKoshkoProtocolWindowMessageV1(event.data);
      if (!parsed) return;
      const metadata = {
        observedAt,
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
      void chrome.runtime.sendMessage(payload).catch(() => {});
    } catch {
      // A hostile MessageEvent must never affect the inspected application.
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

function createNavigationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createMessageId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function classifySource(source: MessageEvent['source']): PostMessageSource {
  if (source == null) return 'none';
  if (source === window) return 'self';
  try {
    if (source === window.parent) return 'parent';
    if (source === window.opener) return 'opener';
  } catch {
    return 'other';
  }
  return 'other';
}
