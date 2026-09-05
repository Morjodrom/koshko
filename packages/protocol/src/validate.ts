import koshkoSignalV1Schema from './koshko-signal-v1.schema.json';
import type { KoshkoSignalV1, KoshkoWindowMessageV1, CapturedSignalV1 } from './types';
import { normalizeKoshkoSignalV1, normalizeCapturedSignalV1 } from './normalize';

export const koshkoSignalV1JsonSchema = koshkoSignalV1Schema;

export function isActorReference(value: unknown): value is KoshkoSignalV1['source'] {
  if (!isObjectLike(value)) {
    return false;
  }
  return typeof value.id === 'string' && value.id.length > 0;
}

export function isKoshkoSignalV1(value: unknown): value is KoshkoSignalV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const producerSequence = value.producerSequence;

  return (
    value.protocol === 'koshko' &&
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

export function isKoshkoWindowMessageV1(value: unknown): value is KoshkoWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  return value.protocol === 'koshko' && value.version === 1 && value.type === 'signal' && isKoshkoSignalV1(value.signal);
}

export function parseKoshkoWindowMessageV1(value: unknown): KoshkoWindowMessageV1 | undefined {
  if (!isKoshkoWindowMessageV1(value)) {
    return undefined;
  }

  return {
    protocol: 'koshko',
    version: 1,
    type: 'signal',
    signal: normalizeKoshkoSignalV1(value.signal),
  };
}

export function parseCapturedSignalV1(value: unknown): CapturedSignalV1 {
  return normalizeCapturedSignalV1(value);
}

function isSeverity(value: unknown): value is NonNullable<KoshkoSignalV1['severity']> {
  return value === 'debug' || value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
