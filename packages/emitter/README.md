# Koshko emitter

`@koshko/emitter` is the state-library-neutral page-side transport for Koshko
Inspector. It creates validated signal and state-mutation messages and posts
them to the current window for capture by the extension.

State-library adapters should depend on this package rather than implementing
their own wire transport.

## Install

The package is prepared for public npm publication but is not available from
the registry yet. After publication, install it with:

```bash
npm install @koshko/emitter
```

Before publication, install the protocol and emitter tarballs together using
the [package distribution guide](../../docs/package-distribution.md).

## Usage

The package is ESM-only and targets browser page code. `createActorEmitter`
emits validated actor signals; `createStateEmitter` emits state-patch
messages. Both return the normalized message and safely do nothing if
`window.postMessage` is unavailable.

```ts
import { createActorEmitter, createStateEmitter } from '@koshko/emitter';

const checkout = createActorEmitter({ id: 'checkout', label: 'Checkout', producerId: 'checkout-ui' });
checkout.event('checkout.started', { cartSize: 2 });
checkout.to('payments', 'payment.requested', { amount: 42 });

const state = createStateEmitter({ producerId: 'checkout-state' });
state.mutate([{ op: 'replace', path: '/checkout/ready', value: true }]);
```

Keep instrumentation behind a development-only entry when it should not ship
in production bundles. See the [repository](https://github.com/Morjodrom/koshko)
and its [MIT license](../../LICENSE) for project details.
