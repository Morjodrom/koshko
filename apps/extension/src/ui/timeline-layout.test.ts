import type { CapturedErrorV1, CapturedSignalV1 } from '@koshko/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { KoshkoTimelineActor, KoshkoTimelineEntry } from '../state/repository';
import {
  TIMELINE_DETAIL_HEIGHT,
  TIMELINE_LANE_WIDTH,
  TIMELINE_ROW_HEIGHT,
  createTimelineLayout,
} from './timeline-layout';

const actors: KoshkoTimelineActor[] = [
  { key: 'host::', reference: { id: 'host', label: 'Host' } },
  { key: 'widget::one', reference: { id: 'widget', label: 'Widget', instanceId: 'one' } },
  { key: 'worker::', reference: { id: 'worker', label: 'Worker' } },
];

function captured(
  id: string,
  source = actors[0].reference,
  target = actors[1].reference,
): CapturedSignalV1 {
  return {
    signal: {
      protocol: 'koshko',
      version: 1,
      id,
      producerId: 'producer',
      producerSequence: Number(id.replace(/\D/g, '')) || 1,
      occurredAt: Date.parse('2026-09-05T12:34:56.789Z'),
      source,
      target,
      name: `signal.${id}`,
    },
    observedAt: Date.parse('2026-09-05T12:34:56.790Z'),
    tabId: 17,
    frameId: 0,
    navigationId: 'navigation-1',
    frameUrl: 'https://example.test',
    frameOrigin: 'https://example.test',
  };
}

function layout(
  entries: KoshkoTimelineEntry[],
  expandedEntryIds: ReadonlySet<string> = new Set(),
) {
  return createTimelineLayout({
    entries,
    actors,
    expandedEntryIds,
    selectedEntryId: null,
    toggleDetails: vi.fn(),
  });
}

function capturedError(): CapturedErrorV1 {
  return {
    error: {
      protocol: 'koshko',
      version: 1,
      id: 'error-1',
      producerId: 'browser-console:frame-1',
      producerSequence: 1,
      occurredAt: Date.parse('2026-09-05T12:34:56.789Z'),
      source: { id: 'browser-console', label: 'Browser Console' },
      name: 'console.error',
      payload: { arguments: ['failed'] },
    },
    observedAt: Date.parse('2026-09-05T12:34:56.790Z'),
    tabId: 17,
    frameId: 0,
    navigationId: 'navigation-1',
    frameUrl: 'https://example.test',
    frameOrigin: 'https://example.test',
  };
}

describe('createTimelineLayout', () => {
  it('positions chronological events in actor lanes and creates directional edges', () => {
    const result = layout([
      captured('forward'),
      captured('reverse', actors[2].reference, actors[0].reference),
    ]);

    const forward = result.nodes.find((node) => node.id === 'event:forward')!;
    const reverse = result.nodes.find((node) => node.id === 'event:reverse')!;

    expect(forward.position.x).toBe(20);
    expect(forward.position.y).toBe(6);
    expect(reverse.position.x).toBe(TIMELINE_LANE_WIDTH * 2 + 20);
    expect(reverse.position.y - forward.position.y).toBe(TIMELINE_ROW_HEIGHT);
    expect(result.separators).toEqual([{ entryId: 'forward', top: 45 }]);
    expect(result.edges.map((edge) => ({
      id: edge.id,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.ariaLabel,
    }))).toEqual([
      {
        id: 'edge:forward',
        sourceHandle: 'forward',
        targetHandle: 'forward',
        label: 'Host sends signal.forward to Widget · one',
      },
      {
        id: 'edge:reverse',
        sourceHandle: 'reverse',
        targetHandle: 'reverse',
        label: 'Worker sends signal.reverse to Host',
      },
    ]);
  });

  it('does not create edges or target anchors for internal signals', () => {
    const targetless = captured('targetless');
    delete targetless.signal.target;
    const selfTargeted = captured('self', actors[1].reference, actors[1].reference);

    const result = layout([targetless, selfTargeted]);

    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((node) => node.data.kind === 'event')).toBe(true);
    expect(result.nodes.map((node) => node.data.direction)).toEqual(['internal', 'internal']);
  });

  it('renders errors as internal red entries in the Browser Console lane', () => {
    const browserConsole: KoshkoTimelineActor = {
      key: 'browser-console::',
      reference: { id: 'browser-console', label: 'Browser Console' },
    };
    const result = createTimelineLayout({
      entries: [capturedError()],
      actors: [...actors, browserConsole],
      expandedEntryIds: new Set(),
      selectedEntryId: null,
      toggleDetails: vi.fn(),
    });
    const node = result.nodes.find((candidate) => candidate.id === 'event:error-1')!;

    expect(node.position.x).toBe(TIMELINE_LANE_WIDTH * 3 + 20);
    expect(node.className).toContain('entry-error');
    expect(node.className).toContain('severity-error');
    expect(node.data).toMatchObject({
      entryType: 'error',
      direction: 'internal',
      name: 'console.error',
    });
    expect(result.edges).toHaveLength(0);
    expect(result.timestamps[0].source).toBe('Browser Console');
  });

  it('adds independent detail rows and offsets subsequent events', () => {
    const result = layout(
      [captured('1'), captured('2'), captured('3')],
      new Set(['1', '2']),
    );
    const first = result.nodes.find((node) => node.id === 'event:1')!;
    const second = result.nodes.find((node) => node.id === 'event:2')!;
    const third = result.nodes.find((node) => node.id === 'event:3')!;

    expect(result.nodes.filter((node) => node.type === 'timelineDetail')).toHaveLength(2);
    expect(second.position.y - first.position.y).toBe(
      TIMELINE_ROW_HEIGHT + TIMELINE_DETAIL_HEIGHT + 8,
    );
    expect(third.position.y - second.position.y).toBe(
      TIMELINE_ROW_HEIGHT + TIMELINE_DETAIL_HEIGHT + 8,
    );
    expect(result.separators).toEqual([
      { entryId: '1', top: 293 },
      { entryId: '2', top: 584 },
    ]);
  });

  it('keeps the graph linear for hundreds of signals', () => {
    const signals = Array.from({ length: 500 }, (_, index) => captured(
      String(index + 1),
      actors[index % actors.length].reference,
      actors[(index + 1) % actors.length].reference,
    ));

    const result = layout(signals);

    expect(result.nodes).toHaveLength(1_000);
    expect(result.edges).toHaveLength(500);
    expect(result.timestamps).toHaveLength(500);
    expect(result.separators).toHaveLength(499);
    expect(result.nodes.some((node) => node.className?.includes('timeline-cell'))).toBe(false);
  });
});
