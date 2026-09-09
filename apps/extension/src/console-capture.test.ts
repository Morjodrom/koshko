import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KoshkoWindowMessageV1 } from '@koshko/protocol';
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

  it('preserves console.error behavior and emits a normalized error signal', () => {
    const nativeError = vi.fn();
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = nativeError;
    cleanups.push(startConsoleCapture());
    const context = { kind: 'custom-console' };
    const circular: Record<string, unknown> = { token: 'secret-value' };
    circular.self = circular;

    window.console.error.call(context as unknown as Console, 'failed', circular);

    expect(nativeError).toHaveBeenCalledOnce();
    expect(nativeError.mock.instances[0]).toBe(context);
    expect(nativeError).toHaveBeenCalledWith('failed', circular);
    const signal = postedSignals(postMessage)[0].signal;
    expect(signal).toMatchObject({
      source: { id: 'browser-console', label: 'Browser Console' },
      name: 'console.error',
      severity: 'error',
      producerSequence: 1,
      tags: ['browser-console'],
      details: {
        arguments: ['failed', { token: '[Redacted]', self: '[Circular]' }],
      },
    });
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

    expect(postedSignals(postMessage)[0].signal).toMatchObject({
      name: 'runtime.uncaught-error',
      details: {
        message: 'Uncaught Error: outer',
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

  it('captures primitive and Error promise rejection reasons in order', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.console.error = vi.fn();
    cleanups.push(startConsoleCapture());

    window.dispatchEvent(rejectionEvent('plain failure'));
    window.dispatchEvent(rejectionEvent(new Error('rejected')));

    const signals = postedSignals(postMessage).map((message) => message.signal);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      name: 'runtime.unhandled-rejection',
      producerSequence: 1,
      details: { reason: 'plain failure' },
    });
    expect(signals[1]).toMatchObject({
      name: 'runtime.unhandled-rejection',
      producerSequence: 2,
      details: { reason: { name: 'Error', message: 'rejected' } },
    });
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

    const topSignal = postedSignals(topPostMessage)[0].signal;
    const frameSignal = postedSignals(framePostMessage)[0].signal;
    expect(topSignal.details).toEqual({ arguments: ['[Truncated]'] });
    expect(topSignal.producerSequence).toBe(1);
    expect(frameSignal.producerSequence).toBe(1);
    expect(frameSignal.producerId).not.toBe(topSignal.producerId);
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
    expect(postedSignals(postMessage)).toHaveLength(1);

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

function postedSignals(
  postMessage: { mock: { calls: unknown[][] } },
): KoshkoWindowMessageV1[] {
  return postMessage.mock.calls.map((call) => call[0] as KoshkoWindowMessageV1);
}
