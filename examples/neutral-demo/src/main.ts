import { createActorEmitter } from '@actor-flow/emitter';

const userEmitter = createActorEmitter({ id: 'user', label: 'User' });
const hostEmitter = createActorEmitter({ id: 'host', label: 'Host' });
const log = document.querySelector<HTMLElement>('#log')!;
const status = document.querySelector<HTMLElement>('#status')!;
const frameA = document.querySelector<HTMLIFrameElement>('#frame-a')!;
const frameB = document.querySelector<HTMLIFrameElement>('#frame-b')!;

const correlationId = createCorrelationId();
const frames = [frameA, frameB];
const events: string[] = [];

renderStatus('Ready. Click the button to emit a tiny flow.');
wireWindow(window, 'top');
wireButton();
renderLog();

function wireButton() {
  const button = document.querySelector<HTMLButtonElement>('#run-flow')!;
  button.addEventListener('click', () => {
    const userSignal = userEmitter.event('user.click', {
      action: 'run-flow',
      page: 'top',
    }, { correlationId });
    const hostSignal = hostEmitter.to('widget', 'host.dispatch', {
      frames: frames.length,
      page: 'top',
    }, { correlationId });

    record('top', userSignal);
    record('top', hostSignal);
    renderStatus(`Emitted ${userSignal.name} → ${hostSignal.name} with correlation ${correlationId}.`);

    for (const frame of frames) {
      frame.contentWindow?.postMessage({ type: 'run-widget-flow', correlationId }, '*');
    }
  });
}

function wireWindow(targetWindow: Window, sourceName: string) {
  targetWindow.addEventListener('message', (event) => {
    const data = event.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'demo-signal') {
      const name = String(data.name ?? 'event');
      record(sourceName, data.payload);
      renderStatus(`${sourceName}: ${name}`);
    }
  });
}

function record(source: string, signal: unknown) {
  events.unshift(`${source} ${JSON.stringify(signal, null, 2)}`);
  renderLog();
}

function renderLog() {
  log.textContent = events.slice(0, 8).join('\n\n---\n\n');
}

function renderStatus(text: string) {
  status.textContent = text;
}

function createCorrelationId() {
  return `demo-${Math.random().toString(36).slice(2, 8)}`;
}
