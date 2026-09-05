import { describe, expect, it } from 'vitest';
import { koshkoSignalV1JsonSchema, isKoshkoSignalV1, isKoshkoWindowMessageV1, parseKoshkoWindowMessageV1 } from './index';

describe('protocol validation', () => {
  it('accepts supported signal versions and rejects unsupported messages', () => {
    const signal = {
      protocol: 'koshko',
      version: 1,
      id: 'signal-1',
      producerId: 'producer-1',
      producerSequence: 1,
      occurredAt: 1,
      source: { id: 'host' },
      name: 'widget.ready',
      unknown: 'ignored',
    };

    expect(isKoshkoSignalV1(signal)).toBe(true);
    expect(isKoshkoSignalV1({ ...signal, version: 2 })).toBe(false);

    const message = {
      protocol: 'koshko',
      version: 1,
      type: 'signal',
      signal,
    };

    expect(isKoshkoWindowMessageV1(message)).toBe(true);
    expect(parseKoshkoWindowMessageV1(message)?.signal.id).toBe('signal-1');
    expect(parseKoshkoWindowMessageV1({ ...message, version: 2 })).toBeUndefined();
  });

  it('exports a JSON schema artifact', () => {
    expect(koshkoSignalV1JsonSchema).toMatchObject({
      title: 'KoshkoSignalV1',
      properties: {
        protocol: { const: 'koshko' },
        version: { const: 1 },
      },
    });
  });
});
