export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type KoshkoSeverity = 'debug' | 'info' | 'success' | 'warning' | 'error';

export interface ActorReference {
  id: string;
  instanceId?: string;
  label?: string;
  instanceLabel?: string;
}

export interface KoshkoSignalV1 {
  protocol: 'koshko';
  version: 1;
  id: string;
  producerId: string;
  producerSequence: number;
  occurredAt: number;
  source: ActorReference;
  target?: ActorReference;
  name: string;
  severity?: KoshkoSeverity;
  details?: JsonValue;
  context?: Record<string, string>;
  correlationId?: string;
  causedBy?: string;
  tags?: string[];
}

export interface KoshkoErrorV1 {
  protocol: 'koshko';
  version: 1;
  id: string;
  producerId: string;
  producerSequence: number;
  occurredAt: number;
  source: ActorReference;
  name: string;
  payload: JsonValue;
}

export interface KoshkoStateAddOperationV1 {
  op: 'add';
  path: string;
  value: JsonValue;
}

export interface KoshkoStateRemoveOperationV1 {
  op: 'remove';
  path: string;
}

export interface KoshkoStateReplaceOperationV1 {
  op: 'replace';
  path: string;
  value: JsonValue;
}

export type KoshkoStatePatchOperationV1 =
  | KoshkoStateAddOperationV1
  | KoshkoStateRemoveOperationV1
  | KoshkoStateReplaceOperationV1;

export interface KoshkoStateMutationV1 {
  protocol: 'koshko';
  version: 1;
  id: string;
  producerId: string;
  producerSequence: number;
  occurredAt: number;
  label?: string;
  patch: KoshkoStatePatchOperationV1[];
}

export interface CaptureContextV1 {
  id: string;
  kind: 'top' | 'frame';
}

export interface CapturedMetadataV1 {
  observedAt: number;
  captureContext: CaptureContextV1;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export interface CapturedSignalV1 extends CapturedMetadataV1 {
  signal: KoshkoSignalV1;
}

export interface CapturedErrorV1 extends CapturedMetadataV1 {
  error: KoshkoErrorV1;
}

export interface CapturedStateMutationV1 extends CapturedMetadataV1 {
  mutation: KoshkoStateMutationV1;
}

export interface KoshkoWindowMessageV1 {
  protocol: 'koshko';
  version: 1;
  type: 'signal';
  signal: KoshkoSignalV1;
}

export interface KoshkoStateMutationWindowMessageV1 {
  protocol: 'koshko';
  version: 1;
  type: 'state-mutation';
  mutation: KoshkoStateMutationV1;
}

export interface KoshkoErrorWindowMessageV1 {
  protocol: 'koshko';
  version: 1;
  type: 'error';
  error: KoshkoErrorV1;
}

export type KoshkoProtocolWindowMessageV1 =
  | KoshkoWindowMessageV1
  | KoshkoStateMutationWindowMessageV1
  | KoshkoErrorWindowMessageV1;
export type AnyKoshkoWindowMessageV1 = KoshkoProtocolWindowMessageV1;
