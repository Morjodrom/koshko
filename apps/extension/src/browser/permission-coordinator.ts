import { normalizeOriginList, matchPatternToOrigin, normalizeOrigin, originToMatchPattern } from './origins';
import { getStoredOrigins, setStoredOrigins, syncRegisteredContentScripts } from './registry';
import { CONTENT_SCRIPT_JS_PATH, type ActivationResponse } from '../messaging/messages';

export class PermissionCoordinator {
  private queue: Promise<void> = Promise.resolve();

  activate(originInput: string, tabId?: number): Promise<ActivationResponse> {
    return this.enqueue(async () => {
      let origin: string;
      try {
        origin = normalizeOrigin(originInput);
      } catch (error) {
        return failure(error, 'The requested site is not supported.');
      }

      try {
        const granted = await chrome.permissions.contains({
          origins: [originToMatchPattern(origin)],
        });
        if (!granted) {
          return {
            ok: false,
            captureStarted: false,
            error: 'Site access was not granted.',
          };
        }

        const origins = normalizeOriginList([...(await getStoredOrigins()), origin]);
        await setStoredOrigins(origins);
        await syncRegisteredContentScripts(origins);
      } catch (error) {
        return failure(error, 'Could not register capture for this site.');
      }

      if (tabId == null) {
        return { ok: true, captureStarted: false };
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          files: [CONTENT_SCRIPT_JS_PATH],
          injectImmediately: true,
        });
        return { ok: true, captureStarted: true };
      } catch (error) {
        return failure(
          error,
          'Access was saved, but capture could not start in the current page.',
        );
      }
    });
  }

  reconcile(): Promise<string[]> {
    return this.enqueue(async () => {
      const stored = await getStoredOrigins();
      const permissions = await chrome.permissions.getAll();
      const discovered = (permissions.origins ?? [])
        .map((pattern) => matchPatternToOrigin(pattern))
        .filter((origin): origin is string => origin !== null);
      const candidates = normalizeOriginList([...stored, ...discovered]);
      const checks = await Promise.all(candidates.map(async (origin) => ({
        origin,
        granted: await chrome.permissions.contains({
          origins: [originToMatchPattern(origin)],
        }),
      })));
      const granted = checks
        .filter((check) => check.granted)
        .map((check) => check.origin);

      await setStoredOrigins(granted);
      await syncRegisteredContentScripts(granted);
      return granted;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function failure(error: unknown, fallback: string): ActivationResponse {
  return {
    ok: false,
    captureStarted: false,
    error: error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback,
  };
}

export function requestSitePermission(origin: string): Promise<boolean> {
  // Keep this browser call as the first asynchronous action. Chrome accepts a
  // permission prompt only while the panel/button click's user gesture is live.
  return chrome.permissions.request({
    origins: [originToMatchPattern(origin)],
  });
}

export async function handleActionClick(
  tab: chrome.tabs.Tab,
  coordinator: Pick<PermissionCoordinator, 'activate'>,
): Promise<void> {
  const tabId = tab.id;
  let origin: string;
  try {
    if (tabId == null || !tab.url) {
      throw new Error('This browser page cannot be inspected.');
    }
    origin = normalizeOrigin(tab.url);
  } catch (error) {
    await setActionFeedback(
      tabId,
      '!',
      error instanceof Error ? error.message : 'This browser page cannot be inspected.',
      '#8c3d2f',
    );
    return;
  }

  let granted: boolean;
  try {
    granted = await requestSitePermission(origin);
  } catch (error) {
    await setActionFeedback(
      tabId,
      '!',
      error instanceof Error ? error.message : 'Could not request site access.',
      '#8c3d2f',
    );
    return;
  }

  if (!granted) {
    await setActionFeedback(
      tabId,
      '?',
      `Koshko access was not granted for ${origin}`,
      '#a66718',
    );
    return;
  }

  const result = await coordinator.activate(origin, tabId);
  await setActionFeedback(
    tabId,
    result.ok && result.captureStarted ? 'ON' : '!',
    result.ok && result.captureStarted
      ? `Koshko is capturing new events from ${origin}`
      : (result.error ?? `Koshko could not start capture for ${origin}`),
    result.ok && result.captureStarted ? '#278358' : '#8c3d2f',
  );
}

async function setActionFeedback(
  tabId: number | undefined,
  text: string,
  title: string,
  color: string,
): Promise<void> {
  const details = tabId == null ? {} : { tabId };
  await Promise.all([
    chrome.action.setBadgeText({ ...details, text }),
    chrome.action.setBadgeBackgroundColor({ ...details, color }),
    chrome.action.setTitle({ ...details, title }),
  ]);
}
