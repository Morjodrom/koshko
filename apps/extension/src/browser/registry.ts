import { CONTENT_SCRIPT_JS_PATH, CONTENT_SCRIPT_ID_PREFIX, STORAGE_KEY } from '../messaging/messages';
import { normalizeOriginList, originToMatchPattern, originToScriptId } from './origins';

export async function getStoredOrigins(): Promise<string[]> {
  const stored = await chrome.storage.local.get({ [STORAGE_KEY]: [] as string[] });
  const origins = stored[STORAGE_KEY];
  return normalizeOriginList(Array.isArray(origins) ? origins : []);
}

export async function setStoredOrigins(origins: string[]): Promise<string[]> {
  const normalized = normalizeOriginList(origins);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function syncRegisteredContentScripts(origins: string[]): Promise<void> {
  const normalized = normalizeOriginList(origins);
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const expectedIds = new Set(normalized.map((origin) => originToScriptId(origin)));

  for (const script of registered) {
    if (isKoshkoCaptureScript(script.id) && !expectedIds.has(script.id)) {
      await chrome.scripting.unregisterContentScripts({ ids: [script.id] });
    }
  }

  for (const origin of normalized) {
    const id = originToScriptId(origin);
    const script = {
      id,
      js: [CONTENT_SCRIPT_JS_PATH],
      matches: [originToMatchPattern(origin)],
      allFrames: true,
      runAt: 'document_start' as const,
      persistAcrossSessions: true,
    };

    const existing = registered.find((entry) => entry.id === id);
    if (existing) {
      await chrome.scripting.updateContentScripts([script]);
    } else {
      await chrome.scripting.registerContentScripts([script]);
    }
  }
}

function isKoshkoCaptureScript(id: string): boolean {
  // `koshko-<origin>` was used before the ID prefix and generator were made
  // consistent. Treat those IDs as ours so an upgrade removes stale scripts.
  return id.startsWith(`${CONTENT_SCRIPT_ID_PREFIX}-`) || /^koshko-https?-/.test(id);
}
