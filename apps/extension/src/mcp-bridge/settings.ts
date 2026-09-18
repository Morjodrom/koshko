import { isBridgeAuthToken } from '@koshko/bridge';

export const BRIDGE_SETTINGS_STORAGE_KEY = 'koshko.mcpBridgeSettings.v1';
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:34717/bridge';

export interface BridgeSettings {
  enabled: boolean;
  url: string;
  token: string;
}

export interface BridgeStorageArea {
  get(defaults: Record<string, unknown>): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_BRIDGE_SETTINGS: Readonly<BridgeSettings> = Object.freeze({
  enabled: false,
  url: DEFAULT_BRIDGE_URL,
  token: '',
});

export function validateBridgeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'ws:' || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]' && url.hostname !== '::1')) {
      return 'Use ws://127.0.0.1 or ws://[::1].';
    }
    if (url.username || url.password || url.search || url.hash) {
      return 'Bridge URL cannot contain credentials, query parameters, or a fragment.';
    }
    return undefined;
  } catch {
    return 'Enter a valid loopback WebSocket URL.';
  }
}

export function validateBridgeSettings(settings: BridgeSettings): string | undefined {
  if (!settings.enabled) return undefined;
  return validateBridgeUrl(settings.url) ?? (isBridgeAuthToken(settings.token)
    ? undefined
    : 'Token must contain 32–256 letters, numbers, underscores, or hyphens.');
}

export function normalizeBridgeSettings(value: unknown): BridgeSettings {
  if (!isRecord(value)) return { ...DEFAULT_BRIDGE_SETTINGS };
  return {
    enabled: value.enabled === true,
    url: typeof value.url === 'string' ? value.url : DEFAULT_BRIDGE_URL,
    token: typeof value.token === 'string' ? value.token : '',
  };
}

export async function getStoredBridgeSettings(storage: BridgeStorageArea = chrome.storage.local): Promise<BridgeSettings> {
  const stored = await storage.get({ [BRIDGE_SETTINGS_STORAGE_KEY]: DEFAULT_BRIDGE_SETTINGS });
  return normalizeBridgeSettings(stored[BRIDGE_SETTINGS_STORAGE_KEY]);
}

export async function setStoredBridgeSettings(
  settings: BridgeSettings,
  storage: BridgeStorageArea = chrome.storage.local,
): Promise<BridgeSettings> {
  const normalized = normalizeBridgeSettings(settings);
  const error = validateBridgeSettings(normalized);
  if (error) throw new Error(error);
  await storage.set({ [BRIDGE_SETTINGS_STORAGE_KEY]: normalized });
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
