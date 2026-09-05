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

    const syncFromRepository = (): void => {
      paused.value = props.repository.isPaused;
      unreadCount.value = props.repository.getUnreadCount();
      displaySignals.value = props.repository.getDisplaySignals();
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
      props.repository.clear();
      void props.port.postMessage({ type: PANEL_MESSAGE_CLEAR });
    };

    const exportJsonl = (): void => {
      props.downloadJsonl(props.repository.exportJsonl());
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
      const body: any = activeTab.value === 'timeline' ? renderBody(signals, actors) : renderBody(signals);

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

function renderTimeline(signals: CapturedSignalV1[], actors: KoshkoTimelineActor[]): ReturnType<typeof h> {
  if (signals.length === 0) {
    return hh('p', { class: 'empty', 'data-testid': 'empty-state' }, 'No signals yet.');
  }

  return hh('div', { class: 'timeline', 'data-testid': 'timeline' }, [
    hh('div', { class: 'timeline-headers' }, [
      hh('div', { class: 'timeline-stamp muted' }, 'Time · Source'),
      hh('div', { class: 'timeline-grid' }, actors.map((actor) =>
        hh('div', { class: 'timeline-header', 'data-actor-key': actor.key, key: actor.key }, formatActor(actor.reference)),
      )),
    ]),
    hh('div', { class: 'timeline-rows' }, signals.map((signal) =>
      hh('article', { class: 'timeline-row', 'data-signal-name': signal.signal.name, key: signal.signal.id }, [
        hh('div', { class: 'timeline-stamp' }, [
          hh('strong', formatTime(signal.signal.occurredAt)),
          hh('span', { class: 'muted' }, signal.signal.source.label ?? signal.signal.source.id),
        ]),
        hh('div', { class: 'timeline-grid' }, actors.map((actor) => {
          const sourceKey = actorKey(signal.signal.source);
          const targetKey = signal.signal.target ? actorKey(signal.signal.target) : null;
          const isSource = actor.key === sourceKey;
          const isTarget = targetKey !== null && targetKey !== sourceKey && actor.key === targetKey;
          const classes = ['timeline-cell'];
          if (isSource) classes.push('source');
          if (isTarget) classes.push('target');

          return hh('div', { class: classes, 'data-actor-key': actor.key, key: actor.key }, [
            isSource ? hh('strong', signal.signal.name) : null,
            isTarget && signal.signal.target ? hh('span', { class: 'muted' }, `→ ${formatActor(signal.signal.target)}`) : null,
          ].filter(Boolean));
        })),
      ]),
    )),
  ]);
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
