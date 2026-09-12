# Package distribution lifecycle

Koshko's application packages form this dependency chain:

```text
@koshko/protocol <- @koshko/emitter <- @koshko/nanostores
```

They use the same `0.1.x` version during the initial pilot. The repository is
prepared for public npm distribution, but the packages are not published yet.
Registry ownership, authentication, and trusted-publisher setup are manual
account operations.

## Local build, pack, and smoke test

Use Node.js `^22.11 || ^24 || >=26` with npm `>=10.9.0`; the repository CI
currently runs on Node.js 24. These versions are required by the Changesets
tooling as well as the package release commands.

From the repository root:

```bash
npm ci
npm run build:packages
npm run pack:packages
npm run smoke:packages
```

Inspect package contents without writing a tarball:

```bash
npm pack --dry-run --workspace=@koshko/protocol
npm pack --dry-run --workspace=@koshko/emitter
npm pack --dry-run --workspace=@koshko/nanostores
```

The generated artifacts are written to ignored `artifacts/`. Each package
should contain only its manifest, README, and compiled `dist/` output. The
smoke test installs all three tarballs in an isolated temporary project and
exercises the public ESM entry points.

Until publication, consumers must install all three artifacts together:

```bash
npm install --save-dev \
  ./artifacts/koshko-protocol-0.1.0.tgz \
  ./artifacts/koshko-emitter-0.1.0.tgz \
  ./artifacts/koshko-nanostores-0.1.0.tgz
```

## Initial manual bootstrap

The first publication cannot be completed by repository automation. An owner
must confirm control of the `@koshko` npm scope, authenticate to npm, satisfy
2FA, and publish in dependency order:

```bash
npm login
npm whoami
npm publish --workspace=@koshko/protocol --access public
npm publish --workspace=@koshko/emitter --access public
npm publish --workspace=@koshko/nanostores --access public
```

Run the local checks above first. This manual bootstrap is the only step that
requires npm account access.

## Trusted publishing and Changesets

After the first versions exist, configure the repository's `publish.yml` as an
npm trusted publisher for each package. The workflow uses GitHub OIDC and no
long-lived npm token; it remains unusable until trusted publishers have been
configured.

Manage subsequent package releases with Changesets:

```bash
npm run changeset
npm run version:packages
npm run release:packages
```

During `0.x`, the three packages are a fixed lockstep group. A release
changeset versions and publishes protocol, emitter, and the Nano Stores
adapter together, preserving their dependency chain.

The guarded workflow is manual-dispatch only, must run from `main`, and asks
for explicit confirmation before publishing. It reruns the required checks
before invoking the release command.

Once all three versions are in the registry, consumers need only:

```bash
npm install --save-dev @koshko/nanostores
```

npm installs `@koshko/emitter` and `@koshko/protocol` transitively.
