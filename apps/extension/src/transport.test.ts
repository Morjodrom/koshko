import { describe, expect, it } from 'vitest';
import { normalizeOrigin, normalizeOriginList, originToMatchPattern, originToScriptId } from './origins';

describe('extension transport helpers', () => {
  it('normalizes origins and creates stable content-script ids', () => {
    expect(normalizeOrigin('https://example.com/path?x=1')).toBe('https://example.com');
    expect(originToMatchPattern('https://example.com')).toBe('https://example.com/*');
    expect(originToMatchPattern('http://127.0.0.1:5173')).toBe('http://127.0.0.1/*');
    expect(originToScriptId('https://example.com')).toMatch(/^koshko-/);
    expect(normalizeOriginList(['https://example.com/path', 'https://example.com'])).toEqual(['https://example.com']);
  });
});
