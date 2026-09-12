import { describe, expect, it } from 'vitest';
import {
  KoshkoRepository,
  actorKey,
  formatDateTime,
  getActorColumns,
  type KoshkoLogEntry,
} from './repository';

function entryID(entry: KoshkoLogEntry): string {
  if ('signal' in entry) return entry.signal.id;
  if ('error' in entry) return entry.error.id;
  return entry.mutation.id;
}

describe('koshko inspector repository', () => {
  it('notifies subscribers exactly once for active, paused, and navigation records', () => {
    const repo = new KoshkoRepository();
    let notifications = 0;
    repo.subscribe(() => {
      notifications += 1;
    });
    const signal = (id: string, navigationId: string) => ({
      signal: {
        protocol: 'koshko' as const,
        version: 1 as const,
        id,
        producerId: 'producer',
        producerSequence: notifications + 1,
        occurredAt: notifications + 1,
        source: { id: 'host' },
        name: id,
      },
      observedAt: notifications + 1,
      tabId: 1,
      frameId: 2,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId,
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    repo.record(signal('active', 'nav-a'));
    expect(notifications).toBe(1);

    repo.setPaused(true);
    const beforePausedRecord = notifications;
    repo.record(signal('paused', 'nav-a'));
    expect(notifications).toBe(beforePausedRecord + 1);

    const beforeNavigation = notifications;
    repo.record(signal('navigation', 'nav-b'));
    expect(notifications).toBe(beforeNavigation + 1);
  });

  it('keeps signals chronological and clears on a new top-frame document identity', () => {
    const repo = new KoshkoRepository();

    repo.record({
      signal: {
        protocol: 'koshko',
        version: 1,
        id: 'sub-1',
        producerId: 'p',
        producerSequence: 1,
        occurredAt: 20,
        source: { id: 'widget', label: 'Widget' },
        name: 'widget.ready',
      },
      observedAt: 20,
      tabId: 1,
      frameId: 2,
      captureContext: { id: 'frame:2', kind: 'frame' as const },
      navigationId: 'nav-a',
      frameUrl: 'https://example.com/frame',
      frameOrigin: 'https://example.com',
    });

    repo.record({
      signal: {
        protocol: 'koshko',
        version: 1,
        id: 'top-1',
        producerId: 'p',
        producerSequence: 2,
        occurredAt: 10,
        source: { id: 'host', label: 'Host' },
        name: 'host.ready',
      },
      observedAt: 10,
      tabId: 1,
      frameId: 2,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav-top-a',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    repo.record({
      signal: {
        protocol: 'koshko',
        version: 1,
        id: 'top-2',
        producerId: 'p',
        producerSequence: 3,
        occurredAt: 30,
        source: { id: 'host', label: 'Host' },
        name: 'host.reset',
      },
      observedAt: 30,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav-top-b',
      frameUrl: 'https://example.com/next',
      frameOrigin: 'https://example.com',
    });

    expect(repo.getSignals().map((signal) => signal.signal.id)).toEqual(['top-2']);
    expect(getActorColumns(repo.getDisplaySignals()).map((actor) => actor.key)).toEqual([actorKey({ id: 'host', label: 'Host' })]);
  });

  it('freezes the display while paused, clears, and exports JSONL metadata', () => {
    const repo = new KoshkoRepository();

    repo.record({
      signal: {
        protocol: 'koshko',
        version: 1,
        id: 'kept-1',
        producerId: 'p',
        producerSequence: 1,
        occurredAt: 1,
        source: { id: 'host' },
        name: 'kept',
      },
      observedAt: 1,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    expect(repo.getDisplaySignals().map((signal) => signal.signal.id)).toEqual(['kept-1']);

    repo.setPaused(true);
    repo.record({
      signal: {
        protocol: 'koshko',
        version: 1,
        id: 'kept-2',
        producerId: 'p',
        producerSequence: 2,
        occurredAt: 2,
        source: { id: 'host' },
        name: 'kept-again',
      },
      observedAt: 2,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    expect(repo.getDisplaySignals().map((signal) => signal.signal.id)).toEqual(['kept-1']);
    expect(repo.getUnreadCount()).toBe(1);

    repo.setPaused(false);
    expect(repo.getDisplaySignals().map((signal) => signal.signal.id)).toEqual(['kept-1', 'kept-2']);
    expect(repo.getUnreadCount()).toBe(0);

    const lines = repo.exportJsonl().split('\n');
    expect(lines[0]).toContain('"type":"export-metadata"');
    expect(lines[0]).toContain('"protocol":"koshko"');
    expect(lines[1]).toContain('"id":"kept-1"');
    repo.clear();
    expect(repo.getSignals().length).toBe(0);
  });

  it('discovers actors from displayed signals only while paused', () => {
    const repo = new KoshkoRepository();
    const makeSignal = (id: string, source: string) => ({
      signal: {
        protocol: 'koshko' as const,
        version: 1 as const,
        id,
        producerId: 'producer',
        producerSequence: 1,
        occurredAt: 1,
        source: { id: source },
        name: id,
      },
      observedAt: 1,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    repo.record(makeSignal('host-event', 'host'));
    repo.setPaused(true);
    repo.record(makeSignal('widget-event', 'widget'));

    expect(getActorColumns(repo.getDisplaySignals()).map((actor) => actor.key)).toEqual([
      actorKey({ id: 'host' }),
    ]);
    repo.setPaused(false);
    expect(getActorColumns(repo.getDisplaySignals()).map((actor) => actor.key)).toEqual([
      actorKey({ id: 'host' }),
      actorKey({ id: 'widget' }),
    ]);
  });

  it('formats timestamps with milliseconds', () => {
    expect(formatDateTime(Date.parse('2026-09-05T12:34:56.789Z'))).toBe('2026-09-05T12:34:56.789Z');
  });

  it('reconstructs global state, resets it for top-frame navigation and clear, and freezes it while paused', () => {
    const repo = new KoshkoRepository();
    const stateMutation = (id: string, navigationId: string, patch: import('@koshko/protocol').KoshkoStateMutationV1['patch']) => ({
      mutation: {
        protocol: 'koshko' as const,
        version: 1 as const,
        id,
        producerId: 'state-producer',
        producerSequence: 1,
        occurredAt: 1,
        patch,
      },
      observedAt: 1,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId,
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    repo.record(stateMutation('state-1', 'nav-a', [{ op: 'add', path: '/cart', value: { count: 1 } }]));
    expect(repo.getDisplayState()).toEqual({ cart: { count: 1 } });
    expect(repo.getSignals().length).toBe(0);

    repo.setPaused(true);
    repo.record(stateMutation('state-2', 'nav-a', [{ op: 'replace', path: '/cart/count', value: 2 }]));
    expect(repo.getDisplayState()).toEqual({ cart: { count: 1 } });
    expect(repo.getUnreadCount()).toBe(1);

    repo.setPaused(false);
    expect(repo.getDisplayState()).toEqual({ cart: { count: 2 } });

    repo.record(stateMutation('state-3', 'nav-b', [{ op: 'add', path: '/fresh', value: true }]));
    expect(repo.getDisplayState()).toEqual({ fresh: true });

    repo.clear();
    expect(repo.getDisplayState()).toEqual({});
  });

  it('keeps the prior state when a mutation patch cannot be applied atomically', () => {
    const repo = new KoshkoRepository();
    const base = {
      observedAt: 1,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    };
    repo.record({
      ...base,
      mutation: {
        protocol: 'koshko', version: 1, id: 'state-1', producerId: 'p', producerSequence: 1, occurredAt: 1,
        patch: [{ op: 'add', path: '/value', value: 1 }],
      },
    });
    repo.record({
      ...base,
      mutation: {
        protocol: 'koshko', version: 1, id: 'state-2', producerId: 'p', producerSequence: 2, occurredAt: 2,
        patch: [
          { op: 'replace', path: '/value', value: 2 },
          { op: 'replace', path: '/missing', value: 3 },
        ],
      },
    });

    expect(repo.getDisplayState()).toEqual({ value: 1 });
  });

  it('retains a deterministic combined log snapshot, including invalid mutations, across pause and navigation', () => {
    const repo = new KoshkoRepository();
    const base = {
      observedAt: 10,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav-a',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    };

    repo.record({
      ...base,
      mutation: {
        protocol: 'koshko', version: 1, id: 'state-1', producerId: 'state', producerSequence: 1, occurredAt: 20,
        patch: [{ op: 'add', path: '/value', value: 1 }],
      },
    });
    repo.record({
      ...base,
      signal: {
        protocol: 'koshko', version: 1, id: 'signal-1', producerId: 'signal', producerSequence: 1, occurredAt: 10,
        source: { id: 'host' }, name: 'host.ready',
      },
    });
    repo.setPaused(true);
    repo.record({
      ...base,
      observedAt: 30,
      mutation: {
        protocol: 'koshko', version: 1, id: 'state-invalid', producerId: 'state', producerSequence: 2, occurredAt: 30,
        patch: [{ op: 'replace', path: '/missing', value: true }],
      },
    });

    expect(repo.getDisplayLog().map(entryID)).toEqual(['signal-1', 'state-1']);
    expect(repo.getLog().map(entryID)).toEqual(['signal-1', 'state-1', 'state-invalid']);
    expect(repo.getDisplayState()).toEqual({ value: 1 });

    repo.setPaused(false);
    expect(repo.getDisplayLog().map(entryID)).toEqual(['signal-1', 'state-1', 'state-invalid']);

    repo.record({
      ...base,
      navigationId: 'nav-b',
      signal: {
        protocol: 'koshko', version: 1, id: 'signal-next', producerId: 'signal', producerSequence: 2, occurredAt: 1,
        source: { id: 'host' }, name: 'host.next',
      },
    });
    expect(repo.getDisplayLog().map(entryID)).toEqual(['signal-next']);
  });

  it('orders errors with signals, discovers their actors, pauses them, and exports separate counts', () => {
    const repo = new KoshkoRepository();
    const base = {
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav-a',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    };
    repo.record({
      ...base,
      observedAt: 20,
      error: {
        protocol: 'koshko', version: 1, id: 'error-1', producerId: 'console', producerSequence: 1, occurredAt: 20,
        source: { id: 'browser-console', label: 'Browser Console' }, name: 'console.error', payload: { arguments: ['failed'] },
      },
    });
    repo.record({
      ...base,
      observedAt: 10,
      signal: {
        protocol: 'koshko', version: 1, id: 'signal-1', producerId: 'host', producerSequence: 1, occurredAt: 10,
        source: { id: 'host', label: 'Host' }, name: 'host.ready',
      },
    });

    expect(repo.getSignals().map((entry) => entry.signal.id)).toEqual(['signal-1']);
    expect(repo.getTimelineEntries().map(entryID)).toEqual(['signal-1', 'error-1']);
    expect(getActorColumns(repo.getDisplayTimelineEntries()).map((actor) => actor.key)).toEqual([
      actorKey({ id: 'host' }),
      actorKey({ id: 'browser-console' }),
    ]);

    repo.setPaused(true);
    repo.record({
      ...base,
      observedAt: 30,
      error: {
        protocol: 'koshko', version: 1, id: 'error-2', producerId: 'console', producerSequence: 2, occurredAt: 30,
        source: { id: 'browser-console' }, name: 'runtime.uncaught-error', payload: { message: 'boom' },
      },
    });
    expect(repo.getDisplayTimelineEntries().map(entryID)).toEqual(['signal-1', 'error-1']);
    expect(repo.getUnreadCount()).toBe(1);

    repo.setPaused(false);
    expect(repo.getDisplayTimelineEntries().map(entryID)).toEqual(['signal-1', 'error-1', 'error-2']);
    const [metadata, signalLine, firstErrorLine, secondErrorLine] = repo.exportJsonl().split('\n');
    expect(JSON.parse(metadata)).toMatchObject({ count: 3, signalCount: 1, errorCount: 2 });
    expect(JSON.parse(signalLine)).toHaveProperty('signal.id', 'signal-1');
    expect(JSON.parse(firstErrorLine)).toHaveProperty('error.id', 'error-1');
    expect(JSON.parse(secondErrorLine)).toHaveProperty('error.id', 'error-2');

    repo.record({
      ...base,
      navigationId: 'nav-b',
      observedAt: 1,
      error: {
        protocol: 'koshko', version: 1, id: 'error-next', producerId: 'console', producerSequence: 3, occurredAt: 1,
        source: { id: 'browser-console' }, name: 'console.error', payload: null,
      },
    });
    expect(repo.getTimelineEntries().map(entryID)).toEqual(['error-next']);
  });

  it('records immutable ordered state snapshots only for applied mutations and selects displayed history', () => {
    const repo = new KoshkoRepository();
    const stateMutation = (
      id: string,
      sequence: number,
      patch: import('@koshko/protocol').KoshkoStateMutationV1['patch'],
      label?: string,
    ) => ({
      mutation: {
        protocol: 'koshko' as const,
        version: 1 as const,
        id,
        producerId: 'state-producer',
        producerSequence: sequence,
        occurredAt: sequence,
        label,
        patch,
      },
      observedAt: sequence,
      tabId: 1,
      frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const },
      navigationId: 'nav-a',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    expect(repo.getDisplayStateHistory()).toEqual([{ index: 0, state: {} }]);
    expect(repo.getSelectedStateSnapshotIndex()).toBeNull();

    repo.record(stateMutation('add-cart', 1, [{ op: 'add', path: '/cart', value: { count: 1 } }], 'Cart created'));
    repo.record(stateMutation('increment-cart', 2, [{ op: 'replace', path: '/cart/count', value: 2 }], 'Cart updated'));
    repo.record(stateMutation('invalid', 3, [{ op: 'replace', path: '/missing', value: true }], 'Ignored'));

    const stateHistory = repo.getDisplayStateHistory();
    expect(stateHistory.map(({ index, label, state }) => ({ index, label, state }))).toEqual([
      { index: 0, state: {} },
      { index: 1, label: 'Cart created', state: { cart: { count: 1 } } },
      { index: 2, label: 'Cart updated', state: { cart: { count: 2 } } },
    ]);
    expect(stateHistory[0].mutation).toBeUndefined();
    expect(stateHistory[1].mutation?.mutation).toMatchObject({
      id: 'add-cart',
      producerId: 'state-producer',
      occurredAt: 1,
      label: 'Cart created',
    });
    expect(stateHistory[2].mutation?.mutation).toMatchObject({
      id: 'increment-cart',
      producerId: 'state-producer',
      occurredAt: 2,
      label: 'Cart updated',
    });
    expect(repo.getLog().map(entryID)).toEqual([
      'add-cart', 'increment-cart', 'invalid',
    ]);

    expect(repo.selectStateSnapshot(0)).toBe(true);
    expect(repo.getDisplayState()).toEqual({});
    expect(repo.getSelectedStateSnapshotIndex()).toBe(0);

    expect(repo.selectStateSnapshot(1)).toBe(true);
    expect(repo.getDisplayState()).toEqual({ cart: { count: 1 } });

    expect(repo.selectStateSnapshot(2)).toBe(true);
    expect(repo.getDisplayState()).toEqual({ cart: { count: 2 } });
    expect(repo.selectStateSnapshot(99)).toBe(false);
    expect(repo.getSelectedStateSnapshotIndex()).toBe(2);
  });

  it('keeps a pinned snapshot during new input and restores Live selection', () => {
    const repo = new KoshkoRepository();
    const recordValue = (id: string, value: number): void => {
      repo.record({
        mutation: {
          protocol: 'koshko', version: 1, id, producerId: 'state', producerSequence: value, occurredAt: value,
          patch: [{ op: value === 1 ? 'add' : 'replace', path: '/value', value }],
        },
        observedAt: value, tabId: 1, frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const }, navigationId: 'nav', frameUrl: 'https://example.com', frameOrigin: 'https://example.com',
      });
    };

    recordValue('first', 1);
    expect(repo.selectStateSnapshot(1)).toBe(true);

    recordValue('second', 2);

    expect(repo.getDisplayStateHistory().map((snapshot) => snapshot.index)).toEqual([0, 1, 2]);
    expect(repo.getDisplayState()).toEqual({ value: 1 });
    expect(repo.selectStateSnapshot(null)).toBe(true);
    expect(repo.getSelectedStateSnapshotIndex()).toBeNull();
    expect(repo.getDisplayState()).toEqual({ value: 2 });
  });

  it('freezes displayed state history while paused and resets history and selection on clear or navigation', () => {
    const repo = new KoshkoRepository();
    const recordMutation = (id: string, navigationId: string, patch: import('@koshko/protocol').KoshkoStateMutationV1['patch']): void => {
      repo.record({
        mutation: {
          protocol: 'koshko', version: 1, id, producerId: 'state', producerSequence: 1, occurredAt: 1, patch,
        },
        observedAt: 1, tabId: 1, frameId: 0,
      captureContext: { id: 'top', kind: 'top' as const }, navigationId, frameUrl: 'https://example.com', frameOrigin: 'https://example.com',
      });
    };

    recordMutation('first', 'nav-a', [{ op: 'add', path: '/value', value: 1 }]);
    repo.setPaused(true);
    recordMutation('second', 'nav-a', [{ op: 'replace', path: '/value', value: 2 }]);

    expect(repo.getDisplayStateHistory().map((snapshot) => snapshot.index)).toEqual([0, 1]);

    repo.setPaused(false);
    expect(repo.getDisplayStateHistory().map((snapshot) => snapshot.index)).toEqual([0, 1, 2]);
    expect(repo.selectStateSnapshot(1)).toBe(true);
    repo.clear();
    expect(repo.getDisplayStateHistory()).toEqual([{ index: 0, state: {} }]);
    expect(repo.getSelectedStateSnapshotIndex()).toBeNull();

    recordMutation('after-clear', 'nav-a', [{ op: 'add', path: '/old', value: true }]);
    expect(repo.selectStateSnapshot(1)).toBe(true);
    recordMutation('after-navigation', 'nav-b', [{ op: 'add', path: '/fresh', value: true }]);
    expect(repo.getDisplayStateHistory().map(({ index, state }) => ({ index, state }))).toEqual([
      { index: 0, state: {} },
      { index: 1, state: { fresh: true } },
    ]);
    expect(repo.getSelectedStateSnapshotIndex()).toBeNull();
  });
});
