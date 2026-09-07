import koshkoSignalV1Schema from './koshko-signal-v1.schema.json';
import koshkoStateMutationV1Schema from './koshko-state-mutation-v1.schema.json';
import type {
  CapturedSignalV1,
  CapturedStateMutationV1,
  JsonValue,
  KoshkoProtocolWindowMessageV1,
  KoshkoSignalV1,
  KoshkoStateMutationV1,
  KoshkoStateMutationWindowMessageV1,
  KoshkoStatePatchOperationV1,
  KoshkoWindowMessageV1,
} from './types';
import {
  normalizeCapturedSignalV1,
  normalizeCapturedStateMutationV1,
  normalizeKoshkoSignalV1,
  normalizeKoshkoStateMutationV1,
} from './normalize';
import { isStateMutationPath } from './state';

const MAX_STATE_PATCH_OPERATIONS = 500;
const MAX_SERIALIZED_BYTES = 64 * 1024;

export const koshkoSignalV1JsonSchema = koshkoSignalV1Schema;
export const koshkoStateMutationV1JsonSchema = koshkoStateMutationV1Schema;

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

export function isKoshkoStatePatchOperationV1(value: unknown): value is KoshkoStatePatchOperationV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const op = readOwnDataProperty(value, 'op');
  const path = readOwnDataProperty(value, 'path');
  if (!isStateMutationPath(path)) {
    return false;
  }

  if (op === 'remove') {
    return true;
  }

  return (
    (op === 'add' || op === 'replace') &&
    hasOwnDataProperty(value, 'value') &&
    isJsonValue(readOwnDataProperty(value, 'value'))
  );
}

export function isKoshkoStateMutationV1(value: unknown): value is KoshkoStateMutationV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const protocol = readOwnDataProperty(value, 'protocol');
  const version = readOwnDataProperty(value, 'version');
  const id = readOwnDataProperty(value, 'id');
  const producerId = readOwnDataProperty(value, 'producerId');
  const producerSequence = readOwnDataProperty(value, 'producerSequence');
  const occurredAt = readOwnDataProperty(value, 'occurredAt');
  const patch = readOwnDataProperty(value, 'patch');
  const structurallyValid = (
    protocol === 'koshko' &&
    version === 1 &&
    typeof id === 'string' &&
    id.length > 0 &&
    typeof producerId === 'string' &&
    producerId.length > 0 &&
    typeof producerSequence === 'number' &&
    Number.isInteger(producerSequence) &&
    producerSequence > 0 &&
    typeof occurredAt === 'number' &&
    Number.isFinite(occurredAt) &&
    Array.isArray(patch) &&
    patch.length <= MAX_STATE_PATCH_OPERATIONS &&
    isStatePatch(patch)
  );

  if (!structurallyValid) {
    return false;
  }

  return hasValidSerializedSize(normalizeKoshkoStateMutationV1(value));
}

export function isKoshkoWindowMessageV1(value: unknown): value is KoshkoWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  return value.protocol === 'koshko' && value.version === 1 && value.type === 'signal' && isKoshkoSignalV1(value.signal);
}

export function isKoshkoStateMutationWindowMessageV1(
  value: unknown,
): value is KoshkoStateMutationWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  return (
    readOwnDataProperty(value, 'protocol') === 'koshko' &&
    readOwnDataProperty(value, 'version') === 1 &&
    readOwnDataProperty(value, 'type') === 'state-mutation' &&
    isKoshkoStateMutationV1(readOwnDataProperty(value, 'mutation'))
  );
}

export function isKoshkoProtocolWindowMessageV1(
  value: unknown,
): value is KoshkoProtocolWindowMessageV1 {
  return isKoshkoWindowMessageV1(value) || isKoshkoStateMutationWindowMessageV1(value);
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

export function parseKoshkoStateMutationWindowMessageV1(
  value: unknown,
): KoshkoStateMutationWindowMessageV1 | undefined {
  if (!isKoshkoStateMutationWindowMessageV1(value)) {
    return undefined;
  }

  return {
    protocol: 'koshko',
    version: 1,
    type: 'state-mutation',
    mutation: normalizeKoshkoStateMutationV1(readOwnDataProperty(value, 'mutation')),
  };
}

export function parseKoshkoProtocolWindowMessageV1(
  value: unknown,
): KoshkoProtocolWindowMessageV1 | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }

  const type = readOwnDataProperty(value, 'type');
  if (type === 'signal') {
    return parseKoshkoWindowMessageV1(value);
  }
  if (type === 'state-mutation') {
    return parseKoshkoStateMutationWindowMessageV1(value);
  }
  return undefined;
}

export function parseCapturedSignalV1(value: unknown): CapturedSignalV1 {
  return normalizeCapturedSignalV1(value);
}

export function parseCapturedStateMutationV1(value: unknown): CapturedStateMutationV1 {
  return normalizeCapturedStateMutationV1(value);
}

function isSeverity(value: unknown): value is NonNullable<KoshkoSignalV1['severity']> {
  return value === 'debug' || value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (!isObjectLike(value) || seen.has(value)) {
    return false;
  }

  try {
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwnDataProperty(value, index) || !isJsonValue(readOwnDataProperty(value, index), seen)) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.values(descriptors).every(
      (descriptor) => !descriptor.enumerable || (
        Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
        isJsonValue(descriptor.value, seen)
      ),
    );
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function isStatePatch(patch: unknown[]): patch is KoshkoStatePatchOperationV1[] {
  for (let index = 0; index < patch.length; index += 1) {
    if (
      !hasOwnDataProperty(patch, index) ||
      !isKoshkoStatePatchOperationV1(readOwnDataProperty(patch, index))
    ) {
      return false;
    }
  }
  return true;
}

function hasValidSerializedSize(value: KoshkoStateMutationV1): boolean {
  try {
    return (JSON.stringify(value)?.length ?? 0) <= MAX_SERIALIZED_BYTES;
  } catch {
    return false;
  }
}

function readOwnDataProperty(record: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function hasOwnDataProperty(record: object, key: PropertyKey): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  } catch {
    return false;
  }
}
