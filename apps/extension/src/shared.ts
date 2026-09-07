export const STORAGE_KEY = 'koshko:origins';
export const CONTENT_SCRIPT_ID_PREFIX = 'koshko-capture';
export const CONTENT_SCRIPT_JS_PATH = 'content-scripts/capture.js';
export const PANEL_PORT_PREFIX = 'koshko-panel:';
export const PANEL_MESSAGE_CAPTURE = 'koshko:capture';
export const PANEL_MESSAGE_SYNC_ORIGINS = 'koshko:sync-origins';
export const PANEL_MESSAGE_ACTIVATE_ORIGIN = 'koshko:activate-origin';
export const PANEL_MESSAGE_RECONCILE_PERMISSIONS = 'koshko:reconcile-permissions';
export const PANEL_MESSAGE_SET_PAUSED = 'koshko:set-paused';
export const PANEL_MESSAGE_CLEAR = 'koshko:clear';

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

export type CaptureTransportMessage =
  | CaptureSignalTransportMessage
  | CaptureStateMutationTransportMessage;

export interface SyncOriginsMessage {
  type: typeof PANEL_MESSAGE_SYNC_ORIGINS;
  origins: string[];
}

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

export interface SetPausedMessage {
  type: typeof PANEL_MESSAGE_SET_PAUSED;
  paused: boolean;
}

export interface ClearMessage {
  type: typeof PANEL_MESSAGE_CLEAR;
}

export type BackgroundMessage =
  | CaptureTransportMessage
  | SyncOriginsMessage
  | ActivateOriginMessage
  | ReconcilePermissionsMessage
  | SetPausedMessage
  | ClearMessage;

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

export type PanelCaptureMessage =
  | PanelSignalCaptureMessage
  | PanelStateMutationCaptureMessage;
