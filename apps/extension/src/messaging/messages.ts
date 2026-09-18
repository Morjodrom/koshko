import type { CapturedPostMessage, RawPostMessage } from '../post-message';
import type { CapturedUserEvent } from '../user-event-tracking';

export const STORAGE_KEY = 'koshko:origins';
export const CONTENT_SCRIPT_ID_PREFIX = 'koshko-capture';
export const CONTENT_SCRIPT_JS_PATH = 'content-scripts/capture.js';
export const PANEL_PORT_PREFIX = 'koshko-panel:';
export const PANEL_MESSAGE_CAPTURE = 'koshko:capture';
export const PANEL_MESSAGE_ACTIVATE_ORIGIN = 'koshko:activate-origin';
export const PANEL_MESSAGE_RECONCILE_PERMISSIONS = 'koshko:reconcile-permissions';
export const PANEL_MESSAGE_READY = 'koshko:ready';
export const PANEL_MESSAGE_HEARTBEAT = 'koshko:heartbeat';

export interface CaptureSignalTransportMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'signal';
  signal: unknown;
  observedAt: number;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export interface CaptureStateMutationTransportMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'state-mutation';
  mutation: unknown;
  observedAt: number;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export interface CaptureErrorTransportMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'error';
  error: unknown;
  observedAt: number;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export interface CapturePostMessageTransportMessage extends RawPostMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'post-message';
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export type CaptureTransportMessage =
  | CaptureSignalTransportMessage
  | CaptureStateMutationTransportMessage
  | CaptureErrorTransportMessage
  | CapturePostMessageTransportMessage;

export interface ActivateOriginMessage {
  type: typeof PANEL_MESSAGE_ACTIVATE_ORIGIN;
  origin: string;
  tabId?: number;
}

export interface ReconcilePermissionsMessage {
  type: typeof PANEL_MESSAGE_RECONCILE_PERMISSIONS;
}

export interface ActivationResponse {
  ok: boolean;
  captureStarted: boolean;
  error?: string;
}

export interface PanelReadyMessage {
  type: typeof PANEL_MESSAGE_READY;
}

export interface PanelHeartbeatMessage {
  type: typeof PANEL_MESSAGE_HEARTBEAT;
}

export type BackgroundToPanelControlMessage = PanelReadyMessage;
export type PanelToBackgroundControlMessage = PanelHeartbeatMessage;

export type BackgroundMessage =
  | CaptureTransportMessage
  | import('../user-event-tracking').UserEventMessage
  | ActivateOriginMessage
  | ReconcilePermissionsMessage;

export interface PanelSignalCaptureMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'signal';
  captured: import('@koshko/protocol').CapturedSignalV1;
}

export interface PanelStateMutationCaptureMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'state-mutation';
  captured: import('@koshko/protocol').CapturedStateMutationV1;
}

export interface PanelErrorCaptureMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'error';
  captured: import('@koshko/protocol').CapturedErrorV1;
}

export interface PanelEventCaptureMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'event';
  captured: CapturedUserEvent;
}

export interface PanelPostMessageCaptureMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  kind: 'post-message';
  captured: CapturedPostMessage;
}

export type PanelCaptureMessage =
  | PanelSignalCaptureMessage
  | PanelStateMutationCaptureMessage
  | PanelErrorCaptureMessage
  | PanelPostMessageCaptureMessage
  | PanelEventCaptureMessage;

export function parseTabId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const tabId = Number(value);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}
