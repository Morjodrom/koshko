import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRIDGE_URL,
  normalizeBridgeSettings,
  setStoredBridgeSettings,
  validateBridgeSettings,
  validateBridgeUrl,
} from './settings';

describe('bridge settings', () => {
  it('accepts only literal loopback ws URLs', () => {
    expect(validateBridgeUrl(DEFAULT_BRIDGE_URL)).toBeUndefined();
    expect(validateBridgeUrl('ws://[::1]:34717/bridge')).toBeUndefined();
    expect(validateBridgeUrl('wss://127.0.0.1/bridge')).toBeTruthy();
    expect(validateBridgeUrl('ws://localhost:34717/bridge')).toBeTruthy();
    expect(validateBridgeUrl('ws://127.0.0.1/?token=value')).toBeTruthy();
    expect(validateBridgeUrl('ws://user@127.0.0.1/bridge')).toBeTruthy();
  });

  it('is disabled by default and requires a valid token before enabling', async () => {
    expect(normalizeBridgeSettings(undefined)).toMatchObject({ enabled: false, url: DEFAULT_BRIDGE_URL, token: '' });
    expect(validateBridgeSettings({ enabled: true, url: DEFAULT_BRIDGE_URL, token: 'short' })).toContain('Token');
    const set = async (): Promise<void> => undefined;
    await expect(setStoredBridgeSettings({ enabled: true, url: DEFAULT_BRIDGE_URL, token: 'x'.repeat(32) }, { get: async () => ({}), set })).resolves.toMatchObject({ enabled: true });
  });
});
