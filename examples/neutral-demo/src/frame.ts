import { createActorEmitter } from '@actor-flow/emitter';

const params = new URLSearchParams(window.location.search);
const instance = params.get('instance') ?? 'frame';
const emitter = createActorEmitter({ id: 'widget', label: 'Widget', instanceId: instance, instanceLabel: instance });
const status = document.querySelector<HTMLElement>('#frame-status')!;
const button = document.querySelector<HTMLButtonElement>('#emit')!;

status.textContent = `Instance: ${instance}`;

button.addEventListener('click', () => emitFlow('manual'));
window.addEventListener('message', (event) => {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'run-widget-flow') emitFlow(String(data.correlationId ?? ''));
});

function emitFlow(correlationId: string) {
  emitter.event('widget.respond', { instance, kind: 'demo' }, { correlationId });
  const signal = emitter.to('host', 'widget.completed', { instance, kind: 'demo' }, { correlationId });
  status.textContent = `Emitted ${signal.name}`;
  window.parent.postMessage({ type: 'demo-signal', name: signal.name, payload: signal }, '*');
}
