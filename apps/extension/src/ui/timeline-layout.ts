import {
  MarkerType,
  Position,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { CapturedSignalV1 } from '@koshko/protocol';
import {
  actorKey,
  formatActor,
  formatTime,
  type KoshkoTimelineActor,
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
  signalId: string;
  name: string;
  severity: TimelineSeverity;
  expanded: boolean;
  direction: 'forward' | 'reverse' | 'internal';
  directionLabel: string;
  toggleDetails: (signalId: string) => void;
}

export interface TimelineTargetNodeData extends Record<string, unknown> {
  kind: 'target';
  direction: 'forward' | 'reverse';
  label: string;
}

export interface TimelineDetailNodeData extends Record<string, unknown> {
  kind: 'detail';
  signalId: string;
  json: string;
}

export type TimelineNode =
  | Node<TimelineEventNodeData, 'timelineEvent'>
  | Node<TimelineTargetNodeData, 'timelineTarget'>
  | Node<TimelineDetailNodeData, 'timelineDetail'>;

export interface TimelineEdgeData extends Record<string, unknown> {
  signalId: string;
  severity: TimelineSeverity;
  directionLabel: string;
}

export type TimelineEdge = Edge<TimelineEdgeData, 'timelineSignal'>;

export interface TimelineTimestamp {
  signalId: string;
  top: number;
  time: string;
  source: string;
  title: string;
}

export interface TimelineSeparator {
  signalId: string;
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
  signals: CapturedSignalV1[];
  actors: KoshkoTimelineActor[];
  expandedSignalIds: ReadonlySet<string>;
  selectedSignalId: string | null;
  toggleDetails: (signalId: string) => void;
}

export function createTimelineLayout({
  signals,
  actors,
  expandedSignalIds,
  selectedSignalId,
  toggleDetails,
}: CreateTimelineLayoutOptions): TimelineLayout {
  const actorIndexes = new Map(actors.map((actor, index) => [actor.key, index]));
  const nodes: TimelineNode[] = [];
  const edges: TimelineEdge[] = [];
  const timestamps: TimelineTimestamp[] = [];
  const separators: TimelineSeparator[] = [];
  const width = Math.max(actors.length * TIMELINE_LANE_WIDTH, TIMELINE_LANE_WIDTH);
  let rowTop = CANVAS_PADDING;

  for (const [signalIndex, captured] of signals.entries()) {
    const { signal } = captured;
    const sourceKey = actorKey(signal.source);
    const targetKey = signal.target ? actorKey(signal.target) : null;
    const sourceIndex = actorIndexes.get(sourceKey);
    const targetIndex = targetKey === null ? undefined : actorIndexes.get(targetKey);
    if (sourceIndex === undefined) continue;

    const hasArrow = targetKey !== sourceKey && targetIndex !== undefined;
    const direction = hasArrow
      ? targetIndex > sourceIndex ? 'forward' : 'reverse'
      : 'internal';
    const directionLabel = hasArrow && signal.target
      ? `${formatActor(signal.source)} sends ${signal.name} to ${formatActor(signal.target)}`
      : `${formatActor(signal.source)} records internal event ${signal.name}`;
    const severity = signal.severity ?? 'info';
    const eventId = `event:${signal.id}`;
    const selected = selectedSignalId === signal.id;

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
      className: `timeline-flow-event severity-${severity}`,
      data: {
        kind: 'event',
        signalId: signal.id,
        name: signal.name,
        severity,
        expanded: expandedSignalIds.has(signal.id),
        direction,
        directionLabel,
        toggleDetails,
      },
    });

    if (hasArrow && targetIndex !== undefined) {
      const edgeDirection = direction === 'reverse' ? 'reverse' : 'forward';
      const targetId = `target:${signal.id}`;
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
        id: `edge:${signal.id}`,
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
        data: { signalId: signal.id, severity, directionLabel },
      });
    }

    const occurredAtIso = new Date(signal.occurredAt).toISOString();
    timestamps.push({
      signalId: signal.id,
      top: rowTop + ROW_PADDING_TOP,
      time: formatTime(signal.occurredAt),
      source: signal.source.label ?? signal.source.id,
      title: `${occurredAtIso} (${signal.occurredAt})`,
    });

    rowTop += TIMELINE_ROW_HEIGHT;
    if (expandedSignalIds.has(signal.id)) {
      nodes.push({
        id: `detail:${signal.id}`,
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
          signalId: signal.id,
          json: JSON.stringify(captured, null, 2),
        },
      });
      rowTop += TIMELINE_DETAIL_HEIGHT + DETAIL_GAP;
    }
    if (signalIndex < signals.length - 1) {
      separators.push({ signalId: signal.id, top: rowTop });
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
