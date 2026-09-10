import koshkoSignalV1Schema from './koshko-signal-v1.schema.json';
import koshkoErrorV1Schema from './koshko-error-v1.schema.json';
import koshkoStateMutationV1Schema from './koshko-state-mutation-v1.schema.json';
import {
  MAX_ARRAY_LENGTH,
  MAX_IDENTIFIER_CODE_POINTS,
  MAX_OBJECT_PROPERTIES,
  MAX_STATE_PATCH_OPERATIONS,
  MAX_TEXT_CODE_POINTS,
} from './limits';
import {
  containsControlCharacters,
  hasOwnDataProperty,
  hasAtMostCodePoints,
  hasValidSerializedSize,
  isArray,
  isJsonValue,
  isObjectLike,
  readArrayLength,
  readOwnDataProperty,
  readOwnPropertyDescriptors,
  readPrototype,
} from './safe-data';
import type {
  CapturedSignalV1,
  CapturedErrorV1,
  CapturedStateMutationV1,
  KoshkoProtocolWindowMessageV1,
  KoshkoSignalV1,
  KoshkoErrorV1,
  KoshkoErrorWindowMessageV1,
  KoshkoStateMutationV1,
  KoshkoStateMutationWindowMessageV1,
  KoshkoStatePatchOperationV1,
  KoshkoWindowMessageV1,
} from './types';
import {
  normalizeCapturedSignalV1,
  normalizeCapturedErrorV1,
  normalizeKoshkoErrorV1,
  normalizeCapturedStateMutationV1,
  normalizeKoshkoSignalV1,
  normalizeKoshkoStateMutationV1,
} from './normalize';
import { isStateMutationPath } from './state';

export const koshkoSignalV1JsonSchema = koshkoSignalV1Schema;
export const koshkoErrorV1JsonSchema = koshkoErrorV1Schema;
export const koshkoStateMutationV1JsonSchema = koshkoStateMutationV1Schema;

export function isActorReference(value: unknown): value is KoshkoSignalV1['source'] {
  if (!isObjectLike(value)) {
    return false;
  }
  const id = readOwnDataProperty(value, 'id');
  const instanceId = readOwnDataProperty(value, 'instanceId');
  const label = readOwnDataProperty(value, 'label');
  const instanceLabel = readOwnDataProperty(value, 'instanceLabel');
  return isBoundedIdentifier(id) &&
    (instanceId === undefined || isBoundedIdentifier(instanceId)) &&
    (label === undefined || isBoundedText(label)) &&
    (instanceLabel === undefined || isBoundedText(instanceLabel));
}

export function isKoshkoSignalV1(value: unknown): value is KoshkoSignalV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const protocol = readOwnDataProperty(value, 'protocol');
  const version = readOwnDataProperty(value, 'version');
  const id = readOwnDataProperty(value, 'id');
  const producerId = readOwnDataProperty(value, 'producerId');
  const producerSequence = readOwnDataProperty(value, 'producerSequence');
  const occurredAt = readOwnDataProperty(value, 'occurredAt');
  const source = readOwnDataProperty(value, 'source');
  const target = readOwnDataProperty(value, 'target');
  const name = readOwnDataProperty(value, 'name');
  const severity = readOwnDataProperty(value, 'severity');
  const details = readOwnDataProperty(value, 'details');
  const context = readOwnDataProperty(value, 'context');
  const correlationId = readOwnDataProperty(value, 'correlationId');
  const causedBy = readOwnDataProperty(value, 'causedBy');
  const tags = readOwnDataProperty(value, 'tags');
  const structurallyValid = protocol === 'koshko' &&
    version === 1 &&
    isBoundedIdentifier(id) &&
    isBoundedIdentifier(producerId) &&
    isPositiveInteger(producerSequence) &&
    isFiniteNumber(occurredAt) &&
    isActorReference(source) &&
    (target === undefined || isActorReference(target)) &&
    isBoundedIdentifier(name) &&
    (severity === undefined || isSeverity(severity)) &&
    (details === undefined || isJsonValue(details)) &&
    (context === undefined || isContext(context)) &&
    (correlationId === undefined || isBoundedIdentifier(correlationId)) &&
    (causedBy === undefined || isBoundedIdentifier(causedBy)) &&
    (tags === undefined || isIdentifierArray(tags));

  if (!structurallyValid) {
    return false;
  }

  return hasValidSerializedSize(normalizeKoshkoSignalV1(value));
}

export function isKoshkoErrorV1(value: unknown): value is KoshkoErrorV1 {
  if (!isObjectLike(value)) {
    return false;
  }
  const producerSequence = readOwnDataProperty(value, 'producerSequence');
  const occurredAt = readOwnDataProperty(value, 'occurredAt');
  const structurallyValid = (
    readOwnDataProperty(value, 'protocol') === 'koshko' &&
    readOwnDataProperty(value, 'version') === 1 &&
    isBoundedIdentifier(readOwnDataProperty(value, 'id')) &&
    isBoundedIdentifier(readOwnDataProperty(value, 'producerId')) &&
    typeof producerSequence === 'number' &&
    Number.isInteger(producerSequence) &&
    producerSequence > 0 &&
    typeof occurredAt === 'number' &&
    Number.isFinite(occurredAt) &&
    isActorReference(readOwnDataProperty(value, 'source')) &&
    isBoundedIdentifier(readOwnDataProperty(value, 'name')) &&
    isJsonValue(readOwnDataProperty(value, 'payload'))
  );
  return structurallyValid && hasValidSerializedSize(normalizeKoshkoErrorV1(value));
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

  return (op === 'add' || op === 'replace') &&
    hasOwnDataProperty(value, 'value') &&
    isJsonValue(readOwnDataProperty(value, 'value'));
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
  const label = readOwnDataProperty(value, 'label');
  const patch = readOwnDataProperty(value, 'patch');
  const structurallyValid = protocol === 'koshko' &&
    version === 1 &&
    isBoundedIdentifier(id) &&
    isBoundedIdentifier(producerId) &&
    isPositiveInteger(producerSequence) &&
    isFiniteNumber(occurredAt) &&
    (label === undefined || isBoundedIdentifier(label)) &&
    isStatePatch(patch);

  if (!structurallyValid) {
    return false;
  }

  return hasValidSerializedSize(normalizeKoshkoStateMutationV1(value));
}

export function isKoshkoWindowMessageV1(value: unknown): value is KoshkoWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  return readOwnDataProperty(value, 'protocol') === 'koshko' &&
    readOwnDataProperty(value, 'version') === 1 &&
    readOwnDataProperty(value, 'type') === 'signal' &&
    isKoshkoSignalV1(readOwnDataProperty(value, 'signal'));
}

export function isKoshkoStateMutationWindowMessageV1(
  value: unknown,
): value is KoshkoStateMutationWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  return readOwnDataProperty(value, 'protocol') === 'koshko' &&
    readOwnDataProperty(value, 'version') === 1 &&
    readOwnDataProperty(value, 'type') === 'state-mutation' &&
    isKoshkoStateMutationV1(readOwnDataProperty(value, 'mutation'));
}

export function isKoshkoErrorWindowMessageV1(value: unknown): value is KoshkoErrorWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    readOwnDataProperty(value, 'protocol') === 'koshko' &&
    readOwnDataProperty(value, 'version') === 1 &&
    readOwnDataProperty(value, 'type') === 'error' &&
    isKoshkoErrorV1(readOwnDataProperty(value, 'error'))
  );
}

export function isKoshkoProtocolWindowMessageV1(
  value: unknown,
): value is KoshkoProtocolWindowMessageV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const type = readOwnDataProperty(value, 'type');
  if (type === 'signal') {
    return isKoshkoWindowMessageV1(value);
  }
  if (type === 'state-mutation') {
    return isKoshkoStateMutationWindowMessageV1(value);
  }
  return type === 'error' && isKoshkoErrorWindowMessageV1(value);
}

export function parseKoshkoWindowMessageV1(value: unknown): KoshkoWindowMessageV1 | undefined {
  if (!isKoshkoWindowMessageV1(value)) {
    return undefined;
  }

  return {
    protocol: 'koshko',
    version: 1,
    type: 'signal',
    signal: normalizeKoshkoSignalV1(readOwnDataProperty(value, 'signal')),
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

export function parseKoshkoErrorWindowMessageV1(
  value: unknown,
): KoshkoErrorWindowMessageV1 | undefined {
  if (!isKoshkoErrorWindowMessageV1(value)) {
    return undefined;
  }
  return {
    protocol: 'koshko',
    version: 1,
    type: 'error',
    error: normalizeKoshkoErrorV1(readOwnDataProperty(value, 'error')),
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
  if (type === 'error') {
    return parseKoshkoErrorWindowMessageV1(value);
  }
  return undefined;
}

export function parseCapturedSignalV1(value: unknown): CapturedSignalV1 {
  return normalizeCapturedSignalV1(value);
}

export function parseCapturedErrorV1(value: unknown): CapturedErrorV1 {
  return normalizeCapturedErrorV1(value);
}

export function parseCapturedStateMutationV1(value: unknown): CapturedStateMutationV1 {
  return normalizeCapturedStateMutationV1(value);
}

function isSeverity(value: unknown): value is NonNullable<KoshkoSignalV1['severity']> {
  return value === 'debug' || value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    hasAtMostCodePoints(value, MAX_IDENTIFIER_CODE_POINTS) &&
    !containsControlCharacters(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    hasAtMostCodePoints(value, MAX_TEXT_CODE_POINTS);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIdentifierArray(value: unknown): value is string[] {
  const length = readArrayLength(value);
  if (length === undefined || length > MAX_ARRAY_LENGTH) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    if (!hasOwnDataProperty(value, index) || !isBoundedIdentifier(readOwnDataProperty(value, index))) {
      return false;
    }
  }
  return true;
}

function isContext(value: unknown): value is Record<string, string> {
  if (!isObjectLike(value) || isArray(value)) {
    return false;
  }

  const prototype = readPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const descriptors = readOwnPropertyDescriptors(value);
  if (descriptors === undefined) {
    return false;
  }
  const keys = Object.keys(descriptors).filter((key) => descriptors[key]?.enumerable);
  return keys.length <= MAX_OBJECT_PROPERTIES && keys.every((key) => {
    const descriptor = descriptors[key];
    return descriptor !== undefined &&
      Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
      typeof descriptor.value === 'string' &&
      hasAtMostCodePoints(descriptor.value, MAX_TEXT_CODE_POINTS);
  });
}

function isStatePatch(value: unknown): value is KoshkoStatePatchOperationV1[] {
  const length = readArrayLength(value);
  if (length === undefined || length > MAX_STATE_PATCH_OPERATIONS) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    if (
      !hasOwnDataProperty(value, index) ||
      !isKoshkoStatePatchOperationV1(readOwnDataProperty(value, index))
    ) {
      return false;
    }
  }
  return true;
}
