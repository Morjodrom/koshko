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
      emit('console.error', normalizeJsonValue({ arguments: args }));
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
      emit('runtime.uncaught-error', normalizeJsonValue({
        message: event.message,
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
      emit('runtime.unhandled-rejection', normalizeJsonValue({ reason: event.reason }));
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
