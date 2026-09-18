import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  MAX_BRIDGE_MESSAGE_BYTES,
  isBridgeAuthToken,
  parseBridgeAiLogResponse,
  parseBridgeCaptureBatch,
  parseBridgeClientHello,
  type BridgeAiLogBudget,
  type BridgeAiLogResponse,
  type BridgeAiLogResult,
  type BridgeCaptureBatch,
  type BridgeClientMessage,
  type BridgeServerError,
  type BridgeServerReady,
} from '@koshko/bridge';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { isLiteralLoopback, type CompanionConfig } from './config';
import { CaptureStore, type SessionView } from './store';

interface ConnectionState {
  authenticated: boolean;
  sessionId?: string;
}

interface PendingAiLog {
  sessionId: string;
  budget: BridgeAiLogBudget;
  resolve: (result: BridgeAiLogResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface BridgeServerOptions {
  config: Pick<CompanionConfig, 'authToken' | 'host' | 'port' | 'path' | 'aiLogTimeoutMs'>;
  store: CaptureStore;
  now?: () => number;
  requestId?: () => string;
  maxConnections?: number;
}

/**
 * Accepts only the validated bridge contract on a loopback WebSocket. It has no
 * HTTP API and intentionally reports no captured values through diagnostics.
 */
export class KoshkoBridgeServer {
  private readonly socketState = new WeakMap<WebSocket, ConnectionState>();
  private readonly connections = new Map<string, WebSocket>();
  private readonly pendingAiLogs = new Map<string, PendingAiLog>();
  private readonly sockets = new Set<WebSocket>();
  private readonly now: () => number;
  private readonly requestId: () => string;
  private server?: WebSocketServer;

  public constructor(private readonly options: BridgeServerOptions) {
    if (!isBridgeAuthToken(options.config.authToken) ||
      !isLiteralLoopback(options.config.host) || options.config.path !== '/bridge' ||
      (options.maxConnections !== undefined && (!Number.isSafeInteger(options.maxConnections) || options.maxConnections < 1))) {
      throw new Error('Bridge server may bind only to literal loopback at /bridge.');
    }
    this.now = options.now ?? Date.now;
    this.requestId = options.requestId ?? randomUUID;
  }

  public async start(): Promise<void> {
    if (this.server !== undefined) {
      throw new Error('Bridge server is already running.');
    }
    const server = new WebSocketServer({
      host: this.options.config.host,
      port: this.options.config.port,
      path: this.options.config.path,
      maxPayload: MAX_BRIDGE_MESSAGE_BYTES,
    });
    this.server = server;
    server.on('connection', (socket) => this.acceptSocket(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }

  public async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    this.server = undefined;
    for (const pending of this.pendingAiLogs.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge server stopped.'));
    }
    this.pendingAiLogs.clear();
    for (const socket of this.sockets) {
      socket.terminate();
    }
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }

  public acceptSocket(socket: WebSocket): void {
    if (this.sockets.size >= (this.options.maxConnections ?? 64)) {
      socket.close();
      return;
    }
    this.sockets.add(socket);
    this.socketState.set(socket, { authenticated: false });
    socket.on('message', (data, isBinary) => this.handleMessage(socket, data, isBinary));
    socket.on('close', () => this.handleClose(socket));
    socket.on('error', () => undefined);
  }

  public async requestAiLog(sessionId: string, budget: BridgeAiLogBudget, timeoutMs = this.options.config.aiLogTimeoutMs): Promise<BridgeAiLogResult> {
    const cached = this.options.store.getAiLog(sessionId, budget);
    if (cached !== undefined) {
      return cached;
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new Error('AI log timeout must be between 100 and 30000 milliseconds.');
    }
    const socket = this.connections.get(sessionId);
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Session is not connected to the bridge.');
    }

    const requestId = this.requestId();
    return new Promise<BridgeAiLogResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAiLogs.delete(requestId);
        reject(new Error('Timed out waiting for the extension AI log response.'));
      }, timeoutMs);
      this.pendingAiLogs.set(requestId, { sessionId, budget, resolve, reject, timeout });
      this.send(socket, {
        bridge: 'koshko-bridge',
        version: 1,
        type: 'ai-log-request',
        requestId,
        sessionId,
        budget,
      });
    });
  }

  private handleMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
    const state = this.socketState.get(socket);
    if (state === undefined || isBinary) {
      this.fail(socket, 'invalid-message', 'Bridge messages must be JSON text.', true);
      return;
    }
    const parsed = parseJson(data);
    if (parsed === undefined) {
      this.fail(socket, 'invalid-message', 'Bridge message is malformed.', true);
      return;
    }

    if (!state.authenticated) {
      const hello = parseBridgeClientHello(parsed);
      if (hello === undefined || !tokensEqual(hello.authToken, this.options.config.authToken)) {
        this.fail(socket, 'authentication-failed', 'Bridge authentication failed.', true);
        return;
      }
      state.authenticated = true;
      const connectedAt = this.now();
      const resumed = hello.resumeSessionId === undefined
        ? undefined
        : this.options.store.resumeSession(hello.resumeSessionId, connectedAt);
      const session = resumed ?? this.options.store.upsertSession({
        sessionId: hello.resumeSessionId ?? `session-${this.requestId()}`,
        tabId: 0,
        frameId: 0,
        navigationId: hello.clientId,
        pageUrl: 'about:blank',
        pageOrigin: 'null',
        startedAt: connectedAt,
      }, connectedAt);
      this.reconcileConnections();
      this.bindSession(socket, session.sessionId);
      this.sendReady(socket, session);
      return;
    }

    const message = parseClientMessage(parsed);
    if (message === undefined || message.type === 'client-hello') {
      this.fail(socket, 'invalid-message', 'Expected a bridge client message.', true);
      return;
    }
    if (message.type === 'capture-batch') {
      this.handleCapture(socket, state, message);
      return;
    }
    this.handleAiLogResponse(socket, state, message);
  }

  private handleCapture(socket: WebSocket, state: ConnectionState, batch: BridgeCaptureBatch): void {
    if (state.sessionId !== undefined && state.sessionId !== batch.session.sessionId) {
      this.fail(socket, 'invalid-message', 'A connection may capture only one session.', true);
      return;
    }
    const session = this.options.store.upsertSession(batch.session, this.now());
    this.reconcileConnections();
    if (!this.options.store.hasSession(session.sessionId)) {
      this.fail(socket, 'internal-error', 'Session capacity is unavailable.', true);
      return;
    }
    if (state.sessionId === undefined) {
      this.bindSession(socket, session.sessionId);
      this.sendReady(socket, session);
    }
    if (batch.stateSnapshot !== undefined) {
      this.options.store.setLatestState(session.sessionId, batch.stateSnapshot);
    }
    const ackedEntryIds = this.options.store.appendEntries(session.sessionId, batch.entries);
    this.send(socket, {
      bridge: 'koshko-bridge',
      version: 1,
      type: 'server-ack',
      sessionId: session.sessionId,
      ackedEntryIds,
    });
  }

  private handleAiLogResponse(socket: WebSocket, state: ConnectionState, response: BridgeAiLogResponse): void {
    if (state.sessionId !== response.sessionId) {
      this.fail(socket, 'request-not-found', 'AI log response session does not match this connection.', false, response.requestId);
      return;
    }
    const pending = this.pendingAiLogs.get(response.requestId);
    if (pending === undefined || pending.sessionId !== response.sessionId) {
      this.fail(socket, 'request-not-found', 'AI log request is not pending.', false, response.requestId);
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAiLogs.delete(response.requestId);
    this.options.store.setAiLog(response.sessionId, pending.budget, response.result);
    pending.resolve(response.result);
  }

  private bindSession(socket: WebSocket, sessionId: string): void {
    const prior = this.connections.get(sessionId);
    if (prior !== undefined && prior !== socket) {
      prior.close();
    }
    const state = this.socketState.get(socket);
    if (state !== undefined) {
      state.sessionId = sessionId;
    }
    this.connections.set(sessionId, socket);
  }

  private handleClose(socket: WebSocket): void {
    this.sockets.delete(socket);
    const state = this.socketState.get(socket);
    if (state?.sessionId !== undefined && this.connections.get(state.sessionId) === socket) {
      this.connections.delete(state.sessionId);
      this.options.store.disconnectSession(state.sessionId, this.now());
      this.rejectPendingForSession(state.sessionId, 'Extension disconnected while producing the AI log.');
    }
  }

  private reconcileConnections(): void {
    for (const [sessionId, socket] of this.connections) {
      if (!this.options.store.hasSession(sessionId)) {
        this.connections.delete(sessionId);
        socket.close();
        this.rejectPendingForSession(sessionId, 'Session was evicted while producing the AI log.');
      }
    }
  }

  private rejectPendingForSession(sessionId: string, message: string): void {
    for (const [requestId, pending] of this.pendingAiLogs) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        this.pendingAiLogs.delete(requestId);
        pending.reject(new Error(message));
      }
    }
  }

  private sendReady(socket: WebSocket, session: SessionView): void {
    const ready: BridgeServerReady = {
      bridge: 'koshko-bridge',
      version: 1,
      type: 'server-ready',
      session: {
        sessionId: session.sessionId,
        tabId: session.tabId,
        frameId: session.frameId,
        navigationId: session.navigationId,
        pageUrl: session.pageUrl,
        pageOrigin: session.pageOrigin,
        ...(session.pageTitle === undefined ? {} : { pageTitle: session.pageTitle }),
        startedAt: session.startedAt,
        connectedAt: session.connectedAt,
      },
    };
    this.send(socket, ready);
  }

  private fail(socket: WebSocket, code: BridgeServerError['code'], message: string, close: boolean, requestId?: string): void {
    this.send(socket, {
      bridge: 'koshko-bridge',
      version: 1,
      type: 'server-error',
      code,
      message,
      ...(requestId === undefined ? {} : { requestId }),
    });
    if (close) {
      socket.close();
    }
  }

  private send(socket: WebSocket, message: object): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}

function parseJson(data: RawData): unknown | undefined {
  try {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (Array.isArray(data)) {
      text = Buffer.concat(data).toString('utf8');
    } else if (data instanceof ArrayBuffer) {
      text = Buffer.from(new Uint8Array(data)).toString('utf8');
    } else {
      text = Buffer.from(data).toString('utf8');
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_BRIDGE_MESSAGE_BYTES) {
      return undefined;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseClientMessage(value: unknown): BridgeClientMessage | undefined {
  return parseBridgeCaptureBatch(value) ?? parseBridgeAiLogResponse(value);
}

function tokensEqual(candidate: string, expected: string): boolean {
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}
