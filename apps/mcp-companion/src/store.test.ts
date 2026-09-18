import { describe, expect, it } from 'vitest';
import { CaptureStore } from './store';
import { entry, session } from './test-fixtures';

describe('CaptureStore', () => {
  it('evicts least recently used sessions deterministically', () => {
    const store = new CaptureStore({ maxSessions: 2, maxEntriesPerSession: 3, maxEntriesTotal: 4 });
    store.upsertSession(session('a'), 1);
    store.upsertSession(session('b'), 2);
    store.getSession('a');
    store.upsertSession(session('c'), 3);

    expect(store.getSession('a')).toBeDefined();
    expect(store.getSession('b')).toBeUndefined();
    expect(store.getSession('c')).toBeDefined();
  });

  it('evicts oldest entries under per-session and global caps', () => {
    const store = new CaptureStore({ maxSessions: 2, maxEntriesPerSession: 2, maxEntriesTotal: 2 });
    store.upsertSession(session('a'), 1);
    store.appendEntries('a', [entry('a', 'one'), entry('a', 'two'), entry('a', 'three')]);

    expect(store.readEntries('a', 0, 10)?.map((value) => value.entryId)).toEqual(['two', 'three']);
    store.upsertSession(session('b'), 2);
    store.appendEntries('b', [entry('b', 'four')]);

    expect(store.readEntries('a', 0, 10)?.map((value) => value.entryId)).toEqual(['three']);
    expect(store.readEntries('b', 0, 10)?.map((value) => value.entryId)).toEqual(['four']);
  });

  it('evicts oldest entries when the serialized byte budget is exhausted', () => {
    const first = { ...entry('a', 'one'), data: { text: 'a'.repeat(300) } };
    const second = { ...entry('a', 'two'), data: { text: 'b'.repeat(300) } };
    const oneEntryBytes = Buffer.byteLength(JSON.stringify(first), 'utf8');
    const store = new CaptureStore({
      maxSessions: 1,
      maxEntriesPerSession: 10,
      maxEntriesTotal: 10,
      maxStoredBytes: oneEntryBytes + 32,
    });
    store.upsertSession(session('a'), 1);

    store.appendEntries('a', [first, second]);

    expect(store.readEntries('a', 0, 10)?.map((value) => value.entryId)).toEqual(['two']);
  });

  it('invalidates cached AI logs when capture evidence changes', () => {
    const store = new CaptureStore({ maxSessions: 1, maxEntriesPerSession: 10, maxEntriesTotal: 10 });
    store.upsertSession(session('a'), 1);
    store.setAiLog('a', '8k', {
      text: 'old', estimatedTokens: 1, includedEntryCount: 0, omittedEntryCount: 0,
      includedAnchorCount: 0, compactedValueCount: 0, truncatedValueCount: 0,
      selectionMode: 'all', stateStatus: 'empty',
    });

    store.appendEntries('a', [entry('a', 'one')]);

    expect(store.getAiLog('a', '8k')).toBeUndefined();
  });
});
