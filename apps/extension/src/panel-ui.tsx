import { createRoot } from 'react-dom/client';
import { PanelApp } from './ui/panel-app';
import { PANEL_PORT_PREFIX, parseTabId } from './messaging/messages';
import { KoshkoRepository } from './state/repository';
import { createPanelAccessController } from './browser/panel-access';
import { PanelConnection, type PanelConnectionPort } from './messaging/panel-connection';
import './ui/ui.css';

const mountTarget = document.querySelector<HTMLDivElement>('#app');
if (!mountTarget) throw new Error('Panel UI root is missing.');

const tabId = parseTabId(new URL(location.href).searchParams.get('tabId'));
if (tabId == null) {
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
