import { describe, expect, it } from 'vitest';
import {
  applyStateMutationPatch,
  normalizeKoshkoStateMutationV1,
  type JsonObject,
  type KoshkoStatePatchOperationV1,
} from './index';

describe('state mutation protocol', () => {
  it('normalizes and redacts state patch values', () => {
    const mutation = normalizeKoshkoStateMutationV1({
      id: 'mutation-1',
      producerId: 'demo',
      producerSequence: 2,
      occurredAt: 123,
      patch: [
        {
          op: 'add',
          path: '/session',
          value: {
            token: 'secret',
            callbackUrl: 'https://example.com/done?order=42#result',
            unsupported: 1n,
          },
        },
        { op: 'replace', path: '/authToken', value: 'also-secret' },
      ],
    });

    expect(mutation).toMatchObject({
      protocol: 'koshko',
      version: 1,
      id: 'mutation-1',
      producerId: 'demo',
      producerSequence: 2,
      occurredAt: 123,
      patch: [
        {
          op: 'add',
          path: '/session',
          value: {
            token: '[Redacted]',
            callbackUrl: 'https://example.com/done',
            unsupported: '[Unsupported]',
          },
        },
        { op: 'replace', path: '/authToken', value: '[Redacted]' },
      ],
    });
  });

  it('immutably applies object, escaped pointer, and array operations', () => {
    const previous: JsonObject = {
      profile: { name: 'Before', active: true },
      'feature/flags': { '~beta': false },
      items: ['a', 'c'],
    };
    const patch: KoshkoStatePatchOperationV1[] = [
      { op: 'replace', path: '/profile/name', value: 'After' },
      { op: 'remove', path: '/profile/active' },
      { op: 'replace', path: '/feature~1flags/~0beta', value: true },
      { op: 'add', path: '/items/1', value: 'b' },
      { op: 'add', path: '/items/-', value: 'd' },
      { op: 'add', path: '/new', value: { count: 1 } },
    ];

    const next = applyStateMutationPatch(previous, patch);

    expect(next).toEqual({
      profile: { name: 'After' },
      'feature/flags': { '~beta': true },
      items: ['a', 'b', 'c', 'd'],
      new: { count: 1 },
    });
    expect(next).not.toBe(previous);
    expect(next.profile).not.toBe(previous.profile);
    expect(previous).toEqual({
      profile: { name: 'Before', active: true },
      'feature/flags': { '~beta': false },
      items: ['a', 'c'],
    });
  });

  it('rejects an invalid batch atomically without throwing', () => {
    const previous: JsonObject = { profile: { name: 'Before' }, items: ['a'] };
    const patch = [
      { op: 'replace', path: '/profile/name', value: 'After' },
      { op: 'remove', path: '/missing' },
    ] as KoshkoStatePatchOperationV1[];

    const next = applyStateMutationPatch(previous, patch);

    expect(next).toBe(previous);
    expect(previous).toEqual({ profile: { name: 'Before' }, items: ['a'] });
    expect(() => applyStateMutationPatch(previous, [
      { op: 'copy', path: '/profile' },
    ] as unknown as KoshkoStatePatchOperationV1[])).not.toThrow();
    expect(applyStateMutationPatch(previous, [
      { op: 'replace', path: '', value: {} },
    ])).toBe(previous);
    expect(applyStateMutationPatch(previous, [
      { op: 'add', path: '/items/01', value: 'b' },
    ])).toBe(previous);
    expect(applyStateMutationPatch(previous, [
      { op: 'replace', path: '/profile/~2invalid', value: true },
    ])).toBe(previous);
  });
});
