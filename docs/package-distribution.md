# Package-chain tarball distribution

Koshko's application-side packages form this dependency chain:

```text
@koshko/protocol <- @koshko/emitter <- @koshko/nanostores
```

All three packages use the same `0.1.x` version during the initial pilot. They
remain marked `private` to prevent accidental registry publication, but can be
packed and installed as local tarballs.

## Build and inspect

From the repository root, build the packages in dependency order:

```bash
npm run build:packages
```

The standard `npm ci`, root development, test, and type-check commands also
build the chain first, so a clean checkout never relies on stale or missing
`dist/` output.

Create all three tarballs under the ignored `artifacts/` directory:

```bash
npm run pack:packages
```

The initial artifacts are:

```text
artifacts/koshko-protocol-0.1.0.tgz
artifacts/koshko-emitter-0.1.0.tgz
artifacts/koshko-nanostores-0.1.0.tgz
```

Before sharing them, inspect each package without writing a tarball:

```bash
npm pack --dry-run --workspace=@koshko/protocol
npm pack --dry-run --workspace=@koshko/emitter
npm pack --dry-run --workspace=@koshko/nanostores
```

Each package should contain its `dist/` output, package manifest, and README.
It must not contain TypeScript source, tests, installed dependency files, or
generated coverage. Development dependency metadata may remain in
`package.json`; npm does not install it for tarball consumers.

## Install the tarball chain

Until the packages exist in a registry, consumers must install all three
artifacts in one command so npm can satisfy the unpublished transitive
dependencies locally:

```bash
npm install --save-dev \
  ./artifacts/koshko-protocol-0.1.0.tgz \
  ./artifacts/koshko-emitter-0.1.0.tgz \
  ./artifacts/koshko-nanostores-0.1.0.tgz
```

The application then follows the development-only dynamic import described in
[`packages/nanostores/README.md`](../packages/nanostores/README.md).

## Later registry publication

When registry publication is approved:

1. Remove `private` from the three package manifests.
2. Configure registry authentication and scoped-package access.
3. Publish in dependency order: protocol, emitter, then Nanostores.

Once all three versions are in the registry, consumers need only:

```bash
npm install --save-dev @koshko/nanostores
```

npm installs `@koshko/emitter` and `@koshko/protocol` transitively.
