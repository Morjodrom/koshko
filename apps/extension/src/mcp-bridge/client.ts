import {
  MAX_BRIDGE_ENTRY_BYTES,
  MAX_BRIDGE_MESSAGE_BYTES,
  MAX_CAPTURE_BATCH_ENTRIES,
  MAX_GENERIC_POST_MESSAGE_BYTES,
  MAX_STATE_SNAPSHOT_BYTES,
  parseBridgeServerMessage,
  type BridgeAiLogRequest,
  type BridgeCaptureBatch,
  type BridgeSessionMetadata,
  type BridgeStateSnapshot,
  type BridgeTraceEntry,
} from '@koshko/bridge';
import { formatAiLog } from '../ai-log';
import {
  isCapturedError,
  isCapturedPostMessage,
  isCapturedSignal,
  type KoshkoLogEntry,
  type KoshkoRepository,
} from '../state/repository';
import { validateBridgeSettings, type BridgeSettings } from './settings';

const BATCH_DELAY_MS = 100;
const MAX_PENDING_ENTRIES = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;
const INITIAL_RETRY_DELAY_MS = 250;

export interface BridgeWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface BridgeClientDependencies {
  createWebSocket?: (url: string) => BridgeWebSocket;
  setTimeout?: (handler: () => void, delay: number) => number;
  clearTimeout?: (timer: number) => void;
  now?: () => number;
  createId?: () => string;
}

interface PendingEntry {
  id: string;
  entry: BridgeTraceEntry;
}

/** Browser-standard, panel-owned transport. It keeps only bounded normalized data in memory. */
export class McpBridgeClient {
  private readonly createWebSocket: (url: string) => BridgeWebSocket;
  private readonly setTimer: (handler: () => void, delay: number) => number;
  private readonly clearTimer: (timer: number) => void;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly clientId: string;
  private readonly pending: PendingEntry[] = [];
  private readonly seenEntries = new WeakSet<object>();
  private readonly inFlight = new Set<string>();
  private settings: BridgeSettings;
  private socket: BridgeWebSocket | undefined;
  private session: BridgeSessionMetadata | undefined;
  private sessionHasCaptureMetadata = false;
  private reconnectTimer: number | undefined;
  private batchTimer: number | undefined;
  private retryDelay = INITIAL_RETRY_DELAY_MS;
  private disposed = false;
  private retryBlocked = false;
  private authenticated = false;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly repository: KoshkoRepository,
    private readonly tabId: number,
    settings: BridgeSettings,
    dependencies: BridgeClientDependencies = {},
  ) {
    this.settings = settings;
    this.createWebSocket = dependencies.createWebSocket ?? ((url) => new WebSocket(url));
    this.setTimer = dependencies.setTimeout ?? window.setTimeout.bind(window);
    this.clearTimer = dependencies.clearTimeout ?? window.clearTimeout.bind(window);
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? createId;
    this.clientId = this.createId();
    this.unsubscribe = repository.subscribe(() => this.captureRepository());
    this.captureRepository();
    this.reconcile();
  }

  setSettings(settings: BridgeSettings): void {
    const connectionChanged = settings.enabled !== this.settings.enabled
      || settings.url !== this.settings.url
      || settings.token !== this.settings.token;
    this.settings = settings;
    this.retryBlocked = false;
    if (connectionChanged) this.closeSocket();
    this.captureRepository();
    this.reconcile();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearScheduled();
    this.closeSocket();
  }

  getPendingCount(): number { return this.pending.length; }

  private reconcile(): void {
    this.clearReconnect();
    if (this.disposed || !this.settings.enabled || validateBridgeSettings(this.settings) !== undefined) {
      this.pending.length = 0;
      this.inFlight.clear();
      this.closeSocket();
      return;
    }
    if (!this.socket) this.connect();
  }

  private connect(): void {
    if (this.disposed || this.socket || !this.settings.enabled || validateBridgeSettings(this.settings) !== undefined) return;
    let socket: BridgeWebSocket;
    try {
      socket = this.createWebSocket(this.settings.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.authenticated = false;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.retryDelay = INITIAL_RETRY_DELAY_MS;
      this.send({
        bridge: 'koshko-bridge', version: 1, type: 'client-hello',
        clientId: this.clientId, authToken: this.settings.token,
        ...(this.session ? { resumeSessionId: this.session.sessionId } : {}),
      });
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => { /* close schedules retry; error data is never logged. */ };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.authenticated = false;
      this.inFlight.clear();
      this.scheduleReconnect();
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(data); } catch { return; }
    const message = parseBridgeServerMessage(parsedJson);
    if (!message) return;
    if (message.type === 'server-ready') {
      const localSession = this.session;
      this.session = localSession
        ? { ...localSession, sessionId: message.session.sessionId }
        : message.session;
      this.authenticated = true;
      for (let index = 0; index < this.pending.length; index += 1) {
        const pending = this.pending[index];
        if (pending.entry.sessionId !== message.session.sessionId) {
          this.pending[index] = { ...pending, entry: { ...pending.entry, sessionId: message.session.sessionId } };
        }
      }
      this.flush();
    } else if (message.type === 'server-ack') {
      if (!this.session || message.sessionId !== this.session.sessionId) return;
      const acked = new Set(message.ackedEntryIds);
      for (let index = this.pending.length - 1; index >= 0; index -= 1) {
        if (acked.has(this.pending[index].id)) {
          this.inFlight.delete(this.pending[index].id);
          this.pending.splice(index, 1);
        }
      }
      this.flush();
    } else if (message.type === 'server-error') {
      if (message.code === 'authentication-failed') this.retryBlocked = true;
      this.socket?.close();
    } else if (message.type === 'ai-log-request') {
      this.respondToAiLog(message);
    }
  }

  private respondToAiLog(request: BridgeAiLogRequest): void {
    if (!this.session || request.sessionId !== this.session.sessionId) return;
    const result = formatAiLog({
      entries: this.repository.getLog(),
      state: this.repository.getState(),
      budget: request.budget,
    });
    let response = {
      bridge: 'koshko-bridge', version: 1, type: 'ai-log-response',
      requestId: request.requestId, sessionId: request.sessionId, result,
    } as const;
    if (jsonBytes(response) > MAX_BRIDGE_MESSAGE_BYTES && request.budget === 'full') {
      response = {
        ...response,
        result: formatAiLog({
          entries: this.repository.getLog(),
          state: this.repository.getState(),
          budget: '64k',
        }),
      };
    }
    if (jsonBytes(response) <= MAX_BRIDGE_MESSAGE_BYTES) this.send(response);
  }

  private captureRepository(): void {
    if (!this.settings.enabled || validateBridgeSettings(this.settings) !== undefined) return;
    for (const capture of this.repository.getLog()) {
      const session = this.sessionFor(capture);
      if (!session) continue;
      if (this.seenEntries.has(capture)) continue;
      const id = this.createId();
      const entry = mapEntry(capture, id, session.sessionId, this.now());
      if (jsonBytes(entry) > MAX_BRIDGE_ENTRY_BYTES) continue;
      if (entry.kind === 'post-message' && jsonBytes(entry.data) > MAX_GENERIC_POST_MESSAGE_BYTES) continue;
      this.seenEntries.add(capture);
      this.session = session;
      this.pending.push({ id, entry });
      if (this.pending.length > MAX_PENDING_ENTRIES) {
        const removed = this.pending.shift();
        if (removed) this.inFlight.delete(removed.id);
      }
    }
    if (this.pending.length) this.scheduleFlush();
  }

  private sessionFor(entry: KoshkoLogEntry): BridgeSessionMetadata | undefined {
    const navigationId = entry.navigationId;
    const pageUrl = 'frameUrl' in entry ? entry.frameUrl : undefined;
    const pageOrigin = 'frameOrigin' in entry ? entry.frameOrigin : undefined;
    if (!navigationId || !pageUrl || !pageOrigin) return this.session;
    const captureMetadata = {
      tabId: this.tabId, frameId: entry.frameId,
      navigationId, pageUrl, pageOrigin, pageTitle: undefined, startedAt: this.now(),
    };
    // One bridge session represents the inspected browser tab while this panel
    // is open. Individual captures retain their own navigation metadata.
    if (this.session) {
      if (!this.sessionHasCaptureMetadata) {
        this.session = { ...captureMetadata, sessionId: this.session.sessionId };
        this.sessionHasCaptureMetadata = true;
      }
      return this.session;
    }
    this.sessionHasCaptureMetadata = true;
    return { ...captureMetadata, sessionId: this.createId() };
  }

  private scheduleFlush(): void {
    if (this.batchTimer || this.disposed) return;
    this.batchTimer = this.setTimer(() => { this.batchTimer = undefined; this.flush(); }, BATCH_DELAY_MS);
  }

  private flush(): void {
    if (!this.authenticated || !this.socket || this.socket.readyState !== 1 || !this.session || !this.pending.length) return;
    let candidates = this.pending
      .filter((item) => !this.inFlight.has(item.id))
      .slice(0, MAX_CAPTURE_BATCH_ENTRIES);
    if (!candidates.length) return;
    let stateSnapshot: BridgeStateSnapshot | undefined = {
      snapshotId: this.createId(), sessionId: this.session.sessionId,
      capturedAt: this.now(), state: this.repository.getState(),
    };
    if (jsonBytes(stateSnapshot) > MAX_STATE_SNAPSHOT_BYTES) stateSnapshot = undefined;
    let batch: BridgeCaptureBatch = {
      bridge: 'koshko-bridge', version: 1, type: 'capture-batch', session: this.session,
      entries: candidates.map((item) => item.entry),
      ...(stateSnapshot ? { stateSnapshot } : {}),
    };
    if (jsonBytes(batch) > MAX_BRIDGE_MESSAGE_BYTES && stateSnapshot) {
      batch = { ...batch, stateSnapshot: undefined };
    }
    while (jsonBytes(batch) > MAX_BRIDGE_MESSAGE_BYTES && candidates.length > 1) {
      candidates = candidates.slice(0, Math.ceil(candidates.length / 2));
      batch = { ...batch, entries: candidates.map((item) => item.entry) };
    }
    if (jsonBytes(batch) > MAX_BRIDGE_MESSAGE_BYTES) return;
    candidates.forEach((item) => this.inFlight.add(item.id));
    this.send(batch);
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      this.inFlight.clear();
      this.closeSocket();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.retryBlocked || !this.settings.enabled || validateBridgeSettings(this.settings) !== undefined || this.reconnectTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(MAX_RETRY_DELAY_MS, this.retryDelay * 2);
    this.reconnectTimer = this.setTimer(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearScheduled(): void {
    this.clearReconnect();
    if (this.batchTimer) this.clearTimer(this.batchTimer);
    this.batchTimer = undefined;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.authenticated = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        // The browser already discarded this socket.
      }
    }
  }
}

function mapEntry(capture: KoshkoLogEntry, entryId: string, sessionId: string, capturedAt: number): BridgeTraceEntry {
  if (isCapturedSignal(capture)) return { kind: 'signal', entryId, sessionId, capturedAt, capture };
  if (isCapturedError(capture)) return { kind: 'error', entryId, sessionId, capturedAt, capture };
  if (isCapturedPostMessage(capture)) return {
    kind: 'post-message', entryId, sessionId, capturedAt, messageType: capture.source, data: capture.data,
  };
  return { kind: 'state-mutation', entryId, sessionId, capturedAt, capture };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function createId(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `koshko-${id.replace(/[^A-Za-z0-9._:-]/g, '')}`;
}
