import { afterEach, describe, expect, it, vi } from 'vitest';
import { startUserEventTracking } from './user-event-capture';
import { USER_EVENT_MESSAGE, USER_EVENT_TRACKING_STORAGE_KEY } from './user-event-tracking';

describe('user event capture', () => {
  let enabled = false;
  let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((stop) => stop());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  function stubChrome(): ReturnType<typeof vi.fn> {
    const sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: {
        local: { get: vi.fn(async () => ({ [USER_EVENT_TRACKING_STORAGE_KEY]: enabled })) },
        onChanged: {
          addListener: vi.fn((listener) => { storageListener = listener; }),
          removeListener: vi.fn(),
        },
      },
    });
    return sendMessage;
  }

  it('remains off by default and does not capture page interactions', async () => {
    enabled = false;
    const sendMessage = stubChrome();
    cleanups.push(await startUserEventTracking());

    document.body.click();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('records a page open and capture-phase Shadow DOM clicks only when explicitly enabled', async () => {
    enabled = true;
    const sendMessage = stubChrome();
    cleanups.push(await startUserEventTracking());
    const host = document.createElement('x-control');
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'never captured';
    shadow.append(button);
    document.body.append(host);

    button.click();

    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: USER_EVENT_MESSAGE,
      eventType: 'page-open',
      sequence: 1,
    }));
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'click',
      sequence: 2,
      target: expect.objectContaining({ tagName: 'button', path: expect.arrayContaining(['button', 'x-control']) }),
    }));
    expect(JSON.stringify(sendMessage.mock.calls[1][0])).not.toContain('never captured');
  });

  it('begins interaction capture after the persisted setting changes to enabled', async () => {
    enabled = false;
    const sendMessage = stubChrome();
    cleanups.push(await startUserEventTracking());
    storageListener?.({ [USER_EVENT_TRACKING_STORAGE_KEY]: { newValue: true } as chrome.storage.StorageChange }, 'local');

    document.body.click();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'click' }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'page-open' }));
  });
});
