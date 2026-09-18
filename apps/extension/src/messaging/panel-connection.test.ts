import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_HEARTBEAT_INTERVAL_MS,
  PANEL_READY_TIMEOUT_MS,
  PANEL_RETRY_DELAYS_MS,
  PanelConnection,
  type PanelConnectionPort,
} from './panel-connection';
import { PANEL_MESSAGE_HEARTBEAT, PANEL_MESSAGE_READY } from './messages';

class FakePort implements PanelConnectionPort {
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  readonly messages: unknown[] = [];
  disconnectCalls = 0;
  throwOnPost = false;

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void): void => {
      this.messageListeners.add(listener);
    },
    removeListener: (listener: (message: unknown) => void): void => {
      this.messageListeners.delete(listener);
    },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void): void => {
      this.disconnectListeners.add(listener);
    },
    removeListener: (listener: () => void): void => {
      this.disconnectListeners.delete(listener);
    },
  };

  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error('port closed');
    this.messages.push(message);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  emit(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  emitDisconnect(): void {
    this.disconnectListeners.forEach((listener) => listener());
  }

  get listenerCount(): number {
    return this.messageListeners.size + this.disconnectListeners.size;
  }
}

describe('PanelConnection', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for ready before forwarding messages and sends a twenty-second heartbeat', () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const connection = new PanelConnection(() => port);
    const received = vi.fn();
    connection.subscribe(received);

    expect(connection.status).toBe('connecting');
    port.emit(null);
    port.emit({});
    port.emit({ type: 'koshko:capture', kind: 'signal', captured: { signal: {} } });
    expect(received).not.toHaveBeenCalled();

    port.emit({ type: PANEL_MESSAGE_READY });
    port.emit({ type: 'koshko:capture', kind: 'signal', captured: { signal: {} } });
    port.emit({ type: 'koshko:capture', kind: 'error', captured: { error: {} } });
    expect(received).toHaveBeenCalledTimes(2);
    expect(received).toHaveBeenLastCalledWith({
      type: 'koshko:capture',
      kind: 'error',
      captured: { error: {} },
    });
    expect(connection.status).toBe('connected');
    vi.advanceTimersByTime(PANEL_HEARTBEAT_INTERVAL_MS);

    expect(port.messages).toContainEqual({ type: PANEL_MESSAGE_HEARTBEAT });
  });

  it('forwards only valid postMessage captures', () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const connection = new PanelConnection(() => port);
    const received = vi.fn();
    connection.subscribe(received);
    port.emit({ type: PANEL_MESSAGE_READY });
    const captured = {
      kind: 'post-message',
      id: 'message-1',
      sequence: 1,
      observedAt: 10,
      origin: 'https://sender.example.test',
      source: 'parent',
      data: { ready: true, token: 'secret' },
      tabId: 17,
      frameId: 2,
      documentId: 'document-1',
      navigationId: 'navigation-1',
      frameUrl: 'https://frame.example.test/path',
      frameOrigin: 'https://frame.example.test',
    };

    port.emit({ type: 'koshko:capture', kind: 'post-message', captured });
    port.emit({
      type: 'koshko:capture',
      kind: 'post-message',
      captured: { ...captured, source: 'invalid' },
    });

    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith({
      type: 'koshko:capture',
      kind: 'post-message',
      captured: { ...captured, data: { ready: true, token: '[Redacted]' } },
    });
    connection.dispose();
  });

  it('forwards normalized first-class user events', () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const connection = new PanelConnection(() => port);
    const received = vi.fn();
    connection.subscribe(received);
    port.emit({ type: PANEL_MESSAGE_READY });
    port.emit({
      type: 'koshko:capture',
      kind: 'event',
      captured: {
        kind: 'event',
        id: 'event-1',
        sequence: 1,
        observedAt: 10,
        eventType: 'page-open',
        tabId: 1,
        frameId: 0,
        navigationId: 'nav',
        frameUrl: 'https://example.test',
        frameOrigin: 'https://example.test',
      },
    });

    expect(received).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'event',
      captured: expect.objectContaining({ eventType: 'page-open' }),
    }));
    connection.dispose();
  });

  it('retries a missing ready acknowledgement using the capped backoff sequence', () => {
    vi.useFakeTimers();
    const ports = Array.from({ length: 7 }, () => new FakePort());
    const connect = vi.fn(() => ports.shift()!);
    const connection = new PanelConnection(connect);

    for (const delay of PANEL_RETRY_DELAYS_MS) {
      vi.advanceTimersByTime(PANEL_READY_TIMEOUT_MS);
      vi.advanceTimersByTime(delay);
    }
    vi.advanceTimersByTime(PANEL_READY_TIMEOUT_MS);
    vi.advanceTimersByTime(PANEL_RETRY_DELAYS_MS.at(-1)! - 1);
    expect(connect).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(1);
    expect(connection.status).toBe('reconnecting');
    expect(connect).toHaveBeenCalledTimes(7);
    connection.dispose();
  });

  it('resets retry backoff after a ready acknowledgement', () => {
    vi.useFakeTimers();
    const first = new FakePort();
    const second = new FakePort();
    const third = new FakePort();
    const connect = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const connection = new PanelConnection(connect);

    first.emit({ type: PANEL_MESSAGE_READY });
    first.emitDisconnect();
    vi.advanceTimersByTime(PANEL_RETRY_DELAYS_MS[0]);
    second.emit({ type: PANEL_MESSAGE_READY });
    second.emitDisconnect();
    vi.advanceTimersByTime(PANEL_RETRY_DELAYS_MS[0] - 1);
    expect(connect).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledTimes(3);
    connection.dispose();
  });

  it('removes stale listeners so reconnecting forwards each message once', () => {
    vi.useFakeTimers();
    const first = new FakePort();
    const second = new FakePort();
    const connection = new PanelConnection(vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second));
    const received = vi.fn();
    connection.subscribe(received);
    first.emit({ type: PANEL_MESSAGE_READY });
    first.emitDisconnect();
    vi.advanceTimersByTime(PANEL_RETRY_DELAYS_MS[0]);
    first.emit({ type: 'koshko:capture', kind: 'signal', captured: { signal: {}, stale: true } });
    second.emit({ type: PANEL_MESSAGE_READY });
    second.emit({ type: 'koshko:capture', kind: 'signal', captured: { signal: {}, fresh: true } });

    expect(first.listenerCount).toBe(0);
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenLastCalledWith({ type: 'koshko:capture', kind: 'signal', captured: { signal: {}, fresh: true } });
    connection.dispose();
  });

  it('reconnects when a synchronous heartbeat post fails', () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const connection = new PanelConnection(() => port);

    port.emit({ type: PANEL_MESSAGE_READY });
    port.throwOnPost = true;
    vi.advanceTimersByTime(PANEL_HEARTBEAT_INTERVAL_MS);

    expect(connection.status).toBe('reconnecting');
    expect(port.listenerCount).toBe(0);
    connection.dispose();
  });

  it('disposes timers and listeners without opening another connection', () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const connect = vi.fn(() => port);
    const connection = new PanelConnection(connect);
    connection.dispose();
    vi.advanceTimersByTime(PANEL_READY_TIMEOUT_MS + PANEL_RETRY_DELAYS_MS.at(-1)!);

    expect(connect).toHaveBeenCalledOnce();
    expect(port.listenerCount).toBe(0);
    expect(port.disconnectCalls).toBe(1);
  });
});
