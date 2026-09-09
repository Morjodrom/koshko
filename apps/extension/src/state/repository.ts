import {
  applyStateMutationPatch,
  compareCapturedSignals,
  type ActorReference,
  type CapturedSignalV1,
  type CapturedStateMutationV1,
  type JsonObject,
  type JsonValue,
} from '@koshko/protocol';

export interface KoshkoTimelineActor {
  key: string;
  reference: ActorReference;
}

export type KoshkoLogEntry = CapturedSignalV1 | CapturedStateMutationV1;

export interface KoshkoStateSnapshot {
  index: number;
  label?: string;
  mutation?: CapturedStateMutationV1;
  state: JsonObject;
}

export class KoshkoRepository {
  private readonly capturedSignals: CapturedSignalV1[] = [];

  private readonly capturedLog: KoshkoLogEntry[] = [];

  private paused = false;

  private readonly listeners = new Set<() => void>();

  private displaySignals: CapturedSignalV1[] = [];

  private displayLog: KoshkoLogEntry[] = [];

  private stateHistory: KoshkoStateSnapshot[] = [createInitialStateSnapshot()];

  private state: JsonObject = this.stateHistory[0].state;

  private displayState: JsonObject = this.state;

  private displayStateHistory: KoshkoStateSnapshot[] = this.stateHistory;

  private selectedStateSnapshotIndex: number | null = null;

  private unreadCount = 0;

  private topFrameIdentity: string | undefined;

  get isPaused(): boolean {
    return this.paused;
  }

  getDisplaySignals(): CapturedSignalV1[] {
    return [...this.displaySignals];
  }

  getDisplayLog(): KoshkoLogEntry[] {
    return [...this.displayLog];
  }

  getDisplayState(): JsonObject {
    return this.displayState;
  }

  getDisplayStateHistory(): KoshkoStateSnapshot[] {
    return [...this.displayStateHistory];
  }

  getSelectedStateSnapshotIndex(): number | null {
    return this.selectedStateSnapshotIndex;
  }

  selectStateSnapshot(index: number | null): boolean {
    if (index !== null && !this.displayStateHistory.some((snapshot) => snapshot.index === index)) {
      return false;
    }

    if (this.selectedStateSnapshotIndex === index) {
      return true;
    }

    this.selectedStateSnapshotIndex = index;
    this.displayState = this.getSelectedDisplayState();
    this.notify();
    return true;
  }

  getUnreadCount(): number {
    return this.unreadCount;
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
    this.reset();
    this.notify();
  }

  record(captured: CapturedSignalV1 | CapturedStateMutationV1): void {
    const identity = this.getDocumentIdentity(captured);
    if (captured.frameId === 0 && identity !== undefined) {
      if (this.topFrameIdentity !== undefined && this.topFrameIdentity !== identity) {
        this.reset();
      }
      this.topFrameIdentity = identity;
    }

    this.capturedLog.push(captured);
    if (isCapturedSignal(captured)) {
      this.capturedSignals.push(captured);
    } else {
      const nextState = applyStateMutationPatch(this.state, captured.mutation.patch);
      if (nextState !== this.state) {
        this.state = freezeState(nextState);
        this.stateHistory = [
          ...this.stateHistory,
          freezeSnapshot({
            index: this.stateHistory.length,
            label: captured.mutation.label,
            mutation: cloneCapturedStateMutation(captured),
            state: this.state,
          }),
        ];
      }
    }
    if (this.paused) {
      this.unreadCount += 1;
    } else {
      this.syncDisplaySnapshot();
    }
    this.notify();
  }

  private reset(): void {
    this.capturedSignals.length = 0;
    this.capturedLog.length = 0;
    this.displaySignals = [];
    this.displayLog = [];
    const initialStateSnapshot = createInitialStateSnapshot();
    this.state = initialStateSnapshot.state;
    this.displayState = initialStateSnapshot.state;
    this.stateHistory = [initialStateSnapshot];
    this.displayStateHistory = this.stateHistory;
    this.selectedStateSnapshotIndex = null;
    this.unreadCount = 0;
    this.topFrameIdentity = undefined;
  }

  getSignals(): CapturedSignalV1[] {
    return [...this.capturedSignals].sort(compareCapturedSignals);
  }

  getLog(): KoshkoLogEntry[] {
    return [...this.capturedLog].sort(compareCapturedLogEntries);
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
    this.displayLog = this.getLog();
    this.displayStateHistory = this.stateHistory;
    this.displayState = this.getSelectedDisplayState();
  }

  private getSelectedDisplayState(): JsonObject {
    if (this.selectedStateSnapshotIndex === null) {
      return this.state;
    }

    return this.displayStateHistory.find((snapshot) => snapshot.index === this.selectedStateSnapshotIndex)?.state
      ?? this.state;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createInitialStateSnapshot(): KoshkoStateSnapshot {
  return freezeSnapshot({ index: 0, state: freezeState({}) });
}

function freezeSnapshot(snapshot: KoshkoStateSnapshot): KoshkoStateSnapshot {
  return Object.freeze(snapshot);
}

function freezeState(state: JsonObject): JsonObject {
  freezeJsonValue(state, new WeakSet<object>());
  return state;
}

function cloneCapturedStateMutation(captured: CapturedStateMutationV1): CapturedStateMutationV1 {
  const snapshot: CapturedStateMutationV1 = {
    ...captured,
    mutation: {
      ...captured.mutation,
      patch: captured.mutation.patch.map((operation) => (
        operation.op === 'remove'
          ? { ...operation }
          : { ...operation, value: cloneJsonValue(operation.value) }
      )),
    },
  };

  freezeUnknown(snapshot, new WeakSet<object>());
  return snapshot;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]));
  }
  return value;
}

function freezeJsonValue(value: JsonObject | JsonObject[keyof JsonObject], seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const child of Object.values(value)) {
    freezeJsonValue(child, seen);
  }
  Object.freeze(value);
}

function freezeUnknown(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const child of Object.values(value)) {
    freezeUnknown(child, seen);
  }
  Object.freeze(value);
}

function compareCapturedLogEntries(left: KoshkoLogEntry, right: KoshkoLogEntry): number {
  const leftMetadata = getLogEntryMetadata(left);
  const rightMetadata = getLogEntryMetadata(right);
  const occurredAt = leftMetadata.occurredAt - rightMetadata.occurredAt;
  if (occurredAt !== 0) return occurredAt;

  const observedAt = left.observedAt - right.observedAt;
  if (observedAt !== 0) return observedAt;

  const producer = leftMetadata.producerId.localeCompare(rightMetadata.producerId);
  if (producer !== 0) return producer;

  const sequence = leftMetadata.producerSequence - rightMetadata.producerSequence;
  if (sequence !== 0) return sequence;

  const id = leftMetadata.id.localeCompare(rightMetadata.id);
  if (id !== 0) return id;

  return Number(isCapturedSignal(left)) - Number(isCapturedSignal(right));
}

function getLogEntryMetadata(entry: KoshkoLogEntry): {
  id: string;
  producerId: string;
  producerSequence: number;
  occurredAt: number;
} {
  return isCapturedSignal(entry) ? entry.signal : entry.mutation;
}

export function isCapturedSignal(
  captured: CapturedSignalV1 | CapturedStateMutationV1,
): captured is CapturedSignalV1 {
  return 'signal' in captured;
}

export function getActorColumns(entries: readonly KoshkoLogEntry[]): KoshkoTimelineActor[] {
  const columns: KoshkoTimelineActor[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isCapturedSignal(entry)) continue;
    for (const reference of [entry.signal.source, entry.signal.target]) {
      if (!reference) continue;
      const key = actorKey(reference);
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ key, reference });
    }
  }
  return columns;
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
  const date = new Date(occurredAt);
  return `${date.toISOString().slice(0, 19)}.${String(date.getMilliseconds()).padStart(3, '0')}Z`;
}
