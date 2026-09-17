import {
  applyStateMutationPatch,
  compareCapturedSignals,
  type ActorReference,
  type CapturedErrorV1,
  type CapturedSignalV1,
  type CapturedStateMutationV1,
  type JsonObject,
  type JsonValue,
  type KoshkoErrorV1,
} from '@koshko/protocol';
import type { CapturedPostMessage } from '../post-message';
import {
  classifyExtensionPostMessage,
  defaultExtensionMessageRulesConfig,
  EXTENSION_MESSAGE_RULES_VERSION,
  normalizeExtensionMessageRules,
  type ExtensionMessageRule,
} from '../extension-message-rules';

interface KoshkoTimelineActorBase {
  key: string;
  reference: ActorReference;
}

export interface KoshkoSemanticTimelineActor extends KoshkoTimelineActorBase {
  kind: 'semantic';
}

export interface KoshkoFrameTimelineActor extends KoshkoTimelineActorBase {
  kind: 'frame';
  frameId: number;
}

export type KoshkoTimelineActor = KoshkoSemanticTimelineActor | KoshkoFrameTimelineActor;

export type KoshkoTimelineEntry = CapturedSignalV1 | CapturedErrorV1 | CapturedPostMessage;
export type KoshkoLogEntry = KoshkoTimelineEntry | CapturedStateMutationV1;

export interface KoshkoStateSnapshot {
  index: number;
  label?: string;
  mutation?: CapturedStateMutationV1;
  state: JsonObject;
}

export class KoshkoRepository {
  private readonly capturedSignals: CapturedSignalV1[] = [];

  private readonly capturedErrors: CapturedErrorV1[] = [];

  private readonly capturedPostMessages: CapturedPostMessage[] = [];

  private readonly capturedLog: KoshkoLogEntry[] = [];

  private paused = false;

  private readonly listeners = new Set<() => void>();

  private displaySignals: CapturedSignalV1[] = [];

  private displayTimelineEntries: KoshkoTimelineEntry[] = [];

  private displayLog: KoshkoLogEntry[] = [];

  private stateHistory: KoshkoStateSnapshot[] = [createInitialStateSnapshot()];

  private state: JsonObject = this.stateHistory[0].state;

  private displayState: JsonObject = this.state;

  private displayStateHistory: KoshkoStateSnapshot[] = this.stateHistory;

  private selectedStateSnapshotIndex: number | null = null;

  private unreadEntries: KoshkoLogEntry[] = [];

  private extensionMessageRules: readonly ExtensionMessageRule[] = defaultExtensionMessageRulesConfig().rules;

  private includeExtensionMessages = false;

  private topFrameIdentity: string | undefined;

  get isPaused(): boolean {
    return this.paused;
  }

  getDisplaySignals(): CapturedSignalV1[] {
    return [...this.displaySignals];
  }

  getDisplayTimelineEntries(): KoshkoTimelineEntry[] {
    return this.getVisibleEntries(this.displayTimelineEntries);
  }

  getDisplayLog(): KoshkoLogEntry[] {
    return this.getVisibleEntries(this.displayLog);
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
    return this.getVisibleEntries(this.unreadEntries).length;
  }

  getExtensionMessageRules(): readonly ExtensionMessageRule[] {
    return this.extensionMessageRules.map((rule) => ({ ...rule }));
  }

  setExtensionMessageRules(rules: readonly ExtensionMessageRule[]): void {
    this.extensionMessageRules = normalizeExtensionMessageRules({
      version: EXTENSION_MESSAGE_RULES_VERSION,
      rules,
    }).rules;
    this.notify();
  }

  getIncludeExtensionMessages(): boolean {
    return this.includeExtensionMessages;
  }

  setIncludeExtensionMessages(include: boolean): void {
    if (this.includeExtensionMessages === include) return;
    this.includeExtensionMessages = include;
    this.notify();
  }

  getHiddenExtensionMessageCount(): number {
    if (this.includeExtensionMessages) return 0;
    return this.displayLog.filter(
      (entry): entry is CapturedPostMessage => isCapturedPostMessage(entry) && this.isExtensionMessage(entry),
    ).length;
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
      this.unreadEntries = [];
      this.syncDisplaySnapshot();
    }
    this.notify();
  }

  clear(): void {
    this.reset();
    this.notify();
  }

  record(captured: KoshkoLogEntry): void {
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
    } else if (isCapturedError(captured)) {
      this.capturedErrors.push(captured);
    } else if (isCapturedPostMessage(captured)) {
      this.capturedPostMessages.push(captured);
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
      this.unreadEntries.push(captured);
    } else {
      this.syncDisplaySnapshot();
    }
    this.notify();
  }

  private reset(): void {
    this.capturedSignals.length = 0;
    this.capturedErrors.length = 0;
    this.capturedPostMessages.length = 0;
    this.capturedLog.length = 0;
    this.displaySignals = [];
    this.displayTimelineEntries = [];
    this.displayLog = [];
    const initialStateSnapshot = createInitialStateSnapshot();
    this.state = initialStateSnapshot.state;
    this.displayState = initialStateSnapshot.state;
    this.stateHistory = [initialStateSnapshot];
    this.displayStateHistory = this.stateHistory;
    this.selectedStateSnapshotIndex = null;
    this.unreadEntries = [];
    this.topFrameIdentity = undefined;
  }

  getSignals(): CapturedSignalV1[] {
    return [...this.capturedSignals].sort(compareCapturedSignals);
  }

  getTimelineEntries(): KoshkoTimelineEntry[] {
    return this.getVisibleEntries(this.getAllTimelineEntries());
  }

  private getAllTimelineEntries(): KoshkoTimelineEntry[] {
    return [
      ...this.capturedSignals,
      ...this.capturedErrors,
      ...this.capturedPostMessages,
    ].sort(compareCapturedLogEntries);
  }

  getLog(): KoshkoLogEntry[] {
    return this.getVisibleEntries(this.capturedLog).sort(compareCapturedLogEntries);
  }

  exportJsonl(): string {
    const entries = this.getVisibleEntries([
      ...this.capturedSignals,
      ...this.capturedErrors,
      ...this.capturedPostMessages,
    ]).sort(compareCapturedLogEntries);
    const classifiedExtensionPostMessageCount = this.capturedPostMessages
      .filter((entry) => this.isExtensionMessage(entry)).length;
    const includedExtensionPostMessageCount = this.includeExtensionMessages
      ? classifiedExtensionPostMessageCount
      : 0;
    const omittedExtensionPostMessageCount = classifiedExtensionPostMessageCount
      - includedExtensionPostMessageCount;
    const header = {
      protocol: 'koshko',
      version: 1,
      type: 'export-metadata',
      count: entries.length,
      signalCount: entries.filter(isCapturedSignal).length,
      errorCount: entries.filter(isCapturedError).length,
      postMessageCount: entries.filter(isCapturedPostMessage).length,
      includedExtensionPostMessageCount,
      omittedExtensionPostMessageCount,
      exportedAt: new Date().toISOString(),
    };

    return [header, ...entries]
      .map((entry) => JSON.stringify(entry))
      .join('\n');
  }

  private getDocumentIdentity(
    captured: KoshkoLogEntry,
  ): string | undefined {
    return captured.documentId ?? captured.navigationId;
  }

  private syncDisplaySnapshot(): void {
    this.displaySignals = this.getSignals();
    this.displayTimelineEntries = this.getAllTimelineEntries();
    this.displayLog = [...this.capturedLog].sort(compareCapturedLogEntries);
    this.displayStateHistory = this.stateHistory;
    this.displayState = this.getSelectedDisplayState();
  }

  private getVisibleEntries<T extends KoshkoLogEntry>(entries: readonly T[]): T[] {
    return entries.filter((entry) => !isCapturedPostMessage(entry)
      || this.includeExtensionMessages
      || !this.isExtensionMessage(entry));
  }

  private isExtensionMessage(entry: CapturedPostMessage): boolean {
    return classifyExtensionPostMessage(entry.data, this.extensionMessageRules) !== null;
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

  return getCapturedEntryType(left).localeCompare(getCapturedEntryType(right));
}

function getLogEntryMetadata(entry: KoshkoLogEntry): {
  id: string;
  producerId: string;
  producerSequence: number;
  occurredAt: number;
} {
  if (isCapturedSignal(entry)) return entry.signal;
  if (isCapturedError(entry)) return entry.error;
  if (isCapturedPostMessage(entry)) {
    return {
      id: entry.id,
      producerId: 'window.post-message',
      producerSequence: entry.sequence,
      occurredAt: entry.observedAt,
    };
  }
  return entry.mutation;
}

export function isCapturedSignal(
  captured: KoshkoLogEntry,
): captured is CapturedSignalV1 {
  return 'signal' in captured;
}

export function isCapturedError(captured: KoshkoLogEntry): captured is CapturedErrorV1 {
  return 'error' in captured;
}

export function isCapturedPostMessage(
  captured: KoshkoLogEntry,
): captured is CapturedPostMessage {
  return 'kind' in captured && captured.kind === 'post-message';
}

export function getErrorDisplayMessage(error: KoshkoErrorV1): string {
  if (
    typeof error.payload === 'object'
    && error.payload !== null
    && !Array.isArray(error.payload)
    && typeof error.payload.message === 'string'
    && error.payload.message.trim() !== ''
  ) {
    return error.payload.message;
  }
  return error.name;
}

function getCapturedEntryType(entry: KoshkoLogEntry): 'error' | 'post-message' | 'signal' | 'state' {
  if (isCapturedSignal(entry)) return 'signal';
  if (isCapturedError(entry)) return 'error';
  if (isCapturedPostMessage(entry)) return 'post-message';
  return 'state';
}

export function getActorColumns(entries: readonly KoshkoLogEntry[]): KoshkoTimelineActor[] {
  const columns: KoshkoTimelineActor[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isCapturedSignal(entry) && !isCapturedError(entry)) continue;
    const references = isCapturedSignal(entry)
      ? [entry.signal.source, entry.signal.target]
      : [entry.error.source];
    for (const reference of references) {
      if (!reference) continue;
      const key = actorKey(reference);
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ kind: 'semantic', key, reference });
    }
  }
  return columns;
}

export function getTimelineActors(entries: readonly KoshkoTimelineEntry[]): KoshkoTimelineActor[] {
  const actors = getActorColumns(entries);
  const seen = new Set(actors.map((actor) => actor.key));
  for (const entry of entries) {
    if (!isCapturedPostMessage(entry)) continue;
    const frame = frameActor(entry);
    if (seen.has(frame.key)) continue;
    seen.add(frame.key);
    actors.push(frame);
  }
  return actors;
}

export function frameActor(entry: CapturedPostMessage): KoshkoFrameTimelineActor {
  const key = `frame::${entry.frameId}`;
  const compactUrl = compactFrameUrl(entry.frameUrl);
  const label = entry.frameId === 0
    ? compactUrl || `Frame ${entry.frameId}`
    : entry.iframeElementId
      ? `#${entry.iframeElementId}`
      : compactUrl || `Frame ${entry.frameId}`;
  return {
    kind: 'frame',
    key,
    frameId: entry.frameId,
    reference: { id: 'frame', instanceId: String(entry.frameId), label },
  };
}

function compactFrameUrl(value: string): string {
  try {
    const url = new URL(value);
    const text = `${url.host}${url.pathname}`.replace(/\/$/, '') || url.host;
    return text.length > 36 ? `${text.slice(0, 33)}…` : text;
  } catch {
    const text = value.replace(/[?#].*$/, '');
    return text.length > 36 ? `${text.slice(0, 33)}…` : text;
  }
}

export function actorKey(reference: ActorReference): string {
  return `actor::${reference.id}::${reference.instanceId ?? ''}`;
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
