import {
  normalizeCapturedSignalV1,
  normalizeCapturedStateMutationV1,
} from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  PANEL_MESSAGE_SYNC_ORIGINS,
  PANEL_PORT_PREFIX,
  type CaptureTransportMessage,
  type BackgroundMessage,
  type PanelCaptureMessage,
} from './shared';
import { getStoredOrigins, setStoredOrigins, syncRegisteredContentScripts } from './registry';
import { normalizeOriginList } from './origins';

const panelPorts = new Map<number, Set<chrome.runtime.Port>>();

chrome.runtime.onInstalled.addListener(() => {
  void restoreOrigins();
});

chrome.runtime.onStartup.addListener(() => {
  void restoreOrigins();
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) {
    return;
  }

  const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
  if (!Number.isFinite(tabId) || tabId < 0) {
    port.disconnect();
    return;
  }

  const ports = panelPorts.get(tabId) ?? new Set<chrome.runtime.Port>();
  ports.add(port);
  panelPorts.set(tabId, ports);

  port.onDisconnect.addListener(() => {
    const current = panelPorts.get(tabId);
    current?.delete(port);
    if (current && current.size === 0) {
      panelPorts.delete(tabId);
    }
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender) => {
  if (message.type === PANEL_MESSAGE_CAPTURE) {
    void routeCaptureMessage(message, sender);
    return;
  }

  if (message.type === PANEL_MESSAGE_SYNC_ORIGINS) {
    void replaceOrigins(message.origins);
    return;
  }
});

async function restoreOrigins(): Promise<void> {
  const origins = await getStoredOrigins();
  await syncRegisteredContentScripts(origins);
}

async function replaceOrigins(origins: string[]): Promise<void> {
  const normalized = await setStoredOrigins(normalizeOriginList(origins));
  await syncRegisteredContentScripts(normalized);
}

async function routeCaptureMessage(message: CaptureTransportMessage, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId == null) {
    return;
  }

  const metadata = {
    observedAt: message.observedAt,
    tabId,
    frameId: sender.frameId ?? -1,
    documentId: sender.documentId,
    navigationId: message.navigationId,
    frameUrl: message.frameUrl,
    frameOrigin: message.frameOrigin,
  };

  const payload: PanelCaptureMessage = message.kind === 'signal'
    ? {
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'signal',
      captured: normalizeCapturedSignalV1({ signal: message.signal, ...metadata }),
    }
    : {
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'state-mutation',
      captured: normalizeCapturedStateMutationV1({ mutation: message.mutation, ...metadata }),
    };

  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) {
    return;
  }

  for (const port of ports) {
    port.postMessage(payload);
  }
}
