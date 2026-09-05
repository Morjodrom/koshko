import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActorEmitter } from './index';

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
