import { mount } from '@vue/test-utils';
import type { CapturedSignalV1 } from '@koshko/protocol';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { PanelApp, type PanelMessagePort } from './panel-app';
import { KoshkoRepository } from './repository';
import { PANEL_MESSAGE_CAPTURE, PANEL_MESSAGE_CLEAR, PANEL_MESSAGE_SET_PAUSED } from './shared';

class FakePanelPort implements PanelMessagePort {
  private readonly messageListeners = new Set<(message: { type: string; captured?: unknown }) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  readonly messages: unknown[] = [];

  readonly onMessage = {
    addListener: (listener: (message: { type: string; captured?: unknown }) => void): void => {
      this.messageListeners.add(listener);
    },
    removeListener: (listener: (message: { type: string; captured?: unknown }) => void): void => {
      this.messageListeners.delete(listener);
    },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void): void => {
      this.disconnectListeners.add(listener);
    },
    removeListener: (listener: () => void): void => {
      this.disconnectListeners.delete(listener);
    },
  };

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emitCapture(captured: CapturedSignalV1): void {
    for (const listener of this.messageListeners) {
      listener({ type: PANEL_MESSAGE_CAPTURE, captured });
    }
  }

  disconnect(): void {
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }
}

function captured(overrides: Partial<CapturedSignalV1> = {}): CapturedSignalV1 {
  return {
    signal: {
      protocol: 'koshko',
      version: 1,
      id: 'signal-1',
      producerId: 'test-producer',
      producerSequence: 1,
      occurredAt: Date.parse('2026-09-05T12:34:56.789Z'),
      source: { id: 'host', label: 'Host application' },
      name: 'host.ready',
    },
    observedAt: Date.parse('2026-09-05T12:34:56.790Z'),
    tabId: 17,
    frameId: 0,
    navigationId: 'navigation-1',
    frameUrl: 'https://demo.example.test',
    frameOrigin: 'https://demo.example.test',
    ...overrides,
  };
}

function mountPanel(): { port: FakePanelPort; repository: KoshkoRepository; downloadJsonl: ReturnType<typeof vi.fn>; wrapper: ReturnType<typeof mount> } {
  const port = new FakePanelPort();
  const repository = new KoshkoRepository();
  const downloadJsonl = vi.fn();
  const wrapper = mount(PanelApp, {
    props: { repository, port, tabId: 17, downloadJsonl },
  });

  return { port, repository, downloadJsonl, wrapper };
}

describe('PanelApp', () => {
  it('shows empty and disconnected states', async () => {
    const { port, wrapper } = mountPanel();

    expect(wrapper.get('[data-testid="empty-state"]').text()).toBe('No signals yet.');

    port.disconnect();
    await nextTick();

    expect(wrapper.get('[data-testid="disconnected-panel"]').text()).toContain('background connection closed');
  });

  it('renders actor instances, directed messages, and internal messages in the timeline', async () => {
    const { port, wrapper } = mountPanel();
    const widgetEmbedded = { id: 'widget', label: 'Widget', instanceId: 'embedded', instanceLabel: 'embedded' };
    const widgetProcessing = { id: 'widget', label: 'Widget', instanceId: 'processing', instanceLabel: 'processing' };

    port.emitCapture(captured({
      signal: {
        ...captured().signal,
        id: 'directed',
        name: 'host.open-widget',
        source: { id: 'host', label: 'Host application' },
        target: widgetEmbedded,
      },
    }));
    port.emitCapture(captured({
      signal: {
        ...captured().signal,
        id: 'self-targeted',
        producerSequence: 2,
        occurredAt: Date.parse('2026-09-05T12:34:57.789Z'),
        name: 'widget.self-transition',
        source: widgetProcessing,
        target: widgetProcessing,
      },
    }));
    port.emitCapture(captured({
      signal: {
        ...captured().signal,
        id: 'targetless-internal',
        producerSequence: 3,
        occurredAt: Date.parse('2026-09-05T12:34:58.789Z'),
        name: 'widget.local-cache-updated',
        source: widgetEmbedded,
      },
    }));
    await nextTick();

    expect(wrapper.get('[data-testid="timeline"]').text()).toContain('Widget · embedded');
    expect(wrapper.get('[data-testid="timeline"]').text()).toContain('Widget · processing');
    expect(wrapper.get('[data-signal-name="host.open-widget"] [data-actor-key="widget::embedded"]').text()).toContain('→ Widget · embedded');
    const selfTargetedCell = wrapper.get('[data-signal-name="widget.self-transition"] [data-actor-key="widget::processing"]');
    expect(selfTargetedCell.classes()).toContain('source');
    expect(selfTargetedCell.classes()).not.toContain('target');
    expect(selfTargetedCell.text()).not.toContain('→');

    const targetlessInternalCell = wrapper.get('[data-signal-name="widget.local-cache-updated"] [data-actor-key="widget::embedded"]');
    expect(targetlessInternalCell.classes()).toContain('source');
    expect(targetlessInternalCell.classes()).not.toContain('target');
    expect(targetlessInternalCell.text()).not.toContain('→');
  });

  it('renders signal and capture metadata in the log', async () => {
    const { port, wrapper } = mountPanel();

    port.emitCapture(captured({
      documentId: 'document-77',
      signal: {
        ...captured().signal,
        id: 'metadata',
        name: 'widget.process.failed',
        severity: 'error',
        tags: ['checkout', 'retry'],
        context: { locale: 'en-US' },
        correlationId: 'correlation-42',
        causedBy: 'command-41',
        details: { response: { code: 'UPSTREAM_TIMEOUT', attempts: 2 } },
      },
    }));
    await nextTick();
    await wrapper.get('button[aria-pressed="false"]').trigger('click');

    const log = wrapper.get('[data-testid="log"]').text();
    expect(log).toContain('widget.process.failed');
    expect(log).toContain('UPSTREAM_TIMEOUT');
    expect(log).toContain('\"severity\": \"error\"');
    expect(log).toContain('correlation-42');
    expect(log).toContain('command-41');
    expect(log).toContain('checkout');
    expect(log).toContain('en-US');
    expect(log).toContain('document-77');
    expect(log).toContain('https://demo.example.test');
  });

  it('buffers signals when paused, resumes, clears, and delegates export', async () => {
    const { port, repository, downloadJsonl, wrapper } = mountPanel();
    port.emitCapture(captured());
    await nextTick();

    await wrapper.get('[data-testid="pause-button"]').trigger('click');
    port.emitCapture(captured({
      signal: { ...captured().signal, id: 'buffered', producerSequence: 2, name: 'host.buffered' },
    }));
    await nextTick();

    expect(wrapper.get('[data-testid="capture-status"]').text()).toContain('1 event captured · paused · +1 unread');
    expect(wrapper.findAll('[data-signal-name="host.buffered"]')).toHaveLength(0);
    expect(port.messages).toContainEqual({ type: PANEL_MESSAGE_SET_PAUSED, paused: true });

    await wrapper.get('[data-testid="pause-button"]').trigger('click');
    await nextTick();
    expect(wrapper.findAll('[data-signal-name="host.buffered"]')).toHaveLength(1);

    await wrapper.get('[data-testid="export-button"]').trigger('click');
    expect(downloadJsonl).toHaveBeenCalledWith(expect.stringContaining('"type":"export-metadata"'));
    expect(downloadJsonl).toHaveBeenCalledWith(expect.stringContaining('"id":"buffered"'));

    await wrapper.get('[data-testid="clear-button"]').trigger('click');
    await nextTick();
    expect(repository.getCount()).toBe(0);
    expect(wrapper.findAll('[data-testid="empty-state"]')).toHaveLength(1);
    expect(port.messages).toContainEqual({ type: PANEL_MESSAGE_CLEAR });
  });
});
