import { describe, expect, it } from 'vitest';
import {
  MAX_ARRAY_LENGTH,
  MAX_JSON_DEPTH,
  MAX_OBJECT_PROPERTIES,
  MAX_SERIALIZED_BYTES,
  MAX_TEXT_CODE_POINTS,
} from './limits';
import {
  hasValidSerializedSize,
  isJsonValue,
  serializedJsonByteLength,
} from './safe-data';

describe('safe protocol data', () => {
  it('enforces JSON value limits', () => {
    const boundedObject = Object.fromEntries(
      Array.from({ length: MAX_OBJECT_PROPERTIES }, (_, index) => [`key-${index}`, index]),
    );
    const oversizedObject = { ...boundedObject, overflow: true };
    let boundedDepth: unknown = 'leaf';
    for (let depth = 0; depth < MAX_JSON_DEPTH; depth += 1) {
      boundedDepth = { child: boundedDepth };
    }
    const oversizedDepth = { child: boundedDepth };

    expect(isJsonValue('x'.repeat(MAX_TEXT_CODE_POINTS))).toBe(true);
    expect(isJsonValue('x'.repeat(MAX_TEXT_CODE_POINTS + 1))).toBe(false);
    expect(isJsonValue(Array.from({ length: MAX_ARRAY_LENGTH }, () => true))).toBe(true);
    expect(isJsonValue(Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => true))).toBe(false);
    expect(isJsonValue(boundedObject)).toBe(true);
    expect(isJsonValue(oversizedObject)).toBe(false);
    expect(isJsonValue(boundedDepth)).toBe(true);
    expect(isJsonValue(oversizedDepth)).toBe(false);
  });

  it('rejects sparse arrays and accessors without invoking getters', () => {
    const sparse = new Array(1);
    let getterInvoked = false;
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, 'secret', {
      enumerable: true,
      get() {
        getterInvoked = true;
        return 'unsafe';
      },
    });

    expect(isJsonValue(sparse)).toBe(false);
    expect(isJsonValue(value)).toBe(false);
    expect(getterInvoked).toBe(false);
  });

  it('measures serialized limits in UTF-8 bytes', () => {
    expect(serializedJsonByteLength('😀')).toBe(6);
    expect(hasValidSerializedSize('x'.repeat(MAX_SERIALIZED_BYTES - 2))).toBe(true);
    expect(hasValidSerializedSize('x'.repeat(MAX_SERIALIZED_BYTES - 1))).toBe(false);
  });

  it('fails closed for hostile proxies without using property gets', () => {
    let getInvoked = false;
    const readable = new Proxy({ ok: true }, {
      get() {
        getInvoked = true;
        throw new Error('must not run');
      },
    });
    const unreadable = new Proxy({ ok: true }, {
      getOwnPropertyDescriptor() {
        throw new Error('descriptor unavailable');
      },
    });
    const revocable = Proxy.revocable({ ok: true }, {});
    revocable.revoke();

    expect(isJsonValue(readable)).toBe(true);
    expect(getInvoked).toBe(false);
    expect(() => isJsonValue(unreadable)).not.toThrow();
    expect(isJsonValue(unreadable)).toBe(false);
    expect(() => isJsonValue(revocable.proxy)).not.toThrow();
    expect(isJsonValue(revocable.proxy)).toBe(false);
  });
});
