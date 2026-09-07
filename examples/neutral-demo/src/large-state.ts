import type { JsonObject, JsonValue } from '@koshko/protocol';

const MIN_DEPTH = 2;
const MAX_DEPTH = 5;
const MIN_ROOT_OBJECTS = 1;
const MAX_ROOT_OBJECTS = 10;
const LONG_STRING = 'Koshko large state fixture text. '.repeat(128);

export function generateLargeState(depth: number, rootObjectCount: number): JsonObject {
  assertIntegerInRange('depth', depth, MIN_DEPTH, MAX_DEPTH);
  assertIntegerInRange('rootObjectCount', rootObjectCount, MIN_ROOT_OBJECTS, MAX_ROOT_OBJECTS);

  const random = createRandom((depth * 1_000_003) ^ (rootObjectCount * 97_409));
  const state: JsonObject = {};

  for (let index = 0; index < rootObjectCount; index += 1) {
    const targetDepth = randomInteger(random, MIN_DEPTH, depth);
    state[`object-${String(index + 1).padStart(2, '0')}`] = createNode(
      index,
      1,
      targetDepth,
      random,
      index === 0,
    );
  }

  return state;
}

function createNode(
  rootIndex: number,
  currentDepth: number,
  targetDepth: number,
  random: () => number,
  includeLongString: boolean,
): JsonObject {
  const node: JsonObject = {
    title: `Fixture object ${rootIndex + 1}, level ${currentDepth}`,
    count: randomInteger(random, 0, 10_000),
    enabled: random() >= 0.5,
  };

  if (includeLongString && currentDepth === 1) {
    node.longDescription = LONG_STRING;
  }

  if (currentDepth >= targetDepth) {
    return node;
  }

  node.values = createValues(random, currentDepth);
  node.details = createNode(rootIndex, currentDepth + 1, targetDepth, random, false);
  return node;
}

function createValues(random: () => number, level: number): JsonValue[] {
  return [
    `level-${level}`,
    randomInteger(random, -1_000, 1_000),
    random() >= 0.5,
    Number(random().toFixed(4)),
  ];
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomInteger(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function assertIntegerInRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}
