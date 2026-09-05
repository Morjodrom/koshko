import { describe, expect, it } from 'vitest';
import { ActorFlowRepository, actorKey, formatTimestamp } from './repository';

describe('actor flow repository', () => {
  it('keeps signals chronological and clears on a new top-frame document identity', () => {
    const repo = new ActorFlowRepository();

    repo.record({
      signal: {
        protocol: 'actor-flow',
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
      navigationId: 'nav-a',
      frameUrl: 'https://example.com/frame',
      frameOrigin: 'https://example.com',
    });

    repo.record({
      signal: {
        protocol: 'actor-flow',
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
      frameId: 0,
      navigationId: 'nav-top-a',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    repo.record({
      signal: {
        protocol: 'actor-flow',
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
      navigationId: 'nav-top-b',
      frameUrl: 'https://example.com/next',
      frameOrigin: 'https://example.com',
    });

    expect(repo.getSignals().map((signal) => signal.signal.id)).toEqual(['top-2']);
    expect(repo.getActorColumns().map((actor) => actor.key)).toEqual([actorKey({ id: 'host', label: 'Host' })]);
  });

  it('freezes the display while paused, clears, and exports JSONL metadata', () => {
    const repo = new ActorFlowRepository();

    repo.record({
      signal: {
        protocol: 'actor-flow',
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
      navigationId: 'nav',
      frameUrl: 'https://example.com',
      frameOrigin: 'https://example.com',
    });

    expect(repo.getDisplaySignals().map((signal) => signal.signal.id)).toEqual(['kept-1']);

    repo.setPaused(true);
    repo.record({
      signal: {
        protocol: 'actor-flow',
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
    expect(lines[0]).toContain('"protocol":"actor-flow"');
    expect(lines[1]).toContain('"id":"kept-1"');
    repo.clear();
    expect(repo.getCount()).toBe(0);
  });

  it('formats timestamps with milliseconds', () => {
    expect(formatTimestamp(Date.parse('2026-09-05T12:34:56.789Z'))).toBe('2026-09-05T12:34:56.789Z');
  });
});
