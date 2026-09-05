import { createApp, defineComponent, h, onBeforeUnmount, ref } from 'vue';
import type { CapturedSignalV1 } from '@koshko/protocol';
import { PANEL_MESSAGE_CAPTURE, PANEL_MESSAGE_CLEAR, PANEL_MESSAGE_SET_PAUSED, PANEL_PORT_PREFIX } from './shared';
import { KoshkoRepository, actorKey, formatActor, formatDateTime, formatTime, type KoshkoTimelineActor } from './repository';
import './ui.css';

const mountTarget = document.querySelector<HTMLDivElement>('#app');
if (!mountTarget) {
  throw new Error('Panel UI root is missing.');
}

const tabId = Number(new URL(location.href).searchParams.get('tabId') ?? '');
if (!Number.isFinite(tabId) || tabId < 0) {
  mountTarget.textContent = 'This panel needs a tab id.';
  throw new Error('Missing inspected tab id.');
}

const repository = new KoshkoRepository();
const port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });

const hh: any = h;

const Panel = defineComponent({
  setup() {
    const activeTab = ref<'timeline' | 'log'>('timeline');
    const connected = ref(true);
    const paused = ref(repository.isPaused);
    const unreadCount = ref(repository.getUnreadCount());
    const displaySignals = ref(repository.getDisplaySignals());

    const syncFromRepository = () => {
      paused.value = repository.isPaused;
      unreadCount.value = repository.getUnreadCount();
      displaySignals.value = repository.getDisplaySignals();
    };

    const unsubscribe = repository.subscribe(syncFromRepository);
    onBeforeUnmount(() => unsubscribe());

    port.onMessage.addListener((message: { type: string; captured?: unknown }) => {
      if (message.type !== PANEL_MESSAGE_CAPTURE || !message.captured) {
        return;
      }

      repository.record(message.captured as Parameters<KoshkoRepository['record']>[0]);
      if (!repository.isPaused) {
        syncFromRepository();
      } else {
        unreadCount.value = repository.getUnreadCount();
      }
    });

    port.onDisconnect.addListener(() => {
      connected.value = false;
    });

    const togglePaused = () => {
      repository.setPaused(!repository.isPaused);
      syncFromRepository();
      void port.postMessage({ type: PANEL_MESSAGE_SET_PAUSED, paused: repository.isPaused });
    };

    const clear = () => {
      repository.clear();
      syncFromRepository();
      void port.postMessage({ type: PANEL_MESSAGE_CLEAR });
    };

    const exportJsonl = () => {
      const blob = new Blob([repository.exportJsonl()], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'koshko.jsonl';
      link.click();
      URL.revokeObjectURL(url);
    };

    return () => {
      if (!connected.value) {
        return hh('main', { class: 'shell' }, [
          hh('section', { class: 'card' }, [
            hh('h1', 'Koshko'),
            hh('p', { class: 'muted' }, 'The background connection closed. Reopen DevTools or reload the page.'),
          ]),
        ]);
      }

      const signals = displaySignals.value;
      const actors = repository.getActorColumns();

      const renderBody: any = activeTab.value === 'timeline' ? renderTimeline : renderLog;
      const body = renderBody(signals, actors);

      return hh('main', { class: 'shell' }, [
        hh('header', { class: 'toolbar card' }, [
          hh('div', [
            hh('p', { class: 'eyebrow' }, 'Koshko Dev Tools'),
            hh('h1', `Tab ${tabId}`),
            hh(
              'p',
              { class: 'muted' },
              `${signals.length} event${signals.length === 1 ? '' : 's'} captured${paused.value ? ` · paused · +${unreadCount.value} unread` : ''}`,
            ),
          ]),
          hh('div', { class: 'actions' }, [
            hh('button', { class: 'ghost', onClick: togglePaused }, paused.value ? 'Resume' : 'Pause'),
            hh('button', { onClick: clear }, 'Clear'),
            hh('button', { onClick: exportJsonl }, 'Export JSONL'),
          ]),
        ]),
        hh('nav', { class: 'tabs card' }, [
          hh(
            'button',
            {
              class: activeTab.value === 'timeline' ? 'tab active' : 'tab',
              onClick: () => {
                activeTab.value = 'timeline';
              },
            },
            'Timeline',
          ),
          hh(
            'button',
            {
              class: activeTab.value === 'log' ? 'tab active' : 'tab',
              onClick: () => {
                activeTab.value = 'log';
              },
            },
            'Log',
          ),
        ]),
        hh('section', { class: 'card' }, body as never),
      ]);
    };
  },
});

createApp(Panel).mount(mountTarget);

function renderTimeline(
  signals: CapturedSignalV1[],
  actors: KoshkoTimelineActor[],
): any {
  if (signals.length === 0) {
    return hh('p', { class: 'empty' }, 'No signals yet.');
  }

  return hh('div', { class: 'timeline' }, [
    hh('div', { class: 'timeline-headers' }, [
      hh('div', { class: 'timeline-stamp muted' }, 'Time · Source'),
      hh(
        'div',
        { class: 'timeline-grid' },
        actors.map((actor) => hh('div', { class: 'timeline-header', key: actor.key }, formatActor(actor.reference))),
      ),
    ]),
    hh(
      'div',
      { class: 'timeline-rows' },
      signals.map((signal) =>
        hh('article', { class: 'timeline-row', key: signal.signal.id }, [
          hh('div', { class: 'timeline-stamp' }, [
            hh('strong', formatTime(signal.signal.occurredAt)),
            hh('span', { class: 'muted' }, signal.signal.source.label ?? signal.signal.source.id),
          ]),
          hh(
            'div',
            { class: 'timeline-grid' },
            actors.map((actor) => {
              const sourceKey = actorKey(signal.signal.source);
              const targetKey = signal.signal.target ? actorKey(signal.signal.target) : null;
              const isSource = actor.key === sourceKey;
              const isTarget = targetKey !== null && actor.key === targetKey;
              const classes = ['timeline-cell'];
              if (isSource) {
                classes.push('source');
              }
              if (isTarget) {
                classes.push('target');
              }

              const content = [
                isSource ? hh('strong', signal.signal.name) : null,
                isTarget && signal.signal.target ? hh('span', { class: 'muted' }, `→ ${formatActor(signal.signal.target)}`) : null,
              ].filter(Boolean);

              return hh('div', { class: classes, key: actor.key }, content);
            }),
          ),
        ]),
      ),
    ),
  ]);
}

function renderLog(signals: CapturedSignalV1[]): any {
  if (signals.length === 0) {
    return hh('p', { class: 'empty' }, 'No signals yet.');
  }

  return hh(
    'div',
    { class: 'log' },
    signals.map((signal, index) =>
      hh('details', { class: 'log-item', open: index === signals.length - 1, key: signal.signal.id }, [
        hh('summary', [
          hh('span', { class: 'log-summary-title' }, signal.signal.name),
          hh('span', { class: 'muted' }, formatDateTime(signal.signal.occurredAt)),
        ]),
        hh('pre', JSON.stringify(signal, null, 2)),
      ]),
    ),
  );
}
