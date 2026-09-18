import type { BridgeAiLogResult, BridgeSessionMetadata, BridgeStateSnapshot, BridgeTraceEntry } from '@koshko/bridge';

export interface StoreLimits {
  maxSessions: number;
  maxEntriesPerSession: number;
  maxEntriesTotal: number;
  maxStoredBytes?: number;
}

export interface SessionView extends BridgeSessionMetadata {
  connectedAt: number;
  connected: boolean;
  disconnectedAt?: number;
  entryCount: number;
  latestState?: BridgeStateSnapshot;
}

interface StoredSession extends SessionView {
  entries: Map<string, StoredEntry>;
  lastAccess: number;
  aiLogs: Map<string, BridgeAiLogResult>;
}

interface StoredEntry {
  entry: BridgeTraceEntry;
  insertedAt: number;
  byteSize: number;
}

export class CaptureStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly maxStoredBytes: number;
  private sequence = 0;

  public constructor(private readonly limits: StoreLimits) {
    if (!Number.isSafeInteger(limits.maxSessions) || limits.maxSessions < 1 ||
      !Number.isSafeInteger(limits.maxEntriesPerSession) || limits.maxEntriesPerSession < 1 ||
      !Number.isSafeInteger(limits.maxEntriesTotal) || limits.maxEntriesTotal < 1 ||
      (limits.maxStoredBytes !== undefined && (!Number.isSafeInteger(limits.maxStoredBytes) || limits.maxStoredBytes < 1))) {
      throw new Error('Store limits must be positive safe integers.');
    }
    this.maxStoredBytes = limits.maxStoredBytes ?? 16 * 1024 * 1024;
  }

  public upsertSession(metadata: BridgeSessionMetadata, connectedAt: number): SessionView {
    const existing = this.sessions.get(metadata.sessionId);
    const session: StoredSession = existing === undefined
      ? {
          ...metadata,
          connectedAt,
          connected: true,
          entryCount: 0,
          entries: new Map(),
          lastAccess: this.nextSequence(),
          aiLogs: new Map(),
        }
      : {
          ...existing,
          ...metadata,
          connectedAt: existing.connectedAt,
          connected: true,
          disconnectedAt: undefined,
          lastAccess: this.nextSequence(),
        };
    this.sessions.set(metadata.sessionId, session);
    this.evictSessions();
    return this.toView(session);
  }

  public resumeSession(sessionId: string, connectedAt: number): SessionView | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.connected = true;
    session.connectedAt = connectedAt;
    session.disconnectedAt = undefined;
    session.lastAccess = this.nextSequence();
    return this.toView(session);
  }

  public disconnectSession(sessionId: string, disconnectedAt: number): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.connected = false;
    session.disconnectedAt = disconnectedAt;
    session.lastAccess = this.nextSequence();
  }

  public appendEntries(sessionId: string, entries: readonly BridgeTraceEntry[]): string[] {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return [];
    }
    session.lastAccess = this.nextSequence();
    const accepted: string[] = [];
    let changed = false;
    for (const entry of entries) {
      if (session.entries.has(entry.entryId)) {
        accepted.push(entry.entryId);
        continue;
      }
      session.entries.set(entry.entryId, {
        entry,
        insertedAt: this.nextSequence(),
        byteSize: Buffer.byteLength(JSON.stringify(entry), 'utf8'),
      });
      changed = true;
      accepted.push(entry.entryId);
      this.evictEntriesInSession(session);
    }
    session.entryCount = session.entries.size;
    if (changed) session.aiLogs.clear();
    this.evictEntriesGlobally();
    return accepted;
  }

  public setLatestState(sessionId: string, snapshot: BridgeStateSnapshot): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.latestState = snapshot;
    session.aiLogs.clear();
    session.lastAccess = this.nextSequence();
  }

  public listSessions(limit: number): SessionView[] {
    return [...this.sessions.values()]
      .sort(compareSessionsNewestFirst)
      .slice(0, limit)
      .map((session) => this.toView(session));
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public getSession(sessionId: string): SessionView | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.lastAccess = this.nextSequence();
    return this.toView(session);
  }

  public readEntries(sessionId: string, offset: number, limit: number): BridgeTraceEntry[] | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.lastAccess = this.nextSequence();
    return [...session.entries.values()]
      .sort((left, right) => left.insertedAt - right.insertedAt || left.entry.entryId.localeCompare(right.entry.entryId))
      .slice(offset, offset + limit)
      .map((stored) => stored.entry);
  }

  public getEntry(sessionId: string, entryId: string): BridgeTraceEntry | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.lastAccess = this.nextSequence();
    return session.entries.get(entryId)?.entry;
  }

  public getState(sessionId: string): BridgeStateSnapshot | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.lastAccess = this.nextSequence();
    return session.latestState;
  }

  public getAiLog(sessionId: string, budget: string): BridgeAiLogResult | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.lastAccess = this.nextSequence();
    return session.aiLogs.get(budget);
  }

  public setAiLog(sessionId: string, budget: string, result: BridgeAiLogResult): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.aiLogs.set(budget, result);
    session.lastAccess = this.nextSequence();
  }

  private evictSessions(): void {
    while (this.sessions.size > this.limits.maxSessions) {
      const oldest = [...this.sessions.values()].sort(compareSessionsOldestFirst)[0];
      if (oldest === undefined) {
        return;
      }
      this.sessions.delete(oldest.sessionId);
    }
  }

  private evictEntriesInSession(session: StoredSession): void {
    while (session.entries.size > this.limits.maxEntriesPerSession) {
      const oldest = [...session.entries.values()].sort(compareEntriesOldestFirst)[0];
      if (oldest === undefined) {
        return;
      }
      session.entries.delete(oldest.entry.entryId);
    }
    session.entryCount = session.entries.size;
  }

  private evictEntriesGlobally(): void {
    while (this.totalEntries() > this.limits.maxEntriesTotal || this.totalEntryBytes() > this.maxStoredBytes) {
      const oldest = [...this.sessions.values()]
        .flatMap((session) => [...session.entries.values()].map((entry) => ({ session, entry })))
        .sort((left, right) => compareEntriesOldestFirst(left.entry, right.entry) || left.session.sessionId.localeCompare(right.session.sessionId))[0];
      if (oldest === undefined) {
        return;
      }
      oldest.session.entries.delete(oldest.entry.entry.entryId);
      oldest.session.entryCount = oldest.session.entries.size;
    }
  }

  private totalEntries(): number {
    return [...this.sessions.values()].reduce((total, session) => total + session.entries.size, 0);
  }

  private totalEntryBytes(): number {
    return [...this.sessions.values()].reduce(
      (total, session) => total + [...session.entries.values()].reduce(
        (sessionTotal, entry) => sessionTotal + entry.byteSize,
        0,
      ),
      0,
    );
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private toView(session: StoredSession): SessionView {
    const { entries: _entries, aiLogs: _aiLogs, lastAccess: _lastAccess, ...view } = session;
    return { ...view };
  }
}

function compareSessionsOldestFirst(left: StoredSession, right: StoredSession): number {
  return left.lastAccess - right.lastAccess || left.sessionId.localeCompare(right.sessionId);
}

function compareSessionsNewestFirst(left: StoredSession, right: StoredSession): number {
  return right.lastAccess - left.lastAccess || left.sessionId.localeCompare(right.sessionId);
}

function compareEntriesOldestFirst(left: StoredEntry, right: StoredEntry): number {
  return left.insertedAt - right.insertedAt || left.entry.entryId.localeCompare(right.entry.entryId);
}
