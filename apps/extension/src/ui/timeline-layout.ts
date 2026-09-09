import {
  MarkerType,
  Position,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  actorKey,
  formatActor,
  formatTime,
  isCapturedError,
  isCapturedSignal,
  type KoshkoTimelineActor,
  type KoshkoTimelineEntry,
} from '../state/repository';

export const TIMELINE_LANE_WIDTH = 220;
export const TIMELINE_ROW_HEIGHT = 43;
export const TIMELINE_DETAIL_HEIGHT = 240;

const EVENT_WIDTH = 180;
const EVENT_HEIGHT = 34;
const ROW_PADDING_TOP = 4;
const DETAIL_GAP = 8;
const CANVAS_PADDING = 2;

export type TimelineSeverity = 'debug' | 'info' | 'success' | 'warning' | 'error';

export interface TimelineEventNodeData extends Record<string, unknown> {
  kind: 'event';
  entryId: string;
  entryType: 'signal' | 'error';
  name: string;
  severity: TimelineSeverity;
  expanded: boolean;
  direction: 'forward' | 'reverse' | 'internal';
  directionLabel: string;
  toggleDetails: (entryId: string) => void;
}

export interface TimelineTargetNodeData extends Record<string, unknown> {
  kind: 'target';
  direction: 'forward' | 'reverse';
  label: string;
}

export interface TimelineDetailNodeData extends Record<string, unknown> {
  kind: 'detail';
  entryId: string;
  json: string;
}

export type TimelineNode =
  | Node<TimelineEventNodeData, 'timelineEvent'>
  | Node<TimelineTargetNodeData, 'timelineTarget'>
  | Node<TimelineDetailNodeData, 'timelineDetail'>;

export interface TimelineEdgeData extends Record<string, unknown> {
  entryId: string;
  severity: TimelineSeverity;
  directionLabel: string;
}

export type TimelineEdge = Edge<TimelineEdgeData, 'timelineSignal'>;

export interface TimelineTimestamp {
  entryId: string;
  top: number;
  time: string;
  source: string;
  title: string;
}

export interface TimelineSeparator {
  entryId: string;
  top: number;
}

export interface TimelineLayout {
  nodes: TimelineNode[];
  edges: TimelineEdge[];
  timestamps: TimelineTimestamp[];
  separators: TimelineSeparator[];
  width: number;
  height: number;
}

interface CreateTimelineLayoutOptions {
  entries: KoshkoTimelineEntry[];
  actors: KoshkoTimelineActor[];
  expandedEntryIds: ReadonlySet<string>;
  selectedEntryId: string | null;
  toggleDetails: (entryId: string) => void;
}

export function createTimelineLayout({
  entries,
  actors,
  expandedEntryIds,
  selectedEntryId,
  toggleDetails,
}: CreateTimelineLayoutOptions): TimelineLayout {
  const actorIndexes = new Map(actors.map((actor, index) => [actor.key, index]));
  const nodes: TimelineNode[] = [];
  const edges: TimelineEdge[] = [];
  const timestamps: TimelineTimestamp[] = [];
  const separators: TimelineSeparator[] = [];
  const width = Math.max(actors.length * TIMELINE_LANE_WIDTH, TIMELINE_LANE_WIDTH);
  let rowTop = CANVAS_PADDING;

  for (const [entryIndex, captured] of entries.entries()) {
    const isSignal = isCapturedSignal(captured);
    const metadata = isSignal ? captured.signal : captured.error;
    const entryType = isSignal ? 'signal' : 'error';
    const target = isSignal ? captured.signal.target : undefined;
    const sourceKey = actorKey(metadata.source);
    const targetKey = target ? actorKey(target) : null;
    const sourceIndex = actorIndexes.get(sourceKey);
    const targetIndex = targetKey === null ? undefined : actorIndexes.get(targetKey);
    if (sourceIndex === undefined) continue;

    const hasArrow = targetKey !== sourceKey && targetIndex !== undefined;
    const direction = hasArrow
      ? targetIndex > sourceIndex ? 'forward' : 'reverse'
      : 'internal';
    const directionLabel = hasArrow && target
      ? `${formatActor(metadata.source)} sends ${metadata.name} to ${formatActor(target)}`
      : isCapturedError(captured)
        ? `${formatActor(metadata.source)} records error ${metadata.name}`
        : `${formatActor(metadata.source)} records internal event ${metadata.name}`;
    const severity = isCapturedError(captured) ? 'error' : captured.signal.severity ?? 'info';
    const eventId = `event:${metadata.id}`;
    const selected = selectedEntryId === metadata.id;

    nodes.push({
      id: eventId,
      type: 'timelineEvent',
      position: {
        x: sourceIndex * TIMELINE_LANE_WIDTH + (TIMELINE_LANE_WIDTH - EVENT_WIDTH) / 2,
        y: rowTop + ROW_PADDING_TOP,
      },
      width: EVENT_WIDTH,
      height: EVENT_HEIGHT,
      draggable: false,
      connectable: false,
      selectable: true,
      selected,
      ariaLabel: directionLabel,
      className: `timeline-flow-event entry-${entryType} severity-${severity}`,
      data: {
        kind: 'event',
        entryId: metadata.id,
        entryType,
        name: metadata.name,
        severity,
        expanded: expandedEntryIds.has(metadata.id),
        direction,
        directionLabel,
        toggleDetails,
      },
    });

    if (hasArrow && targetIndex !== undefined) {
      const edgeDirection = direction === 'reverse' ? 'reverse' : 'forward';
      const targetId = `target:${metadata.id}`;
      nodes.push({
        id: targetId,
        type: 'timelineTarget',
        position: {
          x: targetIndex * TIMELINE_LANE_WIDTH + TIMELINE_LANE_WIDTH / 2 - 5,
          y: rowTop + ROW_PADDING_TOP + EVENT_HEIGHT / 2 - 5,
        },
        width: 10,
        height: 10,
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
        ariaLabel: directionLabel,
        className: `timeline-flow-target severity-${severity}`,
        data: { kind: 'target', direction: edgeDirection, label: directionLabel },
      });
      edges.push({
        id: `edge:${metadata.id}`,
        type: 'timelineSignal',
        source: eventId,
        target: targetId,
        sourceHandle: direction,
        targetHandle: direction,
        selectable: true,
        focusable: true,
        ariaLabel: directionLabel,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: severityColor(severity),
        },
        className: selected ? 'timeline-flow-edge selected' : 'timeline-flow-edge',
        style: { stroke: severityColor(severity), strokeWidth: selected ? 3 : 2 },
        data: { entryId: metadata.id, severity, directionLabel },
      });
    }

    const occurredAtIso = new Date(metadata.occurredAt).toISOString();
    timestamps.push({
      entryId: metadata.id,
      top: rowTop + ROW_PADDING_TOP,
      time: formatTime(metadata.occurredAt),
      source: metadata.source.label ?? metadata.source.id,
      title: `${occurredAtIso} (${metadata.occurredAt})`,
    });

    rowTop += TIMELINE_ROW_HEIGHT;
    if (expandedEntryIds.has(metadata.id)) {
      nodes.push({
        id: `detail:${metadata.id}`,
        type: 'timelineDetail',
        position: { x: 8, y: rowTop - DETAIL_GAP },
        width: width - 16,
        height: TIMELINE_DETAIL_HEIGHT,
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
        className: 'timeline-flow-detail',
        data: {
          kind: 'detail',
          entryId: metadata.id,
          json: JSON.stringify(captured, null, 2),
        },
      });
      rowTop += TIMELINE_DETAIL_HEIGHT + DETAIL_GAP;
    }
    if (entryIndex < entries.length - 1) {
      separators.push({ entryId: metadata.id, top: rowTop });
    }
  }

  return {
    nodes,
    edges,
    timestamps,
    separators,
    width,
    height: Math.max(rowTop + CANVAS_PADDING, 180),
  };
}

export function severityColor(severity: TimelineSeverity): string {
  switch (severity) {
    case 'debug': return '#8b8174';
    case 'success': return '#278358';
    case 'warning': return '#b66a00';
    case 'error': return '#bd3a45';
    default: return '#a66718';
  }
}

export function sourcePosition(direction: TimelineEventNodeData['direction']): Position {
  return direction === 'reverse' ? Position.Left : Position.Right;
}

export function targetPosition(direction: TimelineTargetNodeData['direction']): Position {
  return direction === 'reverse' ? Position.Right : Position.Left;
}
