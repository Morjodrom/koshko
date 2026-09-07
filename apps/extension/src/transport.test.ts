import { describe, expect, it } from 'vitest';
import { normalizeOrigin, normalizeOriginList, originToMatchPattern, originToScriptId } from './origins';
import { parseTabId } from './shared';

describe('extension transport helpers', () => {
  it('parses only non-negative integer tab ids', () => {
    expect(parseTabId('0')).toBe(0);
    expect(parseTabId('17')).toBe(17);
    for (const value of [null, undefined, '', ' ', '-1', '1.5', 'abc', '1e2']) {
      expect(parseTabId(value)).toBeNull();
    }
  });
  it('normalizes origins and creates stable content-script ids', () => {
    expect(normalizeOrigin('https://example.com/path?x=1')).toBe('https://example.com');
    expect(originToMatchPattern('https://example.com')).toBe('https://example.com/*');
    expect(originToMatchPattern('http://127.0.0.1:5173')).toBe('http://127.0.0.1/*');
    expect(originToScriptId('https://example.com')).toMatch(/^koshko-/);
    expect(normalizeOriginList(['https://example.com/path', 'https://example.com'])).toEqual(['https://example.com']);
  });
});
