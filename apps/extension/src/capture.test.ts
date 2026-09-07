import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCapture } from './capture';
import { PANEL_MESSAGE_CAPTURE } from './shared';

describe('window capture', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    vi.unstubAllGlobals();
  });

  it('forwards valid signals with capture metadata', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture());

    dispatchSelfMessage({
      protocol: 'koshko',
      version: 1,
      type: 'signal',
      signal: {
        protocol: 'koshko',
        version: 1,
        id: 'signal-1',
        producerId: 'demo',
        producerSequence: 1,
        occurredAt: 10,
        source: { id: 'host' },
        name: 'host.ready',
      },
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'signal',
      signal: expect.objectContaining({ id: 'signal-1', name: 'host.ready' }),
      observedAt: expect.any(Number),
      navigationId: expect.any(String),
      frameUrl: location.href,
      frameOrigin: location.origin,
    }));
  });

  it('forwards normalized and redacted state mutations with capture metadata', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture());

    dispatchSelfMessage({
      protocol: 'koshko',
      version: 1,
      type: 'state-mutation',
      mutation: {
        protocol: 'koshko',
        version: 1,
        id: 'mutation-1',
        producerId: 'demo',
        producerSequence: 1,
        occurredAt: 10,
        patch: [{ op: 'add', path: '/token', value: 'sensitive-token' }],
      },
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'state-mutation',
      mutation: expect.objectContaining({
        id: 'mutation-1',
        patch: [{ op: 'add', path: '/token', value: '[Redacted]' }],
      }),
      observedAt: expect.any(Number),
      navigationId: expect.any(String),
      frameUrl: location.href,
      frameOrigin: location.origin,
    }));
  });

  it('ignores malformed, unsupported, and non-self window messages', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture());

    dispatchSelfMessage({ protocol: 'koshko', version: 1, type: 'signal', signal: {} });
    dispatchSelfMessage({ protocol: 'koshko', version: 1, type: 'unsupported' });
    window.dispatchEvent(new MessageEvent('message', {
      data: validSignalMessage(),
      source: {} as Window,
    }));

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

function dispatchSelfMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: window }));
}

function validSignalMessage(): object {
  return {
    protocol: 'koshko',
    version: 1,
    type: 'signal',
    signal: {
      protocol: 'koshko',
      version: 1,
      id: 'signal-1',
      producerId: 'demo',
      producerSequence: 1,
      occurredAt: 10,
      source: { id: 'host' },
      name: 'host.ready',
    },
  };
}
