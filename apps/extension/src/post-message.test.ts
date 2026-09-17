import { describe, expect, it } from 'vitest';
import {
  normalizeCapturedPostMessage,
  normalizePostMessageData,
  type CapturedPostMessage,
} from './post-message';

describe('postMessage normalization', () => {
  it('preserves JSON data and redacts sensitive and URL fields', () => {
    expect(normalizePostMessageData({
      ok: true,
      count: 2,
      token: 'secret',
      checkoutAuthTokenValue: 'also-secret',
      url: 'https://example.test/p?q=1#x',
    })).toEqual({
      ok: true,
      count: 2,
      token: '[Redacted]',
      checkoutAuthTokenValue: '[Redacted]',
      url: 'https://example.test/p',
    });
  });

  it('tags structured-clone values', () => {
    const normalized = normalizePostMessageData({
      date: new Date('2020-01-01T00:00:00.000Z'),
      regexp: /hello/gi,
      map: new Map<unknown, unknown>([['a', 1], ['accessToken', 'secret']]),
      set: new Set(['x']),
      bigint: 10n,
      error: new Error('boom'),
      bytes: new Uint8Array([1, 2]),
    }) as Record<string, any>;

    expect(normalized.date).toEqual({ $type: 'date', value: '2020-01-01T00:00:00.000Z' });
    expect(normalized.regexp).toEqual({ $type: 'regexp', source: 'hello', flags: 'gi' });
    expect(normalized.map).toMatchObject({
      $type: 'map',
      entries: [['a', 1], ['accessToken', '[Redacted]']],
    });
    expect(normalized.set).toMatchObject({ $type: 'set', values: ['x'] });
    expect(normalized.bigint).toEqual({ $type: 'bigint', value: '10' });
    expect(normalized.error).toMatchObject({ $type: 'error', message: 'boom' });
    expect(normalized.bytes).toMatchObject({
      $type: 'binary',
      type: 'Uint8Array',
      bytes: [1, 2],
      truncated: false,
    });
  });

  it('does not invoke getters and marks hostile values safely', () => {
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, 'danger', {
      enumerable: true,
      get: () => { throw new Error('getter called'); },
    });
    value.fn = () => 'no';
    value.windowLike = { valueOf: () => 1 };
    value.self = value;
    Object.defineProperty(value, Symbol.toStringTag, {
      enumerable: true,
      get: () => { throw new Error('tag called'); },
    });

    expect(() => normalizePostMessageData(value)).not.toThrow();
    expect(normalizePostMessageData(value)).toBe('[Unsupported]');
  });

  it('bounds depth, collections, text, and serialized size', () => {
    let nested: unknown = true;
    for (let index = 0; index < 12; index += 1) nested = { nested };
    expect(JSON.stringify(normalizePostMessageData(nested))).toContain('[Truncated]');
    expect(normalizePostMessageData('x'.repeat(20_000))).toContain('[Truncated]');
    expect(normalizePostMessageData({
      a: 'x'.repeat(16_000),
      b: 'x'.repeat(16_000),
      c: 'x'.repeat(16_000),
      d: 'x'.repeat(16_000),
      e: 'x'.repeat(16_000),
    })).toEqual({ $type: 'truncated', reason: 'size-limit' });
  });

  it('validates and sanitizes captured metadata for transport', () => {
    const message: CapturedPostMessage = {
      kind: 'post-message',
      id: 'm1',
      sequence: 1,
      observedAt: 10,
      origin: 'https://sender.test?secret=1',
      source: 'parent',
      data: { ok: true },
      tabId: 2,
      frameId: 3,
      documentId: 'doc',
      navigationId: 'nav',
      frameUrl: 'https://page.test/path?x=1',
      frameOrigin: 'https://page.test',
    };
    expect(normalizeCapturedPostMessage(message)).toMatchObject({
      kind: 'post-message',
      origin: 'https://sender.test?secret=1',
      frameUrl: 'https://page.test/path',
      documentId: 'doc',
      data: { ok: true },
    });
    expect(normalizeCapturedPostMessage({ ...message, source: 'invalid' })).toBeUndefined();
  });
});
