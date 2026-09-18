import {
  normalizeCapturedSignalV1,
  normalizeCapturedErrorV1,
  normalizeCapturedStateMutationV1,
} from '@koshko/protocol';
import { normalizeCapturedPostMessage } from './post-message';
import { getUserEventTrackingEnabled, normalizeCapturedUserEvent, parseUserEventMessage } from './user-event-tracking';
import {
  PANEL_MESSAGE_CAPTURE,
  PANEL_MESSAGE_ACTIVATE_ORIGIN,
  PANEL_MESSAGE_RECONCILE_PERMISSIONS,
  type CaptureTransportMessage,
  type BackgroundMessage,
  type PanelCaptureMessage,
} from './messaging/messages';
import { handleActionClick, PermissionCoordinator } from './browser/permission-coordinator';
import { registerPanelPort, type PanelPortsByTab } from './messaging/panel-port-router';

const panelPorts: PanelPortsByTab = new Map();
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
  if (registerPanelPort(port, panelPorts) === 'invalid') {
    port.disconnect();
  }
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    return;
  }

  if (message.type === PANEL_MESSAGE_CAPTURE) {
    void routeCaptureMessage(message, sender);
    return;
  }

  if (message.type === 'koshko:user-event') {
    void routeUserEventMessage(message, sender);
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

async function routeUserEventMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<void> {
  if (!await getUserEventTrackingEnabled().catch(() => false)) return;
  const event = parseUserEventMessage(message);
  const tabId = sender.tab?.id;
  if (!event || tabId == null) return;

  // Never trust page-provided routing metadata. The sender owns tab/frame identity.
  const captured = normalizeCapturedUserEvent({
    kind: 'event',
    id: `user-event:${event.navigationId}:${event.sequence}`,
    sequence: event.sequence,
    observedAt: event.occurredAt,
    eventType: event.eventType,
    ...(event.target ? { target: event.target } : {}),
    tabId,
    frameId: sender.frameId ?? -1,
    documentId: sender.documentId,
    navigationId: event.navigationId,
    frameUrl: event.frameUrl,
    frameOrigin: event.frameOrigin,
  });
  if (!captured) return;

  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) return;
  const payload: PanelCaptureMessage = {
    type: PANEL_MESSAGE_CAPTURE,
    kind: 'event',
    captured,
  };
  for (const port of ports) port.postMessage(payload);
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

  let payload: PanelCaptureMessage;
  if (message.kind === 'post-message') {
    const captured = normalizeCapturedPostMessage({
      ...message,
      ...metadata,
    });
    if (!captured) return;
    payload = {
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'post-message',
      captured,
    };
  } else if (message.kind === 'signal') {
    payload = {
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'signal',
      captured: normalizeCapturedSignalV1({ signal: message.signal, ...metadata }),
    };
  } else if (message.kind === 'error') {
    payload = {
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'error',
      captured: normalizeCapturedErrorV1({ error: message.error, ...metadata }),
    };
  } else {
    payload = {
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'state-mutation',
      captured: normalizeCapturedStateMutationV1({ mutation: message.mutation, ...metadata }),
    };
  }

  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) {
    return;
  }

  for (const port of ports) {
    port.postMessage(payload);
  }
}
