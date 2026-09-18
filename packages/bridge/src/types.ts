import type {
  CapturedErrorV1,
  CapturedSignalV1,
  CapturedStateMutationV1,
  JsonValue,
} from '@koshko/protocol';

export type BridgeTraceKind = 'signal' | 'error' | 'state-mutation' | 'post-message';
export type BridgeErrorCode = 'authentication-failed' | 'invalid-message' | 'session-not-found' | 'request-not-found' | 'unsupported-version' | 'internal-error';
export type BridgeAiLogBudget = '8k' | '16k' | '32k' | '64k' | 'full';
export type BridgeAiLogSelectionMode = 'all' | 'causal-hybrid';
export type BridgeAiLogStateStatus = 'full' | 'focused' | 'empty' | 'omitted';

/** Metadata is supplied by the extension, never taken from captured page content. */
export interface BridgeSessionMetadata {
  sessionId: string;
  tabId: number;
  frameId: number;
  navigationId: string;
  pageUrl: string;
  pageOrigin: string;
  pageTitle?: string;
  startedAt: number;
}

export interface BridgeSession extends BridgeSessionMetadata {
  connectedAt: number;
}

export interface BridgeTraceBase {
  entryId: string;
  sessionId: string;
  capturedAt: number;
}

export interface BridgeSignalTraceEntry extends BridgeTraceBase {
  kind: 'signal';
  capture: CapturedSignalV1;
}

export interface BridgeErrorTraceEntry extends BridgeTraceBase {
  kind: 'error';
  capture: CapturedErrorV1;
}

export interface BridgeStateMutationTraceEntry extends BridgeTraceBase {
  kind: 'state-mutation';
  capture: CapturedStateMutationV1;
}

/** `messageType` and `data` are untrusted inert data, not executable bridge commands. */
export interface BridgePostMessageTraceEntry extends BridgeTraceBase {
  kind: 'post-message';
  messageType: string;
  data: JsonValue;
}

export type BridgeTraceEntry =
  | BridgeSignalTraceEntry
  | BridgeErrorTraceEntry
  | BridgeStateMutationTraceEntry
  | BridgePostMessageTraceEntry;

export interface BridgeStateSnapshot {
  snapshotId: string;
  sessionId: string;
  capturedAt: number;
  state: JsonValue;
}

export interface BridgeClientHello {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'client-hello';
  clientId: string;
  authToken: string;
  resumeSessionId?: string;
}

export interface BridgeServerReady {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'server-ready';
  session: BridgeSession;
}

export interface BridgeServerError {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'server-error';
  code: BridgeErrorCode;
  message: string;
  requestId?: string;
}

export interface BridgeServerAck {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'server-ack';
  sessionId: string;
  ackedEntryIds: string[];
}

export interface BridgeCaptureBatch {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'capture-batch';
  session: BridgeSessionMetadata;
  entries: BridgeTraceEntry[];
  stateSnapshot?: BridgeStateSnapshot;
}

/** The companion may request only a bounded, read-only formatted log. */
export interface BridgeAiLogRequest {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'ai-log-request';
  requestId: string;
  sessionId: string;
  budget: BridgeAiLogBudget;
}

/** Mirrors the extension formatter result; `text` is opaque output, never a bridge command. */
export interface BridgeAiLogResult {
  text: string;
  estimatedTokens: number;
  includedEntryCount: number;
  omittedEntryCount: number;
  includedAnchorCount: number;
  compactedValueCount: number;
  truncatedValueCount: number;
  selectionMode: BridgeAiLogSelectionMode;
  stateStatus: BridgeAiLogStateStatus;
}

export interface BridgeAiLogResponse {
  bridge: 'koshko-bridge';
  version: 1;
  type: 'ai-log-response';
  requestId: string;
  sessionId: string;
  result: BridgeAiLogResult;
}

export type BridgeClientMessage = BridgeClientHello | BridgeCaptureBatch | BridgeAiLogResponse;
export type BridgeServerMessage = BridgeServerReady | BridgeServerError | BridgeServerAck | BridgeAiLogRequest;
export type BridgeMessage = BridgeClientMessage | BridgeServerMessage;
