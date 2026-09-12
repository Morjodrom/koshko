# Koshko protocol

`@koshko/protocol` contains the public Koshko message types, validation,
normalization, redaction, JSON schemas, and state-patch helpers.

Most consumers import from the package root. JSON schemas are also available
from `@koshko/protocol/schema`.

## Install

The package is prepared for public npm publication but is not available from
the registry yet. After publication, install it with:

```bash
npm install @koshko/protocol
```

Before publication, build and install the local tarball as described in the
[package distribution guide](../../docs/package-distribution.md).

## Usage

The package is ESM-only and is intended for browser-side application code or
other ESM-compatible tooling. Validate an untrusted window message before
using it:

```ts
import { parseKoshkoWindowMessageV1 } from '@koshko/protocol';

window.addEventListener('message', (event) => {
  const message = parseKoshkoWindowMessageV1(event.data);
  if (message) console.log(message.type);
});
```

The root export also provides normalization, type guards, captured-message,
and state-patch helpers. Schemas are available from the separate
`@koshko/protocol/schema` entry point.

See the [repository](https://github.com/Morjodrom/koshko) and its
[MIT license](../../LICENSE) for project details.
