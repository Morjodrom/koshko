import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type { CapturedSignalV1 } from '@koshko/protocol';
import {
  PANEL_MESSAGE_CAPTURE,
  PANEL_MESSAGE_CLEAR,
  PANEL_MESSAGE_SET_PAUSED,
} from './shared';
import {
  KoshkoRepository,
  actorKey,
  formatActor,
  formatDateTime,
  formatTime,
  type KoshkoTimelineActor,
} from './repository';

export interface PanelMessagePort {
  onMessage: {
    addListener(
      listener: (message: { type: string; captured?: unknown }) => void,
    ): void;
    removeListener?(
      listener: (message: { type: string; captured?: unknown }) => void,
    ): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener?(listener: () => void): void;
  };
  postMessage(message: unknown): void | Promise<void>;
}

export interface PanelAppProps {
  repository: KoshkoRepository;
  port: PanelMessagePort;
  tabId: number;
  downloadJsonl: (jsonl: string) => void;
}

export function PanelApp({
  repository,
  port,
  tabId,
  downloadJsonl,
}: PanelAppProps): ReactElement {
  const [activeTab, setActiveTab] = useState<'timeline' | 'log'>('timeline');
  const [connected, setConnected] = useState(true);
  const [paused, setPaused] = useState(repository.isPaused);
  const [unreadCount, setUnreadCount] = useState(repository.getUnreadCount());
  const [displaySignals, setDisplaySignals] = useState(
    repository.getDisplaySignals(),
  );
  const [expandedSignalIds, setExpandedSignalIds] = useState<
    ReadonlySet<string>
  >(new Set());

  useLayoutEffect(() => {
    const syncFromRepository = (): void => {
      setPaused(repository.isPaused);
      setUnreadCount(repository.getUnreadCount());
      const signals = repository.getDisplaySignals();
      setDisplaySignals(signals);
      const displayedIds = new Set(
        signals.map((captured) => captured.signal.id),
      );
      setExpandedSignalIds(
        (previous) =>
          new Set(
            [...previous].filter((signalId) => displayedIds.has(signalId)),
          ),
      );
    };
    const onMessage = (message: { type: string; captured?: unknown }): void => {
      if (message.type !== PANEL_MESSAGE_CAPTURE || !message.captured) return;
      repository.record(message.captured as CapturedSignalV1);
      syncFromRepository();
    };
    const onDisconnect = (): void => setConnected(false);
    const unsubscribe = repository.subscribe(syncFromRepository);
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    return () => {
      unsubscribe();
      port.onMessage.removeListener?.(onMessage);
      port.onDisconnect.removeListener?.(onDisconnect);
    };
  }, [port, repository]);

  if (!connected) {
    return (
      <main className="shell" data-testid="disconnected-panel">
        <section className="card">
          <h1>Koshko</h1>
          <p className="muted">
            The background connection closed. Reopen DevTools or reload the
            page.
          </p>
        </section>
      </main>
    );
  }

  const togglePaused = (): void => {
    repository.setPaused(!repository.isPaused);
    void port.postMessage({
      type: PANEL_MESSAGE_SET_PAUSED,
      paused: repository.isPaused,
    });
  };
  const clear = (): void => {
    setExpandedSignalIds(new Set());
    repository.clear();
    void port.postMessage({ type: PANEL_MESSAGE_CLEAR });
  };
  const toggleDetails = (signalId: string): void => {
    setExpandedSignalIds((previous) => {
      const next = new Set(previous);
      next.has(signalId) ? next.delete(signalId) : next.add(signalId);
      return next;
    });
  };
  const actors = repository.getActorColumns();
  const signals = displaySignals;

  return (
    <main className="shell">
      <header className="toolbar card">
        <div>
          <p className="eyebrow">Koshko Dev Tools</p>
          <h1>Tab {tabId}</h1>
          <p className="muted" data-testid="capture-status">
            {signals.length} event{signals.length === 1 ? '' : 's'} captured
            {paused ? ` · paused · +${unreadCount} unread` : ''}
          </p>
        </div>
        <div className="actions">
          <button
            className="ghost"
            data-testid="pause-button"
            onClick={togglePaused}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button data-testid="clear-button" onClick={clear}>
            Clear
          </button>
          <button
            data-testid="export-button"
            onClick={() => downloadJsonl(repository.exportJsonl())}
          >
            Export JSONL
          </button>
        </div>
      </header>
      <nav className="tabs card">
        <button
          className={activeTab === 'timeline' ? 'tab active' : 'tab'}
          aria-pressed={activeTab === 'timeline'}
          onClick={() => setActiveTab('timeline')}
        >
          Timeline
        </button>
        <button
          className={activeTab === 'log' ? 'tab active' : 'tab'}
          aria-pressed={activeTab === 'log'}
          onClick={() => setActiveTab('log')}
        >
          Log
        </button>
      </nav>
      <section className="card" data-testid="panel-body">
        {activeTab === 'timeline' ? (
          <Timeline
            signals={signals}
            actors={actors}
            expandedSignalIds={expandedSignalIds}
            toggleDetails={toggleDetails}
          />
        ) : (
          <Log signals={signals} />
        )}
      </section>
    </main>
  );
}

function Timeline({
  signals,
  actors,
  expandedSignalIds,
  toggleDetails,
}: {
  signals: CapturedSignalV1[];
  actors: KoshkoTimelineActor[];
  expandedSignalIds: ReadonlySet<string>;
  toggleDetails: (signalId: string) => void;
}): ReactElement {
  if (signals.length === 0)
    return (
      <p className="empty" data-testid="empty-state">
        No signals yet.
      </p>
    );
  return (
    <div
      className="timeline"
      data-testid="timeline"
      style={
        {
          '--timeline-actor-count': String(actors.length),
        } as CSSProperties
      }
    >
      <div className="timeline-headers">
        <div className="timeline-stamp muted">Time · Source</div>
        <div className="timeline-grid">
          {actors.map((actor) => (
            <ActorHeader key={actor.key} actor={actor} />
          ))}
        </div>
      </div>
      <div className="timeline-rows">
        {signals.map((signal) => (
          <TimelineRow
            key={signal.signal.id}
            captured={signal}
            actors={actors}
            expanded={expandedSignalIds.has(signal.signal.id)}
            toggleDetails={toggleDetails}
          />
        ))}
      </div>
    </div>
  );
}

function ActorHeader({ actor }: { actor: KoshkoTimelineActor }): ReactElement {
  const { reference } = actor;
  const instanceLabel = reference.instanceLabel ?? reference.instanceId;
  return (
    <div
      className="timeline-header"
      data-actor-key={actor.key}
      title={formatActor(reference)}
    >
      <span className="timeline-actor-label">
        {reference.label ?? reference.id}
      </span>
      {instanceLabel ? (
        <span
          className="timeline-instance-badge"
          data-testid="actor-instance-badge"
        >
          {instanceLabel}
        </span>
      ) : null}
    </div>
  );
}

function TimelineRow({
  captured,
  actors,
  expanded,
  toggleDetails,
}: {
  captured: CapturedSignalV1;
  actors: KoshkoTimelineActor[];
  expanded: boolean;
  toggleDetails: (signalId: string) => void;
}): ReactElement {
  const { signal } = captured;
  const sourceKey = actorKey(signal.source);
  const targetKey = signal.target ? actorKey(signal.target) : null;
  const sourceIndex = actors.findIndex((actor) => actor.key === sourceKey);
  const targetIndex =
    targetKey === null
      ? -1
      : actors.findIndex((actor) => actor.key === targetKey);
  const hasArrow =
    targetKey !== null &&
    targetKey !== sourceKey &&
    sourceIndex >= 0 &&
    targetIndex >= 0;
  const direction =
    hasArrow && targetIndex > sourceIndex ? 'forward' : 'reverse';
  const occurredAtIso = new Date(signal.occurredAt).toISOString();
  const sourcePosition = ((sourceIndex + 0.5) / actors.length) * 100;
  const targetPosition = hasArrow
    ? ((targetIndex + 0.5) / actors.length) * 100
    : sourcePosition;
  const style = {
    '--timeline-source-index': String(sourceIndex),
    '--timeline-target-index': hasArrow ? String(targetIndex) : undefined,
    '--timeline-actor-count': String(actors.length),
  } as CSSProperties;
  const directionLabel =
    hasArrow && signal.target
      ? `${formatActor(signal.source)} sends ${signal.name} to ${formatActor(signal.target)}`
      : `${formatActor(signal.source)} records internal event ${signal.name}`;
  const severity = signal.severity ?? 'info';

  return (
    <article
      className={`timeline-row ${hasArrow ? 'directed' : 'internal'} severity-${severity}`}
      data-signal-name={signal.name}
      data-direction={hasArrow ? direction : 'internal'}
      data-source-actor-key={sourceKey}
      data-target-actor-key={hasArrow ? (targetKey ?? undefined) : undefined}
      data-source-index={sourceIndex}
      data-target-index={hasArrow ? targetIndex : undefined}
      data-actor-count={actors.length}
      data-severity={severity}
      style={style}
    >
      <div
        className="timeline-stamp"
        title={`${occurredAtIso} (${signal.occurredAt})`}
      >
        <strong data-testid="timeline-time">
          {formatTime(signal.occurredAt)}
        </strong>
        <span className="muted">{signal.source.label ?? signal.source.id}</span>
      </div>
      <div className="timeline-grid">
        {actors.map((actor) => {
          const isSource = actor.key === sourceKey;
          const isTarget = hasArrow && actor.key === targetKey;
          return (
            <div
              key={actor.key}
              className={`timeline-cell${isSource ? ' source' : ''}${isTarget ? ' target' : ''}`}
              data-actor-key={actor.key}
            >
              {isSource ? (
                <button
                  className={`timeline-event-control severity-${severity}`}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`timeline-details-${signal.id}`}
                  onClick={() => toggleDetails(signal.id)}
                >
                  {signal.name}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {hasArrow ? (
        <div
          className={`timeline-arrow ${direction}`}
          role="img"
          aria-label={directionLabel}
          data-testid="timeline-arrow"
          data-source-actor-key={sourceKey}
          data-target-actor-key={targetKey ?? undefined}
          data-source-index={sourceIndex}
          data-target-index={targetIndex}
          style={
            {
              ...style,
              '--timeline-arrow-start': `${Math.min(sourcePosition, targetPosition)}%`,
              '--timeline-arrow-width': `${Math.abs(targetPosition - sourcePosition)}%`,
            } as CSSProperties
          }
        />
      ) : null}
      {expanded ? (
        <section
          className="timeline-details"
          id={`timeline-details-${signal.id}`}
          data-testid="timeline-details"
        >
          <pre>{JSON.stringify(captured, null, 2)}</pre>
        </section>
      ) : null}
    </article>
  );
}

function Log({ signals }: { signals: CapturedSignalV1[] }): ReactElement {
  if (signals.length === 0)
    return (
      <p className="empty" data-testid="empty-state">
        No signals yet.
      </p>
    );
  return (
    <div className="log" data-testid="log">
      {signals.map((signal, index) => (
        <details
          className="log-item"
          open={index === signals.length - 1}
          data-signal-name={signal.signal.name}
          key={signal.signal.id}
        >
          <summary>
            <span className="log-summary-title">{signal.signal.name}</span>
            <span className="muted">
              {formatDateTime(signal.signal.occurredAt)}
            </span>
          </summary>
          <pre>{JSON.stringify(signal, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}
