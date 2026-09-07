import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActorEmitter, createStateEmitter } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('actor emitter', () => {
  it('posts a versioned signal message to its own window', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    vi.stubGlobal('performance', { timeOrigin: 100, now: () => 25 });

    const emitter = createActorEmitter({ id: 'host', label: 'Host application', producerId: 'producer-host' });
    const signal = emitter.to('widget', 'payment.start', { amount: 42 }, { severity: 'info', correlationId: 'corr-1', tags: ['checkout'] });

    expect(signal.protocol).toBe('koshko');
    expect(signal.version).toBe(1);
    expect(signal.producerSequence).toBe(1);
    expect(signal.producerId).toBe('producer-host');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'koshko',
        version: 1,
        type: 'signal',
        signal: expect.objectContaining({
          source: { id: 'host', label: 'Host application' },
          target: { id: 'widget' },
          name: 'payment.start',
          occurredAt: 125,
        }),
      }),
      '*',
    );
  });

  it('never throws when the browser transport is unavailable', () => {
    vi.stubGlobal('window', { postMessage: () => {
      throw new Error('transport down');
    } });

    const emitter = createActorEmitter({ id: 'host' });
    expect(() => emitter.event('order-token.received', { value: 1 })).not.toThrow();
  });

  it('uses a monotonic producer sequence and falls back to Date.now', () => {
    vi.stubGlobal('window', { postMessage: vi.fn() });
    vi.stubGlobal('performance', undefined);
    vi.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));

    const emitter = createActorEmitter({ id: 'host' });
    const first = emitter.event('alpha');
    const second = emitter.event('beta');

    expect(first.producerSequence).toBe(1);
    expect(second.producerSequence).toBe(2);
    expect(second.occurredAt).toBeGreaterThanOrEqual(first.occurredAt);
  });
});

describe('state emitter', () => {
  it('posts normalized state mutations with a monotonic producer sequence', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    vi.stubGlobal('performance', { timeOrigin: 200, now: () => 50 });

    const emitter = createStateEmitter({ producerId: 'demo-state' });
    const first = emitter.mutate([
      {
        op: 'add',
        path: '/checkout',
        value: {
          ready: true,
          token: 'secret',
          returnUrl: 'https://example.com/done?order=42',
        },
      },
    ]);
    const second = emitter.mutate(
      [{ op: 'replace', path: '/checkout/ready', value: false }],
      { occurredAt: 999, label: 'Checkout readiness updated' },
    );

    expect(first).toMatchObject({
      protocol: 'koshko',
      version: 1,
      producerId: 'demo-state',
      producerSequence: 1,
      occurredAt: 250,
      patch: [{
        op: 'add',
        path: '/checkout',
        value: {
          ready: true,
          token: '[Redacted]',
          returnUrl: 'https://example.com/done',
        },
      }],
    });
    expect(second.producerSequence).toBe(2);
    expect(second.occurredAt).toBe(999);
    expect(second.label).toBe('Checkout readiness updated');
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      protocol: 'koshko',
      version: 1,
      type: 'state-mutation',
      mutation: first,
    }, '*');
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      protocol: 'koshko',
      version: 1,
      type: 'state-mutation',
      mutation: second,
    }, '*');
  });

  it('returns a mutation when state transport fails', () => {
    vi.stubGlobal('window', { postMessage: () => {
      throw new Error('transport down');
    } });

    const emitter = createStateEmitter({ producerId: 'demo-state' });
    expect(() => emitter.mutate([
      { op: 'add', path: '/ready', value: true },
    ])).not.toThrow();
    expect(emitter.mutate([
      { op: 'remove', path: '/ready' },
    ])).toMatchObject({
      producerId: 'demo-state',
      producerSequence: 2,
    });
  });

  it('returns but does not transport an oversized state mutation', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });

    const emitter = createStateEmitter({ producerId: 'demo-state' });
    const mutation = emitter.mutate(Array.from({ length: 5 }, (_, index) => ({
      op: 'add' as const,
      path: `/large-${index}`,
      value: 'x'.repeat(16_000),
    })));

    expect(mutation.patch).toHaveLength(5);
    expect(mutation.patch[0]).toMatchObject({
      op: 'add',
      path: '/large-0',
      value: expect.stringMatching(/^x+$/),
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
