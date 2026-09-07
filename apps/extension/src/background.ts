import {
  normalizeCapturedSignalV1,
  normalizeCapturedStateMutationV1,
} from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  PANEL_MESSAGE_ACTIVATE_ORIGIN,
  PANEL_MESSAGE_RECONCILE_PERMISSIONS,
  PANEL_MESSAGE_SYNC_ORIGINS,
  PANEL_PORT_PREFIX,
  type CaptureTransportMessage,
  type BackgroundMessage,
  type PanelCaptureMessage,
} from './shared';
import { handleActionClick, PermissionCoordinator } from './permission-coordinator';

const panelPorts = new Map<number, Set<chrome.runtime.Port>>();
const permissionCoordinator = new PermissionCoordinator();

chrome.runtime.onInstalled.addListener(() => {
  void permissionCoordinator.reconcile();
});

chrome.runtime.onStartup.addListener(() => {
  void permissionCoordinator.reconcile();
});

chrome.permissions.onAdded.addListener(() => {
  void permissionCoordinator.reconcile();
});

chrome.permissions.onRemoved.addListener(() => {
  void permissionCoordinator.reconcile();
});

chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab, permissionCoordinator);
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

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    return;
  }

  if (message.type === PANEL_MESSAGE_CAPTURE) {
    void routeCaptureMessage(message, sender);
    return;
  }

  if (message.type === PANEL_MESSAGE_SYNC_ORIGINS) {
    if (Array.isArray(message.origins) && message.origins.every((origin) => typeof origin === 'string')) {
      void permissionCoordinator.replace(message.origins);
    }
    return;
  }

  if (message.type === PANEL_MESSAGE_ACTIVATE_ORIGIN) {
    if (
      typeof message.origin !== 'string'
      || (message.tabId != null && (!Number.isInteger(message.tabId) || message.tabId < 0))
    ) {
      sendResponse({
        ok: false,
        captureStarted: false,
        error: 'Invalid access activation request.',
      });
      return;
    }

    void permissionCoordinator.activate(message.origin, message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === PANEL_MESSAGE_RECONCILE_PERMISSIONS) {
    void permissionCoordinator.reconcile().then(
      (origins) => sendResponse({ ok: true, origins }),
      (error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not reconcile site access.',
      }),
    );
    return true;
  }
});

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
