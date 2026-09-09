import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KoshkoErrorWindowMessageV1 } from '@koshko/protocol';
import { startConsoleCapture } from './console-capture';

describe('browser console capture', () => {
  const cleanups: Array<() => void> = [];
  const originalConsoleError = window.console.error;

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    window.console.error = originalConsoleError;
    vi.restoreAllMocks();
  });

  it('preserves console.error behavior and emits a normalized error entry', () => {
    const nativeError = vi.fn(() => 'native-result');
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = nativeError;
    cleanups.push(startConsoleCapture());
    const context = { kind: 'custom-console' };
    const circular: Record<string, unknown> = { token: 'secret-value' };
    circular.self = circular;

    const result = window.console.error.call(context as unknown as Console, 'failed', circular);

    expect(result).toBe('native-result');
    expect(nativeError).toHaveBeenCalledOnce();
    expect(nativeError.mock.instances[0]).toBe(context);
    expect(nativeError).toHaveBeenCalledWith('failed', circular);
    const error = postedErrors(postMessage)[0].error;
    expect(error).toMatchObject({
      source: { id: 'browser-console', label: 'Browser Console' },
      name: 'console.error',
      producerSequence: 1,
      payload: {
        message: 'failed',
        arguments: ['failed', { token: '[Redacted]', self: '[Circular]' }],
      },
    });
    expect(error).not.toHaveProperty('severity');
  });

  it('captures uncaught errors with safe stack, cause, and URL details', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());
    const cause = new Error('inner');
    const error = new Error('outer', { cause });

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Uncaught Error: outer',
      filename: 'https://example.test/app.js?token=secret#source',
      lineno: 12,
      colno: 34,
      error,
    }));

    expect(postedErrors(postMessage)[0].error).toMatchObject({
      name: 'runtime.uncaught-error',
      payload: {
        message: 'outer',
        stack: expect.any(String),
        filename: 'https://example.test/app.js',
        lineNumber: 12,
        columnNumber: 34,
        error: {
          name: 'Error',
          message: 'outer',
          stack: expect.any(String),
          cause: {
            name: 'Error',
            message: 'inner',
            stack: expect.any(String),
          },
        },
      },
    });
  });

  it('promotes a direct Error message and stack while preserving normalized error details', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());
    const error = new Error('Checkout exploded', { cause: new Error('Gateway failed') }) as Error & {
      endpointUrl: string;
      token: string;
    };
    error.endpointUrl = 'https://example.test/pay?token=secret#debug';
    error.token = 'secret';

    window.console.error(error);

    expect(postedErrors(postMessage)[0].error.payload).toMatchObject({
      message: 'Checkout exploded',
      stack: expect.any(String),
      arguments: [{
        name: 'Error',
        message: 'Checkout exploded',
        stack: expect.any(String),
        cause: {
          name: 'Error',
          message: 'Gateway failed',
          stack: expect.any(String),
        },
        endpointUrl: 'https://example.test/pay',
        token: '[Redacted]',
      }],
    });
  });

  it('captures primitive and Error promise rejection reasons in order', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());

    window.dispatchEvent(rejectionEvent('plain failure'));
    window.dispatchEvent(rejectionEvent(new Error('rejected')));

    const errors = postedErrors(postMessage).map((message) => message.error);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      name: 'runtime.unhandled-rejection',
      producerSequence: 1,
      payload: { message: 'plain failure', reason: 'plain failure' },
    });
    expect(errors[1]).toMatchObject({
      name: 'runtime.unhandled-rejection',
      producerSequence: 2,
      payload: {
        message: 'rejected',
        stack: expect.any(String),
        reason: { name: 'Error', message: 'rejected', stack: expect.any(String) },
      },
    });
  });

  it('expands webpack-style ErrorEvent arguments and promotes the real error message and stack', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());
    const error = new Error('Compilation failed');
    const event = new ErrorEvent('error', {
      message: 'Uncaught Error: Compilation failed',
      filename: 'https://example.test/app.js?token=secret#source',
      lineno: 21,
      colno: 8,
      error,
    });

    window.console.error('[webpack-dev-server]', event);

    expect(postedErrors(postMessage)[0].error.payload).toMatchObject({
      message: 'Compilation failed',
      stack: expect.any(String),
      arguments: [
        '[webpack-dev-server]',
        {
          type: 'error',
          message: 'Uncaught Error: Compilation failed',
          filename: 'https://example.test/app.js',
          lineNumber: 21,
          columnNumber: 8,
          error: {
            name: 'Error',
            message: 'Compilation failed',
            stack: expect.any(String),
          },
          timeStamp: expect.any(Number),
        },
      ],
    });
  });

  it('expands generic browser events without inventing a stack', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());

    window.console.error('[webpack-dev-server]', new Event('disconnect'));

    const payload = postedErrors(postMessage)[0].error.payload;
    expect(payload).toMatchObject({
      message: 'disconnect',
      arguments: [
        '[webpack-dev-server]',
        {
          type: 'disconnect',
          timeStamp: expect.any(Number),
        },
      ],
    });
    expect(payload).not.toHaveProperty('stack');
  });

  it('does not invoke arbitrary argument getters', () => {
    const nativeError = vi.fn();
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = nativeError;
    cleanups.push(startConsoleCapture());
    const value: Record<string, unknown> = { visible: true };
    Object.defineProperty(value, 'dangerous', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });

    expect(() => window.console.error(value)).not.toThrow();

    expect(nativeError).toHaveBeenCalledOnce();
    const argument = (postedErrors(postMessage)[0].error.payload as {
      arguments: Array<Record<string, unknown>>;
    }).arguments[0];
    expect(argument).toEqual({ visible: true });
  });

  it('bounds oversized console values and keeps frame producers independent', () => {
    const topPostMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture(window));
    window.console.error('x'.repeat(20_000));

    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('Test frame did not create a window');
    const frameConsole = (frameWindow as Window & { console: Console }).console;
    const framePostMessage = vi.spyOn(frameWindow, 'postMessage').mockImplementation(() => {});
    frameConsole.error = vi.fn();
    cleanups.push(startConsoleCapture(frameWindow), () => frame.remove());

    frameConsole.error('frame failure');

    const topError = postedErrors(topPostMessage)[0].error;
    const frameError = postedErrors(framePostMessage)[0].error;
    expect(topError.payload).toEqual({
      message: '[Truncated]',
      arguments: ['[Truncated]'],
    });
    expect(topError.producerSequence).toBe(1);
    expect(frameError.producerSequence).toBe(1);
    expect(frameError.producerId).not.toBe(topError.producerId);
  });

  it('preserves real errors created in another frame', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());
    const frame = document.createElement('iframe');
    document.body.append(frame);
    cleanups.push(() => frame.remove());
    const frameWindow = frame.contentWindow as Window & { Error: ErrorConstructor };
    const crossRealmError = new frameWindow.Error('Frame exploded');

    window.console.error(crossRealmError);

    expect(postedErrors(postMessage)[0].error.payload).toMatchObject({
      message: 'Frame exploded',
      stack: expect.any(String),
      arguments: [{
        name: 'Error',
        message: 'Frame exploded',
        stack: expect.any(String),
      }],
    });
  });

  it('is idempotent and restores only its own console wrapper', () => {
    const nativeError = vi.fn();
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = nativeError;

    const firstStop = startConsoleCapture();
    const secondStop = startConsoleCapture();
    cleanups.push(firstStop, secondStop);
    window.console.error('once');

    expect(firstStop).toBe(secondStop);
    expect(nativeError).toHaveBeenCalledOnce();
    expect(postedErrors(postMessage)).toHaveLength(1);

    const replacement = vi.fn();
    window.console.error = replacement;
    firstStop();
    expect(window.console.error).toBe(replacement);
  });
});

function rejectionEvent(reason: unknown): PromiseRejectionEvent {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  return event as PromiseRejectionEvent;
}

function postedErrors(
  postMessage: { mock: { calls: unknown[][] } },
): KoshkoErrorWindowMessageV1[] {
  return postMessage.mock.calls.map((call) => call[0] as KoshkoErrorWindowMessageV1);
}
