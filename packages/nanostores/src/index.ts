import { createStateEmitter, type StateEmitter } from '@koshko/emitter';

const DEFAULT_NAMESPACE = 'nanostores';
const DEFAULT_PRODUCER_ID = 'nanostores';

/**
 * The public subset of a Nano Store used by the bridge.
 *
 * Keeping this contract structural prevents the integration package from
 * loading, bundling, or version-locking the application's Nano Stores runtime.
 */
export interface NanoStore {
  get(): unknown;
  listen(
    listener: (
      value: unknown,
      oldValue?: unknown,
      changedKey?: PropertyKey,
    ) => void,
  ): () => void;
}

export type NanoStores = Readonly<Record<string, NanoStore>>;

export interface ConnectNanoStoresOptions {
  /** Root key under which registered Nano Stores are exposed in Koshko Global State. */
  namespace?: string;
  /** Koshko state-mutation producer identifier. */
  producerId?: string;
}

/**
 * Publishes Nano Stores values to Koshko Global State through each store's
 * public listener API. Call the returned function to detach all listeners.
 * Console logging remains independently controlled by callers.
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

  emitSnapshot(emitter, namespacePath, stores, 'Nano Stores initial snapshot');

  const bridgeCleanups = Object.entries(stores).map(([storeName, store]) => store.listen(
    (_value, _oldValue, changedKey) => {
      emitSnapshot(emitter, namespacePath, stores, createChangeLabel(storeName, changedKey));
    },
  ));
  let connected = true;

  return () => {
    if (!connected) {
      return;
    }
    connected = false;

    for (const cleanup of bridgeCleanups) {
      cleanup();
    }
  };
}

function emitSnapshot(
  emitter: StateEmitter,
  namespacePath: string,
  stores: NanoStores,
  label: string,
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
  ], { label });
}

function createChangeLabel(storeName: string, changed: PropertyKey | undefined): string {
  const target = changed === undefined ? storeName : `${storeName}.${String(changed)}`;
  return `Nano Stores ${target} changed`;
}

function toJsonPointer(segment: string): string {
  return `/${escapeJsonPointerSegment(segment)}`;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}
