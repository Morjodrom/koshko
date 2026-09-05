import actorFlowSignalV1Schema from './actor-flow-signal-v1.schema.json';
import type { ActorFlowSignalV1, ActorFlowWindowMessageV1, CapturedSignalV1 } from './types';
import { normalizeActorFlowSignalV1, normalizeCapturedSignalV1 } from './normalize';

export const actorFlowSignalV1JsonSchema = actorFlowSignalV1Schema;

export function isActorReference(value: unknown): value is ActorFlowSignalV1['source'] {
  if (!isObjectLike(value)) {
    return false;
  }
  return typeof value.id === 'string' && value.id.length > 0;
}

export function isActorFlowSignalV1(value: unknown): value is ActorFlowSignalV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const producerSequence = value.producerSequence;

  return (
    value.protocol === 'actor-flow' &&
    value.version === 1 &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.producerId === 'string' &&
    value.producerId.length > 0 &&
    typeof producerSequence === 'number' &&
    Number.isInteger(producerSequence) &&
    producerSequence > 0 &&
    typeof value.occurredAt === 'number' &&
    isActorReference(value.source) &&
    (value.target === undefined || isActorReference(value.target)) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    (value.severity === undefined || isSeverity(value.severity)) &&
    (value.correlationId === undefined || typeof value.correlationId === 'string') &&
    (value.causedBy === undefined || typeof value.causedBy === 'string') &&
    (value.tags === undefined || Array.isArray(value.tags))
  );
}

export function isActorFlowWindowMessageV1(value: unknown): value is ActorFlowWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  return value.protocol === 'actor-flow' && value.version === 1 && value.type === 'signal' && isActorFlowSignalV1(value.signal);
}

export function parseActorFlowWindowMessageV1(value: unknown): ActorFlowWindowMessageV1 | undefined {
  if (!isActorFlowWindowMessageV1(value)) {
    return undefined;
  }

  return {
    protocol: 'actor-flow',
    version: 1,
    type: 'signal',
    signal: normalizeActorFlowSignalV1(value.signal),
  };
}

export function parseCapturedSignalV1(value: unknown): CapturedSignalV1 {
  return normalizeCapturedSignalV1(value);
}

function isSeverity(value: unknown): value is NonNullable<ActorFlowSignalV1['severity']> {
  return value === 'debug' || value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
