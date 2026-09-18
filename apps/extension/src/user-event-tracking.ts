export const USER_EVENT_TRACKING_STORAGE_KEY = 'koshko:user-event-tracking';
export const USER_EVENT_TRACKING_VERSION = 1;
export const USER_EVENT_MESSAGE = 'koshko:user-event';

export type UserEventType = 'page-open' | 'click' | 'change' | 'submit';

export interface UserEventTarget {
  tagName: string;
  path: string[];
  role?: string;
  inputType?: string;
}

export interface UserEventMessage {
  type: typeof USER_EVENT_MESSAGE;
  version: typeof USER_EVENT_TRACKING_VERSION;
  eventType: UserEventType;
  sequence: number;
  occurredAt: number;
  target?: UserEventTarget;
  navigationId: string;
  frameUrl: string;
  frameOrigin: string;
}

export function isUserEventTrackingEnabled(value: unknown): boolean {
  return value === true;
}

export async function getUserEventTrackingEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get({ [USER_EVENT_TRACKING_STORAGE_KEY]: false });
  return isUserEventTrackingEnabled(stored[USER_EVENT_TRACKING_STORAGE_KEY]);
}

export async function setUserEventTrackingEnabled(enabled: boolean): Promise<boolean> {
  await chrome.storage.local.set({ [USER_EVENT_TRACKING_STORAGE_KEY]: enabled });
  return enabled;
}

export function parseUserEventMessage(value: unknown): UserEventMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.type !== USER_EVENT_MESSAGE
    || record.version !== USER_EVENT_TRACKING_VERSION
    || !isUserEventType(record.eventType)
    || !isPositiveSafeInteger(record.sequence)
    || !isSafeTimestamp(record.occurredAt)
    || !isNonEmptyText(record.navigationId, 160)
    || !isNonEmptyText(record.frameUrl, 4_096)
    || !isNonEmptyText(record.frameOrigin, 1_024)
  ) return undefined;

  const target = record.target === undefined ? undefined : parseUserEventTarget(record.target);
  if (record.target !== undefined && !target) return undefined;
  return {
    type: USER_EVENT_MESSAGE,
    version: USER_EVENT_TRACKING_VERSION,
    eventType: record.eventType,
    sequence: record.sequence,
    occurredAt: record.occurredAt,
    navigationId: record.navigationId,
    frameUrl: record.frameUrl,
    frameOrigin: record.frameOrigin,
    ...(target ? { target } : {}),
  };
}

export function getComposedPathTarget(event: Event): UserEventTarget | undefined {
  let path: EventTarget[];
  try {
    path = event.composedPath();
  } catch {
    return undefined;
  }

  const elements = path.filter((candidate): candidate is Element => candidate instanceof Element).slice(0, 6);
  const element = elements[0];
  if (!element) return undefined;
  const tagName = element.tagName.toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(tagName)) return undefined;

  const role = safeAttribute(element, 'role');
  const inputType = tagName === 'input' ? safeInputType(element) : undefined;
  return {
    tagName,
    path: elements.map((candidate) => candidate.tagName.toLowerCase()),
    ...(role ? { role } : {}),
    ...(inputType ? { inputType } : {}),
  };
}

function parseUserEventTarget(value: unknown): UserEventTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyText(record.tagName, 64) || !Array.isArray(record.path) || record.path.length > 6
    || record.path.some((part) => !isNonEmptyText(part, 64))) return undefined;
  if (record.role !== undefined && !isNonEmptyText(record.role, 64)) return undefined;
  if (record.inputType !== undefined && !isNonEmptyText(record.inputType, 32)) return undefined;
  return {
    tagName: record.tagName,
    path: [...record.path],
    ...(typeof record.role === 'string' ? { role: record.role } : {}),
    ...(typeof record.inputType === 'string' ? { inputType: record.inputType } : {}),
  };
}

function isUserEventType(value: unknown): value is UserEventType {
  return value === 'page-open' || value === 'click' || value === 'change' || value === 'submit';
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function safeAttribute(element: Element, name: string): string | undefined {
  try {
    const value = element.getAttribute(name)?.trim();
    return value && /^[a-z][a-z0-9-]{0,63}$/i.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function safeInputType(element: Element): string | undefined {
  try {
    const type = element.getAttribute('type')?.toLowerCase() ?? 'text';
    return ['button', 'checkbox', 'color', 'date', 'email', 'file', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url'].includes(type)
      ? type
      : undefined;
  } catch {
    return undefined;
  }
}
