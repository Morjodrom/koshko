import type { JsonValue } from '@koshko/protocol';
import { describe, expect, it } from 'vitest';
import { generateLargeState } from './large-state';

describe('large global state fixture', () => {
  it('generates the requested root objects with representative JSON values', () => {
    const state = generateLargeState(5, 10);
    const roots = Object.values(state);

    expect(roots).toHaveLength(10);
    expect(roots[0]).toMatchObject({
      title: expect.any(String),
      count: expect.any(Number),
      enabled: expect.any(Boolean),
      values: expect.any(Array),
      details: expect.any(Object),
      longDescription: expect.stringMatching(/^Koshko large state fixture text\./),
    });
    expect(String((roots[0] as Record<string, JsonValue>).longDescription).length).toBeGreaterThan(4_000);
  });

  it('is reproducible for the same parameters', () => {
    expect(generateLargeState(5, 10)).toEqual(generateLargeState(5, 10));
    expect(generateLargeState(5, 10)).not.toEqual(generateLargeState(4, 10));
  });

  it('keeps every root at or below the requested depth', () => {
    const state = generateLargeState(5, 10);
    const depths = Object.values(state).map(containerDepth);

    expect(depths.every((depth) => depth >= 2 && depth <= 5)).toBe(true);
    expect(new Set(depths).size).toBeGreaterThan(1);
  });

  it('keeps the maximum fixture within the state mutation size limit', () => {
    const state = generateLargeState(5, 10);

    expect(JSON.stringify(state).length).toBeLessThan(60 * 1_024);
  });

  it.each([
    ['depth below minimum', 1, 1],
    ['depth above maximum', 6, 1],
    ['fractional depth', 2.5, 1],
    ['root count below minimum', 2, 0],
    ['root count above maximum', 2, 11],
    ['fractional root count', 2, 1.5],
  ])('rejects %s', (_name, depth, rootObjectCount) => {
    expect(() => generateLargeState(depth, rootObjectCount)).toThrow(RangeError);
  });
});

function containerDepth(value: JsonValue): number {
  if (value === null || typeof value !== 'object') {
    return 0;
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...children.map(containerDepth));
}
