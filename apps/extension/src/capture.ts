import { parseActorFlowWindowMessageV1 } from '@actor-flow/protocol';
import { PANEL_MESSAGE_CAPTURE } from './shared';

export function startCapture(): void {
  const navigationId = createNavigationId();

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }

    const parsed = parseActorFlowWindowMessageV1(event.data);
    if (!parsed) {
      return;
    }

    const payload = {
      type: PANEL_MESSAGE_CAPTURE,
      signal: parsed.signal,
      observedAt: Date.now(),
      navigationId,
      frameUrl: location.href,
      frameOrigin: location.origin,
    };

    void chrome.runtime.sendMessage(payload).catch(() => {});
  });
}

function createNavigationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
