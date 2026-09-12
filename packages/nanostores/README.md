# Koshko Nano Stores adapter

`@koshko/nanostores` is an optional development adapter that publishes selected
[Nano Stores](https://github.com/nanostores/nanostores) values to Koshko
Inspector's **Global State** view. It observes stores through their public
`get()` and `listen()` methods. It does not import or bundle a Nano Stores
runtime, write to the browser console, or own action hooks.

Direct writes and mutations wrapped in `action()` are both observed.
Because observation uses `listen()`, registered stores remain mounted until the
returned cleanup function is called. This can start effects configured through
Nano Stores lifecycle hooks, so register only stores that should be active
during inspection.

## Install

During the tarball pilot, obtain all three Koshko artifacts and install them
together from the consumer project:

```bash
npm install --save-dev \
  ./artifacts/koshko-protocol-0.1.0.tgz \
  ./artifacts/koshko-emitter-0.1.0.tgz \
  ./artifacts/koshko-nanostores-0.1.0.tgz
```

Install all three in the same command because emitter and protocol are not yet
available from a registry. The application imports only
`@koshko/nanostores`; the other packages satisfy its transitive dependencies.

After registry publication, and only once all three packages are available
from npm, the installation becomes:

```bash
npm install --save-dev @koshko/nanostores
```

The application remains the owner of its Nano Stores version; the adapter does
not install another copy. Development dependencies must be present while the
frontend is built, but can be omitted from the final deployed image after
static assets are produced. See
[`docs/package-distribution.md`](../../docs/package-distribution.md) for
artifact production and inspection.

## Development-only entry

Keep instrumentation in a dedicated module:

```ts
// src/devtools/koshko.ts
import { connectNanoStores } from '@koshko/nanostores';
import { $counter, $profile } from '../stores';

export function startKoshko(): () => void {
  return connectNanoStores({
    counter: $counter,
    profile: $profile,
  });
}
```

Load that module behind the bundler's compile-time development flag:

```ts
if (import.meta.env.DEV) {
  void import('./devtools/koshko').then(({ startKoshko }) => {
    const disconnect = startKoshko();

    import.meta.hot?.dispose(disconnect);
    window.addEventListener('pagehide', disconnect, { once: true });
  });
}
```

For Vite, `import.meta.env.DEV` is replaced at build time, allowing the dynamic
module and adapter to be removed from production output. Use the equivalent
compile-time constant or a development-only entry with other bundlers. A
`devDependency` classification alone does not make a static import
development-only.

## State shape and options

The initial snapshot is emitted immediately. Every later change emits a fresh
grouped snapshot as an `add` operation. Complete snapshots recover when the
DevTools panel opens after the initial page message and misses it.

By default values are grouped under `nanostores`:

```json
{
  "nanostores": {
    "counter": 0,
    "profile": { "name": "Ada" }
  }
}
```

Use `namespace` to change the root key and `producerId` to supply a custom
Koshko state-mutation producer identifier:

```ts
connectNanoStores(
  { counter: $counter },
  { namespace: 'applicationStores', producerId: 'checkout-nanostores' },
);
```

The namespace is escaped as a JSON Pointer segment, while store names remain
ordinary object keys. Values go through the normal Koshko state emitter,
including normalization, redaction, size limits, and safe transport. Action
names, arguments, and lifecycle metadata are intentionally not forwarded.

Console logging is independent. Applications that want the standard
`@nanostores/logger` output can configure and clean it up separately.

## Why this is not embedded in the extension

Nano Store instances are ordinary objects kept in the application's module
graph. An extension cannot enumerate them, and importing Nano Stores inside the
extension would create a separate module instance. Explicit registration is
therefore still required even if the adapter implementation were shipped in
the extension.

Keeping the adapter separate avoids extension bundle growth, state-library
version coupling, page-world globals, injection races, and exposing live store
references on `window`. See
[`docs/integrations.md`](../../docs/integrations.md) for the policy used by
other state-library adapters.
