import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  CapturedSignalV1,
  JsonObject,
} from '@koshko/protocol';
import type { PanelCaptureMessage } from './shared';
import {
  KoshkoRepository,
  actorKey,
  formatActor,
  formatDateTime,
  getActorColumns,
  isCapturedSignal,
  type KoshkoLogEntry,
  type KoshkoStateSnapshot,
  type KoshkoTimelineActor,
} from './repository';
import type {
  InspectedSite,
  PanelAccessController,
  PanelAccessSnapshot,
} from './panel-access';
import { BrandLockup, Icon } from './brand';
import { GlobalStateViewer } from './global-state-viewer';
import type { ManagedPanelConnection, PanelConnectionStatus } from './panel-connection';
import { Timeline } from './timeline';

export interface PanelAppProps {
  repository: KoshkoRepository;
  connection: ManagedPanelConnection;
  tabId: number;
  accessController: PanelAccessController;
  downloadJsonl: (jsonl: string) => void;
}

type AccessState =
  | { status: 'checking' }
  | { status: 'unsupported'; message: string }
  | { status: 'missing'; site: InspectedSite; message?: string }
  | { status: 'granting'; site: InspectedSite }
  | { status: 'activating'; site: InspectedSite }
  | { status: 'active'; site: InspectedSite; justGranted: boolean }
  | { status: 'activation-error'; site: InspectedSite; message: string };

export function PanelApp({
  repository,
  connection,
  tabId,
  accessController,
  downloadJsonl,
}: PanelAppProps): ReactElement {
  const [activeTab, setActiveTab] = useState<'timeline' | 'log' | 'state'>('timeline');
  const [connectionStatus, setConnectionStatus] = useState<PanelConnectionStatus>(
    connection.status,
  );
  const [access, setAccess] = useState<AccessState>({ status: 'checking' });
  const [paused, setPaused] = useState(repository.isPaused);
  const [unreadCount, setUnreadCount] = useState(repository.getUnreadCount());
  const [displaySignals, setDisplaySignals] = useState(
    repository.getDisplaySignals(),
  );
  const [displayState, setDisplayState] = useState<JsonObject>(
    repository.getDisplayState(),
  );
  const [displayStateHistory, setDisplayStateHistory] = useState<KoshkoStateSnapshot[]>(
    repository.getDisplayStateHistory(),
  );
  const [selectedStateSnapshotIndex, setSelectedStateSnapshotIndex] = useState<number | null>(
    repository.getSelectedStateSnapshotIndex(),
  );
  const [displayLog, setDisplayLog] = useState<KoshkoLogEntry[]>(
    repository.getDisplayLog(),
  );
  const [logQuery, setLogQuery] = useState('');
  const [selectedActorKeys, setSelectedActorKeys] = useState<ReadonlySet<string>>(
    () => new Set(getActorColumns(repository.getDisplayLog()).map((actor) => actor.key)),
  );
  const [selectedLogTypes, setSelectedLogTypes] = useState<ReadonlySet<LogEntryType>>(
    new Set(['signal']),
  );
  const [expandedSignalIds, setExpandedSignalIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const knownActorKeys = useRef(
    new Set(getActorColumns(repository.getDisplayLog()).map((actor) => actor.key)),
  );
  const targetRevision = useRef(0);
  const grantInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const refresh = async (url?: string): Promise<void> => {
      const currentRevision = ++revision;
      const snapshot = await accessController.inspect(url);
      if (!mounted || currentRevision !== revision) {
        return;
      }
      setAccess(accessStateFromSnapshot(snapshot));
    };
    const activateNativeGrant = async (origins: string[]): Promise<void> => {
      const activationRevision = targetRevision.current;
      const snapshot = await accessController.inspect();
      if (!mounted || activationRevision !== targetRevision.current) {
        return;
      }
      if (!snapshot.supported || !snapshot.granted) {
        setAccess(accessStateFromSnapshot(snapshot));
        return;
      }
      if (!origins.includes(snapshot.site.matchPattern)) {
        setAccess(accessStateFromSnapshot(snapshot));
        return;
      }

      grantInFlight.current = true;
      setAccess({ status: 'activating', site: snapshot.site });
      const result = await accessController.activate(snapshot.site);
      if (!mounted || activationRevision !== targetRevision.current) {
        return;
      }
      grantInFlight.current = false;
      if (!result.granted || !result.captureStarted) {
        setAccess({
          status: 'activation-error',
          site: snapshot.site,
          message: result.message
            ?? 'Access was granted, but capture could not start in this page.',
        });
        return;
      }
      setAccess({ status: 'active', site: snapshot.site, justGranted: true });
    };
    const unsubscribe = accessController.subscribe((change) => {
      if (!mounted) {
        return;
      }
      if (change.kind === 'permission-added') {
        if (!grantInFlight.current) {
          setAccess({ status: 'checking' });
          void activateNativeGrant(change.origins);
        }
        return;
      }
      if (change.kind === 'navigation') {
        targetRevision.current += 1;
        grantInFlight.current = false;
        setAccess({ status: 'checking' });
        void refresh(change.url);
        return;
      }
      grantInFlight.current = false;
      setAccess({ status: 'checking' });
      void refresh();
    });
    void refresh();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [accessController]);

  useLayoutEffect(() => {
    const syncFromRepository = (): void => {
      setPaused(repository.isPaused);
      setUnreadCount(repository.getUnreadCount());
      const signals = repository.getDisplaySignals();
      setDisplaySignals(signals);
      const log = repository.getDisplayLog();
      setDisplayLog(log);
      setDisplayState(repository.getDisplayState());
      setDisplayStateHistory(repository.getDisplayStateHistory());
      setSelectedStateSnapshotIndex(repository.getSelectedStateSnapshotIndex());
      const discoveredActorKeys = getActorColumns(log).map((actor) => actor.key);
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
    const onMessage = (message: PanelCaptureMessage): void => {
      repository.record(message.captured);
    };
    const unsubscribe = repository.subscribe(syncFromRepository);
    const unsubscribeMessages = connection.subscribe(onMessage);
    const unsubscribeStatus = connection.subscribeStatus(setConnectionStatus);

    return () => {
      unsubscribe();
      unsubscribeMessages();
      unsubscribeStatus();
    };
  }, [connection, repository]);

  const togglePaused = (): void => {
    repository.setPaused(!repository.isPaused);
  };
  const grantAccess = (site: InspectedSite): void => {
    const grantRevision = targetRevision.current;
    grantInFlight.current = true;
    setAccess({ status: 'granting', site });
    void accessController.grant(site).then((result) => {
      if (grantRevision !== targetRevision.current) {
        return;
      }
      grantInFlight.current = false;
      if (!result.granted) {
        setAccess({ status: 'missing', site, message: result.message });
        return;
      }
      if (!result.captureStarted) {
        setAccess({
          status: 'activation-error',
          site,
          message: result.message
            ?? 'Access was granted, but capture could not start in this page.',
        });
        return;
      }
      setAccess({ status: 'active', site, justGranted: true });
    });
  };
  const clear = (): void => {
    setExpandedSignalIds(new Set());
    repository.clear();
  };
  const selectStateSnapshot = (index: number | null): void => {
    repository.selectStateSnapshot(index);
  };
  const toggleDetails = useCallback((signalId: string): void => {
    setExpandedSignalIds((previous) => {
      const next = new Set(previous);
      next.has(signalId) ? next.delete(signalId) : next.add(signalId);
      return next;
    });
  }, []);
  const signals = displaySignals;
  const actors = getActorColumns(signals);
  const logActors = getActorColumns(displayLog);
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
    return isCapturedSignal(entry) && matchesSelectedActor(entry, selectedActorKeys);
  });

  return (
    <main className="shell">
      {connectionStatus !== 'connected' ? (
        <section className="reconnecting-banner" role="status" data-testid="reconnecting-banner">
          Reconnecting to the background service. Signals may be missed while reconnecting.
        </section>
      ) : null}
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
      <AccessNotice
        access={access}
        onGrant={grantAccess}
        onReload={() => accessController.reload()}
      />
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
          <GlobalState
            state={displayState}
            history={displayStateHistory}
            selectedIndex={selectedStateSnapshotIndex}
            onSelect={selectStateSnapshot}
          />
        )}
      </section>
    </main>
  );
}

function accessStateFromSnapshot(snapshot: PanelAccessSnapshot): AccessState {
  if (!snapshot.supported) {
    return { status: 'unsupported', message: snapshot.message };
  }
  if (!snapshot.granted) {
    return { status: 'missing', site: snapshot.site };
  }
  return { status: 'active', site: snapshot.site, justGranted: false };
}

function AccessNotice({
  access,
  onGrant,
  onReload,
}: {
  access: AccessState;
  onGrant: (site: InspectedSite) => void;
  onReload: () => void;
}): ReactElement {
  if (access.status === 'checking') {
    return (
      <section className="access-notice card" data-testid="access-checking">
        <span className="access-indicator" aria-hidden="true" />
        <div><strong>Checking site access…</strong></div>
      </section>
    );
  }

  if (access.status === 'unsupported') {
    return (
      <section className="access-notice access-warning card" data-testid="access-unsupported">
        <Icon name="activity" className="state-icon" />
        <div>
          <strong>This page cannot be inspected</strong>
          <p className="muted">{access.message}</p>
        </div>
      </section>
    );
  }

  if (access.status === 'activating') {
    return (
      <section className="access-notice card" data-testid="access-activating">
        <span className="access-indicator" aria-hidden="true" />
        <div className="access-copy">
          <strong>Access granted. Starting capture…</strong>
          <p className="muted">Installing Koshko in the current page without reloading.</p>
        </div>
      </section>
    );
  }

  if (access.status === 'missing' || access.status === 'granting') {
    const site = access.site;
    return (
      <section className="access-notice access-required card" data-testid="access-required">
        <Icon name="activity" className="state-icon" />
        <div className="access-copy">
          <strong>Allow Koshko to read this site</strong>
          <p>
            Grant explicit access to <code>{site.origin}</code> and start
            capturing new Koshko events. Chrome grants this scheme and host on
            every port.
          </p>
          {access.status === 'missing' && access.message ? (
            <p className="access-error" role="alert">{access.message}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="primary"
          disabled={access.status === 'granting'}
          onClick={() => onGrant(site)}
        >
          <Icon name="plus" className="button-icon" />
          {access.status === 'granting'
            ? 'Granting access…'
            : 'Grant access and start capture'}
        </button>
      </section>
    );
  }

  if (access.status === 'activation-error') {
    return (
      <section className="access-notice access-warning card" data-testid="access-activation-error">
        <Icon name="activity" className="state-icon" />
        <div className="access-copy">
          <strong>Access granted; capture needs attention</strong>
          <p>{access.message}</p>
          <p className="muted">
            Koshko keeps access to {access.site.origin}. Reload to install
            capture at the next document start.
          </p>
        </div>
        <button type="button" onClick={onReload}>Reload target</button>
      </section>
    );
  }

  return (
    <section className="access-notice access-active card" data-testid="access-active">
      <span className="access-indicator" aria-hidden="true" />
      <div className="access-copy">
        <strong>Site access granted</strong>
        <p className="muted">
          Koshko can read new events from {access.site.origin}.
          {access.justGranted
            ? ' Events emitted before access was granted were missed.'
            : ''}
        </p>
      </div>
      {access.justGranted ? (
        <button type="button" className="ghost" onClick={onReload}>
          Reload target
        </button>
      ) : null}
    </section>
  );
}

function GlobalState({
  state,
  history,
  selectedIndex,
  onSelect,
}: {
  state: JsonObject;
  history: KoshkoStateSnapshot[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}): ReactElement {
  const latestIndex = history.at(-1)?.index ?? 0;
  const activeIndex = selectedIndex ?? latestIndex;
  const activePosition = history.findIndex((snapshot) => snapshot.index === activeIndex);
  const canSelectPrevious = activePosition > 0;
  const canSelectNext = activePosition >= 0 && activePosition < history.length - 1;

  return (
    <div className="state-inspector" data-testid="state-inspector">
      <div className="state-history" aria-label="Global state history">
        <div className="state-history-header">
          <div>
            <h2>State history</h2>
            <p className="muted" role="status" data-testid="state-position">
              {selectedIndex === null
                ? `Live · following snapshot ${activePosition + 1} of ${history.length}`
                : `Snapshot ${activePosition + 1} of ${history.length} · pinned`}
            </p>
          </div>
          <div className="state-history-controls" aria-label="State history controls">
            <button
              type="button"
              onClick={() => onSelect(history[activePosition - 1].index)}
              disabled={!canSelectPrevious}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => onSelect(history[activePosition + 1].index)}
              disabled={!canSelectNext}
            >
              Next
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onSelect(null)}
              disabled={selectedIndex === null}
            >
              Live
            </button>
          </div>
        </div>
        <ol className="state-history-list" data-testid="state-history-list">
          {history.map((snapshot) => {
            const isActive = snapshot.index === activeIndex;
            const mutation = snapshot.mutation?.mutation;
            const label = snapshot.index === 0
              ? 'Initial state'
              : mutation?.label ?? `State mutation ${snapshot.index}`;
            const metadata = mutation
              ? `${formatDateTime(mutation.occurredAt)} · ${mutation.producerId}`
              : 'Before captured mutations';

            return (
              <li key={snapshot.index}>
                <button
                  type="button"
                  className={isActive ? 'state-history-entry active' : 'state-history-entry'}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(snapshot.index)}
                >
                  <span className="state-history-entry-label">{label}</span>
                  <span className="state-history-entry-metadata">{metadata}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="state-value">
        <h2>Selected state</h2>
        <GlobalStateViewer state={state} />
      </div>
    </div>
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
        const isSignal = isCapturedSignal(entry);
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

function matchesSelectedActor(entry: CapturedSignalV1, selectedActorKeys: ReadonlySet<string>): boolean {
  return selectedActorKeys.has(actorKey(entry.signal.source))
    || (entry.signal.target !== undefined && selectedActorKeys.has(actorKey(entry.signal.target)));
}

function getLogEntryType(entry: KoshkoLogEntry): LogEntryType {
  return isCapturedSignal(entry) ? 'signal' : 'state';
}
