import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type {
  CapturedSignalV1,
  CapturedStateMutationV1,
  JsonObject,
} from '@koshko/protocol';
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
  type KoshkoLogEntry,
  type KoshkoTimelineActor,
} from './repository';
import { BrandLockup, Icon } from './brand';

export interface PanelMessagePort {
  onMessage: {
    addListener(
      listener: (message: { type: string; kind?: string; captured?: unknown }) => void,
    ): void;
    removeListener?(
      listener: (message: { type: string; kind?: string; captured?: unknown }) => void,
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
  const [activeTab, setActiveTab] = useState<'timeline' | 'log' | 'state'>('timeline');
  const [connected, setConnected] = useState(true);
  const [paused, setPaused] = useState(repository.isPaused);
  const [unreadCount, setUnreadCount] = useState(repository.getUnreadCount());
  const [displaySignals, setDisplaySignals] = useState(
    repository.getDisplaySignals(),
  );
  const [displayState, setDisplayState] = useState<JsonObject>(
    repository.getDisplayState(),
  );
  const [displayLog, setDisplayLog] = useState<KoshkoLogEntry[]>(
    repository.getDisplayLog(),
  );
  const [logQuery, setLogQuery] = useState('');
  const [selectedActorKeys, setSelectedActorKeys] = useState<ReadonlySet<string>>(
    () => new Set(getLogActors(repository.getDisplayLog()).map((actor) => actor.key)),
  );
  const [selectedLogTypes, setSelectedLogTypes] = useState<ReadonlySet<LogEntryType>>(
    new Set(['signal']),
  );
  const [expandedSignalIds, setExpandedSignalIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const knownActorKeys = useRef(
    new Set(getLogActors(repository.getDisplayLog()).map((actor) => actor.key)),
  );

  useLayoutEffect(() => {
    const syncFromRepository = (): void => {
      setPaused(repository.isPaused);
      setUnreadCount(repository.getUnreadCount());
      const signals = repository.getDisplaySignals();
      setDisplaySignals(signals);
      const log = repository.getDisplayLog();
      setDisplayLog(log);
      setDisplayState(repository.getDisplayState());
      const discoveredActorKeys = getLogActors(log).map((actor) => actor.key);
      const newActorKeys = discoveredActorKeys.filter(
        (key) => !knownActorKeys.current.has(key),
      );
      if (newActorKeys.length > 0) {
        newActorKeys.forEach((key) => knownActorKeys.current.add(key));
        setSelectedActorKeys(
          (previous) => new Set([...previous, ...newActorKeys]),
        );
      }
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
    const onMessage = (message: { type: string; kind?: string; captured?: unknown }): void => {
      if (message.type !== PANEL_MESSAGE_CAPTURE || !message.captured) return;
      if (message.kind === 'signal') {
        repository.record(message.captured as CapturedSignalV1);
      } else if (message.kind === 'state-mutation') {
        repository.record(message.captured as CapturedStateMutationV1);
      } else {
        return;
      }
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
        <section className="card disconnected-state">
          <BrandLockup />
          <Icon className="state-icon" name="activity" />
          <h1>Connection lost</h1>
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
  const logActors = getLogActors(displayLog);
  const actorFilterActive = logActors.some(
    (actor) => !selectedActorKeys.has(actor.key),
  );
  const filteredLog = displayLog.filter((entry) => {
    const type = getLogEntryType(entry);
    if (!selectedLogTypes.has(type)) return false;
    if (logQuery && !JSON.stringify(entry).toLowerCase().includes(logQuery.toLowerCase())) {
      return false;
    }
    if (!actorFilterActive) return true;
    return isCapturedSignalEntry(entry) && matchesSelectedActor(entry, selectedActorKeys);
  });

  return (
    <main className="shell">
      <header className="toolbar card">
        <div className="toolbar-copy">
          <BrandLockup compact />
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
            <Icon name={paused ? 'play' : 'pause'} className="button-icon" />
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button data-testid="clear-button" onClick={clear}>
            <Icon name="trash" className="button-icon" />
            Clear
          </button>
          <button
            data-testid="export-button"
            onClick={() => downloadJsonl(repository.exportJsonl())}
          >
            <Icon name="download" className="button-icon" />
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
          <Icon name="clock" className="tab-icon" />
          Timeline
        </button>
        <button
          className={activeTab === 'log' ? 'tab active' : 'tab'}
          aria-pressed={activeTab === 'log'}
          onClick={() => setActiveTab('log')}
        >
          <Icon name="activity" className="tab-icon" />
          Log
        </button>
        <button
          className={activeTab === 'state' ? 'tab active' : 'tab'}
          aria-pressed={activeTab === 'state'}
          onClick={() => setActiveTab('state')}
        >
          <Icon name="graph" className="tab-icon" />
          Global State
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
        ) : activeTab === 'log' ? (
          <Log
            entries={filteredLog}
            capturedEntryCount={displayLog.length}
            query={logQuery}
            actors={logActors}
            selectedActorKeys={selectedActorKeys}
            selectedTypes={selectedLogTypes}
            onQueryChange={setLogQuery}
            onActorToggle={(key) => {
              setSelectedActorKeys((previous) => {
                const next = new Set(previous);
                next.has(key) ? next.delete(key) : next.add(key);
                return next;
              });
            }}
            onTypeToggle={(type) => {
              setSelectedLogTypes((previous) => {
                const next = new Set(previous);
                next.has(type) ? next.delete(type) : next.add(type);
                return next;
              });
            }}
          />
        ) : (
          <GlobalState state={displayState} />
        )}
      </section>
    </main>
  );
}

function GlobalState({ state }: { state: JsonObject }): ReactElement {
  return (
    <pre className="global-state" data-testid="global-state" aria-label="Global state">
      {JSON.stringify(state, null, 2)}
    </pre>
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
      <div className="empty empty-with-icon" data-testid="empty-state">
        <Icon name="timeline" className="state-icon" />
        <p>No signals yet.</p>
        <span>Signals from this tab will appear here.</span>
      </div>
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

type LogEntryType = 'signal' | 'state';

function Log({
  entries,
  capturedEntryCount,
  query,
  actors,
  selectedActorKeys,
  selectedTypes,
  onQueryChange,
  onActorToggle,
  onTypeToggle,
}: {
  entries: KoshkoLogEntry[];
  capturedEntryCount: number;
  query: string;
  actors: KoshkoTimelineActor[];
  selectedActorKeys: ReadonlySet<string>;
  selectedTypes: ReadonlySet<LogEntryType>;
  onQueryChange: (query: string) => void;
  onActorToggle: (key: string) => void;
  onTypeToggle: (type: LogEntryType) => void;
}): ReactElement {
  const emptyMessage = capturedEntryCount === 0
    ? ['No log entries yet.', 'Captured signals and state mutations will appear here.']
    : ['No log entries match the current filters.', 'Adjust the search or filters to show captured entries.'];

  return (
    <div className="log" data-testid="log">
      <div className="log-filters" aria-label="Log filters">
        <label className="field log-search">
          Search log
          <input
            aria-label="Search log"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search captured data"
          />
        </label>
        <fieldset className="log-filter-group">
          <legend>Entry type</legend>
          <label><input type="checkbox" checked={selectedTypes.has('signal')} onChange={() => onTypeToggle('signal')} /> Signal</label>
          <label><input type="checkbox" checked={selectedTypes.has('state')} onChange={() => onTypeToggle('state')} /> State</label>
        </fieldset>
        <fieldset className="log-filter-group">
          <legend>Actors</legend>
          {actors.length === 0 ? <span className="muted">No signal actors captured.</span> : actors.map((actor) => (
            <label key={actor.key}>
              <input
                type="checkbox"
                checked={selectedActorKeys.has(actor.key)}
                onChange={() => onActorToggle(actor.key)}
              />
              {formatActor(actor.reference)}
            </label>
          ))}
        </fieldset>
      </div>
      {entries.length === 0 ? (
        <div className="empty empty-with-icon" data-testid="log-empty-state">
          <Icon name="activity" className="state-icon" />
          <p>{emptyMessage[0]}</p>
          <span>{emptyMessage[1]}</span>
        </div>
      ) : entries.map((entry, index) => {
        const isSignal = isCapturedSignalEntry(entry);
        const metadata = isSignal ? entry.signal : entry.mutation;
        const type = isSignal ? 'Signal' : 'State';
        return (
        <details
          className="log-item"
          open={index === entries.length - 1}
          data-log-entry-type={type.toLowerCase()}
          data-signal-name={isSignal ? entry.signal.name : undefined}
          key={`${type}-${metadata.id}`}
        >
          <summary>
            <span className="log-summary-title"><span className={`log-entry-kind ${type.toLowerCase()}`}>{type}</span> {isSignal ? entry.signal.name : 'state mutation'}</span>
            <span className="muted">
              {formatDateTime(metadata.occurredAt)}
            </span>
          </summary>
          <pre>{JSON.stringify(entry, null, 2)}</pre>
        </details>
        );
      })}
    </div>
  );
}

function getLogActors(entries: KoshkoLogEntry[]): KoshkoTimelineActor[] {
  const actors: KoshkoTimelineActor[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isCapturedSignalEntry(entry)) continue;
    for (const reference of [entry.signal.source, entry.signal.target]) {
      if (!reference) continue;
      const key = actorKey(reference);
      if (seen.has(key)) continue;
      seen.add(key);
      actors.push({ key, reference });
    }
  }
  return actors;
}

function matchesSelectedActor(entry: CapturedSignalV1, selectedActorKeys: ReadonlySet<string>): boolean {
  return selectedActorKeys.has(actorKey(entry.signal.source))
    || (entry.signal.target !== undefined && selectedActorKeys.has(actorKey(entry.signal.target)));
}

function getLogEntryType(entry: KoshkoLogEntry): LogEntryType {
  return isCapturedSignalEntry(entry) ? 'signal' : 'state';
}

function isCapturedSignalEntry(entry: KoshkoLogEntry): entry is CapturedSignalV1 {
  return 'signal' in entry;
}
