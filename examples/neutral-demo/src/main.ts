import { createActorEmitter, createStateEmitter } from '@koshko/emitter';
import { connectNanoStores } from '@koshko/nanostores';
import { logger } from '@nanostores/logger';
import type { KoshkoSignalV1 } from '@koshko/protocol';
import {
  $counter,
  $profile,
  getCounter,
  getProfile,
  incrementCounter,
  incrementProfileVisits,
  resetCounter,
  resetProfile,
  setProfileName,
} from './nanostores';
import {
  DEMO_ACTORS,
  runTopScenario,
  type DemoScenarioName,
  type FrameCommand,
} from './scenarios';

const userEmitter = createActorEmitter(DEMO_ACTORS.user);
const hostEmitter = createActorEmitter(DEMO_ACTORS.host);
const sdkEmitter = createActorEmitter(DEMO_ACTORS.sdk);
const stateEmitter = createStateEmitter({ producerId: 'neutral-demo-state' });
const log = document.querySelector<HTMLElement>('#log')!;
const status = document.querySelector<HTMLElement>('#status')!;
const nanoStoresValue = document.querySelector<HTMLElement>('#nanostores-value')!;
const frames = new Map<FrameCommand['instance'], HTMLIFrameElement>([
  ['embedded', document.querySelector<HTMLIFrameElement>('#frame-embedded')!],
  ['processing', document.querySelector<HTMLIFrameElement>('#frame-processing')!],
]);
const events: string[] = [];
const disconnectNanoStores = connectNanoStores({
  counter: $counter,
  profile: $profile,
});
const disconnectNanoStoresLogger = logger({
  counter: $counter,
  profile: $profile,
});

renderStatus('Ready. Choose a repeatable scenario. Each run receives a new correlation ID.');
wireWindow();
wireScenarioButtons();
wireStateMutationButtons();
wireNanoStoresControls();
window.addEventListener('pagehide', () => {
  disconnectNanoStores();
  disconnectNanoStoresLogger();
}, { once: true });
$counter.subscribe(renderNanoStoresValue);
$profile.subscribe(renderNanoStoresValue);
renderLog();

function wireScenarioButtons(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-scenario]'))) {
    button.addEventListener('click', () => {
      const scenario = button.dataset.scenario as DemoScenarioName;
      runScenario(scenario);
    });
  }
}

function wireStateMutationButtons(): void {
  document.querySelector<HTMLButtonElement>('[data-state-mutation="add"]')?.addEventListener('click', () => {
    stateEmitter.mutate([
      { op: 'add', path: '/demo', value: { message: 'Added from the neutral demo', count: 1 } },
    ], { label: 'Add demo state' });
    renderStatus('Added a global state object.');
  });
  document.querySelector<HTMLButtonElement>('[data-state-mutation="replace"]')?.addEventListener('click', () => {
    stateEmitter.mutate([
      { op: 'replace', path: '/demo/count', value: 2 },
    ], { label: 'Update demo count' });
    renderStatus('Replaced the global state count. Add state first.');
  });
  document.querySelector<HTMLButtonElement>('[data-state-mutation="remove"]')?.addEventListener('click', () => {
    stateEmitter.mutate([
      { op: 'remove', path: '/demo/message' },
    ], { label: 'Remove demo message' });
    renderStatus('Removed the global state message. Add state first.');
  });
}

function wireNanoStoresControls(): void {
  document.querySelector<HTMLButtonElement>('[data-nanostore-mutation="counter-increment"]')?.addEventListener('click', () => {
    incrementCounter();
    renderStatus('Incremented the Nano Stores counter.');
  });
  document.querySelector<HTMLButtonElement>('[data-nanostore-mutation="counter-reset"]')?.addEventListener('click', () => {
    resetCounter();
    renderStatus('Reset the Nano Stores counter.');
  });
  document.querySelector<HTMLButtonElement>('[data-nanostore-mutation="profile-visit"]')?.addEventListener('click', () => {
    incrementProfileVisits();
    renderStatus('Incremented Nano Stores profile visits.');
  });
  document.querySelector<HTMLButtonElement>('[data-nanostore-mutation="profile-name"]')?.addEventListener('click', () => {
    const name = window.prompt('Profile name', getProfile().name);
    if (name === null) {
      return;
    }
    setProfileName(name);
    renderStatus('Updated the Nano Stores profile name.');
  });
  document.querySelector<HTMLButtonElement>('[data-nanostore-mutation="profile-reset"]')?.addEventListener('click', () => {
    resetProfile();
    renderStatus('Reset the Nano Stores profile.');
  });
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

function renderNanoStoresValue(): void {
  nanoStoresValue.textContent = JSON.stringify({
    counter: getCounter(),
    profile: getProfile(),
  }, null, 2);
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
