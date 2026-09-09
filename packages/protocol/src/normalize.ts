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

const MAX_IDENTIFIER_CODE_POINTS = 128;
const MAX_TEXT_CODE_POINTS = 16_384;
const MAX_STRING_CODE_POINTS = 16_384;
const MAX_OBJECT_DEPTH = 8;
const MAX_OBJECT_KEYS = 200;
const MAX_ARRAY_LENGTH = 500;
const MAX_SERIALIZED_BYTES = 64 * 1024;
const CONTROL_CHARS = /\p{C}/gu;

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
    id: normalizeIdentifier((record as Record<string, unknown>).id, INVALID_VALUE),
    producerId: normalizeIdentifier((record as Record<string, unknown>).producerId, INVALID_VALUE),
    producerSequence: normalizePositiveInteger(
      (record as Record<string, unknown>).producerSequence,
      1,
    ),
    occurredAt: normalizeTimestamp((record as Record<string, unknown>).occurredAt),
    source: normalizeActorReference((record as Record<string, unknown>).source),
    name: normalizeIdentifier((record as Record<string, unknown>).name, INVALID_VALUE),
  };

  const target = (record as Record<string, unknown>).target;
  if (target !== undefined) {
    signal.target = normalizeActorReference(target);
  }

  const severity = normalizeSeverity((record as Record<string, unknown>).severity);
  if (severity !== undefined) {
    signal.severity = severity;
  }

  const details = (record as Record<string, unknown>).details;
  if (details !== undefined) {
    signal.details = normalizeJsonValue(details);
  }

  const context = normalizeContext((record as Record<string, unknown>).context);
  if (context !== undefined) {
    signal.context = context;
  }

  const correlationId = normalizeOptionalIdentifier((record as Record<string, unknown>).correlationId);
  if (correlationId !== undefined) {
    signal.correlationId = correlationId;
  }

  const causedBy = normalizeOptionalIdentifier((record as Record<string, unknown>).causedBy);
  if (causedBy !== undefined) {
    signal.causedBy = causedBy;
  }

  const tags = normalizeTags((record as Record<string, unknown>).tags);
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

  if (approximateJsonLength(error) > MAX_SERIALIZED_BYTES) {
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
  const signal = normalizeKoshkoSignalV1((record as Record<string, unknown>).signal);
  const observedAt = normalizeTimestamp((record as Record<string, unknown>).observedAt);
  const tabId = normalizeFrameNumber((record as Record<string, unknown>).tabId);
  const frameId = normalizeFrameNumber((record as Record<string, unknown>).frameId);
  const navigationId = normalizeIdentifier((record as Record<string, unknown>).navigationId, INVALID_VALUE);
  const frameUrl = normalizeUrlLike((record as Record<string, unknown>).frameUrl);
  const frameOrigin = normalizeFrameOrigin((record as Record<string, unknown>).frameOrigin, frameUrl);

  const captured: CapturedSignalV1 = {
    signal,
    observedAt,
    tabId,
    frameId,
    navigationId,
    frameUrl,
    frameOrigin,
  };

  const documentId = normalizeOptionalIdentifier((record as Record<string, unknown>).documentId);
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
  const mutation = normalizeKoshkoStateMutationV1(record.mutation);
  const observedAt = normalizeTimestamp(record.observedAt);
  const tabId = normalizeFrameNumber(record.tabId);
  const frameId = normalizeFrameNumber(record.frameId);
  const navigationId = normalizeIdentifier(record.navigationId, INVALID_VALUE);
  const frameUrl = normalizeUrlLike(record.frameUrl);
  const frameOrigin = normalizeFrameOrigin(record.frameOrigin, frameUrl);

  const captured: CapturedStateMutationV1 = {
    mutation,
    observedAt,
    tabId,
    frameId,
    navigationId,
    frameUrl,
    frameOrigin,
  };

  const documentId = normalizeOptionalIdentifier(record.documentId);
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
  if (!Array.isArray(input) || input.length > MAX_ARRAY_LENGTH) {
    return [];
  }

  const patch: KoshkoStatePatchOperationV1[] = [];
  for (let index = 0; index < input.length; index += 1) {
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
  for (let pass = 0; pass < 3; pass += 1) {
    if (approximateJsonLength(current) <= MAX_SERIALIZED_BYTES) {
      return current;
    }

    if (current.details !== undefined) {
      current = { ...current, details: TRUNCATED };
      continue;
    }

    if (current.context !== undefined) {
      current = { ...current };
      delete current.context;
      continue;
    }

    if (current.tags !== undefined) {
      current = { ...current };
      delete current.tags;
      continue;
    }

    if (current.target !== undefined) {
      current = { ...current };
      delete current.target;
    }
  }

  return current;
}

function approximateJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
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
    return normalizeText(input, MAX_STRING_CODE_POINTS);
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
  if (depth >= MAX_OBJECT_DEPTH) {
    return TRUNCATED;
  }
  seen.set(input, path.join('.'));

  if (Array.isArray(input)) {
    const output: JsonValue[] = [];
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const numericKeys = Object.keys(descriptors)
      .filter((key) => key !== 'length' && String(Number(key)) === key)
      .sort((left, right) => Number(left) - Number(right));
    const limit = Math.min(numericKeys.length, MAX_ARRAY_LENGTH);
    for (let index = 0; index < limit; index += 1) {
      const key = numericKeys[index];
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        continue;
      }

      output.push(normalizeJsonValueInternal(descriptor.value, depth + 1, seen, path.concat(key)));
    }
    if (numericKeys.length > MAX_ARRAY_LENGTH) {
      output.push(TRUNCATED);
    }
    seen.delete(input);
    return output;
  }

  if (input instanceof Date) {
    const time = input.getTime();
    seen.delete(input);
    return Number.isFinite(time) ? input.toISOString() : UNSUPPORTED_VALUE;
  }

  if (input instanceof URL) {
    seen.delete(input);
    return sanitizeUrlString(input.toString());
  }

  const tag = Object.prototype.toString.call(input).slice(8, -1);
  if (tag === 'Error' || tag === 'DOMException') {
    const result = normalizeErrorValue(input, tag, depth, seen, path);
    seen.delete(input);
    return result;
  }
  if (tag !== 'Object') {
    const raw = normalizeText(`[${tag}]`, MAX_TEXT_CODE_POINTS);
    seen.delete(input);
    return raw;
  }

  const result: Record<string, JsonValue> = {};
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  const limit = Math.min(keys.length, MAX_OBJECT_KEYS);

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

  if (keys.length > MAX_OBJECT_KEYS) {
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
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  const limit = Math.min(keys.length, MAX_OBJECT_KEYS);

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

  if (keys.length > MAX_OBJECT_KEYS) {
    result[TRUNCATED] = TRUNCATED;
  }
  return result;
}

function sanitizeUrlValue(value: unknown): JsonValue {
  if (typeof value === 'string') {
    return sanitizeUrlString(value);
  }
  if (value instanceof URL) {
    return sanitizeUrlString(value.toString());
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
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Object.keys(descriptors).slice(0, MAX_OBJECT_KEYS)) {
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
  if (!Array.isArray(input)) {
    return undefined;
  }

  const tags: string[] = [];
  for (const tag of input.slice(0, MAX_ARRAY_LENGTH)) {
    const normalized = normalizeOptionalIdentifier(tag);
    if (normalized !== undefined) {
      tags.push(normalized);
    }
  }

  return tags.length > 0 ? tags : undefined;
}

function normalizeIdentifier(input: unknown, fallback: string): string {
  const text = normalizeText(String(input ?? ''), MAX_IDENTIFIER_CODE_POINTS).replace(CONTROL_CHARS, '');
  if (!text) {
    return fallback;
  }
  return limitCodePoints(text, MAX_IDENTIFIER_CODE_POINTS);
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
  const normalized = normalizeText(String(input), MAX_TEXT_CODE_POINTS);
  return normalized || undefined;
}

function normalizeText(input: string, maxCodePoints: number): string {
  const cleaned = input.replace(CONTROL_CHARS, '');
  const codePoints = Array.from(cleaned);
  if (codePoints.length > maxCodePoints) {
    return TRUNCATED;
  }
  return cleaned;
}

function limitCodePoints(text: string, maxCodePoints: number): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxCodePoints) {
    return text;
  }
  return codePoints.slice(0, maxCodePoints).join('');
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
  const parsed = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.trunc(parsed);
  return value > 0 ? value : fallback;
}

function normalizeTimestamp(input: unknown): number {
  const parsed = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeFrameNumber(input: unknown): number {
  const parsed = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : -1;
}

function normalizeUrlLike(input: unknown): string {
  if (typeof input === 'string') {
    return sanitizeUrlString(input);
  }
  if (input instanceof URL) {
    return sanitizeUrlString(input.toString());
  }
  return normalizeText(String(input ?? ''), MAX_TEXT_CODE_POINTS);
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
    return normalizeText(String(input ?? ''), MAX_TEXT_CODE_POINTS);
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

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function compareNumbers(left: number, right: number): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
