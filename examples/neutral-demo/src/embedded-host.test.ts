import { describe, expect, it } from 'vitest';
import {
  DEMO_OBSERVER_PROTOCOL,
  DEMO_OBSERVER_VERSION,
  EmbeddedObservationHost,
} from './embedded-host';

const DEMO_ORIGIN = 'https://demo.test';

class FakeWindow {
  readonly messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeTarget {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  emit(source: FakeWindow, data: unknown, origin = DEMO_ORIGIN): void {
    this.listeners.forEach((listener) => listener({ source, data, origin } as unknown as MessageEvent<unknown>));
  }
}

function capture(sequence = 1, details: unknown = undefined): Parameters<EmbeddedObservationHost['captureTop']>[0] {
  return {
    type: 'koshko:capture',
    kind: 'signal',
    signal: {
      protocol: 'koshko', version: 1, id: `signal-${sequence}`, producerId: 'demo', producerSequence: sequence,
      occurredAt: sequence, source: { id: 'demo' }, name: `demo.event.${sequence}`,
      ...(details === undefined ? {} : { details }),
    },
    observedAt: sequence,
    navigationId: 'navigation-1',
    frameUrl: DEMO_ORIGIN,
    frameOrigin: DEMO_ORIGIN,
  };
}

function iframe(window: FakeWindow): HTMLIFrameElement {
  return { contentWindow: window } as unknown as HTMLIFrameElement;
}

function registrations(embedded: FakeWindow, processing: FakeWindow, embeddedOrigin = DEMO_ORIGIN): Map<'embedded' | 'processing', { frame: HTMLIFrameElement; origin: string }> {
  return new Map([
    ['embedded', { frame: iframe(embedded), origin: embeddedOrigin }],
    ['processing', { frame: iframe(processing), origin: DEMO_ORIGIN }],
  ]);
}

function createHost(embeddedOrigin = DEMO_ORIGIN): {
  host: EmbeddedObservationHost;
  target: FakeTarget;
  inspector: FakeWindow;
  embedded: FakeWindow;
  processing: FakeWindow;
} {
  const target = new FakeTarget();
  const inspector = new FakeWindow();
  const embedded = new FakeWindow();
  const processing = new FakeWindow();
  const host = new EmbeddedObservationHost(
    DEMO_ORIGIN,
    iframe(inspector),
    registrations(embedded, processing, embeddedOrigin),
    target as unknown as Window,
  );
  return { host, target, inspector, embedded, processing };
}

function inspectorReady(target: FakeTarget, inspector: FakeWindow, sessionId = 'session-a'): void {
  target.emit(inspector, { protocol: 'koshko:embedded-inspector', version: 1, type: 'inspector-ready', sessionId });
}

function captures(messages: unknown[]): Array<Record<string, unknown>> {
  return messages.filter((message): message is Record<string, unknown> => (
    typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'capture'
  ));
}

describe('EmbeddedObservationHost', () => {
  it('buffers while disconnected, flushes on reconnect, and removes acknowledged captures', () => {
    const { host, target, inspector } = createHost();
    host.captureTop(capture());

    inspectorReady(target, inspector);
    expect(inspector.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'host-ready', generation: 0 }),
      expect.objectContaining({ type: 'capture', contextId: 'top', sequence: 1 }),
    ]));

    target.emit(inspector, { protocol: 'koshko:embedded-inspector', version: 1, type: 'ack', sessionId: 'wrong-session', generation: 0, contextId: 'top', sequence: 1 });
    inspector.messages.length = 0;
    inspectorReady(target, inspector, 'session-b');
    expect(captures(inspector.messages)).toHaveLength(1);

    target.emit(inspector, { protocol: 'koshko:embedded-inspector', version: 1, type: 'ack', sessionId: 'session-b', generation: 0, contextId: 'top', sequence: 1 });
    inspector.messages.length = 0;
    inspectorReady(target, inspector, 'session-c');
    expect(captures(inspector.messages)).toHaveLength(0);
    host.dispose();
  });

  it('rejects malformed captures and wrong origin or WindowProxy sources', () => {
    const { host, target, inspector, embedded } = createHost();
    inspectorReady(target, inspector);
    inspector.messages.length = 0;

    const malformed = {
      protocol: DEMO_OBSERVER_PROTOCOL, version: DEMO_OBSERVER_VERSION, type: 'capture',
      capture: { kind: 'signal', observedAt: 1, navigationId: 'nav', frameUrl: DEMO_ORIGIN, frameOrigin: DEMO_ORIGIN, signal: { nope: true } },
    };
    target.emit(embedded, malformed);
    target.emit(new FakeWindow(), { protocol: DEMO_OBSERVER_PROTOCOL, version: DEMO_OBSERVER_VERSION, type: 'capture', capture: capture() });
    target.emit(embedded, { protocol: DEMO_OBSERVER_PROTOCOL, version: DEMO_OBSERVER_VERSION, type: 'capture', capture: capture() }, 'https://attacker.test');
    expect(captures(inspector.messages)).toHaveLength(0);

    target.emit(embedded, { protocol: DEMO_OBSERVER_PROTOCOL, version: DEMO_OBSERVER_VERSION, type: 'capture', capture: capture() });
    expect(captures(inspector.messages)).toEqual([expect.objectContaining({ contextId: 'embedded' })]);
    host.dispose();
  });

  it('requires a current generation for reset and discards old-generation acknowledgements', () => {
    const { host, target, inspector } = createHost();
    inspectorReady(target, inspector);
    inspector.messages.length = 0;
    host.captureTop(capture());
    target.emit(inspector, { protocol: 'koshko:embedded-inspector', version: 1, type: 'reset', sessionId: 'session-a', generation: 1 });
    expect(inspector.messages.some((message) => (message as { type?: unknown }).type === 'reset-ack')).toBe(false);

    target.emit(inspector, { protocol: 'koshko:embedded-inspector', version: 1, type: 'reset', sessionId: 'session-a', generation: 0 });
    expect(inspector.messages).toContainEqual(expect.objectContaining({ type: 'reset-ack', generation: 1 }));
    host.captureTop(capture(2));
    inspector.messages.length = 0;
    target.emit(inspector, { protocol: 'koshko:embedded-inspector', version: 1, type: 'ack', sessionId: 'session-a', generation: 0, contextId: 'top', sequence: 1 });
    inspectorReady(target, inspector, 'session-b');
    expect(captures(inspector.messages)).toEqual([expect.objectContaining({ generation: 1, sequence: 1 })]);
    host.dispose();
  });

  it('evicts the oldest capture after 1,000 pending events in one context', () => {
    const { host, target, inspector } = createHost();
    for (let sequence = 1; sequence <= 1_001; sequence += 1) host.captureTop(capture(sequence));

    inspectorReady(target, inspector);
    const pending = captures(inspector.messages);
    expect(pending).toHaveLength(1_000);
    expect(pending[0]).toMatchObject({ sequence: 2 });
    expect(pending.at(-1)).toMatchObject({ sequence: 1_001 });
    host.dispose();
  });

  it('evicts for the 2 MiB byte budget and rejects a single raw event over the budget', () => {
    const { host, target, inspector } = createHost();
    for (let sequence = 1; sequence <= 400; sequence += 1) {
      host.captureTop(capture(sequence, { text: 'x'.repeat(9_000) }));
    }
    inspectorReady(target, inspector);
    const pending = captures(inspector.messages);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.length).toBeLessThan(400);
    expect(pending[0]?.sequence).toBeGreaterThan(1);

    inspector.messages.length = 0;
    host.captureTop(capture(401, { text: 'x'.repeat((2 * 1_024 * 1_024) + 1) }));
    expect(captures(inspector.messages)).toHaveLength(0);
    host.dispose();
  });

  it('accepts a registered cooperating child only at its configured origin', () => {
    const childOrigin = 'https://widget.example.test';
    const { host, target, inspector, embedded } = createHost(childOrigin);
    inspectorReady(target, inspector);
    inspector.messages.length = 0;

    target.emit(embedded, { protocol: DEMO_OBSERVER_PROTOCOL, version: DEMO_OBSERVER_VERSION, type: 'capture', capture: capture() }, DEMO_ORIGIN);
    expect(captures(inspector.messages)).toHaveLength(0);
    target.emit(embedded, { protocol: DEMO_OBSERVER_PROTOCOL, version: DEMO_OBSERVER_VERSION, type: 'capture', capture: capture() }, childOrigin);
    expect(captures(inspector.messages)).toEqual([expect.objectContaining({ contextId: 'embedded' })]);
    host.dispose();
  });
});
