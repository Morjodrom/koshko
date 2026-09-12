import { describe, expect, it } from 'vitest';
import { getConfiguredParentOrigin } from './parent-origin';

describe('getConfiguredParentOrigin', () => {
  it('uses an explicit HTTP(S) cooperating parent origin', () => {
    expect(getConfiguredParentOrigin('?parentOrigin=https%3A%2F%2Fparent.example.test%2Fpath', 'https://child.example.test'))
      .toBe('https://parent.example.test');
  });

  it('falls back for absent, malformed, and non-HTTP parent origins', () => {
    const fallback = 'https://child.example.test';
    expect(getConfiguredParentOrigin('', fallback)).toBe(fallback);
    expect(getConfiguredParentOrigin('?parentOrigin=not-a-url', fallback)).toBe(fallback);
    expect(getConfiguredParentOrigin('?parentOrigin=javascript%3Aalert(1)', fallback)).toBe(fallback);
  });
});
