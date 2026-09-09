import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  CapturedErrorV1,
  CapturedSignalV1,
  CapturedStateMutationV1,
} from '@koshko/protocol';
import type { PanelCaptureMessage } from '../messaging/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelApp } from './panel-app';
import type { ManagedPanelConnection, PanelConnectionStatus } from '../messaging/panel-connection';
import type { PanelAccessController, PanelAccessSnapshot } from '../browser/panel-access';
import type { PanelAccessChange } from '../browser/panel-access';
import { formatDateTime, formatTime, KoshkoRepository } from '../state/repository';
import {
  PANEL_MESSAGE_CAPTURE,
} from '../messaging/messages';

class FakePanelConnection implements ManagedPanelConnection {
  private readonly messageListeners = new Set<
    (message: PanelCaptureMessage) => void
  >();
  private readonly statusListeners = new Set<(status: PanelConnectionStatus) => void>();

  status: PanelConnectionStatus = 'connected';

  subscribe(listener: (message: PanelCaptureMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  subscribeStatus(listener: (status: PanelConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  emitCapture(captured: CapturedSignalV1): void {
    for (const listener of this.messageListeners) {
      listener({ type: PANEL_MESSAGE_CAPTURE, kind: 'signal', captured });
    }
  }

  emitError(captured: CapturedErrorV1): void {
    for (const listener of this.messageListeners) {
      listener({ type: PANEL_MESSAGE_CAPTURE, kind: 'error', captured });
    }
  }

  emitStateMutation(captured: CapturedStateMutationV1): void {
    for (const listener of this.messageListeners) {
      listener({ type: PANEL_MESSAGE_CAPTURE, kind: 'state-mutation', captured });
    }
  }

  disconnect(): void {
    this.status = 'reconnecting';
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  ready(): void {
    this.status = 'connected';
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  get listenerCount(): number {
    return this.messageListeners.size + this.statusListeners.size;
  }
}

function capturedStateMutation(
  patch: CapturedStateMutationV1['mutation']['patch'],
  overrides: Partial<CapturedStateMutationV1> = {},
): CapturedStateMutationV1 {
  return {
    mutation: {
      protocol: 'koshko',
      version: 1,
      id: 'mutation-1',
      producerId: 'test-state-producer',
      producerSequence: 1,
      occurredAt: Date.parse('2026-09-05T12:34:56.789Z'),
      patch,
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

function capturedError(overrides: Partial<CapturedErrorV1> = {}): CapturedErrorV1 {
  return {
    error: {
      protocol: 'koshko',
      version: 1,
      id: 'error-1',
      producerId: 'browser-console:frame-1',
      producerSequence: 1,
      occurredAt: Date.parse('2026-09-05T12:34:56.789Z'),
      source: { id: 'browser-console', label: 'Browser Console' },
      name: 'console.error',
      payload: {
        message: 'Checkout failed',
        stack: 'Error: Checkout failed\n    at checkout.js:1:1',
        arguments: ['Checkout failed', { code: 'PAYMENT_ERROR' }],
      },
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

function createAccessController(
  snapshot: PanelAccessSnapshot = {
    supported: true,
    site: {
      origin: 'https://demo.example.test',
      matchPattern: 'https://demo.example.test/*',
    },
    granted: true,
  },
): PanelAccessController {
  return {
    inspect: vi.fn().mockResolvedValue(snapshot),
    grant: vi.fn().mockResolvedValue({ granted: true, captureStarted: true }),
    activate: vi.fn().mockResolvedValue({ granted: true, captureStarted: true }),
    reload: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

function mountPanel(accessController = createAccessController()): {
  port: FakePanelConnection;
  repository: KoshkoRepository;
  downloadJsonl: ReturnType<typeof vi.fn>;
  copyText: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const port = new FakePanelConnection();
  const repository = new KoshkoRepository();
  const downloadJsonl = vi.fn();
  const copyText = vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(
    <PanelApp
      repository={repository}
      connection={port}
      tabId={17}
      accessController={accessController}
      downloadJsonl={downloadJsonl}
      copyText={copyText}
    />,
  );

  return { port, repository, downloadJsonl, copyText, unmount };
}

function expandGlobalState(): HTMLElement {
  const tree = screen.getByLabelText('Selected global state');
  const root = tree.querySelector('.jer-collection-header-row');
  if (!(root instanceof HTMLElement)) throw new Error('Root state node was not rendered');
  fireEvent.click(root, { altKey: true });
  return tree;
}

describe('PanelApp', () => {
  afterEach(cleanup);

  it('grants the inspected site explicitly and explains missed startup events', async () => {
    const accessController = createAccessController({
      supported: true,
      site: {
        origin: 'https://demo.example.test',
        matchPattern: 'https://demo.example.test/*',
      },
      granted: false,
    });
    mountPanel(accessController);

    await screen.findByTestId('access-required');
    fireEvent.click(screen.getByRole('button', {
      name: 'Grant access and start capture',
    }));

    await waitFor(() => expect(accessController.grant).toHaveBeenCalledWith({
      origin: 'https://demo.example.test',
      matchPattern: 'https://demo.example.test/*',
    }));
    expect((await screen.findByTestId('access-active')).textContent).toContain(
      'Events emitted before access was granted were missed.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload target' }));
    expect(accessController.reload).toHaveBeenCalledOnce();
  });

  it('keeps the grant control visible after permission is denied', async () => {
    const accessController = createAccessController({
      supported: true,
      site: {
        origin: 'https://demo.example.test',
        matchPattern: 'https://demo.example.test/*',
      },
      granted: false,
    });
    vi.mocked(accessController.grant).mockResolvedValue({
      granted: false,
      message: 'Access was not granted. Koshko did not read this page.',
    });
    mountPanel(accessController);

    await screen.findByTestId('access-required');
    fireEvent.click(screen.getByRole('button', {
      name: 'Grant access and start capture',
    }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Access was not granted. Koshko did not read this page.',
    );
  });

  it('shows unsupported and activation-error access states', async () => {
    const unsupported = createAccessController({
      supported: false,
      message: 'Only http and https origins can be granted.',
    });
    const first = mountPanel(unsupported);
    expect((await screen.findByTestId('access-unsupported')).textContent).toContain(
      'Only http and https origins can be granted.',
    );
    first.unmount();

    const failed = createAccessController({
      supported: true,
      site: {
        origin: 'https://demo.example.test',
        matchPattern: 'https://demo.example.test/*',
      },
      granted: false,
    });
    vi.mocked(failed.grant).mockResolvedValue({
      granted: true,
      captureStarted: false,
      message: 'The page changed before capture started.',
    });
    mountPanel(failed);
    await screen.findByTestId('access-required');
    fireEvent.click(screen.getByRole('button', {
      name: 'Grant access and start capture',
    }));

    expect((await screen.findByTestId('access-activation-error')).textContent).toContain(
      'The page changed before capture started.',
    );
  });

  it('immediately activates a Chrome-native grant and surfaces injection failure', async () => {
    const site = {
      origin: 'https://demo.example.test',
      matchPattern: 'https://demo.example.test/*',
    };
    let snapshot: PanelAccessSnapshot = {
      supported: true,
      site,
      granted: false,
    };
    let onChange: ((change: PanelAccessChange) => void) | undefined;
    const accessController: PanelAccessController = {
      inspect: vi.fn(async () => snapshot),
      grant: vi.fn(),
      activate: vi.fn().mockResolvedValue({
        granted: true,
        captureStarted: false,
        message: 'The current document rejected injection.',
      }),
      reload: vi.fn(),
      subscribe: vi.fn((listener) => {
        onChange = listener;
        return () => {};
      }),
    };
    mountPanel(accessController);
    await screen.findByTestId('access-required');
    snapshot = { supported: true, site, granted: true };

    act(() => onChange?.({
      kind: 'permission-added',
      origins: ['https://demo.example.test/*'],
    }));

    await waitFor(() => expect(accessController.activate).toHaveBeenCalledWith(site));
    expect((await screen.findByTestId('access-activation-error')).textContent).toContain(
      'The current document rejected injection.',
    );
    expect(accessController.grant).not.toHaveBeenCalled();
  });

  it('keeps panel data visible while reconnecting', () => {
    const { port } = mountPanel();

    expect(screen.getByTestId('empty-state').textContent).toContain(
      'No timeline entries yet.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Global State' }));
    expect(screen.getByLabelText('Selected global state').textContent).toContain('0 items');

    act(() => {
      port.emitCapture(captured());
      port.disconnect();
    });

    expect(screen.getByTestId('reconnecting-banner').textContent).toContain(
      'Events may be missed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByTestId('timeline').textContent).toContain('host.ready');

    act(() => port.ready());
    expect(screen.queryByTestId('reconnecting-banner')).toBeNull();
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
    expect(forward.dataset.direction).toBe('forward');
    expect(forward.getAttribute('title')).toBe(
      'Host application sends host.open-widget to Widget · embedded',
    );
    expect(document.querySelector<HTMLElement>(
      '[data-signal-name="widget.self-transition"]',
    )?.dataset.direction).toBe('internal');
    expect(document.querySelector<HTMLElement>(
      '[data-signal-name="widget.local-cache-updated"]',
    )?.dataset.direction).toBe('internal');
    expect(screen.queryByLabelText('Timeline overview')).toBeNull();
    expect(screen.getAllByTestId('timeline-separator')).toHaveLength(2);
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
    expect(row.dataset.direction).toBe('reverse');
    expect(row.getAttribute('title')).toBe(
      'Widget · embedded sends widget.completed to Host application',
    );
    expect(screen.getAllByTestId('timeline-time').some(
      (time) => time.textContent === formatTime(occurredAt),
    )).toBe(true);
    expect(screen.getAllByTestId('timeline-time-entry').some(
      (entry) => entry.getAttribute('title')?.includes('2026-09-05T12:34:56.789Z'),
    )).toBe(true);
    expect(screen.queryByTestId('timeline-details')).toBeNull();

    const control = screen.getByRole('button', { name: 'widget.completed' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('timeline-details').textContent).toContain(
      '"result": "ok"',
    );

    const firstEventControl = screen.getByRole('button', {
      name: 'host.ready',
    });
    fireEvent.click(firstEventControl);
    expect(screen.getAllByTestId('timeline-details')).toHaveLength(2);

    fireEvent.click(control);
    expect(screen.getAllByTestId('timeline-details')).toHaveLength(1);
  });

  it('renders only the signal payload in the expanded log body', () => {
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

    const row = document.querySelector<HTMLElement>('[data-log-entry-type="signal"]')!;
    expect(row.textContent).toContain('widget.process.failed');
    expect(row.textContent).toContain('Host application');
    expect(row.textContent).toContain('UPSTREAM_TIMEOUT');
    expect(row.textContent).not.toContain('"protocol"');
    expect(row.textContent).not.toContain('"severity"');
    expect(row.textContent).not.toContain('correlation-42');
    expect(row.textContent).not.toContain('command-41');
    expect(row.textContent).not.toContain('checkout');
    expect(row.textContent).not.toContain('en-US');
    expect(row.textContent).not.toContain('document-77');
    expect(row.textContent).not.toContain('https://demo.example.test');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search log' }), {
      target: { value: 'document-77' },
    });
    expect(screen.getByTestId('log-empty-state').textContent).toContain('current filters');
  });

  it('shows an explicit empty payload message for signals without details', () => {
    const { port } = mountPanel();
    act(() => port.emitCapture(captured()));

    fireEvent.click(screen.getByRole('button', { name: 'Log' }));

    const row = document.querySelector<HTMLElement>('[data-log-entry-type="signal"]')!;
    expect(within(row).getByText('No payload.')).toBeTruthy();
  });

  it('shows browser console errors as first-class red error entries without changing state', () => {
    const { port, repository } = mountPanel();
    const consoleError = capturedError({
      error: {
        ...capturedError().error,
        id: 'console-error-1',
      },
    });

    act(() => port.emitError(consoleError));

    expect(screen.getByTestId('timeline').textContent).toContain('Browser Console');
    expect(screen.getByTestId('timeline').textContent).toContain('Checkout failed');
    const timelineError = document.querySelector<HTMLElement>('[data-entry-type="error"]')!;
    expect(timelineError.closest('.react-flow__node')?.classList).toContain('entry-error');
    expect(timelineError.textContent).toContain('Error');
    expect(timelineError.textContent).toContain('Checkout failed');
    expect(timelineError.dataset.errorName).toBe('console.error');
    expect(timelineError.dataset.signalName).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(screen.getByRole('checkbox', { name: 'Browser Console' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Error' }) as HTMLInputElement).checked).toBe(true);
    const errorRow = document.querySelector<HTMLElement>('[data-log-entry-type="error"]')!;
    expect(errorRow.classList).toContain('error');
    expect(within(errorRow).getByText('Error')).toBeTruthy();
    expect(errorRow.textContent).toContain('Checkout failed');
    expect(errorRow.textContent).toContain('console.error');
    expect(errorRow.textContent).toContain('checkout.js:1:1');
    expect(errorRow.textContent).toContain('PAYMENT_ERROR');
    expect(errorRow.textContent).not.toContain('"protocol"');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search log' }), {
      target: { value: 'checkout failed' },
    });
    expect(screen.getByTestId('log').textContent).toContain('Checkout failed');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search log' }), {
      target: { value: 'checkout.js:1:1' },
    });
    expect(screen.getByTestId('log').textContent).toContain('Checkout failed');

    fireEvent.click(screen.getByRole('button', { name: 'AI Log' }));
    const aiLog = screen.getByRole('textbox', { name: 'AI-ready Koshko log' }) as HTMLTextAreaElement;
    expect(aiLog.value).toContain('"kind":"error"');
    expect(aiLog.value).toContain('console.error');
    expect(aiLog.value).toContain('PAYMENT_ERROR');
    expect(repository.getDisplayState()).toEqual({});
    expect(repository.exportJsonl()).toContain('console-error-1');
    expect(repository.exportJsonl()).toContain('"errorCount":1');
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
    expect(repository.getSignals().length).toBe(0);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('renders global state mutations without adding them to timeline or export', () => {
    const { port, repository, downloadJsonl } = mountPanel();

    act(() =>
      port.emitStateMutation(
        capturedStateMutation([
          { op: 'add', path: '/checkout', value: { total: 100, currency: 'RUB' } },
        ]),
      ),
    );

    expect(screen.getByTestId('capture-status').textContent).toContain('0 events captured');
    expect(document.querySelectorAll('[data-signal-name]').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(screen.getByTestId('log-empty-state').textContent).toContain('No log entries match the current filters.');

    fireEvent.click(screen.getByRole('button', { name: 'Global State' }));
    const stateTree = expandGlobalState();
    expect(stateTree.textContent).toContain('checkout');
    expect(stateTree.textContent).toContain('total:100');
    expect(stateTree.textContent).toContain('currency:"RUB"');
    expect(screen.getByRole('button', { name: 'Global State' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('export-button'));
    expect(downloadJsonl).toHaveBeenCalledWith(expect.not.stringContaining('checkout'));
    expect(repository.getDisplayState()).toEqual({ checkout: { total: 100, currency: 'RUB' } });
  });

  it('inspects state history with pinned snapshots and live updates', () => {
    const { port } = mountPanel();
    const firstOccurredAt = Date.parse('2026-09-05T12:34:56.789Z');
    const first = capturedStateMutation(
      [{ op: 'add', path: '/checkout', value: { total: 100 } }],
      {
        mutation: {
          ...capturedStateMutation([]).mutation,
          id: 'mutation-1',
          label: 'Checkout initialized',
          producerId: 'checkout-store',
          occurredAt: firstOccurredAt,
          patch: [{ op: 'add', path: '/checkout', value: { total: 100 } }],
        },
      },
    );
    const second = capturedStateMutation(
      [{ op: 'replace', path: '/checkout/total', value: 200 }],
      {
        mutation: {
          ...capturedStateMutation([]).mutation,
          id: 'mutation-2',
          producerSequence: 2,
          producerId: 'pricing-store',
          occurredAt: firstOccurredAt + 1000,
          patch: [{ op: 'replace', path: '/checkout/total', value: 200 }],
        },
      },
    );

    act(() => {
      port.emitStateMutation(first);
      port.emitStateMutation(second);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Global State' }));

    const history = screen.getByTestId('state-history-list');
    expect(within(history).getAllByRole('button')).toHaveLength(3);
    expect(within(history).getByRole('button', { name: /Initial state/ }).textContent).toContain(
      'Before captured mutations',
    );
    expect(within(history).getByRole('button', { name: /Checkout initialized/ }).textContent).toContain(
      `${formatDateTime(firstOccurredAt)} · checkout-store`,
    );
    expect(within(history).getByRole('button', { name: /State mutation 2/ }).textContent).toContain(
      'pricing-store',
    );
    expect(screen.getByTestId('state-position').textContent).toBe('Live · following snapshot 3 of 3');
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Live' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(within(history).getByRole('button', { name: /Initial state/ }));
    expect(screen.getByLabelText('Selected global state').textContent).toContain('0 items');
    expect(screen.getByTestId('state-position').textContent).toBe('Snapshot 1 of 3 · pinned');
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(expandGlobalState().textContent).toContain('total:100');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Selected global state').textContent).toContain('200');
    expect(screen.getByTestId('state-position').textContent).toBe('Snapshot 3 of 3 · pinned');

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    act(() => port.emitStateMutation(capturedStateMutation(
      [{ op: 'replace', path: '/checkout/total', value: 300 }],
      {
        mutation: {
          ...capturedStateMutation([]).mutation,
          id: 'mutation-3',
          producerSequence: 3,
          patch: [{ op: 'replace', path: '/checkout/total', value: 300 }],
        },
      },
    )));
    expect(screen.getByLabelText('Selected global state').textContent).toContain('100');
    expect(screen.getByTestId('state-position').textContent).toBe('Snapshot 2 of 4 · pinned');

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByLabelText('Selected global state').textContent).toContain('300');
    expect(screen.getByTestId('state-position').textContent).toBe('Live · following snapshot 4 of 4');

    fireEvent.click(screen.getByTestId('clear-button'));
    expect(within(screen.getByTestId('state-history-list')).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('state-position').textContent).toBe('Live · following snapshot 1 of 1');
    expect(screen.getByLabelText('Selected global state').textContent).toContain('0 items');
  });

  it('resets pinned state history when the top-level document changes', () => {
    const { port } = mountPanel();
    act(() => port.emitStateMutation(capturedStateMutation([
      { op: 'add', path: '/before-navigation', value: true },
    ])));
    fireEvent.click(screen.getByRole('button', { name: 'Global State' }));
    fireEvent.click(within(screen.getByTestId('state-history-list')).getByRole('button', {
      name: /Initial state/,
    }));

    act(() => port.emitStateMutation(capturedStateMutation(
      [{ op: 'add', path: '/after-navigation', value: true }],
      {
        navigationId: 'navigation-2',
        mutation: {
          ...capturedStateMutation([]).mutation,
          id: 'navigation-mutation',
          patch: [{ op: 'add', path: '/after-navigation', value: true }],
        },
      },
    )));

    expect(within(screen.getByTestId('state-history-list')).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('state-position').textContent).toBe('Live · following snapshot 2 of 2');
    expect(screen.getByTestId('global-state').textContent).toContain('after-navigation');
    expect(screen.getByTestId('global-state').textContent).not.toContain('before-navigation');
  });

  it('searches within the selected state snapshot', async () => {
    const { port } = mountPanel();
    act(() => {
      port.emitStateMutation(capturedStateMutation([
        { op: 'add', path: '/checkout', value: { total: 100 } },
      ]));
      port.emitStateMutation(capturedStateMutation(
        [{ op: 'replace', path: '/checkout/total', value: 200 }],
        {
          mutation: {
            ...capturedStateMutation([]).mutation,
            id: 'mutation-2',
            producerSequence: 2,
            patch: [{ op: 'replace', path: '/checkout/total', value: 200 }],
          },
        },
      ));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Global State' }));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search global state nodes' }), {
      target: { value: 'total' },
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Selected global state').textContent).toContain('total:200');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Selected global state').textContent).toContain('total:100');
    });
  });

  it('filters the combined log by substring, actor, and entry type while retaining filters between tabs', () => {
    const { port } = mountPanel();
    const widget = { id: 'widget', label: 'Widget', instanceId: 'embedded' };

    act(() => {
      port.emitCapture(captured({
        signal: {
          ...captured().signal,
          id: 'matched-signal',
          name: 'host.to-widget',
          target: widget,
          details: { marker: 'Needle' },
        },
      }));
      port.emitCapture(captured({
        signal: {
          ...captured().signal,
          id: 'other-signal',
          producerSequence: 2,
          source: { id: 'other', label: 'Other' },
          name: 'other.event',
        },
      }));
      port.emitError(capturedError({
        error: {
          ...capturedError().error,
          id: 'matched-error',
          producerSequence: 3,
          payload: { message: 'Needle error' },
        },
      }));
      port.emitStateMutation(capturedStateMutation([
        { op: 'add', path: '/marker', value: 'Needle state' },
      ]));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect((screen.getByRole('checkbox', { name: 'Signal' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Error' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'State' }) as HTMLInputElement).checked).toBe(false);
    expect(document.querySelectorAll('[data-log-entry-type="signal"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-log-entry-type="error"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-log-entry-type="state"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Host application' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    expect(document.querySelectorAll('[data-log-entry-type="signal"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-log-entry-type="error"]')).toHaveLength(1);
    expect(screen.getByTestId('log').textContent).toContain('host.to-widget');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search log' }), {
      target: { value: 'nEeDlE' },
    });
    expect(screen.getByTestId('log').textContent).toContain('host.to-widget');

    fireEvent.click(screen.getByRole('checkbox', { name: 'State' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Signal' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Error' }));
    expect(screen.getByTestId('log-empty-state').textContent).toContain('current filters');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Host application' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    expect(document.querySelectorAll('[data-log-entry-type="state"]')).toHaveLength(1);
    expect(screen.getByTestId('log').textContent).toContain('State');

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect((screen.getByRole('searchbox', { name: 'Search log' }) as HTMLInputElement).value).toBe('nEeDlE');

    act(() => port.emitCapture(captured({
      signal: {
        ...captured().signal,
        id: 'fresh-signal',
        producerSequence: 3,
        source: { id: 'fresh', label: 'Fresh actor' },
        name: 'fresh.event',
      },
    })));
    expect((screen.getByRole('checkbox', { name: 'Fresh actor' }) as HTMLInputElement).checked).toBe(true);
  });

  it('keeps actor filtering active when stale actor selections remain after clear', () => {
    const { port } = mountPanel();

    act(() => {
      port.emitCapture(captured());
      port.emitCapture(captured({
        signal: {
          ...captured().signal,
          id: 'other-signal',
          producerSequence: 2,
          source: { id: 'other', label: 'Other' },
          name: 'other.event',
        },
      }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Host application' }));
    fireEvent.click(screen.getByTestId('clear-button'));

    act(() => {
      port.emitCapture(captured({
        signal: {
          ...captured().signal,
          id: 'fresh-signal',
          source: { id: 'fresh', label: 'Fresh actor' },
          name: 'fresh.event',
        },
      }));
      port.emitStateMutation(capturedStateMutation([
        { op: 'add', path: '/retained', value: true },
      ]));
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fresh actor' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'State' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Signal' }));

    expect(screen.getByTestId('log-empty-state').textContent).toContain('current filters');
  });

  it('buffers state while paused and preserves the prior state for an invalid patch', () => {
    const { port, repository } = mountPanel();
    act(() =>
      port.emitStateMutation(
        capturedStateMutation([{ op: 'add', path: '/ready', value: true }]),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Global State' }));
    const stateTree = expandGlobalState();
    expect(stateTree.textContent).toContain('ready:true');

    fireEvent.click(screen.getByTestId('pause-button'));
    act(() =>
      port.emitStateMutation(
        capturedStateMutation(
          [{ op: 'replace', path: '/ready', value: false }],
          { mutation: { ...capturedStateMutation([]).mutation, id: 'mutation-2', producerSequence: 2, patch: [{ op: 'replace', path: '/ready', value: false }] } },
        ),
      ),
    );
    expect(stateTree.textContent).toContain('ready:true');
    expect(screen.getByTestId('capture-status').textContent).toContain('+1 unread');

    fireEvent.click(screen.getByTestId('pause-button'));
    expect(stateTree.textContent).toContain('ready:false');

    act(() =>
      port.emitStateMutation(
        capturedStateMutation(
          [{ op: 'replace', path: '/missing', value: true }],
          { mutation: { ...capturedStateMutation([]).mutation, id: 'mutation-3', producerSequence: 3, patch: [{ op: 'replace', path: '/missing', value: true }] } },
        ),
      ),
    );
    expect(repository.getDisplayState()).toEqual({ ready: false });
    expect(stateTree.textContent).toContain('ready:false');
  });

  it('builds a live AI-ready log with a persistent budget and copies the exact preview', async () => {
    const { port, copyText } = mountPanel();
    fireEvent.click(screen.getByRole('button', { name: 'AI Log' }));

    const budget = screen.getByRole('combobox', { name: 'AI log context budget' }) as HTMLSelectElement;
    const preview = screen.getByRole('textbox', { name: 'AI-ready Koshko log' }) as HTMLTextAreaElement;
    expect(budget.value).toBe('16k');
    expect(preview.value).toContain('"capturedEntries":0');

    act(() => port.emitCapture(captured()));
    expect(preview.value).toContain('"id":"signal-1"');

    fireEvent.click(screen.getByTestId('pause-button'));
    act(() => port.emitCapture(captured({
      signal: {
        ...captured().signal,
        id: 'buffered-ai',
        producerSequence: 2,
        name: 'host.buffered-ai',
      },
    })));
    expect(preview.value).not.toContain('buffered-ai');

    fireEvent.click(screen.getByTestId('pause-button'));
    expect(preview.value).toContain('buffered-ai');
    fireEvent.change(budget, { target: { value: '8k' } });
    expect(budget.value).toBe('8k');

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI Log' }));
    expect((screen.getByRole('combobox', { name: 'AI log context budget' }) as HTMLSelectElement).value).toBe('8k');

    const currentPreview = (screen.getByRole('textbox', { name: 'AI-ready Koshko log' }) as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));

    await waitFor(() => expect(copyText).toHaveBeenCalledWith(currentPreview));
    expect(screen.getByText('Copied AI-ready log.')).toBeTruthy();
  });

  it('keeps the AI log selectable when clipboard access fails', async () => {
    const mounted = mountPanel();
    mounted.copyText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'AI Log' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Clipboard access failed. Select and copy the text manually.',
    );
    expect((screen.getByRole('textbox', { name: 'AI-ready Koshko log' }) as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('unsubscribes from the port on unmount', () => {
    const { port, unmount } = mountPanel();

    expect(port.listenerCount).toBe(2);

    unmount();

    expect(port.listenerCount).toBe(0);
  });
});
