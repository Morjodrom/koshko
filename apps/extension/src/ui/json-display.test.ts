import { describe, expect, it } from 'vitest';
import { expandStringifiedJson, formatJsonForDisplay } from './json-display';

describe('expandStringifiedJson', () => {
  it('recursively expands stringified objects and arrays without mutating input', () => {
    const input = { data: '{"payload":"{\\"some\\":\\"value\\"}","items":[1,2]}' };
    const expanded = expandStringifiedJson(input);

    expect(expanded).toEqual({ data: { payload: { some: 'value' }, items: [1, 2] } });
    expect(input).toEqual({ data: '{"payload":"{\\"some\\":\\"value\\"}","items":[1,2]}' });
  });

  it('keeps scalar, malformed, and ordinary strings unchanged', () => {
    expect(expandStringifiedJson({ scalar: 'true', malformed: '{oops', text: 'hello' })).toEqual({
      scalar: 'true',
      malformed: '{oops',
      text: 'hello',
    });
  });


  it('keeps pathologically deep stringified values unchanged and format-safe', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index < 50; index += 1) {
      nested = { level: nested };
    }
    const input = JSON.stringify(nested);
    const value = { data: input };

    expect(expandStringifiedJson(value)).toEqual(value);
    expect(() => formatJsonForDisplay(value, true)).not.toThrow();
  });

  it('formats expanded values only when enabled', () => {
    const value = { data: '{"payload":"some"}' };
    expect(formatJsonForDisplay(value, false)).toContain('\\"payload\\"');
    expect(formatJsonForDisplay(value, true)).toContain('"payload": "some"');
  });
});
