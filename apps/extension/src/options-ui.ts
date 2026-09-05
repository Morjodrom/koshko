import { PANEL_MESSAGE_SYNC_ORIGINS, STORAGE_KEY } from './shared';
import { getStoredOrigins } from './registry';
import { normalizeOrigin, originToMatchPattern } from './origins';
import './ui.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">Actor Flow DevTools</p>
      <h1>Origin access</h1>
      <p class="muted">Grant one origin at a time, then reload the page you want to inspect.</p>
    </header>
    <form id="origin-form" class="card">
      <label class="field">
        <span>Origin</span>
        <input id="origin-input" type="url" placeholder="https://example.com" autocomplete="off" spellcheck="false" />
      </label>
      <div class="actions">
        <button type="submit" class="primary">Grant origin</button>
      </div>
      <p id="status" class="status muted"></p>
    </form>
    <section class="card">
      <div class="section-header">
        <h2>Granted origins</h2>
      </div>
      <ul id="origin-list" class="list"></ul>
    </section>
  </main>
`;

const form = app.querySelector<HTMLFormElement>('#origin-form')!;
const input = app.querySelector<HTMLInputElement>('#origin-input')!;
const status = app.querySelector<HTMLParagraphElement>('#status')!;
const originList = app.querySelector<HTMLUListElement>('#origin-list')!;

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const origin = normalizeOrigin(input.value.trim());
    const granted = await chrome.permissions.request({ origins: [originToMatchPattern(origin)] });
    if (!granted) {
      setStatus('Permission was not granted.');
      return;
    }

    const origins = await getStoredOrigins();
    const next = Array.from(new Set([...origins, origin])).sort((left, right) => left.localeCompare(right));
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    await chrome.runtime.sendMessage({ type: PANEL_MESSAGE_SYNC_ORIGINS, origins: next });

    input.value = '';
    setStatus(`Granted ${origin}. Reload the target page.`);
    await renderOrigins();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not grant origin.');
  }
});

function setStatus(message: string): void {
  status.textContent = message;
}

async function renderOrigins(): Promise<void> {
  const origins = await getStoredOrigins();
  originList.innerHTML = '';

  if (origins.length === 0) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = 'No origins granted yet.';
    originList.append(item);
    return;
  }

  for (const origin of origins) {
    const item = document.createElement('li');
    item.className = 'list-row';

    const label = document.createElement('span');
    label.textContent = origin;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = 'Remove';
    button.addEventListener('click', async () => {
      const originsNext = origins.filter((value) => value !== origin);
      await chrome.permissions.remove({ origins: [originToMatchPattern(origin)] });
      await chrome.storage.local.set({ [STORAGE_KEY]: originsNext });
      await chrome.runtime.sendMessage({ type: PANEL_MESSAGE_SYNC_ORIGINS, origins: originsNext });
      setStatus(`Removed ${origin}.`);
      await renderOrigins();
    });

    item.append(label, button);
    originList.append(item);
  }
}

void renderOrigins();
