import {
  MAX_ARRAY_LENGTH,
  MAX_JSON_DEPTH,
  MAX_OBJECT_PROPERTIES,
  MAX_SERIALIZED_BYTES,
  MAX_TEXT_CODE_POINTS,
} from './limits';
import type { JsonValue } from './types';

const textEncoder = new TextEncoder();
const CONTROL_CHARS = /\p{C}/u;
const ALL_CONTROL_CHARS = /\p{C}/gu;

export function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export function isArray(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

export function readOwnDataProperty(record: unknown, key: PropertyKey): unknown {
  if (!isObjectLike(record)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function hasOwnDataProperty(record: unknown, key: PropertyKey): boolean {
  if (!isObjectLike(record)) {
    return false;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  } catch {
    return false;
  }
}

export function readOwnPropertyDescriptors(record: unknown): PropertyDescriptorMap | undefined {
  if (!isObjectLike(record)) {
    return undefined;
  }
  try {
    return Object.getOwnPropertyDescriptors(record);
  } catch {
    return undefined;
  }
}

export function readPrototype(record: unknown): object | null | undefined {
  if (!isObjectLike(record)) {
    return undefined;
  }
  try {
    return Object.getPrototypeOf(record) as object | null;
  } catch {
    return undefined;
  }
}

export function readArrayLength(value: unknown): number | undefined {
  if (!isArray(value)) {
    return undefined;
  }

  const length = readOwnDataProperty(value, 'length');
  return typeof length === 'number' && Number.isSafeInteger(length) && length >= 0
    ? length
    : undefined;
}

export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInternal(value, 0, new WeakSet<object>());
}

export function serializedJsonByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? 0
      : textEncoder.encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function hasValidSerializedSize(value: unknown): boolean {
  return serializedJsonByteLength(value) <= MAX_SERIALIZED_BYTES;
}

export function hasAtMostCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
    if (count > maximum) {
      return false;
    }
  }
  return true;
}

export function containsControlCharacters(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

export function stripControlCharacters(value: string): string {
  return value.replace(ALL_CONTROL_CHARS, '');
}

function isJsonValueInternal(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): value is JsonValue {
  if (value === null || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'string') {
    return hasAtMostCodePoints(value, MAX_TEXT_CODE_POINTS);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (!isObjectLike(value) || seen.has(value) || depth >= MAX_JSON_DEPTH) {
    return false;
  }

  seen.add(value);
  try {
    if (isArray(value)) {
      const length = readArrayLength(value);
      if (length === undefined || length > MAX_ARRAY_LENGTH) {
        return false;
      }

      for (let index = 0; index < length; index += 1) {
        if (
          !hasOwnDataProperty(value, index) ||
          !isJsonValueInternal(readOwnDataProperty(value, index), depth + 1, seen)
        ) {
          return false;
        }
      }
      return true;
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
    if (keys.length > MAX_OBJECT_PROPERTIES) {
      return false;
    }

    return keys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
        isJsonValueInternal(descriptor.value, depth + 1, seen);
    });
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}
