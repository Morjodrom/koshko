# Koshko Nano Stores bridge

`@koshko/nanostores` publishes selected [Nano Stores](https://github.com/nanostores/nanostores)
values to the Koshko **Global State** view. The bridge observes Nano Stores
notifications and never writes to the browser console or owns action hooks.
Direct writes and mutations wrapped in `action()` are both observed.

```ts
import { connectNanoStores } from '@koshko/nanostores';
import { atom, map } from 'nanostores';

const $counter = atom(0);
const $profile = map({ name: 'Ada' });

const disconnect = connectNanoStores({
  counter: $counter,
  profile: $profile,
});

// Later, when the instrumentation is no longer needed:
disconnect();
```

Console logging is an independent, optional concern. If the application wants
the standard [`@nanostores/logger`](https://github.com/nanostores/logger) output,
configure it separately. Either cleanup function can be called independently:

```ts
import { logger } from '@nanostores/logger';

const disconnectKoshko = connectNanoStores({ counter: $counter });
const disconnectLogger = logger({ counter: $counter });

disconnectKoshko();
disconnectLogger();
```

The initial snapshot is emitted immediately. Every later change emits a fresh
grouped snapshot as an `add` operation. This makes updates self-healing when the
DevTools panel was opened after the initial page message and therefore missed
it. By default the values are grouped under `nanostores`, producing state shaped
like:

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
including its normalization, redaction, size limits, and safe transport
behavior. Action names, arguments, and lifecycle metadata are intentionally not
forwarded to Koshko.
