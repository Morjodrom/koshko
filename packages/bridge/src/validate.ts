import {
  isKoshkoErrorV1,
  isKoshkoSignalV1,
  isKoshkoStateMutationV1,
} from '@koshko/protocol';
import type {
  CapturedErrorV1,
  CapturedSignalV1,
  CapturedStateMutationV1,
  JsonValue,
} from '@koshko/protocol';
import {
  BRIDGE_PROTOCOL,
  BRIDGE_VERSION,
  MAX_AI_LOG_TEXT_CODE_POINTS,
  MAX_AUTH_TOKEN_CODE_POINTS,
  MAX_BRIDGE_ENTRY_BYTES,
  MAX_BRIDGE_ID_CODE_POINTS,
  MAX_BRIDGE_MESSAGE_BYTES,
  MAX_CAPTURE_BATCH_ENTRIES,
  MAX_GENERIC_POST_MESSAGE_BYTES,
  MAX_GENERIC_POST_MESSAGE_TYPE_CODE_POINTS,
  MAX_JSON_ARRAY_LENGTH,
  MAX_JSON_DEPTH,
  MAX_JSON_OBJECT_PROPERTIES,
  MAX_SESSION_TITLE_CODE_POINTS,
  MAX_SESSION_URL_CODE_POINTS,
  MAX_STATE_SNAPSHOT_BYTES,
  MIN_AUTH_TOKEN_CODE_POINTS,
} from './limits';
import type {
  BridgeAiLogRequest,
  BridgeAiLogResult,
  BridgeAiLogResponse,
  BridgeCaptureBatch,
  BridgeClientHello,
  BridgeClientMessage,
  BridgeErrorCode,
  BridgeMessage,
  BridgePostMessageTraceEntry,
  BridgeServerAck,
  BridgeServerError,
  BridgeServerMessage,
  BridgeServerReady,
  BridgeSession,
  BridgeSessionMetadata,
  BridgeStateSnapshot,
  BridgeTraceEntry,
} from './types';

const textEncoder = new TextEncoder();
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const ERROR_CODES: readonly BridgeErrorCode[] = [
  'authentication-failed',
  'invalid-message',
  'session-not-found',
  'request-not-found',
  'unsupported-version',
  'internal-error',
];

export function isBridgeAuthToken(value: unknown): value is string {
  return typeof value === 'string' &&
    hasAtMostCodePoints(value, MIN_AUTH_TOKEN_CODE_POINTS, MAX_AUTH_TOKEN_CODE_POINTS) &&
    AUTH_TOKEN_PATTERN.test(value);
}

export function parseBridgeClientHello(value: unknown): BridgeClientHello | undefined {
  if (!hasEnvelope(value, 'client-hello')) {
    return undefined;
  }
  const clientId = read(value, 'clientId');
  const authToken = read(value, 'authToken');
  const resumeSessionId = read(value, 'resumeSessionId');
  if (!isBridgeId(clientId) || !isBridgeAuthToken(authToken) ||
    (resumeSessionId !== undefined && !isBridgeId(resumeSessionId))) {
    return undefined;
  }
  return resumeSessionId === undefined
    ? { bridge: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, type: 'client-hello', clientId, authToken }
    : { bridge: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, type: 'client-hello', clientId, authToken, resumeSessionId };
}

export function parseBridgeServerReady(value: unknown): BridgeServerReady | undefined {
  if (!hasEnvelope(value, 'server-ready')) {
    return undefined;
  }
  const session = parseSession(read(value, 'session'));
  return session === undefined
    ? undefined
    : { bridge: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, type: 'server-ready', session };
}

export function parseBridgeServerError(value: unknown): BridgeServerError | undefined {
  if (!hasEnvelope(value, 'server-error')) {
    return undefined;
  }
  const code = read(value, 'code');
  const message = read(value, 'message');
  const requestId = read(value, 'requestId');
  if (!isErrorCode(code) || !isText(message, MAX_SESSION_TITLE_CODE_POINTS, true) ||
    (requestId !== undefined && !isBridgeId(requestId))) {
    return undefined;
  }
  return requestId === undefined
    ? { bridge: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, type: 'server-error', code, message }
    : { bridge: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, type: 'server-error', code, message, requestId };
}

export function parseBridgeServerAck(value: unknown): BridgeServerAck | undefined {
  if (!hasEnvelope(value, 'server-ack')) {
    return undefined;
  }
  const sessionId = read(value, 'sessionId');
  const ackedEntryIds = parseIdArray(read(value, 'ackedEntryIds'), MAX_CAPTURE_BATCH_ENTRIES);
  if (!isBridgeId(sessionId) || ackedEntryIds === undefined) {
    return undefined;
  }
  const output: BridgeServerAck = {
    bridge: BRIDGE_PROTOCOL,
    version: BRIDGE_VERSION,
    type: 'server-ack',
    sessionId,
    ackedEntryIds,
  };
  return hasSerializedSize(output, MAX_BRIDGE_MESSAGE_BYTES) ? output : undefined;
}

export function parseBridgeCaptureBatch(value: unknown): BridgeCaptureBatch | undefined {
  if (!hasEnvelope(value, 'capture-batch')) {
    return undefined;
  }
  const session = parseSessionMetadata(read(value, 'session'));
  const entries = parseEntries(read(value, 'entries'), MAX_CAPTURE_BATCH_ENTRIES);
  const snapshot = hasOwn(value, 'stateSnapshot') ? parseStateSnapshot(read(value, 'stateSnapshot')) : undefined;
  if (session === undefined || entries === undefined || (hasOwn(value, 'stateSnapshot') && snapshot === undefined) ||
    !entries.every((entry) => entry.sessionId === session.sessionId) ||
    (snapshot !== undefined && snapshot.sessionId !== session.sessionId)) {
    return undefined;
  }
  const output: BridgeCaptureBatch = {
    bridge: BRIDGE_PROTOCOL,
    version: BRIDGE_VERSION,
    type: 'capture-batch',
    session,
    entries,
    ...(snapshot === undefined ? {} : { stateSnapshot: snapshot }),
  };
  return hasSerializedSize(output, MAX_BRIDGE_MESSAGE_BYTES) ? output : undefined;
}

export function parseBridgeAiLogRequest(value: unknown): BridgeAiLogRequest | undefined {
  if (!hasEnvelope(value, 'ai-log-request')) {
    return undefined;
  }
  const requestId = read(value, 'requestId');
  const sessionId = read(value, 'sessionId');
  const budget = read(value, 'budget');
  if (!isBridgeId(requestId) || !isBridgeId(sessionId) || !isAiLogBudget(budget)) {
    return undefined;
  }
  return { bridge: BRIDGE_PROTOCOL, version: BRIDGE_VERSION, type: 'ai-log-request', requestId, sessionId, budget };
}

export function parseBridgeAiLogResponse(value: unknown): BridgeAiLogResponse | undefined {
  if (!hasEnvelope(value, 'ai-log-response')) {
    return undefined;
  }
  const requestId = read(value, 'requestId');
  const sessionId = read(value, 'sessionId');
  const result = parseAiLogResult(read(value, 'result'));
  if (!isBridgeId(requestId) || !isBridgeId(sessionId) || result === undefined) {
    return undefined;
  }
  const output: BridgeAiLogResponse = {
    bridge: BRIDGE_PROTOCOL,
    version: BRIDGE_VERSION,
    type: 'ai-log-response',
    requestId,
    sessionId,
    result,
  };
  return hasSerializedSize(output, MAX_BRIDGE_MESSAGE_BYTES) ? output : undefined;
}

export function parseBridgeClientMessage(value: unknown): BridgeClientMessage | undefined {
  const type = read(value, 'type');
  if (type === 'client-hello') {
    return parseBridgeClientHello(value);
  }
  if (type === 'capture-batch') {
    return parseBridgeCaptureBatch(value);
  }
  return type === 'ai-log-response' ? parseBridgeAiLogResponse(value) : undefined;
}

export function parseBridgeServerMessage(value: unknown): BridgeServerMessage | undefined {
  const type = read(value, 'type');
  if (type === 'server-ready') {
    return parseBridgeServerReady(value);
  }
  if (type === 'server-error') {
    return parseBridgeServerError(value);
  }
  if (type === 'server-ack') {
    return parseBridgeServerAck(value);
  }
  return type === 'ai-log-request' ? parseBridgeAiLogRequest(value) : undefined;
}

export function parseBridgeMessage(value: unknown): BridgeMessage | undefined {
  return parseBridgeClientMessage(value) ?? parseBridgeServerMessage(value);
}

export function isBridgeClientMessage(value: unknown): value is BridgeClientMessage {
  return parseBridgeClientMessage(value) !== undefined;
}

export function isBridgeServerMessage(value: unknown): value is BridgeServerMessage {
  return parseBridgeServerMessage(value) !== undefined;
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  return parseBridgeMessage(value) !== undefined;
}

function parseSession(value: unknown): BridgeSession | undefined {
  const metadata = parseSessionMetadata(value);
  const connectedAt = read(value, 'connectedAt');
  return metadata === undefined || !isFiniteNumber(connectedAt)
    ? undefined
    : { ...metadata, connectedAt };
}

function parseSessionMetadata(value: unknown): BridgeSessionMetadata | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const sessionId = read(value, 'sessionId');
  const tabId = read(value, 'tabId');
  const frameId = read(value, 'frameId');
  const navigationId = read(value, 'navigationId');
  const pageUrl = read(value, 'pageUrl');
  const pageOrigin = read(value, 'pageOrigin');
  const pageTitle = read(value, 'pageTitle');
  const startedAt = read(value, 'startedAt');
  if (!isBridgeId(sessionId) || !isNonNegativeInteger(tabId) || !isNonNegativeInteger(frameId) ||
    !isBridgeId(navigationId) || !isText(pageUrl, MAX_SESSION_URL_CODE_POINTS, false) ||
    !isText(pageOrigin, MAX_SESSION_URL_CODE_POINTS, false) ||
    (pageTitle !== undefined && !isText(pageTitle, MAX_SESSION_TITLE_CODE_POINTS, false)) ||
    !isFiniteNumber(startedAt)) {
    return undefined;
  }
  return pageTitle === undefined
    ? { sessionId, tabId, frameId, navigationId, pageUrl, pageOrigin, startedAt }
    : { sessionId, tabId, frameId, navigationId, pageUrl, pageOrigin, pageTitle, startedAt };
}

function parseEntries(value: unknown, limit: number): BridgeTraceEntry[] | undefined {
  const length = arrayLength(value);
  if (length === undefined || length > limit) {
    return undefined;
  }
  const entries: BridgeTraceEntry[] = [];
  for (let index = 0; index < length; index += 1) {
    const candidate = read(value, String(index));
    const entry = parseTraceEntry(candidate);
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }
  return entries;
}

function parseTraceEntry(value: unknown): BridgeTraceEntry | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const entryId = read(value, 'entryId');
  const sessionId = read(value, 'sessionId');
  const capturedAt = read(value, 'capturedAt');
  const kind = read(value, 'kind');
  if (!isBridgeId(entryId) || !isBridgeId(sessionId) || !isFiniteNumber(capturedAt)) {
    return undefined;
  }
  let output: BridgeTraceEntry | undefined;
  if (kind === 'signal') {
    const capture = parseCapturedSignal(read(value, 'capture'));
    output = capture === undefined ? undefined : { entryId, sessionId, capturedAt, kind, capture };
  } else if (kind === 'error') {
    const capture = parseCapturedError(read(value, 'capture'));
    output = capture === undefined ? undefined : { entryId, sessionId, capturedAt, kind, capture };
  } else if (kind === 'state-mutation') {
    const capture = parseCapturedMutation(read(value, 'capture'));
    output = capture === undefined ? undefined : { entryId, sessionId, capturedAt, kind, capture };
  } else if (kind === 'post-message') {
    output = parsePostMessageEntry(entryId, sessionId, capturedAt, value);
  }
  return output !== undefined && hasSerializedSize(output, MAX_BRIDGE_ENTRY_BYTES) ? output : undefined;
}

function parsePostMessageEntry(
  entryId: string,
  sessionId: string,
  capturedAt: number,
  value: object,
): BridgePostMessageTraceEntry | undefined {
  const messageType = read(value, 'messageType');
  const data = cloneJsonValue(read(value, 'data'));
  if (!isText(messageType, MAX_GENERIC_POST_MESSAGE_TYPE_CODE_POINTS, true) || data === undefined) {
    return undefined;
  }
  const output: BridgePostMessageTraceEntry = { entryId, sessionId, capturedAt, kind: 'post-message', messageType, data };
  return hasSerializedSize(output, MAX_GENERIC_POST_MESSAGE_BYTES) ? output : undefined;
}

function parseStateSnapshot(value: unknown): BridgeStateSnapshot | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const snapshotId = read(value, 'snapshotId');
  const sessionId = read(value, 'sessionId');
  const capturedAt = read(value, 'capturedAt');
  const state = cloneJsonValue(read(value, 'state'));
  if (!isBridgeId(snapshotId) || !isBridgeId(sessionId) || !isFiniteNumber(capturedAt) || state === undefined) {
    return undefined;
  }
  const output: BridgeStateSnapshot = { snapshotId, sessionId, capturedAt, state };
  return hasSerializedSize(output, MAX_STATE_SNAPSHOT_BYTES) ? output : undefined;
}

function parseAiLogResult(value: unknown): BridgeAiLogResult | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const text = read(value, 'text');
  const estimatedTokens = read(value, 'estimatedTokens');
  const includedEntryCount = read(value, 'includedEntryCount');
  const omittedEntryCount = read(value, 'omittedEntryCount');
  const includedAnchorCount = read(value, 'includedAnchorCount');
  const compactedValueCount = read(value, 'compactedValueCount');
  const truncatedValueCount = read(value, 'truncatedValueCount');
  const selectionMode = read(value, 'selectionMode');
  const stateStatus = read(value, 'stateStatus');
  if (!isText(text, MAX_AI_LOG_TEXT_CODE_POINTS, false) || !isNonNegativeInteger(estimatedTokens) ||
    !isNonNegativeInteger(includedEntryCount) || !isNonNegativeInteger(omittedEntryCount) ||
    !isNonNegativeInteger(includedAnchorCount) || !isNonNegativeInteger(compactedValueCount) ||
    !isNonNegativeInteger(truncatedValueCount) ||
    (selectionMode !== 'all' && selectionMode !== 'causal-hybrid') ||
    (stateStatus !== 'full' && stateStatus !== 'focused' && stateStatus !== 'empty' && stateStatus !== 'omitted')) {
    return undefined;
  }
  return {
    text,
    estimatedTokens,
    includedEntryCount,
    omittedEntryCount,
    includedAnchorCount,
    compactedValueCount,
    truncatedValueCount,
    selectionMode,
    stateStatus,
  };
}

function parseCapturedSignal(value: unknown): CapturedSignalV1 | undefined {
  return parseCaptured(value, 'signal', isKoshkoSignalV1) as CapturedSignalV1 | undefined;
}

function parseCapturedError(value: unknown): CapturedErrorV1 | undefined {
  return parseCaptured(value, 'error', isKoshkoErrorV1) as CapturedErrorV1 | undefined;
}

function parseCapturedMutation(value: unknown): CapturedStateMutationV1 | undefined {
  return parseCaptured(value, 'mutation', isKoshkoStateMutationV1) as CapturedStateMutationV1 | undefined;
}

function parseCaptured(
  value: unknown,
  payloadKey: 'signal' | 'error' | 'mutation',
  isPayload: (candidate: unknown) => boolean,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const payload = read(value, payloadKey);
  const observedAt = read(value, 'observedAt');
  const tabId = read(value, 'tabId');
  const frameId = read(value, 'frameId');
  const documentId = read(value, 'documentId');
  const navigationId = read(value, 'navigationId');
  const frameUrl = read(value, 'frameUrl');
  const frameOrigin = read(value, 'frameOrigin');
  if (!isPayload(payload) || !isFiniteNumber(observedAt) || !isNonNegativeInteger(tabId) ||
    !isNonNegativeInteger(frameId) || (documentId !== undefined && !isBridgeId(documentId)) ||
    !isBridgeId(navigationId) || !isText(frameUrl, MAX_SESSION_URL_CODE_POINTS, false) ||
    !isText(frameOrigin, MAX_SESSION_URL_CODE_POINTS, false)) {
    return undefined;
  }
  const clonedPayload = cloneJsonValue(payload);
  if (clonedPayload === undefined) {
    return undefined;
  }
  return {
    [payloadKey]: clonedPayload,
    observedAt,
    tabId,
    frameId,
    ...(documentId === undefined ? {} : { documentId }),
    navigationId,
    frameUrl,
    frameOrigin,
  };
}

function hasEnvelope(value: unknown, type: string): value is object {
  return isPlainRecord(value) && read(value, 'bridge') === BRIDGE_PROTOCOL &&
    read(value, 'version') === BRIDGE_VERSION && read(value, 'type') === type;
}

function isPlainRecord(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function read(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function hasOwn(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch {
    return false;
  }
}

function parseIdArray(value: unknown, limit: number): string[] | undefined {
  const length = arrayLength(value);
  if (length === undefined || length > limit) {
    return undefined;
  }
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = read(value, String(index));
    if (!isBridgeId(item)) {
      return undefined;
    }
    result.push(item);
  }
  return result;
}

function cloneJsonValue(value: unknown): JsonValue | undefined {
  if (!isJsonValue(value, 0, new WeakSet<object>())) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
}

function isJsonValue(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return true;
  }
  if (typeof value === 'string') {
    return hasAtMostCodePoints(value, 0, MAX_SESSION_URL_CODE_POINTS);
  }
  if (typeof value !== 'object' || value === null || seen.has(value) || depth >= MAX_JSON_DEPTH) {
    return false;
  }
  seen.add(value);
  try {
    const length = arrayLength(value);
    if (length !== undefined) {
      if (length > MAX_JSON_ARRAY_LENGTH || !hasOnlyArrayDataProperties(value, length)) {
        return false;
      }
      for (let index = 0; index < length; index += 1) {
        if (!isJsonValue(read(value, String(index)), depth + 1, seen)) {
          return false;
        }
      }
      return true;
    }
    if (!isPlainRecord(value)) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length <= MAX_JSON_OBJECT_PROPERTIES && keys.every((key) => {
      if (typeof key !== 'string') {
        return false;
      }
      const descriptor = descriptors[key];
      return descriptor !== undefined && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
        isJsonValue(descriptor.value, depth + 1, seen);
    });
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function isBridgeId(value: unknown): value is string {
  return typeof value === 'string' && hasAtMostCodePoints(value, 1, MAX_BRIDGE_ID_CODE_POINTS) && ID_PATTERN.test(value);
}

function isText(value: unknown, maximum: number, rejectControls: boolean): value is string {
  return typeof value === 'string' && hasAtMostCodePoints(value, 0, maximum) &&
    (!rejectControls || !/\p{C}/u.test(value));
}

function hasAtMostCodePoints(value: string, minimum: number, maximum: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) {
      return false;
    }
  }
  return count >= minimum;
}

function hasSerializedSize(value: unknown, maximum: number): boolean {
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength <= maximum;
  } catch {
    return false;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isErrorCode(value: unknown): value is BridgeErrorCode {
  return typeof value === 'string' && ERROR_CODES.includes(value as BridgeErrorCode);
}

function isAiLogBudget(value: unknown): value is BridgeAiLogRequest['budget'] {
  return value === '8k' || value === '16k' || value === '32k' || value === '64k' || value === 'full';
}

function arrayLength(value: unknown): number | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const length = read(value, 'length');
  return typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

function hasOnlyArrayDataProperties(value: object, length: number): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every((key) => {
      if (key === 'length') {
        return true;
      }
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
        return false;
      }
      const descriptor = descriptors[key];
      return descriptor !== undefined && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  } catch {
    return false;
  }
}
