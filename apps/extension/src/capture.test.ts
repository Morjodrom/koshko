import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCapture } from './capture';
import { PANEL_MESSAGE_CAPTURE } from './messaging/messages';

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

    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'post-message',
      sequence: 1,
      source: 'self',
      data: expect.objectContaining({ type: 'signal' }),
    }));
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'signal',
      signal: expect.objectContaining({ id: 'signal-1', name: 'host.ready' }),
      observedAt: expect.any(Number),
      navigationId: expect.any(String),
      frameUrl: location.href,
      frameOrigin: location.origin,
    }));
  });

  it('captures origin, source classification, unique ids, and monotonic sequence', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture());

    window.dispatchEvent(new MessageEvent('message', {
      data: { action: 'parent.ready', token: 'secret' },
      origin: 'https://parent.example.test',
      source: {} as Window,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: new Date('2026-09-05T12:34:56.789Z'),
      origin: 'null',
      source: null,
    }));

    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: 'post-message',
      id: expect.any(String),
      sequence: 1,
      origin: 'https://parent.example.test',
      source: 'other',
      data: { action: 'parent.ready', token: '[Redacted]' },
    }));
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: 'post-message',
      id: expect.any(String),
      sequence: 2,
      origin: 'null',
      source: 'none',
      data: { $type: 'date', value: '2026-09-05T12:34:56.789Z' },
    }));
    const ids = sendMessage.mock.calls.map(
      (call) => (call as unknown as [{ id: string }])[0].id,
    );
    expect(ids[0]).not.toBe(ids[1]);
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

  it('forwards normalized browser errors as error transport messages', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture());

    dispatchSelfMessage({
      protocol: 'koshko',
      version: 1,
      type: 'error',
      error: {
        protocol: 'koshko',
        version: 1,
        id: 'error-1',
        producerId: 'browser-console:frame-1',
        producerSequence: 1,
        occurredAt: 10,
        source: { id: 'browser-console', label: 'Browser Console' },
        name: 'console.error',
        payload: {
          arguments: [{ token: 'sensitive-token' }],
        },
      },
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: PANEL_MESSAGE_CAPTURE,
      kind: 'error',
      error: expect.objectContaining({
        id: 'error-1',
        name: 'console.error',
        payload: { arguments: [{ token: '[Redacted]' }] },
      }),
      observedAt: expect.any(Number),
      navigationId: expect.any(String),
      frameUrl: location.href,
      frameOrigin: location.origin,
    }));
  });

  it('forwards malformed and non-self messages as raw captures without semantic routing', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture());

    dispatchSelfMessage({ protocol: 'koshko', version: 1, type: 'signal', signal: {} });
    dispatchSelfMessage({ protocol: 'koshko', version: 1, type: 'unsupported' });
    window.dispatchEvent(new MessageEvent('message', {
      data: validSignalMessage(),
      source: {} as Window,
    }));

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'post-message' }));
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'post-message' }));
    expect(sendMessage).toHaveBeenNthCalledWith(3, expect.objectContaining({ kind: 'post-message' }));
  });

  it('installs only one listener when capture is activated repeatedly', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    cleanups.push(startCapture(), startCapture());

    dispatchSelfMessage(validSignalMessage());

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'post-message' }));
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'signal' }));
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
