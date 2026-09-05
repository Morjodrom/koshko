import { createActorEmitter } from '@koshko/emitter';
import type { KoshkoSignalV1 } from '@koshko/protocol';
import {
  DEMO_ACTORS,
  runTopScenario,
  type DemoScenarioName,
  type FrameCommand,
} from './scenarios';

const userEmitter = createActorEmitter(DEMO_ACTORS.user);
const hostEmitter = createActorEmitter(DEMO_ACTORS.host);
const sdkEmitter = createActorEmitter(DEMO_ACTORS.sdk);
const log = document.querySelector<HTMLElement>('#log')!;
const status = document.querySelector<HTMLElement>('#status')!;
const frames = new Map<FrameCommand['instance'], HTMLIFrameElement>([
  ['embedded', document.querySelector<HTMLIFrameElement>('#frame-embedded')!],
  ['processing', document.querySelector<HTMLIFrameElement>('#frame-processing')!],
]);
const events: string[] = [];

renderStatus('Ready. Choose a repeatable scenario. Each run receives a new correlation ID.');
wireWindow();
wireScenarioButtons();
renderLog();

function wireScenarioButtons(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-scenario]'))) {
    button.addEventListener('click', () => {
      const scenario = button.dataset.scenario as DemoScenarioName;
      runScenario(scenario);
    });
  }
}

function runScenario(scenario: DemoScenarioName): void {
  const correlationId = createCorrelationId();
  const result = runTopScenario(scenario, {
    user: userEmitter,
    host: hostEmitter,
    sdk: sdkEmitter,
  }, correlationId);

  for (const signal of result.signals) {
    record('top', signal);
  }
  for (const command of result.frameCommands) {
    frames.get(command.instance)?.contentWindow?.postMessage({
      type: 'run-widget-scenario',
      ...command,
    }, location.origin);
  }
  renderStatus(`${scenario} started with correlation ${correlationId}.`);
}

function wireWindow(): void {
  window.addEventListener('message', (event) => {
    const knownFrame = Array.from(frames.values()).some((frame) => frame.contentWindow === event.source);
    if (!knownFrame || event.origin !== location.origin) {
      return;
    }

    const data = event.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'demo-signals' || !Array.isArray(data.signals)) {
      return;
    }

    for (const signal of data.signals) {
      record(String(data.instance ?? 'widget'), signal);
    }
    renderStatus(`${String(data.instance ?? 'widget')} completed ${String(data.scenario ?? 'scenario')}.`);
  });
}

function record(source: string, signal: unknown): void {
  const name = isSignal(signal) ? signal.name : 'event';
  events.unshift(`${source} · ${name}\n${JSON.stringify(signal, null, 2)}`);
  renderLog();
}

function renderLog(): void {
  log.textContent = events.slice(0, 14).join('\n\n---\n\n');
}

function renderStatus(text: string): void {
  status.textContent = text;
}

function createCorrelationId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `demo-${random}`;
}

function isSignal(value: unknown): value is KoshkoSignalV1 {
  return typeof value === 'object' && value !== null && 'name' in value;
}
