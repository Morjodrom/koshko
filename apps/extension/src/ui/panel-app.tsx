import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  JsonObject,
} from '@koshko/protocol';
import type { PanelCaptureMessage } from '../messaging/messages';
import {
  KoshkoRepository,
  actorKey,
  formatActor,
  formatDateTime,
  getErrorDisplayMessage,
  getActorColumns,
  getTimelineActors,
  isCapturedError,
  isCapturedPostMessage,
  isCapturedSignal,
  type KoshkoLogEntry,
  type KoshkoStateSnapshot,
  type KoshkoTimelineActor,
  type KoshkoTimelineEntry,
} from '../state/repository';
import type {
  InspectedSite,
  PanelAccessController,
  PanelAccessSnapshot,
} from '../browser/panel-access';
import {
  formatAiLog,
  type AiLogBudget,
  type AiLogResult,
} from '../ai-log';
import { BrandLockup, Icon } from './brand';
import { GlobalStateViewer } from './global-state-viewer';
import type { ManagedPanelConnection, PanelConnectionStatus } from '../messaging/panel-connection';
import { Timeline } from './timeline';
import { formatJsonForDisplay } from './json-display';
import {
  getStoredExtensionMessageRules,
  subscribeToStoredExtensionMessageRules,
} from '../extension-message-rules';

export interface PanelAppProps {
  repository: KoshkoRepository;
  connection: ManagedPanelConnection;
  tabId: number;
  accessController: PanelAccessController;
  downloadJsonl: (jsonl: string) => void;
  copyText: (text: string) => Promise<void>;
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
  copyText,
}: PanelAppProps): ReactElement {
  const [activeTab, setActiveTab] = useState<'timeline' | 'log' | 'state' | 'ai'>('timeline');
  const [connectionStatus, setConnectionStatus] = useState<PanelConnectionStatus>(
    connection.status,
  );
  const [access, setAccess] = useState<AccessState>({ status: 'checking' });
  const [paused, setPaused] = useState(repository.isPaused);
  const [unreadCount, setUnreadCount] = useState(repository.getUnreadCount());
  const [includeExtensionMessages, setIncludeExtensionMessages] = useState(
    repository.getIncludeExtensionMessages(),
  );
  const [hiddenExtensionMessageCount, setHiddenExtensionMessageCount] = useState(
    repository.getHiddenExtensionMessageCount(),
  );
  const [displayTimelineEntries, setDisplayTimelineEntries] = useState(
    repository.getDisplayTimelineEntries(),
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
  const [parseJsonStrings, setParseJsonStrings] = useState(false);
  const [selectedActorKeys, setSelectedActorKeys] = useState<ReadonlySet<string>>(
    () => new Set(getActorColumns(repository.getDisplayLog()).map((actor) => actor.key)),
  );
  const [selectedLogTypes, setSelectedLogTypes] = useState<ReadonlySet<LogEntryType>>(
    new Set(['signal', 'error', 'post-message']),
  );
  const [aiLogBudget, setAiLogBudget] = useState<AiLogBudget>('16k');
  const [expandedEntryIds, setExpandedEntryIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const knownActorKeys = useRef(
    new Set(getActorColumns(repository.getDisplayLog()).map((actor) => actor.key)),
  );
  const targetRevision = useRef(0);
  const grantInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return () => {
        mounted = false;
      };
    }
    void getStoredExtensionMessageRules().then((config) => {
      if (mounted) repository.setExtensionMessageRules(config.rules);
    });
    const unsubscribe = chrome.storage.onChanged
      ? subscribeToStoredExtensionMessageRules((config) => repository.setExtensionMessageRules(config.rules))
      : () => undefined;
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [repository]);

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
      setIncludeExtensionMessages(repository.getIncludeExtensionMessages());
      setHiddenExtensionMessageCount(repository.getHiddenExtensionMessageCount());
      const timelineEntries = repository.getDisplayTimelineEntries();
      setDisplayTimelineEntries(timelineEntries);
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
        timelineEntries.map(getTimelineEntryId),
      );
      setExpandedEntryIds(
        (previous) =>
          new Set(
            [...previous].filter((entryId) => displayedIds.has(entryId)),
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
  const toggleExtensionMessages = (): void => {
    repository.setIncludeExtensionMessages(!repository.getIncludeExtensionMessages());
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
    setExpandedEntryIds(new Set());
    repository.clear();
  };
  const selectStateSnapshot = (index: number | null): void => {
    repository.selectStateSnapshot(index);
  };
  const toggleDetails = useCallback((entryId: string): void => {
    setExpandedEntryIds((previous) => {
      const next = new Set(previous);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      return next;
    });
  }, []);
  const timelineEntries = displayTimelineEntries;
  const actors = getTimelineActors(timelineEntries);
  const logActors = getActorColumns(displayLog);
  const actorFilterActive = logActors.some(
    (actor) => !selectedActorKeys.has(actor.key),
  );
  const filteredLog = displayLog.filter((entry) => {
    const type = getLogEntryType(entry);
    if (!selectedLogTypes.has(type)) return false;
    if (logQuery && !getVisibleLogText(entry).toLowerCase().includes(logQuery.toLowerCase())) {
      return false;
    }
    if (!actorFilterActive) return true;
    return matchesSelectedActor(entry, selectedActorKeys);
  });
  const latestDisplayState = displayStateHistory.at(-1)?.state ?? displayState;
  const aiLog = useMemo(() => formatAiLog({
    entries: displayLog,
    state: latestDisplayState,
    budget: aiLogBudget,
  }), [aiLogBudget, displayLog, latestDisplayState]);

  return (
    <main className="shell">
      {connectionStatus !== 'connected' ? (
        <section className="reconnecting-banner" role="status" data-testid="reconnecting-banner">
          Reconnecting to the background service. Events may be missed while reconnecting.
        </section>
      ) : null}
      <header className="toolbar card">
        <div className="toolbar-copy">
          <BrandLockup compact />
          <h1>Tab {tabId}</h1>
          <p className="muted" data-testid="capture-status">
            {displayLog.length} entr{displayLog.length === 1 ? 'y' : 'ies'} shown
            {hiddenExtensionMessageCount > 0
              ? ` · ${hiddenExtensionMessageCount} extensions hidden`
              : ''}
            {paused ? ` · paused · +${unreadCount} unread` : ''}
          </p>
        </div>
        <div className="actions">
          <label className="toolbar-toggle">
            <input
              type="checkbox"
              aria-label="Parse JSON strings"
              checked={parseJsonStrings}
              onChange={(event) => setParseJsonStrings(event.target.checked)}
            />
            Parse JSON strings
          </label>
          <label className="toolbar-toggle">
            <input
              type="checkbox"
              aria-label="Extensions"
              checked={includeExtensionMessages}
              onChange={toggleExtensionMessages}
            />
            Extensions
          </label>
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
        <button
          className={activeTab === 'ai' ? 'tab active' : 'tab'}
          aria-pressed={activeTab === 'ai'}
          onClick={() => setActiveTab('ai')}
        >
          <Icon name="ai" className="tab-icon" />
          AI Log
        </button>
      </nav>
      <section className="card" data-testid="panel-body">
        {activeTab === 'timeline' ? (
          <Timeline
            entries={timelineEntries}
            actors={actors}
            expandedEntryIds={expandedEntryIds}
            toggleDetails={toggleDetails}
            parseJsonStrings={parseJsonStrings}
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
            parseJsonStrings={parseJsonStrings}
            onTypeToggle={(type) => {
              setSelectedLogTypes((previous) => {
                const next = new Set(previous);
                next.has(type) ? next.delete(type) : next.add(type);
                return next;
              });
            }}
          />
        ) : activeTab === 'state' ? (
          <GlobalState
            state={displayState}
            history={displayStateHistory}
            selectedIndex={selectedStateSnapshotIndex}
            onSelect={selectStateSnapshot}
          />
        ) : (
          <AiLog
            result={aiLog}
            budget={aiLogBudget}
            onBudgetChange={setAiLogBudget}
            copyText={copyText}
          />
        )}
      </section>
    </main>
  );
}

function AiLog({
  result,
  budget,
  onBudgetChange,
  copyText,
}: {
  result: AiLogResult;
  budget: AiLogBudget;
  onBudgetChange: (budget: AiLogBudget) => void;
  copyText: (text: string) => Promise<void>;
}): ReactElement {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');

  useEffect(() => {
    setCopyStatus('idle');
  }, [result.text]);

  const copy = async (): Promise<void> => {
    setCopyStatus('copying');
    try {
      await copyText(result.text);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  };
  const hasReducedContext = result.omittedEntryCount > 0
    || result.compactedValueCount > 0
    || result.stateStatus === 'focused'
    || result.stateStatus === 'omitted';

  return (
    <div className="ai-log" data-testid="ai-log">
      <div className="ai-log-header">
        <div className="ai-log-copy">
          <h2>Prompt-ready diagnostic trace</h2>
          <p className="muted">
            Structured for LLM analysis. Token estimates are conservative and model-dependent.
          </p>
        </div>
        <div className="ai-log-controls">
          <label className="ai-budget">
            Context budget
            <select
              aria-label="AI log context budget"
              value={budget}
              onChange={(event) => onBudgetChange(event.target.value as AiLogBudget)}
            >
              <option value="8k">Approx. 8k tokens</option>
              <option value="16k">Approx. 16k tokens</option>
              <option value="32k">Approx. 32k tokens</option>
              <option value="64k">Approx. 64k tokens</option>
              <option value="full">Full log</option>
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={copyStatus === 'copying'}
            onClick={() => void copy()}
          >
            <Icon name="copy" className="button-icon" />
            {copyStatus === 'copying' ? 'Copying…' : 'Copy for AI'}
          </button>
        </div>
      </div>
      <div className="ai-log-summary" role="status">
        <span>~{result.estimatedTokens.toLocaleString()} tokens</span>
        <span>{result.includedEntryCount} of {result.includedEntryCount + result.omittedEntryCount} entries</span>
        <span>
          Selection: {result.selectionMode === 'all' ? 'all' : `causal · ${result.includedAnchorCount} anchors`}
        </span>
        <span>State: {result.stateStatus}</span>
      </div>
      {budget === 'full' ? (
        <p className="ai-log-warning" data-testid="ai-full-warning">
          Full log can exceed an LLM context window. Prefer a bounded budget unless every entry is required.
        </p>
      ) : null}
      {hasReducedContext ? (
        <p className="ai-log-warning" data-testid="ai-log-warning">
          Context reduced: {result.omittedEntryCount} lower-priority entries omitted, {result.compactedValueCount} values compacted
          {result.stateStatus === 'focused' ? ', and current state focused on selected mutations' : ''}
          {result.stateStatus === 'omitted' ? ', and current state omitted' : ''}.
        </p>
      ) : null}
      <textarea
        className="ai-log-preview"
        aria-label="AI-ready Koshko log"
        readOnly
        spellCheck={false}
        value={result.text}
      />
      <p
        className={copyStatus === 'error' ? 'ai-copy-status error' : 'ai-copy-status'}
        role={copyStatus === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {copyStatus === 'copied' ? 'Copied AI-ready log.' : null}
        {copyStatus === 'error' ? 'Clipboard access failed. Select and copy the text manually.' : null}
      </p>
    </div>
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

type LogEntryType = 'signal' | 'error' | 'state' | 'post-message';

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
  parseJsonStrings,
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
  parseJsonStrings: boolean;
}): ReactElement {
  const emptyMessage = capturedEntryCount === 0
    ? ['No log entries yet.', 'Captured signals, browser errors, state mutations, and postMessages will appear here.']
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
          <label><input type="checkbox" checked={selectedTypes.has('error')} onChange={() => onTypeToggle('error')} /> Error</label>
          <label><input type="checkbox" checked={selectedTypes.has('state')} onChange={() => onTypeToggle('state')} /> State</label>
          <label><input type="checkbox" checked={selectedTypes.has('post-message')} onChange={() => onTypeToggle('post-message')} /> Message</label>
        </fieldset>
        <fieldset className="log-filter-group">
          <legend>Actors</legend>
          {actors.length === 0 ? <span className="muted">No entry actors captured.</span> : actors.map((actor) => (
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
        const entryType = getLogEntryType(entry);
        const type = entryType === 'signal'
          ? 'Signal'
          : entryType === 'error'
            ? 'Error'
            : entryType === 'post-message' ? 'PostMessage' : 'State';
        const metadata = getLogEntryMetadata(entry);
        const source = getLogEntrySource(entry);
        const payload = getLogEntryPayload(entry);
        const postMessageContext = isCapturedPostMessage(entry)
          ? `${entry.origin || '(opaque origin)'} · ${entry.source}`
          : undefined;
        return (
        <details
          className={`log-item ${entryType}`}
          open={index === entries.length - 1}
          data-log-entry-type={entryType}
          data-entry-name={getLogEntryName(entry)}
          data-error-name={isCapturedError(entry) ? entry.error.name : undefined}
          data-signal-name={isCapturedSignal(entry) ? entry.signal.name : undefined}
          key={`${type}-${metadata.id}`}
        >
          <summary>
            <span className="log-summary-title">
              <span className={`log-entry-kind ${entryType}`}>{type}</span>
              {' '}{getLogEntryName(entry)}
              {isCapturedError(entry) && getLogEntryName(entry) !== entry.error.name
                ? <span className="log-entry-machine-name"> · {entry.error.name}</span>
                : null}
              {source === undefined ? null : <span className="log-entry-source"> · {formatActor(source)}</span>}
              {postMessageContext === undefined ? null : <span className="log-entry-source"> · {postMessageContext}</span>}
            </span>
            <span className="muted">
              {formatDateTime(metadata.occurredAt)}
            </span>
          </summary>
          {payload === undefined
            ? <p className="log-empty-payload muted">No payload.</p>
            : <pre>{formatJsonForDisplay(payload, parseJsonStrings)}</pre>}
        </details>
        );
      })}
    </div>
  );
}

function matchesSelectedActor(entry: KoshkoLogEntry, selectedActorKeys: ReadonlySet<string>): boolean {
  if (isCapturedPostMessage(entry)) return true;
  if (isCapturedSignal(entry)) {
    return selectedActorKeys.has(actorKey(entry.signal.source))
      || (entry.signal.target !== undefined && selectedActorKeys.has(actorKey(entry.signal.target)));
  }
  return isCapturedError(entry) && selectedActorKeys.has(actorKey(entry.error.source));
}

function getLogEntryType(entry: KoshkoLogEntry): LogEntryType {
  if (isCapturedSignal(entry)) return 'signal';
  if (isCapturedError(entry)) return 'error';
  return isCapturedPostMessage(entry) ? 'post-message' : 'state';
}

function getLogEntryMetadata(entry: KoshkoLogEntry): {
  id: string;
  occurredAt: number;
} {
  if (isCapturedSignal(entry)) return entry.signal;
  if (isCapturedError(entry)) return entry.error;
  if (isCapturedPostMessage(entry)) {
    return { id: entry.id, occurredAt: entry.observedAt };
  }
  return entry.mutation;
}

function getLogEntryName(entry: KoshkoLogEntry): string {
  if (isCapturedSignal(entry)) return entry.signal.name;
  if (isCapturedError(entry)) return getErrorDisplayMessage(entry.error);
  if (isCapturedPostMessage(entry)) return 'window.postMessage';
  return entry.mutation.label ?? 'state mutation';
}

function getLogEntrySource(entry: KoshkoLogEntry) {
  if (isCapturedSignal(entry)) return entry.signal.source;
  if (isCapturedError(entry)) return entry.error.source;
  return undefined;
}

function getLogEntryPayload(entry: KoshkoLogEntry) {
  if (isCapturedSignal(entry)) return entry.signal.details;
  if (isCapturedError(entry)) return entry.error.payload;
  if (isCapturedPostMessage(entry)) {
    return {
      origin: entry.origin,
      source: entry.source,
      data: entry.data,
    };
  }
  return entry.mutation.patch;
}

function getVisibleLogText(entry: KoshkoLogEntry): string {
  const source = getLogEntrySource(entry);
  const metadata = getLogEntryMetadata(entry);
  return [
    getLogEntryType(entry),
    getLogEntryName(entry),
    source === undefined ? '' : formatActor(source),
    formatDateTime(metadata.occurredAt),
    JSON.stringify(getLogEntryPayload(entry)) ?? '',
  ].join(' ');
}

function getTimelineEntryId(entry: KoshkoTimelineEntry): string {
  if (isCapturedSignal(entry)) return entry.signal.id;
  if (isCapturedError(entry)) return entry.error.id;
  return entry.id;
}
