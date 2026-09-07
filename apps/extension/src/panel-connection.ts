import {
  PANEL_MESSAGE_HEARTBEAT,
  PANEL_MESSAGE_READY,
} from './shared';

export const PANEL_HEARTBEAT_INTERVAL_MS = 20_000;
export const PANEL_READY_TIMEOUT_MS = 5_000;
export const PANEL_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;

export type PanelConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface PanelConnectionMessage {
  type: string;
  kind?: string;
  captured?: unknown;
}

export interface PanelConnectionPort {
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener?(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener?(listener: () => void): void;
  };
  postMessage(message: unknown): void | Promise<void>;
  disconnect?(): void;
}

type MessageListener = (message: PanelConnectionMessage) => void;
type StatusListener = (status: PanelConnectionStatus) => void;

export interface ManagedPanelConnection {
  readonly status: PanelConnectionStatus;
  subscribe(listener: MessageListener): () => void;
  subscribeStatus(listener: StatusListener): () => void;
  send(message: unknown): boolean;
}

/** Keeps a panel attached across MV3 service-worker restarts. */
export class PanelConnection implements ManagedPanelConnection {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly portListeners = new WeakMap<PanelConnectionPort, {
    onMessage: (message: unknown) => void;
    onDisconnect: () => void;
  }>();
  private currentPort: PanelConnectionPort | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryIndex = 0;
  private disposed = false;

  status: PanelConnectionStatus = 'connecting';

  constructor(private readonly connect: () => PanelConnectionPort) {
    this.open();
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

  send(message: unknown): boolean {
    const port = this.currentPort;
    if (this.disposed || this.status !== 'connected' || !port) {
      return false;
    }

    try {
      const result = port.postMessage(message);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch(() => this.fail(port));
      }
      return true;
    } catch {
      this.fail(port);
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    const port = this.currentPort;
    if (port) {
      this.detach(port);
      this.currentPort = undefined;
      try {
        port.disconnect?.();
      } catch {
        // A disconnected Chrome port needs no further cleanup.
      }
    }
    this.messageListeners.clear();
    this.statusListeners.clear();
  }

  private open(): void {
    if (this.disposed) return;
    let port: PanelConnectionPort;
    try {
      port = this.connect();
    } catch {
      this.scheduleRetry();
      return;
    }

    this.currentPort = port;
    const onMessage = (message: unknown): void => {
      if (this.currentPort !== port || this.disposed) return;
      if (!isPanelConnectionMessage(message)) return;
      if (message.type === PANEL_MESSAGE_READY) {
        this.ready();
        return;
      }
      if (this.status !== 'connected') return;
      this.messageListeners.forEach((listener) => listener(message));
    };
    const onDisconnect = (): void => this.fail(port);
    this.portListeners.set(port, { onMessage, onDisconnect });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    this.readyTimer = setTimeout(() => this.fail(port), PANEL_READY_TIMEOUT_MS);
  }

  private ready(): void {
    if (this.disposed || !this.currentPort || this.status === 'connected') return;
    this.clearReadyTimer();
    this.retryIndex = 0;
    this.setStatus('connected');
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: PANEL_MESSAGE_HEARTBEAT });
    }, PANEL_HEARTBEAT_INTERVAL_MS);
  }

  private fail(port: PanelConnectionPort): void {
    if (this.disposed || this.currentPort !== port) return;
    this.detach(port);
    this.currentPort = undefined;
    this.clearConnectionTimers();
    try {
      port.disconnect?.();
    } catch {
      // The port is already unusable; retry below.
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return;
    this.setStatus('reconnecting');
    const delay = PANEL_RETRY_DELAYS_MS[Math.min(this.retryIndex, PANEL_RETRY_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.open();
    }, delay);
  }

  private detach(port: PanelConnectionPort): void {
    const listeners = this.portListeners.get(port);
    if (!listeners) return;
    port.onMessage.removeListener?.(listeners.onMessage);
    port.onDisconnect.removeListener?.(listeners.onDisconnect);
    this.portListeners.delete(port);
  }

  private setStatus(status: PanelConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
  }

  private clearConnectionTimers(): void {
    this.clearReadyTimer();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearTimers(): void {
    this.clearConnectionTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
}

function isPanelConnectionMessage(message: unknown): message is PanelConnectionMessage {
  return Boolean(
    message
    && typeof message === 'object'
    && typeof (message as { type?: unknown }).type === 'string',
  );
}
