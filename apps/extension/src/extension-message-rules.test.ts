import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTENSION_MESSAGE_RULES,
  MAX_EXTENSION_MESSAGE_RULES,
  classifyExtensionPostMessage,
  normalizeExtensionMessageRules,
} from './extension-message-rules';

describe('extension message rules', () => {
  it('classifies the built-in React and PIXI signatures', () => {
    expect(classifyExtensionPostMessage({ source: 'react-devtools-content-script', hello: true }, DEFAULT_EXTENSION_MESSAGE_RULES)).toBe('React DevTools');
    expect(classifyExtensionPostMessage({ method: 'pixi-inactive' }, DEFAULT_EXTENSION_MESSAGE_RULES)).toBe('PIXI DevTools');
  });

  it('supports safe nested paths and operators', () => {
    const rules = normalizeExtensionMessageRules({ version: 1, rules: [
      { id: 'a', name: 'Nested', enabled: true, path: 'meta.kind', operator: 'equals', value: 3 },
      { id: 'b', name: 'Exists', enabled: true, path: 'present', operator: 'exists' },
    ] });
    expect(classifyExtensionPostMessage({ meta: { kind: 3 } }, rules.rules)).toBe('Nested');
    expect(classifyExtensionPostMessage({ present: false }, rules.rules)).toBe('Exists');
  });

  it('matches every supported scalar type with equals', () => {
    const rules = normalizeExtensionMessageRules({ version: 1, rules: [
      { id: 'string', name: 'String', enabled: true, path: 'value', operator: 'equals', value: 'ready' },
      { id: 'number', name: 'Number', enabled: true, path: 'value', operator: 'equals', value: 42 },
      { id: 'boolean', name: 'Boolean', enabled: true, path: 'value', operator: 'equals', value: true },
      { id: 'null', name: 'Null', enabled: true, path: 'value', operator: 'equals', value: null },
    ] }).rules;

    expect(classifyExtensionPostMessage({ value: 'ready' }, rules)).toBe('String');
    expect(classifyExtensionPostMessage({ value: 42 }, rules)).toBe('Number');
    expect(classifyExtensionPostMessage({ value: true }, rules)).toBe('Boolean');
    expect(classifyExtensionPostMessage({ value: null }, rules)).toBe('Null');
  });

  it('skips disabled rules and returns the first enabled match', () => {
    const rules = normalizeExtensionMessageRules({ version: 1, rules: [
      { id: 'disabled', name: 'Disabled', enabled: false, path: 'source', operator: 'exists' },
      { id: 'first', name: 'First', enabled: true, path: 'source', operator: 'starts-with', value: 'tool-' },
      { id: 'second', name: 'Second', enabled: true, path: 'source', operator: 'equals', value: 'tool-message' },
    ] }).rules;

    expect(classifyExtensionPostMessage({ source: 'tool-message' }, rules)).toBe('First');
  });

  it('keeps near matches visible', () => {
    expect(classifyExtensionPostMessage({ source: 'x-react-devtools-content-script' }, DEFAULT_EXTENSION_MESSAGE_RULES)).toBeNull();
    expect(classifyExtensionPostMessage({ method: 'app-pixi-inactive' }, DEFAULT_EXTENSION_MESSAGE_RULES)).toBeNull();
    expect(classifyExtensionPostMessage({ nested: { source: 'react-devtools-content-script' } }, DEFAULT_EXTENSION_MESSAGE_RULES)).toBeNull();
  });

  it('ignores malformed rules and protects prototype properties', () => {
    const rules = normalizeExtensionMessageRules({ version: 1, rules: [
      { id: 'bad', name: 'Bad', enabled: true, path: 'a.b.c.d.e', operator: 'exists' },
      { id: 'proto', name: 'Prototype', enabled: true, path: 'toString', operator: 'exists' },
    ] });
    expect(rules.rules).toHaveLength(1);
    expect(classifyExtensionPostMessage({}, rules.rules)).toBeNull();
  });

  it('falls back to defaults for an unusable configuration', () => {
    expect(normalizeExtensionMessageRules({ version: 99, rules: [] }).rules).toHaveLength(2);
    expect(normalizeExtensionMessageRules({ version: 1, rules: [{ nope: true }] }).rules).toHaveLength(2);
  });

  it('keeps valid stored rules while ignoring invalid rules and enforcing the count limit', () => {
    const candidates = Array.from({ length: MAX_EXTENSION_MESSAGE_RULES + 5 }, (_, index) => ({
      id: `rule-${index}`,
      name: `Rule ${index}`,
      enabled: true,
      path: 'kind',
      operator: 'exists',
    }));
    candidates.splice(1, 0, {
      id: 'invalid-depth',
      name: 'Invalid',
      enabled: true,
      path: 'a.b.c.d.e',
      operator: 'exists',
    });

    const config = normalizeExtensionMessageRules({ version: 1, rules: candidates });

    expect(config.rules).toHaveLength(MAX_EXTENSION_MESSAGE_RULES);
    expect(config.rules.some((rule) => rule.id === 'invalid-depth')).toBe(false);
    expect(config.rules[0].id).toBe('rule-0');
  });

  it('rejects non-string starts-with values', () => {
    const config = normalizeExtensionMessageRules({ version: 1, rules: [
      { id: 'bad-prefix', name: 'Bad prefix', enabled: true, path: 'method', operator: 'starts-with', value: 42 },
    ] });
    expect(config.rules.some((rule) => rule.id === 'bad-prefix')).toBe(false);
  });
});
