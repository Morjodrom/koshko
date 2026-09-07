import { createRoot } from 'react-dom/client';
import { PanelApp } from './panel-app';
import { PANEL_PORT_PREFIX } from './shared';
import { KoshkoRepository } from './repository';
import { createPanelAccessController } from './panel-access';
import { PanelConnection, type PanelConnectionPort } from './panel-connection';
import './ui.css';

const mountTarget = document.querySelector<HTMLDivElement>('#app');
if (!mountTarget) throw new Error('Panel UI root is missing.');

const tabId = Number(new URL(location.href).searchParams.get('tabId') ?? '');
if (!Number.isFinite(tabId) || tabId < 0) {
  mountTarget.textContent = 'This panel needs a tab id.';
  throw new Error('Missing inspected tab id.');
}

const repository = new KoshkoRepository();
const port = new PanelConnection(() => chrome.runtime.connect({
  name: `${PANEL_PORT_PREFIX}${tabId}`,
}) as PanelConnectionPort);

createRoot(mountTarget).render(
  <PanelApp
    repository={repository}
    connection={port}
    tabId={tabId}
    accessController={createPanelAccessController(tabId)}
    downloadJsonl={(jsonl) => {
      const blob = new Blob([jsonl], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'koshko.jsonl';
      link.click();
      URL.revokeObjectURL(url);
    }}
  />,
);

window.addEventListener('unload', () => port.dispose(), { once: true });
