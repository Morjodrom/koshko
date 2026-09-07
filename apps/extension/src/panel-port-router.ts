import {
  PANEL_MESSAGE_HEARTBEAT,
  PANEL_MESSAGE_READY,
  PANEL_PORT_PREFIX,
  parseTabId,
  type BackgroundToPanelControlMessage,
  type PanelToBackgroundControlMessage,
} from './shared';

export interface BackgroundPanelPort {
  name: string;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
  postMessage(message: unknown): void;
  disconnect(): void;
}

export type PanelPortsByTab = Map<number, Set<BackgroundPanelPort>>;

export type PanelPortRegistrationResult = 'ignored' | 'invalid' | 'registered';

export function registerPanelPort(
  port: BackgroundPanelPort,
  panelPorts: PanelPortsByTab,
): PanelPortRegistrationResult {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) {
    return 'ignored';
  }

  const tabId = parseTabId(port.name.slice(PANEL_PORT_PREFIX.length));
  if (tabId == null) {
    return 'invalid';
  }

  const ports = panelPorts.get(tabId) ?? new Set<BackgroundPanelPort>();
  ports.add(port);
  panelPorts.set(tabId, ports);

  port.onMessage.addListener((message: unknown) => {
    if (!isPanelControlMessage(message)) return;

    // A valid heartbeat intentionally has no side effects beyond waking the
    // service worker while the DevTools panel remains attached.
  });
  port.onDisconnect.addListener(() => {
    const current = panelPorts.get(tabId);
    current?.delete(port);
    if (current?.size === 0) {
      panelPorts.delete(tabId);
    }
  });
  port.postMessage({ type: PANEL_MESSAGE_READY } satisfies BackgroundToPanelControlMessage);
  return 'registered';
}

function isPanelControlMessage(message: unknown): message is PanelToBackgroundControlMessage {
  return Boolean(
    message
    && typeof message === 'object'
    && (message as { type?: unknown }).type === PANEL_MESSAGE_HEARTBEAT,
  );
}
