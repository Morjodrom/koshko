export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type ActorFlowSeverity = 'debug' | 'info' | 'success' | 'warning' | 'error';

export interface ActorReference {
  id: string;
  instanceId?: string;
  label?: string;
  instanceLabel?: string;
}

export interface ActorFlowSignalV1 {
  protocol: 'actor-flow';
  version: 1;
  id: string;
  producerId: string;
  producerSequence: number;
  occurredAt: number;
  source: ActorReference;
  target?: ActorReference;
  name: string;
  severity?: ActorFlowSeverity;
  details?: JsonValue;
  context?: Record<string, string>;
  correlationId?: string;
  causedBy?: string;
  tags?: string[];
}

export interface CapturedSignalV1 {
  signal: ActorFlowSignalV1;
  observedAt: number;
  tabId: number;
  frameId: number;
  documentId?: string;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export interface ActorFlowWindowMessageV1 {
  protocol: 'actor-flow';
  version: 1;
  type: 'signal';
  signal: ActorFlowSignalV1;
}
