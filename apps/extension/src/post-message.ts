import { normalizeJsonValue, type JsonObject, type JsonValue } from '@koshko/protocol';

export type PostMessageSource = 'self' | 'parent' | 'opener' | 'other' | 'none';

export interface PostMessageFrameMetadata {
  tabId: number;
  frameId: number;
  documentId?: string;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
  iframeElementId?: string;
}

/** The safe, transport-independent observation produced by the content script. */
export interface RawPostMessage {
  id: string;
  sequence: number;
  observedAt: number;
  origin: string;
  source: PostMessageSource;
  data: JsonValue;
  iframeElementId?: string;
}

export interface CapturedPostMessage extends PostMessageFrameMetadata {
  kind: 'post-message';
  id: string;
  sequence: number;
  observedAt: number;
  origin: string;
  source: PostMessageSource;
  data: JsonValue;
}

export const POST_MESSAGE_KIND = 'post-message' as const;
export const POST_MESSAGE_MAX_BYTES = 64 * 1024;

const MAX_DEPTH = 8;
const MAX_OBJECT_PROPERTIES = 200;
const MAX_ARRAY_LENGTH = 500;
const MAX_TEXT_CODE_POINTS = 16_384;
const REDACTED = '[Redacted]';
const TRUNCATED = '[Truncated]';
const CIRCULAR = '[Circular]';
const UNDEFINED = '[Undefined]';
const UNSUPPORTED = '[Unsupported]';
const FUNCTION = '[Function]';

const SENSITIVE_KEY_PARTS = ['token', 'authorization', 'cookie', 'password', 'secret', 'apikey'];
const URL_KEY_PARTS = ['url', 'uri', 'href', 'filename', 'endpoint', 'callbackurl', 'redirecturl', 'returnurl', 'frameurl'];
const textEncoder = new TextEncoder();

function marker(type: string, extra: JsonObject = {}): JsonObject {
  return { $type: type, ...extra };
}

function ownDescriptors(value: object): PropertyDescriptorMap | undefined {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
}

function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = ownDescriptors(value)?.[key];
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
}

function prototypeOf(value: object): object | null | undefined {
  try {
    return Object.getPrototypeOf(value) as object | null;
  } catch {
    return undefined;
  }
}

function constructorName(value: object): string | undefined {
  const prototype = prototypeOf(value);
  if (!prototype) return undefined;
  let constructor: PropertyDescriptor | undefined;
  try {
    constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  } catch {
    return undefined;
  }
  if (
    !constructor
    || !Object.prototype.hasOwnProperty.call(constructor, 'value')
    || typeof constructor.value !== 'function'
  ) return undefined;
  const name = Object.getOwnPropertyDescriptor(constructor.value, 'name');
  return name && Object.prototype.hasOwnProperty.call(name, 'value') && typeof name.value === 'string' ? name.value : undefined;
}

function sanitizeText(value: string): string {
  let result = '';
  let count = 0;
  for (const codePoint of value) {
    if (count++ >= MAX_TEXT_CODE_POINTS) {
      return `${result}${TRUNCATED}`;
    }
    result += codePoint;
  }
  return result;
}

function sanitizeUrl(value: string): string {
  const text = sanitizeText(value).replace(/[?#].*$/, '');
  try {
    const parsed = new URL(text);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return text;
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((candidate) => normalized.includes(candidate));
}

function isUrlKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return URL_KEY_PARTS.some(
    (candidate) => normalized.endsWith(candidate) || normalized.includes(candidate),
  );
}

function looksUnsupported(value: object): boolean {
  const descriptors = ownDescriptors(value);
  const toStringTag = typeof Symbol !== 'undefined' ? descriptors?.[Symbol.toStringTag] : undefined;
  if (toStringTag && !Object.prototype.hasOwnProperty.call(toStringTag, 'value')) return true;
  const prototype = prototypeOf(value);
  if (prototype === null || prototype === Object.prototype || prototype === undefined) {
    return false;
  }
  const name = constructorName(value);
  return typeof name === 'string' && /^(?:Window|Document|MessagePort|Function|HTMLElement|Node)$/.test(name);
}

function binaryInfo(value: object): { type: string; bytes: number[]; truncated: boolean } | undefined {
  try {
    let bytes: Uint8Array;
    let type: string;
    const name = constructorName(value);
    if (value instanceof ArrayBuffer || name === 'ArrayBuffer' || name === 'SharedArrayBuffer') {
      bytes = new Uint8Array(value as ArrayBufferLike);
      type = name ?? 'ArrayBuffer';
    } else if (value instanceof DataView || name === 'DataView') {
      const view = value as DataView;
      bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      type = 'DataView';
    } else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView & { constructor?: { name?: string } };
      bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      type = name ?? 'TypedArray';
    } else return undefined;
    const limit = Math.min(bytes.byteLength, MAX_ARRAY_LENGTH);
    return { type, bytes: Array.from(bytes.subarray(0, limit)), truncated: bytes.byteLength > limit };
  } catch { return undefined; }
}

function serialize(value: unknown, depth: number, seen: WeakSet<object>): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : UNSUPPORTED;
  if (typeof value === 'undefined') return UNDEFINED;
  if (typeof value === 'function') return FUNCTION;
  if (typeof value === 'bigint') return marker('bigint', { value: sanitizeText(String(value)) });
  if (typeof value === 'symbol') return UNSUPPORTED;
  if (typeof value !== 'object') return UNSUPPORTED;
  if (seen.has(value)) return CIRCULAR;
  if (depth >= MAX_DEPTH) return TRUNCATED;
  seen.add(value);

  try {
    const prototype = prototypeOf(value);
    const name = constructorName(value);
    if (prototype === Date.prototype || name === 'Date') {
      try { return marker('date', { value: new Date((value as Date).getTime()).toISOString() }); } catch { return UNSUPPORTED; }
    }
    if (prototype === RegExp.prototype || name === 'RegExp') {
      try { return marker('regexp', { source: (value as RegExp).source, flags: (value as RegExp).flags }); } catch { return UNSUPPORTED; }
    }
    if (prototype === Map.prototype || name === 'Map') {
      const entries: JsonValue[] = [];
      try {
        for (const entry of value as Map<unknown, unknown>) {
          if (entries.length >= MAX_ARRAY_LENGTH) break;
          const key = entry[0];
          const entryValue = typeof key === 'string' && isSensitiveKey(key)
            ? REDACTED
            : typeof key === 'string' && isUrlKey(key) && typeof entry[1] === 'string'
              ? sanitizeUrl(entry[1])
              : serialize(entry[1], depth + 1, seen);
          entries.push([serialize(key, depth + 1, seen), entryValue]);
        }
      } catch { return UNSUPPORTED; }
      if ((value as Map<unknown, unknown>).size > MAX_ARRAY_LENGTH) entries.push(TRUNCATED);
      return marker('map', { entries });
    }
    if (prototype === Set.prototype || name === 'Set') {
      const values: JsonValue[] = [];
      try {
        for (const entry of value as Set<unknown>) {
          if (values.length >= MAX_ARRAY_LENGTH) break;
          values.push(serialize(entry, depth + 1, seen));
        }
      } catch {
        return UNSUPPORTED;
      }
      if ((value as Set<unknown>).size > MAX_ARRAY_LENGTH) values.push(TRUNCATED);
      return marker('set', { values });
    }
    if (value instanceof Error || name?.endsWith('Error')) {
      const result: JsonObject = marker('error');
      const descriptors = ownDescriptors(value);
      for (const key of ['name', 'message', 'stack', 'cause']) {
        const descriptor = descriptors?.[key];
        if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          result[key] = isSensitiveKey(key) ? REDACTED : serialize(descriptor.value, depth + 1, seen);
        }
      }
      return result;
    }
    const binary = binaryInfo(value);
    if (binary) {
      return marker('binary', { type: binary.type, bytes: binary.bytes, truncated: binary.truncated });
    }
    if (looksUnsupported(value)) return UNSUPPORTED;
    const descriptors = ownDescriptors(value);
    if (!descriptors) return UNSUPPORTED;
    if (Array.isArray(value)) {
      const output: JsonValue[] = [];
      const length = typeof descriptors.length?.value === 'number' ? descriptors.length.value : 0;
      for (let index = 0; index < Math.min(length, MAX_ARRAY_LENGTH); index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          output.push(serialize(descriptor.value, depth + 1, seen));
        }
      }
      if (length > MAX_ARRAY_LENGTH) output.push(TRUNCATED);
      return output;
    }
    const result: JsonObject = {};
    const keys = Object.keys(descriptors);
    for (const key of keys.slice(0, MAX_OBJECT_PROPERTIES)) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
      if (isSensitiveKey(key)) result[key] = REDACTED;
      else if (isUrlKey(key)) {
        const raw = descriptor.value;
        result[key] = typeof raw === 'string' ? sanitizeUrl(raw) : serialize(raw, depth + 1, seen);
      } else result[key] = serialize(descriptor.value, depth + 1, seen);
    }
    if (keys.length > MAX_OBJECT_PROPERTIES) result[TRUNCATED] = TRUNCATED;
    return result;
  } finally {
    seen.delete(value);
  }
}

export function normalizePostMessageData(value: unknown): JsonValue {
  let result = normalizeJsonValue(serialize(value, 0, new WeakSet<object>()));
  try {
    if (textEncoder.encode(JSON.stringify(result)).byteLength > POST_MESSAGE_MAX_BYTES) {
      result = marker('truncated', { reason: 'size-limit' });
    }
  } catch {
    result = UNSUPPORTED;
  }
  return result;
}

export const serializePostMessageData = normalizePostMessageData;

const MAX_IFRAME_ELEMENT_ID_LENGTH = 256;

/** Normalize an iframe DOM id before it crosses the content-script boundary. */
export function normalizeIframeElementId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = sanitizeText(value).trim().slice(0, MAX_IFRAME_ELEMENT_ID_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeCapturedPostMessage(input: unknown): CapturedPostMessage | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as object;
  const id = ownData(value, 'id');
  const sequence = ownData(value, 'sequence');
  const observedAt = ownData(value, 'observedAt');
  const source = ownData(value, 'source');
  const origin = ownData(value, 'origin');
  const data = ownData(value, 'data');
  const tabId = ownData(value, 'tabId');
  const frameId = ownData(value, 'frameId');
  const documentId = ownData(value, 'documentId');
  const navigationId = ownData(value, 'navigationId');
  const frameUrl = ownData(value, 'frameUrl');
  const frameOrigin = ownData(value, 'frameOrigin');
  const iframeElementId = ownData(value, 'iframeElementId');
  if (
    typeof source !== 'string'
    || !['self', 'parent', 'opener', 'other', 'none'].includes(source)
  ) return undefined;
  if (
    typeof id !== 'string'
    || typeof sequence !== 'number'
    || !Number.isSafeInteger(sequence)
    || sequence < 1
    || typeof observedAt !== 'number'
    || !Number.isFinite(observedAt)
  ) return undefined;
  if (
    !Number.isInteger(tabId)
    || (tabId as number) < 0
    || !Number.isInteger(frameId)
    || (frameId as number) < -1
    || typeof navigationId !== 'string'
    || typeof frameUrl !== 'string'
    || typeof frameOrigin !== 'string'
    || typeof origin !== 'string'
  ) return undefined;
  if (documentId !== undefined && typeof documentId !== 'string') return undefined;
  const normalizedIframeElementId = normalizeIframeElementId(iframeElementId);
  if (iframeElementId !== undefined && normalizedIframeElementId === undefined) return undefined;
  return {
    kind: POST_MESSAGE_KIND,
    id: sanitizeText(id),
    sequence,
    observedAt,
    origin: sanitizeText(origin),
    source: source as PostMessageSource,
    data: normalizePostMessageData(data),
    tabId: tabId as number,
    frameId: frameId as number,
    ...(documentId === undefined ? {} : { documentId: sanitizeText(documentId as string) }),
    navigationId: sanitizeText(navigationId),
    frameUrl: sanitizeUrl(frameUrl),
    frameOrigin: sanitizeText(frameOrigin),
    ...(normalizedIframeElementId === undefined ? {} : { iframeElementId: normalizedIframeElementId }),
  };
}
