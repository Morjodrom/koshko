import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelAccessController } from './panel-access';
import { PANEL_MESSAGE_ACTIVATE_ORIGIN } from './shared';

describe('panel access controller', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('inspects the target, requests permission directly, and activates capture', async () => {
    const calls: string[] = [];
    const { request, sendMessage } = installChrome({
      url: 'https://demo.example.test:5173/page',
      granted: false,
    });
    request.mockImplementation(async () => {
      calls.push('request');
      return true;
    });
    sendMessage.mockImplementation(async () => {
      calls.push('activate');
      return { ok: true, captureStarted: true };
    });
    const controller = createPanelAccessController(17);
    const snapshot = await controller.inspect();

    expect(snapshot).toEqual({
      supported: true,
      site: {
        origin: 'https://demo.example.test',
        matchPattern: 'https://demo.example.test/*',
      },
      granted: false,
    });
    if (!snapshot.supported) throw new Error('Expected a supported page.');

    const result = await controller.grant(snapshot.site);

    expect(calls).toEqual(['request', 'activate']);
    expect(request).toHaveBeenCalledWith({
      origins: ['https://demo.example.test/*'],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE_ACTIVATE_ORIGIN,
      origin: 'https://demo.example.test',
      tabId: 17,
    });
    expect(result).toEqual({
      granted: true,
      captureStarted: true,
      message: undefined,
    });
  });

  it('does not activate capture after denial and rejects restricted pages', async () => {
    const { request, sendMessage } = installChrome({
      url: 'chrome://extensions',
      granted: false,
    });
    request.mockResolvedValue(false);
    const controller = createPanelAccessController(17);

    expect(await controller.inspect()).toEqual({
      supported: false,
      message: 'Only http and https origins can be granted.',
    });
    const result = await controller.grant({
      origin: 'https://denied.example.test',
      matchPattern: 'https://denied.example.test/*',
    });

    expect(result).toEqual({
      granted: false,
      message: 'Access was not granted. Koshko did not read this page.',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('activates an already granted native permission without requesting again', async () => {
    const { request, sendMessage } = installChrome({
      url: 'https://native.example.test',
      granted: true,
    });
    const controller = createPanelAccessController(17);
    const site = {
      origin: 'https://native.example.test',
      matchPattern: 'https://native.example.test/*',
    };

    const result = await controller.activate(site);

    expect(request).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE_ACTIVATE_ORIGIN,
      origin: 'https://native.example.test',
      tabId: 17,
    });
    expect(result).toEqual({
      granted: true,
      captureStarted: true,
      message: undefined,
    });
  });

  it('tracks inspected navigation and browser-side permission changes', () => {
    const { navigated, added, removed } = installChrome({
      url: 'https://demo.example.test',
      granted: true,
    });
    const listener = vi.fn();
    const controller = createPanelAccessController(17);

    const unsubscribe = controller.subscribe(listener);
    navigated.emit('https://next.example.test/path');
    added.emit({ origins: ['https://next.example.test/*'] });
    removed.emit({ origins: ['https://demo.example.test/*'] });

    expect(listener).toHaveBeenNthCalledWith(1, {
      kind: 'navigation',
      url: 'https://next.example.test/path',
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      kind: 'permission-added',
      origins: ['https://next.example.test/*'],
    });
    expect(listener).toHaveBeenNthCalledWith(3, {
      kind: 'permission-removed',
    });
    unsubscribe();
    expect(navigated.listenerCount).toBe(0);
    expect(added.listenerCount).toBe(0);
    expect(removed.listenerCount).toBe(0);
  });
});

function installChrome({
  url,
  granted,
}: {
  url: string;
  granted: boolean;
}): {
  request: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  navigated: FakeEvent<(url: string) => void>;
  added: FakeEvent<(permissions: chrome.permissions.Permissions) => void>;
  removed: FakeEvent<(permissions: chrome.permissions.Permissions) => void>;
} {
  const request = vi.fn().mockResolvedValue(true);
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, captureStarted: true });
  const navigated = new FakeEvent<(url: string) => void>();
  const added = new FakeEvent<(permissions: chrome.permissions.Permissions) => void>();
  const removed = new FakeEvent<(permissions: chrome.permissions.Permissions) => void>();
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn().mockResolvedValue(granted),
      request,
      onAdded: added,
      onRemoved: removed,
    },
    runtime: { sendMessage },
    devtools: {
      inspectedWindow: {
        eval: vi.fn((_expression: string, callback: (result: unknown) => void) => callback(url)),
        reload: vi.fn(),
      },
      network: { onNavigated: navigated },
    },
  });
  return { request, sendMessage, navigated, added, removed };
}

class FakeEvent<T extends (...args: never[]) => void> {
  private readonly listeners = new Set<T>();

  addListener(listener: T): void {
    this.listeners.add(listener);
  }

  removeListener(listener: T): void {
    this.listeners.delete(listener);
  }

  emit(...args: Parameters<T>): void {
    for (const listener of this.listeners) listener(...args);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
