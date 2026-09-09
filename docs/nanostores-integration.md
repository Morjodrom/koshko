# Integrating a Nano Stores application with Koshko

`@koshko/nanostores` publishes selected Nano Stores to the **Global State** tab
in Koshko Inspector. The bridge sends an initial snapshot and refreshes it after
each store notification. It does not change application state and does not add
entries to Koshko's Timeline or Log views.

## Prerequisites

You need:

- `nanostores` in the application;
- access to the `@koshko/nanostores` package;
- the Koshko browser extension; and
- permission for the application's origin in the extension Options page.

The Koshko packages in this prototype are private, source-only workspace
packages. They are not currently available from the public npm registry. Add
`@koshko/nanostores` through the checked-out workspace, a local package path, or
another approved internal distribution method.

## Register application stores

Import `connectNanoStores` and pass it a stable name for every store that should
be visible in Koshko:

```ts
import { connectNanoStores } from '@koshko/nanostores';
import { $counter, $profile } from './stores';

const disconnectKoshko = import.meta.env.DEV
  ? connectNanoStores({
      counter: $counter,
      profile: $profile,
    })
  : undefined;
```

Keep the registration long-lived. Do not reconnect on every component render or
store update. Call the returned cleanup function when the application or
development instrumentation is disposed:

```ts
window.addEventListener('pagehide', () => {
  disconnectKoshko?.();
}, { once: true });

if (import.meta.hot) {
  import.meta.hot.dispose(() => disconnectKoshko?.());
}
```

Adapt `import.meta.env.DEV` and the hot-module API to the application's bundler.
Koshko instrumentation should be excluded from production builds.

## Inspect the resulting state

By default, registered stores appear under the `nanostores` key:

```json
{
  "nanostores": {
    "counter": 3,
    "profile": {
      "name": "Ada",
      "visits": 1
    }
  }
}
```

The object keys passed to `connectNanoStores` become the displayed store names.
Use stable, descriptive names and avoid user data or secrets in them.

The bridge observes Nano Stores notifications, so ordinary `set()` and
`setKey()` calls are captured. Mutations wrapped in `@nanostores/logger`'s
`action()` are captured as state changes as well; no additional Koshko setup is
required.

## Optional configuration

Use a different root key when the application needs to avoid a collision with
another state publisher:

```ts
const disconnectKoshko = connectNanoStores(
  {
    counter: $counter,
    profile: $profile,
  },
  {
    namespace: 'checkoutStores',
    producerId: 'checkout-nanostores',
  },
);
```

- `namespace` defaults to `nanostores` and becomes one top-level Global State
  key.
- `producerId` defaults to `nanostores`. Override it when several independent
  bridge instances need distinct producer identities.

All inspected frames share the same Global State root. Applications that
register stores in multiple frames should give each bridge a distinct namespace
to prevent one frame from replacing another frame's snapshot.

## Enable the extension

1. Build or load the Koshko development extension.
2. Open its Options page and grant the application origin. Grant iframe origins
   separately when cross-origin frames also publish state.
3. Reload the application after granting permission.
4. Open browser DevTools and select **Koshko Inspector**.
5. Open **Global State** and mutate one of the registered stores.

The initial snapshot is emitted when `connectNanoStores` runs. If DevTools is
opened after that message, the next store mutation publishes a complete fresh
snapshot, so the `nanostores` branch will appear without another page reload.

## Data handling

Store values pass through the normal Koshko state emitter. Unsupported values
are normalized, sensitive-looking keys are redacted, URL queries and fragments
are removed, and oversized mutations are not transported. Treat this processing
as a safety net: register only stores that are appropriate for developer
inspection and avoid placing credentials or customer data in diagnostic state.

Nano Stores console logging remains independent from Koshko. Applications may
configure `@nanostores/logger` separately, but it is not required for Global
State synchronization.
