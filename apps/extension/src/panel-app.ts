import { defineComponent, h, onBeforeUnmount, ref, type PropType } from 'vue';
import type { CapturedSignalV1 } from '@koshko/protocol';
import { PANEL_MESSAGE_CAPTURE, PANEL_MESSAGE_CLEAR, PANEL_MESSAGE_SET_PAUSED } from './shared';
import { KoshkoRepository, actorKey, formatActor, formatDateTime, formatTime, type KoshkoTimelineActor } from './repository';

export interface PanelMessagePort {
  onMessage: {
    addListener(listener: (message: { type: string; captured?: unknown }) => void): void;
    removeListener?(listener: (message: { type: string; captured?: unknown }) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener?(listener: () => void): void;
  };
  postMessage(message: unknown): void | Promise<void>;
}

const hh: typeof h = h;

export const PanelApp = defineComponent({
  name: 'PanelApp',
  props: {
    repository: { type: Object as PropType<KoshkoRepository>, required: true },
    port: { type: Object as PropType<PanelMessagePort>, required: true },
    tabId: { type: Number, required: true },
    downloadJsonl: { type: Function as PropType<(jsonl: string) => void>, required: true },
  },
  setup(props) {
    const activeTab = ref<'timeline' | 'log'>('timeline');
    const connected = ref(true);
    const paused = ref(props.repository.isPaused);
    const unreadCount = ref(props.repository.getUnreadCount());
    const displaySignals = ref(props.repository.getDisplaySignals());
    const expandedSignalIds = ref<ReadonlySet<string>>(new Set());

    const syncFromRepository = (): void => {
      paused.value = props.repository.isPaused;
      unreadCount.value = props.repository.getUnreadCount();
      displaySignals.value = props.repository.getDisplaySignals();
      const displayedIds = new Set<string>();
      for (const captured of displaySignals.value) {
        displayedIds.add(captured.signal.id);
      }
      expandedSignalIds.value = new Set([...expandedSignalIds.value].filter((signalId) => displayedIds.has(signalId)));
    };

    const onMessage = (message: { type: string; captured?: unknown }): void => {
      if (message.type !== PANEL_MESSAGE_CAPTURE || !message.captured) {
        return;
      }

      props.repository.record(message.captured as CapturedSignalV1);
      syncFromRepository();
    };
    const onDisconnect = (): void => {
      connected.value = false;
    };

    const unsubscribe = props.repository.subscribe(syncFromRepository);
    props.port.onMessage.addListener(onMessage);
    props.port.onDisconnect.addListener(onDisconnect);
    onBeforeUnmount(() => {
      unsubscribe();
      props.port.onMessage.removeListener?.(onMessage);
      props.port.onDisconnect.removeListener?.(onDisconnect);
    });

    const togglePaused = (): void => {
      props.repository.setPaused(!props.repository.isPaused);
      void props.port.postMessage({ type: PANEL_MESSAGE_SET_PAUSED, paused: props.repository.isPaused });
    };

    const clear = (): void => {
      expandedSignalIds.value = new Set();
      props.repository.clear();
      void props.port.postMessage({ type: PANEL_MESSAGE_CLEAR });
    };

    const exportJsonl = (): void => {
      props.downloadJsonl(props.repository.exportJsonl());
    };

    const toggleDetails = (signalId: string): void => {
      const next = new Set(expandedSignalIds.value);
      if (next.has(signalId)) {
        next.delete(signalId);
      } else {
        next.add(signalId);
      }
      expandedSignalIds.value = next;
    };

    return () => {
      if (!connected.value) {
        return hh('main', { class: 'shell', 'data-testid': 'disconnected-panel' }, [
          hh('section', { class: 'card' }, [
            hh('h1', 'Koshko'),
            hh('p', { class: 'muted' }, 'The background connection closed. Reopen DevTools or reload the page.'),
          ]),
        ]);
      }

      const signals = displaySignals.value;
      const actors = props.repository.getActorColumns();
      const renderBody: any = activeTab.value === 'timeline' ? renderTimeline : renderLog;
      const body: any = activeTab.value === 'timeline'
        ? renderBody(signals, actors, expandedSignalIds.value, toggleDetails)
        : renderBody(signals);

      return hh('main', { class: 'shell' }, [
        hh('header', { class: 'toolbar card' }, [
          hh('div', [
            hh('p', { class: 'eyebrow' }, 'Koshko Dev Tools'),
            hh('h1', `Tab ${props.tabId}`),
            hh(
              'p',
              { class: 'muted', 'data-testid': 'capture-status' },
              `${signals.length} event${signals.length === 1 ? '' : 's'} captured${paused.value ? ` · paused · +${unreadCount.value} unread` : ''}`,
            ),
          ]),
          hh('div', { class: 'actions' }, [
            hh('button', { class: 'ghost', 'data-testid': 'pause-button', onClick: togglePaused }, paused.value ? 'Resume' : 'Pause'),
            hh('button', { 'data-testid': 'clear-button', onClick: clear }, 'Clear'),
            hh('button', { 'data-testid': 'export-button', onClick: exportJsonl }, 'Export JSONL'),
          ]),
        ]),
        hh('nav', { class: 'tabs card' }, [
          hh('button', {
            class: activeTab.value === 'timeline' ? 'tab active' : 'tab',
            'aria-pressed': String(activeTab.value === 'timeline'),
            onClick: () => { activeTab.value = 'timeline'; },
          }, 'Timeline'),
          hh('button', {
            class: activeTab.value === 'log' ? 'tab active' : 'tab',
            'aria-pressed': String(activeTab.value === 'log'),
            onClick: () => { activeTab.value = 'log'; },
          }, 'Log'),
        ]),
        hh('section', { class: 'card', 'data-testid': 'panel-body' }, body),
      ]);
    };
  },
});

function renderTimeline(
  signals: CapturedSignalV1[],
  actors: KoshkoTimelineActor[],
  expandedSignalIds: ReadonlySet<string>,
  toggleDetails: (signalId: string) => void,
): ReturnType<typeof h> {
  if (signals.length === 0) {
    return hh('p', { class: 'empty', 'data-testid': 'empty-state' }, 'No signals yet.');
  }

  return hh('div', {
    class: 'timeline',
    'data-testid': 'timeline',
    style: { '--timeline-actor-count': String(actors.length) },
  }, [
    hh('div', { class: 'timeline-headers' }, [
      hh('div', { class: 'timeline-stamp muted' }, 'Time · Source'),
      hh('div', { class: 'timeline-grid' }, actors.map((actor) => renderActorHeader(actor))),
    ]),
    hh('div', { class: 'timeline-rows' }, signals.map((signal) =>
      renderTimelineRow(signal, actors, expandedSignalIds.has(signal.signal.id), toggleDetails),
    )),
  ]);
}

function renderActorHeader(actor: KoshkoTimelineActor): ReturnType<typeof h> {
  const { reference } = actor;
  const instanceLabel = reference.instanceLabel ?? reference.instanceId;
  return hh('div', {
    class: 'timeline-header',
    'data-actor-key': actor.key,
    title: formatActor(reference),
    key: actor.key,
  }, [
    hh('span', { class: 'timeline-actor-label' }, reference.label ?? reference.id),
    instanceLabel
      ? hh('span', { class: 'timeline-instance-badge', 'data-testid': 'actor-instance-badge' }, instanceLabel)
      : null,
  ].filter(Boolean));
}

function renderTimelineRow(
  captured: CapturedSignalV1,
  actors: KoshkoTimelineActor[],
  expanded: boolean,
  toggleDetails: (signalId: string) => void,
): ReturnType<typeof h> {
  const { signal } = captured;
  const sourceKey = actorKey(signal.source);
  const targetKey = signal.target ? actorKey(signal.target) : null;
  const sourceIndex = actors.findIndex((actor) => actor.key === sourceKey);
  const targetIndex = targetKey === null ? -1 : actors.findIndex((actor) => actor.key === targetKey);
  const hasArrow = targetKey !== null && targetKey !== sourceKey && sourceIndex >= 0 && targetIndex >= 0;
  const direction = hasArrow && targetIndex > sourceIndex ? 'forward' : 'reverse';
  const rowClasses = ['timeline-row', hasArrow ? 'directed' : 'internal', `severity-${signal.severity ?? 'info'}`];
  const directionLabel = hasArrow && signal.target
    ? `${formatActor(signal.source)} sends ${signal.name} to ${formatActor(signal.target)}`
    : `${formatActor(signal.source)} records internal event ${signal.name}`;
  const occurredAtIso = new Date(signal.occurredAt).toISOString();
  const sourcePosition = ((sourceIndex + 0.5) / actors.length) * 100;
  const targetPosition = hasArrow ? ((targetIndex + 0.5) / actors.length) * 100 : sourcePosition;
  const arrowStart = Math.min(sourcePosition, targetPosition);
  const arrowWidth = Math.abs(targetPosition - sourcePosition);

  return hh('article', {
    class: rowClasses,
    'data-signal-name': signal.name,
    'data-direction': hasArrow ? direction : 'internal',
    'data-source-actor-key': sourceKey,
    'data-target-actor-key': hasArrow ? targetKey : undefined,
    'data-source-index': sourceIndex,
    'data-target-index': hasArrow ? targetIndex : undefined,
    'data-actor-count': actors.length,
    'data-severity': signal.severity ?? 'info',
    style: {
      '--timeline-source-index': String(sourceIndex),
      '--timeline-target-index': hasArrow ? String(targetIndex) : undefined,
      '--timeline-actor-count': String(actors.length),
    },
    key: signal.id,
  }, [
    hh('div', { class: 'timeline-stamp', title: `${occurredAtIso} (${signal.occurredAt})` }, [
      hh('strong', { 'data-testid': 'timeline-time' }, formatTime(signal.occurredAt)),
      hh('span', { class: 'muted' }, signal.source.label ?? signal.source.id),
    ]),
    hh('div', { class: 'timeline-grid' }, actors.map((actor) => {
      const isSource = actor.key === sourceKey;
      const isTarget = hasArrow && actor.key === targetKey;
      const classes = ['timeline-cell'];
      if (isSource) classes.push('source');
      if (isTarget) classes.push('target');

      return hh('div', { class: classes, 'data-actor-key': actor.key, key: actor.key }, [
        isSource ? hh('button', {
          class: `timeline-event-control severity-${signal.severity ?? 'info'}`,
          type: 'button',
          'aria-expanded': String(expanded),
          'aria-controls': `timeline-details-${signal.id}`,
          onClick: () => { toggleDetails(signal.id); },
        }, signal.name) : null,
      ].filter(Boolean));
    })),
    hasArrow ? hh('div', {
      class: `timeline-arrow ${direction}`,
      role: 'img',
      'aria-label': directionLabel,
      'data-testid': 'timeline-arrow',
      'data-source-actor-key': sourceKey,
      'data-target-actor-key': targetKey,
      'data-source-index': sourceIndex,
      'data-target-index': targetIndex,
      style: {
        '--timeline-source-index': String(sourceIndex),
        '--timeline-target-index': String(targetIndex),
        '--timeline-actor-count': String(actors.length),
        '--timeline-arrow-start': `${arrowStart}%`,
        '--timeline-arrow-width': `${arrowWidth}%`,
      },
    }) : null,
    expanded ? hh('section', {
      class: 'timeline-details',
      id: `timeline-details-${signal.id}`,
      'data-testid': 'timeline-details',
    }, [
      hh('pre', JSON.stringify(captured, null, 2)),
    ]) : null,
  ].filter(Boolean));
}

function renderLog(signals: CapturedSignalV1[]): ReturnType<typeof h> {
  if (signals.length === 0) {
    return hh('p', { class: 'empty', 'data-testid': 'empty-state' }, 'No signals yet.');
  }

  return hh('div', { class: 'log', 'data-testid': 'log' }, signals.map((signal, index) =>
    hh('details', { class: 'log-item', open: index === signals.length - 1, 'data-signal-name': signal.signal.name, key: signal.signal.id }, [
      hh('summary', [
        hh('span', { class: 'log-summary-title' }, signal.signal.name),
        hh('span', { class: 'muted' }, formatDateTime(signal.signal.occurredAt)),
      ]),
      hh('pre', JSON.stringify(signal, null, 2)),
    ]),
  ));
}
