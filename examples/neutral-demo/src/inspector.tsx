import { createRoot } from 'react-dom/client';
import { EmbeddedInspectorApp } from '../../../apps/extension/src/embedded';

const root = document.querySelector<HTMLElement>('#root');
if (!root) {
  throw new Error('Inspector root is unavailable.');
}

createRoot(root).render(<EmbeddedInspectorApp parentOrigin={location.origin} />);
