import { parseKoshkoProtocolWindowMessageV1 } from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  type CaptureTransportMessage,
} from './shared';

export function startCapture(): () => void {
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

  return () => window.removeEventListener('message', onMessage);
}

function createNavigationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
