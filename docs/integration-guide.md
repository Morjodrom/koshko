# Integrating a TypeScript web app with Koshko Dev Tools

Koshko Dev Tools observes **explicit semantic signals** from an inspected browser tab. It does not infer application meaning from arbitrary browser traffic, console output, network requests, or framework state. Add small, development-only calls at the points where your application knows what happened.

This guide is for a browser-based TypeScript application, SDK, or widget. The page-side API emits the version-1 `koshko` protocol using `window.postMessage` internally. **Application code must not construct or post Koshko window messages itself.** Use the emitter API below.

## Prerequisites and current package availability

The current emitter APIs are:

```ts
import { createActorEmitter, createStateEmitter } from '@koshko/emitter';
```

At present, `@koshko/emitter` and `@koshko/protocol` are private, source-only workspace packages in this prototype. They are **not published to a public npm registry**, so `npm install @koshko/emitter` will not work for an unrelated project. Until a distribution method is intentionally introduced, make the package available through a checked-out workspace, a local path/package-manager workspace dependency, or another internally approved source-sharing mechanism. Do not add a public dependency declaration based on an assumed registry package.

You also need:

- a Chromium browser and the development Koshko extension build;
- permission granted in the extension Options page for every origin to inspect; and
- a production build that can remove instrumentation at compile time.

## Model actors before adding calls

An **actor** is a logical participant, not necessarily a JavaScript object or a browser frame. Give each actor a stable `id`; use `label` only for human-facing panel text. If several concurrent copies share an actor lane, add `instanceId` and optionally `instanceLabel`.

Examples:

| Participant | Actor reference |
| --- | --- |
| browser user | `{ id: 'user', label: 'User' }` |
| storefront application | `{ id: 'checkout-host', label: 'Checkout host' }` |
| one payment widget | `{ id: 'payment-widget', instanceId: widgetId, label: 'Payment widget' }` |
| a particular widget frame | `{ id: 'payment-widget', instanceId: 'frame-a', instanceLabel: 'Primary frame' }` |

Create one long-lived emitter for each source actor in the execution context that produces its signals. By default, an emitter gets a generated `producerId` and maintains its own monotonically increasing sequence. Supply `producerId` only when your application has a stable producer identity that is useful for debugging; do not use customer, payment, or session secrets for it. Keep the actual creation inside the compile-time development guard shown in the complete example below.

```ts
const hostTrace = import.meta.env.DEV
  ? createActorEmitter({
      id: 'checkout-host',
      label: 'Checkout host',
      producerId: 'checkout-host:main',
    })
  : undefined;
```

Use stable, machine-readable event names such as `checkout.submit`, `payment.authorization.received`, and `widget.ready`. Do not use localized sentences, timestamps, random IDs, or user input as names. Put changing values in `details` or `context` instead.

## Minimal complete integration

The following Vite-oriented example emits a directed user-to-host action, a host-to-widget intent, and the host result. `import.meta.env.DEV` is a build-time constant in Vite: the production compiler can remove the guarded branches and the now-unused, side-effect-free emitter import. Adapt the guard to your bundler's compile-time development constant if you do not use Vite.

```ts
import { createActorEmitter } from '@koshko/emitter';

const developmentTraces = import.meta.env.DEV
  ? {
      user: createActorEmitter({ id: 'user', label: 'User' }),
      host: createActorEmitter({ id: 'checkout-host', label: 'Checkout host' }),
    }
  : undefined;

export async function submitCheckout(): Promise<void> {
  let flow: { correlationId: string; dispatchId: string } | undefined;

  if (import.meta.env.DEV && developmentTraces !== undefined) {
    const correlationId = createDevelopmentCorrelationId();
    const click = developmentTraces.user.to(
      'checkout-host',
      'checkout.submit',
      { itemCount: 3 },
      {
        severity: 'info',
        correlationId,
        tags: ['checkout', 'user-action'],
        context: { surface: 'cart' },
      },
    );

    const dispatch = developmentTraces.host.to(
      { id: 'payment-widget', instanceId: 'primary' },
      'payment.authorization.requested',
      { method: 'card' },
      {
        correlationId,
        causedBy: click.id,
        severity: 'info',
        tags: ['payment'],
        context: { checkoutMode: 'standard' },
      },
    );
    flow = { correlationId, dispatchId: dispatch.id };
  }

  await requestAuthorization();

  if (import.meta.env.DEV && developmentTraces !== undefined && flow !== undefined) {
    developmentTraces.host.event(
      'payment.authorization.received',
      { outcome: 'approved' },
      {
        correlationId: flow.correlationId,
        causedBy: flow.dispatchId,
        severity: 'success',
        tags: ['payment'],
      },
    );
  }
}

function createDevelopmentCorrelationId(): string {
  return `dev-checkout:${Math.random().toString(36).slice(2, 10)}`;
}

async function requestAuthorization(): Promise<void> {
  // Perform the application's normal authorization request here.
}
```

The calls return a normalized `KoshkoSignalV1`. Capturing a returned signal is useful for `causedBy`; application behavior must not depend on the return value. `createDevelopmentCorrelationId()` creates a random, development-only identifier and deliberately does not reuse a cart ID or user identifier. The normal checkout work stays outside the guards. The emitters are long-lived, so their producer sequences remain monotonic across calls. Every emitter creation and emission, plus the construction of its names, details, and options, stays inside a compile-time development branch and must be removed from a production build.

### `event()` versus `to()`

- `event(name, details?, options?)` records an internal/self event. It has only the emitter's source actor and creates no directional arrow. Use it for state transitions, received callbacks, validation outcomes, and readiness.
- `to(target, name, details?, options?)` records a directed action or message. The target is either an actor ID string or a complete `ActorReference`; use the latter to address a particular instance. It creates an explicit source-to-target relationship in the panel.

`to()` describes semantic intent; it does not deliver a browser message to that actor. Keep your real iframe/SDK/application communication separate, with its existing validation and origin checks.

## Global state mutations

The **Global State** panel tab reconstructs one framework-neutral JSON object. It is separate from semantic signals: state mutations do not appear in the Timeline or Log and are not included in signal JSONL exports.

Create one long-lived state emitter per JavaScript execution context that publishes state changes. As with actor emitters, create and call it only inside a compile-time development branch:

```ts
import { createStateEmitter } from '@koshko/emitter';

const developmentState = import.meta.env.DEV
  ? createStateEmitter({ producerId: 'checkout-state:main' })
  : undefined;

export function initializeCheckoutState(): void {
  if (import.meta.env.DEV && developmentState !== undefined) {
    developmentState.mutate([
      {
        op: 'add',
        path: '/checkout',
        value: {
          status: 'ready',
          itemCount: 3,
        },
      },
    ]);
  }
}

export function markCheckoutSubmitting(): void {
  if (import.meta.env.DEV && developmentState !== undefined) {
    developmentState.mutate([
      {
        op: 'replace',
        path: '/checkout/status',
        value: 'submitting',
      },
    ]);
  }
}

export function removeCheckoutState(): void {
  if (import.meta.env.DEV && developmentState !== undefined) {
    developmentState.mutate([
      { op: 'remove', path: '/checkout' },
    ]);
  }
}
```

`mutate()` accepts an ordered JSON Patch subset:

- `add` creates or replaces an object property, inserts an array element by index, or appends with `-`;
- `replace` requires the addressed property or array element to exist;
- `remove` requires the addressed property or array element to exist.

Paths are non-empty RFC 6901 JSON Pointers such as `/checkout/status`. Escape `~` as `~0` and `/` inside a property name as `~1`. The root begins as `{}` for each top-level navigation, so create parent objects before writing their children. A patch array is atomic: if any operation has an invalid path or cannot be applied, the panel keeps the previous state.

All inspected frames contribute to the same global root, and accepted mutations are applied in capture-arrival order. Pausing the panel freezes the displayed state while continuing to buffer mutations; resuming catches the inspector up. **Clear** and a new top-level navigation both reset the state to `{}`.

The emitter returns the normalized `KoshkoStateMutationV1`, but application behavior must not depend on it. Mutation values receive the same JSON normalization, URL sanitization, sensitive-key redaction, and 64 KiB record limit as other Koshko protocol data. Oversized or invalid mutations are not transported, and failures never throw into application code.

Framework-specific bridges should translate Vuex, Pinia, Nano Stores, or other store changes into this mutation API. Those bridges are optional integrations; applications may call `createStateEmitter()` directly as shown above.

## Metadata: make a flow diagnosable

Both methods accept an optional third/fourth `EmitOptions` argument:

```ts
trace.to('payment-widget', 'payment.authorization.requested', { method: 'card' }, {
  severity: 'info',
  correlationId: 'checkout:9f3c',
  causedBy: earlierSignal.id,
  tags: ['checkout', 'payment'],
  context: {
    surface: 'cart',
    experiment: 'three-step-checkout',
  },
});
```

- `severity` is one of `debug`, `info`, `success`, `warning`, or `error`.
- `tags` are short, stable category identifiers for filtering, for example `payment` or `retry`.
- `context` is a string-to-string map for compact dimensions; use it for bounded values such as a surface or feature variant.
- `correlationId` groups signals in one business or technical flow. Reuse the same value from click through completion.
- `causedBy` is the ID of a preceding Koshko signal, normally obtained from `event()` or `to()`. It records explicit causality; do not infer it from timing.
- `details` is JSON-compatible structured data that explains the event. Keep it small and task-specific.

## Frames, iframes, and origins

Each browser frame has its own `window`. The emitter always emits to **its own window**, so instrument the top-level app and every frame that has meaningful semantics. Do not expect a top-level emitter to capture an iframe's local event automatically, and do not use an iframe's normal `postMessage` transport as a substitute for its own emitter.

For a same-origin or cross-origin iframe, the extension can observe that frame only if its content script is allowed there. **Every inspected origin needs permission** in the extension Options page: grant the host origin and each child-frame origin that you want captured. Reload the tab after changing permissions. Signals from a frame without permission will not reach the Koshko panel, even if that frame emits correctly.

Cross-origin application messaging remains subject to the browser's normal security model. Continue to use explicit target origins and validate incoming messages for your application's own `postMessage` protocol. Koshko's helper is independent of that protocol and should not carry private transport payloads.

## Extension setup and verification

1. From the Koshko repository, start the extension development server:
   ```bash
   npm run dev:extension
   ```
2. In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:
   ```text
   apps/extension/.output/chrome-mv3-dev/chrome-mv3
   ```
3. Open the extension **Options** page. Add and grant the host origin and every iframe origin you will inspect.
4. Reload the target tab, open DevTools, and select the **Koshko** panel.
5. Trigger the instrumented action. Check that the Timeline shows the source actor, and that directed events show the intended target. Check the Log/details view for the event name, correlation ID, tags, and safe details. If the application emits state mutations, open **Global State** and verify the reconstructed JSON value.

For a local smoke test of the prototype, run `npm run dev:demo`, grant `http://127.0.0.1:5173`, reload the demo, and open the Koshko panel. The scenario buttons exercise top-level and iframe signals. The dedicated **Add global state**, **Replace global state value**, and **Remove global state value** buttons exercise direct state mutations; use Add before Replace or Remove, then inspect the **Global State** tab.

## Production exclusion is mandatory

Koshko instrumentation is development-only. A runtime no-op by itself is not enough: the production bundle must exclude the instrumentation calls and emitter code through compile-time dead-code elimination.

- Guard creation and calls with a bundler-replaced compile-time constant such as Vite's `import.meta.env.DEV`, not a value loaded from `localStorage`, an HTTP configuration response, or an environment lookup performed at runtime.
- Ensure the production bundler is configured to replace that constant with `false`, then tree-shake unreachable branches and unused imports.
- Inspect the production output (and, where practical, its source map or bundle report) to confirm no `@koshko/emitter`, `createActorEmitter`, `createStateEmitter`, the `koshko` protocol marker, or unique Koshko diagnostic event-name strings remain.
- Keep the emitter out of published SDK production entry points unless that entry point has a separate development-only build that is eliminated before publishing.

The helper already fails safely if browser messaging is unavailable or serialization/observer work fails, but that safety property does **not** satisfy the production-exclusion requirement.

## Privacy and payload rules

Koshko is local-only and in-memory: do not add analytics, remote upload, session replay, DOM capture, screenshots, or network export to support this integration.

Before emitting, minimize the payload yourself:

- Never place credentials, authentication/payment/order tokens, cookies, authorization headers, passwords, secrets, personal data, full request/response bodies, or user-entered free text in `details`, `context`, actor IDs, producer IDs, or event names.
- Prefer booleans, enum outcomes, counts, safe error codes, and truncated/derived identifiers.
- Treat URLs as sensitive: avoid full URLs and query parameters. The protocol normalizer redacts common sensitive-key values and strips query/fragment portions from URL-like fields, but this is a safeguard, not permission to emit sensitive data.
- Keep details JSON-compatible and bounded. The normalizer limits nesting, keys, arrays, text, and total payload size; it may replace unsupported, circular, or oversized values with marker strings or truncation.
- Use stable non-secret actor and correlation identifiers. If an identifier could identify a user or authorize an action, replace it with a safe development-only correlation value.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No signals in the panel | Confirm the target tab was reloaded after permission was granted, DevTools is attached to that tab, and the Koshko panel is selected. |
| Top-level signals appear but iframe signals do not | Grant permission for the iframe's own origin as well as the host origin, reload, and ensure the iframe source calls `createActorEmitter` in that frame. |
| A signal has no arrow | Use `to()` for a directed event; `event()` intentionally has no target. |
| Multiple widget copies share one lane | Give each copy the same actor `id` and a distinct stable `instanceId`. |
| Global State remains `{}` | Confirm `createStateEmitter().mutate()` runs in the inspected frame, the frame origin has permission, and the first patch adds a top-level property such as `/checkout`. |
| A state mutation has no visible effect | Ensure every parent path exists, use `add` to create values before `replace` or `remove`, and use RFC 6901 escaping (`~0`, `~1`) for property names. The entire patch is rejected atomically if one operation cannot be applied. |
| Names/details look altered or truncated | Check for unsupported values, circular objects, excessive size/depth, control characters, or sensitive/URL-like field keys. Send a smaller JSON-compatible safe summary. |
| Production bundle still contains Koshko code | Your guard is runtime-only or the bundler did not replace/tree-shake it. Use a compile-time `false` production constant and inspect the built artifacts for the `koshko` protocol marker and unique diagnostic event-name strings. |
| `npm install @koshko/emitter` fails | Expected today: the package is private/source-only. Use an approved local/workspace source arrangement; no public npm distribution exists yet. |

## Integration checklist

- [ ] Make the current private/source-only `@koshko/emitter` package available through an approved local/workspace mechanism.
- [ ] Import `createActorEmitter` and/or `createStateEmitter` from `@koshko/emitter`; do not manually post Koshko window messages.
- [ ] Define stable actor IDs and instance IDs for concurrent copies.
- [ ] Use stable machine-readable names and `event()` for internal events, `to()` for directed semantics.
- [ ] Add safe metadata: severity, tags, context, correlation ID, and `causedBy` where applicable.
- [ ] For Global State, emit atomic `add`/`replace`/`remove` patches with valid JSON Pointer paths and create parent values before their children.
- [ ] Instrument every meaningful emitting frame; grant extension permission to every inspected origin.
- [ ] Remove calls and the helper from production through compile-time dead-code elimination; verify the bundle contains neither the `koshko` protocol marker nor unique diagnostic event-name strings.
- [ ] Keep payloads local-only, minimal, JSON-compatible, and free of secrets or personal data.
- [ ] Load the extension, reload the target tab, and verify signals in Timeline/Log and mutations in Global State.
