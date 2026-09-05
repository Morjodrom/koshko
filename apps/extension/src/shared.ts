export const STORAGE_KEY = 'actor-flow:origins';
export const CONTENT_SCRIPT_ID_PREFIX = 'actor-flow-capture';
export const CONTENT_SCRIPT_JS_PATH = 'content-scripts/capture.js';
export const PANEL_PORT_PREFIX = 'actor-flow-panel:';
export const PANEL_MESSAGE_CAPTURE = 'actor-flow:capture';
export const PANEL_MESSAGE_SYNC_ORIGINS = 'actor-flow:sync-origins';
export const PANEL_MESSAGE_SET_PAUSED = 'actor-flow:set-paused';
export const PANEL_MESSAGE_CLEAR = 'actor-flow:clear';

export interface CaptureTransportMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  signal: unknown;
  observedAt: number;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export interface SyncOriginsMessage {
  type: typeof PANEL_MESSAGE_SYNC_ORIGINS;
  origins: string[];
}

export interface SetPausedMessage {
  type: typeof PANEL_MESSAGE_SET_PAUSED;
  paused: boolean;
}

export interface ClearMessage {
  type: typeof PANEL_MESSAGE_CLEAR;
}

export type BackgroundMessage = CaptureTransportMessage | SyncOriginsMessage | SetPausedMessage | ClearMessage;

export interface PanelCaptureMessage {
  type: typeof PANEL_MESSAGE_CAPTURE;
  captured: import('@actor-flow/protocol').CapturedSignalV1;
}
