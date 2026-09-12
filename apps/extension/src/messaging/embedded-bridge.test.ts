import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDED_BRIDGE_PROTOCOL,
  EMBEDDED_BRIDGE_VERSION,
  EmbeddedPanelConnection,
  type EmbeddedBridgeMessage,
} from './embedded-bridge';

class FakeEventTarget {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  emit(event: { data: unknown; origin: string; source: unknown }): void {
    this.listeners.forEach((listener) => listener(event as MessageEvent<unknown>));
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeParentWindow {
  readonly messages: EmbeddedBridgeMessage[] = [];

  postMessage(message: EmbeddedBridgeMessage): void {
    this.messages.push(message);
  }
}

function capturedSignal(contextId = 'top'): unknown {
  return {
    signal: {
      protocol: 'koshko',
      version: 1,
      id: 'signal-1',
      producerId: 'demo',
      producerSequence: 1,
      occurredAt: 1,
      source: { id: 'demo' },
      name: 'demo.ready',
    },
    observedAt: 2,
    captureContext: { id: contextId, kind: 'top' },
    navigationId: 'navigation-1',
    frameUrl: 'https://demo.example.test',
    frameOrigin: 'https://demo.example.test',
  };
}

function hostMessage(
  sessionId: string,
  message: object,
): EmbeddedBridgeMessage {
  return {
    protocol: EMBEDDED_BRIDGE_PROTOCOL,
    version: EMBEDDED_BRIDGE_VERSION,
    sessionId,
    ...message,
  } as EmbeddedBridgeMessage;
}

function createConnection(): {
  connection: EmbeddedPanelConnection;
  target: FakeEventTarget;
  parent: FakeParentWindow;
  sessionId: string;
} {
  const target = new FakeEventTarget();
  const parent = new FakeParentWindow();
  const sessionId = 'session-1';
  const connection = new EmbeddedPanelConnection({
    parentWindow: parent,
    parentOrigin: 'https://demo.example.test',
    eventTarget: target,
    createSessionId: () => sessionId,
  });
  return { connection, target, parent, sessionId };
}

function ready(
  target: FakeEventTarget,
  parent: FakeParentWindow,
  sessionId: string,
  generation = 0,
): void {
  target.emit({
    origin: 'https://demo.example.test',
    source: parent,
    data: hostMessage(sessionId, { type: 'host-ready', generation }),
  });
}

describe('EmbeddedPanelConnection', () => {
  it('handshakes only with its configured parent origin and WindowProxy', () => {
    const { connection, target, parent, sessionId } = createConnection();
    const status = vi.fn();
    connection.subscribeStatus(status);

    expect(parent.messages).toEqual([
      hostMessage(sessionId, { type: 'inspector-ready' }),
    ]);
    target.emit({
      origin: 'https://attacker.example.test',
      source: parent,
      data: hostMessage(sessionId, { type: 'host-ready', generation: 0 }),
    });
    target.emit({
      origin: 'https://demo.example.test',
      source: new FakeParentWindow(),
      data: hostMessage(sessionId, { type: 'host-ready', generation: 0 }),
    });
    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage('other-session', { type: 'host-ready', generation: 0 }),
    });

    expect(connection.status).toBe('connecting');
    ready(target, parent, sessionId);
    expect(connection.status).toBe('connected');
    expect(status).toHaveBeenLastCalledWith('connected');
  });

  it('normalizes valid captures, deduplicates sequences, and acknowledges delivery', () => {
    const { connection, target, parent, sessionId } = createConnection();
    const received = vi.fn();
    connection.subscribe(received);
    ready(target, parent, sessionId);
    const capture = hostMessage(sessionId, {
      type: 'capture',
      generation: 0,
      contextId: 'top',
      sequence: 1,
      kind: 'signal',
      captured: capturedSignal(),
    });

    target.emit({ origin: 'https://demo.example.test', source: parent, data: capture });
    target.emit({ origin: 'https://demo.example.test', source: parent, data: capture });
    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage(sessionId, {
        type: 'capture',
        generation: 1,
        contextId: 'top',
        sequence: 2,
        kind: 'signal',
        captured: capturedSignal(),
      }),
    });

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'signal',
      captured: expect.objectContaining({ captureContext: { id: 'top', kind: 'top' } }),
    }));
    expect(parent.messages).toContainEqual(hostMessage(sessionId, {
      type: 'ack', generation: 0, contextId: 'top', sequence: 1,
    }));
  });

  it('rejects mismatched context payloads before acknowledging them', () => {
    const { connection, target, parent, sessionId } = createConnection();
    const received = vi.fn();
    connection.subscribe(received);
    ready(target, parent, sessionId);

    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage(sessionId, {
        type: 'capture', generation: 0, contextId: 'embedded', sequence: 1, kind: 'signal', captured: capturedSignal('top'),
      }),
    });

    expect(received).not.toHaveBeenCalled();
    expect(parent.messages).toHaveLength(1);
  });

  it('forwards normalized state mutations and errors through the same validated bridge', () => {
    const { connection, target, parent, sessionId } = createConnection();
    const received = vi.fn();
    connection.subscribe(received);
    ready(target, parent, sessionId);
    const metadata = {
      observedAt: 2,
      captureContext: { id: 'top', kind: 'top' },
      navigationId: 'navigation-1',
      frameUrl: 'https://demo.example.test',
      frameOrigin: 'https://demo.example.test',
    };

    target.emit({
      origin: 'https://demo.example.test', source: parent,
      data: hostMessage(sessionId, {
        type: 'capture', generation: 0, contextId: 'top', sequence: 1, kind: 'state-mutation',
        captured: {
          ...metadata,
          mutation: {
            protocol: 'koshko', version: 1, id: 'mutation-1', producerId: 'demo', producerSequence: 1,
            occurredAt: 1, patch: [{ op: 'add', path: '/ready', value: true }],
          },
        },
      }),
    });
    target.emit({
      origin: 'https://demo.example.test', source: parent,
      data: hostMessage(sessionId, {
        type: 'capture', generation: 0, contextId: 'top', sequence: 2, kind: 'error',
        captured: {
          ...metadata,
          error: {
            protocol: 'koshko', version: 1, id: 'error-1', producerId: 'demo', producerSequence: 2,
            occurredAt: 2, source: { id: 'demo' }, name: 'console.error', payload: { message: 'failed' },
          },
        },
      }),
    });

    expect(received.mock.calls.map(([message]) => message.kind)).toEqual(['state-mutation', 'error']);
  });

  it('waits for a reset acknowledgement before moving to the new generation', async () => {
    const { connection, target, parent, sessionId } = createConnection();
    ready(target, parent, sessionId, 2);

    const reset = connection.clear();
    expect(parent.messages).toContainEqual(hostMessage(sessionId, { type: 'reset', generation: 2 }));
    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage(sessionId, { type: 'reset-ack', generation: 2 }),
    });
    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage(sessionId, { type: 'reset-ack', generation: 3 }),
    });
    await expect(reset).resolves.toBeUndefined();

    const received = vi.fn();
    connection.subscribe(received);
    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage(sessionId, {
        type: 'capture', generation: 2, contextId: 'top', sequence: 1, kind: 'signal', captured: capturedSignal(),
      }),
    });
    target.emit({
      origin: 'https://demo.example.test',
      source: parent,
      data: hostMessage(sessionId, {
        type: 'capture', generation: 3, contextId: 'top', sequence: 1, kind: 'signal', captured: capturedSignal(),
      }),
    });
    expect(received).toHaveBeenCalledOnce();
  });

  it('rejects a pending reset on dispose and lets a fresh instance reconnect', async () => {
    const first = createConnection();
    ready(first.target, first.parent, first.sessionId);
    const reset = first.connection.clear();
    first.connection.dispose();

    await expect(reset).rejects.toThrow('disposed');
    expect(first.target.listenerCount).toBe(0);

    const second = createConnection();
    ready(second.target, second.parent, second.sessionId, 4);
    expect(second.connection.status).toBe('connected');
  });
});
