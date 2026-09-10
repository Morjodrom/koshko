import type { JsonArray, JsonObject, JsonValue, KoshkoStatePatchOperationV1 } from './types';
import {
  MAX_JSON_POINTER_CODE_POINTS,
  MAX_STATE_PATCH_OPERATIONS,
} from './limits';
import {
  hasOwnDataProperty,
  hasAtMostCodePoints,
  isArray,
  isJsonValue,
  isObjectLike,
  readArrayLength,
  readOwnDataProperty,
  readOwnPropertyDescriptors,
  readPrototype,
} from './safe-data';

type PatchResult =
  | { ok: true; value: JsonValue }
  | { ok: false };

/**
 * Applies a state patch without mutating the previous state. A malformed or
 * inapplicable operation rejects the whole batch and returns the previous
 * state unchanged.
 */
export function applyStateMutationPatch(
  state: JsonObject,
  patch: readonly KoshkoStatePatchOperationV1[],
): JsonObject {
  const decodedPatch = decodeStatePatch(patch);
  if (decodedPatch === undefined) {
    return state;
  }

  let current: JsonValue = state;

  for (const operation of decodedPatch) {
    const segments = parseJsonPointer(operation.path);
    if (segments === undefined || segments.length === 0) {
      return state;
    }

    const result = applyOperation(current, segments, operation);
    if (
      !result.ok ||
      !isJsonValue(result.value) ||
      !isJsonObject(result.value) ||
      isArray(result.value)
    ) {
      return state;
    }
    current = result.value;
  }

  return current;
}

export function isStateMutationPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    hasAtMostCodePoints(value, MAX_JSON_POINTER_CODE_POINTS) &&
    parseJsonPointer(value) !== undefined
  );
}

function decodeStatePatch(value: unknown): KoshkoStatePatchOperationV1[] | undefined {
  const length = readArrayLength(value);
  if (length === undefined || length > MAX_STATE_PATCH_OPERATIONS) {
    return undefined;
  }

  const patch: KoshkoStatePatchOperationV1[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!hasOwnDataProperty(value, index)) {
      return undefined;
    }
    const operation = decodePatchOperation(readOwnDataProperty(value, index));
    if (operation === undefined) {
      return undefined;
    }
    patch.push(operation);
  }
  return patch;
}

function decodePatchOperation(value: unknown): KoshkoStatePatchOperationV1 | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }

  const op = readOwnDataProperty(value, 'op');
  const path = readOwnDataProperty(value, 'path');
  if (!isStateMutationPath(path)) {
    return undefined;
  }
  if (op === 'remove') {
    return { op, path };
  }
  if ((op !== 'add' && op !== 'replace') || !hasOwnDataProperty(value, 'value')) {
    return undefined;
  }

  const operationValue = readOwnDataProperty(value, 'value');
  if (!isJsonValue(operationValue)) {
    return undefined;
  }
  const cloned = cloneJsonValue(operationValue);
  return cloned.ok ? { op, path, value: cloned.value } : undefined;
}

function applyOperation(
  container: JsonValue,
  segments: readonly string[],
  operation: KoshkoStatePatchOperationV1,
): PatchResult {
  if (!isJsonObject(container)) {
    return { ok: false };
  }

  const [segment, ...remaining] = segments;
  if (segment === undefined) {
    return { ok: false };
  }

  if (remaining.length === 0) {
    return applyToChild(container, segment, operation);
  }

  const child = getExistingChild(container, segment);
  if (!child.ok) {
    return child;
  }

  const updated = applyOperation(child.value, remaining, operation);
  if (!updated.ok) {
    return updated;
  }

  return replaceExistingChild(container, segment, updated.value);
}

function applyToChild(
  container: JsonObject | JsonArray,
  segment: string,
  operation: KoshkoStatePatchOperationV1,
): PatchResult {
  if (isArray(container)) {
    return applyToArray(container, segment, operation);
  }

  const exists = hasOwnDataProperty(container, segment);
  if (operation.op === 'remove') {
    if (!exists) {
      return { ok: false };
    }
    const next = cloneJsonObjectShallow(container);
    if (next === undefined) {
      return { ok: false };
    }
    delete next[segment];
    return { ok: true, value: next };
  }

  if (operation.op === 'replace' && !exists) {
    return { ok: false };
  }

  const next = cloneJsonObjectShallow(container);
  if (next === undefined) {
    return { ok: false };
  }
  defineJsonProperty(next, segment, operation.value);
  return { ok: true, value: next };
}

function applyToArray(
  container: JsonArray,
  segment: string,
  operation: KoshkoStatePatchOperationV1,
): PatchResult {
  const next = cloneJsonArrayShallow(container);
  if (next === undefined) {
    return { ok: false };
  }

  if (operation.op === 'add' && segment === '-') {
    next.push(operation.value);
    return { ok: true, value: next };
  }

  const index = parseArrayIndex(segment);
  if (index === undefined) {
    return { ok: false };
  }

  if (operation.op === 'add') {
    if (index > next.length) {
      return { ok: false };
    }
    next.splice(index, 0, operation.value);
    return { ok: true, value: next };
  }

  if (index >= next.length) {
    return { ok: false };
  }

  if (operation.op === 'remove') {
    next.splice(index, 1);
  } else {
    next[index] = operation.value;
  }
  return { ok: true, value: next };
}

function getExistingChild(container: JsonObject | JsonArray, segment: string): PatchResult {
  if (isArray(container)) {
    const index = parseArrayIndex(segment);
    const length = readArrayLength(container);
    if (index === undefined || length === undefined || index >= length || !hasOwnDataProperty(container, index)) {
      return { ok: false };
    }
    const value = readOwnDataProperty(container, index);
    return isJsonValue(value) ? { ok: true, value } : { ok: false };
  }

  if (!hasOwnDataProperty(container, segment)) {
    return { ok: false };
  }
  const value = readOwnDataProperty(container, segment);
  return isJsonValue(value) ? { ok: true, value } : { ok: false };
}

function replaceExistingChild(
  container: JsonObject | JsonArray,
  segment: string,
  value: JsonValue,
): PatchResult {
  if (isArray(container)) {
    const index = parseArrayIndex(segment);
    const next = cloneJsonArrayShallow(container);
    if (index === undefined || next === undefined || index >= next.length) {
      return { ok: false };
    }
    next[index] = value;
    return { ok: true, value: next };
  }

  if (!hasOwnDataProperty(container, segment)) {
    return { ok: false };
  }
  const next = cloneJsonObjectShallow(container);
  if (next === undefined) {
    return { ok: false };
  }
  defineJsonProperty(next, segment, value);
  return { ok: true, value: next };
}

function parseJsonPointer(path: unknown): string[] | undefined {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return undefined;
  }

  const segments: string[] = [];
  for (const rawSegment of path.slice(1).split('/')) {
    let decoded = '';
    for (let index = 0; index < rawSegment.length; index += 1) {
      const character = rawSegment[index];
      if (character !== '~') {
        decoded += character;
        continue;
      }

      const escape = rawSegment[index + 1];
      if (escape === '0') {
        decoded += '~';
      } else if (escape === '1') {
        decoded += '/';
      } else {
        return undefined;
      }
      index += 1;
    }
    segments.push(decoded);
  }
  return segments;
}

function parseArrayIndex(segment: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    return undefined;
  }
  const index = Number(segment);
  return Number.isSafeInteger(index) ? index : undefined;
}

function cloneJsonValue(value: unknown, seen = new WeakSet<object>()): PatchResult {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (!isObjectLike(value) || seen.has(value)) {
    return { ok: false };
  }

  seen.add(value);
  try {
    if (isArray(value)) {
      const length = readArrayLength(value);
      if (length === undefined) {
        return { ok: false };
      }
      const clone: JsonArray = [];
      for (let index = 0; index < length; index += 1) {
        if (!hasOwnDataProperty(value, index)) {
          return { ok: false };
        }
        const child = cloneJsonValue(readOwnDataProperty(value, index), seen);
        if (!child.ok) {
          return child;
        }
        clone.push(child.value);
      }
      return { ok: true, value: clone };
    }

    const prototype = readPrototype(value);
    const descriptors = readOwnPropertyDescriptors(value);
    if ((prototype !== Object.prototype && prototype !== null) || descriptors === undefined) {
      return { ok: false };
    }
    const clone: JsonObject = {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return { ok: false };
      }
      const child = cloneJsonValue(descriptor.value, seen);
      if (!child.ok) {
        return child;
      }
      defineJsonProperty(clone, key, child.value);
    }
    return { ok: true, value: clone };
  } catch {
    return { ok: false };
  } finally {
    seen.delete(value);
  }
}

function cloneJsonArrayShallow(value: JsonArray): JsonArray | undefined {
  const length = readArrayLength(value);
  if (length === undefined) {
    return undefined;
  }

  const clone: JsonArray = [];
  for (let index = 0; index < length; index += 1) {
    if (!hasOwnDataProperty(value, index)) {
      return undefined;
    }
    const child = readOwnDataProperty(value, index);
    if (!isJsonValue(child)) {
      return undefined;
    }
    clone.push(child);
  }
  return clone;
}

function cloneJsonObjectShallow(value: JsonObject): JsonObject | undefined {
  const prototype = readPrototype(value);
  const descriptors = readOwnPropertyDescriptors(value);
  if ((prototype !== Object.prototype && prototype !== null) || descriptors === undefined) {
    return undefined;
  }

  const clone: JsonObject = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || !isJsonValue(descriptor.value)) {
      return undefined;
    }
    defineJsonProperty(clone, key, descriptor.value);
  }
  return clone;
}

function defineJsonProperty(target: JsonObject, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function isJsonObject(value: JsonValue): value is JsonObject | JsonArray {
  return typeof value === 'object' && value !== null;
}
