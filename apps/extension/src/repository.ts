import {
  applyStateMutationPatch,
  compareCapturedSignals,
  type ActorReference,
  type CapturedSignalV1,
  type CapturedStateMutationV1,
  type JsonObject,
} from '@koshko/protocol';

export interface KoshkoTimelineActor {
  key: string;
  reference: ActorReference;
}

export class KoshkoRepository {
  private readonly capturedSignals: CapturedSignalV1[] = [];

  private paused = false;

  private readonly listeners = new Set<() => void>();

  private displayVersion = 0;

  private displaySignals: CapturedSignalV1[] = [];

  private state: JsonObject = {};

  private displayState: JsonObject = {};

  private unreadCount = 0;

  private topFrameIdentity: string | undefined;

  get isPaused(): boolean {
    return this.paused;
  }

  getDisplaySignals(): CapturedSignalV1[] {
    return [...this.displaySignals];
  }

  getState(): JsonObject {
    return this.state;
  }

  getCurrentState(): JsonObject {
    return this.state;
  }

  getDisplayState(): JsonObject {
    return this.displayState;
  }

  getUnreadCount(): number {
    return this.unreadCount;
  }

  getDisplayVersion(): number {
    return this.displayVersion;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.unreadCount = 0;
      this.syncDisplaySnapshot();
    }
    this.notify();
  }

  clear(): void {
    this.capturedSignals.length = 0;
    this.displaySignals = [];
    this.state = {};
    this.displayState = {};
    this.unreadCount = 0;
    this.topFrameIdentity = undefined;
    this.bumpDisplayVersion();
    this.notify();
  }

  record(captured: CapturedSignalV1 | CapturedStateMutationV1): boolean {
    const identity = this.getDocumentIdentity(captured);
    if (captured.frameId === 0 && identity !== undefined) {
      if (this.topFrameIdentity !== undefined && this.topFrameIdentity !== identity) {
        this.clear();
      }
      this.topFrameIdentity = identity;
    }

    if (isCapturedSignal(captured)) {
      this.capturedSignals.push(captured);
    } else {
      this.state = applyStateMutationPatch(this.state, captured.mutation.patch);
    }
    if (this.paused) {
      this.unreadCount += 1;
      return true;
    }
    this.syncDisplaySnapshot();
    this.notify();
    return true;
  }

  getSignals(): CapturedSignalV1[] {
    return [...this.capturedSignals].sort(compareCapturedSignals);
  }

  getCount(): number {
    return this.capturedSignals.length;
  }

  getActorColumns(): KoshkoTimelineActor[] {
    const columns: KoshkoTimelineActor[] = [];
    const seen = new Set<string>();

    for (const signal of this.getSignals()) {
      for (const reference of [signal.signal.source, signal.signal.target].filter(Boolean) as ActorReference[]) {
        const key = actorKey(reference);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        columns.push({ key, reference });
      }
    }

    return columns;
  }

  exportJsonl(): string {
    const signals = this.getSignals();
    const header = {
      protocol: 'koshko',
      version: 1,
      type: 'export-metadata',
      count: signals.length,
      exportedAt: new Date().toISOString(),
    };

    return [header, ...signals]
      .map((signal) => JSON.stringify(signal))
      .join('\n');
  }

  private getDocumentIdentity(
    captured: CapturedSignalV1 | CapturedStateMutationV1,
  ): string | undefined {
    return captured.documentId ?? captured.navigationId;
  }

  private syncDisplaySnapshot(): void {
    this.displaySignals = this.getSignals();
    this.displayState = this.state;
    this.bumpDisplayVersion();
  }

  private bumpDisplayVersion(): void {
    this.displayVersion += 1;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function isCapturedSignal(
  captured: CapturedSignalV1 | CapturedStateMutationV1,
): captured is CapturedSignalV1 {
  return 'signal' in captured;
}

export function actorKey(reference: ActorReference): string {
  return `${reference.id}::${reference.instanceId ?? ''}`;
}

export function formatActor(reference: ActorReference): string {
  const instanceLabel = reference.instanceLabel ?? reference.instanceId;
  const base = instanceLabel ? `${reference.label ?? reference.id} · ${instanceLabel}` : reference.label ?? reference.id;
  return base || reference.id;
}

export function formatTime(occurredAt: number): string {
  const date = new Date(occurredAt);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export function formatDateTime(occurredAt: number): string {
  return formatTimestamp(occurredAt);
}

export function formatTimestamp(occurredAt: number): string {
  const date = new Date(occurredAt);
  return `${date.toISOString().slice(0, 19)}.${String(date.getMilliseconds()).padStart(3, '0')}Z`;
}
