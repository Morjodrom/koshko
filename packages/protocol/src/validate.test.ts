import { describe, expect, it } from 'vitest';
import {
  isKoshkoProtocolWindowMessageV1,
  isKoshkoErrorV1,
  isKoshkoSignalV1,
  isKoshkoStateMutationV1,
  isKoshkoWindowMessageV1,
  koshkoSignalV1JsonSchema,
  koshkoErrorV1JsonSchema,
  koshkoStateMutationV1JsonSchema,
  parseKoshkoProtocolWindowMessageV1,
  parseKoshkoErrorWindowMessageV1,
  parseKoshkoWindowMessageV1,
} from './index';

describe('protocol validation', () => {
  it('accepts supported signal versions and rejects unsupported messages', () => {
    const signal = {
      protocol: 'koshko',
      version: 1,
      id: 'signal-1',
      producerId: 'producer-1',
      producerSequence: 1,
      occurredAt: 1,
      source: { id: 'host' },
      name: 'widget.ready',
      unknown: 'ignored',
    };

    expect(isKoshkoSignalV1(signal)).toBe(true);
    expect(isKoshkoSignalV1({ ...signal, version: 2 })).toBe(false);

    const message = {
      protocol: 'koshko',
      version: 1,
      type: 'signal',
      signal,
    };

    expect(isKoshkoWindowMessageV1(message)).toBe(true);
    expect(parseKoshkoWindowMessageV1(message)?.signal.id).toBe('signal-1');
    expect(parseKoshkoWindowMessageV1({ ...message, version: 2 })).toBeUndefined();
  });

  it('exports a JSON schema artifact', () => {
    expect(koshkoSignalV1JsonSchema).toMatchObject({
      title: 'KoshkoSignalV1',
      properties: {
        protocol: { const: 'koshko' },
        version: { const: 1 },
      },
    });
    expect(koshkoStateMutationV1JsonSchema).toMatchObject({
      title: 'KoshkoStateMutationV1',
      properties: {
        protocol: { const: 'koshko' },
        version: { const: 1 },
        patch: { type: 'array' },
      },
    });
    expect(koshkoErrorV1JsonSchema).toMatchObject({
      title: 'KoshkoErrorV1',
      required: expect.arrayContaining(['source', 'name', 'payload']),
      properties: {
        protocol: { const: 'koshko' },
        version: { const: 1 },
      },
    });
  });

  it('parses errors as a separate discriminated message and normalizes payloads', () => {
    const error = {
      protocol: 'koshko',
      version: 1,
      id: 'error-1',
      producerId: 'browser-console:frame-1',
      producerSequence: 1,
      occurredAt: 10,
      source: { id: 'browser-console', label: 'Browser Console' },
      name: 'console.error',
      payload: { arguments: [{ token: 'secret' }] },
    };
    const message = { protocol: 'koshko', version: 1, type: 'error', error };

    expect(isKoshkoErrorV1(error)).toBe(true);
    expect(isKoshkoProtocolWindowMessageV1(message)).toBe(true);
    expect(isKoshkoWindowMessageV1(message)).toBe(false);
    expect(parseKoshkoErrorWindowMessageV1(message)?.error.payload).toEqual({
      arguments: [{ token: '[Redacted]' }],
    });
    expect(parseKoshkoProtocolWindowMessageV1(message)?.type).toBe('error');
  });

  it('rejects malformed and getter-backed errors without invoking getters', () => {
    const error = {
      protocol: 'koshko',
      version: 1,
      id: 'error-1',
      producerId: 'browser-console',
      producerSequence: 1,
      occurredAt: 10,
      source: { id: 'browser-console' },
      name: 'console.error',
      payload: { arguments: [] },
    };

    expect(isKoshkoErrorV1({ ...error, payload: undefined })).toBe(false);
    expect(isKoshkoErrorV1({ ...error, producerSequence: 0 })).toBe(false);
    expect(isKoshkoErrorV1({ ...error, name: 'x'.repeat(129) })).toBe(false);

    let getterInvoked = false;
    const source = {};
    Object.defineProperty(source, 'id', {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error('must not run');
      },
    });
    expect(() => isKoshkoErrorV1({ ...error, source })).not.toThrow();
    expect(isKoshkoErrorV1({ ...error, source })).toBe(false);
    expect(getterInvoked).toBe(false);
  });

  it('parses state mutations as a separate discriminated message', () => {
    const mutation = {
      protocol: 'koshko',
      version: 1,
      id: 'mutation-1',
      producerId: 'state-demo',
      producerSequence: 1,
      occurredAt: 10,
      patch: [
        { op: 'add', path: '/cart', value: { total: 42, token: 'secret' } },
      ],
    };
    const message = {
      protocol: 'koshko',
      version: 1,
      type: 'state-mutation',
      mutation,
    };

    expect(isKoshkoStateMutationV1(mutation)).toBe(true);
    expect(isKoshkoProtocolWindowMessageV1(message)).toBe(true);
    expect(isKoshkoWindowMessageV1(message)).toBe(false);

    const parsed = parseKoshkoProtocolWindowMessageV1(message);
    expect(parsed?.type).toBe('state-mutation');
    if (parsed?.type === 'state-mutation') {
      expect(parsed.mutation.patch[0]).toEqual({
        op: 'add',
        path: '/cart',
        value: { total: 42, token: '[Redacted]' },
      });
    }
  });

  it('rejects malformed state patches and unsupported message kinds', () => {
    const base = {
      protocol: 'koshko',
      version: 1,
      id: 'mutation-1',
      producerId: 'state-demo',
      producerSequence: 1,
      occurredAt: 10,
    };

    expect(isKoshkoStateMutationV1({
      ...base,
      patch: [{ op: 'add', path: '', value: true }],
    })).toBe(false);
    expect(isKoshkoStateMutationV1({
      ...base,
      patch: [{ op: 'replace', path: '/ready' }],
    })).toBe(false);
    expect(isKoshkoStateMutationV1({
      ...base,
      patch: [{ op: 'move', path: '/ready', value: true }],
    })).toBe(false);
    expect(parseKoshkoProtocolWindowMessageV1({
      protocol: 'koshko',
      version: 1,
      type: 'snapshot',
    })).toBeUndefined();
  });

  it('accepts bounded state mutation labels and rejects malformed labels', () => {
    const mutation = {
      protocol: 'koshko',
      version: 1,
      id: 'mutation-1',
      producerId: 'state-demo',
      producerSequence: 1,
      occurredAt: 10,
      label: 'Checkout ready',
      patch: [],
    };

    expect(isKoshkoStateMutationV1(mutation)).toBe(true);
    expect(isKoshkoStateMutationV1({ ...mutation, label: '' })).toBe(false);
    expect(isKoshkoStateMutationV1({ ...mutation, label: 42 })).toBe(false);
    expect(isKoshkoStateMutationV1({ ...mutation, label: 'x'.repeat(129) })).toBe(false);
  });

  it('rejects oversized normalized state mutations without invoking getters', () => {
    const oversizedMutation = {
      protocol: 'koshko',
      version: 1,
      id: 'mutation-large',
      producerId: 'state-demo',
      producerSequence: 1,
      occurredAt: 10,
      patch: Array.from({ length: 5 }, (_, index) => ({
        op: 'add',
        path: `/large-${index}`,
        value: 'x'.repeat(16_000),
      })),
    };
    const message = {
      protocol: 'koshko',
      version: 1,
      type: 'state-mutation',
      mutation: oversizedMutation,
    };

    expect(isKoshkoStateMutationV1(oversizedMutation)).toBe(false);
    expect(parseKoshkoProtocolWindowMessageV1(message)).toBeUndefined();

    let getterInvoked = false;
    const mutationWithGetter = { ...oversizedMutation };
    Object.defineProperty(mutationWithGetter, 'patch', {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error('must not run');
      },
    });

    expect(() => isKoshkoStateMutationV1(mutationWithGetter)).not.toThrow();
    expect(isKoshkoStateMutationV1(mutationWithGetter)).toBe(false);
    expect(getterInvoked).toBe(false);
  });
});
