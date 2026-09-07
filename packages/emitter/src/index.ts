import {
  createKoshkoStateMutationWindowMessageV1,
  createKoshkoWindowMessageV1,
  isKoshkoStateMutationV1,
  normalizeKoshkoStateMutationV1,
  normalizeKoshkoSignalV1,
  normalizeActorReference,
  type KoshkoProtocolWindowMessageV1,
  type KoshkoSeverity,
  type KoshkoSignalV1,
  type KoshkoStateMutationV1,
  type ActorReference,
} from '@koshko/protocol';

export interface ActorEmitterOptions extends ActorReference {
  producerId?: string;
}

export interface EmitOptions {
  severity?: KoshkoSeverity;
  correlationId?: string;
  causedBy?: string;
  tags?: readonly string[];
  context?: Readonly<Record<string, string>>;
  occurredAt?: number;
}

export interface ActorEmitter {
  readonly source: ActorReference;
  readonly producerId: string;
  event(name: string, details?: unknown, options?: EmitOptions): KoshkoSignalV1;
  to(target: ActorReference | string, name: string, details?: unknown, options?: EmitOptions): KoshkoSignalV1;
}

export interface StateEmitterOptions {
  producerId?: string;
}

export interface StateMutationOptions {
  occurredAt?: number;
  label?: string;
}

export type StatePatchOperationInput =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown };

export interface StateEmitter {
  readonly producerId: string;
  mutate(
    patch: readonly StatePatchOperationInput[],
    options?: StateMutationOptions,
  ): KoshkoStateMutationV1;
}

const CHANNEL = 'koshko';

export function createActorEmitter(options: ActorEmitterOptions): ActorEmitter {
  const source = normalizeActorReference(options);
  const producerId = normalizeProducerId(options.producerId ?? createDefaultProducerId(source.id));
  let producerSequence = 0;

  function emit(target: ActorReference | string | undefined, name: string, details?: unknown, emitOptions?: EmitOptions): KoshkoSignalV1 {
    producerSequence += 1;
    const occurredAt = typeof emitOptions?.occurredAt === 'number' ? emitOptions.occurredAt : now();
    const signal = normalizeKoshkoSignalV1({
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

    postWindowMessage(createKoshkoWindowMessageV1(signal));
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

export function createStateEmitter(options: StateEmitterOptions = {}): StateEmitter {
  const producerId = normalizeProducerId(options.producerId ?? createDefaultStateProducerId());
  let producerSequence = 0;

  return {
    producerId,
    mutate(patch, mutationOptions) {
      producerSequence += 1;
      const occurredAt = getStateMutationOccurredAt(mutationOptions);
      const input = {
        protocol: CHANNEL,
        version: 1,
        id: createMutationId(producerId, producerSequence, occurredAt),
        producerId,
        producerSequence,
        occurredAt,
        label: mutationOptions?.label,
        patch,
      };
      let mutation: KoshkoStateMutationV1;
      try {
        mutation = normalizeKoshkoStateMutationV1(input);
      } catch {
        mutation = normalizeKoshkoStateMutationV1({ ...input, patch: [] });
      }

      if (isKoshkoStateMutationV1(mutation)) {
        postWindowMessage(createKoshkoStateMutationWindowMessageV1(mutation));
      }
      return mutation;
    },
  };
}

function getStateMutationOccurredAt(options: StateMutationOptions | undefined): number {
  try {
    return typeof options?.occurredAt === 'number' ? options.occurredAt : now();
  } catch {
    return now();
  }
}

function normalizeTarget(target: ActorReference | string): ActorReference {
  return typeof target === 'string' ? normalizeActorReference({ id: target }) : normalizeActorReference(target);
}

function postWindowMessage(message: KoshkoProtocolWindowMessageV1): void {
  try {
    const currentWindow = globalThis.window;
    if (!currentWindow || typeof currentWindow.postMessage !== 'function') {
      return;
    }

    currentWindow.postMessage(message, '*');
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

function createDefaultStateProducerId(): string {
  const seed = `${now()}:${Math.random().toString(36).slice(2, 8)}`;
  return `state:${sanitizeIdentifier(seed)}`;
}

function createSignalId(producerId: string, sequence: number, occurredAt: number): string {
  return sanitizeIdentifier(`${producerId}:${sequence}:${Math.trunc(occurredAt)}`);
}

function createMutationId(producerId: string, sequence: number, occurredAt: number): string {
  return sanitizeIdentifier(`state-mutation:${producerId}:${sequence}:${Math.trunc(occurredAt)}`);
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
