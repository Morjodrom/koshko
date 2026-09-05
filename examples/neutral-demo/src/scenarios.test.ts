import { describe, expect, it } from 'vitest';
import type { ActorReference, KoshkoSignalV1 } from '@koshko/protocol';
import {
  DEMO_ACTORS,
  runTopScenario,
  runWidgetScenario,
  type DemoEmitOptions,
  type DemoEmitter,
} from './scenarios';

class RecordingEmitter implements DemoEmitter {
  private sequence = 0;

  constructor(private readonly source: ActorReference) {}

  event(name: string, details?: unknown, options?: DemoEmitOptions): KoshkoSignalV1 {
    return this.emit(undefined, name, details, options);
  }

  to(target: ActorReference | string, name: string, details?: unknown, options?: DemoEmitOptions): KoshkoSignalV1 {
    return this.emit(typeof target === 'string' ? { id: target } : target, name, details, options);
  }

  private emit(
    target: ActorReference | undefined,
    name: string,
    details: unknown,
    options: DemoEmitOptions | undefined,
  ): KoshkoSignalV1 {
    this.sequence += 1;
    return {
      protocol: 'koshko',
      version: 1,
      id: `${this.source.id}-${this.sequence}`,
      producerId: this.source.id,
      producerSequence: this.sequence,
      occurredAt: this.sequence,
      source: this.source,
      ...(target === undefined ? {} : { target }),
      name,
      ...(options?.severity === undefined ? {} : { severity: options.severity }),
      ...(details === undefined ? {} : { details: details as KoshkoSignalV1['details'] }),
      ...(options?.correlationId === undefined ? {} : { correlationId: options.correlationId }),
      ...(options?.causedBy === undefined ? {} : { causedBy: options.causedBy }),
      ...(options?.tags === undefined ? {} : { tags: [...options.tags] }),
      ...(options?.context === undefined ? {} : { context: { ...options.context } }),
    };
  }
}

function createTopEmitters(): { user: RecordingEmitter; host: RecordingEmitter; sdk: RecordingEmitter } {
  return {
    user: new RecordingEmitter(DEMO_ACTORS.user),
    host: new RecordingEmitter(DEMO_ACTORS.host),
    sdk: new RecordingEmitter(DEMO_ACTORS.sdk),
  };
}

describe('neutral demo scenarios', () => {
  it('dispatches the successful flow across all actors and widget instances', () => {
    const result = runTopScenario('success', createTopEmitters(), 'correlation-success');

    expect(result.signals.map((signal) => signal.name)).toEqual([
      'user.checkout.requested',
      'host.checkout.validated',
      'host.widget.mount.requested',
      'sdk.widget.mount',
      'host.processing.start',
    ]);
    expect(result.signals.map((signal) => signal.source.id)).toEqual([
      'user', 'host', 'host', 'client-sdk', 'host',
    ]);
    expect(result.frameCommands).toEqual([
      expect.objectContaining({ instance: 'embedded', scenario: 'success', correlationId: 'correlation-success' }),
      expect.objectContaining({ instance: 'processing', scenario: 'success', correlationId: 'correlation-success' }),
    ]);
    expect(result.frameCommands.map((command) => command.causedBy)).toEqual([
      result.signals[3].id,
      result.signals[4].id,
    ]);
  });

  it('keeps correlation and causal links when the processing widget fails then recovers', () => {
    const top = runTopScenario('failure-recovery', createTopEmitters(), 'correlation-recovery');
    const widget = new RecordingEmitter(DEMO_ACTORS.processingWidget);
    const command = top.frameCommands[0];
    const result = runWidgetScenario(
      command.scenario,
      widget,
      command.instance,
      command.correlationId,
      command.causedBy,
    );

    expect(top.signals.map((signal) => signal.severity)).toEqual(['info', 'warning', 'warning']);
    expect(top.signals[1].target).toMatchObject(DEMO_ACTORS.host);
    expect(result.signals.map((signal) => signal.severity)).toEqual(['debug', 'error', 'warning', 'success']);
    expect(result.signals.every((signal) => signal.correlationId === 'correlation-recovery')).toBe(true);
    expect(result.signals[1].causedBy).toBe(command.causedBy);
    expect(result.signals[2].target).toMatchObject(DEMO_ACTORS.processingWidget);
    expect(result.signals[2].causedBy).toBe(result.signals[1].id);
    expect(result.signals[3].causedBy).toBe(result.signals[2].id);
    expect(new Set([...top.signals, ...result.signals].map((signal) => signal.severity))).toEqual(new Set([
      'debug',
      'info',
      'success',
      'warning',
      'error',
    ]));
  });

  it('emits nested metadata, tags, and context for both widget instances', () => {
    const top = runTopScenario('metadata-rich', createTopEmitters(), 'correlation-metadata');
    const embedded = runWidgetScenario(
      'metadata-rich',
      new RecordingEmitter(DEMO_ACTORS.embeddedWidget),
      'embedded',
      'correlation-metadata',
      top.frameCommands[0].causedBy,
    );
    const processing = runWidgetScenario(
      'metadata-rich',
      new RecordingEmitter(DEMO_ACTORS.processingWidget),
      'processing',
      'correlation-metadata',
      top.frameCommands[1].causedBy,
    );

    expect(top.signals[0]).toMatchObject({
      severity: 'debug',
      tags: ['user', 'diagnostics', 'metadata'],
      context: { page: 'neutral-demo', audience: 'developer' },
      details: { preferences: { showContext: true } },
    });
    expect(embedded.signals[1]).toMatchObject({
      source: DEMO_ACTORS.embeddedWidget,
      target: DEMO_ACTORS.host,
      severity: 'success',
      context: { instance: 'embedded', schema: 'v1' },
      details: { diagnostics: { checks: expect.arrayContaining([expect.objectContaining({ name: 'configuration', status: 'passed' })]) } },
    });
    expect(processing.signals[1]).toMatchObject({
      source: DEMO_ACTORS.processingWidget,
      context: { instance: 'processing' },
    });
  });
});
