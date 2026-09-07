import type { JsonArray, JsonObject, JsonValue, KoshkoStatePatchOperationV1 } from './types';

const MAX_JSON_POINTER_LENGTH = 16_384;

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
  if (!Array.isArray(patch)) {
    return state;
  }

  let current: JsonValue = state;

  for (const operation of patch) {
    if (!isPatchOperation(operation)) {
      return state;
    }
    const segments = parseJsonPointer(operation.path);
    if (segments === undefined || segments.length === 0) {
      return state;
    }

    const result = applyOperation(current, segments, operation);
    if (!result.ok || !isJsonObject(result.value) || Array.isArray(result.value)) {
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
    value.length <= MAX_JSON_POINTER_LENGTH &&
    parseJsonPointer(value) !== undefined
  );
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
  if (Array.isArray(container)) {
    return applyToArray(container, segment, operation);
  }

  const exists = Object.prototype.hasOwnProperty.call(container, segment);
  if (operation.op === 'remove') {
    if (!exists) {
      return { ok: false };
    }
    const next = { ...container };
    delete next[segment];
    return { ok: true, value: next };
  }

  if (operation.op === 'replace' && !exists) {
    return { ok: false };
  }

  const next = { ...container };
  defineJsonProperty(next, segment, cloneJsonValue(operation.value));
  return { ok: true, value: next };
}

function applyToArray(
  container: JsonArray,
  segment: string,
  operation: KoshkoStatePatchOperationV1,
): PatchResult {
  const next = container.slice();

  if (operation.op === 'add' && segment === '-') {
    next.push(cloneJsonValue(operation.value));
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
    next.splice(index, 0, cloneJsonValue(operation.value));
    return { ok: true, value: next };
  }

  if (index >= next.length) {
    return { ok: false };
  }

  if (operation.op === 'remove') {
    next.splice(index, 1);
  } else {
    next[index] = cloneJsonValue(operation.value);
  }
  return { ok: true, value: next };
}

function getExistingChild(container: JsonObject | JsonArray, segment: string): PatchResult {
  if (Array.isArray(container)) {
    const index = parseArrayIndex(segment);
    if (index === undefined || index >= container.length) {
      return { ok: false };
    }
    return { ok: true, value: container[index] };
  }

  if (!Object.prototype.hasOwnProperty.call(container, segment)) {
    return { ok: false };
  }
  return { ok: true, value: container[segment] };
}

function replaceExistingChild(
  container: JsonObject | JsonArray,
  segment: string,
  value: JsonValue,
): PatchResult {
  if (Array.isArray(container)) {
    const index = parseArrayIndex(segment);
    if (index === undefined || index >= container.length) {
      return { ok: false };
    }
    const next = container.slice();
    next[index] = value;
    return { ok: true, value: next };
  }

  if (!Object.prototype.hasOwnProperty.call(container, segment)) {
    return { ok: false };
  }
  const next = { ...container };
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

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (isJsonObject(value)) {
    const clone: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      defineJsonProperty(clone, key, cloneJsonValue(child));
    }
    return clone;
  }
  return value;
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

function isPatchOperation(value: unknown): value is KoshkoStatePatchOperationV1 {
  if (!isRecord(value) || !isStateMutationPath(value.path)) {
    return false;
  }
  if (value.op === 'remove') {
    return true;
  }
  return (
    (value.op === 'add' || value.op === 'replace') &&
    Object.prototype.hasOwnProperty.call(value, 'value') &&
    isJsonValue(value.value)
  );
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (!isRecord(value) || seen.has(value)) {
    return false;
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index) || !isJsonValue(value[index], seen)) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(Object.getOwnPropertyDescriptors(value)).every(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
