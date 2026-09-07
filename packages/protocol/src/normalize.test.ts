import { describe, expect, it } from 'vitest';
import {
  compareCapturedSignals,
  normalizeCapturedSignalV1,
  normalizeJsonValue,
  normalizeKoshkoSignalV1,
  normalizeKoshkoStateMutationV1,
} from './index';

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
});
