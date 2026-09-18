import {
  USER_EVENT_MESSAGE,
  USER_EVENT_TRACKING_STORAGE_KEY,
  USER_EVENT_TRACKING_VERSION,
  getComposedPathTarget,
  getUserEventTrackingEnabled,
  type UserEventType,
} from './user-event-tracking';

const USER_EVENT_CAPTURE_STATE = Symbol.for('koshko.user-event-capture.v1');

interface UserEventCaptureGlobal extends Window {
  [USER_EVENT_CAPTURE_STATE]?: { stop: () => void };
}

/** Starts opt-in, metadata-only interaction capture for a document. */
export async function startUserEventTracking(): Promise<() => void> {
  const captureGlobal = window as UserEventCaptureGlobal;
  const existing = captureGlobal[USER_EVENT_CAPTURE_STATE];
  if (existing) return existing.stop;

  const navigationId = createNavigationId();
  let sequence = 0;
  let enabled = await getUserEventTrackingEnabled().catch(() => false);
  let stopped = false;

  const send = (eventType: UserEventType, event?: Event): void => {
    if (!enabled || stopped) return;
    const message = {
      type: USER_EVENT_MESSAGE,
      version: USER_EVENT_TRACKING_VERSION,
      eventType,
      sequence: ++sequence,
      occurredAt: Date.now(),
      navigationId,
      frameUrl: location.href,
      frameOrigin: location.origin,
      ...(event ? { target: getComposedPathTarget(event) } : {}),
    };
    void chrome.runtime.sendMessage(message).catch(() => {});
  };
  const onClick = (event: MouseEvent): void => send('click', event);
  const onChange = (event: Event): void => send('change', event);
  const onSubmit = (event: SubmitEvent): void => send('submit', event);
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName === 'local' && changes[USER_EVENT_TRACKING_STORAGE_KEY]) {
      enabled = changes[USER_EVENT_TRACKING_STORAGE_KEY].newValue === true;
    }
  };

  // Capture phase and composedPath() preserve interactions from nested elements and Shadow DOM.
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  chrome.storage.onChanged.addListener(onStorageChanged);
  if (enabled) send('page-open');

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
    chrome.storage.onChanged.removeListener(onStorageChanged);
    if (captureGlobal[USER_EVENT_CAPTURE_STATE]?.stop === stop) delete captureGlobal[USER_EVENT_CAPTURE_STATE];
  };
  captureGlobal[USER_EVENT_CAPTURE_STATE] = { stop };
  return stop;
}

function createNavigationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
