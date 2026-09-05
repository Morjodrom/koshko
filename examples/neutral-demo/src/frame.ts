import { createActorEmitter } from '@koshko/emitter';
import type { KoshkoSignalV1 } from '@koshko/protocol';
import {
  DEMO_ACTORS,
  runWidgetScenario,
  type DemoScenarioName,
} from './scenarios';

const params = new URLSearchParams(window.location.search);
const instance = readInstance(params.get('instance'));
const emitter = createActorEmitter(instance === 'embedded' ? DEMO_ACTORS.embeddedWidget : DEMO_ACTORS.processingWidget);
const status = document.querySelector<HTMLElement>('#frame-status')!;
const button = document.querySelector<HTMLButtonElement>('#emit')!;

status.textContent = `Widget instance: ${instance}`;
button.addEventListener('click', () => {
  emitScenario('metadata-rich', createCorrelationId(), 'manual-widget-action');
});
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== location.origin) {
    return;
  }

  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || data.type !== 'run-widget-scenario') {
    return;
  }
  const scenario = data.scenario;
  const correlationId = data.correlationId;
  const causedBy = data.causedBy;
  if (!isScenarioName(scenario) || typeof correlationId !== 'string' || typeof causedBy !== 'string') {
    return;
  }
  emitScenario(scenario, correlationId, causedBy);
});

function emitScenario(scenario: DemoScenarioName, correlationId: string, causedBy: string): void {
  const result = runWidgetScenario(scenario, emitter, instance, correlationId, causedBy);
  status.textContent = `${instance}: ${scenario} emitted ${result.signals.length} signals`;
  window.parent.postMessage({
    type: 'demo-signals',
    instance,
    scenario,
    signals: result.signals,
  }, location.origin);
}

function readInstance(value: string | null): 'embedded' | 'processing' {
  return value === 'processing' ? 'processing' : 'embedded';
}

function isScenarioName(value: unknown): value is DemoScenarioName {
  return value === 'success' || value === 'failure-recovery' || value === 'metadata-rich';
}

function createCorrelationId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `manual-${random}`;
}
