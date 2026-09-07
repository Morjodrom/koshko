import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleActionClick, PermissionCoordinator } from './permission-coordinator';
import { CONTENT_SCRIPT_JS_PATH, STORAGE_KEY } from './shared';

interface FakeChromeState {
  stored: string[];
  grantedPatterns: Set<string>;
  registered: chrome.scripting.RegisteredContentScript[];
  register: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  executeScript: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  setBadgeText: ReturnType<typeof vi.fn>;
  setTitle: ReturnType<typeof vi.fn>;
}

describe('permission coordinator', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('persists one real Chrome site scope and immediately injects only the top frame', async () => {
    const state = installChrome({
      grantedPatterns: ['https://demo.example.test/*'],
    });
    const coordinator = new PermissionCoordinator();

    const result = await coordinator.activate('https://demo.example.test:8443/path', 17);

    expect(result).toEqual({ ok: true, captureStarted: true });
    expect(state.stored).toEqual(['https://demo.example.test']);
    expect(state.register).toHaveBeenCalledWith([expect.objectContaining({
      id: 'koshko-capture-https-demo-example-test',
      matches: ['https://demo.example.test/*'],
      allFrames: true,
    })]);
    expect(state.executeScript).toHaveBeenCalledWith({
      target: { tabId: 17, frameIds: [0] },
      files: [CONTENT_SCRIPT_JS_PATH],
      injectImmediately: true,
    });
  });

  it('reconciles native grants and removals and cleans legacy capture script ids', async () => {
    const state = installChrome({
      stored: [
        'https://kept.example.test',
        'https://removed.example.test',
      ],
      grantedPatterns: [
        'https://kept.example.test/*',
        'https://native.example.test/*',
      ],
      registered: [
        script('koshko-capture-https-kept-example-test', 'https://kept.example.test/*'),
        script('koshko-http-removed-example-test', 'https://removed.example.test/*'),
        script('koshko-https-old-example-test', 'https://old.example.test/*'),
        script('another-extension-script', 'https://unrelated.example.test/*'),
      ],
    });
    const coordinator = new PermissionCoordinator();

    const origins = await coordinator.reconcile();

    expect(origins).toEqual([
      'https://kept.example.test',
      'https://native.example.test',
    ]);
    expect(state.stored).toEqual(origins);
    expect(state.unregister).toHaveBeenCalledWith({
      ids: ['koshko-http-removed-example-test'],
    });
    expect(state.unregister).toHaveBeenCalledWith({
      ids: ['koshko-https-old-example-test'],
    });
    expect(state.unregister).not.toHaveBeenCalledWith({
      ids: ['another-extension-script'],
    });
    expect(state.update).toHaveBeenCalledWith([expect.objectContaining({
      id: 'koshko-capture-https-kept-example-test',
    })]);
    expect(state.register).toHaveBeenCalledWith([expect.objectContaining({
      id: 'koshko-capture-https-native-example-test',
    })]);
  });

  it('requests toolbar access in the click handler and reports successful capture', async () => {
    const state = installChrome();
    const order: string[] = [];
    state.request.mockImplementation(async () => {
      order.push('request');
      return true;
    });
    const activate = vi.fn(async () => {
      order.push('activate');
      return { ok: true, captureStarted: true };
    });

    await handleActionClick({
      id: 8,
      url: 'https://action.example.test:9443/path',
    } as chrome.tabs.Tab, { activate });

    expect(order).toEqual(['request', 'activate']);
    expect(state.request).toHaveBeenCalledWith({
      origins: ['https://action.example.test/*'],
    });
    expect(activate).toHaveBeenCalledWith('https://action.example.test', 8);
    expect(state.setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: 'ON' });
    expect(state.setTitle).toHaveBeenCalledWith({
      tabId: 8,
      title: 'Koshko is capturing new events from https://action.example.test',
    });
  });

  it('does not activate toolbar capture when access is denied', async () => {
    const state = installChrome();
    state.request.mockResolvedValue(false);
    const activate = vi.fn();

    await handleActionClick({
      id: 8,
      url: 'https://denied.example.test',
    } as chrome.tabs.Tab, { activate });

    expect(activate).not.toHaveBeenCalled();
    expect(state.setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: '?' });
  });
});

function installChrome({
  stored = [],
  grantedPatterns = [],
  registered = [],
}: {
  stored?: string[];
  grantedPatterns?: string[];
  registered?: chrome.scripting.RegisteredContentScript[];
} = {}): FakeChromeState {
  const state: FakeChromeState = {
    stored: [...stored],
    grantedPatterns: new Set(grantedPatterns),
    registered: [...registered],
    register: vi.fn(async (scripts: chrome.scripting.RegisteredContentScript[]) => {
      state.registered.push(...scripts);
    }),
    update: vi.fn(async (scripts: chrome.scripting.RegisteredContentScript[]) => {
      for (const updated of scripts) {
        const index = state.registered.findIndex((current) => current.id === updated.id);
        if (index >= 0) state.registered[index] = updated;
      }
    }),
    unregister: vi.fn(async ({ ids }: { ids?: string[] }) => {
      state.registered = state.registered.filter((current) => !ids?.includes(current.id));
    }),
    executeScript: vi.fn().mockResolvedValue([]),
    request: vi.fn().mockResolvedValue(true),
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async ({ origins }: { origins?: string[] }) =>
        (origins ?? []).every((pattern) => state.grantedPatterns.has(pattern))),
      getAll: vi.fn(async () => ({ origins: [...state.grantedPatterns] })),
      request: state.request,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ [STORAGE_KEY]: state.stored })),
        set: vi.fn(async (value: Record<string, string[]>) => {
          state.stored = [...value[STORAGE_KEY]];
        }),
      },
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => state.registered),
      registerContentScripts: state.register,
      updateContentScripts: state.update,
      unregisterContentScripts: state.unregister,
      executeScript: state.executeScript,
    },
    action: {
      setBadgeText: state.setBadgeText,
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setTitle: state.setTitle,
    },
  });
  return state;
}

function script(id: string, match: string): chrome.scripting.RegisteredContentScript {
  return { id, js: [CONTENT_SCRIPT_JS_PATH], matches: [match] };
}
