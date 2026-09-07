import { createStateEmitter, type StateEmitter } from '@koshko/emitter';
import { onNotify, type AnyStore, type Store } from 'nanostores';

const DEFAULT_NAMESPACE = 'nanostores';
const DEFAULT_PRODUCER_ID = 'nanostores';

export type NanoStores = Readonly<Record<string, AnyStore>>;

export interface ConnectNanoStoresOptions {
  /** Root key under which registered Nano Stores are exposed in Koshko Global State. */
  namespace?: string;
  /** Koshko state-mutation producer identifier. */
  producerId?: string;
}

/**
 * Publishes Nano Stores values to Koshko Global State through Nano Stores
 * notification hooks. Call the returned function to detach all
 * bridge hooks. Console logging remains independently controlled by callers.
 */
export function connectNanoStores(
  stores: NanoStores,
  options: ConnectNanoStoresOptions = {},
): () => void {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const emitter = createStateEmitter({
    producerId: options.producerId ?? DEFAULT_PRODUCER_ID,
  });
  const namespacePath = toJsonPointer(namespace);

  emitSnapshot(emitter, namespacePath, stores);

  const bridgeCleanups = Object.values(stores).map((store) => onNotify(
    store as Store,
    () => {
      emitSnapshot(emitter, namespacePath, stores);
    },
  ));

  return () => {
    for (const cleanup of bridgeCleanups) {
      cleanup();
    }
  };
}

function emitSnapshot(
  emitter: StateEmitter,
  namespacePath: string,
  stores: NanoStores,
): void {
  const snapshot: Record<string, unknown> = {};

  for (const [storeName, store] of Object.entries(stores)) {
    snapshot[storeName] = store.get();
  }

  emitter.mutate([
    {
      op: 'add',
      path: namespacePath,
      value: snapshot,
    },
  ]);
}

function toJsonPointer(segment: string): string {
  return `/${escapeJsonPointerSegment(segment)}`;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}
