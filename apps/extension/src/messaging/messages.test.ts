import { describe, expect, it } from 'vitest';
import { parseTabId } from './messages';

describe('extension message helpers', () => {
  it('parses only non-negative integer tab ids', () => {
    expect(parseTabId('0')).toBe(0);
    expect(parseTabId('17')).toBe(17);
    for (const value of [null, undefined, '', ' ', '-1', '1.5', 'abc', '1e2']) {
      expect(parseTabId(value)).toBeNull();
    }
  });
});
