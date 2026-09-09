import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  getStraightPath,
  type EdgeProps,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CapturedSignalV1 } from '@koshko/protocol';
import { Icon } from './brand';
import { formatActor, type KoshkoTimelineActor } from '../state/repository';
import {
  TIMELINE_LANE_WIDTH,
  createTimelineLayout,
  sourcePosition,
  targetPosition,
  type TimelineDetailNodeData,
  type TimelineEdge,
  type TimelineEventNodeData,
  type TimelineNode,
  type TimelineTargetNodeData,
} from './timeline-layout';

export interface TimelineProps {
  signals: CapturedSignalV1[];
  actors: KoshkoTimelineActor[];
  expandedSignalIds: ReadonlySet<string>;
  toggleDetails: (signalId: string) => void;
}

const EventNode = memo(function EventNode({ data }: NodeProps<TimelineNode>): ReactElement {
  const event = data as TimelineEventNodeData;
  return (
    <>
      {event.direction !== 'internal' ? (
        <Handle
          className="timeline-flow-handle"
          id={event.direction}
          type="source"
          position={sourcePosition(event.direction)}
          isConnectable={false}
        />
      ) : null}
      <button
        className="timeline-event-control nodrag nopan"
        type="button"
        data-signal-name={event.name}
        data-direction={event.direction}
        aria-expanded={event.expanded}
        aria-controls={`timeline-details-${event.signalId}`}
        title={event.directionLabel}
        onClick={() => event.toggleDetails(event.signalId)}
      >
        <span className="timeline-event-dot" aria-hidden="true" />
        <span>{event.name}</span>
      </button>
    </>
  );
});

const TargetNode = memo(function TargetNode({ data }: NodeProps<TimelineNode>): ReactElement {
  const target = data as TimelineTargetNodeData;
  return (
    <Handle
      className="timeline-flow-target-handle"
      id={target.direction}
      type="target"
      position={targetPosition(target.direction)}
      isConnectable={false}
      aria-label={target.label}
    />
  );
});

const DetailNode = memo(function DetailNode({ data }: NodeProps<TimelineNode>): ReactElement {
  const detail = data as TimelineDetailNodeData;
  return (
    <section
      className="timeline-details nodrag nopan"
      id={`timeline-details-${detail.signalId}`}
      data-testid="timeline-details"
    >
      <pre>{detail.json}</pre>
    </section>
  );
});

const SignalEdge = memo(function SignalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
}: EdgeProps<TimelineEdge>): ReactElement {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
});

const nodeTypes = {
  timelineEvent: EventNode,
  timelineTarget: TargetNode,
  timelineDetail: DetailNode,
};

const edgeTypes = { timelineSignal: SignalEdge };

export function Timeline(props: TimelineProps): ReactElement {
  if (props.signals.length === 0) {
    return (
      <div className="empty empty-with-icon" data-testid="empty-state">
        <Icon name="timeline" className="state-icon" />
        <p>No signals yet.</p>
        <span>Signals from this tab will appear here.</span>
      </div>
    );
  }
  return <ReactFlowProvider><TimelineCanvas {...props} /></ReactFlowProvider>;
}

function TimelineCanvas({
  signals,
  actors,
  expandedSignalIds,
  toggleDetails,
}: TimelineProps): ReactElement {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const layout = useMemo(() => createTimelineLayout({
    signals,
    actors,
    expandedSignalIds,
    selectedSignalId,
    toggleDetails,
  }), [actors, expandedSignalIds, selectedSignalId, signals, toggleDetails]);
  const onNodeClick = useCallback<NodeMouseHandler<TimelineNode>>((_event, node) => {
    if (node.type === 'timelineEvent') {
      setSelectedSignalId((node.data as TimelineEventNodeData).signalId);
    }
  }, []);

  return (
    <div className="timeline" data-testid="timeline">
      <div className="timeline-headers">
        <div className="timeline-stamp muted">Time · Source</div>
        <div className="timeline-header-viewport">
          <div
            className="timeline-header-track"
            style={{
              width: layout.width,
              transform: `translateX(${viewport.x}px)`,
            }}
          >
            {actors.map((actor, index) => (
              <ActorHeader key={actor.key} actor={actor} index={index} />
            ))}
          </div>
        </div>
      </div>
      <div className="timeline-body">
        <div className="timeline-time-viewport">
          <div style={{ transform: `translateY(${viewport.y}px)` }}>
            {layout.timestamps.map((timestamp) => (
              <div
                className="timeline-time-entry"
                data-testid="timeline-time-entry"
                key={timestamp.signalId}
                title={timestamp.title}
                style={{ top: timestamp.top }}
              >
                <strong data-testid="timeline-time">{timestamp.time}</strong>
                <span className="muted">{timestamp.source}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="timeline-flow" data-testid="timeline-flow">
          <div
            className="timeline-separators"
            data-testid="timeline-separators"
            style={{
              width: layout.width,
              transform: `translate(${viewport.x}px, ${viewport.y}px)`,
            }}
          >
            {layout.separators.map((separator) => (
              <div
                className="timeline-separator"
                data-testid="timeline-separator"
                key={separator.signalId}
                style={{ top: separator.top }}
              />
            ))}
          </div>
          <ReactFlow<TimelineNode, TimelineEdge>
            nodes={layout.nodes}
            edges={layout.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={1}
            maxZoom={1}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            panOnDrag
            preventScrolling
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            elementsSelectable
            deleteKeyCode={null}
            onlyRenderVisibleElements
            translateExtent={[
              [-80, -80],
              [layout.width + 160, layout.height + 160],
            ]}
            onViewportChange={setViewport}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedSignalId(null)}
            proOptions={{ hideAttribution: true }}
            ariaLabelConfig={{
              'node.a11yDescription.default': 'Press Enter or Space to select this timeline event.',
              'edge.a11yDescription.default': 'Press Enter or Space to select this signal direction.',
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={TIMELINE_LANE_WIDTH / 2}
              size={1}
              color="var(--noir-line)"
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

function ActorHeader({
  actor,
  index,
}: {
  actor: KoshkoTimelineActor;
  index: number;
}): ReactElement {
  const { reference } = actor;
  const instanceLabel = reference.instanceLabel ?? reference.instanceId;
  return (
    <div
      className="timeline-header"
      data-actor-key={actor.key}
      title={formatActor(reference)}
      style={{ left: index * TIMELINE_LANE_WIDTH, width: TIMELINE_LANE_WIDTH }}
    >
      <span className="timeline-actor-label">{reference.label ?? reference.id}</span>
      {instanceLabel ? (
        <span className="timeline-instance-badge" data-testid="actor-instance-badge">
          {instanceLabel}
        </span>
      ) : null}
    </div>
  );
}
