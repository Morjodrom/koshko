# State-library integration architecture

Koshko Inspector receives a small, validated wire protocol. The extension does
not import application state libraries and does not attempt to discover state
objects inside an inspected page.

## Package responsibilities

```text
apps/extension/          protocol consumer and DevTools UI
packages/protocol/       validation, normalization, and wire types
packages/emitter/        state-library-neutral page transport
packages/nanostores/     optional Nano Stores adapter
examples/neutral-demo/   development-only integration fixture
```

Future state-library integrations should follow the same pattern as
`packages/nanostores/`: one independently testable package per library, named
`@koshko/<library>`. An adapter may depend on `@koshko/emitter`, but the
extension must not depend on an adapter.

## Why adapters are application-side

Stores are live JavaScript objects in the application's module graph. A browser
extension cannot reliably enumerate those objects, and loading another copy of
a state library does not expose stores created by the application's copy.
Content-script isolation adds another boundary: serializable protocol messages
can cross it, but live references cannot.

An extension-injected MAIN-world global could receive explicitly registered
stores, but registration would still be required. It would also introduce a
global API, ordering and reload races, cross-browser injection differences,
and additional visibility of store references to page scripts. Koshko therefore
uses explicit, application-side adapters as its primary integration model.

## Adapter rules

Each adapter should:

1. Accept explicitly named state objects from the application.
2. Use the library's public subscription and read APIs.
3. Depend on structural interfaces where practical instead of importing the
   state library at runtime.
4. Emit only through `@koshko/emitter` and the shared protocol.
5. Return an idempotent cleanup function.
6. Keep console logging and other developer tools independent.
7. Document serialization, redaction, snapshot-size, and update-cost behavior.
8. Remain outside `apps/extension` and never become an extension dependency.

State-library packages needed only by adapter tests belong in the adapter's
`devDependencies`. If an adapter must import a library at runtime, declare that
library as a peer dependency so the inspected project remains the owner of the
runtime version.

## Consumer pattern

### Tarball pilot

The Koshko packages are not in a registry during the pilot. Obtain the three
artifacts produced by `npm run pack:packages`, copy them into or next to the
consumer project, and install them **together in one command**:

```bash
npm install --save-dev \
  ./artifacts/koshko-protocol-0.1.0.tgz \
  ./artifacts/koshko-emitter-0.1.0.tgz \
  ./artifacts/koshko-nanostores-0.1.0.tgz
```

Installing only the Nanostores tarball does not work during the pilot: its
`@koshko/emitter` and `@koshko/protocol` dependencies are not available from a
registry yet. The three-package install lets npm resolve the complete local
chain. The application does not need to import protocol or emitter directly.

The tarballs are development dependencies and must be available in the
frontend build environment. They do not need to be copied into the deployed
static assets or runtime image.

See [`package-distribution.md`](package-distribution.md) for instructions on
building and inspecting the artifacts.

### Registry distribution

After all three packages are published to the configured npm registry, install
only the adapter required by the project:

```bash
npm install --save-dev @koshko/nanostores
```

npm will install emitter and protocol transitively.

### Application setup

Keep its import in a dedicated development module and load that module behind
a compile-time development flag:

```ts
// src/devtools/koshko.ts
import { connectNanoStores } from '@koshko/nanostores';
import { $session, $settings } from '../state';

export function startKoshko(): () => void {
  return connectNanoStores({ session: $session, settings: $settings });
}
```

```ts
// src/main.ts
if (import.meta.env.DEV) {
  void import('./devtools/koshko').then(({ startKoshko }) => {
    const disconnect = startKoshko();
    import.meta.hot?.dispose(disconnect);
    window.addEventListener('pagehide', disconnect, { once: true });
  });
}
```

`devDependency` describes installation intent; it does not make a static import
conditional. The compile-time guard or a separate development entry is what
keeps adapter code out of production bundles. Frontend build stages should
install development dependencies, build the assets, and omit those dependencies
only from the final runtime image.

## Nano Stores behavior

The Nano Stores adapter emits an immediate grouped snapshot and emits a fresh
grouped snapshot after every observed change. Complete snapshots recover when
DevTools opens after the initial message, but their CPU and message cost grows
with the total registered state size. Projects should register only useful
stores and rely on the emitter's normalization, redaction, and size limits.

Attaching through Nano Stores' public `listen()` API keeps each registered store
mounted until cleanup. This is more version-stable than patching internal
notification methods, but it can start lifecycle effects on otherwise inactive
stores. Consumers should always clean up and avoid registering irrelevant
stores.

If this becomes expensive, evolve the adapter independently by batching
notifications or emitting per-store patches. Such changes must not require a
new extension dependency on Nano Stores.
