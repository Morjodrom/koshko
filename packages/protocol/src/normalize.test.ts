import { describe, expect, it } from 'vitest';
import {
  compareCapturedSignals,
  normalizeCapturedErrorV1,
  normalizeCapturedSignalV1,
  normalizeCapturedStateMutationV1,
  normalizeJsonValue,
  normalizeKoshkoErrorV1,
  normalizeKoshkoSignalV1,
  normalizeKoshkoStateMutationV1,
} from './index';
import { MAX_SERIALIZED_BYTES, MAX_TEXT_CODE_POINTS } from './limits';
import { serializedJsonByteLength } from './safe-data';

describe('protocol normalization', () => {
  it('redacts sensitive keys, strips URL queries, and preserves markers', () => {
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;

    const signal = normalizeKoshkoSignalV1({
      id: 'signal-1',
      producerId: 'producer-1',
      producerSequence: 1,
      occurredAt: 123,
      source: { id: 'host' },
      name: 'payment.start',
      details: {
        token: 'abc123',
        paymentToken: 'def456',
        endpointUrl: 'https://example.com/path?secret=1#hash',
        nested: circular,
        fn: () => 'nope',
        long: 'a'.repeat(20_000),
      },
    });

    expect(signal.details).toMatchObject({
      token: '[Redacted]',
      paymentToken: '[Redacted]',
      endpointUrl: 'https://example.com/path',
      nested: { self: '[Circular]' },
      fn: '[Function]',
      long: expect.any(String),
    });

    expect((signal.details as Record<string, unknown>).long).toBe('[Truncated]');
  });

  it('normalizes captured signals and keeps order helpers stable', () => {
    const a = normalizeCapturedSignalV1({
      signal: {
        id: 'a',
        producerId: 'p',
        producerSequence: 1,
        occurredAt: 10,
        source: { id: 'host' },
        name: 'alpha',
      },
      observedAt: 20,
      tabId: 1,
      frameId: 2,
      navigationId: 'nav-a',
      frameUrl: 'https://example.com/a?x=1',
      frameOrigin: 'https://example.com',
    });

    const b = normalizeCapturedSignalV1({
      signal: {
        id: 'b',
        producerId: 'p',
        producerSequence: 2,
        occurredAt: 10,
        source: { id: 'host' },
        name: 'beta',
      },
      observedAt: 10,
      tabId: 1,
      frameId: 2,
      navigationId: 'nav-b',
      frameUrl: 'https://example.com/b?x=1',
      frameOrigin: 'https://example.com',
    });

    expect(a.frameUrl).toBe('https://example.com/a');
    expect(compareCapturedSignals(a, b)).toBeGreaterThan(0);
  });

  it('keeps JSON normalization safe for unsupported values', () => {
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, 'getter', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });

    const normalized = normalizeJsonValue({
      value,
      bigint: 1n,
      number: Number.POSITIVE_INFINITY,
      undefinedValue: undefined,
      symbol: Symbol('x'),
    });

    expect(normalized).toMatchObject({
      value: {},
      bigint: '[Unsupported]',
      number: '[Unsupported]',
      undefinedValue: '[Undefined]',
      symbol: '[Unsupported]',
    });
  });

  it('normalizes nested errors without invoking getters', () => {
    const cause = new Error('inner');
    Object.defineProperty(cause, 'token', { value: 'secret', enumerable: true });
    const error = new Error('outer', { cause });
    Object.defineProperty(error, 'dangerous', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });

    const normalized = normalizeJsonValue({ error });

    expect(normalized).toMatchObject({
      error: {
        name: 'Error',
        message: 'outer',
        stack: expect.any(String),
        cause: {
          name: 'Error',
          message: 'inner',
          stack: expect.any(String),
          token: '[Redacted]',
        },
      },
    });
    expect((normalized as Record<string, Record<string, unknown>>).error).not.toHaveProperty('dangerous');
  });

  it('does not invoke user-defined Error stack getters', () => {
    const error = new Error('outer');
    let wasRead = false;
    Object.defineProperty(error, 'stack', {
      get() {
        wasRead = true;
        throw new Error('must not run');
      },
    });

    const normalized = normalizeJsonValue(error);

    expect(wasRead).toBe(false);
    expect(normalized).toMatchObject({ name: 'Error', message: 'outer' });
  });

  it('does not invoke proxy-wrapped Error stack getters', () => {
    const error = new Error('outer');
    let wasApplied = false;
    const stackGetter = new Proxy(() => 'unsafe stack', {
      apply() {
        wasApplied = true;
        throw new Error('must not run');
      },
    });
    Object.defineProperty(error, 'stack', { get: stackGetter });

    const normalized = normalizeJsonValue(error);

    expect(wasApplied).toBe(false);
    expect(normalized).toMatchObject({ name: 'Error', message: 'outer' });
  });

  it('normalizes error payloads and captured metadata defensively', () => {
    const cause = new Error('inner');
    const error = new Error('outer', { cause });
    const normalized = normalizeKoshkoErrorV1({
      id: 'error-1',
      producerId: 'browser-console:frame-1',
      producerSequence: 1,
      occurredAt: 123,
      source: { id: 'browser-console', label: 'Browser Console' },
      name: 'runtime.unhandled-rejection',
      payload: {
        reason: error,
        token: 'secret',
        endpointUrl: 'https://example.test/fail?token=secret#stack',
      },
    });

    expect(normalized.payload).toMatchObject({
      reason: {
        name: 'Error',
        message: 'outer',
        stack: expect.any(String),
        cause: { name: 'Error', message: 'inner', stack: expect.any(String) },
      },
      token: '[Redacted]',
      endpointUrl: 'https://example.test/fail',
    });

    const captured = normalizeCapturedErrorV1({
      error: normalized,
      observedAt: 124,
      tabId: 17,
      frameId: 2,
      documentId: 'document-1',
      navigationId: 'navigation-1',
      frameUrl: 'https://example.test/frame?secret=1#hash',
      frameOrigin: 'https://example.test',
    });
    expect(captured).toMatchObject({
      error: { id: 'error-1' },
      documentId: 'document-1',
      frameUrl: 'https://example.test/frame',
    });
  });

  it('truncates oversized error payloads', () => {
    const error = normalizeKoshkoErrorV1({
      id: 'error-large',
      producerId: 'browser-console',
      producerSequence: 1,
      occurredAt: 1,
      source: { id: 'browser-console' },
      name: 'console.error',
      payload: Object.fromEntries(Array.from(
        { length: 200 },
        (_, index) => [`key-${index}`, Array.from({ length: 500 }, () => 'x')],
      )),
    });

    expect(error.payload).toBe('[Truncated]');
  });

  it('normalizes state mutation labels as bounded identifiers', () => {
    const mutation = normalizeKoshkoStateMutationV1({
      id: 'mutation-1',
      producerId: 'state-demo',
      producerSequence: 1,
      occurredAt: 10,
      label: 'Checkout\u0000 updated',
      patch: [],
    });

    expect(mutation.label).toBe('Checkout updated');
    expect(normalizeKoshkoStateMutationV1({
      ...mutation,
      label: 'x'.repeat(129),
    }).label).toBe('[Truncated]');
  });

  it('compacts multibyte signal data to the serialized byte limit', () => {
    const signal = normalizeKoshkoSignalV1({
      id: 'signal-1',
      producerId: 'producer-1',
      producerSequence: 1,
      occurredAt: 123,
      source: {
        id: 'host',
        label: '😀'.repeat(MAX_TEXT_CODE_POINTS),
        instanceLabel: '😀'.repeat(MAX_TEXT_CODE_POINTS),
      },
      name: 'payment.start',
    });

    expect(serializedJsonByteLength(signal)).toBeLessThanOrEqual(MAX_SERIALIZED_BYTES);
    expect(signal.source.label).toBeUndefined();
    expect(signal.source.instanceLabel).toBeUndefined();
  });

  it('normalizes signal and captured-envelope accessors without invoking them', () => {
    let getterInvoked = false;
    const signal: Record<string, unknown> = {
      id: 'signal-1',
      producerId: 'producer-1',
      producerSequence: 1,
      occurredAt: 123,
      source: { id: 'host' },
      name: 'payment.start',
    };
    Object.defineProperty(signal, 'details', {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error('must not run');
      },
    });
    const capturedSignal: Record<string, unknown> = {
      signal,
      observedAt: 124,
      tabId: 1,
      frameId: 0,
      navigationId: 'nav-1',
      frameUrl: 'https://example.com/path?secret=yes',
      frameOrigin: 'https://example.com',
    };
    Object.defineProperty(capturedSignal, 'documentId', {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error('must not run');
      },
    });
    const capturedMutation: Record<string, unknown> = {
      mutation: {
        id: 'mutation-1',
        producerId: 'producer-1',
        producerSequence: 1,
        occurredAt: 123,
        patch: [],
      },
      observedAt: 124,
      tabId: 1,
      frameId: 0,
      navigationId: 'nav-1',
      frameUrl: 'https://example.com/path',
      frameOrigin: 'https://example.com',
    };
    Object.defineProperty(capturedMutation, 'frameId', {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error('must not run');
      },
    });

    expect(normalizeKoshkoSignalV1(signal).details).toBeUndefined();
    expect(normalizeCapturedSignalV1(capturedSignal).documentId).toBeUndefined();
    expect(normalizeCapturedStateMutationV1(capturedMutation).frameId).toBe(-1);
    expect(getterInvoked).toBe(false);
  });

  it('normalizes hostile proxies without throwing or using property gets', () => {
    let getInvoked = false;
    const readable = new Proxy({
      signal: {
        id: 'signal-1',
        producerId: 'producer-1',
        producerSequence: 1,
        occurredAt: 123,
        source: { id: 'host' },
        name: 'payment.start',
      },
      observedAt: 124,
      tabId: 1,
      frameId: 0,
      navigationId: 'nav-1',
      frameUrl: 'https://example.com/path',
      frameOrigin: 'https://example.com',
    }, {
      get() {
        getInvoked = true;
        throw new Error('must not run');
      },
    });
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(normalizeCapturedSignalV1(readable).signal.id).toBe('signal-1');
    expect(getInvoked).toBe(false);
    expect(() => normalizeCapturedSignalV1(revocable.proxy)).not.toThrow();
    expect(normalizeCapturedSignalV1(revocable.proxy).signal.id).toBe('[Invalid]');
  });
});
