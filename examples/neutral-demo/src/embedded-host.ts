import {
  normalizeCapturedErrorV1,
  normalizeCapturedSignalV1,
  normalizeCapturedStateMutationV1,
  parseKoshkoErrorWindowMessageV1,
  parseKoshkoStateMutationWindowMessageV1,
  parseKoshkoWindowMessageV1,
  type CaptureContextV1,
  type CapturedErrorV1,
  type CapturedSignalV1,
  type CapturedStateMutationV1,
} from '@koshko/protocol';
import type { CaptureDelivery } from '../../../apps/extension/src/embedded';

export const DEMO_OBSERVER_PROTOCOL = 'koshko:demo-observer';
export const DEMO_OBSERVER_VERSION = 1;
const BRIDGE_PROTOCOL = 'koshko:embedded-inspector';
const BRIDGE_VERSION = 1;
const MAX_EVENTS_PER_CONTEXT = 1_000;
const MAX_BYTES_PER_CONTEXT = 2 * 1_024 * 1_024;

export type DemoContextId = 'top' | 'embedded' | 'processing';

type CaptureKind = 'signal' | 'state-mutation' | 'error';
type Captured = CapturedSignalV1 | CapturedStateMutationV1 | CapturedErrorV1;

interface PendingCapture {
  contextId: DemoContextId;
  sequence: number;
  kind: CaptureKind;
  captured: Captured;
  byteLength: number;
}

interface InspectorSession {
  sessionId: string;
  window: WindowProxy;
}

interface BridgeBase {
  protocol: typeof BRIDGE_PROTOCOL;
  version: typeof BRIDGE_VERSION;
  sessionId: string;
}

interface InspectorReady extends BridgeBase {
  type: 'inspector-ready';
}

interface Acknowledgement extends BridgeBase {
  type: 'ack';
  generation: number;
  contextId: string;
  sequence: number;
}

interface Reset extends BridgeBase {
  type: 'reset';
  generation: number;
}

interface HostReady extends BridgeBase {
  type: 'host-ready';
  generation: number;
}

interface HostCapture extends BridgeBase {
  type: 'capture';
  generation: number;
  contextId: DemoContextId;
  sequence: number;
  kind: CaptureKind;
  captured: Captured;
}

interface ResetAcknowledgement extends BridgeBase {
  type: 'reset-ack';
  generation: number;
}

interface FrameObservation {
  protocol: typeof DEMO_OBSERVER_PROTOCOL;
  version: typeof DEMO_OBSERVER_VERSION;
  type: 'capture';
  capture: CaptureTransport;
}

type CaptureTransport = Parameters<CaptureDelivery>[0];

interface RegisteredContext {
  id: DemoContextId;
  kind: CaptureContextV1['kind'];
  source: WindowProxy;
  origin: string;
}

interface FrameRegistration {
  frame: HTMLIFrameElement;
  origin: string;
}

/**
 * Parent-side bridge used only by the neutral demo. Child frames emit the
 * ordinary validated Koshko message locally; this host assigns their trusted
 * context identity and relays normalized captures to the inspector iframe.
 */
export class EmbeddedObservationHost {
  private readonly contexts = new Map<WindowProxy, RegisteredContext>();
  private readonly queues = new Map<DemoContextId, PendingCapture[]>();
  private readonly sequenceByContext = new Map<DemoContextId, number>();
  private session: InspectorSession | undefined;
  private generation = 0;

  constructor(
    private readonly inspectorOrigin: string,
    inspector: HTMLIFrameElement,
    frames: ReadonlyMap<Exclude<DemoContextId, 'top'>, FrameRegistration>,
    private readonly target: Window = window,
  ) {
    const inspectorWindow = inspector.contentWindow;
    if (!inspectorWindow) throw new Error('Inspector iframe window is unavailable.');
    this.contexts.set(inspectorWindow, { id: 'top', kind: 'top', source: inspectorWindow, origin: inspectorOrigin });
    for (const [id, registration] of frames) {
      const source = registration.frame.contentWindow;
      if (!source) throw new Error(`Widget iframe '${id}' window is unavailable.`);
      this.contexts.set(source, { id, kind: 'frame', source, origin: registration.origin });
    }
    this.target.addEventListener('message', this.onMessage);
  }

  dispose(): void {
    this.target.removeEventListener('message', this.onMessage);
    this.contexts.clear();
    this.queues.clear();
    this.session = undefined;
  }

  captureTop: CaptureDelivery = (capture) => {
    this.capture({ id: 'top', kind: 'top' }, capture);
  };

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (!isWindowProxy(event.source)) return;
    const context = this.contexts.get(event.source);
    if (!context || event.origin !== context.origin) return;

    if (this.isInspector(context, event.source)) {
      this.handleInspectorMessage(event.source, event.data);
      return;
    }
    const observation = parseFrameObservation(event.data);
    if (!observation) return;
    this.capture({ id: context.id, kind: context.kind }, observation.capture);
  };

  private isInspector(context: RegisteredContext, source: WindowProxy): boolean {
    return context.id === 'top' && context.source === source;
  }

  private handleInspectorMessage(source: WindowProxy, value: unknown): void {
    const message = parseInspectorMessage(value);
    if (!message) return;
    if (message.type === 'inspector-ready') {
      this.session = { sessionId: message.sessionId, window: source };
      this.post({
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_VERSION,
        type: 'host-ready',
        sessionId: message.sessionId,
        generation: this.generation,
      });
      this.flushAll();
      return;
    }
    if (!this.session || this.session.window !== source || message.sessionId !== this.session.sessionId) return;
    if (message.type === 'ack') {
      if (message.generation !== this.generation || !isContextId(message.contextId) || !isSequence(message.sequence)) return;
      this.acknowledge(message.contextId as DemoContextId, message.sequence);
      return;
    }
    if (message.type === 'reset' && message.generation === this.generation) {
      this.generation += 1;
      this.queues.clear();
      this.sequenceByContext.clear();
      this.post({
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_VERSION,
        type: 'reset-ack',
        sessionId: message.sessionId,
        generation: this.generation,
      });
    }
  }

  private capture(context: CaptureContextV1, transport: CaptureTransport): void {
    if (getByteLength(transport) > MAX_BYTES_PER_CONTEXT) return;
    const captured = normalizeCaptured(context, transport);
    if (!captured) return;
    const contextId = context.id as DemoContextId;
    const sequence = (this.sequenceByContext.get(contextId) ?? 0) + 1;
    this.sequenceByContext.set(contextId, sequence);
    const pending: PendingCapture = {
      contextId,
      sequence,
      kind: transport.kind,
      captured,
      byteLength: getByteLength(captured),
    };
    if (pending.byteLength > MAX_BYTES_PER_CONTEXT) return;
    const queue = this.queues.get(contextId) ?? [];
    queue.push(pending);
    this.evict(queue);
    this.queues.set(contextId, queue);
    this.postCapture(pending);
  }

  private evict(queue: PendingCapture[]): void {
    let bytes = queue.reduce((total, event) => total + event.byteLength, 0);
    while (queue.length > MAX_EVENTS_PER_CONTEXT || bytes > MAX_BYTES_PER_CONTEXT) {
      const oldest = queue.shift();
      if (!oldest) return;
      bytes -= oldest.byteLength;
    }
  }

  private flushAll(): void {
    for (const queue of this.queues.values()) {
      queue.forEach((pending) => this.postCapture(pending));
    }
  }

  private postCapture(pending: PendingCapture): void {
    if (!this.session) return;
    this.post({
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_VERSION,
      type: 'capture',
      sessionId: this.session.sessionId,
      generation: this.generation,
      contextId: pending.contextId,
      sequence: pending.sequence,
      kind: pending.kind,
      captured: pending.captured,
    });
  }

  private acknowledge(contextId: DemoContextId, sequence: number): void {
    const queue = this.queues.get(contextId);
    if (!queue) return;
    const remaining = queue.filter((pending) => pending.sequence > sequence);
    if (remaining.length === 0) {
      this.queues.delete(contextId);
    } else {
      this.queues.set(contextId, remaining);
    }
  }

  private post(message: HostReady | HostCapture | ResetAcknowledgement): void {
    if (!this.session) return;
    this.session.window.postMessage(message, this.inspectorOrigin);
  }
}

export function createEmbeddedObservationHost(): EmbeddedObservationHost {
  const inspector = document.querySelector<HTMLIFrameElement>('#koshko-inspector');
  const embedded = document.querySelector<HTMLIFrameElement>('#frame-embedded');
  const processing = document.querySelector<HTMLIFrameElement>('#frame-processing');
  if (!inspector || !embedded || !processing) {
    throw new Error('The embedded inspector fixture is incomplete.');
  }
  return new EmbeddedObservationHost(location.origin, inspector, new Map([
    ['embedded', { frame: embedded, origin: location.origin }],
    ['processing', { frame: processing, origin: location.origin }],
  ]));
}

export function postFrameCapture(capture: CaptureTransport, parentOrigin: string): void {
  window.parent.postMessage({
    protocol: DEMO_OBSERVER_PROTOCOL,
    version: DEMO_OBSERVER_VERSION,
    type: 'capture',
    capture,
  } satisfies FrameObservation, parentOrigin);
}

function normalizeCaptured(context: CaptureContextV1, transport: CaptureTransport): Captured | undefined {
  const metadata = {
    observedAt: transport.observedAt,
    captureContext: context,
    navigationId: transport.navigationId,
    frameUrl: transport.frameUrl,
    frameOrigin: transport.frameOrigin,
  };
  if (transport.kind === 'signal') return normalizeCapturedSignalV1({ signal: transport.signal, ...metadata });
  if (transport.kind === 'state-mutation') return normalizeCapturedStateMutationV1({ mutation: transport.mutation, ...metadata });
  if (transport.kind === 'error') return normalizeCapturedErrorV1({ error: transport.error, ...metadata });
  return undefined;
}

function parseFrameObservation(value: unknown): FrameObservation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<FrameObservation>;
  if (record.protocol !== DEMO_OBSERVER_PROTOCOL || record.version !== DEMO_OBSERVER_VERSION || record.type !== 'capture') return undefined;
  return isCaptureTransport(record.capture) ? record as FrameObservation : undefined;
}

function parseInspectorMessage(value: unknown): InspectorReady | Acknowledgement | Reset | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = value as Record<string, unknown>;
  if (message.protocol !== BRIDGE_PROTOCOL || message.version !== BRIDGE_VERSION || !isSessionId(message.sessionId)) return undefined;
  if (message.type === 'inspector-ready') return message as unknown as InspectorReady;
  if (message.type === 'ack' && isGeneration(message.generation) && isContextId(message.contextId) && isSequence(message.sequence)) return message as unknown as Acknowledgement;
  if (message.type === 'reset' && isGeneration(message.generation)) return message as unknown as Reset;
  return undefined;
}

function isCaptureTransport(value: unknown): value is CaptureTransport {
  if (!value || typeof value !== 'object') return false;
  const capture = value as Partial<CaptureTransport>;
  const raw = capture as Record<string, unknown>;
  if (!((capture.kind === 'signal' || capture.kind === 'state-mutation' || capture.kind === 'error')
    && typeof capture.observedAt === 'number'
    && typeof capture.navigationId === 'string'
    && typeof capture.frameUrl === 'string'
    && typeof capture.frameOrigin === 'string')) return false;
  if (capture.kind === 'signal') {
    return parseKoshkoWindowMessageV1({ protocol: 'koshko', version: 1, type: 'signal', signal: raw.signal }) !== undefined;
  }
  if (capture.kind === 'state-mutation') {
    return parseKoshkoStateMutationWindowMessageV1({ protocol: 'koshko', version: 1, type: 'state-mutation', mutation: raw.mutation }) !== undefined;
  }
  return parseKoshkoErrorWindowMessageV1({ protocol: 'koshko', version: 1, type: 'error', error: raw.error }) !== undefined;
}

function isWindowProxy(value: MessageEventSource | null): value is WindowProxy {
  return value !== null && typeof value === 'object' && 'postMessage' in value;
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isContextId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function getByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
