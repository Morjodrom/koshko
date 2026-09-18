import type { BridgeCaptureBatch, BridgeSessionMetadata, BridgeTraceEntry } from '@koshko/bridge';

export const authToken = 'abcdefghijklmnopqrstuvwxyzABCDEF012345';

export function session(sessionId = 'session-1'): BridgeSessionMetadata {
  return {
    sessionId,
    tabId: 1,
    frameId: 0,
    navigationId: `navigation-${sessionId}`,
    pageUrl: 'https://example.test/page',
    pageOrigin: 'https://example.test',
    startedAt: 1,
  };
}

export function entry(sessionId = 'session-1', entryId = 'entry-1'): BridgeTraceEntry {
  return {
    entryId,
    sessionId,
    capturedAt: 2,
    kind: 'post-message',
    messageType: 'window-message',
    data: { text: 'captured page value' },
  };
}

export function batch(sessionId = 'session-1', entryId = 'entry-1'): BridgeCaptureBatch {
  const metadata = session(sessionId);
  return {
    bridge: 'koshko-bridge',
    version: 1,
    type: 'capture-batch',
    session: metadata,
    entries: [entry(sessionId, entryId)],
  };
}

export function hello(resumeSessionId?: string): object {
  return {
    bridge: 'koshko-bridge',
    version: 1,
    type: 'client-hello',
    clientId: 'extension-1',
    authToken,
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
  };
}

export function aiLogResponse(sessionId = 'session-1', requestId = 'request-1'): object {
  return {
    bridge: 'koshko-bridge',
    version: 1,
    type: 'ai-log-response',
    requestId,
    sessionId,
    result: {
      text: 'formatted capture evidence',
      estimatedTokens: 3,
      includedEntryCount: 1,
      omittedEntryCount: 0,
      includedAnchorCount: 0,
      compactedValueCount: 0,
      truncatedValueCount: 0,
      selectionMode: 'causal-hybrid',
      stateStatus: 'focused',
    },
  };
}
