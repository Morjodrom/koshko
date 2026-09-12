import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const artifactsDirectory = new URL('../artifacts/', import.meta.url);
const packageDirectories = [
  'protocol',
  'emitter',
  'nanostores',
];

async function readPackageMetadata(directory) {
  const packageUrl = new URL(`../packages/${directory}/package.json`, import.meta.url);
  return JSON.parse(await readFile(packageUrl, 'utf8'));
}

async function resolveTarball(metadata, artifactNames) {
  const packageStem = metadata.name.replace(/^@/, '').replace('/', '-');
  const expectedName = `${packageStem}-${metadata.version}.tgz`;
  assert(
    artifactNames.includes(expectedName),
    `Missing ${expectedName}; run npm run pack:packages first.`,
  );
  return join(fileURLToPath(artifactsDirectory), expectedName);
}

function runNpm(arguments_, cwd) {
  const result = spawnSync('npm', arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.equal(
    result.status,
    0,
    `npm ${arguments_.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
  );
}

async function verifyRuntime(projectDirectory) {
  await writeFile(join(projectDirectory, 'runtime-smoke.mjs'), `
import assert from 'node:assert/strict';
import * as protocol from '@koshko/protocol';
import * as schema from '@koshko/protocol/schema';
import * as emitter from '@koshko/emitter';
import { connectNanoStores } from '@koshko/nanostores';

function createStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  return {
    get() { return value; },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(nextValue, changedKey) {
      const previousValue = value;
      value = nextValue;
      for (const listener of listeners) listener(nextValue, previousValue, changedKey);
    },
    listenerCount() { return listeners.size; },
  };
}

assert.equal(typeof protocol.normalizeKoshkoSignalV1, 'function');
assert.equal(typeof schema.koshkoSignalV1JsonSchema, 'object');
assert.equal(typeof emitter.createStateEmitter, 'function');
assert.equal(typeof connectNanoStores, 'function');

const messages = [];
globalThis.window = { postMessage(message, targetOrigin) { messages.push({ message, targetOrigin }); } };
const counter = createStore(1);
const disconnect = connectNanoStores({ counter }, { namespace: 'development', producerId: 'smoke-test' });

assert.equal(messages.length, 1, 'Connecting should emit the initial state mutation.');
assert.equal(messages[0].targetOrigin, '*');
assert.equal(messages[0].message.mutation.label, 'Nano Stores initial snapshot');
assert.deepEqual(messages[0].message.mutation.patch, [{ op: 'add', path: '/development', value: { counter: 1 } }]);

counter.set(2, 'value');
assert.equal(messages.length, 2, 'A store listener change should emit a mutation.');
assert.equal(messages[1].message.mutation.label, 'Nano Stores counter.value changed');
assert.deepEqual(messages[1].message.mutation.patch, [{ op: 'add', path: '/development', value: { counter: 2 } }]);

disconnect();
disconnect();
assert.equal(counter.listenerCount(), 0, 'Disconnect should unsubscribe each store listener once.');
counter.set(3, 'value');
assert.equal(messages.length, 2, 'Disconnected stores must not emit later mutations.');
`);

  const result = spawnSync(process.execPath, ['runtime-smoke.mjs'], {
    cwd: projectDirectory,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.equal(result.status, 0, `Runtime package imports failed:\n${result.stdout}\n${result.stderr}`);
}

async function main() {
  const packages = await Promise.all(packageDirectories.map(readPackageMetadata));
  const artifactNames = await readdir(artifactsDirectory);
  const tarballs = await Promise.all(packages.map((metadata) => resolveTarball(metadata, artifactNames)));
  const projectDirectory = await mkdtemp(join(tmpdir(), 'koshko-package-smoke-'));

  try {
    await writeFile(join(projectDirectory, 'package.json'), JSON.stringify({
      name: 'koshko-package-smoke',
      private: true,
      type: 'module',
    }, null, 2));

    runNpm([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--offline',
      '--package-lock=false',
      ...tarballs,
    ], projectDirectory);

    await verifyRuntime(projectDirectory);
    process.stdout.write('Package consumer smoke test passed.\n');
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
}

await main();
