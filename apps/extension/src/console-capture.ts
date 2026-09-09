import {
  createKoshkoErrorWindowMessageV1,
  normalizeJsonValue,
  normalizeKoshkoErrorV1,
  type JsonValue,
} from '@koshko/protocol';

const CONSOLE_CAPTURE_STATE = Symbol.for('koshko.console-capture.v1');
const CONSOLE_ACTOR = { id: 'browser-console', label: 'Browser Console' } as const;

interface ConsoleCaptureState {
  stop: () => void;
}

interface ConsoleCaptureWindow extends Window {
  [CONSOLE_CAPTURE_STATE]?: ConsoleCaptureState;
  console: Console;
}

export function startConsoleCapture(target: Window = window): () => void {
  const captureWindow = target as ConsoleCaptureWindow;
  const existing = captureWindow[CONSOLE_CAPTURE_STATE];
  if (existing) {
    return existing.stop;
  }

  const producerId = `browser-console:${createUniqueId(target)}`;
  let producerSequence = 0;
  const emit = (name: string, payload: JsonValue): void => {
    try {
      producerSequence += 1;
      const error = normalizeKoshkoErrorV1({
        id: `${producerId}:${producerSequence}`,
        producerId,
        producerSequence,
        occurredAt: getTimestamp(target),
        source: CONSOLE_ACTOR,
        name,
        payload,
      });
      target.postMessage(createKoshkoErrorWindowMessageV1(error), '*');
    } catch {
      // Diagnostics must never affect the inspected application.
    }
  };

  const originalConsoleError = captureWindow.console.error;
  const wrappedConsoleError = function (this: Console, ...args: unknown[]) {
    const result = Reflect.apply(originalConsoleError, this, args);
    try {
      emit('console.error', createConsoleErrorPayload(args, target));
    } catch {
      // Preserve console.error behavior even for values that resist inspection.
    }
    return result;
  };
  captureWindow.console.error = wrappedConsoleError;

  const onError = (event: ErrorEvent): void => {
    try {
      if (typeof event.message !== 'string') {
        return;
      }
      const errorInfo = getErrorInfo(event.error);
      emit('runtime.uncaught-error', normalizeJsonValue({
        message: errorInfo?.message ?? (event.message.trim() || 'Uncaught error'),
        ...(errorInfo?.stack === undefined ? {} : { stack: errorInfo.stack }),
        filename: event.filename,
        lineNumber: event.lineno,
        columnNumber: event.colno,
        error: event.error,
      }));
    } catch {
      // A hostile synthetic event must not affect the inspected application.
    }
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    try {
      const errorInfo = getErrorInfo(event.reason);
      const message = errorInfo?.message
        ?? (typeof event.reason === 'string' && event.reason.trim() !== ''
          ? event.reason.trim()
          : 'Unhandled promise rejection');
      emit('runtime.unhandled-rejection', normalizeJsonValue({
        message,
        ...(errorInfo?.stack === undefined ? {} : { stack: errorInfo.stack }),
        reason: event.reason,
      }));
    } catch {
      // A hostile synthetic event must not affect the inspected application.
    }
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onUnhandledRejection);

  let stopped = false;
  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (captureWindow.console.error === wrappedConsoleError) {
      captureWindow.console.error = originalConsoleError;
    }
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (captureWindow[CONSOLE_CAPTURE_STATE]?.stop === stop) {
      delete captureWindow[CONSOLE_CAPTURE_STATE];
    }
  };
  captureWindow[CONSOLE_CAPTURE_STATE] = { stop };
  return stop;
}

interface ErrorInfo {
  message?: string;
  stack?: string;
}

function createConsoleErrorPayload(args: unknown[], target: Window): JsonValue {
  const errorInfo = args
    .map((value) => getNestedErrorInfo(value, target))
    .find((value) => value !== undefined);
  const eventMessage = args
    .map((value) => getBrowserEventMessage(value, target))
    .find((value) => value !== undefined);
  const eventType = args
    .map((value) => getBrowserEventType(value, target))
    .find((value) => value !== undefined);
  const strings = args
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  const nonPrefixString = strings.find((value) => !/^\[[^\]]+\]$/.test(value));
  const message = errorInfo?.message
    ?? eventMessage
    ?? eventType
    ?? nonPrefixString
    ?? strings[0]
    ?? 'Console error';

  return normalizeJsonValue({
    message,
    ...(errorInfo?.stack === undefined ? {} : { stack: errorInfo.stack }),
    arguments: args.map((value) => serializeConsoleArgument(value, target)),
  });
}

function serializeConsoleArgument(value: unknown, target: Window): unknown {
  const tag = getObjectTag(value);
  if (tag === 'ErrorEvent' || isWindowInstance(value, target, 'ErrorEvent')) {
    return compactKnownProperties({
      type: readKnownProperty(value, 'type'),
      message: readKnownProperty(value, 'message'),
      filename: readKnownProperty(value, 'filename'),
      lineNumber: readKnownProperty(value, 'lineno'),
      columnNumber: readKnownProperty(value, 'colno'),
      error: readKnownProperty(value, 'error'),
      timeStamp: readKnownProperty(value, 'timeStamp'),
      isTrusted: readKnownProperty(value, 'isTrusted'),
    });
  }
  if (tag === 'PromiseRejectionEvent' || isWindowInstance(value, target, 'PromiseRejectionEvent')) {
    return compactKnownProperties({
      type: readKnownProperty(value, 'type'),
      reason: readKnownProperty(value, 'reason'),
      timeStamp: readKnownProperty(value, 'timeStamp'),
      isTrusted: readKnownProperty(value, 'isTrusted'),
    });
  }
  if (tag === 'Event' || tag?.endsWith('Event') || isWindowInstance(value, target, 'Event')) {
    return compactKnownProperties({
      type: readKnownProperty(value, 'type'),
      timeStamp: readKnownProperty(value, 'timeStamp'),
      isTrusted: readKnownProperty(value, 'isTrusted'),
    });
  }
  return value;
}

function getNestedErrorInfo(value: unknown, target: Window): ErrorInfo | undefined {
  const direct = getErrorInfo(value);
  if (direct !== undefined || typeof value !== 'object' || value === null) {
    return direct;
  }

  const tag = getObjectTag(value);
  const browserEvent = tag === 'ErrorEvent'
    || tag === 'PromiseRejectionEvent'
    || isWindowInstance(value, target, 'ErrorEvent')
    || isWindowInstance(value, target, 'PromiseRejectionEvent');
  for (const key of ['error', 'reason']) {
    const nestedValue = browserEvent
      ? readKnownProperty(value, key)
      : readOwnDataProperty(value, key);
    const nested = getErrorInfo(nestedValue);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function getErrorInfo(value: unknown): ErrorInfo | undefined {
  const tag = getObjectTag(value);
  if (tag !== 'Error' && tag !== 'DOMException') return undefined;

  const message = readKnownProperty(value, 'message');
  const stack = readKnownProperty(value, 'stack');
  return {
    ...(typeof message === 'string' && message.trim() !== '' ? { message: message.trim() } : {}),
    ...(typeof stack === 'string' && stack.trim() !== '' ? { stack } : {}),
  };
}

function getBrowserEventMessage(value: unknown, target: Window): string | undefined {
  if (getObjectTag(value) !== 'ErrorEvent' && !isWindowInstance(value, target, 'ErrorEvent')) {
    return undefined;
  }
  const message = readKnownProperty(value, 'message');
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : undefined;
}

function getBrowserEventType(value: unknown, target: Window): string | undefined {
  const tag = getObjectTag(value);
  if (tag !== 'Event' && !tag?.endsWith('Event') && !isWindowInstance(value, target, 'Event')) {
    return undefined;
  }
  const type = readKnownProperty(value, 'type');
  return typeof type === 'string' && type.trim() !== '' ? type.trim() : undefined;
}

function getObjectTag(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return Object.prototype.toString.call(value).slice(8, -1);
  } catch {
    return undefined;
  }
}

function readKnownProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function isWindowInstance(value: unknown, target: Window, constructorName: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  try {
    const constructor = Reflect.get(target, constructorName);
    return typeof constructor === 'function' && value instanceof constructor;
  } catch {
    return false;
  }
}

function compactKnownProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
}

function createUniqueId(target: Window): string {
  if (typeof target.crypto?.randomUUID === 'function') {
    return target.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTimestamp(target: Window): number {
  const timeOrigin = target.performance?.timeOrigin;
  const now = target.performance?.now();
  return Number.isFinite(timeOrigin) && Number.isFinite(now)
    ? Number(timeOrigin) + Number(now)
    : Date.now();
}
