import type { ActorReference, KoshkoSignalV1 } from '@koshko/protocol';

export const DEMO_ACTORS = {
  user: { id: 'user', label: 'User' },
  host: { id: 'host', label: 'Host application' },
  sdk: { id: 'client-sdk', label: 'Client SDK' },
  embeddedWidget: {
    id: 'widget',
    label: 'Widget',
    instanceId: 'embedded',
    instanceLabel: 'embedded',
  },
  processingWidget: {
    id: 'widget',
    label: 'Widget',
    instanceId: 'processing',
    instanceLabel: 'processing',
  },
} as const satisfies Record<string, ActorReference>;

export type DemoScenarioName = 'success' | 'failure-recovery' | 'metadata-rich';

export interface DemoEmitter {
  event(name: string, details?: unknown, options?: DemoEmitOptions): KoshkoSignalV1;
  to(target: ActorReference | string, name: string, details?: unknown, options?: DemoEmitOptions): KoshkoSignalV1;
}

export interface DemoEmitOptions {
  severity?: KoshkoSignalV1['severity'];
  correlationId?: string;
  causedBy?: string;
  tags?: readonly string[];
  context?: Readonly<Record<string, string>>;
}

export interface TopScenarioEmitters {
  user: DemoEmitter;
  host: DemoEmitter;
  sdk: DemoEmitter;
}

export interface FrameCommand {
  scenario: DemoScenarioName;
  instance: 'embedded' | 'processing';
  correlationId: string;
  causedBy: string;
}

export interface TopScenarioResult {
  signals: KoshkoSignalV1[];
  frameCommands: FrameCommand[];
}

export interface WidgetScenarioResult {
  signals: KoshkoSignalV1[];
}

export function runTopScenario(
  scenario: DemoScenarioName,
  emitters: TopScenarioEmitters,
  correlationId: string,
): TopScenarioResult {
  switch (scenario) {
    case 'success':
      return runSuccessTopScenario(emitters, correlationId);
    case 'failure-recovery':
      return runFailureRecoveryTopScenario(emitters, correlationId);
    case 'metadata-rich':
      return runMetadataRichTopScenario(emitters, correlationId);
  }
}

export function runWidgetScenario(
  scenario: DemoScenarioName,
  emitter: DemoEmitter,
  instance: 'embedded' | 'processing',
  correlationId: string,
  causedBy: string,
): WidgetScenarioResult {
  const signals: KoshkoSignalV1[] = [];
  const emit = (signal: KoshkoSignalV1): KoshkoSignalV1 => {
    signals.push(signal);
    return signal;
  };
  const widget = instance === 'embedded' ? DEMO_ACTORS.embeddedWidget : DEMO_ACTORS.processingWidget;

  emit(emitter.event('widget.command.received', {
    instance,
    scenario,
  }, {
    severity: 'debug',
    correlationId,
    causedBy,
    tags: ['widget', scenario],
  }));

  if (scenario === 'failure-recovery' && instance === 'processing') {
    const failed = emit(emitter.to(DEMO_ACTORS.host, 'widget.processing.failed', {
      retryable: true,
      reason: 'upstream timeout',
    }, {
      severity: 'error',
      correlationId,
      causedBy,
      tags: ['widget', 'processing', 'failure'],
      context: { retryable: 'true', attempt: '1' },
    }));

    const retry = emit(emitter.to(widget, 'widget.retry.scheduled', {
      afterMs: 250,
      policy: 'single-retry',
    }, {
      severity: 'warning',
      correlationId,
      causedBy: failed.id,
      tags: ['widget', 'self-message', 'recovery'],
    }));

    emit(emitter.to(DEMO_ACTORS.host, 'widget.processing.recovered', {
      attempt: 2,
      result: 'ready',
    }, {
      severity: 'success',
      correlationId,
      causedBy: retry.id,
      tags: ['widget', 'processing', 'recovery'],
    }));
    return { signals };
  }

  if (scenario === 'metadata-rich') {
    emit(emitter.to(DEMO_ACTORS.host, 'widget.diagnostics.reported', {
      instance,
      diagnostics: {
        rendering: { phase: 'complete', durationMs: 42 },
        checks: [
          { name: 'configuration', status: 'passed' },
          { name: 'accessibility', status: 'passed' },
        ],
      },
    }, {
      severity: 'success',
      correlationId,
      causedBy,
      tags: ['widget', 'diagnostics', instance],
      context: { surface: 'iframe', instance, schema: 'v1' },
    }));
    return { signals };
  }

  emit(emitter.to(DEMO_ACTORS.host, 'widget.flow.completed', {
    instance,
    result: 'ready',
  }, {
    severity: 'success',
    correlationId,
    causedBy,
    tags: ['widget', instance, 'success'],
  }));
  return { signals };
}

function runSuccessTopScenario(emitters: TopScenarioEmitters, correlationId: string): TopScenarioResult {
  const signals: KoshkoSignalV1[] = [];
  const frameCommands: FrameCommand[] = [];
  const emit = (signal: KoshkoSignalV1): KoshkoSignalV1 => {
    signals.push(signal);
    return signal;
  };

  const requested = emit(emitters.user.to(DEMO_ACTORS.host, 'user.checkout.requested', {
    action: 'start-demo',
  }, {
    severity: 'info',
    correlationId,
    tags: ['user', 'checkout'],
  }));
  emit(emitters.host.event('host.checkout.validated', {
    valid: true,
    requestedBy: requested.id,
  }, {
    severity: 'debug',
    correlationId,
    causedBy: requested.id,
    tags: ['host', 'validation'],
  }));
  const mount = emit(emitters.host.to(DEMO_ACTORS.sdk, 'host.widget.mount.requested', {
    surface: 'embedded',
  }, {
    severity: 'info',
    correlationId,
    causedBy: requested.id,
  }));
  const embeddedCommand = emit(emitters.sdk.to(DEMO_ACTORS.embeddedWidget, 'sdk.widget.mount', {
    locale: 'en',
  }, {
    severity: 'success',
    correlationId,
    causedBy: mount.id,
    tags: ['sdk', 'widget', 'embedded'],
  }));
  const processingCommand = emit(emitters.host.to(DEMO_ACTORS.processingWidget, 'host.processing.start', {
    job: 'demo-payment',
  }, {
    severity: 'info',
    correlationId,
    causedBy: requested.id,
    tags: ['host', 'processing'],
  }));

  frameCommands.push(
    createFrameCommand('success', 'embedded', correlationId, embeddedCommand.id),
    createFrameCommand('success', 'processing', correlationId, processingCommand.id),
  );
  return { signals, frameCommands };
}

function runFailureRecoveryTopScenario(emitters: TopScenarioEmitters, correlationId: string): TopScenarioResult {
  const signals: KoshkoSignalV1[] = [];
  const emit = (signal: KoshkoSignalV1): KoshkoSignalV1 => {
    signals.push(signal);
    return signal;
  };

  const requested = emit(emitters.user.to(DEMO_ACTORS.host, 'user.retry.requested', {
    action: 'retry-processing',
  }, {
    severity: 'info',
    correlationId,
    tags: ['user', 'retry'],
  }));
  const selfMessage = emit(emitters.host.to(DEMO_ACTORS.host, 'host.recovery.queued', {
    strategy: 'restart-widget',
  }, {
    severity: 'warning',
    correlationId,
    causedBy: requested.id,
    tags: ['host', 'self-message', 'recovery'],
  }));
  const command = emit(emitters.sdk.to(DEMO_ACTORS.processingWidget, 'sdk.widget.retry', {
    attempt: 1,
  }, {
    severity: 'warning',
    correlationId,
    causedBy: selfMessage.id,
    tags: ['sdk', 'retry', 'processing'],
  }));

  return {
    signals,
    frameCommands: [createFrameCommand('failure-recovery', 'processing', correlationId, command.id)],
  };
}

function runMetadataRichTopScenario(emitters: TopScenarioEmitters, correlationId: string): TopScenarioResult {
  const signals: KoshkoSignalV1[] = [];
  const frameCommands: FrameCommand[] = [];
  const emit = (signal: KoshkoSignalV1): KoshkoSignalV1 => {
    signals.push(signal);
    return signal;
  };

  const configured = emit(emitters.user.event('user.demo.inspected', {
    filters: ['actors', 'metadata'],
    preferences: { compact: false, showContext: true },
  }, {
    severity: 'debug',
    correlationId,
    tags: ['user', 'diagnostics', 'metadata'],
    context: { page: 'neutral-demo', audience: 'developer' },
  }));
  const routed = emit(emitters.host.to(DEMO_ACTORS.sdk, 'host.diagnostics.collect', {
    request: { include: ['context', 'tags', 'details'] },
  }, {
    severity: 'info',
    correlationId,
    causedBy: configured.id,
    tags: ['host', 'diagnostics'],
    context: { environment: 'local', experiment: 'metadata-rich' },
  }));

  for (const instance of ['embedded', 'processing'] as const) {
    const command = emit(emitters.sdk.to(
      instance === 'embedded' ? DEMO_ACTORS.embeddedWidget : DEMO_ACTORS.processingWidget,
      'sdk.widget.collect-diagnostics',
      { includeChildren: true, instance },
      {
        severity: 'info',
        correlationId,
        causedBy: routed.id,
        tags: ['sdk', 'diagnostics', instance],
        context: { requestKind: 'diagnostics', instance },
      },
    ));
    frameCommands.push(createFrameCommand('metadata-rich', instance, correlationId, command.id));
  }
  return { signals, frameCommands };
}

function createFrameCommand(
  scenario: DemoScenarioName,
  instance: 'embedded' | 'processing',
  correlationId: string,
  causedBy: string,
): FrameCommand {
  return { scenario, instance, correlationId, causedBy };
}
