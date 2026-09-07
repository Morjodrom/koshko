import { action, logger } from '@nanostores/logger';
import { atom, map } from 'nanostores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectNanoStores } from './index';

function getMutations(postMessage: ReturnType<typeof vi.fn>): Array<{ patch: Array<Record<string, unknown>> }> {
  return postMessage.mock.calls.map(([message]) => message.mutation);
}

beforeEach(() => {
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('connectNanoStores', () => {
  it('publishes an initial grouped snapshot for atom and map stores', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $counter = atom(3);
    const $profile = map({ name: 'Ada', visits: 1 });

    connectNanoStores({ counter: $counter, profile: $profile });

    expect(getMutations(postMessage)).toMatchObject([
      {
        patch: [
          {
            op: 'add',
            path: '/nanostores',
            value: {
              counter: 3,
              profile: { name: 'Ada', visits: 1 },
            },
          },
        ],
      },
    ]);
  });

  it('re-emits a complete grouped snapshot for atom and map changes', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $counter = atom(0);
    const $profile = map({ name: 'Ada', visits: 1 });

    connectNanoStores({ counter: $counter, profile: $profile });
    postMessage.mockClear();

    $counter.set(2);
    $profile.setKey('visits', 2);

    expect(getMutations(postMessage)).toMatchObject([
      {
        patch: [{
          op: 'add',
          path: '/nanostores',
          value: {
            counter: 2,
            profile: { name: 'Ada', visits: 1 },
          },
        }],
      },
      {
        patch: [{
          op: 'add',
          path: '/nanostores',
          value: {
            counter: 2,
            profile: { name: 'Ada', visits: 2 },
          },
        }],
      },
    ]);
  });

  it('captures action-wrapped mutations without emitting Koshko signals', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $counter = atom(0);
    const increment = action($counter, 'increment', ($store, amount: number) => {
      $store.set($store.get() + amount);
    });

    connectNanoStores({ counter: $counter });
    postMessage.mockClear();

    increment(4);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state-mutation',
      mutation: expect.objectContaining({
        patch: [{
          op: 'add',
          path: '/nanostores',
          value: { counter: 4 },
        }],
      }),
    }), '*');
  });

  it('preserves the standard Nano Stores Logger console messages', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const groupCollapsed = vi.mocked(console.groupCollapsed);
    const groupEnd = vi.mocked(console.groupEnd);
    const $counter = atom(0);
    const increment = action($counter, 'counter.increment', (store): void => {
      store.set(store.get() + 1);
    });

    connectNanoStores({ counter: $counter });
    logger({ counter: $counter });
    groupCollapsed.mockClear();
    groupEnd.mockClear();

    increment();

    expect(groupCollapsed.mock.calls.map(([template]) => template)).toEqual([
      expect.stringContaining('action'),
      expect.stringContaining('change'),
    ]);
    expect(groupEnd).toHaveBeenCalledTimes(2);
  });

  it('keeps Koshko state updates enabled when console change logs are disabled', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const groupCollapsed = vi.mocked(console.groupCollapsed);
    const $counter = atom(0);

    connectNanoStores({ counter: $counter });
    postMessage.mockClear();
    groupCollapsed.mockClear();

    $counter.set(1);

    expect(getMutations(postMessage)).toMatchObject([{
      patch: [{ op: 'add', path: '/nanostores', value: { counter: 1 } }],
    }]);
    expect(groupCollapsed).not.toHaveBeenCalled();
  });

  it('does not use the console when no logger is configured', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $counter = atom(0);

    connectNanoStores({ counter: $counter });
    $counter.set(1);

    expect(console.log).not.toHaveBeenCalled();
    expect(console.groupCollapsed).not.toHaveBeenCalled();
    expect(console.groupEnd).not.toHaveBeenCalled();
  });

  it('keeps logger hooks independent when the logger is installed before the bridge', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const groupCollapsed = vi.mocked(console.groupCollapsed);
    const $counter = atom(0);
    const increment = action($counter, 'counter.increment', (store): void => {
      store.set(store.get() + 1);
    });

    const cleanupLogger = logger({ counter: $counter });
    const cleanupBridge = connectNanoStores({ counter: $counter });
    groupCollapsed.mockClear();
    postMessage.mockClear();
    increment();

    expect(groupCollapsed).toHaveBeenCalled();
    expect(getMutations(postMessage)).toHaveLength(1);
    cleanupBridge();
    cleanupLogger();
  });

  it('keeps logger hooks independent when the logger is installed after the bridge', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const groupCollapsed = vi.mocked(console.groupCollapsed);
    const $counter = atom(0);
    const increment = action($counter, 'counter.increment', (store): void => {
      store.set(store.get() + 1);
    });

    const cleanupBridge = connectNanoStores({ counter: $counter });
    const cleanupLogger = logger({ counter: $counter });
    groupCollapsed.mockClear();
    postMessage.mockClear();
    increment();

    expect(groupCollapsed).toHaveBeenCalled();
    expect(getMutations(postMessage)).toHaveLength(1);
    cleanupLogger();
    cleanupBridge();
  });

  it('allows bridge cleanup without disabling an independently installed logger', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const groupCollapsed = vi.mocked(console.groupCollapsed);
    const $counter = atom(0);
    const increment = action($counter, 'counter.increment', (store): void => {
      store.set(store.get() + 1);
    });

    const cleanupBridge = connectNanoStores({ counter: $counter });
    const cleanupLogger = logger({ counter: $counter });
    cleanupBridge();
    groupCollapsed.mockClear();
    postMessage.mockClear();
    increment();

    expect(groupCollapsed).toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    cleanupLogger();
  });

  it('allows logger cleanup without disabling bridge synchronization', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $counter = atom(0);

    const cleanupBridge = connectNanoStores({ counter: $counter });
    const cleanupLogger = logger({ counter: $counter });
    cleanupLogger();
    postMessage.mockClear();
    $counter.set(1);

    expect(getMutations(postMessage)).toMatchObject([{
      patch: [{ op: 'add', path: '/nanostores', value: { counter: 1 } }],
    }]);
    cleanupBridge();
  });

  it('escapes the namespace path and preserves store names as object keys', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $value = atom('before');

    connectNanoStores({ 'a/b~c': $value }, { namespace: 'nano/store~root' });
    $value.set('after');

    const mutations = getMutations(postMessage);
    expect(mutations[0]?.patch).toEqual([{
      op: 'add',
      path: '/nano~1store~0root',
      value: { 'a/b~c': 'before' },
    }]);
    expect(mutations[1]?.patch).toEqual([{
      op: 'add',
      path: '/nano~1store~0root',
      value: { 'a/b~c': 'after' },
    }]);
  });

  it('uses the configured producer and stops publishing after cleanup', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { postMessage });
    const $counter = atom(0);

    const cleanup = connectNanoStores({ counter: $counter }, { producerId: 'custom-nano' });

    expect(getMutations(postMessage)[0]).toMatchObject({ producerId: 'custom-nano' });
    postMessage.mockClear();
    cleanup();
    $counter.set(1);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
