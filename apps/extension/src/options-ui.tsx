import { createRoot } from 'react-dom/client';
import { OptionsApp } from './ui/options-app';
import './ui/ui.css';

const mountTarget = document.querySelector<HTMLDivElement>('#app');
if (!mountTarget) throw new Error('Options UI root is missing.');
createRoot(mountTarget).render(<OptionsApp />);
