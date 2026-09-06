import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { CapturedSignalV1 } from '@koshko/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelApp, type PanelMessagePort } from './panel-app';
import { formatTime, KoshkoRepository } from './repository';
import {
  PANEL_MESSAGE_CAPTURE,
  PANEL_MESSAGE_CLEAR,
  PANEL_MESSAGE_SET_PAUSED,
} from './shared';

class FakePanelPort implements PanelMessagePort {
  private readonly messageListeners = new Set<
    (message: { type: string; captured?: unknown }) => void
  >();
  private readonly disconnectListeners = new Set<() => void>();

  readonly messages: unknown[] = [];

  readonly onMessage = {
    addListener: (
      listener: (message: { type: string; captured?: unknown }) => void,
    ): void => {
      this.messageListeners.add(listener);
    },
    removeListener: (
      listener: (message: { type: string; captured?: unknown }) => void,
    ): void => {
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

  get listenerCount(): number {
    return this.messageListeners.size + this.disconnectListeners.size;
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

function mountPanel(): {
  port: FakePanelPort;
  repository: KoshkoRepository;
  downloadJsonl: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const port = new FakePanelPort();
  const repository = new KoshkoRepository();
  const downloadJsonl = vi.fn();
  const { unmount } = render(
    <PanelApp
      repository={repository}
      port={port}
      tabId={17}
      downloadJsonl={downloadJsonl}
    />,
  );

  return { port, repository, downloadJsonl, unmount };
}

describe('PanelApp', () => {
  afterEach(cleanup);

  it('shows empty and disconnected states', () => {
    const { port } = mountPanel();

    expect(screen.getByTestId('empty-state').textContent).toContain(
      'No signals yet.',
    );

    act(() => port.disconnect());

    expect(screen.getByTestId('disconnected-panel').textContent).toContain(
      'background connection closed',
    );
  });

  it('renders actor instances, directed messages, and internal messages in the timeline', () => {
    const { port } = mountPanel();
    const widgetEmbedded = {
      id: 'widget',
      label: 'Widget',
      instanceId: 'embedded',
      instanceLabel: 'embedded',
    };
    const widgetProcessing = {
      id: 'widget',
      label: 'Widget',
      instanceId: 'processing',
    };

    act(() => {
      port.emitCapture(
        captured({
          signal: {
            ...captured().signal,
            id: 'directed',
            name: 'host.open-widget',
            source: { id: 'host', label: 'Host application' },
            target: widgetEmbedded,
          },
        }),
      );
      port.emitCapture(
        captured({
          signal: {
            ...captured().signal,
            id: 'self-targeted',
            producerSequence: 2,
            occurredAt: Date.parse('2026-09-05T12:34:57.789Z'),
            name: 'widget.self-transition',
            source: widgetProcessing,
            target: widgetProcessing,
          },
        }),
      );
      port.emitCapture(
        captured({
          signal: {
            ...captured().signal,
            id: 'targetless-internal',
            producerSequence: 3,
            occurredAt: Date.parse('2026-09-05T12:34:58.789Z'),
            name: 'widget.local-cache-updated',
            source: widgetEmbedded,
          },
        }),
      );
    });

    expect(screen.getByTestId('timeline').textContent).toContain('Widget');
    expect(
      screen
        .getAllByTestId('actor-instance-badge')
        .map((badge) => badge.textContent),
    ).toEqual(['embedded', 'processing']);
    const forward = document.querySelector<HTMLElement>(
      '[data-signal-name="host.open-widget"]',
    )!;
    const forwardArrow = within(forward).getByTestId('timeline-arrow');
    expect(forward.dataset.direction).toBe('forward');
    expect(forward.dataset.sourceIndex).toBe('0');
    expect(forward.dataset.targetIndex).toBe('1');
    expect(forward.dataset.actorCount).toBe('3');
    expect(forwardArrow.getAttribute('data-source-actor-key')).toBe('host::');
    expect(forwardArrow.getAttribute('data-target-actor-key')).toBe(
      'widget::embedded',
    );
    expect(forwardArrow.getAttribute('aria-label')).toBe(
      'Host application sends host.open-widget to Widget · embedded',
    );
    expect(forwardArrow.className).toContain('forward');
    expect(forwardArrow.getAttribute('style')).toContain(
      '--timeline-source-index: 0',
    );
    expect(forwardArrow.getAttribute('style')).toContain(
      '--timeline-arrow-start: 16.666666666666664%',
    );
    expect(forwardArrow.getAttribute('style')).toContain(
      '--timeline-arrow-width: 33.333333333333336%',
    );

    const selfTargetedCell = document.querySelector<HTMLElement>(
      '[data-signal-name="widget.self-transition"] [data-actor-key="widget::processing"]',
    )!;
    expect(selfTargetedCell.className).toContain('source');
    expect(selfTargetedCell.className).not.toContain('target');
    expect(selfTargetedCell.textContent).not.toContain('→');

    const targetlessInternalCell = document.querySelector<HTMLElement>(
      '[data-signal-name="widget.local-cache-updated"] [data-actor-key="widget::embedded"]',
    )!;
    expect(targetlessInternalCell.className).toContain('source');
    expect(targetlessInternalCell.className).not.toContain('target');
    expect(
      document.querySelectorAll(
        '[data-signal-name="widget.self-transition"] [data-testid="timeline-arrow"]',
      ),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll(
        '[data-signal-name="widget.local-cache-updated"] [data-testid="timeline-arrow"]',
      ),
    ).toHaveLength(0);
  });

  it('renders reverse arrows, compact local timestamps, and independently expandable details', () => {
    const { port } = mountPanel();
    const host = { id: 'host', label: 'Host application' };
    const widget = {
      id: 'widget',
      label: 'Widget',
      instanceId: 'embedded',
      instanceLabel: 'embedded',
    };
    const occurredAt = Date.parse('2026-09-05T12:34:56.789Z');

    act(() => {
      port.emitCapture(
        captured({
          signal: {
            ...captured().signal,
            id: 'host-first',
            source: host,
            name: 'host.ready',
          },
        }),
      );
      port.emitCapture(
        captured({
          signal: {
            ...captured().signal,
            id: 'reverse',
            producerSequence: 2,
            occurredAt,
            source: widget,
            target: host,
            name: 'widget.completed',
            details: { result: 'ok' },
          },
        }),
      );
    });

    const row = document.querySelector<HTMLElement>(
      '[data-signal-name="widget.completed"]',
    )!;
    const arrow = within(row).getByTestId('timeline-arrow');
    expect(row.dataset.direction).toBe('reverse');
    expect(arrow.className).toContain('reverse');
    expect(arrow.getAttribute('aria-label')).toBe(
      'Widget · embedded sends widget.completed to Host application',
    );
    expect(within(row).getByTestId('timeline-time').textContent).toBe(
      formatTime(occurredAt),
    );
    expect(
      row.querySelector('.timeline-stamp')?.getAttribute('title'),
    ).toContain('2026-09-05T12:34:56.789Z');
    expect(within(row).queryByTestId('timeline-details')).toBeNull();

    const control = within(row).getByRole('button', {
      name: 'widget.completed',
    });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(within(row).getByTestId('timeline-details').textContent).toContain(
      '"result": "ok"',
    );

    const firstEventControl = screen.getByRole('button', {
      name: 'host.ready',
    });
    fireEvent.click(firstEventControl);
    expect(screen.getAllByTestId('timeline-details')).toHaveLength(2);

    fireEvent.click(control);
    expect(within(row).queryByTestId('timeline-details')).toBeNull();
    expect(screen.getAllByTestId('timeline-details')).toHaveLength(1);
  });

  it('renders signal and capture metadata in the log', () => {
    const { port } = mountPanel();

    act(() =>
      port.emitCapture(
        captured({
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
            details: {
              response: { code: 'UPSTREAM_TIMEOUT', attempts: 2 },
            },
          },
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log' }));

    const log = screen.getByTestId('log').textContent ?? '';
    expect(log).toContain('widget.process.failed');
    expect(log).toContain('UPSTREAM_TIMEOUT');
    expect(log).toContain('"severity": "error"');
    expect(log).toContain('correlation-42');
    expect(log).toContain('command-41');
    expect(log).toContain('checkout');
    expect(log).toContain('en-US');
    expect(log).toContain('document-77');
    expect(log).toContain('https://demo.example.test');
  });

  it('buffers signals when paused, resumes, clears, and delegates export', () => {
    const { port, repository, downloadJsonl } = mountPanel();

    act(() => port.emitCapture(captured()));
    fireEvent.click(screen.getByTestId('pause-button'));
    act(() =>
      port.emitCapture(
        captured({
          signal: {
            ...captured().signal,
            id: 'buffered',
            producerSequence: 2,
            name: 'host.buffered',
          },
        }),
      ),
    );

    expect(screen.getByTestId('capture-status').textContent).toContain(
      '1 event captured · paused · +1 unread',
    );
    expect(
      document.querySelectorAll('[data-signal-name="host.buffered"]'),
    ).toHaveLength(0);
    expect(port.messages).toContainEqual({
      type: PANEL_MESSAGE_SET_PAUSED,
      paused: true,
    });

    fireEvent.click(screen.getByTestId('pause-button'));
    expect(
      document.querySelectorAll('[data-signal-name="host.buffered"]'),
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId('export-button'));
    expect(downloadJsonl).toHaveBeenCalledWith(
      expect.stringContaining('"type":"export-metadata"'),
    );
    expect(downloadJsonl).toHaveBeenCalledWith(
      expect.stringContaining('"id":"buffered"'),
    );

    fireEvent.click(screen.getByTestId('clear-button'));
    expect(repository.getCount()).toBe(0);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(port.messages).toContainEqual({ type: PANEL_MESSAGE_CLEAR });
  });

  it('unsubscribes from the port on unmount', () => {
    const { port, unmount } = mountPanel();

    expect(port.listenerCount).toBe(2);

    unmount();

    expect(port.listenerCount).toBe(0);
  });
});
