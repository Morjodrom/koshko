import {
  parseCapturedErrorV1,
  parseCapturedSignalV1,
  parseCapturedStateMutationV1,
  type CaptureContextV1,
} from '@koshko/protocol';
import type { PanelCaptureMessage } from './messages';
import type {
  ManagedPanelConnection,
  PanelConnectionStatus,
} from './panel-connection';

export const EMBEDDED_BRIDGE_PROTOCOL = 'koshko:embedded-inspector';
export const EMBEDDED_BRIDGE_VERSION = 1;
export const EMBEDDED_RESET_TIMEOUT_MS = 5_000;

export type EmbeddedBridgeMessage =
  | EmbeddedInspectorReadyMessage
  | EmbeddedHostReadyMessage
  | EmbeddedCaptureMessage
  | EmbeddedAcknowledgementMessage
  | EmbeddedResetMessage
  | EmbeddedResetAcknowledgementMessage;

export interface EmbeddedBridgeBaseMessage {
  protocol: typeof EMBEDDED_BRIDGE_PROTOCOL;
  version: typeof EMBEDDED_BRIDGE_VERSION;
  sessionId: string;
}

export interface EmbeddedInspectorReadyMessage extends EmbeddedBridgeBaseMessage {
  type: 'inspector-ready';
}

export interface EmbeddedHostReadyMessage extends EmbeddedBridgeBaseMessage {
  type: 'host-ready';
  generation: number;
}

export interface EmbeddedCaptureMessage extends EmbeddedBridgeBaseMessage {
  type: 'capture';
  generation: number;
  contextId: string;
  sequence: number;
  kind: PanelCaptureMessage['kind'];
  captured: unknown;
}

export interface EmbeddedAcknowledgementMessage extends EmbeddedBridgeBaseMessage {
  type: 'ack';
  generation: number;
  contextId: string;
  sequence: number;
}

export interface EmbeddedResetMessage extends EmbeddedBridgeBaseMessage {
  type: 'reset';
  generation: number;
}

export interface EmbeddedResetAcknowledgementMessage extends EmbeddedBridgeBaseMessage {
  type: 'reset-ack';
  generation: number;
}

export interface EmbeddedBridgeEventTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export interface EmbeddedBridgeParentWindow {
  postMessage(message: EmbeddedBridgeMessage, targetOrigin: string): void;
}

export interface EmbeddedPanelConnectionOptions {
  parentWindow: EmbeddedBridgeParentWindow;
  parentOrigin: string;
  eventTarget?: EmbeddedBridgeEventTarget;
  createSessionId?: () => string;
  resetTimeoutMs?: number;
}

type MessageListener = (message: PanelCaptureMessage) => void;
type StatusListener = (status: PanelConnectionStatus) => void;

/**
 * The inspector-side half of the demo-only postMessage bridge. It accepts
 * messages solely from its configured parent origin and WindowProxy.
 */
export class EmbeddedPanelConnection implements ManagedPanelConnection {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly lastSequenceByContext = new Map<string, number>();
  private readonly eventTarget: EmbeddedBridgeEventTarget;
  private readonly sessionId: string;
  private readonly resetTimeoutMs: number;
  private generation = 0;
  private resetPending: {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | undefined;
  private disposed = false;

  status: PanelConnectionStatus = 'connecting';

  constructor(private readonly options: EmbeddedPanelConnectionOptions) {
    this.eventTarget = options.eventTarget ?? window;
    this.sessionId = (options.createSessionId ?? createSessionId)();
    this.resetTimeoutMs = options.resetTimeoutMs ?? EMBEDDED_RESET_TIMEOUT_MS;
    this.eventTarget.addEventListener('message', this.onMessage);
    this.post({
      protocol: EMBEDDED_BRIDGE_PROTOCOL,
      version: EMBEDDED_BRIDGE_VERSION,
      type: 'inspector-ready',
      sessionId: this.sessionId,
    });
  }

  subscribe(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  clear(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Embedded panel connection is disposed.'));
    if (this.status !== 'connected') {
      return Promise.reject(new Error('Embedded panel connection is not ready.'));
    }
    if (this.resetPending) return Promise.reject(new Error('Embedded panel reset is already pending.'));

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.resetPending) return;
        this.resetPending = undefined;
        reject(new Error('Embedded host did not acknowledge the reset.'));
      }, this.resetTimeoutMs);
      this.resetPending = { resolve, reject, timeout };
      this.post({
        protocol: EMBEDDED_BRIDGE_PROTOCOL,
        version: EMBEDDED_BRIDGE_VERSION,
        type: 'reset',
        sessionId: this.sessionId,
        generation: this.generation,
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventTarget.removeEventListener('message', this.onMessage);
    if (this.resetPending) {
      clearTimeout(this.resetPending.timeout);
      this.resetPending.reject(new Error('Embedded panel connection was disposed.'));
      this.resetPending = undefined;
    }
    this.messageListeners.clear();
    this.statusListeners.clear();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (this.disposed || event.origin !== this.options.parentOrigin || event.source !== this.options.parentWindow) {
      return;
    }
    const message = parseBridgeMessage(event.data);
    if (!message || message.sessionId !== this.sessionId) return;

    if (message.type === 'host-ready') {
      this.acceptReady(message);
      return;
    }
    if (message.type === 'capture') {
      this.acceptCapture(message);
      return;
    }
    if (message.type === 'reset-ack') {
      this.acceptReset(message);
    }
  };

  private acceptReady(message: EmbeddedHostReadyMessage): void {
    if (!isGeneration(message.generation) || message.generation < this.generation) return;
    this.generation = message.generation;
    this.lastSequenceByContext.clear();
    this.setStatus('connected');
  }

  private acceptCapture(message: EmbeddedCaptureMessage): void {
    if (this.status !== 'connected' || message.generation !== this.generation) return;
    if (!isSequence(message.sequence) || !isContextId(message.contextId)) return;
    const previous = this.lastSequenceByContext.get(message.contextId) ?? 0;
    if (message.sequence <= previous) return;

    const panelMessage = normalizeCapture(message);
    if (!panelMessage || panelMessage.captured.captureContext.id !== message.contextId) return;

    this.lastSequenceByContext.set(message.contextId, message.sequence);
    this.messageListeners.forEach((listener) => listener(panelMessage));
    this.post({
      protocol: EMBEDDED_BRIDGE_PROTOCOL,
      version: EMBEDDED_BRIDGE_VERSION,
      type: 'ack',
      sessionId: this.sessionId,
      generation: this.generation,
      contextId: message.contextId,
      sequence: message.sequence,
    });
  }

  private acceptReset(message: EmbeddedResetAcknowledgementMessage): void {
    if (!this.resetPending || !isGeneration(message.generation) || message.generation <= this.generation) {
      return;
    }
    clearTimeout(this.resetPending.timeout);
    const pending = this.resetPending;
    this.resetPending = undefined;
    this.generation = message.generation;
    this.lastSequenceByContext.clear();
    pending.resolve();
  }

  private post(message: EmbeddedBridgeMessage): void {
    try {
      this.options.parentWindow.postMessage(message, this.options.parentOrigin);
    } catch {
      // A parent reload is resolved by constructing a fresh connection.
    }
  }

  private setStatus(status: PanelConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

function normalizeCapture(message: EmbeddedCaptureMessage): PanelCaptureMessage | undefined {
  if (message.kind === 'signal') {
    return { type: 'koshko:capture', kind: 'signal', captured: parseCapturedSignalV1(message.captured) };
  }
  if (message.kind === 'state-mutation') {
    return {
      type: 'koshko:capture',
      kind: 'state-mutation',
      captured: parseCapturedStateMutationV1(message.captured),
    };
  }
  if (message.kind === 'error') {
    return { type: 'koshko:capture', kind: 'error', captured: parseCapturedErrorV1(message.captured) };
  }
  return undefined;
}

function parseBridgeMessage(value: unknown): EmbeddedBridgeMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = value as Partial<EmbeddedBridgeMessage>;
  if (
    message.protocol !== EMBEDDED_BRIDGE_PROTOCOL
    || message.version !== EMBEDDED_BRIDGE_VERSION
    || !isSessionId(message.sessionId)
  ) return undefined;
  if (message.type === 'host-ready' && isGeneration(message.generation)) return message as EmbeddedHostReadyMessage;
  if (
    message.type === 'capture'
    && isGeneration(message.generation)
    && isContextId(message.contextId)
    && isSequence(message.sequence)
    && (message.kind === 'signal' || message.kind === 'state-mutation' || message.kind === 'error')
  ) return message as EmbeddedCaptureMessage;
  if (message.type === 'reset-ack' && isGeneration(message.generation)) {
    return message as EmbeddedResetAcknowledgementMessage;
  }
  return undefined;
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isContextId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type { CaptureContextV1 };
