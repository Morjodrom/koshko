import {
  createActorFlowWindowMessageV1,
  normalizeActorFlowSignalV1,
  normalizeActorReference,
  type ActorFlowSeverity,
  type ActorFlowSignalV1,
  type ActorReference,
} from '@actor-flow/protocol';

export interface ActorEmitterOptions extends ActorReference {
  producerId?: string;
}

export interface EmitOptions {
  severity?: ActorFlowSeverity;
  correlationId?: string;
  causedBy?: string;
  tags?: readonly string[];
  context?: Readonly<Record<string, string>>;
  occurredAt?: number;
}

export interface ActorEmitter {
  readonly source: ActorReference;
  readonly producerId: string;
  event(name: string, details?: unknown, options?: EmitOptions): ActorFlowSignalV1;
  to(target: ActorReference | string, name: string, details?: unknown, options?: EmitOptions): ActorFlowSignalV1;
}

const CHANNEL = 'actor-flow';

export function createActorEmitter(options: ActorEmitterOptions): ActorEmitter {
  const source = normalizeActorReference(options);
  const producerId = normalizeProducerId(options.producerId ?? createDefaultProducerId(source.id));
  let producerSequence = 0;

  function emit(target: ActorReference | string | undefined, name: string, details?: unknown, emitOptions?: EmitOptions): ActorFlowSignalV1 {
    producerSequence += 1;
    const occurredAt = typeof emitOptions?.occurredAt === 'number' ? emitOptions.occurredAt : now();
    const signal = normalizeActorFlowSignalV1({
      protocol: CHANNEL,
      version: 1,
      id: createSignalId(producerId, producerSequence, occurredAt),
      producerId,
      producerSequence,
      occurredAt,
      source,
      target: target === undefined ? undefined : normalizeTarget(target),
      name,
      severity: emitOptions?.severity,
      details,
      context: emitOptions?.context,
      correlationId: emitOptions?.correlationId,
      causedBy: emitOptions?.causedBy,
      tags: emitOptions?.tags,
    });

    postWindowMessage(signal);
    return signal;
  }

  return {
    source,
    producerId,
    event(name, details, options) {
      return emit(undefined, name, details, options);
    },
    to(target, name, details, options) {
      return emit(target, name, details, options);
    },
  };
}

function normalizeTarget(target: ActorReference | string): ActorReference {
  return typeof target === 'string' ? normalizeActorReference({ id: target }) : normalizeActorReference(target);
}

function postWindowMessage(signal: ActorFlowSignalV1): void {
  try {
    const currentWindow = globalThis.window;
    if (!currentWindow || typeof currentWindow.postMessage !== 'function') {
      return;
    }

    currentWindow.postMessage(createActorFlowWindowMessageV1(signal), '*');
  } catch {
    // Safe failure: the emitter must never throw into application code.
  }
}

function normalizeProducerId(input: string): string {
  return sanitizeIdentifier(input || 'producer');
}

function createDefaultProducerId(sourceId: string): string {
  const seed = `${sourceId}:${now()}:${Math.random().toString(36).slice(2, 8)}`;
  return `producer:${sanitizeIdentifier(seed)}`;
}

function createSignalId(producerId: string, sequence: number, occurredAt: number): string {
  return sanitizeIdentifier(`${producerId}:${sequence}:${Math.trunc(occurredAt)}`);
}

function sanitizeIdentifier(value: string): string {
  const stripped = value.replace(/\p{C}/gu, '');
  return stripped.length > 128 ? Array.from(stripped).slice(0, 128).join('') : stripped;
}

function now(): number {
  try {
    const performanceObject = globalThis.performance;
    if (performanceObject && typeof performanceObject.now === 'function' && typeof performanceObject.timeOrigin === 'number') {
      return performanceObject.timeOrigin + performanceObject.now();
    }
  } catch {
    // fall through
  }
  return Date.now();
}
