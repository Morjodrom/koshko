import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { KoshkoBridgeServer } from './bridge-server';
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PATH, DEFAULT_BRIDGE_PORT } from './config';
import { CaptureStore } from './store';
import { aiLogResponse, authToken, batch, hello } from './test-fixtures';

class FakeSocket extends EventEmitter {
  public readyState = 1;
  public readonly sent: string[] = [];

  public send(value: string): void {
    this.sent.push(value);
  }

  public close(): void {
    this.readyState = 3;
    this.emit('close');
  }
}

function createBridge(): { bridge: KoshkoBridgeServer; store: CaptureStore } {
  const store = new CaptureStore({ maxSessions: 3, maxEntriesPerSession: 10, maxEntriesTotal: 20 });
  return {
    store,
    bridge: new KoshkoBridgeServer({
      config: {
        authToken,
        host: DEFAULT_BRIDGE_HOST,
        port: DEFAULT_BRIDGE_PORT,
        path: DEFAULT_BRIDGE_PATH,
        aiLogTimeoutMs: 100,
      },
      store,
      requestId: () => 'request-1',
    }),
  };
}

function connect(bridge: KoshkoBridgeServer): FakeSocket {
  const socket = new FakeSocket();
  bridge.acceptSocket(socket as unknown as WebSocket);
  return socket;
}

function send(socket: FakeSocket, value: object): void {
  socket.emit('message', JSON.stringify(value), false);
}

describe('KoshkoBridgeServer', () => {
  it('does not accept data before a successful authenticated hello', () => {
    const { bridge, store } = createBridge();
    const socket = connect(bridge);
    send(socket, batch());

    expect(store.getSession('session-1')).toBeUndefined();
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ type: 'server-error', code: 'authentication-failed' });
  });

  it('rejects an invalid authentication token before storing data', () => {
    const { bridge, store } = createBridge();
    const socket = connect(bridge);
    send(socket, { ...hello(), authToken: 'z'.repeat(32) });

    expect(store.listSessions(10)).toEqual([]);
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ type: 'server-error', code: 'authentication-failed' });
  });

  it('rejects malformed messages without storing them', () => {
    const { bridge, store } = createBridge();
    const socket = connect(bridge);
    socket.emit('message', '{not json', false);

    expect(store.listSessions(10)).toEqual([]);
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ type: 'server-error', code: 'invalid-message' });
  });

  it('acknowledges authentication with a new resumable session before capture data', () => {
    const { bridge, store } = createBridge();
    const socket = connect(bridge);

    send(socket, hello());

    const ready = JSON.parse(socket.sent[0] ?? '{}');
    expect(ready).toMatchObject({ type: 'server-ready', session: { navigationId: 'extension-1' } });
    expect(store.getSession(ready.session.sessionId)?.entryCount).toBe(0);
  });

  it('resumes a disconnected session and acknowledges accepted entry IDs', () => {
    const { bridge, store } = createBridge();
    const first = connect(bridge);
    send(first, hello('session-1'));
    send(first, batch('session-1', 'entry-1'));
    first.close();

    expect(store.getSession('session-1')?.connected).toBe(false);
    const resumed = connect(bridge);
    send(resumed, hello('session-1'));
    send(resumed, batch('session-1', 'entry-2'));

    expect(store.getSession('session-1')?.connected).toBe(true);
    expect(store.readEntries('session-1', 0, 10)?.map((value) => value.entryId)).toEqual(['entry-1', 'entry-2']);
    expect(resumed.sent.map((message) => JSON.parse(message).type)).toEqual(['server-ready', 'server-ack']);
  });

  it('requests a validated AI log and caches its matching response', async () => {
    const { bridge, store } = createBridge();
    const socket = connect(bridge);
    send(socket, hello('session-1'));
    send(socket, batch());

    const requested = bridge.requestAiLog('session-1', '8k');
    expect(JSON.parse(socket.sent.at(-1) ?? '{}')).toMatchObject({ type: 'ai-log-request', requestId: 'request-1' });
    send(socket, aiLogResponse());

    await expect(requested).resolves.toMatchObject({ text: 'formatted capture evidence' });
    await expect(bridge.requestAiLog('session-1', '8k')).resolves.toMatchObject({ text: 'formatted capture evidence' });
    expect(store.getAiLog('session-1', '8k')).toBeDefined();
  });

  it('times out an unanswered AI log request', async () => {
    const { bridge } = createBridge();
    const socket = connect(bridge);
    send(socket, hello('session-1'));
    send(socket, batch());

    await expect(bridge.requestAiLog('session-1', '16k', 100)).rejects.toThrow('Timed out');
  });
});
