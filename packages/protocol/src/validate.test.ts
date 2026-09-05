import { describe, expect, it } from 'vitest';
import { actorFlowSignalV1JsonSchema, isActorFlowSignalV1, isActorFlowWindowMessageV1, parseActorFlowWindowMessageV1 } from './index';

describe('protocol validation', () => {
  it('accepts supported signal versions and rejects unsupported messages', () => {
    const signal = {
      protocol: 'actor-flow',
      version: 1,
      id: 'signal-1',
      producerId: 'producer-1',
      producerSequence: 1,
      occurredAt: 1,
      source: { id: 'host' },
      name: 'widget.ready',
      unknown: 'ignored',
    };

    expect(isActorFlowSignalV1(signal)).toBe(true);
    expect(isActorFlowSignalV1({ ...signal, version: 2 })).toBe(false);

    const message = {
      protocol: 'actor-flow',
      version: 1,
      type: 'signal',
      signal,
    };

    expect(isActorFlowWindowMessageV1(message)).toBe(true);
    expect(parseActorFlowWindowMessageV1(message)?.signal.id).toBe('signal-1');
    expect(parseActorFlowWindowMessageV1({ ...message, version: 2 })).toBeUndefined();
  });

  it('exports a JSON schema artifact', () => {
    expect(actorFlowSignalV1JsonSchema).toMatchObject({
      title: 'ActorFlowSignalV1',
      properties: {
        protocol: { const: 'actor-flow' },
        version: { const: 1 },
      },
    });
  });
});
