import type {
  KoshkoSignalV1,
  KoshkoStateMutationV1,
  KoshkoStatePatchOperationV1,
  KoshkoStateMutationWindowMessageV1,
  KoshkoWindowMessageV1,
  ActorReference,
  CapturedStateMutationV1,
  CapturedSignalV1,
  CapturedErrorV1,
  JsonValue,
  KoshkoErrorV1,
  KoshkoErrorWindowMessageV1,
} from './types';
import { isStateMutationPath } from './state';
import {
  MAX_ARRAY_LENGTH,
  MAX_IDENTIFIER_CODE_POINTS,
  MAX_JSON_DEPTH,
  MAX_OBJECT_PROPERTIES,
  MAX_SERIALIZED_BYTES,
  MAX_STATE_PATCH_OPERATIONS,
  MAX_TEXT_CODE_POINTS,
} from './limits';
import {
  hasOwnDataProperty,
  hasAtMostCodePoints,
  isArray,
  isObjectLike,
  readArrayLength,
  readOwnDataProperty,
  readOwnPropertyDescriptors,
  readPrototype,
  serializedJsonByteLength,
  stripControlCharacters,
} from './safe-data';

const SENSITIVE_KEYS = new Set([
  'token',
  'ordertoken',
  'paymenttoken',
  'authorization',
  'cookie',
  'password',
  'secret',
]);

const URL_KEYS = [
  'url',
  'uri',
  'href',
  'filename',
  'endpoint',
  'callbackurl',
  'redirecturl',
  'returnurl',
  'frameurl',
];

const TRUNCATED = '[Truncated]';
const REDACTED = '[Redacted]';
const FUNCTION_VALUE = '[Function]';
const CIRCULAR_VALUE = '[Circular]';
const UNDEFINED_VALUE = '[Undefined]';
const UNSUPPORTED_VALUE = '[Unsupported]';
const INVALID_VALUE = '[Invalid]';

export function normalizeActorReference(input: unknown): ActorReference {
  const record = isObjectLike(input) ? input : {};
  const id = normalizeIdentifier(readOwnDataProperty(record, 'id'), INVALID_VALUE);
  const result: ActorReference = { id };

  const instanceId = normalizeOptionalIdentifier(readOwnDataProperty(record, 'instanceId'));
  if (instanceId !== undefined) {
    result.instanceId = instanceId;
  }

  const label = normalizeOptionalText(readOwnDataProperty(record, 'label'));
  if (label !== undefined) {
    result.label = label;
  }

  const instanceLabel = normalizeOptionalText(readOwnDataProperty(record, 'instanceLabel'));
  if (instanceLabel !== undefined) {
    result.instanceLabel = instanceLabel;
  }

  return result;
}

export function normalizeKoshkoSignalV1(input: unknown): KoshkoSignalV1 {
  const record = isObjectLike(input) ? input : {};
  const signal: KoshkoSignalV1 = {
    protocol: 'koshko',
    version: 1,
    id: normalizeIdentifier(readOwnDataProperty(record, 'id'), INVALID_VALUE),
    producerId: normalizeIdentifier(readOwnDataProperty(record, 'producerId'), INVALID_VALUE),
    producerSequence: normalizePositiveInteger(
      readOwnDataProperty(record, 'producerSequence'),
      1,
    ),
    occurredAt: normalizeTimestamp(readOwnDataProperty(record, 'occurredAt')),
    source: normalizeActorReference(readOwnDataProperty(record, 'source')),
    name: normalizeIdentifier(readOwnDataProperty(record, 'name'), INVALID_VALUE),
  };

  const target = readOwnDataProperty(record, 'target');
  if (target !== undefined) {
    signal.target = normalizeActorReference(target);
  }

  const severity = normalizeSeverity(readOwnDataProperty(record, 'severity'));
  if (severity !== undefined) {
    signal.severity = severity;
  }

  const details = readOwnDataProperty(record, 'details');
  if (details !== undefined) {
    signal.details = normalizeJsonValue(details);
  }

  const context = normalizeContext(readOwnDataProperty(record, 'context'));
  if (context !== undefined) {
    signal.context = context;
  }

  const correlationId = normalizeOptionalIdentifier(readOwnDataProperty(record, 'correlationId'));
  if (correlationId !== undefined) {
    signal.correlationId = correlationId;
  }

  const causedBy = normalizeOptionalIdentifier(readOwnDataProperty(record, 'causedBy'));
  if (causedBy !== undefined) {
    signal.causedBy = causedBy;
  }

  const tags = normalizeTags(readOwnDataProperty(record, 'tags'));
  if (tags !== undefined) {
    signal.tags = tags;
  }

  return compactSignal(signal);
}

export function normalizeKoshkoErrorV1(input: unknown): KoshkoErrorV1 {
  const record = isObjectLike(input) ? input : {};
  const error: KoshkoErrorV1 = {
    protocol: 'koshko',
    version: 1,
    id: normalizeIdentifier(readOwnDataProperty(record, 'id'), INVALID_VALUE),
    producerId: normalizeIdentifier(readOwnDataProperty(record, 'producerId'), INVALID_VALUE),
    producerSequence: normalizePositiveInteger(readOwnDataProperty(record, 'producerSequence'), 1),
    occurredAt: normalizeTimestamp(readOwnDataProperty(record, 'occurredAt')),
    source: normalizeActorReference(readOwnDataProperty(record, 'source')),
    name: normalizeIdentifier(readOwnDataProperty(record, 'name'), INVALID_VALUE),
    payload: normalizeJsonValue(readOwnDataProperty(record, 'payload')),
  };

  if (serializedJsonByteLength(error) > MAX_SERIALIZED_BYTES) {
    error.payload = TRUNCATED;
  }
  return error;
}

export function normalizeKoshkoStateMutationV1(input: unknown): KoshkoStateMutationV1 {
  const record = isObjectLike(input) ? input : {};
  const mutation: KoshkoStateMutationV1 = {
    protocol: 'koshko',
    version: 1,
    id: normalizeIdentifier(readOwnDataProperty(record, 'id'), INVALID_VALUE),
    producerId: normalizeIdentifier(readOwnDataProperty(record, 'producerId'), INVALID_VALUE),
    producerSequence: normalizePositiveInteger(readOwnDataProperty(record, 'producerSequence'), 1),
    occurredAt: normalizeTimestamp(readOwnDataProperty(record, 'occurredAt')),
    patch: normalizeStatePatch(readOwnDataProperty(record, 'patch')),
  };

  const label = normalizeOptionalIdentifier(readOwnDataProperty(record, 'label'));
  if (label !== undefined) {
    mutation.label = label;
  }

  return mutation;
}

export function normalizeCapturedSignalV1(input: unknown): CapturedSignalV1 {
  const record = isObjectLike(input) ? input : {};
  const signal = normalizeKoshkoSignalV1(readOwnDataProperty(record, 'signal'));
  const observedAt = normalizeTimestamp(readOwnDataProperty(record, 'observedAt'));
  const tabId = normalizeFrameNumber(readOwnDataProperty(record, 'tabId'));
  const frameId = normalizeFrameNumber(readOwnDataProperty(record, 'frameId'));
  const navigationId = normalizeIdentifier(readOwnDataProperty(record, 'navigationId'), INVALID_VALUE);
  const frameUrl = normalizeUrlLike(readOwnDataProperty(record, 'frameUrl'));
  const frameOrigin = normalizeFrameOrigin(readOwnDataProperty(record, 'frameOrigin'), frameUrl);

  const captured: CapturedSignalV1 = {
    signal,
    observedAt,
    tabId,
    frameId,
    navigationId,
    frameUrl,
    frameOrigin,
  };

  const documentId = normalizeOptionalIdentifier(readOwnDataProperty(record, 'documentId'));
  if (documentId !== undefined) {
    captured.documentId = documentId;
  }

  return captured;
}

export function normalizeCapturedErrorV1(input: unknown): CapturedErrorV1 {
  const record = isObjectLike(input) ? input : {};
  const error = normalizeKoshkoErrorV1(readOwnDataProperty(record, 'error'));
  const observedAt = normalizeTimestamp(readOwnDataProperty(record, 'observedAt'));
  const tabId = normalizeFrameNumber(readOwnDataProperty(record, 'tabId'));
  const frameId = normalizeFrameNumber(readOwnDataProperty(record, 'frameId'));
  const navigationId = normalizeIdentifier(readOwnDataProperty(record, 'navigationId'), INVALID_VALUE);
  const frameUrl = normalizeUrlLike(readOwnDataProperty(record, 'frameUrl'));
  const frameOrigin = normalizeFrameOrigin(readOwnDataProperty(record, 'frameOrigin'), frameUrl);
  const captured: CapturedErrorV1 = {
    error,
    observedAt,
    tabId,
    frameId,
    navigationId,
    frameUrl,
    frameOrigin,
  };
  const documentId = normalizeOptionalIdentifier(readOwnDataProperty(record, 'documentId'));
  if (documentId !== undefined) {
    captured.documentId = documentId;
  }
  return captured;
}

export function normalizeCapturedStateMutationV1(input: unknown): CapturedStateMutationV1 {
  const record = isObjectLike(input) ? input : {};
  const mutation = normalizeKoshkoStateMutationV1(readOwnDataProperty(record, 'mutation'));
  const observedAt = normalizeTimestamp(readOwnDataProperty(record, 'observedAt'));
  const tabId = normalizeFrameNumber(readOwnDataProperty(record, 'tabId'));
  const frameId = normalizeFrameNumber(readOwnDataProperty(record, 'frameId'));
  const navigationId = normalizeIdentifier(readOwnDataProperty(record, 'navigationId'), INVALID_VALUE);
  const frameUrl = normalizeUrlLike(readOwnDataProperty(record, 'frameUrl'));
  const frameOrigin = normalizeFrameOrigin(readOwnDataProperty(record, 'frameOrigin'), frameUrl);

  const captured: CapturedStateMutationV1 = {
    mutation,
    observedAt,
    tabId,
    frameId,
    navigationId,
    frameUrl,
    frameOrigin,
  };

  const documentId = normalizeOptionalIdentifier(readOwnDataProperty(record, 'documentId'));
  if (documentId !== undefined) {
    captured.documentId = documentId;
  }

  return captured;
}

export function createKoshkoWindowMessageV1(signal: KoshkoSignalV1): KoshkoWindowMessageV1 {
  return {
    protocol: 'koshko',
    version: 1,
    type: 'signal',
    signal,
  };
}

export function createKoshkoErrorWindowMessageV1(error: KoshkoErrorV1): KoshkoErrorWindowMessageV1 {
  return {
    protocol: 'koshko',
    version: 1,
    type: 'error',
    error,
  };
}

export function createKoshkoStateMutationWindowMessageV1(
  mutation: KoshkoStateMutationV1,
): KoshkoStateMutationWindowMessageV1 {
  return {
    protocol: 'koshko',
    version: 1,
    type: 'state-mutation',
    mutation,
  };
}

export function normalizeJsonValue(input: unknown): JsonValue {
  return normalizeJsonValueInternal(input, 0, new WeakMap<object, string>(), []);
}

function normalizeStatePatch(input: unknown): KoshkoStatePatchOperationV1[] {
  const length = readArrayLength(input);
  if (length === undefined || length > MAX_STATE_PATCH_OPERATIONS) {
    return [];
  }

  const patch: KoshkoStatePatchOperationV1[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!hasOwnDataProperty(input, index)) {
      return [];
    }
    const candidate = readOwnDataProperty(input, index);
    if (!isObjectLike(candidate)) {
      return [];
    }

    const op = readOwnDataProperty(candidate, 'op');
    const path = readOwnDataProperty(candidate, 'path');
    if (!isStateMutationPath(path)) {
      return [];
    }

    if (op === 'remove') {
      patch.push({ op: 'remove', path });
      continue;
    }

    if (
      (op === 'add' || op === 'replace') &&
      hasOwnDataProperty(candidate, 'value')
    ) {
      patch.push({
        op,
        path,
        value: normalizeStatePatchValue(path, readOwnDataProperty(candidate, 'value')),
      });
      continue;
    }

    return [];
  }
  return patch;
}

function normalizeStatePatchValue(path: string, value: unknown): JsonValue {
  const segments = path.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segments.some(isSensitiveKey)) {
    return REDACTED;
  }

  const property = segments.at(-1);
  return property !== undefined && isUrlKey(property)
    ? sanitizeUrlValue(value)
    : normalizeJsonValue(value);
}

export function compareCapturedSignals(left: CapturedSignalV1, right: CapturedSignalV1): number {
  const occurredAt = compareNumbers(left.signal.occurredAt, right.signal.occurredAt);
  if (occurredAt !== 0) {
    return occurredAt;
  }

  const observedAt = compareNumbers(left.observedAt, right.observedAt);
  if (observedAt !== 0) {
    return observedAt;
  }

  const producer = left.signal.producerId.localeCompare(right.signal.producerId);
  if (producer !== 0) {
    return producer;
  }

  const sequence = compareNumbers(left.signal.producerSequence, right.signal.producerSequence);
  if (sequence !== 0) {
    return sequence;
  }

  return left.signal.id.localeCompare(right.signal.id);
}

function compactSignal(signal: KoshkoSignalV1): KoshkoSignalV1 {
  let current = signal;
  const compactors: Array<(value: KoshkoSignalV1) => KoshkoSignalV1> = [
    (value) => value.details === undefined ? value : { ...value, details: TRUNCATED },
    (value) => omitOptionalSignalField(value, 'context'),
    (value) => omitOptionalSignalField(value, 'tags'),
    (value) => omitOptionalSignalField(value, 'target'),
    (value) => omitActorLabels(value),
  ];

  for (const compact of compactors) {
    if (serializedJsonByteLength(current) <= MAX_SERIALIZED_BYTES) {
      return current;
    }
    current = compact(current);
  }

  return current;
}

function omitOptionalSignalField<K extends 'context' | 'tags' | 'target'>(
  signal: KoshkoSignalV1,
  key: K,
): KoshkoSignalV1 {
  if (signal[key] === undefined) {
    return signal;
  }
  const result = { ...signal };
  delete result[key];
  return result;
}

function omitActorLabels(signal: KoshkoSignalV1): KoshkoSignalV1 {
  if (signal.source.label === undefined && signal.source.instanceLabel === undefined) {
    return signal;
  }

  const source: ActorReference = { id: signal.source.id };
  if (signal.source.instanceId !== undefined) {
    source.instanceId = signal.source.instanceId;
  }
  return { ...signal, source };
}

function normalizeJsonValueInternal(
  input: unknown,
  depth: number,
  seen: WeakMap<object, string>,
  path: string[],
): JsonValue {
  if (input === null) {
    return null;
  }

  if (typeof input === 'string') {
    return normalizeText(input, MAX_TEXT_CODE_POINTS);
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : UNSUPPORTED_VALUE;
  }
  if (typeof input === 'boolean') {
    return input;
  }
  if (typeof input === 'undefined') {
    return UNDEFINED_VALUE;
  }
  if (typeof input === 'function') {
    return FUNCTION_VALUE;
  }
  if (typeof input === 'bigint' || typeof input === 'symbol') {
    return UNSUPPORTED_VALUE;
  }

  if (!isObjectLike(input)) {
    return UNSUPPORTED_VALUE;
  }

  if (seen.has(input)) {
    return CIRCULAR_VALUE;
  }
  if (depth >= MAX_JSON_DEPTH) {
    return TRUNCATED;
  }
  seen.set(input, path.join('.'));

  if (isArray(input)) {
    const output: JsonValue[] = [];
    const descriptors = readOwnPropertyDescriptors(input);
    const length = readArrayLength(input);
    if (descriptors === undefined || length === undefined) {
      seen.delete(input);
      return UNSUPPORTED_VALUE;
    }
    const limit = Math.min(length, MAX_ARRAY_LENGTH);
    for (let index = 0; index < limit; index += 1) {
      const key = String(index);
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        continue;
      }

      output.push(normalizeJsonValueInternal(descriptor.value, depth + 1, seen, path.concat(key)));
    }
    if (length > MAX_ARRAY_LENGTH) {
      output.push(TRUNCATED);
    }
    seen.delete(input);
    return output;
  }

  const prototype = readPrototype(input);
  if (prototype === undefined) {
    seen.delete(input);
    return UNSUPPORTED_VALUE;
  }

  if (prototype === Date.prototype) {
    let time: number;
    try {
      time = Date.prototype.getTime.call(input);
    } catch {
      seen.delete(input);
      return UNSUPPORTED_VALUE;
    }
    seen.delete(input);
    return Number.isFinite(time) ? new Date(time).toISOString() : UNSUPPORTED_VALUE;
  }

  const errorTag = readErrorTag(input);
  if (errorTag !== undefined) {
    const result = normalizeErrorValue(input, errorTag, depth, seen, path);
    seen.delete(input);
    return result;
  }

  if (prototype === URL.prototype) {
    let url: string;
    try {
      url = URL.prototype.toString.call(input);
    } catch {
      seen.delete(input);
      return UNSUPPORTED_VALUE;
    }
    seen.delete(input);
    return sanitizeUrlString(url);
  }

  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(input);
    return UNSUPPORTED_VALUE;
  }

  const result: Record<string, JsonValue> = {};
  const descriptors = readOwnPropertyDescriptors(input);
  if (descriptors === undefined) {
    seen.delete(input);
    return UNSUPPORTED_VALUE;
  }
  const keys = Object.keys(descriptors).filter((key) => descriptors[key]?.enumerable);
  const limit = Math.min(keys.length, MAX_OBJECT_PROPERTIES);

  for (let index = 0; index < limit; index += 1) {
    const key = keys[index];
    const descriptor = descriptors[key];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      continue;
    }

    const nextPath = path.concat(key);
    const value = descriptor.value;
    result[key] = isSensitiveKey(key)
      ? REDACTED
      : isUrlKey(key)
        ? sanitizeUrlValue(value)
        : normalizeJsonValueInternal(value, depth + 1, seen, nextPath);
  }

  if (keys.length > MAX_OBJECT_PROPERTIES) {
    result[TRUNCATED] = TRUNCATED;
  }

  seen.delete(input);
  return result;
}

function normalizeErrorValue(
  input: object,
  tag: string,
  depth: number,
  seen: WeakMap<object, string>,
  path: string[],
): JsonValue {
  const result: Record<string, JsonValue> = { name: tag };
  const descriptors = readOwnPropertyDescriptors(input);
  if (descriptors === undefined) {
    return UNSUPPORTED_VALUE;
  }
  const keys = Object.keys(descriptors);
  const limit = Math.min(keys.length, MAX_OBJECT_PROPERTIES);

  for (let index = 0; index < limit; index += 1) {
    const key = keys[index];
    const descriptor = descriptors[key];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      continue;
    }

    const value = descriptor.value;
    result[key] = isSensitiveKey(key)
      ? REDACTED
      : isUrlKey(key)
        ? sanitizeUrlValue(value)
        : normalizeJsonValueInternal(value, depth + 1, seen, path.concat(key));
  }

  if (keys.length > MAX_OBJECT_PROPERTIES) {
    result[TRUNCATED] = TRUNCATED;
  }
  return result;
}

function hasPrototypeInChain(input: object, expected: object): boolean {
  const seen = new Set<object>();
  let prototype = readPrototype(input);
  while (prototype !== undefined && prototype !== null && !seen.has(prototype)) {
    if (prototype === expected) {
      return true;
    }
    seen.add(prototype);
    prototype = readPrototype(prototype);
  }
  return false;
}

function readErrorTag(input: object): string | undefined {
  if (hasPrototypeInChain(input, Error.prototype)) {
    return 'Error';
  }
  if (typeof DOMException !== 'undefined' && hasPrototypeInChain(input, DOMException.prototype)) {
    return 'DOMException';
  }

  const ownDescriptors = readOwnPropertyDescriptors(input);
  const message = ownDescriptors?.message;
  const stack = ownDescriptors?.stack;
  if (
    message && Object.prototype.hasOwnProperty.call(message, 'value') &&
    typeof message.value === 'string' &&
    stack && Object.prototype.hasOwnProperty.call(stack, 'value') &&
    typeof stack.value === 'string'
  ) {
    return 'Error';
  }

  const seen = new Set<object>();
  let prototype = readPrototype(input);
  while (prototype !== undefined && prototype !== null && !seen.has(prototype)) {
    seen.add(prototype);
    const name = readOwnDataProperty(prototype, 'name');
    if (typeof name === 'string' && (name === 'DOMException' || name.endsWith('Error'))) {
      return name;
    }
    const constructor = readOwnDataProperty(prototype, 'constructor');
    const constructorName = readOwnDataProperty(constructor, 'name');
    if (
      typeof constructorName === 'string' &&
      (constructorName === 'DOMException' || constructorName.endsWith('Error'))
    ) {
      return constructorName;
    }
    prototype = readPrototype(prototype);
  }
  return undefined;
}

function sanitizeUrlValue(value: unknown): JsonValue {
  if (typeof value === 'string') {
    return sanitizeUrlString(value);
  }
  if (isObjectLike(value) && readPrototype(value) === URL.prototype) {
    try {
      return sanitizeUrlString(URL.prototype.toString.call(value));
    } catch {
      return UNSUPPORTED_VALUE;
    }
  }
  return normalizeJsonValueInternal(value, 0, new WeakMap<object, string>(), []);
}

function sanitizeUrlString(value: string): string {
  const normalized = normalizeText(value, MAX_TEXT_CODE_POINTS);
  const stripped = normalized.replace(/[?#].*$/, '');

  try {
    const parsed = new URL(stripped);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return stripped;
  }
}

function normalizeContext(input: unknown): Record<string, string> | undefined {
  if (!isObjectLike(input)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  const descriptors = readOwnPropertyDescriptors(input);
  if (descriptors === undefined) {
    return undefined;
  }
  const keys = Object.keys(descriptors)
    .filter((key) => descriptors[key]?.enumerable)
    .slice(0, MAX_OBJECT_PROPERTIES);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      continue;
    }

    const value = descriptor.value;
    result[key] = isSensitiveKey(key) ? REDACTED : normalizeContextValue(value);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeText(value, MAX_TEXT_CODE_POINTS);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : UNSUPPORTED_VALUE;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return UNDEFINED_VALUE;
  }
  const normalized = normalizeJsonValue(value);
  return typeof normalized === 'string' ? normalized : JSON.stringify(normalized) ?? UNSUPPORTED_VALUE;
}

function normalizeTags(input: unknown): string[] | undefined {
  const length = readArrayLength(input);
  if (length === undefined) {
    return undefined;
  }

  const tags: string[] = [];
  for (let index = 0; index < Math.min(length, MAX_ARRAY_LENGTH); index += 1) {
    if (!hasOwnDataProperty(input, index)) {
      continue;
    }
    const normalized = normalizeOptionalIdentifier(readOwnDataProperty(input, index));
    if (normalized !== undefined) {
      tags.push(normalized);
    }
  }

  return tags.length > 0 ? tags : undefined;
}

function normalizeIdentifier(input: unknown, fallback: string): string {
  const text = normalizeText(stringifyPrimitive(input), MAX_IDENTIFIER_CODE_POINTS);
  if (!text) {
    return fallback;
  }
  return text;
}

function normalizeOptionalIdentifier(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const normalized = normalizeIdentifier(input, '');
  return normalized || undefined;
}

function normalizeOptionalText(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const normalized = normalizeText(stringifyPrimitive(input), MAX_TEXT_CODE_POINTS);
  return normalized || undefined;
}

function normalizeText(input: string, maxCodePoints: number): string {
  const cleaned = stripControlCharacters(input);
  if (!hasAtMostCodePoints(cleaned, maxCodePoints)) {
    return TRUNCATED;
  }
  return cleaned;
}

function normalizeSeverity(input: unknown): KoshkoSignalV1['severity'] | undefined {
  switch (input) {
    case 'debug':
    case 'info':
    case 'success':
    case 'warning':
    case 'error':
      return input;
    default:
      return undefined;
  }
}

function normalizePositiveInteger(input: unknown, fallback: number): number {
  const parsed = parsePrimitiveNumber(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.trunc(parsed);
  return value > 0 ? value : fallback;
}

function normalizeTimestamp(input: unknown): number {
  const parsed = parsePrimitiveNumber(input);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeFrameNumber(input: unknown): number {
  const parsed = parsePrimitiveNumber(input);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : -1;
}

function normalizeUrlLike(input: unknown): string {
  if (typeof input === 'string') {
    return sanitizeUrlString(input);
  }
  if (isObjectLike(input) && readPrototype(input) === URL.prototype) {
    try {
      return sanitizeUrlString(URL.prototype.toString.call(input));
    } catch {
      return '';
    }
  }
  return normalizeText(stringifyPrimitive(input), MAX_TEXT_CODE_POINTS);
}

function normalizeFrameOrigin(input: unknown, frameUrl: string): string {
  if (typeof input === 'string' && input.trim()) {
    const cleaned = normalizeText(input, MAX_TEXT_CODE_POINTS);
    try {
      return new URL(cleaned).origin;
    } catch {
      return cleaned.replace(/[?#].*$/, '');
    }
  }

  try {
    return new URL(frameUrl).origin;
  } catch {
    return normalizeText(stringifyPrimitive(input), MAX_TEXT_CODE_POINTS);
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return Array.from(SENSITIVE_KEYS).some((candidate) => normalized.includes(candidate));
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isUrlKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return URL_KEYS.some((candidate) => normalized.endsWith(candidate) || normalized.includes(candidate));
}

function stringifyPrimitive(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return '';
  }
}

function parsePrimitiveNumber(value: unknown): number {
  return typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
}

function compareNumbers(left: number, right: number): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
